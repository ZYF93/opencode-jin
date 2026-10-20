import { ExtensionContext, type Context } from "../sdk"
import { complexArch, complexBase, complexDiff } from "./graph.fixture"
import { ArchitectureGraph } from "./graph"

export default {
  title: "Extensions/Jin",
  id: "extensions-jin",
  parameters: {
    docs: {
      description: {
        component:
          "The layered architecture graph used by the Jin desktop review panel. The fixture is a product-sized architecture with four systems, four layers and entity members.",
      },
    },
  },
}

export const ArchitectureGraphStory = {
  render: () => {
    const labels = new Map([
      ["panel.graph.expandAll", "Expand all"],
      ["panel.graph.collapseAll", "Collapse all"],
      ["panel.graph.legend.module", "cross-layer module"],
      ["panel.graph.legend.entity", "cross-layer entity"],
      ["panel.graph.legend.diff", "Diff"],
      ["panel.graph.focusHint", "Hover or select a node to trace its direct relations."],
      ["panel.graph.empty", "No architecture snapshot to display."],
      ["panel.graph.fields", "Fields"],
      ["panel.graph.methods", "Methods"],
      ["panel.graph.relations", "Relations"],
      ["panel.graph.noFields", "No fields"],
      ["panel.graph.noMethods", "No methods"],
      ["panel.graph.noRelations", "No relations"],
      ["panel.graph.noMembers", "No declared members"],
      ["panel.graph.noModules", "No modules"],
      ["panel.graph.crossLayer", "cross-layer"],
      ["panel.graph.modules.one", "{{count}} module"],
      ["panel.graph.modules.other", "{{count}} modules"],
      ["panel.graph.systems.one", "{{count}} system"],
      ["panel.graph.systems.other", "{{count}} systems"],
      ["panel.graph.entities.one", "{{count}} entity"],
      ["panel.graph.entities.other", "{{count}} entities"],
      ["panel.graph.detail", "Architecture details"],
      [
        "panel.graph.detail.empty",
        "Select an entity to inspect its fields, methods, and relations. Entity members are already shown inside the graph.",
      ],
      ["panel.graph.systems", "Systems"],
      ["panel.graph.modulesLabel", "Modules"],
      ["panel.graph.entitiesLabel", "Entities"],
      ["panel.graph.layersLabel", "Layers"],
      ["panel.graph.module", "Module"],
      ["panel.graph.location", "Location"],
      ["panel.graph.close", "Close details"],
      ["panel.graph.unassigned", "Unassigned modules"],
      ["panel.graph.unassignedLayer", "Unassigned"],
      ["panel.graph.planned", "planned"],
      ["panel.graph.change.added", "added"],
      ["panel.graph.change.removed", "removed"],
      ["panel.graph.change.changed", "changed"],
      ["panel.graph.change.moved", "moved"],
      ["panel.graph.change.same", "unchanged"],
    ])

    const translate = (key: string, params?: Record<string, string | number>) =>
      (labels.get(key) ?? key).replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(params?.[name] ?? ""))

    // SAFETY: the graph reads only `t` and `plural`; every other context member is unreachable from this story.
    const context = {
      t: translate,
      plural: (key: string, count: number, params?: Record<string, string | number>) =>
        translate(`${key}.${count === 1 ? "one" : "other"}`, { ...params, count }),
    } as Context

    return (
      <ExtensionContext.Provider value={context}>
        <div class="w-[1120px] max-w-[calc(100vw-48px)] bg-v2-background-bg-base p-4">
          <ArchitectureGraph
            arch={complexArch}
            base={complexBase}
            diff={complexDiff}
            title="Target v4"
            subtitle="REQ-014 · proposal/014 target snapshot"
          />
        </div>
      </ExtensionContext.Provider>
    )
  },
}
