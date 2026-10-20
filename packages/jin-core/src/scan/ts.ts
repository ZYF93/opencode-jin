import { readFileSync } from "node:fs"
import { resolve, relative } from "node:path"
import type { Adapter, ImportRef, Symbol } from "./base"

/**
 * TypeScript / JavaScript adapter, matching the original Jin regex scanner.
 * It is intentionally declaration-level and approximate; the scanner upgrade can
 * replace it with a syntax tree without changing the drift contract.
 */

const DECL = new RegExp(
  "^(?<indent>[ \\t]*)(?:export\\s+)?(?:default\\s+)?(?:declare\\s+)?(?:abstract\\s+)?" +
    "(?<kind>class|interface|enum|type)\\s+(?<name>[A-Za-z_$][\\w$]*)",
  "gm",
)
const FUNC = new RegExp(
  "^(?<indent>[ \\t]*)(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?function\\s+(?<name>[A-Za-z_$][\\w$]*)",
  "gm",
)
const ARROW = new RegExp(
  "^(?<indent>[ \\t]*)(?:export\\s+)?(?:const|let|var)\\s+(?<name>[A-Za-z_$][\\w$]*)\\s*=\\s*(?:async\\s*)?(?:\\(|function\\b)",
  "gm",
)
const IMPORT = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"](?<path>\.{1,2}\/[^'"]+)['"]/g
const FACTORY = new RegExp(
  "^(?<indent>[ \\t]*)(?:export\\s+)?(?:const|let|var)\\s+(?<name>[A-Za-z_$][\\w$]*)\\s*=\\s*" +
    "(?<factory>createSlice|createStore|defineStore|createReducer|createApi|createEntityAdapter)\\s*\\(",
  "gm",
)

const KIND_MAP: Record<string, string> = { class: "class", interface: "interface", enum: "enum", type: "type" }
const PAGE_DIRS = new Set(["pages", "views", "routes"])
const COMPONENT_DIRS = new Set(["components", "ui", "widgets"])

const METHOD = new RegExp(
  "^\\s*(?:(?:public|private|protected|static|async|readonly|get|set|override|declare)\\s+)*" +
    "(?<name>[A-Za-z_$][\\w$]*)\\s*\\((?<args>[^)]*)\\)\\s*(?::\\s*(?<ret>[^{\\n]+))?",
)
const FIELD = new RegExp(
  "^\\s*(?:(?:public|private|protected|static|readonly|declare)\\s+)*" +
    "(?<name>[A-Za-z_$][\\w$]*)\\s*\\??\\s*:\\s*(?<type>[^;\\n=}]+)",
)
const EXTENDS = /\bclass\s+[A-Za-z_$][\w$]*[^{;]*?\bextends\s+([A-Za-z_$][\w$.]*)/gs
const IMPLEMENTS = /\b(?:class|interface)\s+[A-Za-z_$][\w$]*[^{;]*?\bimplements\s+([^{]+)/gs
const JSX = /(?<![\w$])<\s*([A-Z][\w$]*)/g
const HOOK = /\b(use[A-Z][\w$]*)\s*\(/g
const CALL = /\b([A-Za-z_$][\w$]*)\s*\(/g
const TYPE_REF = /\b([A-Z][\w$]*)\b/g

const KEYWORDS = new Set([
  "if",
  "for",
  "while",
  "switch",
  "catch",
  "return",
  "function",
  "await",
  "new",
  "typeof",
  "constructor",
  "super",
  "this",
  "import",
  "export",
  "const",
  "let",
  "var",
])

export class TypeScriptAdapter implements Adapter {
  readonly language = "typescript"
  readonly extensions = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"] as const

  parse(file: string, root: string): Symbol[] {
    const text = readFileSync(file, "utf8")
    const rel = relative(root, resolve(file))
    const declarations: { start: number; name: string; kind: string }[] = []

    for (const match of text.matchAll(DECL)) {
      if (match.groups?.indent) continue
      declarations.push({
        start: match.index!,
        name: match.groups!.name!,
        kind: KIND_MAP[match.groups!.kind!]!,
      })
    }
    for (const pattern of [FUNC, ARROW]) {
      for (const match of text.matchAll(pattern)) {
        if (match.groups?.indent) continue
        declarations.push({
          start: match.index!,
          name: match.groups!.name!,
          kind: functionKind(match.groups!.name!, rel),
        })
      }
    }
    for (const match of text.matchAll(FACTORY)) {
      if (match.groups?.indent) continue
      declarations.push({ start: match.index!, name: match.groups!.name!, kind: "store" })
    }

    declarations.sort((left, right) => left.start - right.start)
    const seen = new Set<string>()
    const unique = declarations.filter((declaration) => {
      if (seen.has(declaration.name)) return false
      seen.add(declaration.name)
      return true
    })

    return unique.map((declaration, index) => {
      const end = unique[index + 1]?.start ?? text.length
      const segment = text.slice(declaration.start, end)
      const [fields, methods] =
        declaration.kind === "class" || declaration.kind === "interface" || declaration.kind === "type"
          ? members(segment)
          : [[], []]

      return {
        name: declaration.name,
        kind: declaration.kind,
        file: rel,
        line: text.slice(0, declaration.start).split("\n").length,
        is_public: isExported(text, declaration.start),
        responsibility: jsdocBefore(text, declaration.start),
        fields,
        methods,
        relations: relations(segment, declaration.name, fields),
      }
    })
  }

  imports(file: string, root: string): ImportRef[] {
    const text = readFileSync(file, "utf8")
    const from_file = relative(root, resolve(file))

    return Array.from(text.matchAll(IMPORT), (match) => ({
      raw: match.groups!.path!,
      from_file,
      kind: "path" as const,
    }))
  }
}

function functionKind(name: string, rel: string): string {
  if (name.length > 3 && name.startsWith("use") && name[3] === name[3]!.toUpperCase()) return "hook"

  const dirs = new Set(
    rel
      .split("/")
      .slice(0, -1)
      .map((part) => part.toLowerCase()),
  )
  const pascal = name[0] === name[0]!.toUpperCase()
  const jsx = rel.endsWith(".tsx") || rel.endsWith(".jsx")
  if (pascal && jsx && intersects(dirs, PAGE_DIRS)) return "page"
  if (pascal && (jsx || intersects(dirs, COMPONENT_DIRS))) return "component"
  return "function"
}

function intersects(left: Set<string>, right: Set<string>): boolean {
  return [...left].some((value) => right.has(value))
}

function members(segment: string): [[string, string][], [string, string][]] {
  const fields: [string, string][] = []
  const methods: [string, string][] = []
  let started = false
  let depth = 0

  for (const line of segment.split("\n")) {
    if (!started) {
      if (!line.includes("{")) continue
      started = true
      depth = braceDelta(line)
      continue
    }

    if (depth === 1) {
      const method = METHOD.exec(line)
      if (method && !KEYWORDS.has(method.groups!.name!)) {
        const args = method.groups!.args!.trim()
        const ret = (method.groups!.ret ?? "").trim()
        methods.push([method.groups!.name!, `${method.groups!.name}(${args})${ret ? `: ${ret}` : ""}`])
      } else {
        const field = FIELD.exec(line)
        if (field && !KEYWORDS.has(field.groups!.name!)) {
          fields.push([field.groups!.name!, field.groups!.type!.trim()])
        }
      }
    }

    depth += braceDelta(line)
    if (depth < 0) depth = 0
  }

  return [dedupePairs(fields), dedupePairs(methods)]
}

function relations(segment: string, ownName: string, fields: [string, string][]): [string, string][] {
  const items: [string, string][] = []

  const extended = EXTENDS.exec(segment)
  if (extended?.[1]) items.push(["extends", stripGeneric(extended[1])])

  const implemented = IMPLEMENTS.exec(segment)
  if (implemented?.[1]) {
    for (const part of implemented[1].split(",")) {
      const name = stripGeneric(part.trim())
      if (name) items.push(["implements", name])
    }
  }

  for (const match of segment.matchAll(JSX)) items.push(["renders", match[1]!])
  for (const match of segment.matchAll(HOOK)) items.push(["uses", match[1]!])
  for (const match of segment.matchAll(CALL)) {
    if (!KEYWORDS.has(match[1]!)) items.push(["uses", match[1]!])
  }
  for (const [, type] of fields) {
    for (const match of type.matchAll(TYPE_REF)) items.push(["references", match[1]!])
  }

  const seen = new Set<string>()
  return items.filter(([kind, target]) => {
    const key = `${kind}\0${target}`
    if (!target || target === ownName || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function stripGeneric(name: string): string {
  return name.split("<", 1)[0]!.trim().split(".").at(-1)!.trim()
}

function dedupePairs(items: [string, string][]): [string, string][] {
  const seen = new Set<string>()
  return items.filter(([name]) => {
    if (!name || seen.has(name)) return false
    seen.add(name)
    return true
  })
}

function isExported(text: string, start: number): boolean {
  const lineStart = text.lastIndexOf("\n", start - 1) + 1
  return text
    .slice(lineStart, text.indexOf("\n", start) === -1 ? text.length : text.indexOf("\n", start))
    .includes("export")
}

function jsdocBefore(text: string, start: number): string {
  const prefix = text.slice(0, start).trimEnd()
  if (!prefix.endsWith("*/")) return ""

  const begin = prefix.lastIndexOf("/**")
  if (begin === -1) return ""

  const block = prefix.slice(begin + 3, -2)
  for (const raw of block.split("\n")) {
    const line = raw.trim().replace(/^\*+/, "").trim()
    if (line && !line.startsWith("@")) return line
  }
  return ""
}

function braceDelta(line: string): number {
  return (line.match(/\{/g)?.length ?? 0) - (line.match(/\}/g)?.length ?? 0)
}
