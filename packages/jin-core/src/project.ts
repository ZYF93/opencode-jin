import { existsSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { JinError } from "./error"
import { loadArchDir } from "./model"
import type { Arch } from "./types"
import { loadYaml } from "./yaml"

export const DEFAULT_IGNORE = [
  ".git",
  "node_modules",
  "dist",
  "build",
  "out",
  "target",
  ".venv",
  "venv",
  "__pycache__",
  ".tox",
  ".idea",
  ".gradle",
  ".next",
  "coverage",
  ".jin",
]

export interface ScanConfig {
  roots: string[]
  ignore: string[]
  exclude_tests: boolean
}

export interface JinConfig {
  languages: string[]
  scan: ScanConfig
  view_port: number
  strict: boolean
}

function record(value: unknown, where: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new JinError(`${where}: 顶层必须是映射`)
  return value as Record<string, unknown>
}

function stringArray(value: unknown, where: string): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new JinError(`${where} 必须是数组`)
  return value.map((item, index) => {
    if (typeof item !== "string") throw new JinError(`${where}[${index}] 必须是字符串`)
    return item
  })
}

function booleanValue(value: unknown, fallback: boolean, where: string): boolean {
  if (value === undefined) return fallback
  if (typeof value !== "boolean") throw new JinError(`${where} 必须是布尔值`)
  return value
}

function intValue(value: unknown, fallback: number, where: string): number {
  if (value === undefined) return fallback
  if (typeof value === "number" && Number.isInteger(value)) return value
  if (typeof value === "string" && /^-?\d+$/.test(value)) return Number(value)
  throw new JinError(`${where} 必须是整数`)
}

export function loadConfig(root: string): JinConfig {
  const path = join(root, "jin.yaml")

  if (!existsSync(path)) {
    return {
      languages: [],
      scan: { roots: [], ignore: [], exclude_tests: true },
      view_port: 0,
      strict: false,
    }
  }

  const data = record(loadYaml(path) ?? {}, path)
  const allowed = ["languages", "scan", "view_port", "strict"]
  const unknown = Object.keys(data).filter((key) => !allowed.includes(key))

  if (unknown.length) {
    throw new JinError(
      `${path}: 未知字段 ${JSON.stringify(unknown.sort())}；允许: ${JSON.stringify([...allowed].sort())}`,
    )
  }

  const scanData = data.scan === undefined || data.scan === null ? {} : record(data.scan, `${path}.scan`)
  const scanAllowed = ["roots", "ignore", "exclude_tests"]
  const scanUnknown = Object.keys(scanData).filter((key) => !scanAllowed.includes(key))

  if (scanUnknown.length) {
    throw new JinError(
      `${path}: scan 未知字段 ${JSON.stringify(scanUnknown.sort())}；允许: ${JSON.stringify([...scanAllowed].sort())}`,
    )
  }

  return {
    languages: stringArray(data.languages, `${path}.languages`),
    scan: {
      roots: stringArray(scanData.roots, `${path}.scan.roots`),
      ignore: stringArray(scanData.ignore, `${path}.scan.ignore`),
      exclude_tests: booleanValue(scanData.exclude_tests, true, `${path}.scan.exclude_tests`),
    },
    view_port: intValue(data.view_port, 0, `${path}.view_port`),
    strict: booleanValue(data.strict, false, `${path}.strict`),
  }
}

/** Find the closest ancestor with arch/L0.yaml or jin.yaml, falling back to the nearest .git root. */
export function findRoot(start = process.cwd()): string {
  let current = resolve(start)
  let candidate: string | undefined

  while (candidate !== current) {
    candidate = current

    if (existsSync(join(current, "arch", "L0.yaml")) || existsSync(join(current, "jin.yaml"))) return current

    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }

  current = resolve(start)

  while (true) {
    if (existsSync(join(current, ".git"))) return current
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }

  return resolve(start)
}

export class Project {
  readonly root: string
  readonly config: JinConfig

  constructor(root: string) {
    this.root = resolve(root)
    this.config = loadConfig(this.root)
  }

  get archDir(): string {
    return join(this.root, "arch")
  }

  get proposalsDir(): string {
    return join(this.archDir, "proposals")
  }

  get historyDir(): string {
    return join(this.archDir, "history")
  }

  hasArch(): boolean {
    return existsSync(join(this.archDir, "L0.yaml"))
  }

  loadArch(): Arch {
    return loadArchDir(this.archDir)
  }

  ensureArch(): Arch {
    if (!this.hasArch()) {
      throw new JinError(`${this.root} 还没有架构（arch/L0.yaml 不存在）。先运行: jin bootstrap / jin new`)
    }

    return this.loadArch()
  }

  rel(path: string): string {
    return relative(this.root, resolve(path))
  }
}
