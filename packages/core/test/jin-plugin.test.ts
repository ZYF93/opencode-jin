import { expect } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { Agent } from "@opencode/core/agent"
import { PluginPromise } from "@opencode/core/plugin/promise"
import { Plugin } from "@opencode/core/plugin"
import { Location } from "@opencode/core/location"
import { Rpc } from "@opencode/core/rpc"
import { Session } from "@opencode/core/session"
import { SessionMessage } from "@opencode/core/session/message"
import { Tool } from "@opencode/core/tool"
import { Schema } from "effect"
import { Effect, Fiber, Stream } from "effect"
import JinPlugin from "@jin/opencode"
import { JinRpc } from "@jin/opencode/rpc"
import { decisionToDict, decisionsDir, dumpYaml, saveArchDir, type Arch } from "@jin/core"
import { Project } from "@jin/core/project"
import { PluginTestLayer } from "./plugin/fixture"
import { testEffect } from "./lib/effect"

const it = testEffect(PluginTestLayer)

process.env.JIN_APPROVAL_SECRET ??= "jin-plugin-test"

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

it.live("bootstraps a project through RPC and refuses to overwrite an existing architecture", () =>
  Effect.gen(function* () {
    const location = yield* Location.Service
    mkdirSync(join(location.directory, "src"), { recursive: true })
    writeFileSync(join(location.directory, "src/core.ts"), "export class Core {}\n")

    const plugins = yield* Plugin.Service
    const definition = PluginPromise.fromPromise(JinPlugin)
    yield* plugins.activate([{ ...definition, revision: "1", source: { type: "sdk" } }])
    yield* plugins.awaitActivation

    const rpc = yield* Rpc.Service
    const before = Schema.decodeUnknownSync(JinRpc.State)(yield* rpc.call("jin", "state", {}))
    expect(before.hasArch).toBe(false)

    const report = Schema.decodeUnknownSync(JinRpc.Bootstrap)(yield* rpc.call("jin", "bootstrap", {}))
    expect(report.root).toBe(location.directory)
    expect(report.roots).toEqual(["src"])
    expect(report.packages).toBe(1)
    expect(report.modules).toBe(1)
    expect(report.entities).toBe(1)
    expect(new Project(location.directory).hasArch()).toBe(true)

    const after = Schema.decodeUnknownSync(JinRpc.State)(yield* rpc.call("jin", "state", {}))
    expect(after.hasArch).toBe(true)

    const again = yield* rpc.call("jin", "bootstrap", {}).pipe(Effect.flip)
    expect(again).toMatchObject({
      type: "failed",
      message: expect.stringContaining("已存在"),
    })
  }),
)

it.live("registers Jin RPC and tools and enforces approval before apply", () =>
  Effect.gen(function* () {
    const location = yield* Location.Service
    saveArchDir(baseArch(), join(location.directory, "arch"))

    const plugins = yield* Plugin.Service
    const definition = PluginPromise.fromPromise(JinPlugin)
    yield* plugins.activate([{ ...definition, revision: "1", source: { type: "sdk" } }])
    yield* plugins.awaitActivation

    const tools = yield* Tool.Service
    const names = (yield* tools.list()).map((tool) => tool.name)
    expect(names).toContain("jin_status")
    expect(names).toContain("jin_apply")

    const rpc = yield* Rpc.Service
    const state = Schema.decodeUnknownSync(JinRpc.State)(yield* rpc.call("jin", "state", {}))
    expect(state.root).toBe(location.directory)
    expect(state.hasArch).toBe(true)

    const created = Schema.decodeUnknownSync(JinRpc.ProposalMeta)(
      yield* rpc.call("jin", "create", { req: "REQ-001", title: "Server gate" }),
    )
    expect(created.status).toBe("draft")

    const rejected = yield* rpc.call("jin", "apply", { req: "REQ-001", version: 1 }).pipe(Effect.flip)
    expect(rejected).toMatchObject({
      type: "failed",
      message: expect.stringContaining("尚未获得批准"),
    })

    const decision = Schema.decodeUnknownSync(JinRpc.Decision)(
      yield* rpc.call("jin", "decide", {
        req: "REQ-001",
        version: 1,
        decision: "approved",
        comments: "ship it",
        decided_by: "test",
      }),
    )
    expect(decision.decision).toBe("approved")

    const history = Schema.decodeUnknownSync(JinRpc.HistoryEntry)(
      yield* rpc.call("jin", "apply", { req: "REQ-001", version: 1 }),
    )
    expect(history.req).toBe("REQ-001")
    expect(history.applied_version).toBe(1)

    const after = Schema.decodeUnknownSync(JinRpc.State)(yield* rpc.call("jin", "state", {}))
    expect(after.proposals[0]?.status).toBe("applied")
    expect(after.history.map((entry) => entry.req)).toEqual(["REQ-001"])

    yield* rpc.call("jin", "create", { req: "REQ-002", title: "Forged decision" })
    const forgedDir = decisionsDir(new Project(location.directory), "REQ-002")
    mkdirSync(forgedDir, { recursive: true })
    dumpYaml(
      decisionToDict({
        req: "REQ-002",
        version: 1,
        decision: "approved",
        comments: "written by an agent",
        decided_by: "agent",
        decided_at: "2026-01-01T00:00:00Z",
      }),
      join(forgedDir, "v1.yaml"),
    )
    const forged = yield* rpc.call("jin", "apply", { req: "REQ-002", version: 1 }).pipe(Effect.flip)
    expect(forged).toMatchObject({
      type: "failed",
      message: expect.stringContaining("审批签名无效"),
    })

    yield* rpc.call("jin", "create", { req: "REQ-003", title: "Stale review" })
    const stale = yield* rpc
      .call("jin", "decide", {
        req: "REQ-003",
        version: 1,
        decision: "approved",
        target_hash: "stale",
      })
      .pipe(Effect.flip)
    expect(stale).toMatchObject({
      type: "failed",
      message: expect.stringContaining("目标快照在审阅后已变化"),
    })
  }),
)

it.live("emits an approval request when validation succeeds", () =>
  Effect.gen(function* () {
    const location = yield* Location.Service
    saveArchDir(baseArch(), join(location.directory, "arch"))

    const plugins = yield* Plugin.Service
    const definition = PluginPromise.fromPromise(JinPlugin)
    yield* plugins.activate([{ ...definition, revision: "1", source: { type: "sdk" } }])
    yield* plugins.awaitActivation

    const rpc = yield* Rpc.Service
    yield* rpc.call("jin", "create", { req: "REQ-020", title: "Panel opens" })

    const sessions = yield* Session.Service
    const session = yield* sessions.create({ location: Location.Ref.make({ directory: location.directory }) })
    const tools = yield* Tool.Service
    const validate = (yield* tools.list()).find((tool) => tool.name === "jin_validate")
    if (!validate) throw new Error("jin_validate is not registered")

    const events = yield* rpc
      .client(JinRpc.Definition)
      .events.subscribe("approval")
      .pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped({ startImmediately: true }))
    const result = yield* validate.execute(
      { req: "REQ-020" },
      {
        sessionID: session.id,
        agent: Agent.ID.make("build"),
        messageID: SessionMessage.ID.make("msg_jin_validate"),
        id: Tool.CallID.make("call_jin_validate"),
        progress: () => Effect.void,
      },
    )
    const [approval] = yield* Fiber.join(events)

    expect(approval?.data).toMatchObject({
      sessionID: session.id,
      req: "REQ-020",
      version: 1,
    })
    expect(String(result.content)).toContain("approval panel")
    expect(Schema.decodeUnknownSync(JinRpc.State)(yield* rpc.call("jin", "state", {})).proposals[0]?.status).toBe(
      "in_review",
    )
  }),
)

it.live("resolves a proposal in one call and writes a continuation message", () =>
  Effect.gen(function* () {
    const location = yield* Location.Service
    saveArchDir(baseArch(), join(location.directory, "arch"))

    const plugins = yield* Plugin.Service
    const definition = PluginPromise.fromPromise(JinPlugin)
    yield* plugins.activate([{ ...definition, revision: "1", source: { type: "sdk" } }])
    yield* plugins.awaitActivation

    const rpc = yield* Rpc.Service
    yield* rpc.call("jin", "create", { req: "REQ-010", title: "One click" })

    const sessions = yield* Session.Service
    const session = yield* sessions.create({ location: Location.Ref.make({ directory: location.directory }) })
    const resolved = Schema.decodeUnknownSync(JinRpc.Resolution)(
      yield* rpc.call("jin", "resolve", {
        req: "REQ-010",
        version: 1,
        decision: "approved",
        comments: "ship it",
        sessionID: session.id,
        resume: false,
      }),
    )

    expect(resolved.applied).toBe(true)
    expect(resolved.continued).toBe(false)
    expect(yield* sessions.inbox(session.id)).toContainEqual(
      expect.objectContaining({
        type: "synthetic",
        payload: expect.objectContaining({ text: expect.stringContaining("approved and applied") }),
      }),
    )
  }),
)
