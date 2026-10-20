const field = (name: string, type: string, description = "") => ({ name, type, description })

const method = (name: string, signature: string, description = "") => ({ name, signature, description })

const relation = (target: string, type = "uses") => ({ type, target })

const entity = (input: {
  id: string
  kind: string
  name: string
  file: string
  responsibility: string
  fields?: ReturnType<typeof field>[]
  methods?: ReturnType<typeof method>[]
  relations?: ReturnType<typeof relation>[]
  expose?: string
  status?: string
}) => ({
  id: input.id,
  kind: input.kind,
  name: input.name,
  location: { file: input.file, symbol: input.name },
  responsibility: input.responsibility,
  expose: input.expose ?? "public",
  status: input.status ?? "active",
  fields: input.fields ?? [],
  methods: input.methods ?? [],
  relations: input.relations ?? [],
})

const system = (input: {
  id: string
  name: string
  kind: string
  path: string
  responsibility: string
  depends_on?: string[]
}) => ({
  ...input,
  depends_on: input.depends_on ?? [],
})

const module = (input: {
  id: string
  name: string
  path: string
  responsibility: string
  layer: string
  system: string
  depends_on?: string[]
  public_entities?: string[]
  status?: string
}) => ({
  ...input,
  depends_on: input.depends_on ?? [],
  uses_externals: [],
  public_entities: input.public_entities ?? [],
  status: input.status ?? "active",
})

const legacyViewer = entity({
  id: "legacy.viewer",
  kind: "component",
  name: "LegacyViewer",
  file: "apps/legacy/src/viewer.tsx",
  responsibility: "Retired Python-era architecture viewer.",
  fields: [field("document", "Document", "Previous YAML document model."), field("zoom", "number")],
  methods: [method("render", "render(arch: Arch): void", "Draws the old single-page HTML view.")],
  relations: [relation("workspace.model", "references")],
})

const layers = [
  { id: "experience", name: "Experience", description: "User-facing surfaces" },
  { id: "application", name: "Application", description: "Use cases and orchestration" },
  { id: "domain", name: "Domain", description: "Workspace, policy and contracts" },
  { id: "platform", name: "Platform", description: "Events, sandbox and telemetry" },
]

const desktop = system({
  id: "sys.desktop",
  name: "Desktop workspace",
  kind: "frontend",
  path: "apps/desktop",
  responsibility: "Session shell, proposal review and architecture inspection.",
  depends_on: ["sys.control", "sys.sdk"],
})

const control = system({
  id: "sys.control",
  name: "Control plane",
  kind: "backend",
  path: "services/control",
  responsibility: "Proposal lifecycle, policy decisions and workspace state.",
  depends_on: ["sys.runtime"],
})

const runtime = system({
  id: "sys.runtime",
  name: "Execution runtime",
  kind: "worker",
  path: "services/runtime",
  responsibility: "Sandboxed execution and operational telemetry.",
  depends_on: ["sys.control"],
})

const sdk = system({
  id: "sys.sdk",
  name: "Public SDK",
  kind: "library",
  path: "packages/sdk",
  responsibility: "Typed client and portable RPC contracts.",
  depends_on: ["sys.control"],
})

const modules = [
  module({
    id: "mod.ui.shell",
    name: "Workspace shell",
    path: "apps/desktop/src/shell",
    responsibility: "Tabs, servers and the persistent workspace frame.",
    layer: "experience",
    system: "sys.desktop",
    depends_on: ["mod.ui.review", "mod.sdk.client"],
    public_entities: ["ui.shell"],
  }),
  module({
    id: "mod.ui.review",
    name: "Review panel",
    path: "apps/desktop/src/review",
    responsibility: "Proposal review, decisions and post-apply drift.",
    layer: "experience",
    system: "sys.desktop",
    depends_on: ["mod.ui.graph", "mod.api.gateway"],
    public_entities: ["ui.review", "ui.decision"],
  }),
  module({
    id: "mod.ui.settings",
    name: "Settings",
    path: "apps/desktop/src/settings",
    responsibility: "Workspace preferences and extension settings.",
    layer: "experience",
    system: "sys.desktop",
    depends_on: ["mod.sdk.client"],
    public_entities: ["ui.settings"],
  }),
  module({
    id: "mod.ui.graph",
    name: "Architecture graph",
    path: "apps/desktop/src/graph",
    responsibility: "Layered graph layout and entity inspection.",
    layer: "application",
    system: "sys.desktop",
    depends_on: ["mod.sdk.contracts"],
    public_entities: ["ui.graph"],
  }),
  module({
    id: "mod.api.gateway",
    name: "API gateway",
    path: "services/control/src/gateway",
    responsibility: "Request admission, auth and RPC routing.",
    layer: "application",
    system: "sys.control",
    depends_on: ["mod.proposal.service", "mod.policy.engine"],
    public_entities: ["api.gateway", "api.context"],
  }),
  module({
    id: "mod.proposal.service",
    name: "Proposal service",
    path: "services/control/src/proposals",
    responsibility: "Create, revise, validate and apply proposals.",
    layer: "application",
    system: "sys.control",
    depends_on: ["mod.workspace.model", "mod.events.bus"],
    public_entities: ["proposal.service", "proposal.store"],
  }),
  module({
    id: "mod.policy.engine",
    name: "Policy engine",
    path: "services/control/src/policy",
    responsibility: "Scoped approval and access decisions.",
    layer: "domain",
    system: "sys.control",
    depends_on: ["mod.workspace.model"],
    public_entities: ["policy.engine"],
  }),
  module({
    id: "mod.workspace.model",
    name: "Workspace model",
    path: "services/control/src/workspace",
    responsibility: "Workspace identity, membership and paths.",
    layer: "domain",
    system: "sys.control",
    depends_on: [],
    public_entities: ["workspace", "workspace.member"],
  }),
  module({
    id: "mod.events.bus",
    name: "Event bus",
    path: "services/control/src/events",
    responsibility: "Durable domain event delivery.",
    layer: "platform",
    system: "sys.control",
    depends_on: [],
    public_entities: ["events.bus", "events.delivery"],
  }),
  module({
    id: "mod.executor.runner",
    name: "Execution runner",
    path: "services/runtime/src/runner",
    responsibility: "Queue jobs and coordinate sandbox execution.",
    layer: "application",
    system: "sys.runtime",
    depends_on: ["mod.executor.sandbox", "mod.events.bus"],
    public_entities: ["execution.runner", "execution.job"],
  }),
  module({
    id: "mod.executor.sandbox",
    name: "Sandbox driver",
    path: "services/runtime/src/sandbox",
    responsibility: "Spawn and supervise isolated processes.",
    layer: "platform",
    system: "sys.runtime",
    depends_on: [],
    public_entities: ["sandbox.driver"],
  }),
  module({
    id: "mod.runtime.telemetry",
    name: "Telemetry",
    path: "services/runtime/src/telemetry",
    responsibility: "Batch spans and operational events.",
    layer: "platform",
    system: "sys.runtime",
    depends_on: ["mod.events.bus"],
    public_entities: ["telemetry.sink"],
    status: "planned",
  }),
  module({
    id: "mod.sdk.client",
    name: "Typed client",
    path: "packages/sdk/src/client",
    responsibility: "Typed calls into the control plane.",
    layer: "application",
    system: "sys.sdk",
    depends_on: ["mod.api.gateway", "mod.sdk.contracts"],
    public_entities: ["sdk.client"],
  }),
  module({
    id: "mod.sdk.contracts",
    name: "RPC contracts",
    path: "packages/sdk/src/contracts",
    responsibility: "Portable request and snapshot schemas.",
    layer: "domain",
    system: "sys.sdk",
    depends_on: [],
    public_entities: ["sdk.contract", "sdk.snapshot"],
  }),
]

const arch = {
  l0: {
    project: { name: "Atlas" },
    systems: [desktop, control, runtime, sdk],
    modules,
    externals: [
      { id: "ext.effect", name: "Effect", kind: "library", provider: "effect", description: "Schema and RPC runtime" },
      { id: "ext.solid", name: "SolidJS", kind: "library", provider: "solid", description: "Desktop UI runtime" },
      { id: "ext.postgres", name: "PostgreSQL", kind: "database", provider: "postgres", description: "Durable state" },
    ],
    layers,
  },
  l1: {
    "mod.ui.shell": {
      entities: [
        entity({
          id: "ui.shell",
          kind: "component",
          name: "AppShell",
          file: "apps/desktop/src/shell/app-shell.tsx",
          responsibility: "Owns tabs, server routing and the workspace frame.",
          fields: [
            field("tabs", "SessionTab[]"),
            field("activeServer", "ServerRef"),
            field("sidebar", "SidebarState"),
          ],
          methods: [
            method("openSession", "openSession(id: SessionID): void"),
            method("restoreLayout", "restoreLayout(): Promise<void>"),
            method("closeTab", "closeTab(id: string): void"),
          ],
          relations: [relation("ui.review"), relation("sdk.client")],
        }),
      ],
    },
    "mod.ui.review": {
      entities: [
        entity({
          id: "ui.review",
          kind: "component",
          name: "ReviewPanel",
          file: "apps/desktop/src/review/panel.tsx",
          responsibility: "Presents proposal state and sends signed decisions.",
          fields: [
            field("mode", "ReviewMode"),
            field("selection", "ProposalSelection", "Currently selected proposal and version."),
            field("state", "State"),
          ],
          methods: [
            method("loadState", "loadState(): Promise<State>"),
            method("review", "review(req: string, version: number): Promise<Review>"),
            method("decide", "decide(decision: Decision): Promise<void>"),
            method("apply", "apply(version: number): Promise<void>"),
          ],
          relations: [relation("ui.graph"), relation("api.gateway")],
        }),
        entity({
          id: "ui.decision",
          kind: "component",
          name: "DecisionBar",
          file: "apps/desktop/src/review/decision-bar.tsx",
          responsibility: "Approval and rejection controls with comments.",
          fields: [field("review", "Review"), field("comments", "string")],
          methods: [method("approve", "approve(): Promise<void>"), method("reject", "reject(): Promise<void>")],
          relations: [relation("policy.engine", "references")],
        }),
      ],
    },
    "mod.ui.settings": {
      entities: [
        entity({
          id: "ui.settings",
          kind: "page",
          name: "SettingsPage",
          file: "apps/desktop/src/settings/page.tsx",
          responsibility: "Renders per-extension settings sections.",
          fields: [field("sections", "SettingsSection[]"), field("dirty", "boolean")],
          methods: [method("save", "save(section: SettingsSection): Promise<void>")],
        }),
      ],
    },
    "mod.ui.graph": {
      entities: [
        entity({
          id: "ui.graph",
          kind: "component",
          name: "ArchitectureGraph",
          file: "apps/desktop/src/graph/architecture.tsx",
          responsibility: "Lays out systems, layers, modules and entity members.",
          fields: [
            field("zoom", "number"),
            field("selected", "EntityID"),
            field("collapsed", "Set<ModuleID>"),
          ],
          methods: [
            method("layout", "layout(arch: Arch): GraphLayout"),
            method("select", "select(id: EntityID): void"),
          ],
          relations: [relation("sdk.contract", "uses")],
        }),
      ],
    },
    "mod.api.gateway": {
      entities: [
        entity({
          id: "api.gateway",
          kind: "handler",
          name: "Gateway",
          file: "services/control/src/gateway/gateway.ts",
          responsibility: "Admits and routes every control-plane request.",
          fields: [
            field("routes", "Map<string, Handler>"),
            field("rateLimit", "RateLimit"),
            field("auth", "AuthPolicy"),
          ],
          methods: [
            method("handle", "handle(req: Request): Promise<Response>"),
            method("authorize", "authorize(token: Token): boolean"),
          ],
          relations: [relation("proposal.service"), relation("policy.engine")],
        }),
        entity({
          id: "api.context",
          kind: "class",
          name: "RequestContext",
          file: "services/control/src/gateway/context.ts",
          responsibility: "Carries identity and scopes through one request.",
          fields: [field("requestID", "string"), field("principal", "Principal")],
          methods: [method("require", "require(scope: Scope): void")],
        }),
      ],
    },
    "mod.proposal.service": {
      entities: [
        entity({
          id: "proposal.service",
          kind: "service",
          name: "ProposalService",
          file: "services/control/src/proposals/service.ts",
          responsibility: "Coordinates proposal lifecycle and apply checks.",
          fields: [field("store", "ProposalStore"), field("validator", "Validator"), field("events", "EventBus")],
          methods: [
            method("create", "create(draft: Draft): Proposal"),
            method("revise", "revise(req: string, patch: Patch): Proposal"),
            method("apply", "apply(req: string, version: number): Promise<Applied>"),
          ],
          relations: [relation("workspace.model"), relation("events.bus")],
        }),
        entity({
          id: "proposal.store",
          kind: "store",
          name: "ProposalStore",
          file: "services/control/src/proposals/store.ts",
          responsibility: "Reads and writes proposal snapshots under arch/.",
          fields: [field("root", "string"), field("cache", "Map<string, Proposal>")],
          methods: [
            method("read", "read(req: string): Proposal | undefined"),
            method("write", "write(proposal: Proposal): Promise<void>"),
          ],
        }),
      ],
    },
    "mod.policy.engine": {
      entities: [
        entity({
          id: "policy.engine",
          kind: "service",
          name: "PolicyEngine",
          file: "services/control/src/policy/engine.ts",
          responsibility: "Evaluates scoped decisions and explains the result.",
          fields: [field("rules", "RuleSet"), field("defaultDecision", "Decision")],
          methods: [
            method("evaluate", "evaluate(subject: Subject): Decision"),
            method("explain", "explain(id: string): string[]"),
          ],
          relations: [relation("workspace.model", "references")],
        }),
      ],
    },
    "mod.workspace.model": {
      entities: [
        entity({
          id: "workspace.model",
          kind: "class",
          name: "Workspace",
          file: "services/control/src/workspace/workspace.ts",
          responsibility: "Root identity and path resolution for one workspace.",
          fields: [field("id", "WorkspaceID"), field("root", "string"), field("members", "Member[]")],
          methods: [
            method("resolve", "resolve(path: string): WorkspacePath"),
            method("validate", "validate(): Issue[]"),
          ],
        }),
        entity({
          id: "workspace.member",
          kind: "class",
          name: "WorkspaceMember",
          file: "services/control/src/workspace/member.ts",
          responsibility: "A member and its effective permissions.",
          fields: [field("userID", "string"), field("role", "Role")],
          methods: [method("can", "can(action: Action): boolean")],
        }),
      ],
    },
    "mod.events.bus": {
      entities: [
        entity({
          id: "events.bus",
          kind: "service",
          name: "EventBus",
          file: "services/control/src/events/bus.ts",
          responsibility: "Durable publish and subscribe for domain events.",
          fields: [field("queues", "Map<string, Queue>"), field("retries", "number")],
          methods: [
            method("publish", "publish(event: DomainEvent): Promise<void>"),
            method("subscribe", "subscribe(topic: string): Stream<DomainEvent>"),
          ],
        }),
        entity({
          id: "events.delivery",
          kind: "record",
          name: "Delivery",
          file: "services/control/src/events/delivery.ts",
          responsibility: "Retry state for one event delivery.",
          fields: [field("eventID", "string"), field("attempt", "number"), field("visibleAt", "Date")],
          methods: [method("retry", "retry(): Delivery")],
        }),
      ],
    },
    "mod.executor.runner": {
      entities: [
        entity({
          id: "execution.runner",
          kind: "service",
          name: "ExecutionRunner",
          file: "services/runtime/src/runner/execution-runner.ts",
          responsibility: "Runs queued jobs and owns cancellation.",
          fields: [field("queue", "JobQueue"), field("workers", "number"), field("timeoutMs", "number")],
          methods: [
            method("run", "run(job: Job): Promise<Result>"),
            method("cancel", "cancel(id: JobID): boolean"),
          ],
          relations: [relation("sandbox.driver"), relation("events.bus")],
        }),
        entity({
          id: "execution.job",
          kind: "class",
          name: "Job",
          file: "services/runtime/src/runner/job.ts",
          responsibility: "One executable unit and its resource limits.",
          fields: [field("id", "JobID"), field("command", "string[]"), field("limits", "ResourceLimits")],
          methods: [method("snapshot", "snapshot(): JobSnapshot")],
        }),
      ],
    },
    "mod.executor.sandbox": {
      entities: [
        entity({
          id: "sandbox.driver",
          kind: "service",
          name: "SandboxDriver",
          file: "services/runtime/src/sandbox/driver.ts",
          responsibility: "Spawns and supervises isolated processes.",
          fields: [field("root", "string"), field("limits", "ResourceLimits")],
          methods: [
            method("spawn", "spawn(image: string): Sandbox"),
            method("exec", "exec(command: string[]): Promise<ExecResult>"),
            method("destroy", "destroy(id: SandboxID): Promise<void>"),
          ],
        }),
      ],
    },
    "mod.runtime.telemetry": {
      entities: [
        entity({
          id: "telemetry.sink",
          kind: "service",
          name: "TelemetrySink",
          file: "services/runtime/src/telemetry/sink.ts",
          responsibility: "Batches local spans before export.",
          fields: [field("endpoint", "URL"), field("batchSize", "number"), field("buffer", "Span[]")],
          methods: [method("record", "record(span: Span): void"), method("flush", "flush(): Promise<void>")],
          relations: [relation("events.bus")],
          status: "planned",
        }),
      ],
    },
    "mod.sdk.client": {
      entities: [
        entity({
          id: "sdk.client",
          kind: "class",
          name: "JinClient",
          file: "packages/sdk/src/client/client.ts",
          responsibility: "Typed calls into the Jin control plane.",
          fields: [field("baseURL", "URL"), field("token", "string"), field("rpc", "RpcClient")],
          methods: [
            method("state", "state(): Promise<State>"),
            method("review", "review(req: string, version: number): Promise<Review>"),
            method("decide", "decide(input: DecisionInput): Promise<void>"),
            method("apply", "apply(req: string, version: number): Promise<Applied>"),
          ],
          relations: [relation("api.gateway"), relation("sdk.contract")],
        }),
      ],
    },
    "mod.sdk.contracts": {
      entities: [
        entity({
          id: "sdk.contract",
          kind: "interface",
          name: "RpcContract",
          file: "packages/sdk/src/contracts/rpc.ts",
          responsibility: "Portable request and response payload shapes.",
          fields: [field("definition", "RpcDefinition"), field("version", "number")],
          methods: [method("encode", "encode(value: unknown): Payload"), method("decode", "decode(payload: Payload): unknown")],
        }),
        entity({
          id: "sdk.snapshot",
          kind: "interface",
          name: "StateSnapshot",
          file: "packages/sdk/src/contracts/state.ts",
          responsibility: "Self-contained review state returned by the server.",
          fields: [
            field("arch", "Arch"),
            field("validation", "ValidationIssue[]"),
            field("drift", "DriftReport"),
          ],
          methods: [method("empty", "empty(): StateSnapshot")],
        }),
      ],
    },
  },
}

const base = {
  l0: {
    project: { name: "Atlas" },
    systems: [desktop],
    modules: [
      module({
        id: "mod.legacy.viewer",
        name: "Legacy viewer",
        path: "apps/legacy/src",
        responsibility: "Retired Python-era architecture viewer.",
        layer: "experience",
        system: "sys.desktop",
        depends_on: ["mod.workspace.model"],
        public_entities: ["legacy.viewer"],
      }),
    ],
    externals: [],
    layers,
  },
  l1: {
    "mod.legacy.viewer": { entities: [legacyViewer] },
  },
}

const diff = {
  modules: [
    { id: "mod.ui.graph", change: "added" },
    { id: "mod.legacy.viewer", change: "removed" },
    { id: "mod.api.gateway", change: "changed" },
    { id: "mod.executor.runner", change: "changed" },
  ],
  entities: [
    { id: "ui.graph", change: "added", module: "mod.ui.graph" },
    { id: "legacy.viewer", change: "removed", module: "mod.legacy.viewer" },
    { id: "api.gateway", change: "changed", module: "mod.api.gateway" },
    { id: "execution.runner", change: "changed", module: "mod.executor.runner" },
    { id: "telemetry.sink", change: "added", module: "mod.runtime.telemetry" },
  ],
}

export { arch as complexArch, base as complexBase, diff as complexDiff }
