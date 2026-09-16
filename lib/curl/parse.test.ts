import { describe, expect, it } from 'vitest'
import { parseCurlCommands } from './parse'

describe('parseCurlCommands', () => {
  it('parses a simple GET request', () => {
    const { requests, errors } = parseCurlCommands('curl https://api.example.com/users')
    expect(errors).toHaveLength(0)
    expect(requests).toHaveLength(1)
    expect(requests[0].method).toBe('GET')
    expect(requests[0].url).toBe('https://api.example.com/users')
  })

  it('parses method, headers, cookies and JSON body', () => {
    const input = `curl -X POST https://api.example.com/auth/login \\
      -H 'Content-Type: application/json' \\
      -H 'X-Trace: abc' \\
      -b 'session=xyz; other=1' \\
      -d '{"user": "alice", "nested": {"a": 1}}'`
    const { requests, errors } = parseCurlCommands(input)
    expect(errors).toHaveLength(0)
    const request = requests[0]
    expect(request.method).toBe('POST')
    expect(request.headers.map((h) => h.key)).toContain('X-Trace')
    expect(request.cookies).toHaveLength(2)
    expect(request.body.mode).toBe('json')
    expect(JSON.parse(request.body.raw)).toEqual({ user: 'alice', nested: { a: 1 } })
  })

  it('extracts query params from the URL', () => {
    const { requests } = parseCurlCommands("curl 'https://api.example.com/search?q=laptop&page=2'")
    expect(requests[0].params.map((p) => [p.key, p.value])).toEqual([
      ['q', 'laptop'],
      ['page', '2']
    ])
    expect(requests[0].url).toBe('https://api.example.com/search')
  })

  it('parses multiple commands separated by newlines and &&', () => {
    const input = 'curl https://a.example.com/x && curl https://b.example.com/y\ncurl https://c.example.com/z'
    const { requests, errors } = parseCurlCommands(input)
    expect(errors).toHaveLength(0)
    expect(requests).toHaveLength(3)
  })

  it('defaults to POST when a body is present without -X', () => {
    const { requests } = parseCurlCommands("curl https://api.example.com/items -d 'a=1&b=2'")
    expect(requests[0].method).toBe('POST')
    expect(requests[0].body.mode).toBe('form-urlencoded')
    expect(requests[0].body.fields).toHaveLength(2)
  })

  it('converts bearer Authorization headers to structured auth', () => {
    const { requests } = parseCurlCommands(
      "curl https://api.example.com/me -H 'Authorization: Bearer tok123'"
    )
    expect(requests[0].auth).toEqual({ type: 'bearer', token: 'tok123' })
    expect(requests[0].headers.some((h) => h.key.toLowerCase() === 'authorization')).toBe(false)
  })

  it('parses -u basic credentials', () => {
    const { requests } = parseCurlCommands('curl -u admin:pass https://api.example.com/secure')
    expect(requests[0].auth).toEqual({ type: 'basic', username: 'admin', password: 'pass' })
  })

  it('parses multipart form flags', () => {
    const { requests } = parseCurlCommands(
      "curl https://api.example.com/upload -F 'name=report' -F 'file=@doc.pdf'"
    )
    expect(requests[0].body.mode).toBe('multipart')
    expect(requests[0].body.fields.map((f) => f.value)).toEqual(['report', '@doc.pdf'])
  })

  it('reports unterminated quotes with a hint', () => {
    const { requests, errors } = parseCurlCommands("curl https://x.example.com -H 'oops")
    expect(requests).toHaveLength(0)
    expect(errors[0].message).toMatch(/quote/i)
    expect(errors[0].hint).not.toBe('')
  })

  it('reports missing URL', () => {
    const { errors } = parseCurlCommands('curl -X POST')
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toMatch(/no url/i)
  })

  it('reports non-curl commands', () => {
    const { errors } = parseCurlCommands('wget https://example.com')
    expect(errors[0].message).toMatch(/must start with "curl"/i)
  })

  it('moves -G data into the query string', () => {
    const { requests } = parseCurlCommands("curl -G https://api.example.com/s -d 'q=1'")
    expect(requests[0].method).toBe('GET')
    expect(requests[0].params.map((p) => p.key)).toContain('q')
  })

  it('splits &-joined -G data into separate params', () => {
    const { requests } = parseCurlCommands("curl -G https://api.example.com/s -d 'a=1&b=2'")
    expect(requests[0].params.map((p) => [p.key, p.value])).toEqual([
      ['a', '1'],
      ['b', '2']
    ])
  })

  it('strips ;type= modifiers is deferred to codegen; multipart value keeps the raw form', () => {
    const { requests } = parseCurlCommands("curl https://api.example.com/u -F 'file=@a.png;type=image/png'")
    expect(requests[0].body.mode).toBe('multipart')
    expect(requests[0].body.fields[0].value).toBe('@a.png;type=image/png')
  })
})
