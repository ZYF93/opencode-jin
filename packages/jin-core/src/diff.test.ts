import { describe, expect, test } from "bun:test"
import { diffArch, isDiffEmpty } from "./diff"
import type { Arch, Entity, ModuleInfo } from "./types"

function module(id: string, path: string, layer = "domain"): ModuleInfo {
  return {
    id,
    name: id,
    package: "pkg-core",
    path,
    responsibility: "",
    layer,
    system: "",
    depends_on: [],
    uses_externals: [],
    public_entities: [],
    status: "active",
  }
}

function entity(id: string, file: string): Entity {
  return {
    id,
    kind: "entity",
    name: id,
    location: { file, symbol: id },
    responsibility: "",
    expose: "public",
    status: "active",
    fields: [],
    methods: [],
    relations: [],
  }
}

function arch(): Arch {
  return {
    l0: {
      version: 1,
      project: { name: "demo", description: "", languages: [] },
      systems: [],
      packages: [{ id: "pkg-core", name: "Core", path: "src/core", responsibility: "" }],
      modules: [module("mod-core", "src/core")],
      externals: [],
      layers: [],
      constraints: [],
    },
    l1: {
      "mod-core": { version: 1, module: "mod-core", entities: [entity("ent-core", "src/core.ts")] },
    },
  }
}

describe("diffArch", () => {
  test("reports an empty diff for identical snapshots", () => {
    const value = arch()
    const diff = diffArch(value, structuredClone(value))

    expect(isDiffEmpty(diff)).toBe(true)
    expect(diff.summary.total_changes).toBe(0)
    expect(diff.changed_files).toEqual([])
  })

  test("reports added modules, entities and member changes", () => {
    const base = arch()
    const target = structuredClone(base)
    target.l0.packages.push({ id: "pkg-ui", name: "UI", path: "src/ui", responsibility: "" })
    target.l0.modules.push(module("mod-ui", "src/ui"))
    target.l1["mod-ui"] = {
      version: 1,
      module: "mod-ui",
      entities: [entity("cmp-ui", "src/ui.tsx")],
    }
    target.l1["mod-core"]!.entities[0]!.name = "Renamed"
    target.l1["mod-core"]!.entities[0]!.fields.push({ name: "id", type: "string", description: "" })
    target.l1["mod-core"]!.entities[0]!.methods.push({ name: "run", signature: "run(): void", description: "" })
    target.l1["mod-core"]!.entities[0]!.relations.push({ type: "uses", target: "cmp-ui" })

    const diff = diffArch(base, target)

    expect(diff.summary.packages.added).toBe(1)
    expect(diff.summary.modules.added).toBe(1)
    expect(diff.summary.entities.added).toBe(1)
    expect(diff.summary.entities.changed).toBe(1)
    expect(diff.summary.members).toEqual({ added: 3, removed: 0, changed: 0, moved: 0 })
    expect(diff.changed_files).toEqual(["src/core.ts", "src/ui.tsx"])

    const changed = diff.entities.find((item) => item.id === "ent-core")!
    expect(changed.member_counts).toEqual({ added: 3, removed: 0, changed: 0 })
    expect(changed.field_diffs).toEqual({
      added: [{ name: "id", type: "string" }],
      removed: [],
      changed: [],
    })
  })

  test("keeps scalar diffs JSON-safe when one side is absent", () => {
    const base = arch()
    const target = structuredClone(base)

    target.l0.modules[0]!.layer = ""

    const diff = diffArch(base, target)
    const changed = diff.modules.find((item) => item.id === "mod-core")!

    expect(changed.fields).toEqual({ layer: { from: "domain", to: null } })
    expect(JSON.parse(JSON.stringify(diff))).toEqual(diff)
  })

  test("reports moved entities with their source module", () => {
    const base = arch()
    const target = structuredClone(base)
    target.l0.modules.push(module("mod-other", "src/other"))
    target.l1["mod-other"] = { version: 1, module: "mod-other", entities: [target.l1["mod-core"]!.entities[0]!] }
    target.l1["mod-core"]!.entities = []

    const diff = diffArch(base, target)
    const moved = diff.entities.find((item) => item.id === "ent-core")!

    expect(moved.change).toBe("moved")
    expect(moved.module).toBe("mod-other")
    expect(moved.from_module).toBe("mod-core")
    expect(diff.summary.entities.moved).toBe(1)
  })

  test("reports removed package and module entries", () => {
    const base = arch()
    const target = structuredClone(base)
    target.l0.packages = []
    target.l0.modules = []
    target.l1 = {}

    const diff = diffArch(base, target)

    expect(diff.packages[0]!.change).toBe("removed")
    expect(diff.modules[0]!.change).toBe("removed")
    expect(diff.entities[0]!.change).toBe("removed")
    expect(diff.changed_files).toEqual(["src/core.ts"])
  })
})
