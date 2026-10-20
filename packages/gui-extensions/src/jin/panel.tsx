import { JinRpc, type Bootstrap, type State } from "@jin/opencode/rpc"
import { Match, Option, Schema } from "effect"
import { createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { createKeyed, createLatest, useExtension, type MountedSession } from "../sdk"
import { ArchitectureGraph } from "./graph"
import type Jin from "./index"

type Proposal = State["proposals"][number]

type Issue = State["validation"][number]

type DiffCounts = { added: number; removed: number; changed: number; moved: number }

type DiffEntry = { id: string; change: string; module?: string; from_module?: string }

type Diff = {
  summary: {
    total_changes: number
    modules: DiffCounts
    entities: DiffCounts
    members?: DiffCounts
  }
  modules: DiffEntry[]
  entities: DiffEntry[]
  changed_files: string[]
}

type ArchView = {
  l0: {
    systems?: unknown[]
    packages?: unknown[]
    modules?: unknown[]
    externals?: unknown[]
    layers?: unknown[]
  }
  l1: Record<string, { entities?: unknown[] }>
}

type Selection = { directory: string; req: string; version: number }

const RpcFailure = Schema.Struct({ message: Schema.String })

const resultMessage = (cause: unknown): string => {
  const decoded = Schema.decodeUnknownOption(RpcFailure)(cause)

  return Option.match(decoded, {
    onNone: () => String(cause),
    onSome: (failure) => failure.message,
  })
}

const levelLabel = (level: string) =>
  Match.value(level).pipe(
    Match.when("error", () => "ERROR"),
    Match.when("warning", () => "WARN"),
    Match.orElse(() => "INFO"),
  )

const changeSymbol = (change: string) =>
  Match.value(change).pipe(
    Match.when("added", () => "+"),
    Match.when("removed", () => "−"),
    Match.when("changed", () => "~"),
    Match.orElse(() => "›"),
  )

export function JinPanel(props: { session: MountedSession }) {
  const ctx = useExtension<typeof Jin>()
  const [refreshID, setRefreshID] = createSignal(0)
  const [mode, setMode] = createSignal<"review" | "graph">("review")
  const [picked, setSelected] = createSignal<Selection | null>()
  const [comments, setComments] = createSignal("")
  const [action, setAction] = createSignal<"approve" | "reject">()
  const [actionError, setActionError] = createSignal<string>()
  const [notice, setNotice] = createSignal<{ kind: "success" | "danger"; text: string }>()
  const [bootstrapping, setBootstrapping] = createSignal(false)
  const [bootstrapReport, setBootstrapReport] = createSignal<Bootstrap>()
  const [bootstrapError, setBootstrapError] = createSignal<string>()

  const client = () => props.session.server.client.rpc(JinRpc.Definition)
  const location = () => ({ location: { directory: props.session.directory } })

  const stateRequest = createLatest(
    () => ({
      server: props.session.server.id,
      directory: props.session.directory,
      refresh: refreshID(),
    }),
    (source, signal) => client().state({}, { location: { directory: source.directory }, signal }),
  )

  const state = () => stateRequest.latest
  const loading = () => stateRequest.loading
  const error = () => stateRequest.error

  const pendingProposal = createMemo(() =>
    state()?.proposals.find(
      (proposal) =>
        (proposal.status === "in_review" || proposal.status === "approved") && proposal.latest_version,
    ),
  )

  const selection = createMemo<Selection | undefined>(() => {
    const value = picked()

    if (value === null) return undefined

    if (value?.directory === props.session.directory) return value

    const pending = pendingProposal()

    if (!pending?.latest_version) return undefined

    return { directory: props.session.directory, req: pending.req, version: pending.latest_version }
  })

  const reviewRequest = createLatest(
    () => {
      const current = selection()

      if (!current) return undefined

      return { server: props.session.server.id, refresh: refreshID(), ...current }
    },
    (source, signal) =>
      client().review(
        { req: source.req, version: source.version },
        { location: { directory: source.directory }, signal },
      ),
  )

  const review = () => (selection() ? reviewRequest.latest : undefined)
  const reviewLoading = () => !!selection() && reviewRequest.loading
  const reviewError = () => (selection() ? reviewRequest.error : undefined)
  const graphArch = () => (selection() ? review()?.target : state()?.arch)

  // SAFETY: State.arch is the server's serialized L0/L1 snapshot, which the panel only counts and displays.
  const arch = () => state()?.arch as ArchView | null
  const modules = () => arch()?.l0.modules?.length ?? 0

  const entities = () =>
    arch() ? Object.values(arch()!.l1).reduce((sum, l1) => sum + (l1.entities?.length ?? 0), 0) : 0

  const errors = () => state()?.validation.filter((item) => item.level === "error").length ?? 0
  const warnings = () => state()?.validation.filter((item) => item.level === "warning").length ?? 0

  // SAFETY: Review.diff is the server's serialized structural diff, rendered field by field below.
  const reviewDiff = () => review()?.diff as Diff | undefined

  const selectedProposal = (): Proposal | undefined => {
    const current = selection()

    return current ? state()?.proposals.find((proposal) => proposal.req === current.req) : undefined
  }

  const latestVersion = (): number | undefined => selectedProposal()?.latest_version ?? undefined

  const isLatest = () => {
    const current = selection()

    return !!current && latestVersion() === current.version
  }

  const approvalReview = () => {
    const current = review()

    if (!current || current.applied || !isLatest()) return undefined

    if (current.meta.status !== "in_review" && current.meta.status !== "approved") return undefined

    return current
  }

  const pendingCount = () => state()?.proposals.filter((proposal) => proposal.status === "in_review").length ?? 0

  const statusLabel = (status: string) => {
    const known = ["draft", "in_review", "approved", "rejected", "applied"]

    return ctx.t(known.includes(status) ? `panel.status.${status}` : "panel.status.unknown")
  }

  const refresh = () => setRefreshID((value) => value + 1)

  const bootstrap = async () => {
    setBootstrapping(true)
    setBootstrapError(undefined)

    try {
      const report = await client().bootstrap({}, location())
      setBootstrapReport(report)
      refresh()
    } catch (cause) {
      setBootstrapError(resultMessage(cause))
    } finally {
      setBootstrapping(false)
    }
  }

  createKeyed(
    () => ({ session: props.session.id, client: props.session.server.client }),
    (current) => {
      const stop = current.client.rpc(JinRpc.Definition).events.on(
        "approval",
        (event) => {
          if (event.data.sessionID !== props.session.id) return
          setSelected({ directory: props.session.directory, req: event.data.req, version: event.data.version })
          setMode("review")
          setComments("")
          setActionError(undefined)
          setNotice(undefined)
          refresh()
        },
        { signal: ctx.signal },
      )

      onCleanup(stop)
    },
    { equals: (previous, next) => previous.session === next.session && previous.client === next.client },
  )

  const resolve = async (decision: "approved" | "rejected") => {
    const current = selection()

    if (!current) return
    setSelected({ ...current })
    setAction(decision === "approved" ? "approve" : "reject")
    setActionError(undefined)
    setNotice(undefined)

    try {
      const result = await client().resolve(
        {
          req: current.req,
          version: current.version,
          decision,
          comments: comments(),
          target_hash: review()?.target_hash,
          sessionID: props.session.id,
          resume: true,
        },
        location(),
      )

      setComments("")
      setNotice({
        kind: result.decision === "rejected" ? "danger" : "success",
        text: result.continued
          ? ctx.t(result.decision === "approved" ? "panel.approval.applied" : "panel.approval.rejected")
          : ctx.t("panel.approval.notContinued"),
      })
      refresh()
    } catch (cause) {
      setActionError(resultMessage(cause))
      refresh()
    } finally {
      setAction(undefined)
    }
  }

  return (
    <div
      data-component="jin-panel"
      aria-label={ctx.t("aria.panel")}
      class="flex h-full min-h-0 flex-col overflow-hidden bg-v2-background-bg-base text-v2-text-text-base"
    >
      <header class="shrink-0 border-b-[0.5px] border-v2-border-border-muted px-4 py-3">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="text-14-medium">{ctx.t("panel.title")}</div>
            <div class="mt-0.5 text-12-regular text-v2-text-text-muted">{ctx.t("panel.subtitle")}</div>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <Show when={pendingCount() > 0}>
              <span class="rounded-[4px] border border-v2-state-fg-warning bg-v2-state-bg-warning px-1.5 py-0.5 text-[10px] leading-4 font-medium text-v2-state-fg-warning">
                {ctx.t("panel.approval.pending")}
              </span>
            </Show>
            <span class="rounded-[4px] border border-v2-border-border-base px-1.5 py-0.5 text-[10px] leading-4 text-v2-text-text-muted">
              {state()?.hasArch ? ctx.t("panel.live") : ctx.t("panel.noArch")}
            </span>
            <button
              type="button"
              class="rounded-[4px] border border-v2-border-border-base px-2 py-1 text-[11px] leading-4 text-v2-text-text-muted hover:text-v2-text-text-base disabled:opacity-50"
              disabled={loading()}
              onClick={refresh}
            >
              {ctx.t("panel.refresh")}
            </button>
          </div>
        </div>
      </header>

      <div class="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <section class="rounded-[6px] border border-v2-border-border-muted bg-v2-background-bg-layer-01 px-3 py-3">
          <div class="text-12-regular text-v2-text-text-muted">{ctx.t("panel.project")}</div>
          <code class="mt-1 block break-all text-12-regular text-v2-text-text-base">{props.session.directory}</code>
        </section>

        <Show when={notice()}>
          {(value) => (
            <section
              class="mt-3 rounded-[6px] border px-3 py-2 text-[11px] leading-4"
              classList={{
                "border-v2-state-fg-success bg-v2-state-bg-success text-v2-state-fg-success":
                  value().kind === "success",
                "border-v2-state-fg-danger bg-v2-state-bg-danger text-v2-state-fg-danger":
                  value().kind === "danger",
              }}
            >
              {value().text}
            </section>
          )}
        </Show>

        <Show when={loading()}>
          <p class="mt-3 text-12-regular text-v2-text-text-muted">{ctx.t("panel.loading")}</p>
        </Show>

        <Show when={error()}>
          {(message) => (
            <section class="mt-3 rounded-[6px] border border-v2-state-fg-danger px-3 py-3">
              <p class="text-12-regular text-v2-state-fg-danger">{resultMessage(message())}</p>
              <button
                type="button"
                class="mt-2 rounded-[4px] border border-v2-border-border-base px-2 py-1 text-[11px] leading-4"
                onClick={refresh}
              >
                {ctx.t("panel.retry")}
              </button>
            </section>
          )}
        </Show>

        <Show when={bootstrapReport()}>
          {(report) => (
            <section class="mt-4 rounded-[6px] border border-v2-border-border-muted bg-v2-background-bg-layer-01 px-3 py-3">
              <div class="text-[13px] leading-5 font-[530]">
                {ctx.t("panel.bootstrap.created", {
                  packages: report().packages,
                  modules: report().modules,
                  entities: report().entities,
                })}
              </div>
              <p class="mt-1 text-12-regular leading-5 text-v2-text-text-muted">
                {ctx.t("panel.bootstrap.scanned", {
                  roots: report().roots.join(", ") || "—",
                  languages: report().languages.join(", ") || "—",
                })}
              </p>
              <Show when={report().notes.length > 0}>
                <div class="mt-2 text-[11px] leading-4 font-[530] text-v2-text-text-muted">
                  {ctx.t("panel.bootstrap.notes")}
                </div>
                <ul class="mt-1 space-y-1">
                  <For each={report().notes}>
                    {(note) => <li class="text-[11px] leading-4 text-v2-text-text-muted">{note}</li>}
                  </For>
                </ul>
              </Show>
            </section>
          )}
        </Show>

        <Show when={state()}>
          {(current) => (
            <Show
              when={current().hasArch}
              fallback={
                <section class="mt-4 rounded-[6px] border border-v2-border-border-muted px-3 py-3">
                  <div class="text-[13px] leading-5 font-[530]">{ctx.t("panel.noArch.title")}</div>
                  <p class="mt-1 text-12-regular leading-5 text-v2-text-text-muted">{ctx.t("panel.noArch.body")}</p>
                  <button
                    type="button"
                    class="mt-3 rounded-[4px] border border-v2-border-border-base px-2 py-1 text-[11px] leading-4 text-v2-text-text-base hover:bg-v2-background-bg-layer-02 disabled:opacity-50"
                    disabled={bootstrapping()}
                    onClick={bootstrap}
                  >
                    {ctx.t(bootstrapping() ? "panel.bootstrap.running" : "panel.bootstrap.action")}
                  </button>
                  <Show when={bootstrapError()}>
                    {(message) => (
                      <p class="mt-2 text-[11px] leading-4 text-v2-state-fg-danger">
                        {ctx.t("panel.action.failed", { message: message() })}
                      </p>
                    )}
                  </Show>
                </section>
              }
            >
              <div class="mt-3 flex rounded-[6px] border border-v2-border-border-muted p-0.5">
                <button
                  type="button"
                  class="flex-1 rounded-[4px] px-2 py-1 text-[11px] leading-4"
                  classList={{
                    "bg-v2-background-bg-layer-02 text-v2-text-text-base": mode() === "review",
                    "text-v2-text-text-muted": mode() !== "review",
                  }}
                  onClick={() => setMode("review")}
                >
                  {ctx.t("panel.tab.review")}
                </button>
                <button
                  type="button"
                  class="flex-1 rounded-[4px] px-2 py-1 text-[11px] leading-4"
                  classList={{
                    "bg-v2-background-bg-layer-02 text-v2-text-text-base": mode() === "graph",
                    "text-v2-text-text-muted": mode() !== "graph",
                  }}
                  onClick={() => setMode("graph")}
                >
                  {ctx.t("panel.tab.graph")}
                </button>
              </div>

              <Show when={mode() === "graph"}>
                <div class="mt-3">
                  <div class="flex flex-wrap items-center gap-2">
                    <select
                      class="min-w-0 flex-1 rounded-[4px] border border-v2-border-border-muted bg-v2-background-bg-base px-2 py-1 text-[11px] leading-4 text-v2-text-text-base outline-none focus:border-v2-text-text-accent"
                      value={selection()?.req ?? ""}
                      onChange={(event) => {
                        const req = event.currentTarget.value

                        if (!req) {
                          setSelected(null)

                          return
                        }

                        const proposal = current().proposals.find((item) => item.req === req)

                        if (proposal?.latest_version) {
                          setSelected({
                            directory: props.session.directory,
                            req,
                            version: proposal.latest_version,
                          })
                        }
                      }}
                    >
                      <option value="">{ctx.t("panel.graph.currentOption")}</option>
                      <For each={current().proposals}>
                        {(proposal) => (
                          <option value={proposal.req}>
                            {proposal.req} · {proposal.title}
                          </option>
                        )}
                      </For>
                    </select>
                    <Show when={reviewLoading()}>
                      <span class="text-[10px] leading-4 text-v2-text-text-muted">{ctx.t("panel.loading")}</span>
                    </Show>
                  </div>

                  <Show when={reviewError()}>
                    {(message) => (
                      <p class="mt-2 text-[11px] leading-4 text-v2-state-fg-danger">{resultMessage(message())}</p>
                    )}
                  </Show>

                  <div class="mt-2">
                    <ArchitectureGraph
                      arch={graphArch()}
                      base={selection() ? review()?.base : undefined}
                      diff={selection() ? review()?.diff : undefined}
                      title={
                        selection()
                          ? ctx.t("panel.graph.target", { version: selection()!.version })
                          : ctx.t("panel.graph.current")
                      }
                      subtitle={selection() ? selection()!.req : props.session.directory}
                    />
                  </div>
                </div>
              </Show>

              <div classList={{ hidden: mode() !== "review" }}>
                <Show when={approvalReview()}>
                  {(currentReview) => (
                    <section class="mt-3 rounded-[6px] border border-v2-state-fg-warning bg-v2-state-bg-warning px-3 py-3">
                      <div class="flex flex-wrap items-start justify-between gap-2">
                        <div class="min-w-0">
                          <div class="text-[13px] leading-5 font-[530] text-v2-state-fg-warning">
                            {ctx.t("panel.approval.pending")}
                          </div>
                          <div class="mt-0.5 text-[11px] leading-4 text-v2-text-text-base">
                            {currentReview().req} · v{currentReview().version} · {currentReview().meta.title}
                          </div>
                        </div>
                        <span class="text-[10px] leading-4 text-v2-text-text-muted">{ctx.t("panel.approval.once")}</span>
                      </div>
                      <p class="mt-1 text-[11px] leading-4 text-v2-text-text-base">{ctx.t("panel.approval.body")}</p>
                      <textarea
                        class="mt-2 min-h-14 w-full resize-y rounded-[4px] border border-v2-border-border-muted bg-v2-background-bg-base px-2 py-1.5 text-[11px] leading-4 outline-none focus:border-v2-text-text-accent"
                        placeholder={ctx.t("panel.comments")}
                        value={comments()}
                        onInput={(event) => setComments(event.currentTarget.value)}
                      />
                      <div class="mt-2 flex flex-wrap gap-2">
                        <button
                          type="button"
                          class="rounded-[4px] border border-v2-state-fg-warning bg-v2-background-bg-base px-2.5 py-1 text-[11px] leading-4 font-medium text-v2-state-fg-warning disabled:opacity-50"
                          disabled={!!action()}
                          onClick={() => void resolve("approved")}
                        >
                          {action() === "approve"
                            ? ctx.t("panel.deciding")
                            : currentReview().meta.status === "approved"
                              ? ctx.t("panel.apply")
                              : ctx.t("panel.approve")}
                        </button>
                        <button
                          type="button"
                          class="rounded-[4px] border border-v2-state-fg-danger px-2.5 py-1 text-[11px] leading-4 text-v2-state-fg-danger disabled:opacity-50"
                          disabled={!!action()}
                          onClick={() => void resolve("rejected")}
                        >
                          {action() === "reject" ? ctx.t("panel.deciding") : ctx.t("panel.reject")}
                        </button>
                      </div>
                      <Show when={actionError()}>
                        {(message) => (
                          <p class="mt-2 text-[11px] leading-4 text-v2-state-fg-danger">
                            {ctx.t("panel.action.failed", { message: message() })}
                          </p>
                        )}
                      </Show>
                    </section>
                  )}
                </Show>

                <div class="mt-2 grid grid-cols-4 gap-2">
                  <Metric label={ctx.t("panel.l0")} value={modules()} />
                  <Metric label={ctx.t("panel.l1")} value={entities()} />
                  <Metric label={ctx.t("panel.proposals")} value={current().proposals.length} />
                  <Metric label={ctx.t("panel.errors")} value={errors()} danger={errors() > 0} />
                </div>

                <Show when={warnings() > 0}>
                  <p class="mt-2 text-[11px] leading-4 text-v2-text-text-muted">
                    {warnings()} {ctx.t("panel.warnings")}
                  </p>
                </Show>

                <section class="mt-4">
                  <div class="flex items-center justify-between gap-2">
                    <div class="text-12-medium text-v2-text-text-muted">{ctx.t("panel.validation")}</div>
                    <span class="text-[11px] leading-4 text-v2-text-text-faint">
                      {current().validation.length ? current().validation.length : ""}
                    </span>
                  </div>
                  <Show
                    when={current().validation.length}
                    fallback={
                      <p class="mt-1 text-12-regular text-v2-text-text-muted">{ctx.t("panel.validation.ok")}</p>
                    }
                  >
                    <ul class="mt-2 flex flex-col gap-1.5">
                      <For each={current().validation.slice(0, 6)}>
                        {(item: Issue) => (
                          <li class="flex gap-2 text-[11px] leading-4">
                            <span
                              class={item.level === "error" ? "text-v2-state-fg-danger" : "text-v2-text-text-muted"}
                            >
                              {levelLabel(item.level)}
                            </span>
                            <span class="min-w-0 break-words text-v2-text-text-base">
                              {item.code}: {item.message}
                            </span>
                          </li>
                        )}
                      </For>
                    </ul>
                  </Show>
                </section>

                <section class="mt-4">
                  <div class="flex items-baseline justify-between gap-2">
                    <div class="text-12-medium text-v2-text-text-muted">{ctx.t("panel.postReview")}</div>
                    <span class="shrink-0 text-[10px] leading-4 text-v2-text-text-faint">
                      {ctx.t("panel.drift.checked", {
                        entities: current().drift.checked_entities,
                        files: current().drift.checked_files,
                      })}
                    </span>
                  </div>
                  <Show
                    when={current().drift.issues.length}
                    fallback={<p class="mt-1 text-12-regular text-v2-text-text-muted">{ctx.t("panel.drift.ok")}</p>}
                  >
                    <ul class="mt-2 flex flex-col gap-1.5">
                      <For each={current().drift.issues.slice(0, 10)}>
                        {(item) => (
                          <li class="rounded-[4px] border border-v2-border-border-muted px-2 py-1.5">
                            <div class="flex min-w-0 gap-2 text-[11px] leading-4">
                              <span
                                classList={{
                                  "text-v2-state-fg-danger": item.level === "error",
                                  "text-v2-text-text-muted": item.level === "warning",
                                  "text-v2-text-text-accent": item.level === "info",
                                }}
                              >
                                {levelLabel(item.level)}
                              </span>
                              <span class="min-w-0 break-words text-v2-text-text-base">
                                {item.code}: {item.message}
                              </span>
                            </div>
                            <Show when={item.module || item.file}>
                              <div class="mt-0.5 break-all text-[10px] leading-4 text-v2-text-text-faint">
                                {[item.module, item.entity, item.file].filter(Boolean).join(" · ")}
                              </div>
                            </Show>
                          </li>
                        )}
                      </For>
                    </ul>
                  </Show>
                </section>

                <section class="mt-4">
                  <div class="text-12-medium text-v2-text-text-muted">{ctx.t("panel.proposals")}</div>
                  <Show
                    when={current().proposals.length}
                    fallback={
                      <div class="mt-2 rounded-[6px] border border-v2-border-border-muted px-3 py-3">
                        <div class="text-12-regular">{ctx.t("panel.empty.title")}</div>
                        <p class="mt-1 text-[11px] leading-4 text-v2-text-text-muted">{ctx.t("panel.empty.body")}</p>
                      </div>
                    }
                  >
                    <ul class="mt-2 flex flex-col gap-1.5">
                      <For each={current().proposals}>
                        {(proposal) => (
                          <li>
                            <button
                              type="button"
                              class="w-full rounded-[6px] border px-2.5 py-2 text-left"
                              classList={{
                                "border-v2-text-text-accent bg-v2-background-bg-layer-01":
                                  selection()?.req === proposal.req,
                                "border-v2-border-border-muted": selection()?.req !== proposal.req,
                              }}
                              onClick={() => {
                                if (proposal.latest_version) {
                                  setSelected({
                                    directory: props.session.directory,
                                    req: proposal.req,
                                    version: proposal.latest_version,
                                  })
                                }
                              }}
                            >
                              <div class="flex items-start justify-between gap-2">
                                <div class="min-w-0">
                                  <div class="truncate text-12-regular">{proposal.title}</div>
                                  <div class="mt-0.5 text-[10px] leading-4 text-v2-text-text-muted">
                                    {proposal.req}
                                    {proposal.latest_version ? ` · v${proposal.latest_version}` : ""}
                                  </div>
                                </div>
                                <span class="shrink-0 text-[10px] leading-4 text-v2-text-text-muted">
                                  {statusLabel(proposal.status)}
                                </span>
                              </div>
                            </button>
                          </li>
                        )}
                      </For>
                    </ul>
                  </Show>
                </section>

                <Show when={current().history.length}>
                  <section class="mt-4">
                    <div class="text-12-medium text-v2-text-text-muted">{ctx.t("panel.history")}</div>
                    <ul class="mt-2 flex flex-col gap-1.5">
                      <For each={[...current().history].reverse().slice(0, 6)}>
                        {(entry) => (
                          <li class="rounded-[6px] border border-v2-border-border-muted px-2.5 py-2">
                            <div class="flex items-start justify-between gap-2">
                              <div class="min-w-0">
                                <div class="truncate text-[11px] leading-4">{entry.title}</div>
                                <div class="mt-0.5 text-[10px] leading-4 text-v2-text-text-muted">
                                  {entry.req} · v{entry.applied_version}
                                </div>
                              </div>
                              <span class="shrink-0 text-[10px] leading-4 text-v2-text-text-faint">
                                {entry.applied_at.slice(0, 10)}
                              </span>
                            </div>
                          </li>
                        )}
                      </For>
                    </ul>
                  </section>
                </Show>

                <section class="mt-4 border-t-[0.5px] border-v2-border-border-muted pt-3">
                  <div class="flex items-center justify-between gap-2">
                    <div class="text-12-medium text-v2-text-text-muted">{ctx.t("panel.review")}</div>
                    <Show when={selection()}>
                      {(selection) => (
                        <span class="text-[10px] leading-4 text-v2-text-text-faint">
                          {selection().req} · {ctx.t("panel.version", { version: selection().version })}
                        </span>
                      )}
                    </Show>
                  </div>

                  <Show when={reviewLoading()}>
                    <p class="mt-2 text-12-regular text-v2-text-text-muted">{ctx.t("panel.loading")}</p>
                  </Show>

                  <Show when={reviewError()}>
                    {(message) => (
                      <p class="mt-2 text-12-regular text-v2-state-fg-danger">{resultMessage(message())}</p>
                    )}
                  </Show>

                  <Show
                    when={review()}
                    fallback={
                      <p class="mt-2 text-12-regular text-v2-text-text-muted">{ctx.t("panel.review.select")}</p>
                    }
                  >
                    {(currentReview) => (
                      <div class="mt-2">
                        <Show when={currentReview().versions.length > 1}>
                          <div class="flex flex-wrap gap-1">
                            <For each={currentReview().versions}>
                              {(version) => (
                                <button
                                  type="button"
                                  class="rounded-[4px] border px-1.5 py-0.5 text-[10px] leading-4"
                                  classList={{
                                    "border-v2-text-text-accent text-v2-text-text-accent":
                                      selection()?.version === version,
                                    "border-v2-border-border-muted text-v2-text-text-muted":
                                      selection()?.version !== version,
                                  }}
                                  onClick={() => {
                                    const current = selection()

                                    if (current) setSelected({ ...current, version })
                                  }}
                                >
                                  v{version}
                                </button>
                              )}
                            </For>
                          </div>
                        </Show>

                        <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] leading-4 text-v2-text-text-muted">
                          <span>{statusLabel(currentReview().meta.status)}</span>
                          <Show when={currentReview().decision}>
                            {(decision) => (
                              <span>
                                {ctx.t("panel.decision")}: {decision().decision}
                              </span>
                            )}
                          </Show>
                          <Show when={currentReview().applied}>
                            {(applied) => (
                              <span class="text-v2-text-text-accent">
                                {ctx.t("panel.applied", { version: applied().version })}
                              </span>
                            )}
                          </Show>
                        </div>

                        <Show
                          when={(currentReview().summary.summary?.length ?? 0) || currentReview().summary.rationale}
                        >
                          <div class="mt-2 text-[11px] leading-4 text-v2-text-text-muted">
                            <For each={currentReview().summary.summary ?? []}>{(line) => <p>• {line}</p>}</For>
                            <Show when={currentReview().summary.rationale}>
                              <p class="mt-1">{currentReview().summary.rationale}</p>
                            </Show>
                          </div>
                        </Show>

                        <DiffView ctx={ctx} diff={reviewDiff()} />
                      </div>
                    )}
                  </Show>
                </section>
              </div>
            </Show>
          )}
        </Show>
      </div>
    </div>
  )
}

function Metric(props: { label: string; value: number; danger?: boolean }) {
  return (
    <div class="rounded-[6px] border border-v2-border-border-muted px-2.5 py-2">
      <div class="text-[10px] uppercase tracking-wide text-v2-text-text-muted">{props.label}</div>
      <div
        class="mt-1 text-14-regular"
        classList={{ "text-v2-state-fg-danger": props.danger, "text-v2-text-text-base": !props.danger }}
      >
        {props.value}
      </div>
    </div>
  )
}

function DiffView(props: { ctx: ReturnType<typeof useExtension<typeof Jin>>; diff: Diff | undefined }) {
  return (
    <Show when={props.diff}>
      {(diff) => (
        <div class="mt-3 rounded-[6px] border border-v2-border-border-muted px-2.5 py-2.5">
          <div class="flex items-center justify-between gap-2">
            <div class="text-[11px] font-medium leading-4 text-v2-text-text-muted">{props.ctx.t("panel.diff")}</div>
            <div class="text-[10px] leading-4 text-v2-text-text-faint">
              {props.ctx.t("panel.diff.total", { total: diff().summary.total_changes })}
            </div>
          </div>

          <Show
            when={diff().summary.total_changes}
            fallback={
              <p class="mt-1 text-[11px] leading-4 text-v2-text-text-muted">{props.ctx.t("panel.diff.none")}</p>
            }
          >
            <div class="mt-1 flex flex-wrap gap-1 text-[10px] leading-4">
              <Counts label={props.ctx.t("panel.diff.modules")} counts={diff().summary.modules} />
              <Counts label={props.ctx.t("panel.diff.entities")} counts={diff().summary.entities} />
            </div>

            <Show when={diff().modules.length || diff().entities.length}>
              <div class="mt-2 flex flex-col gap-2">
                <DiffGroup title={props.ctx.t("panel.diff.modules")} entries={diff().modules} showModule={false} />
                <DiffGroup title={props.ctx.t("panel.diff.entities")} entries={diff().entities} showModule />
              </div>
            </Show>

            <Show when={diff().changed_files.length}>
              <div class="mt-2">
                <div class="text-[10px] leading-4 text-v2-text-text-muted">{props.ctx.t("panel.diff.files")}</div>
                <ul class="mt-0.5 flex flex-col gap-0.5">
                  <For each={diff().changed_files.slice(0, 12)}>
                    {(file) => <li class="break-all text-[10px] leading-4 text-v2-text-text-faint">{file}</li>}
                  </For>
                </ul>
              </div>
            </Show>
          </Show>
        </div>
      )}
    </Show>
  )
}

function Counts(props: { label: string; counts: DiffCounts }) {
  const parts = () =>
    [
      ["+", props.counts.added],
      ["−", props.counts.removed],
      ["~", props.counts.changed],
      ["›", props.counts.moved],
    ].flatMap(([symbol, value]) => (Number(value) > 0 ? [`${symbol}${value}`] : []))

  return (
    <Show when={parts().length}>
      <span class="rounded-[3px] border border-v2-border-border-muted px-1 py-0.5 text-v2-text-text-muted">
        {props.label} {parts().join(" ")}
      </span>
    </Show>
  )
}

function DiffGroup(props: { title: string; entries: DiffEntry[]; showModule: boolean }) {
  return (
    <Show when={props.entries.length}>
      <div>
        <div class="text-[10px] leading-4 text-v2-text-text-muted">{props.title}</div>
        <ul class="mt-0.5 flex flex-col gap-0.5">
          <For each={props.entries.slice(0, 24)}>
            {(entry) => (
              <li class="flex min-w-0 gap-1.5 text-[10px] leading-4">
                <span
                  classList={{
                    "text-v2-text-text-accent": entry.change === "added",
                    "text-v2-state-fg-danger": entry.change === "removed",
                    "text-v2-text-text-muted": entry.change === "changed" || entry.change === "moved",
                  }}
                >
                  {changeSymbol(entry.change)}
                </span>
                <span class="min-w-0 truncate text-v2-text-text-base">{entry.id}</span>
                <Show when={props.showModule && entry.module}>
                  <span class="shrink-0 text-v2-text-text-faint">{entry.module}</span>
                </Show>
              </li>
            )}
          </For>
        </ul>
      </div>
    </Show>
  )
}
