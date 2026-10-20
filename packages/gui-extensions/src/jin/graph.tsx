import { Option, Schema } from "effect"
import { createMemo, createSignal, For, Show } from "solid-js"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { useExtension } from "../sdk"
import type Jin from "./index"

type Change = "added" | "removed" | "changed" | "moved" | "same"

type FocusTarget = { level: "entity"; id: string } | { level: "module"; id: string }

interface FocusState {
  target: FocusTarget
  entities: Set<string>
  modules: Set<string>
}

const optional = Schema.optionalKey

const Field = Schema.Struct({
  name: Schema.String,
  type: Schema.String,
  description: optional(Schema.String),
})

const Method = Schema.Struct({
  name: Schema.String,
  signature: Schema.String,
  description: optional(Schema.String),
})

const Relation = Schema.Struct({
  type: Schema.String,
  target: Schema.String,
})

const Entity = Schema.Struct({
  id: Schema.String,
  kind: Schema.String,
  name: Schema.String,
  location: Schema.Struct({ file: Schema.String, symbol: Schema.String }),
  responsibility: optional(Schema.String),
  expose: optional(Schema.String),
  status: optional(Schema.String),
  fields: optional(Schema.Array(Field)),
  methods: optional(Schema.Array(Method)),
  relations: optional(Schema.Array(Relation)),
})

const Module = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  path: optional(Schema.String),
  responsibility: optional(Schema.String),
  layer: optional(Schema.String),
  system: optional(Schema.String),
  depends_on: optional(Schema.Array(Schema.String)),
  uses_externals: optional(Schema.Array(Schema.String)),
  public_entities: optional(Schema.Array(Schema.String)),
  status: optional(Schema.String),
})

const System = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  kind: optional(Schema.String),
  path: optional(Schema.String),
  responsibility: optional(Schema.String),
  depends_on: optional(Schema.Array(Schema.String)),
})

const External = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  kind: optional(Schema.String),
  provider: optional(Schema.String),
  description: optional(Schema.String),
})

const Layer = Schema.Struct({
  id: Schema.String,
  name: optional(Schema.String),
  description: optional(Schema.String),
})

const Arch = Schema.Struct({
  l0: Schema.Struct({
    project: Schema.Struct({ name: optional(Schema.String) }),
    systems: optional(Schema.Array(System)),
    modules: optional(Schema.Array(Module)),
    externals: optional(Schema.Array(External)),
    layers: optional(Schema.Array(Layer)),
  }),
  l1: optional(
    Schema.Record(
      Schema.String,
      Schema.Struct({
        entities: Schema.Array(Entity),
      }),
    ),
  ),
})

const DiffEntry = Schema.Struct({
  id: Schema.String,
  change: Schema.String,
  module: optional(Schema.String),
  from_module: optional(Schema.String),
})

const Diff = Schema.Struct({
  modules: Schema.Array(DiffEntry),
  entities: Schema.Array(DiffEntry),
})

type ArchData = typeof Arch.Type

type RawEntity = typeof Entity.Type

type RawModule = typeof Module.Type

type RawSystem = typeof System.Type

type RawExternal = typeof External.Type

interface GraphField {
  name: string
  type: string
  description: string
}

interface GraphMethod {
  name: string
  signature: string
  description: string
}

interface GraphRelation {
  type: string
  target: string
}

interface GraphEntity {
  id: string
  kind: string
  name: string
  status: string
  expose: string
  responsibility: string
  location: { file: string; symbol: string }
  fields: GraphField[]
  methods: GraphMethod[]
  relations: GraphRelation[]
  module: string
  change: Change
  fromModule?: string
}

interface GraphModule {
  id: string
  name: string
  path: string
  responsibility: string
  layer: string
  system: string
  status: string
  depends_on: string[]
  uses_externals: string[]
  entities: GraphEntity[]
  change: Change
  fromSystem?: string
}

interface GraphSystem {
  id: string
  name: string
  kind: string
  path: string
  responsibility: string
  depends_on: string[]
  modules: GraphModule[]
  change: Change
}

interface GraphExternal {
  id: string
  name: string
  kind: string
  provider: string
  description: string
}

interface GraphLayer {
  id: string
  name: string
}

interface GraphEdge {
  from: string
  to: string
  type: string
  change: Change
}

interface Graph {
  project: string
  modules: GraphModule[]
  moduleById: Map<string, GraphModule>
  systems: GraphSystem[]
  unassigned: GraphModule[]
  layers: GraphLayer[]
  externals: GraphExternal[]
  entityById: Map<string, GraphEntity>
  entityEdges: GraphEdge[]
}

interface EntityLayout {
  entity: GraphEntity
  x: number
  y: number
  w: number
  h: number
}

interface ModuleLayout {
  module: GraphModule
  x: number
  y: number
  w: number
  h: number
  headerH: number
  open: boolean
  entities: EntityLayout[]
}

interface LayerLayout {
  id: string
  label: string
  continuation: boolean
  y: number
  h: number
  modules: ModuleLayout[]
}

interface GroupLayout {
  id: string
  title: string
  kind: string
  meta: string
  count: number
  y: number
  h: number
  layers: LayerLayout[]
}

interface EdgeRoute {
  d: string
}

interface EdgeLayout {
  key: string
  level: "module" | "entity"
  from: string
  to: string
  fromModule?: string
  toModule?: string
  change: Change
  crossLayer: boolean
  d: string
}

interface GraphLayout {
  groups: GroupLayout[]
  entities: Map<string, EntityLayout>
  entityList: EntityLayout[]
  modules: Map<string, ModuleLayout>
  moduleEdges: EdgeLayout[]
  entityEdges: EdgeLayout[]
  width: number
  height: number
}

/** The widest a member line may grow before it is ellipsized; the inspector keeps the full text. */
const MEMBER_FONT = 5.35

const PAD = 14

const SYSTEM_PAD = 12

const SYSTEM_HEAD_H = 48

const SYSTEM_GAP = 16

const RAIL_W = 96

const RAIL_GAP = 10

const CARD_GAP = 64

const MIN_CARD_W = 250

const MAX_COLUMNS = 2

const EDGE_AREA = 32

const MODULE_HEAD_H = 42

const MODULE_PAD = 7

const ENTITY_GAP = 6

const ENTITY_HEAD_H = 27

const ENTITY_PAD_BOTTOM = 5

const MEMBER_H = 15

const MAX_MEMBERS = 8

const ROW_GAP = 6

const DEFAULT_VIEWPORT = 760

const decodeArch = Schema.decodeUnknownOption(Arch)

const decodeDiff = Schema.decodeUnknownOption(Diff)

/** Builds the unified vertical graph from the target snapshot, folding in removed base nodes. */
export function ArchitectureGraph(props: {
  arch: unknown
  base?: unknown
  diff?: unknown
  title: string
  subtitle: string
}) {
  const ctx = useExtension<typeof Jin>()
  const [expanded, setExpanded] = createSignal<Record<string, boolean>>({})
  const [selected, setSelected] = createSignal<string>()
  const [hovered, setHovered] = createSignal<FocusTarget>()
  const [measured, setMeasured] = createSignal(DEFAULT_VIEWPORT)
  let scroller: HTMLDivElement | undefined

  createResizeObserver(
    () => scroller,
    (rect) => setMeasured(Math.max(0, rect.width)),
  )

  const viewport = () => (measured() > 0 ? measured() : DEFAULT_VIEWPORT)

  const metrics = createMemo(() => {
    const available = viewport() - PAD * 2 - SYSTEM_PAD * 2 - RAIL_W - RAIL_GAP - EDGE_AREA

    const columns = Math.max(
      1,
      Math.min(MAX_COLUMNS, Math.floor((available + CARD_GAP) / (MIN_CARD_W + CARD_GAP))),
    )

    const cardW = Math.max(MIN_CARD_W, (available - (columns - 1) * CARD_GAP) / columns)
    const panelW = SYSTEM_PAD * 2 + RAIL_W + RAIL_GAP + columns * cardW + (columns - 1) * CARD_GAP

    return { available, columns, cardW, panelW }
  })

  const graph = createMemo(() => {
    const decoded = decodeArch(props.arch)

    if (Option.isNone(decoded)) return undefined
    const base = props.base === undefined ? Option.none<ArchData>() : decodeArch(props.base)
    const diff = props.diff === undefined ? Option.none() : decodeDiff(props.diff)

    return buildGraph(decoded.value, Option.getOrUndefined(base), Option.getOrUndefined(diff))
  })

  const isOpen = (module: GraphModule) => module.entities.length > 0 && (expanded()[module.id] ?? true)

  const layout = createMemo<GraphLayout | undefined>(() => {
    const value = graph()

    if (!value) return undefined
    const { columns, cardW, panelW } = metrics()
    const openModules = new Set(value.modules.filter(isOpen).map((module) => module.id))
    const groups: GroupLayout[] = []
    const moduleLayouts = new Map<string, ModuleLayout>()
    const entityLayouts = new Map<string, EntityLayout>()
    const entityList: EntityLayout[] = []
    const cardStartX = PAD + SYSTEM_PAD + RAIL_W + RAIL_GAP
    let y = PAD

    const layoutModule = (module: GraphModule, x: number, startY: number): ModuleLayout => {
      const open = openModules.has(module.id)
      const entities: EntityLayout[] = []

      const bodyH = open
        ? MODULE_PAD * 2 +
          module.entities.reduce((sum, entity) => sum + entityBlockHeight(entity), 0) +
          Math.max(0, module.entities.length - 1) * ENTITY_GAP
        : 0

      if (open) {
        let entityY = startY + MODULE_HEAD_H + MODULE_PAD

        for (const entity of module.entities) {
          const entityLayout: EntityLayout = {
            entity,
            x: x + MODULE_PAD,
            y: entityY,
            w: cardW - MODULE_PAD * 2,
            h: entityBlockHeight(entity),
          }

          entities.push(entityLayout)
          entityLayouts.set(entity.id, entityLayout)
          entityList.push(entityLayout)
          entityY += entityLayout.h + ENTITY_GAP
        }
      }

      return {
        module,
        x,
        y: startY,
        w: cardW,
        h: MODULE_HEAD_H + bodyH,
        headerH: MODULE_HEAD_H,
        open,
        entities,
      }
    }

    const groupsInput: { id: string; title: string; kind: string; meta: string; modules: GraphModule[] }[] =
      value.systems.map((system) => ({
        id: system.id,
        title: system.name,
        kind: system.kind,
        meta: [system.id, system.path, ctx.plural("panel.graph.modules", system.modules.length)]
          .filter(Boolean)
          .join(" · "),
        modules: system.modules,
      }))

    if (value.unassigned.length) {
      groupsInput.push({
        id: "__unassigned",
        title: value.systems.length ? ctx.t("panel.graph.unassigned") : value.project,
        kind: value.systems.length ? "other" : "project",
        meta: ctx.plural("panel.graph.modules", value.unassigned.length),
        modules: value.unassigned,
      })
    }

    for (const group of groupsInput) {
      const groupY = y
      const layers: LayerLayout[] = []
      let rowY = groupY + SYSTEM_PAD + SYSTEM_HEAD_H

      for (const layer of value.layers) {
        const layerModules = group.modules
          .filter((module) => (module.layer || "") === layer.id)
          .sort((left, right) => left.name.localeCompare(right.name))

        if (!layerModules.length) continue

        for (const [chunkIndex, chunk] of chunkModules(layerModules, columns).entries()) {
          const modules = chunk.map((module, index) =>
            layoutModule(module, cardStartX + index * (cardW + CARD_GAP), rowY + 10),
          )

          const rowH = Math.max(...modules.map((module) => module.h), MODULE_HEAD_H) + 20

          for (const module of modules) moduleLayouts.set(module.module.id, module)
          layers.push({
            id: layer.id,
            label: layer.name || ctx.t("panel.graph.unassignedLayer"),
            continuation: chunkIndex > 0,
            y: rowY,
            h: rowH,
            modules,
          })
          rowY += rowH + ROW_GAP
        }
      }

      if (!layers.length) {
        rowY += 26
      }

      const groupH = rowY - groupY + SYSTEM_PAD
      groups.push({
        ...group,
        count: group.modules.length,
        y: groupY,
        h: groupH,
        layers,
      })
      y = groupY + groupH + SYSTEM_GAP
    }

    const layoutEdges = buildEdges(value, moduleLayouts, entityLayouts)
    const width = Math.max(viewport(), PAD * 2 + panelW + EDGE_AREA)

    return {
      groups,
      entities: entityLayouts,
      entityList,
      modules: moduleLayouts,
      moduleEdges: layoutEdges.moduleEdges,
      entityEdges: layoutEdges.entityEdges,
      width,
      height: Math.max(180, y),
    }
  })

  const focus = createMemo<FocusState | undefined>(() => {
    const current = selected()
    const target = hovered() ?? (current ? { level: "entity" as const, id: current } : undefined)
    const value = graph()

    if (!target || !value) return undefined

    if (target.level === "entity") {
      if (!value.entityById.has(target.id)) return undefined
      const entities = new Set([target.id])

      for (const edge of value.entityEdges) {
        if (edge.from === target.id) entities.add(edge.to)

        if (edge.to === target.id) entities.add(edge.from)
      }

      const modules = new Set<string>()

      for (const id of entities) {
        const entity = value.entityById.get(id)

        if (entity) modules.add(entity.module)
      }

      return { target, entities, modules }
    }

    const module = value.moduleById.get(target.id)

    if (!module) return undefined
    const modules = new Set([target.id])

    for (const dependency of module.depends_on) modules.add(dependency)

    for (const other of value.modules) {
      if (other.depends_on.includes(target.id)) modules.add(other.id)
    }

    for (const edge of value.entityEdges) {
      const from = value.entityById.get(edge.from)
      const to = value.entityById.get(edge.to)

      if (!from || !to) continue

      if (from.module === target.id) modules.add(to.module)

      if (to.module === target.id) modules.add(from.module)
    }

    return {
      target,
      entities: new Set(module.entities.map((entity) => entity.id)),
      modules,
    }
  })

  const selectedEntity = () => {
    const id = selected()

    return id ? graph()?.entityById.get(id) : undefined
  }

  const selectedModule = () => {
    const entity = selectedEntity()

    return entity ? graph()?.moduleById.get(entity.module) : undefined
  }

  const collapseAll = () => {
    const value = graph()

    if (!value) return
    setExpanded(Object.fromEntries(value.modules.map((module) => [module.id, false])))
  }

  return (
    <div data-component="jin-architecture-graph" class="min-w-0">
      <div class="flex flex-wrap items-start justify-between gap-2">
        <div class="min-w-0">
          <div class="text-12-medium">{props.title}</div>
          <div class="mt-0.5 break-all text-[10px] leading-4 text-v2-text-text-faint">{props.subtitle}</div>
        </div>
        <div class="flex shrink-0 items-center gap-1">
          <button
            type="button"
            class="rounded-[4px] border border-v2-border-border-base px-2 py-1 text-[10px] leading-4 text-v2-text-text-muted hover:text-v2-text-text-base"
            onClick={() => setExpanded({})}
          >
            {ctx.t("panel.graph.expandAll")}
          </button>
          <button
            type="button"
            class="rounded-[4px] border border-v2-border-border-base px-2 py-1 text-[10px] leading-4 text-v2-text-text-muted hover:text-v2-text-text-base"
            onClick={collapseAll}
          >
            {ctx.t("panel.graph.collapseAll")}
          </button>
        </div>
      </div>

      <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] leading-4 text-v2-text-text-muted">
        <span class="flex items-center gap-1">
          <svg width="22" height="8" viewBox="0 0 22 8" aria-hidden="true">
            <line x1="1" y1="4" x2="21" y2="4" stroke="#2563eb" stroke-width="1.5" stroke-dasharray="5 3" />
          </svg>
          {ctx.t("panel.graph.legend.module")}
        </span>
        <span class="flex items-center gap-1">
          <svg width="22" height="8" viewBox="0 0 22 8" aria-hidden="true">
            <line x1="1" y1="4" x2="21" y2="4" stroke="#0891b2" stroke-width="1.8" />
          </svg>
          {ctx.t("panel.graph.legend.entity")}
        </span>
        <Show when={graph()}>
          {(value) => (
            <span class="flex flex-wrap gap-x-2 text-v2-text-text-faint">
              <span>{ctx.plural("panel.graph.systems", value().systems.length)}</span>
              <span>{ctx.plural("panel.graph.modules", value().modules.length)}</span>
              <span>{ctx.plural("panel.graph.entities", value().entityById.size)}</span>
            </span>
          )}
        </Show>
      </div>

      <div class="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[9px] leading-3">
        <span class="text-v2-text-text-faint">{ctx.t("panel.graph.legend.diff")}</span>
        <ChangeChip change="added" label={ctx.t("panel.graph.change.added")} />
        <ChangeChip change="removed" label={ctx.t("panel.graph.change.removed")} />
        <ChangeChip change="changed" label={ctx.t("panel.graph.change.changed")} />
        <ChangeChip change="moved" label={ctx.t("panel.graph.change.moved")} />
      </div>
      <p class="mt-1 text-[9px] leading-3 text-v2-text-text-faint">{ctx.t("panel.graph.focusHint")}</p>

      <Show
        when={layout()}
        fallback={<p class="mt-3 text-12-regular text-v2-text-text-muted">{ctx.t("panel.graph.empty")}</p>}
      >
        {(value) => (
          <div class="mt-2 flex min-w-0 items-start gap-2">
            <div
              ref={scroller}
              class="min-w-0 flex-1 overflow-auto rounded-[6px] border border-v2-border-border-muted bg-v2-background-bg-layer-01"
              style={{ "max-height": "72vh" }}
            >
              <svg
                width={value().width}
                height={value().height}
                viewBox={`0 0 ${value().width} ${value().height}`}
                class="block"
                onClick={() => {
                  setSelected(undefined)
                  setHovered(undefined)
                }}
                onPointerLeave={() => setHovered(undefined)}
              >
                <defs>
                  <marker
                    id="jin-arrow-blue"
                    viewBox="0 0 8 8"
                    refX="8"
                    refY="4"
                    markerWidth="7"
                    markerHeight="7"
                    orient="auto"
                  >
                    <path d="M 0 0 L 8 4 L 0 8 z" fill="#2563eb" />
                  </marker>
                  <marker
                    id="jin-arrow-cyan"
                    viewBox="0 0 8 8"
                    refX="8"
                    refY="4"
                    markerWidth="7"
                    markerHeight="7"
                    orient="auto"
                  >
                    <path d="M 0 0 L 8 4 L 0 8 z" fill="#0891b2" />
                  </marker>
                  <marker
                    id="jin-arrow-muted"
                    viewBox="0 0 8 8"
                    refX="8"
                    refY="4"
                    markerWidth="7"
                    markerHeight="7"
                    orient="auto"
                  >
                    <path d="M 0 0 L 8 4 L 0 8 z" fill="var(--v2-text-text-faint)" />
                  </marker>
                  <pattern
                    id="jin-removed-hatch"
                    width="7"
                    height="7"
                    patternUnits="userSpaceOnUse"
                    patternTransform="rotate(45)"
                  >
                    <line
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="7"
                      stroke="var(--v2-state-fg-danger)"
                      stroke-width="0.7"
                      opacity="0.45"
                    />
                  </pattern>
                </defs>

                <For each={value().groups}>
                  {(group) => (
                    <>
                      <g opacity={groupActive(group, focus()) ? 1 : 0.28}>
                        <rect
                          x={PAD}
                          y={group.y}
                          width={metrics().panelW}
                          height={group.h}
                          rx="9"
                          fill="var(--v2-background-bg-layer-01)"
                          stroke="var(--v2-border-border-muted)"
                        />
                        <rect
                          x={PAD + 1}
                          y={group.y + 1}
                          width="3"
                          height={group.h - 2}
                          rx="1.5"
                          fill="var(--v2-text-text-accent)"
                        />
                      </g>

                      <For each={group.layers}>
                        {(layer) => (
                          <g opacity={layerActive(layer, focus()) ? 1 : 0.28}>
                            <rect
                              x={PAD + SYSTEM_PAD}
                              y={layer.y}
                              width={RAIL_W}
                              height={layer.h}
                              rx="6"
                              fill="var(--v2-background-bg-layer-02)"
                            />
                            <rect
                              x={PAD + SYSTEM_PAD}
                              y={layer.y}
                              width="2.5"
                              height={layer.h}
                              rx="1.25"
                              fill="var(--v2-text-text-accent)"
                              opacity="0.55"
                            />
                            <text
                              x={PAD + SYSTEM_PAD + 10}
                              y={layer.y + 21}
                              class="text-[11px] font-medium leading-4"
                              style={{ fill: "var(--v2-text-text-base)" }}
                            >
                              {truncate(layer.continuation ? `↳ ${layer.label}` : layer.label, 15)}
                            </text>
                            <text
                              x={PAD + SYSTEM_PAD + 10}
                              y={layer.y + 35}
                              class="text-[8px] leading-3"
                              style={{ fill: "var(--v2-text-text-faint)" }}
                            >
                              {truncate(ctx.plural("panel.graph.modules", layer.modules.length), 15)}
                            </text>
                          </g>
                        )}
                      </For>
                    </>
                  )}
                </For>

                <For each={value().groups}>
                  {(group) => (
                    <For each={group.layers}>
                      {(layer) => (
                        <For each={layer.modules}>
                          {(module) => (
                            <ModuleCard
                              row={module}
                              focus={focus()}
                              planned={ctx.t("panel.graph.planned")}
                              onHover={setHovered}
                              onToggle={() =>
                                setExpanded((previous) => ({
                                  ...previous,
                                  [module.module.id]: !module.open,
                                }))
                              }
                            />
                          )}
                        </For>
                      )}
                    </For>
                  )}
                </For>

                <For each={value().groups}>
                  {(group) => (
                    <g opacity={groupActive(group, focus()) ? 1 : 0.28}>
                      <rect
                        x={PAD + 1}
                        y={group.y + 1}
                        width={metrics().panelW - 2}
                        height={SYSTEM_HEAD_H}
                        rx="8"
                        fill="var(--v2-background-bg-layer-02)"
                      />
                      <text
                        x={PAD + 14}
                        y={group.y + 20}
                        class="text-[13px] font-medium leading-5"
                        style={{ fill: "var(--v2-text-text-base)" }}
                      >
                        {group.title}
                      </text>
                      <text
                        x={PAD + 14}
                        y={group.y + 35}
                        class="text-[9px] leading-3"
                        style={{ fill: "var(--v2-text-text-faint)" }}
                      >
                        {truncate(group.meta, fitChars(metrics().panelW - 90, 4.6))}
                      </text>
                      <text
                        x={PAD + metrics().panelW - 12}
                        y={group.y + 29}
                        text-anchor="end"
                        class="text-[9px] uppercase tracking-wide leading-3"
                        style={{ fill: "var(--v2-text-text-muted)" }}
                      >
                        {truncate(group.kind, 14)}
                      </text>
                      <Show when={!group.layers.length}>
                        <text
                          x={PAD + SYSTEM_PAD + 12}
                          y={group.y + SYSTEM_HEAD_H + 22}
                          class="text-[10px] leading-4"
                          style={{ fill: "var(--v2-text-text-faint)" }}
                        >
                          {ctx.t("panel.graph.noModules")}
                        </text>
                      </Show>
                    </g>
                  )}
                </For>

                <Show when={!focus() || focus()?.target.level === "module"}>
                  <For each={value().moduleEdges}>
                    {(edge) => (
                      <Show when={!focus() || edgeActive(edge, focus())}>
                        <EdgePath
                          edge={edge}
                          active={!!focus() && edgeActive(edge, focus())}
                          opacity={focus() ? 1 : 0.2}
                        />
                      </Show>
                    )}
                  </For>
                </Show>

                <For each={value().entityEdges}>
                  {(edge) => (
                    <Show when={!focus()}>
                      <EdgePath edge={edge} active={false} opacity={0.2} />
                    </Show>
                  )}
                </For>

                <For each={value().entityList}>
                  {(row) => (
                    <EntityCard
                      row={row}
                      selected={selected() === row.entity.id}
                      focus={focus()}
                      empty={ctx.t("panel.graph.noMembers")}
                      onSelect={setSelected}
                      onHover={setHovered}
                    />
                  )}
                </For>

                <Show when={focus()?.target.level === "entity"}>
                  <For each={value().entityEdges}>
                    {(edge) => (
                      <Show when={edgeActive(edge, focus())}>
                        <EdgePath edge={edge} active opacity={1} overlay />
                      </Show>
                    )}
                  </For>
                </Show>

              </svg>
            </div>

            <aside
              class="w-[220px] shrink-0 overflow-y-auto rounded-[6px] border border-v2-border-border-muted bg-v2-background-bg-base px-3 py-3"
              style={{ "max-height": "72vh" }}
            >
              <Show when={selectedEntity()} fallback={<DetailEmpty ctx={ctx} graph={graph()} />}>
                {(entity) => (
                  <EntityDetail
                    ctx={ctx}
                    entity={entity()}
                    module={selectedModule()}
                    target={(id) => graph()?.entityById.get(id)}
                    onSelect={(id) => setSelected(id)}
                    onClose={() => setSelected(undefined)}
                  />
                )}
              </Show>
            </aside>
          </div>
        )}
      </Show>
    </div>
  )
}

function ModuleCard(props: {
  row: ModuleLayout
  focus: FocusState | undefined
  planned: string
  onToggle: () => void
  onHover: (target: FocusTarget | undefined) => void
}) {
  const change = () => props.row.module.change
  const focused = () => moduleFocused(props.row.module.id, props.focus)
  const related = () => moduleRelated(props.row.module.id, props.focus)

  return (
    <g
      opacity={moduleOpacity(props.row.module.id, props.focus)}
      onPointerEnter={() => props.onHover({ level: "module", id: props.row.module.id })}
      onPointerLeave={() => props.onHover(undefined)}
      onClick={(event) => {
        event.stopPropagation()
        props.onToggle()
      }}
      style={{ cursor: "pointer" }}
    >
      <rect
        x={props.row.x}
        y={props.row.y}
        width={props.row.w}
        height={props.row.h}
        rx="7"
        fill="var(--v2-background-bg-layer-01)"
        stroke={changeStroke(change())}
        stroke-width={changeWidth(change())}
        stroke-dasharray={
          changeDash(change()) ?? (props.row.module.status === "planned" ? "3 2" : undefined)
        }
      />
      <Show when={change() !== "same"}>
        <rect
          x={props.row.x}
          y={props.row.y}
          width={props.row.w}
          height={props.row.h}
          rx="7"
          fill={changeFill(change())}
          opacity="0.26"
          pointer-events="none"
        />
        <Show when={change() === "removed"}>
          <rect
            x={props.row.x}
            y={props.row.y}
            width={props.row.w}
            height={props.row.h}
            rx="7"
            fill="url(#jin-removed-hatch)"
            pointer-events="none"
          />
        </Show>
      </Show>
      <rect
        x={props.row.x}
        y={props.row.y}
        width={props.row.w}
        height={props.row.headerH}
        rx="7"
        fill="var(--v2-background-bg-layer-02)"
      />
      <rect
        x={props.row.x}
        y={props.row.y}
        width="3"
        height={props.row.headerH}
        rx="1.5"
        fill={changeStroke(change())}
      />
      <text
        x={props.row.x + 11}
        y={props.row.y + 17}
        class="text-[11px] font-medium leading-4"
        style={{
          fill:
            change() === "removed"
              ? "var(--v2-text-text-faint)"
              : "var(--v2-text-text-base)",
        }}
      >
        {truncate(props.row.module.name, fitChars(props.row.w - 62, 5.4))}
      </text>
      <text
        x={props.row.x + 11}
        y={props.row.y + 31}
        class="text-[8px] leading-3"
        style={{ fill: "var(--v2-text-text-faint)" }}
      >
        {truncate(
          [
            props.row.module.id,
            props.row.module.status === "planned" ? props.planned : "",
          ]
            .filter(Boolean)
            .join(" · "),
          fitChars(props.row.w - 32, 4.4),
        )}
      </text>
      <text
        x={props.row.x + props.row.w - 9}
        y={props.row.y + 32}
        text-anchor="end"
        class="text-[9px] leading-3"
        style={{ fill: "var(--v2-text-text-faint)" }}
      >
        {props.row.module.entities.length
          ? `${props.row.module.entities.length} · ${props.row.open ? "▾" : "▸"}`
          : ""}
      </text>
      <ChangeBadge change={change()} x={props.row.x + props.row.w - 20} y={props.row.y + 7} />

      <Show when={focused() || related()}>
        <rect
          x={props.row.x - 2}
          y={props.row.y - 2}
          width={props.row.w + 4}
          height={props.row.h + 4}
          rx="9"
          fill="none"
          stroke={focused() ? "var(--v2-text-text-accent)" : "#0891b2"}
          stroke-width={focused() ? 1.8 : 1.1}
          opacity={focused() ? 1 : 0.85}
          pointer-events="none"
        />
      </Show>
    </g>
  )
}

function EdgePath(props: { edge: EdgeLayout; active: boolean; opacity: number; overlay?: boolean }) {
  return (
    <g opacity={props.opacity} pointer-events="none">
      <Show when={props.active}>
        <path
          d={props.edge.d}
          fill="none"
          stroke={props.overlay ? "var(--v2-background-bg-base)" : "var(--v2-background-bg-layer-01)"}
          stroke-width="4.8"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </Show>
      <path
        d={props.edge.d}
        fill="none"
        stroke={edgeColor(props.edge, props.active)}
        stroke-width={edgeWidth(props.edge, props.active)}
        stroke-dasharray={props.edge.level === "module" && props.edge.crossLayer ? "6 4" : undefined}
        marker-end={`url(#${edgeMarker(props.edge, props.active)})`}
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </g>
  )
}

function ChangeBadge(props: { change: Change; x: number; y: number }) {
  return (
    <Show when={props.change !== "same"}>
      <g pointer-events="none">
        <rect
          x={props.x}
          y={props.y}
          width="14"
          height="12"
          rx="3"
          fill={changeFill(props.change)}
          stroke={changeStroke(props.change)}
          stroke-width="0.9"
          stroke-dasharray={props.change === "removed" || props.change === "moved" ? "2 1.5" : undefined}
        />
        <text
          x={props.x + 7}
          y={props.y + 9}
          text-anchor="middle"
          style={{ fill: changeStroke(props.change), "font-size": "8px", "font-weight": 600 }}
        >
          {changeSymbol(props.change)}
        </text>
      </g>
    </Show>
  )
}

function ChangeChip(props: { change: Change; label: string }) {
  return (
    <span
      class="inline-flex items-center gap-1 rounded-[3px] border px-1 py-0.5"
      style={{
        "border-color": changeStroke(props.change),
        "border-style": props.change === "removed" || props.change === "moved" ? "dashed" : "solid",
        color: changeStroke(props.change),
        "background-color": props.change === "moved" ? "#7c3aed1a" : changeFill(props.change),
      }}
    >
      <span class="font-medium">{changeSymbol(props.change)}</span>
      <span>{props.label}</span>
    </span>
  )
}

function EntityCard(props: {
  row: EntityLayout
  selected: boolean
  focus: FocusState | undefined
  empty: string
  onSelect: (id: string) => void
  onHover: (target: FocusTarget | undefined) => void
}) {
  const entity = () => props.row.entity
  const lines = () => memberLines(entity()).slice(0, MAX_MEMBERS)
  const total = () => entity().fields.length + entity().methods.length
  const hidden = () => Math.max(0, total() - MAX_MEMBERS)
  const focused = () => entityFocused(entity().id, props.focus)
  const related = () => entityRelated(entity().id, props.focus)

  return (
    <g
      opacity={entityOpacity(entity(), props.focus)}
      onPointerEnter={() => props.onHover({ level: "entity", id: entity().id })}
      onPointerLeave={() => props.onHover(undefined)}
      onClick={(event) => {
        event.stopPropagation()
        props.onSelect(entity().id)
      }}
      style={{ cursor: "pointer" }}
    >
      <rect
        x={props.row.x}
        y={props.row.y}
        width={props.row.w}
        height={props.row.h}
        rx="5"
        fill="var(--v2-background-bg-base)"
        stroke={changeStroke(entity().change)}
        stroke-width={changeWidth(entity().change)}
        stroke-dasharray={changeDash(entity().change) ?? (entity().status === "planned" ? "3 2" : undefined)}
      />
      <Show when={entity().change !== "same"}>
        <rect
          x={props.row.x}
          y={props.row.y}
          width={props.row.w}
          height={props.row.h}
          rx="5"
          fill={changeFill(entity().change)}
          opacity="0.28"
          pointer-events="none"
        />
        <Show when={entity().change === "removed"}>
          <rect
            x={props.row.x}
            y={props.row.y}
            width={props.row.w}
            height={props.row.h}
            rx="5"
            fill="url(#jin-removed-hatch)"
            pointer-events="none"
          />
        </Show>
      </Show>
      <rect
        x={props.row.x}
        y={props.row.y}
        width={props.row.w}
        height={ENTITY_HEAD_H}
        rx="5"
        fill="var(--v2-background-bg-layer-01)"
      />
      <text
        x={props.row.x + 7}
        y={props.row.y + 17}
        class="text-[8px] font-medium uppercase leading-3"
        style={{ fill: "var(--v2-text-text-accent)" }}
      >
        {abbreviate(entity().kind)}
      </text>
      <text
        x={props.row.x + 32}
        y={props.row.y + 17}
        class="text-[10.5px] font-medium leading-4"
        style={{
          fill:
            entity().change === "removed"
              ? "var(--v2-text-text-faint)"
              : "var(--v2-text-text-base)",
        }}
      >
        {truncate(entity().name, fitChars(props.row.w - 94, 5.4))}
      </text>
      <text
        x={props.row.x + props.row.w - (entity().change === "same" ? 6 : 24)}
        y={props.row.y + 17}
        text-anchor="end"
        class="text-[8px] leading-3"
        style={{ fill: "var(--v2-text-text-faint)" }}
      >
        {memberCount(entity())}
      </text>
      <ChangeBadge change={entity().change} x={props.row.x + props.row.w - 20} y={props.row.y + 6} />
      <Show when={focused() || related()}>
        <rect
          x={props.row.x - 2}
          y={props.row.y - 2}
          width={props.row.w + 4}
          height={props.row.h + 4}
          rx="7"
          fill="none"
          stroke={focused() ? "var(--v2-text-text-accent)" : "#0891b2"}
          stroke-width={focused() ? 1.8 : 1.1}
          opacity={focused() ? 1 : 0.85}
          pointer-events="none"
        />
      </Show>
      <line
        x1={props.row.x + 6}
        y1={props.row.y + ENTITY_HEAD_H}
        x2={props.row.x + props.row.w - 6}
        y2={props.row.y + ENTITY_HEAD_H}
        stroke="var(--v2-border-border-muted)"
      />

      <Show
        when={lines().length}
        fallback={
          <text
            x={props.row.x + 8}
            y={props.row.y + ENTITY_HEAD_H + 14}
            class="text-[9px] leading-3"
            style={{ fill: "var(--v2-text-text-faint)" }}
          >
            {props.empty}
          </text>
        }
      >
        <For each={lines()}>
          {(line, index) => (
            <text
              x={props.row.x + 8}
              y={props.row.y + ENTITY_HEAD_H + 13 + index() * MEMBER_H}
              class="text-[9px] leading-3"
              style={{ fill: "var(--v2-text-text-muted)" }}
            >
              <tspan style={{ fill: line.kind === "method" ? "#0891b2" : "var(--v2-text-text-faint)" }}>
                {line.kind === "method" ? "M" : "F"}
              </tspan>
              <tspan dx="6" style={{ fill: "var(--v2-text-text-base)" }}>
                {truncate(line.text, fitChars(props.row.w - 34, MEMBER_FONT))}
              </tspan>
            </text>
          )}
        </For>
      </Show>

      <Show when={hidden() > 0}>
        <text
          x={props.row.x + 18}
          y={props.row.y + ENTITY_HEAD_H + 13 + lines().length * MEMBER_H}
          class="text-[8px] leading-3"
          style={{ fill: "var(--v2-text-text-faint)" }}
        >
          +{hidden()}
        </text>
      </Show>
    </g>
  )
}

function DetailEmpty(props: {
  ctx: ReturnType<typeof useExtension<typeof Jin>>
  graph: Graph | undefined
}) {
  return (
    <div>
      <div class="text-[11px] font-medium leading-4">{props.ctx.t("panel.graph.detail")}</div>
      <p class="mt-1 text-[10px] leading-4 text-v2-text-text-muted">{props.ctx.t("panel.graph.detail.empty")}</p>
      <Show when={props.graph}>
        {(graph) => (
          <div class="mt-3 flex flex-col gap-1 border-t-[0.5px] border-v2-border-border-muted pt-2 text-[10px] leading-4">
            <div class="flex justify-between gap-2">
              <span class="text-v2-text-text-faint">{props.ctx.t("panel.graph.systems")}</span>
              <span>{graph().systems.length}</span>
            </div>
            <div class="flex justify-between gap-2">
              <span class="text-v2-text-text-faint">{props.ctx.t("panel.graph.modulesLabel")}</span>
              <span>{graph().modules.length}</span>
            </div>
            <div class="flex justify-between gap-2">
              <span class="text-v2-text-text-faint">{props.ctx.t("panel.graph.entitiesLabel")}</span>
              <span>{graph().entityById.size}</span>
            </div>
            <div class="flex justify-between gap-2">
              <span class="text-v2-text-text-faint">{props.ctx.t("panel.graph.layersLabel")}</span>
              <span>{graph().layers.length}</span>
            </div>
          </div>
        )}
      </Show>
    </div>
  )
}

function EntityDetail(props: {
  ctx: ReturnType<typeof useExtension<typeof Jin>>
  entity: GraphEntity
  module: GraphModule | undefined
  target: (id: string) => GraphEntity | undefined
  onSelect: (id: string) => void
  onClose: () => void
}) {
  return (
    <div>
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <div class="truncate text-[11px] font-medium leading-4">{props.entity.name}</div>
          <div class="mt-0.5 break-all text-[9px] leading-3 text-v2-text-text-faint">{props.entity.id}</div>
        </div>
        <button
          type="button"
          class="shrink-0 text-[12px] leading-4 text-v2-text-text-muted hover:text-v2-text-text-base"
          aria-label={props.ctx.t("panel.graph.close")}
          onClick={props.onClose}
        >
          ×
        </button>
      </div>

      <div class="mt-2 flex flex-wrap gap-1 text-[9px] leading-3">
        <span class="rounded-[3px] border border-v2-border-border-muted px-1 py-0.5 text-v2-text-text-muted">
          {props.entity.kind}
        </span>
        <span class="rounded-[3px] border border-v2-border-border-muted px-1 py-0.5 text-v2-text-text-muted">
          {props.entity.expose}
        </span>
        <Show when={props.entity.status !== "active"}>
          <span class="rounded-[3px] border border-v2-border-border-muted px-1 py-0.5 text-v2-text-text-muted">
            {props.entity.status === "planned" ? props.ctx.t("panel.graph.planned") : props.entity.status}
          </span>
        </Show>
        <Show when={props.entity.change !== "same"}>
          <span class="rounded-[3px] border border-v2-border-border-muted px-1 py-0.5 text-v2-text-text-muted">
            {changeSymbol(props.entity.change)} {changeLabel(props.ctx, props.entity.change)}
          </span>
        </Show>
      </div>

      <Show when={props.entity.responsibility}>
        <p class="mt-2 text-[10px] leading-4 text-v2-text-text-muted">{props.entity.responsibility}</p>
      </Show>

      <div class="mt-2 border-t-[0.5px] border-v2-border-border-muted pt-2">
        <div class="text-[9px] uppercase tracking-wide text-v2-text-text-faint">
          {props.ctx.t("panel.graph.module")}
        </div>
        <div class="mt-0.5 break-all text-[10px] leading-4">
          {props.module?.name ?? props.entity.module}
          <span class="text-v2-text-text-faint"> · {props.entity.module}</span>
        </div>
        <div class="mt-1.5 text-[9px] uppercase tracking-wide text-v2-text-text-faint">
          {props.ctx.t("panel.graph.location")}
        </div>
        <code class="mt-0.5 block break-all text-[9px] leading-3 text-v2-text-text-muted">
          {props.entity.location.file} :: {props.entity.location.symbol}
        </code>
      </div>

      <div class="mt-2 flex flex-wrap gap-x-2 gap-y-0.5 border-t-[0.5px] border-v2-border-border-muted pt-2 text-[9px] leading-3 text-v2-text-text-faint">
        <span>
          {props.entity.fields.length} {props.ctx.t("panel.graph.fields")}
        </span>
        <span>
          {props.entity.methods.length} {props.ctx.t("panel.graph.methods")}
        </span>
        <span>
          {props.entity.relations.length} {props.ctx.t("panel.graph.relations")}
        </span>
      </div>

      <MemberSection
        title={props.ctx.t("panel.graph.fields")}
        empty={props.ctx.t("panel.graph.noFields")}
        lines={props.entity.fields.map((field) => ({
          key: field.name,
          label: "F",
          main: field.name,
          detail: field.type,
          description: field.description,
        }))}
      />
      <MemberSection
        title={props.ctx.t("panel.graph.methods")}
        empty={props.ctx.t("panel.graph.noMethods")}
        lines={props.entity.methods.map((method) => ({
          key: method.name,
          label: "M",
          main: method.signature || `${method.name}()`,
          detail: "",
          description: method.description,
        }))}
      />

      <div class="mt-3">
        <div class="text-[10px] font-medium leading-4 text-v2-text-text-muted">
          {props.ctx.t("panel.graph.relations")}
        </div>
        <Show
          when={props.entity.relations.length}
          fallback={
            <p class="mt-1 text-[9px] leading-3 text-v2-text-text-faint">{props.ctx.t("panel.graph.noRelations")}</p>
          }
        >
          <ul class="mt-1 flex flex-col gap-1">
            <For each={props.entity.relations}>
              {(relation) => (
                <li class="flex min-w-0 gap-1 text-[9px] leading-3">
                  <span class="shrink-0 text-v2-text-text-faint">{relation.type} →</span>
                  <button
                    type="button"
                    class="min-w-0 break-words text-left text-v2-text-text-muted hover:text-v2-text-text-base"
                    onClick={() => props.onSelect(relation.target)}
                  >
                    {props.target(relation.target)?.name ?? relation.target}
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </div>
    </div>
  )
}

function MemberSection(props: {
  title: string
  empty: string
  lines: { key: string; label: string; main: string; detail: string; description: string }[]
}) {
  return (
    <div class="mt-3">
      <div class="text-[10px] font-medium leading-4 text-v2-text-text-muted">{props.title}</div>
      <Show
        when={props.lines.length}
        fallback={<p class="mt-1 text-[9px] leading-3 text-v2-text-text-faint">{props.empty}</p>}
      >
        <ul class="mt-1 flex flex-col gap-1">
          <For each={props.lines}>
            {(line) => (
              <li class="min-w-0" title={line.description || undefined}>
                <div class="flex min-w-0 gap-1 text-[9px] leading-3">
                  <span class="shrink-0 text-v2-text-text-faint">{line.label}</span>
                  <span class="min-w-0 break-words text-v2-text-text-base">
                    {line.main}
                    <Show when={line.detail}>
                      <span class="text-v2-text-text-faint">: {line.detail}</span>
                    </Show>
                  </span>
                </div>
                <Show when={line.description}>
                  <p class="mt-0.5 pl-3 text-[9px] leading-3 text-v2-text-text-faint">{line.description}</p>
                </Show>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  )
}

export function buildGraph(
  arch: ArchData,
  base: ArchData | undefined,
  diff:
    | {
        readonly modules: readonly {
          readonly id: string
          readonly change: string
          readonly module?: string
          readonly from_module?: string
        }[]
        readonly entities: readonly {
          readonly id: string
          readonly change: string
          readonly module?: string
          readonly from_module?: string
        }[]
      }
    | undefined,
): Graph {
  const moduleDiff = new Map((diff?.modules ?? []).map((entry) => [entry.id, entry]))
  const entityDiff = new Map((diff?.entities ?? []).map((entry) => [entry.id, entry]))
  const baseEntities = new Map<string, { entity: RawEntity; module: string }>()
  const baseModules = new Map<string, RawModule>()

  for (const module of base?.l0.modules ?? []) baseModules.set(module.id, module)

  for (const [module, l1] of Object.entries(base?.l1 ?? {})) {
    for (const entity of l1.entities ?? []) baseEntities.set(entity.id, { entity, module })
  }

  const modules = new Map<string, GraphModule>()

  for (const raw of arch.l0.modules ?? []) {
    const l1 = arch.l1?.[raw.id]
    modules.set(raw.id, {
      ...toModule(raw),
      change: changeOf(moduleDiff.get(raw.id)?.change),
      entities: (l1?.entities ?? []).map((entity) =>
        toEntity(entity, raw.id, changeOf(entityDiff.get(entity.id)?.change), entityDiff.get(entity.id)?.from_module),
      ),
    })
  }

  for (const entry of diff?.modules ?? []) {
    if (entry.change !== "removed" || modules.has(entry.id)) continue
    const raw = baseModules.get(entry.id)

    if (!raw) continue
    modules.set(entry.id, {
      ...toModule(raw),
      change: "removed",
      entities: (base?.l1?.[entry.id]?.entities ?? []).map((entity) => toEntity(entity, entry.id, "removed")),
    })
  }

  for (const entry of diff?.entities ?? []) {
    if (entry.change !== "removed") continue
    const target = modules.get(entry.module ?? baseEntities.get(entry.id)?.module ?? "")

    if (!target) continue

    if (target.entities.some((entity) => entity.id === entry.id)) continue
    const hit = baseEntities.get(entry.id)

    if (!hit) continue
    target.entities.push(toEntity(hit.entity, target.id, "removed"))
  }

  const entityById = new Map<string, GraphEntity>()

  for (const module of modules.values()) {
    for (const entity of module.entities) entityById.set(entity.id, entity)
  }

  const entityEdges: GraphEdge[] = []

  for (const module of modules.values()) {
    for (const entity of module.entities) {
      for (const relation of entity.relations) {
        const target = entityById.get(relation.target)

        if (!target) continue
        entityEdges.push({
          from: entity.id,
          to: target.id,
          type: relation.type,
          change: combineChange([entity.change, target.change]),
        })
      }
    }
  }

  const systemModules = (id: string) => [...modules.values()].filter((module) => module.system === id)

  const systems: GraphSystem[] = (arch.l0.systems ?? []).map((system) => ({
    ...toSystem(system),
    modules: systemModules(system.id),
    change: combineChange(systemModules(system.id).map((module) => module.change)),
  }))

  const systemIds = new Set(systems.map((system) => system.id))
  const unassigned = [...modules.values()].filter((module) => !module.system || !systemIds.has(module.system))

  const layers: GraphLayer[] = (arch.l0.layers ?? []).map((layer) => ({ id: layer.id, name: layer.name ?? layer.id }))
  const knownLayers = new Set(layers.map((layer) => layer.id))

  for (const module of modules.values()) {
    const id = module.layer || ""

    if (knownLayers.has(id)) continue
    knownLayers.add(id)
    layers.push({ id, name: id })
  }

  if (!layers.length) layers.push({ id: "", name: "" })

  return {
    project: arch.l0.project.name ?? "Project",
    modules: [...modules.values()],
    moduleById: modules,
    systems,
    unassigned,
    layers,
    externals: (arch.l0.externals ?? []).map(toExternal),
    entityById,
    entityEdges,
  }
}

function buildEdges(
  graph: Graph,
  modules: Map<string, ModuleLayout>,
  entities: Map<string, EntityLayout>,
) {
  const moduleEdgeMap = new Map<
    string,
    { from: GraphModule; to: GraphModule; types: Set<string>; changes: Change[] }
  >()

  const addModuleEdge = (from: GraphModule, to: GraphModule, type: string, change: Change) => {
    if (from.id === to.id) return
    const key = `${from.id}->${to.id}`
    const value = moduleEdgeMap.get(key) ?? { from, to, types: new Set<string>(), changes: [] }
    value.types.add(type)
    value.changes.push(change)
    moduleEdgeMap.set(key, value)
  }

  for (const module of graph.modules) {
    for (const dependency of module.depends_on) {
      const target = graph.moduleById.get(dependency)

      if (target) addModuleEdge(module, target, "depends_on", module.change)
    }
  }

  const rawEntityEdges: { from: GraphEntity; to: GraphEntity; type: string; change: Change }[] = []

  for (const edge of graph.entityEdges) {
    if (edge.from === edge.to) continue
    const from = graph.entityById.get(edge.from)
    const to = graph.entityById.get(edge.to)

    if (!from || !to) continue
    const fromLayout = entities.get(from.id)
    const toLayout = entities.get(to.id)
    const fromModule = graph.moduleById.get(from.module)
    const toModule = graph.moduleById.get(to.module)

    if (!fromModule || !toModule) continue

    if (fromLayout && toLayout) {
      rawEntityEdges.push({ from, to, type: edge.type, change: edge.change })
    } else {
      addModuleEdge(fromModule, toModule, edge.type, edge.change)
    }
  }

  const moduleEdges: EdgeLayout[] = []
  let moduleEdgeIndex = 0

  for (const value of moduleEdgeMap.values()) {
    const from = modules.get(value.from.id)
    const to = modules.get(value.to.id)

    if (!from || !to) continue
    const route = routeModuleEdge(from, to, moduleEdgeIndex++)

    moduleEdges.push({
      key: `m:${value.from.id}->${value.to.id}`,
      level: "module",
      from: value.from.id,
      to: value.to.id,
      change: combineChange(value.changes),
      crossLayer: from.module.layer !== to.module.layer,
      ...route,
    })
  }

  const entityEdges: EdgeLayout[] = []
  let entityEdgeIndex = 0

  for (const edge of rawEntityEdges) {
    const from = modules.get(edge.from.module)
    const to = modules.get(edge.to.module)
    const fromEntity = entities.get(edge.from.id)
    const toEntity = entities.get(edge.to.id)

    if (!from || !to || !fromEntity || !toEntity) continue
    const route = routeEntityEdge(fromEntity, toEntity, from, to, entityEdgeIndex++)

    entityEdges.push({
      key: `e:${edge.from.id}->${edge.to.id}:${edge.type}`,
      level: "entity",
      from: edge.from.id,
      to: edge.to.id,
      fromModule: from.module.id,
      toModule: to.module.id,
      change: edge.change,
      crossLayer: from.module.layer !== to.module.layer,
      ...route,
    })
  }

  return { moduleEdges, entityEdges }
}

function routeModuleEdge(from: ModuleLayout, to: ModuleLayout, index: number): EdgeRoute {
  const y1 = from.y + from.headerH / 2
  const y2 = to.y + to.headerH / 2

  if (from.x === to.x) {
    return curveRoute(from.x + from.w, y1, to.x + to.w + 2, y2, from.x + from.w + 22)
  }

  const bow = edgeBow(index)

  if (from.x < to.x) return directRoute(from.x + from.w + 2, y1, to.x - 2, y2, bow)

  return directRoute(from.x - 2, y1, to.x + to.w + 2, y2, bow)
}

function routeEntityEdge(
  from: EntityLayout,
  to: EntityLayout,
  fromModule: ModuleLayout,
  toModule: ModuleLayout,
  index: number,
): EdgeRoute {
  const y1 = from.y + ENTITY_HEAD_H / 2
  const y2 = to.y + ENTITY_HEAD_H / 2
  const overlaps = from.x < to.x + to.w && to.x < from.x + from.w

  if (overlaps) {
    const lane = Math.max(fromModule.x + fromModule.w, toModule.x + toModule.w) + 28

    return curveRoute(from.x + from.w + 2, y1, to.x + to.w + 2, y2, lane)
  }

  const bow = edgeBow(index)

  if (from.x < to.x) return directRoute(from.x + from.w + 2, y1, to.x - 2, y2, bow)

  return directRoute(from.x - 2, y1, to.x + to.w + 2, y2, bow)
}

function directRoute(x1: number, y1: number, x2: number, y2: number, bow: number): EdgeRoute {
  const bend = Math.max(10, Math.min(96, Math.abs(x2 - x1) * 0.9))
  const sign = x2 >= x1 ? 1 : -1

  return {
    d: `M ${x1} ${y1} C ${x1 + sign * bend} ${y1 + bow}, ${x2 - sign * bend} ${y2 + bow}, ${x2} ${y2}`,
  }
}

function edgeBow(index: number) {
  return ((index % 7) - 3) * 6
}

function curveRoute(x1: number, y1: number, x2: number, y2: number, lane: number): EdgeRoute {
  return {
    d: `M ${x1} ${y1} C ${lane} ${y1}, ${lane} ${y2}, ${x2} ${y2}`,
  }
}

function chunkModules<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = []

  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size))

  return chunks
}

function memberLines(entity: GraphEntity): { kind: "field" | "method"; text: string }[] {
  return [
    ...entity.fields.map((field) => ({
      kind: "field" as const,
      text: `${field.name}: ${field.type}`,
    })),
    ...entity.methods.map((method) => ({
      kind: "method" as const,
      text: method.signature || `${method.name}()`,
    })),
  ]
}

function entityBlockHeight(entity: GraphEntity) {
  const total = entity.fields.length + entity.methods.length
  const visible = Math.min(total, MAX_MEMBERS)
  const extra = total > MAX_MEMBERS ? MEMBER_H : 0

  return ENTITY_HEAD_H + ENTITY_PAD_BOTTOM + Math.max(1, visible) * MEMBER_H + extra
}

function memberCount(entity: GraphEntity) {
  return `${entity.fields.length}F · ${entity.methods.length}M`
}

function toModule(module: RawModule): Omit<GraphModule, "change" | "entities"> {
  return {
    id: module.id,
    name: module.name,
    path: module.path ?? "",
    responsibility: module.responsibility ?? "",
    layer: module.layer ?? "",
    system: module.system ?? "",
    status: module.status ?? "active",
    depends_on: [...(module.depends_on ?? [])],
    uses_externals: [...(module.uses_externals ?? [])],
    fromSystem: module.system,
  }
}

function toSystem(system: RawSystem): Omit<GraphSystem, "modules" | "change"> {
  return {
    id: system.id,
    name: system.name,
    kind: system.kind ?? "other",
    path: system.path ?? "",
    responsibility: system.responsibility ?? "",
    depends_on: [...(system.depends_on ?? [])],
  }
}

function toExternal(external: RawExternal): GraphExternal {
  return {
    id: external.id,
    name: external.name,
    kind: external.kind ?? "other",
    provider: external.provider ?? "",
    description: external.description ?? "",
  }
}

function toEntity(entity: RawEntity, module: string, change: Change, fromModule?: string): GraphEntity {
  return {
    id: entity.id,
    kind: entity.kind,
    name: entity.name,
    status: entity.status ?? "active",
    expose: entity.expose ?? "public",
    responsibility: entity.responsibility ?? "",
    location: entity.location,
    fields: (entity.fields ?? []).map((field) => ({
      name: field.name,
      type: field.type,
      description: field.description ?? "",
    })),
    methods: (entity.methods ?? []).map((method) => ({
      name: method.name,
      signature: method.signature,
      description: method.description ?? "",
    })),
    relations: (entity.relations ?? []).map((relation) => ({ type: relation.type, target: relation.target })),
    module,
    change,
    fromModule,
  }
}

function changeOf(value: string | undefined): Change {
  return value === "added" || value === "removed" || value === "changed" || value === "moved" ? value : "same"
}

function combineChange(values: Change[]): Change {
  for (const change of ["added", "removed", "changed", "moved"] as const) {
    if (values.includes(change)) return change
  }

  return "same"
}

function changeSymbol(change: Change): string {
  return { added: "+", removed: "−", changed: "~", moved: "›", same: "" }[change]
}

function changeLabel(ctx: ReturnType<typeof useExtension<typeof Jin>>, change: Change): string {
  return ctx.t(`panel.graph.change.${change}`)
}

function changeStroke(change: Change): string {
  return {
    added: "var(--v2-state-fg-success)",
    removed: "var(--v2-state-fg-danger)",
    changed: "var(--v2-state-fg-warning)",
    moved: "#7c3aed",
    same: "var(--v2-border-border-muted)",
  }[change]
}

function changeFill(change: Change): string {
  return {
    added: "var(--v2-state-bg-success)",
    removed: "var(--v2-state-bg-danger)",
    changed: "var(--v2-state-bg-warning)",
    moved: "#7c3aed",
    same: "transparent",
  }[change]
}

function changeDash(change: Change): string | undefined {
  return {
    added: undefined,
    removed: "4 3",
    changed: undefined,
    moved: "7 2 2 2",
    same: undefined,
  }[change]
}

function changeWidth(change: Change): number {
  return change === "same" ? 1 : 1.5
}

function groupActive(group: GroupLayout, focus: FocusState | undefined) {
  if (!focus) return true

  return group.layers.some((layer) => layer.modules.some((module) => focus.modules.has(module.module.id)))
}

function layerActive(layer: LayerLayout, focus: FocusState | undefined) {
  if (!focus) return true

  return layer.modules.some((module) => focus.modules.has(module.module.id))
}

function moduleFocused(id: string, focus: FocusState | undefined) {
  return focus?.target.level === "module" && focus.target.id === id
}

function moduleRelated(id: string, focus: FocusState | undefined) {
  return !!focus && !moduleFocused(id, focus) && focus.modules.has(id)
}

function moduleOpacity(id: string, focus: FocusState | undefined) {
  if (!focus) return 1

  return focus.modules.has(id) ? 1 : 0.18
}

function entityFocused(id: string, focus: FocusState | undefined) {
  return focus?.target.level === "entity" && focus.target.id === id
}

function entityRelated(id: string, focus: FocusState | undefined) {
  return !!focus && focus.target.level === "entity" && !entityFocused(id, focus) && focus.entities.has(id)
}

function entityOpacity(entity: GraphEntity, focus: FocusState | undefined) {
  if (!focus) return 1

  if (focus.target.level === "entity") {
    if (focus.target.id === entity.id || focus.entities.has(entity.id)) return 1

    return focus.modules.has(entity.module) ? 0.32 : 0.12
  }

  if (entity.module === focus.target.id) return 1

  return focus.modules.has(entity.module) ? 0.45 : 0.1
}

function edgeActive(edge: EdgeLayout, focus: FocusState | undefined) {
  if (!focus) return true

  if (focus.target.level === "module") {
    return edge.level === "module" && (edge.from === focus.target.id || edge.to === focus.target.id)
  }

  return edge.level === "entity" && (edge.from === focus.target.id || edge.to === focus.target.id)
}

function edgeColor(edge: EdgeLayout, active: boolean): string {
  if (edge.crossLayer || active) return edge.level === "entity" ? "#0891b2" : "#2563eb"

  return "var(--v2-text-text-faint)"
}

function edgeMarker(edge: EdgeLayout, active: boolean): string {
  if (edge.level === "entity" && (edge.crossLayer || active)) return "jin-arrow-cyan"

  if (edge.level === "module" && (edge.crossLayer || active)) return "jin-arrow-blue"

  return "jin-arrow-muted"
}

function edgeWidth(edge: EdgeLayout, active: boolean): number {
  if (active) return 2.1

  return edge.crossLayer ? 1.6 : 1.05
}

function abbreviate(kind: string): string {
  return (
    {
      class: "cls",
      interface: "ifc",
      enum: "enum",
      record: "rec",
      object: "obj",
      type: "typ",
      function: "fn",
      component: "cmp",
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
    }[kind] ?? kind.slice(0, 4)
  )
}

function fitChars(width: number, fontSize: number): number {
  return Math.max(8, Math.floor(width / fontSize))
}

function truncate(value: string, length: number): string {
  return value.length > length ? `${value.slice(0, Math.max(0, length - 1))}…` : value
}
