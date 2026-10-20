import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs"
import { join } from "node:path"
import { diffArch, type ArchDiff } from "./diff"
import { JinError } from "./error"
import { REQ_RE, archHash, l0ToDict, l1ToDict, parseL0, parseL1, saveArchDir, nowISO } from "./model"
import type { Project } from "./project"
import {
  DECISIONS,
  PROPOSAL_STATUSES,
  type AppliedRef,
  type Arch,
  type Decision,
  type DecisionKind,
  type HistoryEntry,
  type ProposalMeta,
  type ProposalStatus,
  type VersionSummary,
} from "./types"
import { dumpYaml, loadYaml } from "./yaml"

const VERSION_DIR_RE = /^v(\d+)$/

const META_KEYS = new Set([
  "id",
  "title",
  "description",
  "acceptance",
  "scope",
  "author",
  "created_at",
  "updated_at",
  "status",
  "base_hash",
  "applied",
])
const SUMMARY_KEYS = new Set(["req", "version", "summary", "rationale", "created_at"])
const DECISION_KEYS = new Set([
  "req",
  "version",
  "decision",
  "comments",
  "decided_by",
  "decided_at",
  "target_hash",
  "signature",
])
const HISTORY_KEYS = new Set(["req", "title", "applied_version", "decided_at", "applied_at", "summary"])

type Dict = Record<string, unknown>

/** Server-owned signing and verification for approval decisions. */
export interface DecisionAuthentication {
  sign(decision: Decision): string
  verify(decision: Decision): boolean
}

function record(value: unknown, where: string): Dict {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new JinError(`${where}: 顶层必须是映射`)
  return value as Dict
}

function checkKeys(value: Dict, allowed: Set<string>, where: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new JinError(`${where}: 未知字段 ${key}`)
  }
}

function stringValue(value: unknown, fallback: string, where: string): string {
  if (value === undefined) return fallback
  if (typeof value !== "string") throw new JinError(`${where} 必须是字符串`)
  return value
}

function intValue(value: unknown, fallback: number, where: string): number {
  if (value === undefined) return fallback
  if (typeof value === "number" && Number.isInteger(value)) return value
  if (typeof value === "string" && /^-?\d+$/.test(value)) return Number(value)
  throw new JinError(`${where} 必须是整数`)
}

function stringArray(value: unknown, where: string): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new JinError(`${where} 必须是数组`)
  return value.map((item, index) => {
    if (typeof item !== "string") throw new JinError(`${where}[${index}] 必须是字符串`)
    return item
  })
}

function parseStatus(value: unknown, where: string): ProposalStatus {
  if (value === undefined) return "draft"
  if (typeof value !== "string" || !PROPOSAL_STATUSES.includes(value as ProposalStatus)) {
    throw new JinError(`${where} 非法: ${String(value)}`)
  }
  return value as ProposalStatus
}

function parseApplied(value: unknown, where: string): AppliedRef | null {
  if (value === undefined || value === null) return null
  const data = record(value, where)

  return {
    version: intValue(data.version, 1, `${where}.version`),
    at: stringValue(data.at, "", `${where}.at`),
  }
}

export function checkReq(req: string): string {
  if (!REQ_RE.test(req))
    throw new JinError(`需求编号非法: ${JSON.stringify(req)}（格式如 REQ-001、REQ-order-priority）`)
  return req
}

export function proposalDir(project: Project, req: string): string {
  return join(project.proposalsDir, checkReq(req))
}

export function versionDir(project: Project, req: string, version: number): string {
  return join(proposalDir(project, req), "versions", `v${version}`)
}

export function decisionsDir(project: Project, req: string): string {
  return join(proposalDir(project, req), "decisions")
}

export function listVersions(project: Project, req: string): number[] {
  const versionsDir = join(proposalDir(project, req), "versions")
  if (!existsSync(versionsDir)) return []

  return readdirSync(versionsDir)
    .filter((name) => VERSION_DIR_RE.test(name) && statSync(join(versionsDir, name)).isDirectory())
    .map((name) => Number(VERSION_DIR_RE.exec(name)![1]))
    .sort((left, right) => left - right)
}

export function latestVersion(project: Project, req: string): number {
  const versions = listVersions(project, req)
  if (!versions.length) throw new JinError(`提案 ${req} 没有任何版本`)
  return versions[versions.length - 1]!
}

export function parseProposalMeta(value: unknown): ProposalMeta {
  const data = record(value, "proposal meta")
  checkKeys(data, META_KEYS, "proposal meta")
  const id = stringValue(data.id, "", "proposal meta.id")
  if (!id) throw new JinError("proposal meta.id 必填")

  return {
    id,
    title: stringValue(data.title, "", "proposal meta.title"),
    description: stringValue(data.description, "", "proposal meta.description"),
    acceptance: stringArray(data.acceptance, "proposal meta.acceptance"),
    scope: stringArray(data.scope, "proposal meta.scope"),
    author: stringValue(data.author, "", "proposal meta.author"),
    created_at: stringValue(data.created_at, nowISO(), "proposal meta.created_at"),
    updated_at: stringValue(data.updated_at, nowISO(), "proposal meta.updated_at"),
    status: parseStatus(data.status, "proposal meta.status"),
    base_hash: stringValue(data.base_hash, "", "proposal meta.base_hash"),
    applied: parseApplied(data.applied, "proposal meta.applied"),
  }
}

export function proposalMetaToDict(meta: ProposalMeta): Dict {
  const data: Dict = {
    id: meta.id,
    title: meta.title,
    description: meta.description,
  }
  if (meta.acceptance.length) data.acceptance = meta.acceptance
  if (meta.scope.length) data.scope = meta.scope
  if (meta.author) data.author = meta.author
  data.created_at = meta.created_at
  data.updated_at = meta.updated_at
  data.status = meta.status
  if (meta.base_hash) data.base_hash = meta.base_hash
  if (meta.applied) data.applied = meta.applied
  return data
}

export function parseVersionSummary(value: unknown): VersionSummary {
  const data = record(value, "summary")
  checkKeys(data, SUMMARY_KEYS, "summary")

  return {
    req: stringValue(data.req, "", "summary.req"),
    version: intValue(data.version, 1, "summary.version"),
    summary: stringArray(data.summary, "summary.summary"),
    rationale: stringValue(data.rationale, "", "summary.rationale"),
    created_at: stringValue(data.created_at, nowISO(), "summary.created_at"),
  }
}

export function versionSummaryToDict(summary: VersionSummary): Dict {
  return {
    req: summary.req,
    version: summary.version,
    summary: summary.summary,
    rationale: summary.rationale,
    created_at: summary.created_at,
  }
}

export function parseDecision(value: unknown): Decision {
  const data = record(value, "decision")
  checkKeys(data, DECISION_KEYS, "decision")
  const decision = data.decision
  if (typeof decision !== "string" || !DECISIONS.includes(decision as DecisionKind)) {
    throw new JinError(`decision 非法: ${String(decision)} (支持: ${DECISIONS.join(", ")})`)
  }

  return {
    req: stringValue(data.req, "", "decision.req"),
    version: intValue(data.version, 1, "decision.version"),
    decision: decision as DecisionKind,
    comments: stringValue(data.comments, "", "decision.comments"),
    decided_by: stringValue(data.decided_by, "", "decision.decided_by"),
    decided_at: stringValue(data.decided_at, nowISO(), "decision.decided_at"),
    target_hash: stringValue(data.target_hash, "", "decision.target_hash") || undefined,
    signature: stringValue(data.signature, "", "decision.signature") || undefined,
  }
}

export function decisionToDict(decision: Decision): Dict {
  const data: Dict = {
    req: decision.req,
    version: decision.version,
    decision: decision.decision,
    comments: decision.comments,
    decided_by: decision.decided_by,
    decided_at: decision.decided_at,
  }
  if (decision.target_hash) data.target_hash = decision.target_hash
  if (decision.signature) data.signature = decision.signature
  return data
}

export function parseHistoryEntry(value: unknown): HistoryEntry {
  const data = record(value, "history")
  checkKeys(data, HISTORY_KEYS, "history")

  return {
    req: stringValue(data.req, "", "history.req"),
    title: stringValue(data.title, "", "history.title"),
    applied_version: intValue(data.applied_version, 1, "history.applied_version"),
    decided_at: stringValue(data.decided_at, "", "history.decided_at"),
    applied_at: stringValue(data.applied_at, nowISO(), "history.applied_at"),
    summary: data.summary === undefined ? {} : record(data.summary, "history.summary"),
  }
}

export function historyEntryToDict(entry: HistoryEntry): Dict {
  return {
    req: entry.req,
    title: entry.title,
    applied_version: entry.applied_version,
    decided_at: entry.decided_at,
    applied_at: entry.applied_at,
    summary: entry.summary,
  }
}

export function loadMeta(project: Project, req: string): ProposalMeta {
  const path = join(proposalDir(project, req), "meta.yaml")
  if (!existsSync(path)) throw new JinError(`提案不存在: ${req} (${path})`)
  return parseProposalMeta(loadYaml(path))
}

export function saveMeta(project: Project, meta: ProposalMeta): void {
  dumpYaml(proposalMetaToDict(meta), join(proposalDir(project, meta.id), "meta.yaml"))
}

export function loadSummary(project: Project, req: string, version: number): VersionSummary {
  const path = join(versionDir(project, req, version), "summary.yaml")
  if (!existsSync(path)) return { req, version, summary: [], rationale: "", created_at: nowISO() }
  return parseVersionSummary(loadYaml(path))
}

export function saveSummary(project: Project, summary: VersionSummary): void {
  dumpYaml(versionSummaryToDict(summary), join(versionDir(project, summary.req, summary.version), "summary.yaml"))
}

export function loadDecision(project: Project, req: string, version: number): Decision | null {
  const path = join(decisionsDir(project, req), `v${version}.yaml`)
  if (!existsSync(path)) return null
  return parseDecision(loadYaml(path))
}

export function recordDecision(
  project: Project,
  req: string,
  version: number,
  decision: DecisionKind,
  comments = "",
  decidedBy = "",
  authentication?: DecisionAuthentication,
  expectedTargetHash = "",
): Decision {
  const meta = loadMeta(project, req)
  if (meta.applied) throw new JinError(`提案 ${req} 已应用（version=${meta.applied.version}），不能再审批`)

  const versions = listVersions(project, req)
  if (!versions.includes(version)) throw new JinError(`提案 ${req} 不存在版本 v${version}`)
  if (version !== versions[versions.length - 1]) {
    throw new JinError(`只能审批最新版本（${req} 最新为 v${versions[versions.length - 1]}）；历史版本仅供查看`)
  }

  const targetHash = archHash(loadTargetArch(project, req, version))
  if (expectedTargetHash && expectedTargetHash !== targetHash) {
    throw new JinError(`提案 ${req} v${version} 的目标快照在审阅后已变化，请刷新后重新批准`)
  }

  const result: Decision = {
    req,
    version,
    decision,
    comments,
    decided_by: decidedBy,
    decided_at: nowISO(),
    target_hash: targetHash,
  }
  if (authentication) result.signature = authentication.sign(result)
  dumpYaml(decisionToDict(result), join(decisionsDir(project, req), `v${version}.yaml`))
  meta.status = decision
  meta.updated_at = result.decided_at
  saveMeta(project, meta)
  return result
}

export function loadTargetArch(project: Project, req: string, version: number): Arch {
  const dir = versionDir(project, req, version)
  if (!existsSync(dir)) throw new JinError(`提案 ${req} 不存在版本 v${version}`)
  return loadTarget(dir)
}

function loadTarget(dir: string): Arch {
  const l0Path = join(dir, "target-L0.yaml")
  if (!existsSync(l0Path)) throw new JinError(`提案版本缺少 target-L0.yaml: ${dir}`)

  const arch: Arch = { l0: parseL0(loadYaml(l0Path)), l1: {} }
  const l1Dir = join(dir, "target-L1")

  if (existsSync(l1Dir)) {
    for (const name of readdirSync(l1Dir)
      .filter((item) => item.endsWith(".yaml"))
      .sort()) {
      const l1 = parseL1(loadYaml(join(l1Dir, name)))
      arch.l1[l1.module] = l1
    }
  }

  return arch
}

export function saveTarget(arch: Arch, dir: string): void {
  mkdirSync(dir, { recursive: true })
  dumpYaml(l0ToDict(arch.l0), join(dir, "target-L0.yaml"))

  const l1Dir = join(dir, "target-L1")
  if (existsSync(l1Dir)) rmSync(l1Dir, { recursive: true, force: true })
  mkdirSync(l1Dir, { recursive: true })

  for (const [module, l1] of Object.entries(arch.l1).sort(([left], [right]) => left.localeCompare(right))) {
    dumpYaml(l1ToDict(l1), join(l1Dir, `${module}.yaml`))
  }
}

export function createProposal(
  project: Project,
  req: string,
  title: string,
  description = "",
  acceptance: readonly string[] = [],
  scope: readonly string[] = [],
  author = "",
): ProposalMeta {
  checkReq(req)
  const dir = proposalDir(project, req)
  if (existsSync(dir)) throw new JinError(`提案已存在: ${req}`)

  const arch = project.ensureArch()
  const meta: ProposalMeta = {
    id: req,
    title,
    description,
    acceptance: [...acceptance],
    scope: [...scope],
    author,
    created_at: nowISO(),
    updated_at: nowISO(),
    status: "draft",
    base_hash: archHash(arch),
    applied: null,
  }
  mkdirSync(dir, { recursive: true })
  saveMeta(project, meta)
  saveTarget(arch, versionDir(project, req, 1))
  saveSummary(project, { req, version: 1, summary: [], rationale: "", created_at: nowISO() })
  return meta
}

export function reviseProposal(project: Project, req: string, seed: "previous" | "current" = "previous"): number {
  const meta = loadMeta(project, req)
  if (meta.applied) throw new JinError(`提案 ${req} 已应用，不能再修订`)

  const versions = listVersions(project, req)
  if (!versions.length) throw new JinError(`提案 ${req} 没有任何版本`)

  const version = versions[versions.length - 1]! + 1
  const arch = seed === "current" ? project.ensureArch() : loadTargetArch(project, req, versions[versions.length - 1]!)
  if (seed === "current") meta.base_hash = archHash(arch)

  saveTarget(arch, versionDir(project, req, version))
  const summary: VersionSummary = { req, version, summary: [], rationale: "", created_at: nowISO() }
  saveSummary(project, summary)
  meta.status = "draft"
  meta.updated_at = summary.created_at
  saveMeta(project, meta)
  return version
}

export function requestApproval(project: Project, req: string, version: number): ProposalMeta {
  const meta = loadMeta(project, req)
  if (meta.applied) throw new JinError(`提案 ${req} 已应用（version=${meta.applied.version}），不能再请求审批`)

  const versions = listVersions(project, req)
  if (!versions.includes(version)) throw new JinError(`提案 ${req} 不存在版本 v${version}`)
  if (version !== versions[versions.length - 1]) {
    throw new JinError(`只能请求审批最新版本（${req} 最新为 v${versions[versions.length - 1]}）；历史版本仅供查看`)
  }

  if (meta.status !== "in_review") {
    meta.status = "in_review"
    meta.updated_at = nowISO()
    saveMeta(project, meta)
  }
  return parseProposalMeta(proposalMetaToDict(meta))
}

export function applyVersion(
  project: Project,
  req: string,
  version: number,
  options: { force?: boolean; commit?: boolean; authentication?: DecisionAuthentication } = {},
): HistoryEntry {
  const meta = loadMeta(project, req)
  const decision = loadDecision(project, req, version)
  if (!meta.applied) {
    if (!decision || decision.decision !== "approved") {
      throw new JinError(`提案 ${req} v${version} 尚未获得批准（decision: approved）。先在审阅台或 jin decide 中批准`)
    }
    if (options.authentication && !options.authentication.verify(decision)) {
      throw new JinError(`提案 ${req} v${version} 的审批签名无效，拒绝应用`)
    }
  }

  const target = loadTargetArch(project, req, version)
  if (decision?.target_hash && decision.target_hash !== archHash(target)) {
    throw new JinError(`提案 ${req} v${version} 在批准后目标快照发生了变化，请重新审阅并批准`)
  }
  const current = project.ensureArch()
  const currentHash = archHash(current)

  if (meta.base_hash && currentHash !== meta.base_hash && !options.force) {
    throw new JinError(
      `当前架构在提案创建后已变化（base_hash ${meta.base_hash} ≠ ${currentHash}）。` +
        `请先 jin propose revise ${req} --seed current 基于最新架构重做，或加 --force 强制应用`,
    )
  }

  const diff = diffArch(current, target)
  saveArchDir(target, project.archDir)

  const entry: HistoryEntry = {
    req,
    title: meta.title,
    applied_version: version,
    decided_at: decision?.decided_at ?? "",
    applied_at: nowISO(),
    summary: {
      counts: diff.summary,
      modules_added: idsBy(diff.modules, "added"),
      modules_removed: idsBy(diff.modules, "removed"),
      modules_changed: idsBy(diff.modules, "changed"),
      entities_added: idsBy(diff.entities, "added"),
      entities_removed: idsBy(diff.entities, "removed"),
      entities_changed: idsBy(diff.entities, ["changed", "moved"]),
      changed_files: diff.changed_files,
    },
  }
  mkdirSync(project.historyDir, { recursive: true })
  dumpYaml(historyEntryToDict(entry), join(project.historyDir, `${req}.yaml`))

  meta.status = "applied"
  meta.applied = { version, at: entry.applied_at }
  meta.updated_at = entry.applied_at
  saveMeta(project, meta)

  if (options.commit) gitCommit(project, req, meta)
  return entry
}

function idsBy(entries: Dict[], change: string | string[]): string[] {
  const changes = Array.isArray(change) ? change : [change]
  return entries.filter((entry) => changes.includes(String(entry.change))).map((entry) => String(entry.id))
}

function gitCommit(project: Project, req: string, meta: ProposalMeta): void {
  const add = spawnSync("git", ["add", "arch"], { cwd: project.root, encoding: "utf8" })
  if (add.error) throw new JinError(`git 不可用，无法 --commit: ${add.error.message}`)
  if (add.status !== 0) throw new JinError(`git add 失败: ${add.stderr.trim()}`)

  const commit = spawnSync("git", ["commit", "-m", `arch(${req}): ${meta.title} [v${meta.applied?.version ?? "?"}]`], {
    cwd: project.root,
    encoding: "utf8",
  })
  if (commit.error) throw new JinError(`git 不可用，无法 --commit: ${commit.error.message}`)
  if (commit.status !== 0) throw new JinError(`git commit 失败: ${commit.stderr.trim()}`)
}

export interface ProposalListItem {
  req: string
  title: string
  status: ProposalStatus
  created_at: string
  updated_at: string
  versions: number[]
  latest_version: number | null
  decisions: Record<string, DecisionKind>
}

export function listProposals(project: Project): ProposalListItem[] {
  if (!existsSync(project.proposalsDir)) return []

  return readdirSync(project.proposalsDir)
    .filter((name) => {
      const dir = join(project.proposalsDir, name)
      return statSync(dir).isDirectory() && existsSync(join(dir, "meta.yaml"))
    })
    .sort()
    .flatMap((name) => {
      const meta = (() => {
        try {
          return loadMeta(project, name)
        } catch {
          return undefined
        }
      })()
      if (!meta) return []

      const versions = listVersions(project, name)
      const decisions: Record<string, DecisionKind> = {}
      for (const version of versions) {
        const decision = loadDecision(project, name, version)
        if (decision) decisions[`v${version}`] = decision.decision
      }

      return [
        {
          req: meta.id,
          title: meta.title,
          status: meta.status,
          created_at: meta.created_at,
          updated_at: meta.updated_at,
          versions,
          latest_version: versions.length ? versions[versions.length - 1]! : null,
          decisions,
        },
      ]
    })
}

export function proposalStatus(project: Project, req: string): Dict {
  const meta = loadMeta(project, req)
  const versions = listVersions(project, req).map((version) => {
    const decision = loadDecision(project, req, version)
    return { version, decision: decision ? decisionToDict(decision) : null }
  })

  return { meta: proposalMetaToDict(meta), versions }
}

export interface ReviewView {
  req: string
  meta: Dict
  version: number
  base_label: string
  versions: number[]
  summary: Dict
  base: { label: string; l0: Dict; l1: Record<string, Dict> }
  target: { l0: Dict; l1: Record<string, Dict> }
  diff: ArchDiff
  decision: Dict | null
  applied: AppliedRef | null
  current_hash: string
  base_hash: string
  target_hash: string
}

export function buildView(project: Project, req: string, version: number, baseLabel = "current"): ReviewView {
  const meta = loadMeta(project, req)
  if (!listVersions(project, req).includes(version)) throw new JinError(`提案 ${req} 不存在版本 v${version}`)

  const base =
    baseLabel === "current"
      ? project.loadArch()
      : (() => {
          const match = /^v(\d+)$/.exec(baseLabel)
          if (!match) throw new JinError(`base 参数非法: ${baseLabel}（current 或 vN）`)
          return loadTargetArch(project, req, Number(match[1]))
        })()
  const target = loadTargetArch(project, req, version)
  const diff = diffArch(base, target)
  const decision = loadDecision(project, req, version)

  return {
    req,
    meta: proposalMetaToDict(meta),
    version,
    base_label: baseLabel,
    versions: listVersions(project, req),
    summary: versionSummaryToDict(loadSummary(project, req, version)),
    base: {
      label: baseLabel,
      l0: l0ToDict(base.l0),
      l1: Object.fromEntries(Object.entries(base.l1).map(([key, value]) => [key, l1ToDict(value)])),
    },
    target: {
      l0: l0ToDict(target.l0),
      l1: Object.fromEntries(Object.entries(target.l1).map(([key, value]) => [key, l1ToDict(value)])),
    },
    diff,
    decision: decision ? decisionToDict(decision) : null,
    applied: meta.applied,
    current_hash: archHash(project.loadArch()),
    base_hash: meta.base_hash,
    target_hash: archHash(target),
  }
}
