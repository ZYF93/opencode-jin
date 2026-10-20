import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadTargetArch, saveArchDir, saveTarget, versionDir, type Arch } from "@jin/core"
import { Schema } from "effect"
import { JinRpc } from "../src/rpc"
import { JinService } from "../src/service"

const roots: string[] = []

function service(): JinService {
  const root = mkdtempSync(join(tmpdir(), "jin-opencode-"))
  roots.push(root)
  const value = new JinService(root)
  saveArchDir(baseArch(), value.project.archDir)
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

function addNotifications(value: JinService, req: string): void {
  const arch = loadTargetArch(value.project, req, 1)
  arch.l0.modules.push({
    id: "mod-notifications",
    name: "notifications",
    package: "pkg-core",
    path: "src/notifications",
    responsibility: "通知",
    layer: "",
    system: "",
    depends_on: [],
    uses_externals: [],
    public_entities: ["cls-notifier"],
    status: "active",
  })
  arch.l1["mod-notifications"] = {
    version: 1,
    module: "mod-notifications",
    entities: [
      {
        id: "cls-notifier",
        kind: "class",
        name: "Notifier",
        location: { file: "src/notifications/notifier.ts", symbol: "Notifier" },
        responsibility: "",
        expose: "public",
        status: "planned",
        fields: [],
        methods: [],
        relations: [],
      },
    ],
  }
  saveTarget(arch, versionDir(value.project, req, 1))
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("JinService", () => {
  test("reports the live architecture and an empty proposal queue", () => {
    const value = service()
    const state = value.state()

    expect(state.hasArch).toBe(true)
    expect(state.root).toBe(value.root)
    expect(state.proposals).toEqual([])
    expect(state.validation).toEqual([])
    expect(Schema.decodeUnknownSync(JinRpc.State)(state).hasArch).toBe(true)
  })

  test("creates, validates, approves and applies through the server lifecycle", () => {
    const value = service()
    const meta = value.create({
      req: "REQ-001",
      title: "通知模块",
      acceptance: ["通知可发送"],
      scope: ["mod-notifications"],
    })
    const target = value.target(meta.id, 1)

    expect(meta.status).toBe("draft")
    expect(existsSync(target.l0_path)).toBe(true)
    expect(existsSync(target.l1_dir)).toBe(true)

    addNotifications(value, meta.id)
    expect(value.validate(meta.id, 1)).toEqual([])
    expect(() => value.apply(meta.id, 1)).toThrow("尚未获得批准")

    value.decide(meta.id, 1, "approved", "ok", "desktop")
    const entry = value.apply(meta.id, 1)

    expect(entry.applied_version).toBe(1)
    expect(value.state().arch?.l0.modules.some((module) => module.id === "mod-notifications")).toBe(true)
    expect(value.state().history.map((item) => item.req)).toEqual([meta.id])
  })

  test("builds a review view that satisfies the RPC schema", () => {
    const value = service()
    value.create({ req: "REQ-002", title: "view" })
    addNotifications(value, "REQ-002")

    const review = value.review("REQ-002", 1)
    const decoded = Schema.decodeUnknownSync(JinRpc.Review)(review)

    expect(decoded.base_label).toBe("current")
    expect(decoded.diff).toBeDefined()
    expect(decoded.target).toBeDefined()
    expect(decoded.summary.version).toBe(1)
  })

  test("rejects a second proposal with the same request id", () => {
    const value = service()
    value.create({ req: "REQ-003", title: "first" })

    expect(() => value.create({ req: "REQ-003", title: "second" })).toThrow("提案已存在")
  })

  test("marks a proposal in review for the one-click desktop decision", () => {
    const value = service()
    value.create({ req: "REQ-004", title: "review" })

    expect(value.requestApproval("REQ-004", 1).status).toBe("in_review")
    expect(value.state().proposals[0]?.status).toBe("in_review")
  })

  test("approves and applies a proposal in one server call", () => {
    const value = service()
    value.create({ req: "REQ-005", title: "one click" })
    addNotifications(value, "REQ-005")
    value.requestApproval("REQ-005", 1)

    const resolved = value.resolve("REQ-005", 1, "approved", "ship it")

    expect(resolved.decision.decision).toBe("approved")
    expect(resolved.history?.applied_version).toBe(1)
    expect(value.state().proposals[0]?.status).toBe("applied")
    expect(value.state().arch?.l0.modules.some((module) => module.id === "mod-notifications")).toBe(true)
  })

  test("rejects a proposal without applying it", () => {
    const value = service()
    value.create({ req: "REQ-006", title: "reject" })
    value.requestApproval("REQ-006", 1)

    const resolved = value.resolve("REQ-006", 1, "rejected", "needs work")

    expect(resolved.decision.decision).toBe("rejected")
    expect(resolved.history).toBeNull()
    expect(value.state().proposals[0]?.status).toBe("rejected")
    expect(value.state().arch?.l0.modules.some((module) => module.id === "mod-notifications")).toBe(false)
  })
})
