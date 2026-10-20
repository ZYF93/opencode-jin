import {
  archAllEntities,
  constraintToDict,
  entityToDict,
  externalToDict,
  fieldToDict,
  layerToDict,
  methodToDict,
  moduleToDict,
  packageToDict,
  projectToDict,
  relationToDict,
  systemToDict,
} from "./model"
import type {
  Arch,
  Constraint,
  Entity,
  ExternalInfo,
  Layer,
  ModuleInfo,
  PackageInfo,
  Relation,
  SystemInfo,
} from "./types"

type Dict = Record<string, unknown>
type Change = "added" | "removed" | "changed" | "moved"

export interface DiffCounts {
  added: number
  removed: number
  changed: number
  moved: number
}

export interface DiffSummary {
  systems: DiffCounts
  packages: DiffCounts
  modules: DiffCounts
  entities: DiffCounts
  externals: DiffCounts
  layers: DiffCounts
  constraints: DiffCounts
  members: DiffCounts
  total_changes: number
}

export interface ArchDiff {
  project: { from: Dict; to: Dict; changes: Dict }
  summary: DiffSummary
  systems: Dict[]
  packages: Dict[]
  modules: Dict[]
  entities: Dict[]
  externals: Dict[]
  layers: Dict[]
  constraints: Dict[]
  changed_files: string[]
}

function equal(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function scalarChanges(before: Dict, after: Dict, keys: string[]): Dict {
  const changes: Dict = {}

  for (const key of keys) {
    if (!equal(before[key], after[key])) {
      changes[key] = {
        from: before[key] === undefined ? null : before[key],
        to: after[key] === undefined ? null : after[key],
      }
    }
  }

  return changes
}

function listDiff(before: string[], after: string[]): { added: string[]; removed: string[] } {
  const beforeSet = new Set(before)
  const afterSet = new Set(after)

  return {
    added: [...afterSet].filter((item) => !beforeSet.has(item)).sort(),
    removed: [...beforeSet].filter((item) => !afterSet.has(item)).sort(),
  }
}

interface ItemsDiff {
  added: Dict[]
  removed: Dict[]
  changed: { name: string; changes: Dict }[]
}

interface RelationsDiff {
  added: Dict[]
  removed: Dict[]
}

function itemsDiff(before: Dict[], after: Dict[], key: string): ItemsDiff {
  const beforeMap = new Map(before.map((item) => [String(item[key]), item]))
  const afterMap = new Map(after.map((item) => [String(item[key]), item]))
  const added = [...afterMap.keys()]
    .filter((name) => !beforeMap.has(name))
    .map((name) => afterMap.get(name)!)
    .sort((left, right) => String(left[key]).localeCompare(String(right[key])))
  const removed = [...beforeMap.keys()]
    .filter((name) => !afterMap.has(name))
    .map((name) => beforeMap.get(name)!)
    .sort((left, right) => String(left[key]).localeCompare(String(right[key])))
  const changed = [...beforeMap.keys()]
    .filter((name) => afterMap.has(name))
    .map((name) => {
      const left = beforeMap.get(name)!
      const right = afterMap.get(name)!
      const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].filter((item) => item !== key)
      const changes = scalarChanges(left, right, keys)

      return Object.keys(changes).length ? { name, changes } : undefined
    })
    .filter((item): item is { name: string; changes: Dict } => item !== undefined)
    .sort((left, right) => left.name.localeCompare(right.name))

  return { added, removed, changed }
}

function relationKey(relation: Relation): string {
  return JSON.stringify([relation.type, relation.target])
}

function relationsDiff(before: Entity, after: Entity): RelationsDiff {
  const beforeMap = new Map(before.relations.map((relation) => [relationKey(relation), relationToDict(relation)]))
  const afterMap = new Map(after.relations.map((relation) => [relationKey(relation), relationToDict(relation)]))

  return {
    added: [...afterMap.keys()]
      .filter((key) => !beforeMap.has(key))
      .sort()
      .map((key) => afterMap.get(key)!),
    removed: [...beforeMap.keys()]
      .filter((key) => !afterMap.has(key))
      .sort()
      .map((key) => beforeMap.get(key)!),
  }
}

function packageEntry(change: Change, item: PackageInfo, base?: PackageInfo): Dict {
  const entry: Dict = { id: item.id, change }

  if (change === "changed" && base) {
    entry.fields = scalarChanges(packageToDict(base), packageToDict(item), ["name", "path", "responsibility"])
  }

  entry.from = base ? packageToDict(base) : null
  entry.to = packageToDict(item)

  return entry
}

function systemEntry(change: Change, item: SystemInfo, base?: SystemInfo): Dict {
  const entry: Dict = { id: item.id, change }

  if (change === "changed" && base) {
    entry.fields = scalarChanges(systemToDict(base), systemToDict(item), ["name", "kind", "path", "responsibility"])
    const dependsOn = listDiff(base.depends_on, item.depends_on)
    if (dependsOn.added.length || dependsOn.removed.length) entry.depends_on = dependsOn
  }

  entry.from = base ? systemToDict(base) : null
  entry.to = systemToDict(item)

  return entry
}

function externalEntry(change: Change, item: ExternalInfo, base?: ExternalInfo): Dict {
  const entry: Dict = { id: item.id, change }

  if (change === "changed" && base) {
    entry.fields = scalarChanges(externalToDict(base), externalToDict(item), [
      "name",
      "kind",
      "provider",
      "description",
    ])
  }

  entry.from = base ? externalToDict(base) : null
  entry.to = externalToDict(item)

  return entry
}

function layerEntry(change: Change, item: Layer, base?: Layer): Dict {
  const entry: Dict = { id: item.id, change }

  if (change === "changed" && base) {
    entry.fields = scalarChanges(layerToDict(base), layerToDict(item), ["name", "description"])
  }

  entry.from = base ? layerToDict(base) : null
  entry.to = layerToDict(item)

  return entry
}

function moduleEntry(change: Change, item: ModuleInfo, base?: ModuleInfo): Dict {
  const entry: Dict = { id: item.id, change }

  if (change === "changed" && base) {
    entry.fields = scalarChanges(moduleToDict(base), moduleToDict(item), [
      "name",
      "package",
      "path",
      "layer",
      "system",
      "responsibility",
      "status",
    ])
    const dependsOn = listDiff(base.depends_on, item.depends_on)
    const publicEntities = listDiff(base.public_entities, item.public_entities)
    const usesExternals = listDiff(base.uses_externals, item.uses_externals)
    if (dependsOn.added.length || dependsOn.removed.length) entry.depends_on = dependsOn
    if (publicEntities.added.length || publicEntities.removed.length) entry.public_entities = publicEntities
    if (usesExternals.added.length || usesExternals.removed.length) entry.uses_externals = usesExternals
  }

  entry.from = base ? moduleToDict(base) : null
  entry.to = moduleToDict(item)

  return entry
}

function entityEntry(
  change: Change,
  item: Entity,
  base: Entity | undefined,
  module: string,
  baseModule?: string,
): Dict {
  const entry: Dict = { id: item.id, module, change }

  if (baseModule !== undefined && baseModule !== module) entry.from_module = baseModule

  if (change === "changed" && base) {
    entry.fields = scalarChanges(entityToDict(base), entityToDict(item), [
      "name",
      "kind",
      "location",
      "responsibility",
      "expose",
      "status",
    ])
    const fieldDiffs = itemsDiff(base.fields.map(fieldToDict), item.fields.map(fieldToDict), "name")
    const methodDiffs = itemsDiff(base.methods.map(methodToDict), item.methods.map(methodToDict), "name")
    const relations = relationsDiff(base, item)
    entry.field_diffs = fieldDiffs
    entry.method_diffs = methodDiffs
    if (relations.added.length || relations.removed.length) entry.relations = relations

    const counts = {
      added: fieldDiffs.added.length + methodDiffs.added.length + relations.added.length,
      removed: fieldDiffs.removed.length + methodDiffs.removed.length + relations.removed.length,
      changed: fieldDiffs.changed.length + methodDiffs.changed.length,
    }

    if (counts.added || counts.removed || counts.changed) entry.member_counts = counts
  }

  entry.from = base ? entityToDict(base) : null
  entry.to = entityToDict(item)

  return entry
}

function constraintEntry(change: Change, item: Constraint, base?: Constraint): Dict {
  const entry: Dict = { id: item.id, change }

  if (change === "changed" && base) {
    entry.fields = scalarChanges(constraintToDict(base), constraintToDict(item), [
      "description",
      "from_layers",
      "to_layers",
      "forbidden",
    ])
  }

  entry.from = base ? constraintToDict(base) : null
  entry.to = constraintToDict(item)

  return entry
}

function keys<T>(left: Map<string, T>, right: Map<string, T>): string[] {
  return [...new Set([...left.keys(), ...right.keys()])].sort()
}

function counts(entries: Dict[]): DiffCounts {
  const result: DiffCounts = { added: 0, removed: 0, changed: 0, moved: 0 }

  for (const entry of entries) {
    const change = entry.change as Change
    result[change] += 1
  }

  return result
}

function entityModules(arch: Arch): Map<string, string> {
  return new Map(
    Object.entries(arch.l1).flatMap(([module, l1]) => l1.entities.map((entity) => [entity.id, module] as const)),
  )
}

function locationFile(entry: Dict | null): string | undefined {
  if (!entry || typeof entry !== "object") return undefined

  const location = entry.location
  if (!location || typeof location !== "object") return undefined

  const file = (location as Dict).file
  return typeof file === "string" ? file : undefined
}

export function diffArch(base: Arch, target: Arch): ArchDiff {
  const packages: Dict[] = []
  const systems: Dict[] = []
  const modules: Dict[] = []
  const entities: Dict[] = []
  const externals: Dict[] = []
  const layers: Dict[] = []
  const constraints: Dict[] = []

  const basePackages = new Map(base.l0.packages.map((item) => [item.id, item]))
  const targetPackages = new Map(target.l0.packages.map((item) => [item.id, item]))
  for (const id of keys(basePackages, targetPackages)) {
    const before = basePackages.get(id)
    const after = targetPackages.get(id)
    if (!after) packages.push(packageEntry("removed", before!, before))
    else if (!before) packages.push(packageEntry("added", after))
    else if (!equal(packageToDict(before), packageToDict(after))) packages.push(packageEntry("changed", after, before))
  }

  const baseSystems = new Map(base.l0.systems.map((item) => [item.id, item]))
  const targetSystems = new Map(target.l0.systems.map((item) => [item.id, item]))
  for (const id of keys(baseSystems, targetSystems)) {
    const before = baseSystems.get(id)
    const after = targetSystems.get(id)
    if (!after) systems.push(systemEntry("removed", before!, before))
    else if (!before) systems.push(systemEntry("added", after))
    else if (!equal(systemToDict(before), systemToDict(after))) systems.push(systemEntry("changed", after, before))
  }

  const baseExternals = new Map(base.l0.externals.map((item) => [item.id, item]))
  const targetExternals = new Map(target.l0.externals.map((item) => [item.id, item]))
  for (const id of keys(baseExternals, targetExternals)) {
    const before = baseExternals.get(id)
    const after = targetExternals.get(id)
    if (!after) externals.push(externalEntry("removed", before!, before))
    else if (!before) externals.push(externalEntry("added", after))
    else if (!equal(externalToDict(before), externalToDict(after)))
      externals.push(externalEntry("changed", after, before))
  }

  const baseLayers = new Map(base.l0.layers.map((item) => [item.id, item]))
  const targetLayers = new Map(target.l0.layers.map((item) => [item.id, item]))
  for (const id of keys(baseLayers, targetLayers)) {
    const before = baseLayers.get(id)
    const after = targetLayers.get(id)
    if (!after) layers.push(layerEntry("removed", before!, before))
    else if (!before) layers.push(layerEntry("added", after))
    else if (!equal(layerToDict(before), layerToDict(after))) layers.push(layerEntry("changed", after, before))
  }

  const baseModules = new Map(base.l0.modules.map((item) => [item.id, item]))
  const targetModules = new Map(target.l0.modules.map((item) => [item.id, item]))
  for (const id of keys(baseModules, targetModules)) {
    const before = baseModules.get(id)
    const after = targetModules.get(id)
    if (!after) modules.push(moduleEntry("removed", before!, before))
    else if (!before) modules.push(moduleEntry("added", after))
    else if (!equal(moduleToDict(before), moduleToDict(after))) modules.push(moduleEntry("changed", after, before))
  }

  const baseEntities = archAllEntities(base)
  const targetEntities = archAllEntities(target)
  const baseEntityModules = entityModules(base)
  const targetEntityModules = entityModules(target)
  for (const id of Object.keys({ ...baseEntities, ...targetEntities }).sort()) {
    const before = baseEntities[id]
    const after = targetEntities[id]
    const beforeModule = baseEntityModules.get(id)
    const targetModule = targetEntityModules.get(id)

    if (!after) entities.push(entityEntry("removed", before!, before, beforeModule ?? ""))
    else if (!before) entities.push(entityEntry("added", after, undefined, targetModule ?? ""))
    else if (beforeModule !== targetModule) {
      entities.push(entityEntry("moved", after, before, targetModule ?? "", beforeModule))
    } else if (!equal(entityToDict(before), entityToDict(after))) {
      entities.push(entityEntry("changed", after, before, targetModule ?? "", beforeModule))
    }
  }

  const baseConstraints = new Map(base.l0.constraints.map((item) => [item.id, item]))
  const targetConstraints = new Map(target.l0.constraints.map((item) => [item.id, item]))
  for (const id of keys(baseConstraints, targetConstraints)) {
    const before = baseConstraints.get(id)
    const after = targetConstraints.get(id)
    if (!after) constraints.push(constraintEntry("removed", before!, before))
    else if (!before) constraints.push(constraintEntry("added", after))
    else if (!equal(constraintToDict(before), constraintToDict(after))) {
      constraints.push(constraintEntry("changed", after, before))
    }
  }

  const members: DiffCounts = { added: 0, removed: 0, changed: 0, moved: 0 }
  for (const entry of entities) {
    const counts = entry.member_counts as { added: number; removed: number; changed: number } | undefined
    if (!counts) continue
    members.added += counts.added
    members.removed += counts.removed
    members.changed += counts.changed
  }

  const summary: DiffSummary = {
    systems: counts(systems),
    packages: counts(packages),
    modules: counts(modules),
    entities: counts(entities),
    externals: counts(externals),
    layers: counts(layers),
    constraints: counts(constraints),
    members,
    total_changes: 0,
  }
  summary.total_changes =
    summary.systems.added +
    summary.systems.removed +
    summary.systems.changed +
    summary.systems.moved +
    summary.packages.added +
    summary.packages.removed +
    summary.packages.changed +
    summary.packages.moved +
    summary.modules.added +
    summary.modules.removed +
    summary.modules.changed +
    summary.modules.moved +
    summary.entities.added +
    summary.entities.removed +
    summary.entities.changed +
    summary.entities.moved +
    summary.externals.added +
    summary.externals.removed +
    summary.externals.changed +
    summary.externals.moved +
    summary.layers.added +
    summary.layers.removed +
    summary.layers.changed +
    summary.layers.moved +
    summary.constraints.added +
    summary.constraints.removed +
    summary.constraints.changed +
    summary.constraints.moved

  const files = new Set<string>()
  for (const entry of entities) {
    for (const side of ["from", "to"] as const) {
      const file = locationFile(entry[side] as Dict | null)
      if (file) files.add(file)
    }
  }

  return {
    project: {
      from: projectToDict(base.l0.project),
      to: projectToDict(target.l0.project),
      changes: scalarChanges(projectToDict(base.l0.project), projectToDict(target.l0.project), [
        "name",
        "description",
        "languages",
      ]),
    },
    summary,
    systems,
    packages,
    modules,
    entities,
    externals,
    layers,
    constraints,
    changed_files: [...files].sort(),
  }
}

export function isDiffEmpty(diff: ArchDiff): boolean {
  return diff.summary.total_changes === 0
}
