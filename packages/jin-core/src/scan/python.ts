import { readFileSync } from "node:fs"
import { relative, resolve } from "node:path"
import type { Adapter, ImportRef, Symbol } from "./base"

const CLASS = /^class\s+([A-Za-z_]\w*)\s*(?:\(([^)]*)\))?\s*:/
const FUNCTION = /^(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/
const METHOD = /^(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/
const CLASS_FIELD = /^([A-Za-z_]\w*)\s*:\s*(.+?)(?:\s*=\s*.*)?$/
const SELF_FIELD = /^\s+self\.([A-Za-z_]\w*)\s*:\s*([^=\n]+)/gmu
const DECORATOR = /^\s*@\s*([A-Za-z_][\w.]*)/
const CAP_NAME = /\b([A-Z][A-Za-z0-9_]*)\b/g
const CALL = /\b([A-Za-z_]\w*)\s*\(/g
const IMPORT = /^\s*import\s+(.+)$/
const FROM_IMPORT = /^\s*from\s+([.]*)([A-Za-z_][\w.]*)?\s+import\b/

const KEYWORDS = new Set([
  "and",
  "as",
  "assert",
  "async",
  "await",
  "break",
  "class",
  "continue",
  "def",
  "del",
  "elif",
  "else",
  "except",
  "finally",
  "for",
  "from",
  "global",
  "if",
  "import",
  "in",
  "is",
  "lambda",
  "nonlocal",
  "not",
  "or",
  "pass",
  "raise",
  "return",
  "try",
  "while",
  "with",
  "yield",
])
const CONSTANTS = new Set(["True", "False", "None"])

interface Header {
  text: string
  end: number
}

export class PythonAdapter implements Adapter {
  readonly language = "python"
  readonly extensions = [".py"] as const

  parse(file: string, root: string): Symbol[] {
    const text = readFileSync(file, "utf8")
    const lines = text.split("\n")
    const rel = relative(root, resolve(file))
    const declarations = topLevelDeclarations(lines)

    return declarations.map((declaration, index) => {
      const end = declarations[index + 1]?.start ?? lines.length
      const header = readHeader(lines, declaration.start, end)
      const decorators = decoratorsBefore(lines, declaration.start)
      const responsibility = docFirstLine(lines, header.end + 1, end, declaration.indent)

      if (declaration.kind === "class") {
        const body = parseClassBody(lines, header, end, declaration.indent)
        return {
          name: declaration.name,
          kind: classKind(header.text, decorators),
          file: rel,
          line: declaration.start + 1,
          is_public: !declaration.name.startsWith("_"),
          responsibility,
          fields: body.fields,
          methods: body.methods,
          relations: classRelations(declaration.name, header.text, body),
        }
      }

      const references = annotationNames(header.text)
      const segmentStart = decoratorStart(lines, declaration.start)
      const segment = lines.slice(segmentStart, end).join("\n")
      const uses = [...capitalNames(segment), ...callNames(segment)]
        .filter((name) => !references.includes(name))
        .filter((name) => name !== declaration.name)

      return {
        name: declaration.name,
        kind: functionKind(decorators),
        file: rel,
        line: declaration.start + 1,
        is_public: !declaration.name.startsWith("_"),
        responsibility,
        fields: [],
        methods: [],
        relations: relations([
          ...references.map((name): [string, string] => ["references", name]),
          ...uses.map((name): [string, string] => ["uses", name]),
        ]),
      }
    })
  }

  imports(file: string, root: string): ImportRef[] {
    const text = readFileSync(file, "utf8")
    const rel = relative(root, resolve(file))
    const parts = rel.split(/[\\/]/).slice(0, -1)
    const out: ImportRef[] = []

    for (const line of text.split("\n")) {
      const direct = IMPORT.exec(line)
      if (direct) {
        for (const alias of splitTopLevel(direct[1]!, ",")) {
          const name = alias
            .trim()
            .split(/\s+as\s+/, 1)[0]!
            .trim()
          if (name) out.push({ raw: name, from_file: rel, kind: "dotted" })
        }
        continue
      }

      const from = FROM_IMPORT.exec(line)
      if (!from?.[2]) continue
      const level = from[1]!.length
      if (level === 0) {
        out.push({ raw: from[2], from_file: rel, kind: "dotted" })
        continue
      }

      const drop = level - 1
      const base = drop < parts.length ? parts.slice(0, parts.length - drop) : []
      const dotted = [...base, from[2]].filter(Boolean).join(".")
      if (dotted) out.push({ raw: dotted, from_file: rel, kind: "dotted" })
    }

    return out
  }
}

function topLevelDeclarations(lines: string[]) {
  const out: { start: number; name: string; kind: "class" | "function"; indent: string }[] = []

  for (const [index, line] of lines.entries()) {
    const indent = leadingWhitespace(line)
    if (indent) continue

    const klass = CLASS.exec(line)
    if (klass) {
      out.push({ start: index, name: klass[1]!, kind: "class", indent })
      continue
    }

    const func = FUNCTION.exec(line)
    if (func) out.push({ start: index, name: func[1]!, kind: "function", indent })
  }

  return out
}

function parseClassBody(lines: string[], header: Header, end: number, classIndent: string) {
  const bodyStart = header.end + 1
  const bodyEnd = end
  const methodIndent = firstBodyIndent(lines, bodyStart, bodyEnd, classIndent)
  const fields: [string, string][] = []
  const methods: [string, string][] = []
  const references: string[] = []
  const uses: string[] = []

  if (methodIndent === undefined) return { fields, methods, references, uses }

  const methodStarts: number[] = []
  const methodHeaders = new Map<number, Header>()
  for (let index = bodyStart; index < bodyEnd; index++) {
    const line = lines[index]!
    if (!line.trim() || line.trimStart().startsWith("#")) continue
    if (leadingWhitespace(line) !== methodIndent || !METHOD.test(line.trim())) continue
    methodStarts.push(index)
    methodHeaders.set(index, readHeader(lines, index, bodyEnd))
  }

  for (let index = bodyStart; index < bodyEnd; index++) {
    const line = lines[index]!
    if (!line.trim() || line.trimStart().startsWith("#")) continue
    if (leadingWhitespace(line) !== methodIndent) continue

    const methodHeader = methodHeaders.get(index)
    if (methodHeader) {
      const name = METHOD.exec(line.trim())?.[1]
      if (!name) continue

      const stop = methodBodyEnd(lines, methodHeader.end + 1, bodyEnd, methodIndent)
      methods.push([name, renderSignature(methodHeader.text, name)])
      references.push(...annotationNames(methodHeader.text))
      uses.push(...capitalNames(lines.slice(index, stop).join("\n")).filter((item) => item !== name))
      uses.push(...callNames(lines.slice(index, stop).join("\n")))

      if (name === "__init__") {
        const body = lines.slice(methodHeader.end + 1, stop).join("\n")
        for (const match of body.matchAll(SELF_FIELD)) fields.push([match[1]!, match[2]!.trim()])
      }
      continue
    }

    if (methodStarts.some((start) => start < index && index <= methodHeaders.get(start)!.end)) continue
    if (line.trimStart().startsWith("@") || METHOD.test(line.trim())) continue

    const field = CLASS_FIELD.exec(line.trim())
    if (!field) continue
    fields.push([field[1]!, field[2]!.trim()])
    references.push(...capitalNames(field[2]!))
  }

  return {
    fields: dedupePairs(fields).filter(([name]) => name !== "self"),
    methods: dedupePairs(methods),
    references: unique(references),
    uses: unique(uses),
  }
}

function classRelations(
  ownName: string,
  header: string,
  body: { references: string[]; uses: string[] },
): [string, string][] {
  const bases = basesOf(header)
  const references = new Set(body.references)
  const items: [string, string][] = bases.map((name) => ["extends", name])

  for (const name of body.references) items.push(["references", name])
  for (const name of body.uses) {
    if (!references.has(name) && name !== ownName) items.push(["uses", name])
  }

  return relations(items)
}

function classKind(header: string, decorators: string[]): string {
  const bases = new Set(basesOf(header))
  const mods = new Set(decorators)

  if (bases.has("Enum") || bases.has("IntEnum") || bases.has("StrEnum")) return "enum"
  if (bases.has("NamedTuple")) return "record"
  if (bases.has("TypedDict")) return "type"
  if (bases.has("Protocol")) return "interface"
  if (bases.has("BaseModel") || ["dataclass", "define", "attrs", "frozen", "s"].some((name) => mods.has(name))) {
    return "entity"
  }
  return "class"
}

function functionKind(decorators: string[]): string {
  const values = new Set(decorators)
  if (values.has("middleware")) return "middleware"
  if (
    ["get", "post", "put", "patch", "delete", "head", "options", "route", "websocket"].some((name) => values.has(name))
  ) {
    return "route"
  }
  if (["task", "shared_task", "periodic_task", "job", "scheduled_job"].some((name) => values.has(name))) return "job"
  return "function"
}

function basesOf(header: string): string[] {
  const open = header.indexOf("(")
  if (open === -1) return []
  const close = matchingParen(header, open)
  if (close === -1) return []

  return splitTopLevel(header.slice(open + 1, close), ",")
    .map((part) => nameOf(part.trim()))
    .filter(Boolean)
}

function nameOf(value: string): string {
  const call = value.indexOf("(")
  const name = (call === -1 ? value : value.slice(0, call)).trim()
  return name.split(".").at(-1)?.trim() ?? ""
}

function annotationNames(header: string): string[] {
  const open = header.indexOf("(")
  if (open === -1) return []
  const close = matchingParen(header, open)
  if (close === -1) return []

  const out: string[] = []
  for (const parameter of splitTopLevel(header.slice(open + 1, close), ",")) {
    const withoutDefault = splitTopLevel(parameter, "=")[0] ?? ""
    const colon = withoutDefault.indexOf(":")
    if (colon === -1) continue
    out.push(...capitalNames(withoutDefault.slice(colon + 1)))
  }

  const rest = header.slice(close + 1)
  const arrow = rest.indexOf("->")
  if (arrow !== -1) {
    const annotation = rest
      .slice(arrow + 2)
      .replace(/:\s*$/, "")
      .trim()
    out.push(...capitalNames(annotation))
  }

  return unique(out)
}

function renderSignature(header: string, name: string): string {
  const open = header.indexOf("(")
  const close = open === -1 ? -1 : matchingParen(header, open)
  if (open === -1 || close === -1) return `${name}()`

  const args = splitTopLevel(header.slice(open + 1, close), ",")
    .map((part) => part.trim())
    .filter(Boolean)
  const first = args[0]?.split(/[:=]/, 1)[0]?.trim()
  if (first === "self" || first === "cls") args.shift()

  const formatted = args.map(formatParameter)
  const rest = header.slice(close + 1)
  const arrow = rest.indexOf("->")
  const returns =
    arrow === -1
      ? ""
      : rest
          .slice(arrow + 2)
          .replace(/:\s*$/, "")
          .trim()

  return `${name}(${formatted.join(", ")})${returns ? ` -> ${returns}` : ""}`
}

function formatParameter(parameter: string): string {
  const parts = splitTopLevel(parameter, "=")
  const left = parts[0]!.trim().replace(/^([^:]+):\s*/, "$1: ")
  if (parts.length === 1) return left
  return `${left} = ${parts.slice(1).join("=").trim()}`
}

function capitalNames(text: string): string[] {
  return Array.from(text.matchAll(CAP_NAME), (match) => match[1]!)
    .filter((name) => !CONSTANTS.has(name))
    .filter((name) => !KEYWORDS.has(name))
}

function callNames(text: string): string[] {
  const out: string[] = []
  for (const line of text.split("\n")) {
    if (/^\s*(?:async\s+)?def\s+/.test(line) || /^\s*class\s+/.test(line)) continue
    for (const match of line.matchAll(CALL)) {
      const name = match[1]!
      if (!KEYWORDS.has(name)) out.push(name)
    }
  }
  return out
}

function dedupePairs(items: [string, string][]): [string, string][] {
  const seen = new Set<string>()
  return items.filter(([name, value]) => {
    if (!name || seen.has(name)) return false
    seen.add(name)
    return Boolean(value)
  })
}

function relations(items: [string, string][]): [string, string][] {
  const seen = new Set<string>()
  return items.filter(([kind, target]) => {
    const key = `${kind}\0${target}`
    if (!kind || !target || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function unique(items: string[]): string[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    if (!item || seen.has(item)) return false
    seen.add(item)
    return true
  })
}

function decoratorsBefore(lines: string[], start: number): string[] {
  const out: string[] = []
  for (let index = start - 1; index >= 0; index--) {
    const match = DECORATOR.exec(lines[index]!)
    if (!match) break
    out.unshift(match[1]!.split(".").at(-1)!)
  }
  return out
}

function decoratorStart(lines: string[], start: number): number {
  let first = start
  for (let index = start - 1; index >= 0; index--) {
    if (!DECORATOR.test(lines[index]!)) break
    first = index
  }
  return first
}

function docFirstLine(lines: string[], start: number, end: number, classIndent: string): string {
  for (let index = start; index < end; index++) {
    const line = lines[index]!
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    if (leadingWhitespace(line).length <= classIndent.length) return ""

    const match = /^[rRuUbBfF]{0,2}("""|''')/.exec(trimmed)
    if (!match) return ""
    const quote = match[1]!
    const body = trimmed.slice(match[0].length)
    const close = body.indexOf(quote)
    if (close !== -1) return firstLine(body.slice(0, close))
    return firstLine(
      lines
        .slice(index + 1, end)
        .join("\n")
        .split(quote, 1)[0]!,
    )
  }
  return ""
}

function firstLine(text: string): string {
  for (const line of text.split("\n")) {
    const value = line.trim()
    if (value) return value
  }
  return ""
}

function firstBodyIndent(lines: string[], start: number, end: number, classIndent: string): string | undefined {
  for (let index = start; index < end; index++) {
    const line = lines[index]!
    if (!line.trim() || line.trimStart().startsWith("#")) continue
    const indent = leadingWhitespace(line)
    if (indent.length > classIndent.length) return indent
    return undefined
  }
  return undefined
}

function methodBodyEnd(lines: string[], start: number, end: number, methodIndent: string): number {
  for (let index = start; index < end; index++) {
    const line = lines[index]!
    if (!line.trim() || line.trimStart().startsWith("#")) continue
    if (leadingWhitespace(line).length <= methodIndent.length) return index
  }
  return end
}

function readHeader(lines: string[], start: number, end: number): Header {
  let text = lines[start] ?? ""
  let index = start

  while (index + 1 < end && !headerComplete(text)) {
    index += 1
    text += `\n${lines[index] ?? ""}`
  }

  return { text, end: index }
}

function headerComplete(text: string): boolean {
  const open = text.indexOf("(")
  if (open === -1) return text.trimEnd().endsWith(":")
  const close = matchingParen(text, open)
  return close !== -1 && text.slice(close + 1).includes(":")
}

function matchingParen(text: string, open: number): number {
  let depth = 0
  let quote = ""

  for (let index = open; index < text.length; index++) {
    const char = text[index]!
    if (quote) {
      if (char === "\\") index += 1
      else if (char === quote) quote = ""
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === "(") depth += 1
    else if (char === ")") {
      depth -= 1
      if (depth === 0) return index
    }
  }

  return -1
}

function splitTopLevel(text: string, separator: string): string[] {
  const out: string[] = []
  let current = ""
  let depth = 0
  let quote = ""

  for (let index = 0; index < text.length; index++) {
    const char = text[index]!
    if (quote) {
      current += char
      if (char === "\\") {
        current += text[index + 1] ?? ""
        index += 1
      } else if (char === quote) quote = ""
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      current += char
      continue
    }
    if (char === "(" || char === "[" || char === "{") depth += 1
    else if (char === ")" || char === "]" || char === "}") depth -= 1

    if (char === separator && depth === 0) {
      out.push(current)
      current = ""
      continue
    }
    current += char
  }

  out.push(current)
  return out
}

function leadingWhitespace(line: string): string {
  return /^[ \t]*/.exec(line)?.[0] ?? ""
}
