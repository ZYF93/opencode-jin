import { expect, test } from "bun:test"
import { buildGraph } from "./graph"

const entity = (id: string, name: string, relations: { type: string; target: string }[] = []) => ({
  id,
  kind: "function",
  name,
  location: { file: `src/${id}.ts`, symbol: name },
  fields: [],
  methods: [],
  relations,
})

const arch = {
  l0: {
    project: { name: "Demo" },
    systems: [{ id: "sys.app", name: "App", kind: "application", path: "src", responsibility: "" }],
    modules: [
      {
        id: "mod.b",
        name: "B",
        path: "src/b",
        responsibility: "",
        layer: "domain",
        system: "sys.app",
        depends_on: ["mod.a"],
        uses_externals: [],
        status: "active",
      },
    ],
    externals: [],
    layers: [{ id: "domain", name: "Domain" }],
  },
  l1: {
    "mod.b": { entities: [entity("b1", "B1", [{ type: "uses", target: "a1" }])] },
  },
}

const base = {
  l0: {
    project: { name: "Demo" },
    systems: [{ id: "sys.old", name: "Old", kind: "application", path: "src", responsibility: "" }],
    modules: [
      {
        id: "mod.a",
        name: "A",
        path: "src/a",
        responsibility: "",
        layer: "infra",
        system: "sys.old",
        depends_on: [],
        uses_externals: [],
        status: "active",
      },
    ],
    externals: [],
    layers: [{ id: "infra", name: "Infra" }],
  },
  l1: {
    "mod.a": { entities: [entity("a1", "A1")] },
  },
}

test("accepts sparse proposal snapshots that omit empty collections", () => {
  const graph = buildGraph(
    {
      l0: {
        project: { name: "Sparse" },
        modules: [{ id: "mod.a", name: "A", path: "src/a", layer: "domain", system: "sys.a" }],
      },
      l1: {
        "mod.a": { entities: [{ id: "a1", kind: "function", name: "A1", location: { file: "src/a.ts", symbol: "a1" } }] },
      },
    },
    undefined,
    undefined,
  )

  expect(graph.project).toBe("Sparse")
  expect(graph.moduleById.get("mod.a")?.entities.map((item) => item.id)).toEqual(["a1"])
  expect(graph.moduleById.get("mod.a")?.depends_on).toEqual([])
  expect(graph.entityById.get("a1")?.fields).toEqual([])
  expect(graph.unassigned.map((module) => module.id)).toEqual(["mod.a"])
})

test("builds the target graph and folds in removed base modules and entities", () => {
  const graph = buildGraph(arch, base, {
    modules: [
      { id: "mod.a", change: "removed" },
      { id: "mod.b", change: "added" },
    ],
    entities: [
      { id: "a1", change: "removed", module: "mod.a" },
      { id: "b1", change: "added", module: "mod.b" },
    ],
  })

  expect(graph.project).toBe("Demo")
  expect(graph.moduleById.get("mod.a")?.change).toBe("removed")
  expect(graph.moduleById.get("mod.a")?.entities.map((item) => item.id)).toEqual(["a1"])
  expect(graph.moduleById.get("mod.b")?.change).toBe("added")
  expect(graph.moduleById.get("mod.b")?.entities.map((item) => item.id)).toEqual(["b1"])
  expect(graph.entityById.get("a1")?.change).toBe("removed")
  expect(graph.entityEdges).toEqual([{ from: "b1", to: "a1", type: "uses", change: "added" }])
  expect(graph.unassigned.map((module) => module.id).sort()).toEqual(["mod.a"])
  expect(graph.layers.map((layer) => layer.id)).toEqual(["domain", "infra"])
})
