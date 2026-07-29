import { createKeyValue, createRequest, createStatusCheck } from '@/lib/dsl/defaults'
import type { HttpMethod, HttpRequestDef, KeyValue, RequestBody } from '@/lib/dsl/types'
import { tryParseJson } from '@/lib/utils'

export interface CurlParseError {
  /** 1-based index of the command inside the pasted batch */
  commandIndex: number
  /** The offending source snippet */
  snippet: string
  message: string
  hint: string
}

export interface CurlParseResult {
  requests: HttpRequestDef[]
  errors: CurlParseError[]
}

/* ------------------------------------------------------------------ */
/* Shell tokenizer                                                     */
/* ------------------------------------------------------------------ */

type Token = { type: 'word'; value: string } | { type: 'separator' }

class TokenizeError extends Error {}

/**
 * Tokenizes POSIX-ish shell input: single quotes, double quotes,
 * backslash escapes, ANSI-C quoting ($'…'), backslash-newline
 * continuations and command separators (newline, ';', '&&', '|').
 */
function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  let current = ''
  let hasWord = false
  let i = 0

  const pushWord = (): void => {
    if (hasWord) {
      tokens.push({ type: 'word', value: current })
      current = ''
      hasWord = false
    }
  }
  const pushSeparator = (): void => {
    pushWord()
    if (tokens.length > 0 && tokens[tokens.length - 1]?.type !== 'separator') {
      tokens.push({ type: 'separator' })
    }
  }

  while (i < input.length) {
    const ch = input[i]

    if (ch === '\\') {
      const next = input[i + 1]
      if (next === '\n') {
        i += 2 // line continuation
        continue
      }
      if (next === '\r' && input[i + 2] === '\n') {
        i += 3
        continue
      }
      if (next === undefined) throw new TokenizeError('Trailing backslash at end of input')
      current += next
      hasWord = true
      i += 2
      continue
    }

    if (ch === "'") {
      const end = input.indexOf("'", i + 1)
      if (end === -1) throw new TokenizeError('Unterminated single quote')
      current += input.slice(i + 1, end)
      hasWord = true
      i = end + 1
      continue
    }

    if (ch === '$' && input[i + 1] === "'") {
      // ANSI-C quoting: $'…' with escape sequences
      let j = i + 2
      let value = ''
      while (j < input.length && input[j] !== "'") {
        if (input[j] === '\\') {
          const esc = input[j + 1]
          const map: Record<string, string> = { n: '\n', t: '\t', r: '\r', '\\': '\\', "'": "'", '"': '"' }
          value += map[esc ?? ''] ?? esc ?? ''
          j += 2
        } else {
          value += input[j]
          j += 1
        }
      }
      if (j >= input.length) throw new TokenizeError("Unterminated $'…' quote")
      current += value
      hasWord = true
      i = j + 1
      continue
    }

    if (ch === '"') {
      let j = i + 1
      let value = ''
      while (j < input.length && input[j] !== '"') {
        if (input[j] === '\\' && ['"', '\\', '$', '`'].includes(input[j + 1] ?? '')) {
          value += input[j + 1]
          j += 2
        } else if (input[j] === '\\' && input[j + 1] === '\n') {
          j += 2
        } else {
          value += input[j]
          j += 1
        }
      }
      if (j >= input.length) throw new TokenizeError('Unterminated double quote')
      current += value
      hasWord = true
      i = j + 1
      continue
    }

    if (ch === '\n' || ch === ';') {
      pushSeparator()
      i += 1
      continue
    }

    if (ch === '&' && input[i + 1] === '&') {
      pushSeparator()
      i += 2
      continue
    }

    if (ch === '|') {
      pushSeparator()
      i += input[i + 1] === '|' ? 2 : 1
      continue
    }

    if (ch === ' ' || ch === '\t' || ch === '\r') {
      pushWord()
      i += 1
      continue
    }

    current += ch
    hasWord = true
    i += 1
  }

  pushWord()
  return tokens
}

/** Splits a token stream into individual commands (each begins with `curl`) */
function splitCommands(tokens: Token[]): string[][] {
  const commands: string[][] = []
  let current: string[] = []

  for (const token of tokens) {
    if (token.type === 'separator') {
      if (current.length > 0) commands.push(current)
      current = []
    } else {
      current.push(token.value)
    }
  }
  if (current.length > 0) commands.push(current)
  return commands
}

/* ------------------------------------------------------------------ */
/* curl argument parser                                                */
/* ------------------------------------------------------------------ */

const VALUE_FLAGS = new Set([
  '-X',
  '--request',
  '-H',
  '--header',
  '-d',
  '--data',
  '--data-raw',
  '--data-binary',
  '--data-ascii',
  '--data-urlencode',
  '-F',
  '--form',
  '--form-string',
  '-u',
  '--user',
  '-b',
  '--cookie',
  '-A',
  '--user-agent',
  '-e',
  '--referer',
  '--url',
  '-T',
  '--upload-file',
  '--max-time',
  '--connect-timeout',
  '-o',
  '--output',
  '--cacert',
  '--cert',
  '--key',
  '-x',
  '--proxy',
  '--retry',
  '--retry-delay',
  '--limit-rate',
  '-r',
  '--range',
  '-c',
  '--cookie-jar'
])

const BOOLEAN_FLAGS = new Set([
  '--compressed',
  '-k',
  '--insecure',
  '-L',
  '--location',
  '-s',
  '--silent',
  '-S',
  '--show-error',
  '-v',
  '--verbose',
  '-i',
  '--include',
  '-I',
  '--head',
  '-G',
  '--get',
  '-f',
  '--fail',
  '--http1.1',
  '--http2',
  '--http3',
  '-4',
  '-6',
  '--globoff',
  '-g',
  '--no-progress-meter',
  '--no-buffer',
  '-N'
])

class CurlSyntaxError extends Error {
  hint: string
  constructor(message: string, hint: string) {
    super(message)
    this.hint = hint
  }
}

interface ParsedCurl {
  method: HttpMethod | null
  url: string
  headers: KeyValue[]
  cookies: KeyValue[]
  dataParts: string[]
  urlEncodeParts: string[]
  formParts: KeyValue[]
  user: string | null
  userAgent: string | null
  useGet: boolean
  isHead: boolean
  maxTime: string | null
}

function parseCurlTokens(words: string[]): ParsedCurl {
  if (words[0] !== 'curl') {
    throw new CurlSyntaxError(
      `Command must start with "curl" (found "${words[0] ?? ''}")`,
      'Each imported command must be a curl invocation, e.g. curl -X POST https://api.example.com/login'
    )
  }

  const result: ParsedCurl = {
    method: null,
    url: '',
    headers: [],
    cookies: [],
    dataParts: [],
    urlEncodeParts: [],
    formParts: [],
    user: null,
    userAgent: null,
    useGet: false,
    isHead: false,
    maxTime: null
  }

  let i = 1
  while (i < words.length) {
    let flag = words[i]
    let inlineValue: string | null = null

    // --flag=value form
    if (flag.startsWith('--') && flag.includes('=')) {
      const eq = flag.indexOf('=')
      inlineValue = flag.slice(eq + 1)
      flag = flag.slice(0, eq)
    }

    if (flag.startsWith('-') && flag.length > 1) {
      if (BOOLEAN_FLAGS.has(flag)) {
        if (flag === '-G' || flag === '--get') result.useGet = true
        if (flag === '-I' || flag === '--head') result.isHead = true
        i += 1
        continue
      }

      if (VALUE_FLAGS.has(flag)) {
        const value = inlineValue ?? words[i + 1]
        if (value === undefined) {
          throw new CurlSyntaxError(
            `Flag ${flag} expects a value but none was provided`,
            `Add a value after ${flag}, e.g. ${flag} '<value>'`
          )
        }
        applyFlag(result, flag, value)
        i += inlineValue !== null ? 1 : 2
        continue
      }

      // Unknown flag: skip it, and skip its value only when it clearly isn't a URL
      const next = words[i + 1]
      if (
        inlineValue === null &&
        next !== undefined &&
        !next.startsWith('-') &&
        !/^https?:\/\//i.test(next) &&
        flag.startsWith('--')
      ) {
        i += 2
      } else {
        i += 1
      }
      continue
    }

    // Positional argument → URL
    if (result.url !== '') {
      throw new CurlSyntaxError(
        `Multiple URLs found ("${result.url}" and "${words[i]}")`,
        'Import one URL per curl command. Split this line into separate curl commands.'
      )
    }
    result.url = words[i]
    i += 1
  }

  return result
}

function applyFlag(result: ParsedCurl, flag: string, value: string): void {
  switch (flag) {
    case '-X':
    case '--request':
      result.method = normalizeMethod(value)
      break
    case '-H':
    case '--header': {
      const colon = value.indexOf(':')
      if (colon === -1) {
        // A header ending with ';' sends an empty-value header
        result.headers.push(createKeyValue(value.replace(/;$/, '').trim(), ''))
      } else {
        result.headers.push(createKeyValue(value.slice(0, colon).trim(), value.slice(colon + 1).trim()))
      }
      break
    }
    case '-b':
    case '--cookie':
      for (const pair of value.split(';')) {
        const eq = pair.indexOf('=')
        if (eq > 0) result.cookies.push(createKeyValue(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim()))
      }
      break
    case '-d':
    case '--data':
    case '--data-raw':
    case '--data-binary':
    case '--data-ascii':
      result.dataParts.push(value)
      break
    case '--data-urlencode':
      result.urlEncodeParts.push(value)
      break
    case '-F':
    case '--form':
    case '--form-string': {
      const eq = value.indexOf('=')
      if (eq === -1) {
        throw new CurlSyntaxError(
          `Form field "${value}" is missing "="`,
          'Multipart fields use name=value syntax, e.g. -F "file=@photo.png"'
        )
      }
      result.formParts.push(createKeyValue(value.slice(0, eq), value.slice(eq + 1)))
      break
    }
    case '-u':
    case '--user':
      result.user = value
      break
    case '-A':
    case '--user-agent':
      result.userAgent = value
      break
    case '--url':
      result.url = value
      break
    case '--max-time':
      result.maxTime = value
      break
    default:
      break
  }
}

function normalizeMethod(value: string): HttpMethod {
  const method = value.toUpperCase()
  const valid: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
  if ((valid as string[]).includes(method)) return method as HttpMethod
  throw new CurlSyntaxError(`Unsupported HTTP method "${value}"`, `Use one of: ${valid.join(', ')}`)
}

/* ------------------------------------------------------------------ */
/* ParsedCurl → HttpRequestDef                                         */
/* ------------------------------------------------------------------ */

function toRequestDef(parsed: ParsedCurl, index: number): HttpRequestDef {
  if (parsed.url === '') {
    throw new CurlSyntaxError(
      'No URL found in this curl command',
      'Add the target URL, e.g. curl https://api.example.com/users'
    )
  }

  let urlString = parsed.url
  if (!/^https?:\/\//i.test(urlString)) {
    if (/^[\w.-]+(:\d+)?(\/|$)/.test(urlString)) {
      urlString = `https://${urlString}`
    } else {
      throw new CurlSyntaxError(
        `"${parsed.url}" is not a valid URL`,
        'URLs must start with http:// or https://'
      )
    }
  }

  let url: URL
  try {
    url = new URL(urlString)
  } catch {
    throw new CurlSyntaxError(
      `"${parsed.url}" could not be parsed as a URL`,
      'Check for typos or unescaped special characters in the URL'
    )
  }

  const params: KeyValue[] = []
  url.searchParams.forEach((value, key) => {
    params.push(createKeyValue(key, value))
  })

  // -G moves data parts into the query string
  if (parsed.useGet) {
    for (const rawPart of [...parsed.dataParts, ...parsed.urlEncodeParts]) {
      // curl -d joins multiple values with '&'; each becomes its own query param.
      for (const part of rawPart.split('&')) {
        const eq = part.indexOf('=')
        if (eq > 0) params.push(createKeyValue(part.slice(0, eq), part.slice(eq + 1)))
      }
    }
    parsed.dataParts = []
    parsed.urlEncodeParts = []
  }

  const headers = [...parsed.headers]
  const cookies = [...parsed.cookies]

  // Cookie headers → cookie jar entries
  for (const header of headers.filter((h) => h.key.toLowerCase() === 'cookie')) {
    for (const pair of header.value.split(';')) {
      const eq = pair.indexOf('=')
      if (eq > 0) cookies.push(createKeyValue(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim()))
    }
  }
  const cleanHeaders = headers.filter((h) => h.key.toLowerCase() !== 'cookie')

  if (parsed.userAgent !== null) {
    cleanHeaders.push(createKeyValue('User-Agent', parsed.userAgent))
  }

  const contentType = cleanHeaders.find((h) => h.key.toLowerCase() === 'content-type')?.value ?? ''
  const body = buildBody(parsed, contentType)

  const hasBody = body.mode !== 'none'
  const method: HttpMethod = parsed.method ?? (parsed.isHead ? 'HEAD' : hasBody ? 'POST' : 'GET')

  // Authorization header / -u → structured auth config
  let auth: HttpRequestDef['auth'] = { type: 'none' }
  const authHeader = cleanHeaders.find((h) => h.key.toLowerCase() === 'authorization')
  if (parsed.user !== null) {
    const colon = parsed.user.indexOf(':')
    auth = {
      type: 'basic',
      username: colon === -1 ? parsed.user : parsed.user.slice(0, colon),
      password: colon === -1 ? '' : parsed.user.slice(colon + 1)
    }
  } else if (authHeader !== undefined && /^bearer\s+/i.test(authHeader.value)) {
    auth = { type: 'bearer', token: authHeader.value.replace(/^bearer\s+/i, '') }
  }
  const finalHeaders = auth.type === 'bearer' ? cleanHeaders.filter((h) => h !== authHeader) : cleanHeaders

  url.search = ''
  const baseUrl = url.toString().replace(/\/$/, url.pathname === '/' ? '' : '/')

  return createRequest({
    name: suggestName(method, url, index),
    method,
    url: baseUrl,
    params,
    headers: finalHeaders,
    cookies,
    auth,
    body,
    timeout: parsed.maxTime !== null ? `${parsed.maxTime}s` : '60s',
    checks: [createStatusCheck(method === 'POST' ? '201' : '200')]
  })
}

function buildBody(parsed: ParsedCurl, contentType: string): RequestBody {
  if (parsed.formParts.length > 0) {
    return { mode: 'multipart', raw: '', fields: parsed.formParts }
  }

  const rawJoined = [...parsed.dataParts, ...parsed.urlEncodeParts].join('&')
  if (rawJoined === '') return { mode: 'none', raw: '', fields: [] }

  const looksJson = contentType.includes('json') || /^\s*[[{]/.test(rawJoined)
  if (looksJson && tryParseJson(rawJoined).ok) {
    return { mode: 'json', raw: JSON.stringify(JSON.parse(rawJoined), null, 2), fields: [] }
  }
  if (looksJson) {
    return { mode: 'json', raw: rawJoined, fields: [] }
  }

  const isForm =
    contentType.includes('x-www-form-urlencoded') ||
    (contentType === '' && /^[^=&\s]+=[^&]*(&[^=&\s]+=[^&]*)*$/.test(rawJoined))
  if (isForm) {
    const fields = rawJoined.split('&').map((pair) => {
      const eq = pair.indexOf('=')
      return eq === -1
        ? createKeyValue(pair, '')
        : createKeyValue(decodeURIComponent(pair.slice(0, eq)), decodeURIComponent(pair.slice(eq + 1)))
    })
    return { mode: 'form-urlencoded', raw: '', fields }
  }

  return { mode: 'text', raw: rawJoined, fields: [] }
}

function suggestName(method: HttpMethod, url: URL, index: number): string {
  const segments = url.pathname.split('/').filter(Boolean)
  const meaningful = segments.filter((s) => !/^\d+$/.test(s) && !/^[0-9a-f-]{20,}$/i.test(s))
  const last = meaningful[meaningful.length - 1] ?? url.hostname.split('.')[0] ?? `request-${index + 1}`
  const words = last.replace(/[-_]+/g, ' ').replace(/\.(json|xml|html?)$/i, '')
  const title = words.charAt(0).toUpperCase() + words.slice(1)
  const verb: Record<HttpMethod, string> = {
    GET: 'Get',
    POST: 'Create',
    PUT: 'Update',
    PATCH: 'Patch',
    DELETE: 'Delete',
    HEAD: 'Head',
    OPTIONS: 'Options'
  }
  return `${verb[method]} ${title}`
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Parses raw text that may contain one or many curl commands separated
 * by newlines, `;`, `&&` or `|` — including multi-line commands using
 * backslash continuations.
 */
export function parseCurlCommands(input: string): CurlParseResult {
  const trimmed = input.trim()
  if (trimmed === '') return { requests: [], errors: [] }

  let tokens: Token[]
  try {
    tokens = tokenize(trimmed)
  } catch (error) {
    return {
      requests: [],
      errors: [
        {
          commandIndex: 1,
          snippet: trimmed.slice(0, 120),
          message: error instanceof TokenizeError ? error.message : 'Could not tokenize input',
          hint: 'Check that every quote you open is closed, and remove trailing backslashes.'
        }
      ]
    }
  }

  const commands = splitCommands(tokens)
  const requests: HttpRequestDef[] = []
  const errors: CurlParseError[] = []

  commands.forEach((words, index) => {
    // Ignore empty fragments and shell comments
    if (words.length === 0 || words[0].startsWith('#')) return
    try {
      const parsed = parseCurlTokens(words)
      requests.push(toRequestDef(parsed, requests.length))
    } catch (error) {
      const isSyntax = error instanceof CurlSyntaxError
      errors.push({
        commandIndex: index + 1,
        snippet: words.join(' ').slice(0, 120),
        message: isSyntax ? error.message : 'Unexpected parsing failure',
        hint: isSyntax ? error.hint : 'Verify this is a complete, valid curl command.'
      })
    }
  })

  if (requests.length === 0 && errors.length === 0) {
    errors.push({
      commandIndex: 1,
      snippet: trimmed.slice(0, 120),
      message: 'No curl commands found in the input',
      hint: 'Paste at least one command starting with "curl", e.g. curl https://api.example.com/health'
    })
  }

  return { requests, errors }
}
