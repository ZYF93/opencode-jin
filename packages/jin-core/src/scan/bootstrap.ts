import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { systemToDict } from "../model"
import { DEFAULT_IGNORE, type Project } from "../project"
import {
  ENTITY_KINDS,
  KIND_PREFIX,
  RELATION_TYPES,
  type Arch,
  type Entity,
  type EntityKind,
  type FieldSpec,
  type L0,
  type L1,
  type MethodSpec,
  type ModuleInfo,
  type PackageInfo,
  type ProjectInfo,
  type Relation,
  type RelationType,
  type SystemInfo,
  type SystemKind,
} from "../types"
import type { ImportRef, Symbol } from "./base"
import { slugify } from "./base"
import { ADAPTERS, EXT_LANG, TEST_DIRS, isTestPath } from "./registry"

const SYSTEM_MANIFESTS = [
  "package.json",
  "pyproject.toml",
  "setup.py",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "go.mod",
  "Cargo.toml",
]

const FRONTEND_DEPS = new Set([
  "react",
  "react-dom",
  "vue",
  "svelte",
  "next",
  "nuxt",
  "@angular/core",
  "preact",
  "solid-js",
  "astro",
])
const PYTHON_BACKEND = ["fastapi", "flask", "django", "starlette", "aiohttp", "tornado", "sanic"]
const PYTHON_WORKER = ["celery", "dramatiq", "rq", "arq"]
const PYTHON_CLI = ["click", "typer", "argparse", "fire"]
const DEFAULT_IGNORE_SET = new Set(DEFAULT_IGNORE)

export interface ScanModuleReport {
  id: string
  path: string
  files: number
  entities: number
}

export interface ScanReport {
  roots: string[]
  languages: string[]
  systems: Record<string, unknown>[]
  modules: ScanModuleReport[]
  entity_count: number
  skipped_files: string[]
  skipped_dirs: string[]
  deps: Record<string, string[]>
  notes: string[]
}

interface EntityMeta {
  moduleDir: string
  name: string
  kind: EntityKind
}

interface SystemCandidate {
  path: string
  kind: SystemKind
}

export function detectRoots(project: Project): string[] {
  if (project.config.scan.roots.length) return [...project.config.scan.roots]

  const deep = ["src/main/java", "src/main/kotlin"].filter((path) => {
    const directory = join(project.root, path)
    return isDirectory(directory) && hasSources(directory)
  })
  if (deep.length) return deep

  const candidates = ["src", "lib", "app", "apps", "packages", "services", "cmd", "internal"]
  const found = candidates.filter((path) => {
    const directory = join(project.root, path)
    return isDirectory(directory) && hasSources(directory)
  })
  return found.length ? found : ["."]
}

export function scanProject(project: Project, languages?: string[]): { arch: Arch; report: ScanReport } {
  const report: ScanReport = {
    roots: [],
    languages: [],
    systems: [],
    modules: [],
    entity_count: 0,
    skipped_files: [],
    skipped_dirs: [],
    deps: {},
    notes: [],
  }
  const roots = detectRoots(project)
  report.roots = roots

  const allFiles = uniqueSorted(
    roots.flatMap((root) => {
      const path = resolve(project.root, root)
      if (!existsSync(path)) return []
      if (statSync(path).isFile()) return EXT_LANG[extname(path)] ? [path] : []
      return collectFiles(path, project, report)
    }),
  )

  const present = new Set(allFiles.flatMap((file) => EXT_LANG[extname(file)] ?? []))
  const configured = project.config.languages
  const requested = languages?.length ? languages : configured.length ? configured : [...present].sort()
  const langs = requested.filter((language) => ADAPTERS[language])
  report.languages = langs

  const languageFilter = new Set(langs)
  const rootDirs = roots
    .map((root) => resolve(project.root, root))
    .filter((path) => existsSync(path))
    .map((path) => (statSync(path).isDirectory() ? path : dirname(path)))

  const moduleOfFile = new Map<string, string>()
  const moduleDirs = new Set<string>()
  for (const file of allFiles) {
    const language = EXT_LANG[extname(file)]
    if (!language || !languageFilter.has(language)) continue

    const owner = ownerRoot(file, rootDirs)
    if (!owner) continue

    let moduleDir = moduleDirFor(file, owner)
    if (!isInside(owner, moduleDir)) moduleDir = owner
    moduleOfFile.set(file, moduleDir)
    moduleDirs.add(moduleDir)
  }

  const pkgDirs = new Map<string, string>()
  for (const moduleDir of sortedPaths(moduleDirs)) {
    const info = packageOf(moduleDir, rootDirs)
    if (!pkgDirs.has(info.path)) pkgDirs.set(info.path, info.name)
  }

  const ids = new IdGenerator()
  const packageIDs = new Map<string, string>()
  const packages: PackageInfo[] = []
  for (const [path, name] of [...pkgDirs.entries()].sort(([left], [right]) => comparePath(left, right))) {
    const id = ids.make("pkg", name)
    packageIDs.set(path, id)
    packages.push({ id, name, path: project.rel(path), responsibility: "" })
  }

  const moduleFiles = new Map<string, string[]>()
  for (const [file, moduleDir] of moduleOfFile) {
    const files = moduleFiles.get(moduleDir)
    if (files) files.push(file)
    else moduleFiles.set(moduleDir, [file])
  }

  const entitiesByModule = new Map<string, Entity[]>()
  const imports: ImportRef[] = []
  const entityMeta = new Map<string, EntityMeta>()
  const rawRelations = new Map<string, [string, string][]>()
  for (const moduleDir of sortedPaths(moduleFiles.keys())) {
    const entities: Entity[] = []
    for (const file of sortedPaths(moduleFiles.get(moduleDir) ?? [])) {
      const language = EXT_LANG[extname(file)]
      const adapter = language ? ADAPTERS[language] : undefined
      if (!adapter) continue

      let symbols: Symbol[]
      try {
        symbols = adapter.parse(file, project.root)
        imports.push(...adapter.imports(file, project.root))
      } catch (error) {
        report.skipped_files.push(`${project.rel(file)}: ${errorMessage(error)}`)
        continue
      }

      for (const symbol of symbols) {
        const kind = entityKind(symbol.kind)
        const id = ids.make(KIND_PREFIX[kind], symbol.name)
        entities.push({
          id,
          kind,
          name: symbol.name,
          location: { file: project.rel(file), symbol: symbol.name },
          responsibility: symbol.responsibility,
          expose: symbol.is_public ? "public" : "internal",
          status: "active",
          fields: symbol.fields.map(([name, type]): FieldSpec => ({ name, type, description: "" })),
          methods: symbol.methods.map(([name, signature]): MethodSpec => ({ name, signature, description: "" })),
          relations: [],
        })
        entityMeta.set(id, { moduleDir, name: symbol.name, kind })
        rawRelations.set(id, symbol.relations)
      }
    }
    entitiesByModule.set(moduleDir, entities)
    report.entity_count += entities.length
  }

  const nameIndex = new Map<string, { moduleDir: string; id: string; kind: EntityKind }[]>()
  for (const [id, meta] of entityMeta) {
    const entries = nameIndex.get(meta.name)
    const entry = { moduleDir: meta.moduleDir, id, kind: meta.kind }
    if (entries) entries.push(entry)
    else nameIndex.set(meta.name, [entry])
  }

  let resolvedCount = 0
  let unresolvedCount = 0
  for (const [moduleDir, entities] of entitiesByModule) {
    for (const entity of entities) {
      const relations: Relation[] = []
      const seen = new Set<string>()

      for (const [rawType, targetName] of rawRelations.get(entity.id) ?? []) {
        if (!targetName || targetName === entity.name) continue

        const candidates = nameIndex.get(targetName) ?? []
        const sameModule = candidates.filter((candidate) => candidate.moduleDir === moduleDir)
        const target = sameModule[0] ?? (candidates.length === 1 ? candidates[0] : undefined)
        if (!target) {
          unresolvedCount += 1
          continue
        }
        if (target.id === entity.id) continue

        const type = relationType(rawType)
        if (!type) continue
        const resolvedType =
          type === "extends" && target.kind === "interface" && (entity.kind === "class" || entity.kind === "entity")
            ? "implements"
            : type
        const key = `${resolvedType}\0${target.id}`
        if (seen.has(key)) continue

        seen.add(key)
        relations.push({ type: resolvedType, target: target.id })
        resolvedCount += 1
      }

      entity.relations = relations
    }
  }

  if (resolvedCount || unresolvedCount) {
    report.notes.push(`实体关系: 解析 ${resolvedCount} 条；${unresolvedCount} 个同名歧义/未找到目标已跳过`)
  }

  const modules: ModuleInfo[] = []
  const l1: Record<string, L1> = {}
  for (const moduleDir of sortedPaths(moduleFiles.keys())) {
    const info = packageOf(moduleDir, rootDirs)
    const name = basename(moduleDir)
    const id = ids.make("mod", name || "root")
    const entities = entitiesByModule.get(moduleDir) ?? []
    const module: ModuleInfo = {
      id,
      name,
      package: packageIDs.get(info.path)!,
      path: project.rel(moduleDir),
      responsibility: "",
      layer: "",
      system: "",
      depends_on: [],
      uses_externals: [],
      public_entities: entities.filter((entity) => entity.expose === "public").map((entity) => entity.id),
      status: "active",
    }

    modules.push(module)
    l1[id] = { version: 1, module: id, entities }
    report.modules.push({
      id,
      path: module.path,
      files: moduleFiles.get(moduleDir)?.length ?? 0,
      entities: entities.length,
    })
  }

  const dottedMap = new Map<string, string>()
  const pathMap = new Map<string, string>()
  for (const module of modules) {
    const moduleDir = resolve(project.root, module.path)
    for (const root of rootDirs) {
      if (!isInside(root, moduleDir)) continue
      const dotted = relative(root, moduleDir).split(sep).filter(Boolean).join(".")
      if (dotted) dottedMap.set(dotted, module.id)
    }
    pathMap.set(module.path, module.id)
  }

  const moduleIDByDir = new Map<string, string>()
  for (const module of modules) moduleIDByDir.set(resolve(project.root, module.path), module.id)

  const deps = new Map<string, Set<string>>()
  for (const module of modules) deps.set(module.id, new Set())

  for (const ref of imports) {
    const ownerDir = moduleOfFile.get(resolve(project.root, ref.from_file))
    if (!ownerDir) continue
    const ownerID = moduleIDByDir.get(ownerDir)
    if (!ownerID) continue

    let targetID: string | undefined
    if (ref.kind === "dotted") {
      let best = ""
      for (const [dotted, id] of dottedMap) {
        if (id === ownerID) continue
        const matched =
          ref.raw === dotted ||
          ref.raw.startsWith(`${dotted}.`) ||
          dotted.startsWith(`${ref.raw}.`) ||
          ref.raw.endsWith(`.${dotted}`) ||
          dotted.endsWith(`.${ref.raw}`)
        if (matched && dotted.length > best.length) {
          best = dotted
          targetID = id
        }
      }
    } else {
      const targetPath = resolve(dirname(resolve(project.root, ref.from_file)), ref.raw)
      let best = 0
      for (const [path, id] of pathMap) {
        if (id === ownerID) continue
        const base = resolve(project.root, path)
        if (targetPath === base || isInside(base, targetPath)) {
          const length = pathParts(base).length
          if (length > best) {
            best = length
            targetID = id
          }
        }
      }
    }

    if (targetID && targetID !== ownerID) deps.get(ownerID)?.add(targetID)
  }

  for (const module of modules) {
    module.depends_on = [...(deps.get(module.id) ?? [])].sort()
    if (module.depends_on.length) report.deps[module.id] = module.depends_on
  }

  const systems: SystemInfo[] = []
  const systemCandidates = detectSystemDirs(project)
  if (systemCandidates.length >= 2) {
    const systemPaths: { path: string; id: string }[] = []
    for (const candidate of systemCandidates) {
      const id = ids.make("sys", basename(candidate.path))
      const path = project.rel(candidate.path)
      systems.push({
        id,
        name: basename(candidate.path),
        kind: candidate.kind,
        path,
        responsibility: "",
        depends_on: [],
      })
      systemPaths.push({ path, id })
    }

    for (const module of modules) {
      const modulePath = toPosix(module.path)
      let best = ""
      let bestLength = -1
      for (const system of systemPaths) {
        const systemPath = toPosix(system.path).replace(/\/+$/, "")
        if ((modulePath === systemPath || modulePath.startsWith(`${systemPath}/`)) && systemPath.length > bestLength) {
          best = system.id
          bestLength = systemPath.length
        }
      }
      if (best) module.system = best
    }

    report.systems = systems.map(systemToDict)
    report.notes.push(
      `检测到 ${systems.length} 个系统（monorepo 顶层 manifest）: ` +
        systems.map((system) => `${system.id}(${system.kind})`).join(", "),
    )
  }

  const projectInfo: ProjectInfo = {
    name: basename(project.root),
    description: "",
    languages: langs,
  }
  const l0: L0 = {
    version: 1,
    project: projectInfo,
    systems,
    packages,
    modules,
    externals: [],
    layers: [],
    constraints: [],
  }

  if (report.skipped_files.length) {
    report.notes.push(`${report.skipped_files.length} 个文件解析失败，已跳过`)
  }
  const approximate = langs.filter((language) => ["typescript", "javascript", "java", "kotlin"].includes(language))
  if (approximate.length) {
    report.notes.push(`近似适配器（声明级符号 + 字段/方法/关系近似）: ${approximate.join(", ")}；复杂语法可能遗漏`)
  }
  report.notes.push("模块粒度启发式：Python 按 __init__.py 包、其他语言按源文件目录；可用 jin.yaml scan.roots 调整")
  report.notes.push("responsibility 为空的条目需要审校补全")

  return { arch: { l0, l1 }, report }
}

function collectFiles(directory: string, project: Project, report: ScanReport): string[] {
  const files: string[] = []
  const extraIgnore = new Set(project.config.scan.ignore.map((path) => path.replace(/\/+$/, "")))

  const walk = (current: string) => {
    const entries = readdirSync(current, { withFileTypes: true }).sort((left, right) =>
      comparePath(left.name, right.name),
    )

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const path = join(current, entry.name)
      if (
        DEFAULT_IGNORE_SET.has(entry.name) ||
        extraIgnore.has(entry.name) ||
        entry.name.startsWith(".") ||
        (project.config.scan.exclude_tests && TEST_DIRS.has(entry.name.toLowerCase()))
      ) {
        report.skipped_dirs.push(project.rel(path))
        continue
      }
      walk(path)
    }

    for (const entry of entries) {
      if (!entry.isFile()) continue
      const path = join(current, entry.name)
      if (!EXT_LANG[extname(entry.name)]) continue
      if (project.config.scan.exclude_tests && isTestPath(toPosix(project.rel(path)))) continue
      files.push(resolve(path))
    }
  }

  walk(resolve(directory))
  return files
}

function hasSources(directory: string): boolean {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!DEFAULT_IGNORE_SET.has(entry.name) && hasSources(join(directory, entry.name))) return true
      continue
    }
    if (entry.isFile() && EXT_LANG[extname(entry.name)]) return true
  }
  return false
}

function detectSystemDirs(project: Project): SystemCandidate[] {
  if (!isDirectory(project.root)) return []

  return readdirSync(project.root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && !DEFAULT_IGNORE_SET.has(entry.name))
    .sort((left, right) => comparePath(left.name, right.name))
    .flatMap((entry) => {
      const path = join(project.root, entry.name)
      if (!SYSTEM_MANIFESTS.some((manifest) => existsSync(join(path, manifest)))) return []
      if (!hasSources(path)) return []
      return [{ path, kind: inferSystemKind(path) }]
    })
}

function inferSystemKind(directory: string): SystemKind {
  const packagePath = join(directory, "package.json")
  if (existsSync(packagePath)) {
    const data = readJSON(packagePath)
    const deps = new Set([...dependencyNames(data, "dependencies"), ...dependencyNames(data, "devDependencies")])
    if ([...deps].some((name) => FRONTEND_DEPS.has(name))) return "frontend"
    if (deps.size) return "backend"
    return "library"
  }

  const pythonManifests = ["pyproject.toml", "setup.py", "setup.cfg"]
    .map((name) => join(directory, name))
    .filter((path) => existsSync(path))
  if (pythonManifests.length) {
    const blob = pythonManifests.map((path) => readFileSync(path, "utf8").toLowerCase()).join("\n")
    if (PYTHON_BACKEND.some((name) => blob.includes(name))) return "backend"
    if (PYTHON_WORKER.some((name) => blob.includes(name))) return "worker"
    if (PYTHON_CLI.some((name) => blob.includes(name))) return "cli"
    return "library"
  }

  if (["pom.xml", "build.gradle", "build.gradle.kts"].some((name) => existsSync(join(directory, name)))) {
    return "backend"
  }
  return "other"
}

function readJSON(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch {
    return undefined
  }
}

function dependencyNames(value: unknown, key: "dependencies" | "devDependencies"): string[] {
  if (!isRecord(value)) return []
  const deps = value[key]
  if (!isRecord(deps)) return []
  return Object.keys(deps)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function moduleDirFor(file: string, rootDir: string): string {
  if (extname(file) !== ".py") return dirname(file)

  let current = dirname(file)
  while (true) {
    if (existsSync(join(current, "__init__.py"))) return current
    if (current === rootDir || !isInside(rootDir, current)) break
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return dirname(file)
}

function packageOf(moduleDir: string, roots: string[]): { path: string; name: string } {
  for (const root of roots) {
    if (!isInside(root, moduleDir)) continue
    const parts = relative(root, moduleDir).split(sep).filter(Boolean)
    if (parts.length) return { path: join(root, parts[0]!), name: parts[0]! }
    return { path: root, name: basename(root) }
  }
  return { path: moduleDir, name: basename(moduleDir) }
}

function ownerRoot(file: string, roots: string[]): string | undefined {
  let owner: string | undefined
  for (const root of roots) {
    if (!isInside(root, file)) continue
    if (!owner || pathParts(root).length > pathParts(owner).length) owner = root
  }
  return owner
}

function entityKind(value: string): EntityKind {
  return ENTITY_KINDS.find((kind) => kind === value) ?? "entity"
}

function relationType(value: string): RelationType | undefined {
  return RELATION_TYPES.find((type) => type === value)
}

class IdGenerator {
  private readonly used = new Set<string>()

  make(prefix: string, name: string): string {
    const base = `${prefix}-${slugify(name)}`
    let candidate = base
    let index = 2
    while (this.used.has(candidate)) {
      candidate = `${base}-${index}`
      index += 1
    }
    this.used.add(candidate)
    return candidate
  }
}

function isDirectory(path: string): boolean {
  return existsSync(path) && statSync(path).isDirectory()
}

function isInside(directory: string, path: string): boolean {
  const rel = relative(directory, path)
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

function pathParts(path: string): string[] {
  return resolve(path).split(sep).filter(Boolean)
}

function sortedPaths(values: Iterable<string>): string[] {
  return [...values].sort(comparePath)
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort(comparePath)
}

function comparePath(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function toPosix(path: string): string {
  return path.split(sep).join("/")
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
