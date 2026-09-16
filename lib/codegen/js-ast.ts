/**
 * Minimal JavaScript AST used by the k6 script generator.
 *
 * The generator never concatenates code strings — it builds this tree,
 * which the printer (print.ts) serializes with consistent style
 * (StandardJS: no semicolons, single quotes, two-space indentation).
 */

/* ---------------------------- expressions ---------------------------- */

export type Expr =
  | { kind: 'id'; name: string }
  | { kind: 'str'; value: string }
  | { kind: 'num'; value: number }
  | { kind: 'bool'; value: boolean }
  | { kind: 'null' }
  | { kind: 'template'; parts: TemplatePart[] }
  | { kind: 'array'; items: Expr[] }
  | { kind: 'object'; props: ObjectProp[]; multiline?: boolean }
  | { kind: 'call'; callee: Expr; args: Expr[] }
  | { kind: 'member'; object: Expr; property: string; computed?: boolean; computedExpr?: Expr }
  | { kind: 'arrow'; params: string[]; body: Expr | Stmt[] }
  | { kind: 'binary'; op: string; left: Expr; right: Expr }
  | { kind: 'unary'; op: string; operand: Expr }
  | { kind: 'raw'; code: string }

export type TemplatePart = { kind: 'text'; text: string } | { kind: 'expr'; expr: Expr }

export interface ObjectProp {
  key: string
  value: Expr
  /** When set, the key is emitted as a computed key: `[expr]: value`. */
  computedKey?: Expr
}

/* ---------------------------- statements ----------------------------- */

export type Stmt =
  | { kind: 'import'; defaultName?: string; named: string[]; source: string }
  | { kind: 'const'; name: string; init: Expr; exported?: boolean }
  | { kind: 'let'; name: string; init: Expr }
  | { kind: 'expr-stmt'; expr: Expr }
  | { kind: 'return'; value?: Expr }
  | { kind: 'if'; test: Expr; consequent: Stmt[]; alternate?: Stmt[] }
  | { kind: 'for-count'; varName: string; count: Expr; body: Stmt[] }
  | { kind: 'func'; name: string; params: string[]; body: Stmt[]; exported?: boolean; isDefault?: boolean }
  | { kind: 'comment'; text: string }
  | { kind: 'blank' }

export interface Program {
  body: Stmt[]
}

/* ------------------------------ builders ----------------------------- */

export const id = (name: string): Expr => ({ kind: 'id', name })
export const str = (value: string): Expr => ({ kind: 'str', value })
export const num = (value: number): Expr => ({ kind: 'num', value })
export const bool = (value: boolean): Expr => ({ kind: 'bool', value })
export const nil = (): Expr => ({ kind: 'null' })
export const raw = (code: string): Expr => ({ kind: 'raw', code })
export const arr = (items: Expr[]): Expr => ({ kind: 'array', items })
export const obj = (props: ObjectProp[], multiline = true): Expr => ({ kind: 'object', props, multiline })
export const prop = (key: string, value: Expr): ObjectProp => ({ key, value })
export const propComputed = (computedKey: Expr, value: Expr): ObjectProp => ({ key: '', value, computedKey })
export const call = (callee: Expr, args: Expr[]): Expr => ({ kind: 'call', callee, args })
export const member = (object: Expr, property: string): Expr => ({ kind: 'member', object, property })
export const index = (object: Expr, computedExpr: Expr): Expr => ({
  kind: 'member',
  object,
  property: '',
  computed: true,
  computedExpr
})
export const arrow = (params: string[], body: Expr | Stmt[]): Expr => ({ kind: 'arrow', params, body })
export const binary = (op: string, left: Expr, right: Expr): Expr => ({ kind: 'binary', op, left, right })
export const template = (parts: TemplatePart[]): Expr => ({ kind: 'template', parts })
export const tText = (text: string): TemplatePart => ({ kind: 'text', text })
export const tExpr = (expr: Expr): TemplatePart => ({ kind: 'expr', expr })

export const importStmt = (source: string, named: string[], defaultName?: string): Stmt => ({
  kind: 'import',
  source,
  named,
  defaultName
})
export const constStmt = (name: string, init: Expr, exported = false): Stmt => ({
  kind: 'const',
  name,
  init,
  exported
})
export const letStmt = (name: string, init: Expr): Stmt => ({ kind: 'let', name, init })
export const exprStmt = (expr: Expr): Stmt => ({ kind: 'expr-stmt', expr })
export const returnStmt = (value?: Expr): Stmt => ({ kind: 'return', value })
export const ifStmt = (test: Expr, consequent: Stmt[], alternate?: Stmt[]): Stmt => ({
  kind: 'if',
  test,
  consequent,
  alternate
})
export const forCount = (varName: string, count: Expr, body: Stmt[]): Stmt => ({
  kind: 'for-count',
  varName,
  count,
  body
})
export const func = (
  name: string,
  params: string[],
  body: Stmt[],
  opts: { exported?: boolean; isDefault?: boolean } = {}
): Stmt => ({ kind: 'func', name, params, body, ...opts })
export const comment = (text: string): Stmt => ({ kind: 'comment', text })
export const blank = (): Stmt => ({ kind: 'blank' })
