import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import {
  JinError,
  applyVersion,
  bootstrapProject,
  buildView,
  checkDrift,
  createProposal,
  findRoot,
  latestVersion,
  listProposals,
  listVersions,
  loadTargetArch,
  parseDecision,
  parseHistoryEntry,
  parseProposalMeta,
  parseVersionSummary,
  proposalDir,
  proposalMetaToDict,
  recordDecision,
  requestApproval,
  reviseProposal,
  loadSummary,
  validateArch,
  versionDir,
  type DecisionKind,
  type Arch,
} from "@jin/core"
import { Project } from "@jin/core/project"
import { loadYaml } from "@jin/core/yaml"
import { createDecisionAuthentication } from "./approval.js"
import type {
  Decision,
  HistoryEntry,
  Issue,
  ProposalInfo,
  ProposalMeta,
  Review,
  State,
  TargetVersion,
  VersionSummary,
} from "./rpc.js"

/** A location-scoped view of the Jin architecture and its proposal ledger. */
export class JinService {
  readonly project: Project
  private readonly authentication = createDecisionAuthentication()

  constructor(directory: string) {
    this.project = new Project(findRoot(directory))
  }

  get root(): string {
    return this.project.root
  }

  state(): Omit<State, "arch"> & { arch: Arch | null } {
    const hasArch = this.project.hasArch()
    const arch = hasArch ? this.project.loadArch() : null

    return {
      root: this.project.root,
      hasArch,
      arch,
      proposals: listProposals(this.project),
      history: this.history(),
      validation: arch ? validateArch(arch) : [],
      drift: arch
        ? checkDrift(this.project)
        : { issues: [], checked_entities: 0, checked_files: 0, errors: 0, warnings: 0 },
    }
  }

  bootstrap(languages?: readonly string[]) {
    const result = bootstrapProject(this.project, { languages })

    return {
      root: this.project.root,
      packages: result.arch.l0.packages.length,
      modules: result.arch.l0.modules.length,
      entities: result.report.entity_count,
      roots: result.report.roots,
      languages: result.report.languages,
      systems: result.report.systems,
      notes: result.report.notes,
      skipped_files: result.report.skipped_files,
      skipped_dirs: result.report.skipped_dirs,
      deps: result.report.deps,
      issues: result.issues,
    }
  }

  history(): HistoryEntry[] {
    if (!existsSync(this.project.historyDir)) return []

    return readdirSync(this.project.historyDir)
      .filter((name) => name.endsWith(".yaml"))
      .sort()
      .map((name) => parseHistoryEntry(loadYaml(join(this.project.historyDir, name))))
  }

  proposals(): ProposalInfo[] {
    return listProposals(this.project)
  }

  review(req: string, version: number, base = "current"): Review {
    const view = buildView(this.project, req, version, base)

    return {
      req: view.req,
      meta: parseProposalMeta(view.meta),
      version: view.version,
      base_label: view.base_label,
      versions: view.versions,
      summary: parseVersionSummary(view.summary),
      base: { ...view.base },
      target: { ...view.target },
      diff: { ...view.diff },
      decision: view.decision ? parseDecision(view.decision) : null,
      applied: view.applied,
      current_hash: view.current_hash,
      base_hash: view.base_hash,
      target_hash: view.target_hash,
    }
  }

  create(input: {
    req: string
    title: string
    description?: string
    acceptance?: readonly string[]
    scope?: readonly string[]
    author?: string
  }): ProposalMeta {
    const meta = createProposal(
      this.project,
      input.req,
      input.title,
      input.description,
      input.acceptance,
      input.scope,
      input.author,
    )
    return parseProposalMeta(proposalMetaToDict(meta))
  }

  revise(req: string, seed: "previous" | "current" = "previous"): TargetVersion {
    const version = reviseProposal(this.project, req, seed)
    return this.target(req, version)
  }

  validate(req: string, version: number): Issue[] {
    return validateArch(loadTargetArch(this.project, req, version))
  }

  requestApproval(req: string, version: number): ProposalMeta {
    return requestApproval(this.project, req, version)
  }

  resolve(
    req: string,
    version: number,
    decision: DecisionKind,
    comments = "",
    expectedTargetHash = "",
  ): { decision: Decision; history: HistoryEntry | null } {
    if (decision === "rejected") {
      return {
        decision: this.decide(req, version, "rejected", comments, "desktop", expectedTargetHash),
        history: null,
      }
    }

    const current = this.review(req, version)
    if (current.applied) throw new JinError(`提案 ${req} v${version} 已应用，不能再审批`)

    const saved = this.decide(req, version, "approved", comments, "desktop", expectedTargetHash)
    return { decision: saved, history: this.apply(req, version) }
  }

  decide(
    req: string,
    version: number,
    decision: DecisionKind,
    comments = "",
    decidedBy = "",
    expectedTargetHash = "",
  ): Decision {
    return recordDecision(
      this.project,
      req,
      version,
      decision,
      comments,
      decidedBy,
      this.authentication,
      expectedTargetHash,
    )
  }

  apply(req: string, version: number, options: { force?: boolean; commit?: boolean } = {}): HistoryEntry {
    return applyVersion(this.project, req, version, { ...options, authentication: this.authentication })
  }

  target(req: string, version?: number): TargetVersion {
    const selected = version ?? latestVersion(this.project, req)
    const dir = versionDir(this.project, req, selected)

    return {
      req,
      version: selected,
      target_dir: dir,
      l0_path: `${dir}/target-L0.yaml`,
      l1_dir: `${dir}/target-L1`,
    }
  }

  targetArch(req: string, version?: number) {
    return loadTargetArch(this.project, req, version ?? latestVersion(this.project, req))
  }

  summary(req: string, version: number): VersionSummary {
    return parseVersionSummary(loadSummary(this.project, req, version))
  }

  versions(req: string): number[] {
    return listVersions(this.project, req)
  }

  proposalDir(req: string): string {
    return proposalDir(this.project, req)
  }
}

export function createJinService(directory: string): JinService {
  return new JinService(directory)
}

export { JinError }
