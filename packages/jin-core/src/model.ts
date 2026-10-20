import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { JinError } from "./error"
import {
  CONSTRAINT_KINDS,
  ENTITY_KINDS,
  ENTITY_STATUSES,
  EXTERNAL_KINDS,
  EXPOSE_KINDS,
  MODULE_STATUSES,
  RELATION_TYPES,
  SYSTEM_KINDS,
  type Arch,
  type Constraint,
  type Entity,
  type ExternalInfo,
  type FieldSpec,
  type L0,
  type L1,
  type Layer,
  type Location,
  type MethodSpec,
  type ModuleInfo,
  type PackageInfo,
  type ProjectInfo,
  type Relation,
  type SystemInfo,
} from "./types"
import { dumpsYaml, loadYaml } from "./yaml"

export const ID_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)+$/
export const LAYER_ID_RE = /^[a-z][a-z0-9-]*$/
export const REQ_RE = /^REQ-[A-Za-z0-9]+(-[A-Za-z0-9]+)*$/

export function nowISO(): string {
  const date = new Date()
  const offset = -date.getTimezoneOffset()
  const sign = offset >= 0 ? "+" : "-"
  const pad = (value: number) => String(Math.abs(value)).padStart(2, "0")

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}:${pad(date.getSeconds())}${sign}${pad(Math.trunc(offset / 60))}:${pad(offset % 60)}`
}

function record(value: unknown, where: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new JinError(`${where} 必须是映射`)
  return value as Record<string, unknown>
}

function checkKeys(data: Record<string, unknown>, allowed: readonly string[], where: string): void {
  const unknown = Object.keys(data).filter((key) => !allowed.includes(key))

  if (unknown.length) {
    throw new JinError(
      `${where}: 未知字段 ${JSON.stringify(unknown.sort())}；允许的字段: ${JSON.stringify([...allowed].sort())}`,
    )
  }
}

function requiredString(value: unknown, where: string): string {
  if (typeof value !== "string" || !value) throw new JinError(`${where} 必填`)
  return value
}

function stringValue(data: Record<string, unknown>, key: string, where: string, fallback = ""): string {
  const value = data[key]

  if (value === undefined) return fallback
  if (typeof value !== "string") throw new JinError(`${where}.${key} 必须是字符串`)
  return value
}

function intValue(data: Record<string, unknown>, key: string, fallback: number): number {
  const value = data[key]

  if (value === undefined) return fallback
  if (typeof value === "number" && Number.isInteger(value)) return value
  if (typeof value === "string" && /^-?\d+$/.test(value)) return Number(value)

  throw new JinError(`${key} 必须是整数`)
}

function booleanValue(data: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = data[key]

  if (value === undefined) return fallback
  if (typeof value !== "boolean") throw new JinError(`${key} 必须是布尔值`)
  return value
}

function stringArray(value: unknown, where: string): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new JinError(`${where} 必须是数组`)

  return value.map((item, index) => requiredString(item, `${where}[${index}]`))
}

function arrayValue(value: unknown, where: string): unknown[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new JinError(`${where} 必须是数组`)
  return value
}

function oneOf<T extends readonly string[]>(value: unknown, allowed: T, where: string): T[number] {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new JinError(`${where} 非法: ${String(value)} (支持: ${JSON.stringify([...allowed].sort())})`)
  }

  return value as T[number]
}

function parseProjectInfo(value: unknown): ProjectInfo {
  const data = record(value, "project")
  checkKeys(data, ["name", "description", "languages"], "project")

  return {
    name: requiredString(data.name, "project.name"),
    description: stringValue(data, "description", "project"),
    languages: stringArray(data.languages, "project.languages"),
  }
}

function parsePackage(value: unknown): PackageInfo {
  const data = record(value, "package")

  checkKeys(data, ["id", "name", "path", "responsibility"], `package ${String(data.id ?? "?")}`)

  const id = requiredString(data.id, "package.id")

  return {
    id,
    name: stringValue(data, "name", `package ${id}`, id),
    path: requiredString(data.path, `package ${id}.path`),
    responsibility: stringValue(data, "responsibility", `package ${id}`),
  }
}

function parseSystem(value: unknown): SystemInfo {
  const data = record(value, "system")
  const id = requiredString(data.id, "system.id")

  checkKeys(data, ["id", "name", "kind", "path", "responsibility", "depends_on"], `system ${id}`)

  return {
    id,
    name: stringValue(data, "name", `system ${id}`, id),
    kind: oneOf(data.kind ?? "other", SYSTEM_KINDS, `system ${id}.kind`),
    path: stringValue(data, "path", `system ${id}`),
    responsibility: stringValue(data, "responsibility", `system ${id}`),
    depends_on: stringArray(data.depends_on, `system ${id}.depends_on`),
  }
}

function parseExternal(value: unknown): ExternalInfo {
  const data = record(value, "external")
  const id = requiredString(data.id, "external.id")

  checkKeys(data, ["id", "name", "kind", "provider", "description"], `external ${id}`)

  return {
    id,
    name: stringValue(data, "name", `external ${id}`, id),
    kind: oneOf(data.kind ?? "other", EXTERNAL_KINDS, `external ${id}.kind`),
    provider: stringValue(data, "provider", `external ${id}`),
    description: stringValue(data, "description", `external ${id}`),
  }
}

function parseLayer(value: unknown): Layer {
  const data = record(value, "layer")
  const id = requiredString(data.id, "layer.id")

  if (!LAYER_ID_RE.test(id))
    throw new JinError(`layer id 非法: ${JSON.stringify(id)}（小写 slug，如 app/domain/infra）`)

  checkKeys(data, ["id", "name", "description"], `layer ${id}`)

  return {
    id,
    name: stringValue(data, "name", `layer ${id}`, id),
    description: stringValue(data, "description", `layer ${id}`),
  }
}

function parseModule(value: unknown): ModuleInfo {
  const data = record(value, "module")
  const id = requiredString(data.id, "module.id")

  checkKeys(
    data,
    [
      "id",
      "name",
      "package",
      "path",
      "responsibility",
      "layer",
      "system",
      "depends_on",
      "uses_externals",
      "public_entities",
      "status",
    ],
    `module ${id}`,
  )

  return {
    id,
    name: stringValue(data, "name", `module ${id}`, id),
    package: requiredString(data.package, `module ${id}.package`),
    path: requiredString(data.path, `module ${id}.path`),
    responsibility: stringValue(data, "responsibility", `module ${id}`),
    layer: stringValue(data, "layer", `module ${id}`),
    system: stringValue(data, "system", `module ${id}`),
    depends_on: stringArray(data.depends_on, `module ${id}.depends_on`),
    uses_externals: stringArray(data.uses_externals, `module ${id}.uses_externals`),
    public_entities: stringArray(data.public_entities, `module ${id}.public_entities`),
    status: oneOf(data.status ?? "active", MODULE_STATUSES, `module ${id}.status`),
  }
}

function parseConstraint(value: unknown): Constraint {
  const data = record(value, "constraint")
  const id = requiredString(data.id, "constraint.id")

  checkKeys(data, ["id", "kind", "description", "from_layers", "to_layers", "forbidden"], `constraint ${id}`)

  return {
    id,
    kind: oneOf(data.kind, CONSTRAINT_KINDS, `constraint ${id}.kind`),
    description: stringValue(data, "description", `constraint ${id}`),
    from_layers: stringArray(data.from_layers, `constraint ${id}.from_layers`),
    to_layers: stringArray(data.to_layers, `constraint ${id}.to_layers`),
    forbidden: booleanValue(data, "forbidden", true),
  }
}

export function parseL0(value: unknown): L0 {
  const data = record(value, "L0")

  checkKeys(data, ["version", "project", "systems", "packages", "modules", "externals", "layers", "constraints"], "L0")

  if (!data.project || typeof data.project !== "object" || Array.isArray(data.project)) {
    throw new JinError("L0.project 必填")
  }

  return {
    version: intValue(data, "version", 1),
    project: parseProjectInfo(data.project),
    systems: arrayValue(data.systems, "L0.systems").map(parseSystem),
    packages: arrayValue(data.packages, "L0.packages").map(parsePackage),
    modules: arrayValue(data.modules, "L0.modules").map(parseModule),
    externals: arrayValue(data.externals, "L0.externals").map(parseExternal),
    layers: arrayValue(data.layers, "L0.layers").map(parseLayer),
    constraints: arrayValue(data.constraints, "L0.constraints").map(parseConstraint),
  }
}

function parseLocation(value: unknown): Location {
  const data = record(value, "location")
  checkKeys(data, ["file", "symbol"], "location")

  return {
    file: requiredString(data.file, "location.file"),
    symbol: requiredString(data.symbol, "location.symbol"),
  }
}

function parseField(value: unknown): FieldSpec {
  const data = record(value, "field")
  checkKeys(data, ["name", "type", "description"], "field")

  return {
    name: requiredString(data.name, "field.name"),
    type: stringValue(data, "type", "field"),
    description: stringValue(data, "description", "field"),
  }
}

function parseMethod(value: unknown): MethodSpec {
  const data = record(value, "method")
  checkKeys(data, ["name", "signature", "description"], "method")

  return {
    name: requiredString(data.name, "method.name"),
    signature: stringValue(data, "signature", "method"),
    description: stringValue(data, "description", "method"),
  }
}

function parseRelation(value: unknown): Relation {
  const data = record(value, "relation")
  checkKeys(data, ["type", "target"], "relation")

  return {
    type: oneOf(data.type, RELATION_TYPES, "relation.type"),
    target: requiredString(data.target, "relation.target"),
  }
}

function parseEntity(value: unknown): Entity {
  const data = record(value, "entity")
  const id = requiredString(data.id, "entity.id")

  checkKeys(
    data,
    ["id", "kind", "name", "location", "responsibility", "expose", "status", "fields", "methods", "relations"],
    `entity ${id}`,
  )

  return {
    id,
    kind: oneOf(data.kind, ENTITY_KINDS, `entity ${id}.kind`),
    name: stringValue(data, "name", `entity ${id}`, id),
    location: parseLocation(data.location),
    responsibility: stringValue(data, "responsibility", `entity ${id}`),
    expose: oneOf(data.expose ?? "public", EXPOSE_KINDS, `entity ${id}.expose`),
    status: oneOf(data.status ?? "active", ENTITY_STATUSES, `entity ${id}.status`),
    fields: arrayValue(data.fields, `entity ${id}.fields`).map(parseField),
    methods: arrayValue(data.methods, `entity ${id}.methods`).map(parseMethod),
    relations: arrayValue(data.relations, `entity ${id}.relations`).map(parseRelation),
  }
}

export function parseL1(value: unknown): L1 {
  const data = record(value, "L1")
  checkKeys(data, ["version", "module", "entities"], "L1")

  return {
    version: intValue(data, "version", 1),
    module: requiredString(data.module, "L1.module"),
    entities: arrayValue(data.entities, "L1.entities").map(parseEntity),
  }
}

export function projectToDict(project: ProjectInfo): Record<string, unknown> {
  return { name: project.name, description: project.description, languages: project.languages }
}

export function packageToDict(item: PackageInfo): Record<string, unknown> {
  const data: Record<string, unknown> = { id: item.id, name: item.name, path: item.path }
  if (item.responsibility) data.responsibility = item.responsibility
  return data
}

export function systemToDict(item: SystemInfo): Record<string, unknown> {
  const data: Record<string, unknown> = { id: item.id, name: item.name, kind: item.kind }
  if (item.path) data.path = item.path
  if (item.responsibility) data.responsibility = item.responsibility
  if (item.depends_on.length) data.depends_on = item.depends_on
  return data
}

export function externalToDict(item: ExternalInfo): Record<string, unknown> {
  const data: Record<string, unknown> = { id: item.id, name: item.name, kind: item.kind }
  if (item.provider) data.provider = item.provider
  if (item.description) data.description = item.description
  return data
}

export function layerToDict(item: Layer): Record<string, unknown> {
  const data: Record<string, unknown> = { id: item.id, name: item.name }
  if (item.description) data.description = item.description
  return data
}

export function moduleToDict(item: ModuleInfo): Record<string, unknown> {
  const data: Record<string, unknown> = {
    id: item.id,
    name: item.name,
    package: item.package,
    path: item.path,
  }
  if (item.layer) data.layer = item.layer
  if (item.system) data.system = item.system
  if (item.responsibility) data.responsibility = item.responsibility
  if (item.depends_on.length) data.depends_on = item.depends_on
  if (item.uses_externals.length) data.uses_externals = item.uses_externals
  if (item.public_entities.length) data.public_entities = item.public_entities
  if (item.status !== "active") data.status = item.status
  return data
}

export function constraintToDict(item: Constraint): Record<string, unknown> {
  const data: Record<string, unknown> = { id: item.id, kind: item.kind }
  if (item.description) data.description = item.description
  data.from_layers = item.from_layers
  data.to_layers = item.to_layers
  data.forbidden = item.forbidden
  return data
}

export function l0ToDict(l0: L0): Record<string, unknown> {
  const data: Record<string, unknown> = { version: l0.version, project: projectToDict(l0.project) }
  if (l0.systems.length) data.systems = l0.systems.map(systemToDict)
  data.packages = l0.packages.map(packageToDict)
  data.modules = l0.modules.map(moduleToDict)
  if (l0.externals.length) data.externals = l0.externals.map(externalToDict)
  if (l0.layers.length) data.layers = l0.layers.map(layerToDict)
  if (l0.constraints.length) data.constraints = l0.constraints.map(constraintToDict)
  return data
}

function locationToDict(item: Location): Record<string, unknown> {
  return { file: item.file, symbol: item.symbol }
}

export function fieldToDict(item: FieldSpec): Record<string, unknown> {
  const data: Record<string, unknown> = { name: item.name }
  if (item.type) data.type = item.type
  if (item.description) data.description = item.description
  return data
}

export function methodToDict(item: MethodSpec): Record<string, unknown> {
  const data: Record<string, unknown> = { name: item.name }
  if (item.signature) data.signature = item.signature
  if (item.description) data.description = item.description
  return data
}

export function relationToDict(item: Relation): Record<string, unknown> {
  return { type: item.type, target: item.target }
}

export function entityToDict(item: Entity): Record<string, unknown> {
  const data: Record<string, unknown> = {
    id: item.id,
    kind: item.kind,
    name: item.name,
    location: locationToDict(item.location),
  }
  if (item.responsibility) data.responsibility = item.responsibility
  if (item.expose !== "public") data.expose = item.expose
  if (item.status !== "active") data.status = item.status
  if (item.fields.length) data.fields = item.fields.map(fieldToDict)
  if (item.methods.length) data.methods = item.methods.map(methodToDict)
  if (item.relations.length) data.relations = item.relations.map(relationToDict)
  return data
}

export function l1ToDict(l1: L1): Record<string, unknown> {
  return {
    version: l1.version,
    module: l1.module,
    entities: l1.entities.map(entityToDict),
  }
}

export function loadArchDir(archDir: string): Arch {
  const l0Path = join(archDir, "L0.yaml")

  if (!existsSync(l0Path)) {
    throw new JinError(`未找到架构文件: ${l0Path}（先在项目里运行 jin bootstrap 或 jin new）`)
  }

  const l0 = parseL0(loadYaml(l0Path))
  const l1: Record<string, L1> = {}
  const l1Dir = join(archDir, "L1")

  if (existsSync(l1Dir)) {
    for (const name of readdirSync(l1Dir)
      .filter((name) => name.endsWith(".yaml"))
      .sort()) {
      const item = parseL1(loadYaml(join(l1Dir, name)))

      if (l1[item.module]) throw new JinError(`${join(l1Dir, name)}: module ${item.module} 在 L1/ 中重复`)
      l1[item.module] = item
    }
  }

  return { l0, l1 }
}

export function saveArchDir(arch: Arch, archDir: string, header?: string): void {
  mkdirSync(archDir, { recursive: true })

  const l0Text = dumpsYaml(l0ToDict(arch.l0))
  writeFileSync(join(archDir, "L0.yaml"), header ? `# ${header}\n${l0Text}` : l0Text, "utf8")

  const l1Dir = join(archDir, "L1")
  mkdirSync(l1Dir, { recursive: true })

  const keep = new Set<string>()

  for (const [module, l1] of Object.entries(arch.l1).sort(([left], [right]) => left.localeCompare(right))) {
    const name = `${module}.yaml`
    keep.add(name)
    const text = dumpsYaml(l1ToDict(l1))
    writeFileSync(join(l1Dir, name), header ? `# ${header}\n${text}` : text, "utf8")
  }

  for (const name of readdirSync(l1Dir).filter((name) => name.endsWith(".yaml"))) {
    if (!keep.has(name)) unlinkSync(join(l1Dir, name))
  }
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable)

  if (value && typeof value === "object") {
    const data = value as Record<string, unknown>
    return Object.fromEntries(
      Object.keys(data)
        .sort()
        .map((key) => [key, stable(data[key])]),
    )
  }

  return value
}

/** Stable hash of an architecture snapshot, used for proposal base tracking. */
export function archHash(arch: Arch): string {
  const l1 = Object.fromEntries(
    Object.entries(arch.l1)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, l1ToDict(value)]),
  )
  const payload = JSON.stringify(stable({ l0: l0ToDict(arch.l0), l1 }))

  return createHash("sha256").update(payload).digest("hex").slice(0, 16)
}

export function l0Module(l0: L0, id: string): ModuleInfo | undefined {
  return l0.modules.find((item) => item.id === id)
}

export function l1Entity(l1: L1, id: string): Entity | undefined {
  return l1.entities.find((item) => item.id === id)
}

export function archEntity(arch: Arch, id: string): { module: string; entity: Entity } | undefined {
  for (const [module, l1] of Object.entries(arch.l1)) {
    const entity = l1Entity(l1, id)

    if (entity) return { module, entity }
  }

  return undefined
}

export function archAllEntities(arch: Arch): Record<string, Entity> {
  return Object.fromEntries(Object.values(arch.l1).flatMap((l1) => l1.entities.map((entity) => [entity.id, entity])))
}

export function archFirstModuleOf(arch: Arch, entityID: string): string | undefined {
  return archEntity(arch, entityID)?.module
}
