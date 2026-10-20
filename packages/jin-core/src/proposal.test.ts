import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { archHash, saveArchDir } from "./model"
import { Project } from "./project"
import {
  applyVersion,
  buildView,
  createProposal,
  latestVersion,
  listProposals,
  listVersions,
  loadDecision,
  loadMeta,
  loadTargetArch,
  proposalStatus,
  recordDecision,
  reviseProposal,
  saveTarget,
  versionDir,
} from "./proposal"
import type { Arch, Decision, Entity } from "./types"
import { validateArch } from "./validate"

const dirs: string[] = []

function project(): Project {
  const root = mkdtempSync(join(tmpdir(), "jin-proposal-"))
  dirs.push(root)
  const value = new Project(root)
  saveArchDir(baseArch(), value.archDir)
  return value
}

function baseArch(): Arch {
  return {
    l0: {
      version: 1,
      project: { name: "demo", description: "", languages: [] },
      systems: [],
      packages: [{ id: "pkg-core", name: "Core", path: "src/core", responsibility: "" }],
      modules: [
        {
          id: "mod-core",
          name: "Core",
          package: "pkg-core",
          path: "src/core",
          responsibility: "",
          layer: "",
          system: "",
          depends_on: [],
          uses_externals: [],
          public_entities: ["ent-core"],
          status: "active",
        },
      ],
      externals: [],
      layers: [],
      constraints: [],
    },
    l1: {
      "mod-core": {
        version: 1,
        module: "mod-core",
        entities: [
          {
            id: "ent-core",
            kind: "entity",
            name: "Core",
            location: { file: "src/core.ts", symbol: "Core" },
            responsibility: "",
            expose: "public",
            status: "active",
            fields: [],
            methods: [],
            relations: [],
          },
        ],
      },
    },
  }
}

function notifier(): Entity {
  return {
    id: "cls-notifier",
    kind: "class",
    name: "Notifier",
    location: { file: "src/board/notifications/notifier.ts", symbol: "Notifier" },
    responsibility: "",
    expose: "public",
    status: "planned",
    fields: [],
    methods: [],
    relations: [],
  }
}

function addNotifications(value: Project, req: string, version = 1): void {
  const arch = loadTargetArch(value, req, version)
  arch.l0.modules.push({
    id: "mod-notifications",
    name: "notifications",
    package: "pkg-core",
    path: "src/board/notifications",
    responsibility: "通知",
    layer: "",
    system: "",
    depends_on: [],
    uses_externals: [],
    public_entities: ["cls-notifier"],
    status: "active",
  })
  arch.l1["mod-notifications"] = { version: 1, module: "mod-notifications", entities: [notifier()] }
  saveTarget(arch, versionDir(value, req, version))
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const authentication = {
  sign: (decision: Decision) =>
    JSON.stringify([decision.req, decision.version, decision.decision, decision.target_hash]),
  verify: (decision: Decision) =>
    decision.signature === JSON.stringify([decision.req, decision.version, decision.decision, decision.target_hash]),
}

describe("proposal lifecycle", () => {
  test("creates, approves, applies and records history", () => {
    const value = project()
    const meta = createProposal(value, "REQ-001", "通知模块", "d")
    expect(meta.status).toBe("draft")
    expect(meta.base_hash).toBe(archHash(value.loadArch()))
    expect(latestVersion(value, "REQ-001")).toBe(1)

    addNotifications(value, "REQ-001")
    expect(validateArch(loadTargetArch(value, "REQ-001", 1)).filter((item) => item.level === "error")).toEqual([])

    expect(() => applyVersion(value, "REQ-001", 1)).toThrow("尚未获得批准")

    recordDecision(value, "REQ-001", 1, "approved", "ok", "tester")
    expect(loadMeta(value, "REQ-001").status).toBe("approved")
    expect(loadDecision(value, "REQ-001", 1)!.decision).toBe("approved")

    const entry = applyVersion(value, "REQ-001", 1)
    expect(entry.applied_version).toBe(1)
    expect(value.loadArch().l0.modules.some((item) => item.id === "mod-notifications")).toBe(true)
    expect(existsSync(join(value.historyDir, "REQ-001.yaml"))).toBe(true)

    const applied = loadMeta(value, "REQ-001")
    expect(applied.status).toBe("applied")
    expect(applied.applied?.version).toBe(1)
    expect(() => recordDecision(value, "REQ-001", 1, "rejected")).toThrow("不能再审批")

    const status = proposalStatus(value, "REQ-001")
    expect((status.meta as Record<string, unknown>).status).toBe("applied")
    expect(((status.versions as Record<string, unknown>[])[0]!.decision as Record<string, unknown>).decision).toBe(
      "approved",
    )
  })

  test("rejects, revises from the previous target and applies v2", () => {
    const value = project()
    createProposal(value, "REQ-002", "x")
    addNotifications(value, "REQ-002")
    recordDecision(value, "REQ-002", 1, "rejected", "粒度太粗")
    expect(loadMeta(value, "REQ-002").status).toBe("rejected")

    expect(reviseProposal(value, "REQ-002")).toBe(2)
    expect(loadTargetArch(value, "REQ-002", 2).l1["mod-notifications"]).toBeDefined()
    expect(loadMeta(value, "REQ-002").status).toBe("draft")

    recordDecision(value, "REQ-002", 2, "approved")
    const entry = applyVersion(value, "REQ-002", 2)
    expect(entry.applied_version).toBe(2)
    expect(value.loadArch().l1["mod-notifications"]).toBeDefined()
  })

  test("signs decisions and binds approval to the target snapshot", () => {
    const value = project()
    createProposal(value, "REQ-020", "signed")
    addNotifications(value, "REQ-020")

    recordDecision(value, "REQ-020", 1, "approved", "", "tester", authentication)
    const decision = loadDecision(value, "REQ-020", 1)!
    expect(decision.signature).toBeDefined()
    expect(decision.target_hash).toBe(archHash(loadTargetArch(value, "REQ-020", 1)))
    expect(applyVersion(value, "REQ-020", 1, { authentication }).applied_version).toBe(1)
  })

  test("rejects unsigned approvals and approvals whose target changed", () => {
    const forged = project()
    createProposal(forged, "REQ-021", "forged")
    addNotifications(forged, "REQ-021")
    recordDecision(forged, "REQ-021", 1, "approved")
    expect(() => applyVersion(forged, "REQ-021", 1, { authentication })).toThrow("审批签名无效")

    const changed = project()
    createProposal(changed, "REQ-022", "changed")
    addNotifications(changed, "REQ-022")
    recordDecision(changed, "REQ-022", 1, "approved", "", "tester", authentication)
    const target = loadTargetArch(changed, "REQ-022", 1)
    target.l0.modules[0]!.responsibility = "changed after approval"
    saveTarget(target, versionDir(changed, "REQ-022", 1))
    expect(() => applyVersion(changed, "REQ-022", 1, { authentication })).toThrow("目标快照发生了变化")
  })

  test("requires force after the live architecture changed", () => {
    const value = project()
    createProposal(value, "REQ-010", "a")
    addNotifications(value, "REQ-010")
    recordDecision(value, "REQ-010", 1, "approved")

    const live = value.loadArch()
    live.l0.modules[0]!.responsibility = "changed by someone else"
    saveArchDir(live, value.archDir)

    expect(() => applyVersion(value, "REQ-010", 1)).toThrow("当前架构在提案创建后已变化")
    expect(applyVersion(value, "REQ-010", 1, { force: true }).applied_version).toBe(1)
  })

  test("lists proposals in request order and rejects duplicate ids", () => {
    const value = project()
    createProposal(value, "REQ-001", "t1")
    expect(() => createProposal(value, "REQ-001", "t1 again")).toThrow("提案已存在")
    createProposal(value, "REQ-002", "t2")

    const proposals = listProposals(value)
    expect(proposals.map((item) => item.req)).toEqual(["REQ-001", "REQ-002"])
    expect(proposals[0]!.latest_version).toBe(1)
  })

  test("rejects invalid request ids", () => {
    expect(() => createProposal(project(), "bad id!", "x")).toThrow("需求编号非法")
  })

  test("builds a review view against the current architecture", () => {
    const value = project()
    createProposal(value, "REQ-003", "view")
    addNotifications(value, "REQ-003")

    const view = buildView(value, "REQ-003", 1)
    const diff = view.diff as { summary: { modules: { added: number }; entities: { added: number } } }
    const target = view.target as { l1: Record<string, unknown> }

    expect(view.base_label).toBe("current")
    expect(diff.summary.modules.added).toBe(1)
    expect(diff.summary.entities.added).toBe(1)
    expect(target.l1["mod-notifications"]).toBeDefined()
    expect(view.versions).toEqual([1])
    expect(view.current_hash).toBe(archHash(value.loadArch()))
  })

  test("exposes version and decision queries", () => {
    const value = project()
    createProposal(value, "REQ-004", "queries")
    expect(listVersions(value, "REQ-004")).toEqual([1])
    expect(loadDecision(value, "REQ-004", 1)).toBeNull()
    expect(versionDir(value, "REQ-004", 1)).toContain("versions/v1")
  })
})
