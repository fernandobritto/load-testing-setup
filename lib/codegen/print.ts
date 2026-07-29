import type { Expr, Program, Stmt } from './js-ast'

/**
 * Serializes the JS AST into StandardJS-style source:
 * no semicolons, single quotes, two-space indentation.
 */

const INDENT = '  '

const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/

function quote(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
  return `'${escaped}'`
}

function objectKey(key: string): string {
  return IDENTIFIER_RE.test(key) ? key : quote(key)
}

export function printExpr(expr: Expr, depth: number): string {
  const pad = INDENT.repeat(depth)
  const padIn = INDENT.repeat(depth + 1)

  switch (expr.kind) {
    case 'id':
      return expr.name
    case 'str':
      return quote(expr.value)
    case 'num':
      return String(expr.value)
    case 'bool':
      return expr.value ? 'true' : 'false'
    case 'null':
      return 'null'
    case 'raw':
      return expr.code
    case 'template': {
      const inner = expr.parts
        .map((part) =>
          part.kind === 'text'
            ? part.text.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')
            : `\${${printExpr(part.expr, depth)}}`
        )
        .join('')
      return `\`${inner}\``
    }
    case 'array': {
      if (expr.items.length === 0) return '[]'
      const items = expr.items.map((item) => printExpr(item, depth + 1))
      const oneLine = `[${items.join(', ')}]`
      if (oneLine.length <= 72 && !oneLine.includes('\n')) return oneLine
      return `[\n${items.map((item) => padIn + item).join(',\n')}\n${pad}]`
    }
    case 'object': {
      if (expr.props.length === 0) return '{}'
      const entries = expr.props.map((p) => {
        const key =
          p.computedKey === undefined ? objectKey(p.key) : `[${printExpr(p.computedKey, depth + 1)}]`
        return `${key}: ${printExpr(p.value, depth + 1)}`
      })
      const oneLine = `{ ${entries.join(', ')} }`
      if (expr.multiline !== true && oneLine.length <= 72 && !oneLine.includes('\n')) return oneLine
      return `{\n${entries.map((entry) => padIn + entry).join(',\n')}\n${pad}}`
    }
    case 'call': {
      const callee = printExpr(expr.callee, depth)
      const args = expr.args.map((arg) => printExpr(arg, depth))
      return `${callee}(${args.join(', ')})`
    }
    case 'member': {
      const object = printExpr(expr.object, depth)
      if (expr.computed === true && expr.computedExpr !== undefined) {
        return `${object}[${printExpr(expr.computedExpr, depth)}]`
      }
      return IDENTIFIER_RE.test(expr.property)
        ? `${object}.${expr.property}`
        : `${object}[${quote(expr.property)}]`
    }
    case 'arrow': {
      const params = expr.params.length === 1 ? expr.params[0] : `(${expr.params.join(', ')})`
      if (Array.isArray(expr.body)) {
        const body = printStmts(expr.body, depth + 1)
        return `${params} => {\n${body}\n${pad}}`
      }
      const bodyStr = printExpr(expr.body, depth)
      return expr.body.kind === 'object' ? `${params} => (${bodyStr})` : `${params} => ${bodyStr}`
    }
    case 'binary':
      return `${printExpr(expr.left, depth)} ${expr.op} ${printExpr(expr.right, depth)}`
    case 'unary':
      return `${expr.op}${printExpr(expr.operand, depth)}`
  }
}

function printStmt(stmt: Stmt, depth: number): string {
  const pad = INDENT.repeat(depth)

  switch (stmt.kind) {
    case 'import': {
      const parts: string[] = []
      if (stmt.defaultName !== undefined) parts.push(stmt.defaultName)
      if (stmt.named.length > 0) parts.push(`{ ${stmt.named.join(', ')} }`)
      return `${pad}import ${parts.join(', ')} from ${quote(stmt.source)}`
    }
    case 'const':
      return `${pad}${stmt.exported === true ? 'export ' : ''}const ${stmt.name} = ${printExpr(stmt.init, depth)}`
    case 'let':
      return `${pad}let ${stmt.name} = ${printExpr(stmt.init, depth)}`
    case 'expr-stmt':
      return `${pad}${printExpr(stmt.expr, depth)}`
    case 'return':
      return stmt.value === undefined ? `${pad}return` : `${pad}return ${printExpr(stmt.value, depth)}`
    case 'if': {
      const test = printExpr(stmt.test, depth)
      let out = `${pad}if (${test}) {\n${printStmts(stmt.consequent, depth + 1)}\n${pad}}`
      if (stmt.alternate !== undefined && stmt.alternate.length > 0) {
        out += ` else {\n${printStmts(stmt.alternate, depth + 1)}\n${pad}}`
      }
      return out
    }
    case 'for-count': {
      const count = printExpr(stmt.count, depth)
      const v = stmt.varName
      return `${pad}for (let ${v} = 0; ${v} < ${count}; ${v}++) {\n${printStmts(stmt.body, depth + 1)}\n${pad}}`
    }
    case 'func': {
      const prefix = stmt.isDefault === true ? 'export default ' : stmt.exported === true ? 'export ' : ''
      const name = stmt.name === '' ? '' : ` ${stmt.name}`
      return `${pad}${prefix}function${name} (${stmt.params.join(', ')}) {\n${printStmts(stmt.body, depth + 1)}\n${pad}}`
    }
    case 'comment':
      return stmt.text
        .split('\n')
        .map((line) => `${pad}// ${line}`.trimEnd())
        .join('\n')
    case 'blank':
      return ''
  }
}

function printStmts(stmts: Stmt[], depth: number): string {
  return stmts.map((stmt) => printStmt(stmt, depth)).join('\n')
}

export function printProgram(program: Program): string {
  /* Collapse consecutive blank statements at the top-level boundary only, so
     multi-line template-literal contents are never touched. */
  const rendered = program.body.map((stmt) => printStmt(stmt, 0))
  const lines: string[] = []
  for (const line of rendered) {
    if (line === '' && (lines.length === 0 || lines[lines.length - 1] === '')) continue
    lines.push(line)
  }
  return `${lines.join('\n').trim()}\n`
}
