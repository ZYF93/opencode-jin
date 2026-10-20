import { existsSync, readdirSync, statSync } from "node:fs"
import { isAbsolute, join, relative, resolve } from "node:path"
import { DEFAULT_IGNORE, type Project } from "./project"
import { ADAPTERS, EXT_LANG, isTestPath } from "./scan"
import type { Adapter } from "./scan"

export interface DriftIssue {
  level: "error" | "warning" | "info"
  code: string
  message: string
  module: string
  entity: string
  file: string
}

export interface DriftReport {
  issues: DriftIssue[]
  checked_entities: number
  checked_files: number
  errors: number
  warnings: number
}

export function checkDrift(project: Project): DriftReport {
  const arch = project.ensureArch()
  const report: DriftReport = { issues: [], checked_entities: 0, checked_files: 0, errors: 0, warnings: 0 }
  const cache = new Map<string, Set<string> | null>()
  const registered = new Set<string>()

  for (const l1 of Object.values(arch.l1)) {
    for (const entity of l1.entities) registered.add(`${entity.location.file}\0${entity.location.symbol}`)
  }

  for (const [moduleID, l1] of Object.entries(arch.l1)) {
    for (const entity of l1.entities) {
      if (entity.status === "deprecated") continue

      report.checked_entities += 1
      const names = parseSymbols(project, entity.location.file, cache)
      if (!names) {
        if (!existsSync(join(project.root, entity.location.file))) {
          report.issues.push({
            level: "error",
            code: "location-missing",
            message: `实体 ${entity.id} 的定位文件不存在: ${entity.location.file}`,
            module: moduleID,
            entity: entity.id,
            file: entity.location.file,
          })
        } else {
          report.issues.push({
            level: "warning",
            code: "no-adapter",
            message: `实体 ${entity.id} 的定位文件无法解析（无适配器或语法错误）: ${entity.location.file}`,
            module: moduleID,
            entity: entity.id,
            file: entity.location.file,
          })
        }
        continue
      }

      const found = names.has(entity.location.symbol)
      if (entity.status === "active" && !found) {
        report.issues.push({
          level: "error",
          code: "symbol-missing",
          message: `实体 ${entity.id} 的符号 ${entity.location.symbol} 未在 ${entity.location.file} 中找到`,
          module: moduleID,
          entity: entity.id,
          file: entity.location.file,
        })
      } else if (entity.status === "planned" && found) {
        report.issues.push({
          level: "info",
          code: "planned-present",
          message: `实体 ${entity.id} 标记为 planned，但符号已存在；可考虑将 arch 中 status 翻为 active`,
          module: moduleID,
          entity: entity.id,
          file: entity.location.file,
        })
      }
    }
  }

  for (const module of arch.l0.modules) {
    if (module.status !== "active") continue

    const directory = join(project.root, module.path)
    if (!existsSync(directory)) {
      report.issues.push({
        level: "error",
        code: "module-path-missing",
        message: `模块 ${module.id} 的 path 不存在: ${module.path}`,
        module: module.id,
        entity: "",
        file: module.path,
      })
      continue
    }

    const files = statSync(directory).isFile() ? [directory] : walkSourceFiles(project, directory)
    for (const file of files) {
      const rel = relative(project.root, file)
      report.checked_files += 1
      const names = parseSymbols(project, rel, cache)
      if (!names) continue

      for (const name of [...names].sort()) {
        if (registered.has(`${rel}\0${name}`)) continue
        report.issues.push({
          level: "warning",
          code: "symbol-unregistered",
          message: `代码中有未登记到 L1 的对外符号: ${name} (${rel})`,
          module: module.id,
          entity: "",
          file: rel,
        })
      }
    }
  }

  for (const [moduleID, l1] of Object.entries(arch.l1)) {
    const module = arch.l0.modules.find((item) => item.id === moduleID)
    if (!module) continue

    const moduleDir = resolve(project.root, module.path)
    if (!existsSync(moduleDir)) continue

    for (const entity of l1.entities) {
      if (entity.status === "deprecated") continue
      const file = resolve(project.root, entity.location.file)
      if (isInside(moduleDir, file)) continue
      report.issues.push({
        level: "warning",
        code: "location-outside-module",
        message: `实体 ${entity.id} 的定位文件在模块 path 之外: ${entity.location.file}`,
        module: moduleID,
        entity: entity.id,
        file: entity.location.file,
      })
    }
  }

  report.errors = report.issues.filter((issue) => issue.level === "error").length
  report.warnings = report.issues.filter((issue) => issue.level === "warning").length
  return report
}

function parseSymbols(project: Project, path: string, cache: Map<string, Set<string> | null>): Set<string> | null {
  const cached = cache.get(path)
  if (cached !== undefined) return cached

  const full = join(project.root, path)
  const adapter: Adapter | undefined = ADAPTERS[EXT_LANG[full.slice(full.lastIndexOf("."))] ?? ""]
  if (!adapter || !existsSync(full)) {
    cache.set(path, null)
    return null
  }

  try {
    const names = new Set(adapter.parse(full, project.root).map((symbol) => symbol.name))
    cache.set(path, names)
    return names
  } catch {
    const names = new Set<string>()
    cache.set(path, names)
    return names
  }
}

function walkSourceFiles(project: Project, directory: string): string[] {
  const files: string[] = []
  const extraIgnore = new Set(project.config.scan.ignore.map((path) => path.replace(/\/+$/, "")))

  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      if (entry.isDirectory()) {
        if (DEFAULT_IGNORE.includes(entry.name) || extraIgnore.has(entry.name) || entry.name.startsWith(".")) {
          continue
        }
        walk(join(current, entry.name))
        continue
      }
      if (!entry.isFile()) continue

      const file = resolve(current, entry.name)
      const extension = file.slice(file.lastIndexOf("."))
      if (!EXT_LANG[extension]) continue
      if (project.config.scan.exclude_tests && isTestPath(relative(project.root, file))) continue
      files.push(file)
    }
  }

  walk(directory)
  return files
}

function isInside(directory: string, file: string): boolean {
  const rel = relative(directory, file)
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))
}
