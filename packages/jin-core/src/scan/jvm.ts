import { readFileSync } from "node:fs"
import { basename, relative, resolve } from "node:path"
import type { Adapter, ImportRef, Symbol } from "./base"

const JAVA_DECL = new RegExp(
  "^(?<indent>[ \\t]*)(?:(?:public|protected|private)\\s+)?" +
    "(?:(?:static|final|abstract|sealed|non-sealed|strictfp)\\s+)*" +
    "(?<kind>class|interface|enum|record|@interface)\\s+(?<name>[A-Za-z_$][\\w$]*)",
  "gm",
)

const KOTLIN_DECL = new RegExp(
  "^(?<indent>[ \\t]*)(?<mods>(?:(?:public|internal|private|protected|open|abstract|sealed|data|value|inline|inner|enum|annotation|companion)\\s+)*)" +
    "(?<kind>class|interface|object)\\s+(?<name>[A-Za-z_]\\w*)",
  "gm",
)

const KOTLIN_FUN = new RegExp(
  "^(?<indent>[ \\t]*)(?<mods>(?:(?:public|internal|private|protected|open|override|suspend|inline|infix|operator|external|tailrec|const)\\s+)*)" +
    "fun\\s+(?:<[^>]+>\\s*)?(?<name>[A-Za-z_]\\w*)",
  "gm",
)

export class JavaAdapter implements Adapter {
  readonly language = "java"
  readonly extensions = [".java"] as const

  parse(file: string, root: string): Symbol[] {
    const text = readFileSync(file, "utf8")
    const rel = relative(root, resolve(file))
    const stem = basename(file).replace(/\.[^.]+$/, "")
    const out: Symbol[] = []
    const seen = new Set<string>()

    for (const match of text.matchAll(JAVA_DECL)) {
      if (match.groups?.indent) continue
      const name = match.groups!.name!
      if (seen.has(name)) continue
      seen.add(name)

      const line = lineAt(text, match.index)
      out.push({
        name,
        kind: match.groups!.kind === "@interface" ? "class" : match.groups!.kind!,
        file: rel,
        line,
        is_public: lineText(text, match.index).includes("public") || name === stem,
        responsibility: javadocBefore(text, match.index),
        fields: [],
        methods: [],
        relations: [],
      })
    }

    return out
  }

  imports(_file: string, _root: string): ImportRef[] {
    return []
  }
}

export class KotlinAdapter implements Adapter {
  readonly language = "kotlin"
  readonly extensions = [".kt", ".kts"] as const

  parse(file: string, root: string): Symbol[] {
    const text = readFileSync(file, "utf8")
    const rel = relative(root, resolve(file))
    const out: Symbol[] = []
    const seen = new Set<string>()

    for (const match of text.matchAll(KOTLIN_DECL)) {
      if (match.groups?.indent) continue
      const name = match.groups!.name!
      if (seen.has(name)) continue
      seen.add(name)

      const mods = new Set(match.groups!.mods!.split(/\s+/).filter(Boolean))
      out.push({
        name,
        kind: kotlinKind(match.groups!.kind!, mods),
        file: rel,
        line: lineAt(text, match.index),
        is_public: !mods.has("private") && !mods.has("internal"),
        responsibility: javadocBefore(text, match.index),
        fields: [],
        methods: [],
        relations: [],
      })
    }

    for (const match of text.matchAll(KOTLIN_FUN)) {
      if (match.groups?.indent) continue
      const name = match.groups!.name!
      if (seen.has(name)) continue
      seen.add(name)

      const mods = new Set(match.groups!.mods!.split(/\s+/).filter(Boolean))
      out.push({
        name,
        kind: "function",
        file: rel,
        line: lineAt(text, match.index),
        is_public: !mods.has("private") && !mods.has("internal"),
        responsibility: "",
        fields: [],
        methods: [],
        relations: [],
      })
    }

    return out
  }

  imports(_file: string, _root: string): ImportRef[] {
    return []
  }
}

function kotlinKind(kind: string, mods: Set<string>): string {
  if (kind === "class" && mods.has("data")) return "entity"
  return kind
}

function lineAt(text: string, index: number): number {
  return text.slice(0, index).split("\n").length
}

function lineText(text: string, index: number): string {
  const start = text.lastIndexOf("\n", index - 1) + 1
  const end = text.indexOf("\n", index)
  return text.slice(start, end === -1 ? text.length : end)
}

function javadocBefore(text: string, index: number): string {
  const prefix = text.slice(0, index).trimEnd()
  if (!prefix.endsWith("*/")) return ""

  const start = prefix.lastIndexOf("/**")
  if (start === -1) return ""

  for (const raw of prefix.slice(start + 3, -2).split("\n")) {
    const line = raw.trim().replace(/^\*+/, "").trim()
    if (line && !line.startsWith("@")) return line
  }
  return ""
}
