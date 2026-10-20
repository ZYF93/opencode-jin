import { existsSync } from "node:fs"
import { isAbsolute, join, resolve } from "node:path"
import { KIND_PREFIX, type Arch, type Entity, type L0 } from "./types"
import { ID_RE, archAllEntities, archFirstModuleOf, l0Module, l1Entity } from "./model"

export interface Issue {
  level: "error" | "warning"
  code: string
  message: string
  path?: string
}

export interface ValidateOptions {
  checkDisk?: boolean
  root?: string
}

function issue(level: Issue["level"], code: string, message: string, path = ""): Issue {
  return { level, code, message, path }
}

export function formatIssue(item: Issue): string {
  const tag = item.level === "error" ? "ERROR" : "WARN"
  const location = item.path ? ` [${item.path}]` : ""
  return `${tag} ${item.code}${location}: ${item.message}`
}

function checkID(itemID: string, prefix: string, kind: string, where: string, issues: Issue[]): void {
  if (!ID_RE.test(itemID)) {
    issues.push(issue("error", "id-format", `${kind} id 不符合 kebab-case 规范: ${JSON.stringify(itemID)}`, where))
    return
  }

  if (itemID.split("-", 1)[0] !== prefix) {
    issues.push(issue("warning", "id-prefix", `${kind} id 建议使用前缀 ${prefix}-: ${itemID}`, where))
  }
}

function duplicates(values: string[]): string[] {
  const seen = new Set<string>()
  const dups: string[] = []

  for (const value of values) {
    if (seen.has(value) && !dups.includes(value)) dups.push(value)
    seen.add(value)
  }

  return dups
}

function checkDuplicate(items: string[], label: string, issues: Issue[]): void {
  for (const dup of duplicates(items)) {
    issues.push(issue("error", "id-dup", `${label} id 重复: ${dup}`))
  }
}

function checkDepends(
  owner: string,
  kind: "system" | "module",
  dependsOn: string[],
  known: Set<string>,
  issues: Issue[],
): void {
  for (const dependency of dependsOn) {
    if (!known.has(dependency)) {
      issues.push(
        issue(
          "error",
          kind === "system" ? "ref-system-dep" : "ref-depends",
          `${kind} ${owner} 依赖不存在的${kind === "system" ? "系统" : "模块"}: ${dependency}`,
        ),
      )
    }

    if (dependency === owner) issues.push(issue("error", "self-dep", `${kind} ${owner} 不能依赖自身`))
  }

  for (const dup of duplicates(dependsOn)) {
    issues.push(issue("warning", "dup-depends", `${kind} ${owner} depends_on 重复: ${dup}`))
  }
}

function checkL0Refs(l0: L0, issues: Issue[]): void {
  const systemIDs = new Set(l0.systems.map((item) => item.id))
  const externalIDs = new Set(l0.externals.map((item) => item.id))
  const layerIDs = new Set(l0.layers.map((item) => item.id))

  for (const system of l0.systems) checkDepends(system.id, "system", system.depends_on, systemIDs, issues)

  for (const module of l0.modules) {
    if (module.system && !systemIDs.has(module.system)) {
      issues.push(issue("error", "ref-system", `module ${module.id} 引用了不存在的 system: ${module.system}`))
    }

    for (const external of module.uses_externals) {
      if (!externalIDs.has(external)) {
        issues.push(issue("error", "ref-external", `module ${module.id} 引用了不存在的 external: ${external}`))
      }
    }

    for (const dup of duplicates(module.uses_externals)) {
      issues.push(issue("warning", "dup-external", `module ${module.id} uses_externals 重复: ${dup}`))
    }

    if (module.layer && layerIDs.size && !layerIDs.has(module.layer)) {
      issues.push(issue("error", "unknown-layer", `module ${module.id} 的 layer=${module.layer} 未在 L0.layers 中定义`))
    }
  }

  for (const constraint of l0.constraints) {
    if (constraint.kind !== "layer-dependency" || !layerIDs.size) continue

    for (const layer of [...constraint.from_layers, ...constraint.to_layers]) {
      if (!layerIDs.has(layer)) {
        issues.push(issue("error", "unknown-layer", `constraint ${constraint.id} 引用了未定义的 layer: ${layer}`))
      }
    }
  }
}

function checkModuleRefs(l0: L0, issues: Issue[]): void {
  const packageIDs = new Set(l0.packages.map((item) => item.id))
  const moduleIDs = new Set(l0.modules.map((item) => item.id))

  for (const module of l0.modules) {
    if (!packageIDs.has(module.package)) {
      issues.push(issue("error", "ref-package", `module ${module.id} 引用了不存在的 package: ${module.package}`))
    }

    for (const dependency of module.depends_on) {
      if (!moduleIDs.has(dependency)) {
        issues.push(issue("error", "ref-depends", `module ${module.id} 依赖不存在的模块: ${dependency}`))
      }

      if (dependency === module.id) issues.push(issue("error", "self-dep", `module ${module.id} 不能依赖自身`))
    }

    for (const dup of duplicates(module.depends_on)) {
      issues.push(issue("warning", "dup-depends", `module ${module.id} depends_on 重复: ${dup}`))
    }

    for (const dup of duplicates(module.public_entities)) {
      issues.push(issue("warning", "dup-public", `module ${module.id} public_entities 重复: ${dup}`))
    }
  }
}

function checkL1Structure(arch: Arch, issues: Issue[]): void {
  const moduleIDs = new Set(arch.l0.modules.map((item) => item.id))
  const l1ModuleIDs = new Set(Object.keys(arch.l1))

  for (const module of l1ModuleIDs) {
    if (!moduleIDs.has(module)) issues.push(issue("error", "l1-orphan", `L1 文件对应的模块不存在于 L0: ${module}`))
  }

  for (const module of arch.l0.modules) {
    const l1 = arch.l1[module.id]

    if (!l1) {
      const level: Issue["level"] = module.public_entities.length ? "error" : "warning"
      issues.push(
        issue(
          level,
          "l1-missing",
          `模块 ${module.id} 缺少 L1 文件 (arch/L1/${module.id}.yaml)`,
          `arch/L1/${module.id}.yaml`,
        ),
      )
      continue
    }

    if (l1.module !== module.id) {
      issues.push(issue("error", "l1-module-mismatch", `L1 文件内部 module=${l1.module} 与文件名不符`))
    }

    for (const entity of l1.entities) {
      for (const dup of duplicates(entity.fields.map((field) => field.name))) {
        issues.push(issue("warning", "dup-field", `entity ${entity.id} 字段重复: ${dup}`))
      }

      for (const dup of duplicates(entity.methods.map((method) => method.name))) {
        issues.push(issue("warning", "dup-method", `entity ${entity.id} 方法重复: ${dup}`))
      }
    }
  }
}

function checkEntityRelations(arch: Arch, issues: Issue[]): void {
  const entities = archAllEntities(arch)

  for (const [moduleID, l1] of Object.entries(arch.l1)) {
    for (const entity of l1.entities) {
      for (const relation of entity.relations) {
        const target = entities[relation.target]

        if (!target) {
          issues.push(
            issue("error", "ref-relation", `entity ${entity.id} 的 relation 指向不存在的实体: ${relation.target}`),
          )
          continue
        }

        if (target.expose === "internal" && archFirstModuleOf(arch, relation.target) !== moduleID) {
          issues.push(
            issue("warning", "internal-ref", `entity ${entity.id} 跨模块引用了 internal 实体 ${relation.target}`),
          )
        }
      }

      if (entity.location.file.startsWith("/")) {
        issues.push(
          issue(
            "warning",
            "abs-location",
            `entity ${entity.id} location.file 应为相对项目根路径: ${entity.location.file}`,
          ),
        )
      }
    }
  }
}

function checkPublicEntities(arch: Arch, issues: Issue[]): void {
  for (const module of arch.l0.modules) {
    const l1 = arch.l1[module.id]

    for (const entityID of module.public_entities) {
      const owner = archFirstModuleOf(arch, entityID)

      if (!owner) {
        issues.push(issue("error", "ref-public", `module ${module.id} public_entities 指向不存在的实体: ${entityID}`))
        continue
      }

      if (owner !== module.id) {
        issues.push(
          issue(
            "error",
            "ref-public-owner",
            `module ${module.id} 的 public_entities 包含其他模块的实体: ${entityID} (属于 ${owner})`,
          ),
        )
        continue
      }

      const entity = l1 ? l1Entity(l1, entityID) : undefined
      if (entity && entity.expose !== "public") {
        issues.push(
          issue("warning", "public-internal", `module ${module.id} 把 internal 实体 ${entityID} 声明为 public`),
        )
      }
    }
  }
}

function checkLayerConstraints(arch: Arch, issues: Issue[]): void {
  for (const constraint of arch.l0.constraints) {
    if (constraint.kind !== "layer-dependency" || !constraint.forbidden) continue

    for (const module of arch.l0.modules) {
      if (!constraint.from_layers.includes(module.layer)) continue

      for (const dependency of module.depends_on) {
        const target = l0Module(arch.l0, dependency)

        if (target && constraint.to_layers.includes(target.layer)) {
          issues.push(
            issue(
              "error",
              "layer-violation",
              `违反约束 ${constraint.id}: 模块 ${module.id}(layer=${module.layer}) 依赖了 ${target.id}(layer=${target.layer})`,
            ),
          )
        }
      }
    }
  }
}

function checkDisk(arch: Arch, root: string, issues: Issue[]): void {
  for (const l1 of Object.values(arch.l1)) {
    for (const entity of l1.entities) {
      if (entity.status !== "active") continue

      if (
        !existsSync(isAbsolute(entity.location.file) ? resolve(entity.location.file) : join(root, entity.location.file))
      ) {
        issues.push(
          issue(
            "error",
            "location-missing",
            `entity ${entity.id} 的 location.file 不存在: ${entity.location.file}`,
            entity.location.file,
          ),
        )
      }
    }
  }

  for (const module of arch.l0.modules) {
    if (module.status === "active" && !existsSync(join(root, module.path))) {
      issues.push(
        issue("error", "module-path-missing", `模块 ${module.id} 的 path 不存在: ${module.path}`, module.path),
      )
    }
  }
}

/** Validate an architecture snapshot without reading the project tree unless `checkDisk` is enabled. */
export function validateArch(arch: Arch, options: ValidateOptions = {}): Issue[] {
  const issues: Issue[] = []
  const l0 = arch.l0
  const entityIDs = Object.values(arch.l1).flatMap((l1) => l1.entities.map((entity: Entity) => entity.id))

  for (const item of l0.packages) checkID(item.id, "pkg", "package", `package ${item.id}`, issues)
  for (const item of l0.modules) checkID(item.id, "mod", "module", `module ${item.id}`, issues)
  for (const item of l0.constraints) checkID(item.id, "con", "constraint", `constraint ${item.id}`, issues)
  for (const item of l0.systems) checkID(item.id, "sys", "system", `system ${item.id}`, issues)
  for (const item of l0.externals) checkID(item.id, "ext", "external", `external ${item.id}`, issues)

  for (const [moduleID, l1] of Object.entries(arch.l1)) {
    for (const entity of l1.entities) {
      checkID(entity.id, KIND_PREFIX[entity.kind] ?? "ent", "entity", `${moduleID}/${entity.id}`, issues)
    }
  }

  checkDuplicate(
    l0.packages.map((item) => item.id),
    "package",
    issues,
  )
  checkDuplicate(
    l0.modules.map((item) => item.id),
    "module",
    issues,
  )
  checkDuplicate(
    l0.constraints.map((item) => item.id),
    "constraint",
    issues,
  )
  checkDuplicate(
    l0.systems.map((item) => item.id),
    "system",
    issues,
  )
  checkDuplicate(
    l0.externals.map((item) => item.id),
    "external",
    issues,
  )
  checkDuplicate(
    l0.layers.map((item) => item.id),
    "layer",
    issues,
  )
  checkDuplicate(entityIDs, "entity", issues)

  checkL0Refs(l0, issues)
  checkModuleRefs(l0, issues)
  checkL1Structure(arch, issues)
  checkEntityRelations(arch, issues)
  checkPublicEntities(arch, issues)
  checkLayerConstraints(arch, issues)

  if (options.checkDisk && options.root) checkDisk(arch, options.root, issues)

  return issues
}
