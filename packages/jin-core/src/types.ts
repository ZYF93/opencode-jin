export const ENTITY_KINDS = [
  "entity",
  "class",
  "interface",
  "enum",
  "record",
  "object",
  "type",
  "function",
  "component",
  "hook",
  "page",
  "store",
  "route",
  "command",
  "job",
  "handler",
  "middleware",
  "table",
  "schema",
  "message",
  "config",
] as const

export type EntityKind = (typeof ENTITY_KINDS)[number]

export const KIND_PREFIX: Record<EntityKind, string> = {
  entity: "ent",
  class: "cls",
  interface: "ifc",
  enum: "enum",
  function: "fn",
  type: "typ",
  component: "cmp",
  record: "rec",
  object: "obj",
  hook: "hook",
  page: "page",
  store: "store",
  route: "route",
  command: "cmd",
  job: "job",
  handler: "hnd",
  middleware: "mw",
  table: "tbl",
  schema: "sch",
  message: "msg",
  config: "cfg",
}

export const MODULE_STATUSES = ["active", "planned", "deprecated"] as const
export type ModuleStatus = (typeof MODULE_STATUSES)[number]

export const ENTITY_STATUSES = ["active", "planned", "deprecated"] as const
export type EntityStatus = (typeof ENTITY_STATUSES)[number]

export const EXPOSE_KINDS = ["public", "internal"] as const
export type ExposeKind = (typeof EXPOSE_KINDS)[number]

export const RELATION_TYPES = [
  "uses",
  "implements",
  "extends",
  "references",
  "renders",
  "emits",
  "subscribes",
  "reads",
  "writes",
] as const

export type RelationType = (typeof RELATION_TYPES)[number]

export const CONSTRAINT_KINDS = ["layer-dependency"] as const
export type ConstraintKind = (typeof CONSTRAINT_KINDS)[number]

export const SYSTEM_KINDS = ["backend", "frontend", "worker", "cli", "library", "mobile", "other"] as const
export type SystemKind = (typeof SYSTEM_KINDS)[number]

export const EXTERNAL_KINDS = ["database", "cache", "queue", "storage", "api", "auth", "search", "other"] as const
export type ExternalKind = (typeof EXTERNAL_KINDS)[number]

export const DECISIONS = ["approved", "rejected"] as const
export type DecisionKind = (typeof DECISIONS)[number]

export const PROPOSAL_STATUSES = ["draft", "in_review", "approved", "rejected", "applied"] as const
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number]

export interface ProjectInfo {
  name: string
  description: string
  languages: string[]
}

export interface PackageInfo {
  id: string
  name: string
  path: string
  responsibility: string
}

export interface SystemInfo {
  id: string
  name: string
  kind: SystemKind
  path: string
  responsibility: string
  depends_on: string[]
}

export interface ExternalInfo {
  id: string
  name: string
  kind: ExternalKind
  provider: string
  description: string
}

export interface Layer {
  id: string
  name: string
  description: string
}

export interface ModuleInfo {
  id: string
  name: string
  package: string
  path: string
  responsibility: string
  layer: string
  system: string
  depends_on: string[]
  uses_externals: string[]
  public_entities: string[]
  status: ModuleStatus
}

export interface Constraint {
  id: string
  kind: ConstraintKind
  description: string
  from_layers: string[]
  to_layers: string[]
  forbidden: boolean
}

export interface L0 {
  version: number
  project: ProjectInfo
  systems: SystemInfo[]
  packages: PackageInfo[]
  modules: ModuleInfo[]
  externals: ExternalInfo[]
  layers: Layer[]
  constraints: Constraint[]
}

export interface Location {
  file: string
  symbol: string
}

export interface FieldSpec {
  name: string
  type: string
  description: string
}

export interface MethodSpec {
  name: string
  signature: string
  description: string
}

export interface Relation {
  type: RelationType
  target: string
}

export interface Entity {
  id: string
  kind: EntityKind
  name: string
  location: Location
  responsibility: string
  expose: ExposeKind
  status: EntityStatus
  fields: FieldSpec[]
  methods: MethodSpec[]
  relations: Relation[]
}

export interface L1 {
  version: number
  module: string
  entities: Entity[]
}

export interface Arch {
  l0: L0
  l1: Record<string, L1>
}

export interface AppliedRef {
  version: number
  at: string
}

export interface ProposalMeta {
  id: string
  title: string
  description: string
  acceptance: string[]
  scope: string[]
  author: string
  created_at: string
  updated_at: string
  status: ProposalStatus
  base_hash: string
  applied: AppliedRef | null
}

export interface VersionSummary {
  req: string
  version: number
  summary: string[]
  rationale: string
  created_at: string
}

export interface Decision {
  req: string
  version: number
  decision: DecisionKind
  comments: string
  decided_by: string
  decided_at: string
  /** Hash of the approved target snapshot, so approval cannot be replayed onto edited files. */
  target_hash?: string
  /** Server signature over the decision and its target hash; agents cannot forge it. */
  signature?: string
}

export interface HistoryEntry {
  req: string
  title: string
  applied_version: number
  decided_at: string
  applied_at: string
  summary: Record<string, unknown>
}
