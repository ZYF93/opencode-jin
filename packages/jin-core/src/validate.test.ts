import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Arch, Entity, L1, ModuleInfo } from "./types"
import { formatIssue, validateArch } from "./validate"

function arch(): Arch {
  return {
    l0: {
      version: 1,
      project: { name: "demo", description: "", languages: [] },
      systems: [],
      packages: [{ id: "pkg-core", name: "Core", path: "src/core", responsibility: "" }],
      modules: [module("mod-core", "pkg-core", "src/core")],
      externals: [],
      layers: [],
      constraints: [],
    },
    l1: {
      "mod-core": {
        version: 1,
        module: "mod-core",
        entities: [entity("ent-core")],
      },
    },
  }
}

function module(id: string, packageID: string, path: string): ModuleInfo {
  return {
    id,
    name: id,
    package: packageID,
    path,
    responsibility: "",
    layer: "",
    system: "",
    depends_on: [],
    uses_externals: [],
    public_entities: [],
    status: "active",
  }
}

function entity(id: string): Entity {
  return {
    id,
    kind: "entity",
    name: id,
    location: { file: "src/core.ts", symbol: id },
    responsibility: "",
    expose: "public",
    status: "active",
    fields: [],
    methods: [],
    relations: [],
  }
}

function l1(moduleID: string, entities: Entity[] = []): L1 {
  return { version: 1, module: moduleID, entities }
}

function codes(value: Arch): string[] {
  return validateArch(value).map((item) => item.code)
}

describe("validateArch", () => {
  test("accepts a minimal complete snapshot", () => {
    expect(validateArch(arch()).filter((item) => item.level === "error")).toEqual([])
  })

  test("reports bad references", () => {
    const value = arch()
    value.l0.modules[0]!.depends_on = ["mod-ghost"]
    value.l1["mod-core"]!.entities[0]!.relations = [{ type: "uses", target: "cls-ghost" }]

    expect(codes(value)).toContain("ref-depends")
    expect(codes(value)).toContain("ref-relation")
  })

  test("reports duplicate entity ids globally", () => {
    const value = arch()
    value.l1["mod-core"]!.entities.push(entity("ent-core"))

    expect(codes(value)).toContain("id-dup")
  })

  test("reports missing and orphaned L1 files", () => {
    const value = arch()
    value.l0.modules.push(module("mod-new", "pkg-core", "src/new"))
    expect(codes(value)).toContain("l1-missing")

    value.l1["mod-orphan"] = l1("mod-orphan")
    expect(codes(value)).toContain("l1-orphan")
  })

  test("checks public_entities ownership", () => {
    const value = arch()
    value.l0.modules[0]!.public_entities = ["cls-ghost"]
    expect(codes(value)).toContain("ref-public")

    value.l0.modules.push({ ...module("mod-other", "pkg-core", "src/other"), public_entities: ["ent-core"] })
    value.l1["mod-other"] = l1("mod-other")
    expect(codes(value)).toContain("ref-public-owner")
  })

  test("reports layer dependency violations", () => {
    const value = arch()
    value.l0.layers = [
      { id: "domain", name: "Domain", description: "" },
      { id: "infra", name: "Infra", description: "" },
    ]
    value.l0.modules[0]!.layer = "domain"
    value.l0.modules.push({ ...module("mod-infra", "pkg-core", "src/infra"), layer: "infra" })
    value.l1["mod-infra"] = l1("mod-infra")
    value.l0.modules[0]!.depends_on = ["mod-infra"]
    value.l0.constraints = [
      {
        id: "con-layer",
        kind: "layer-dependency",
        description: "",
        from_layers: ["domain"],
        to_layers: ["infra"],
        forbidden: true,
      },
    ]

    expect(codes(value)).toContain("layer-violation")
  })

  test("checks systems, externals and layers", () => {
    const value = arch()
    value.l0.systems = [{ id: "sys-app", name: "App", kind: "backend", path: "", responsibility: "", depends_on: [] }]
    value.l0.externals = [{ id: "ext-db", name: "DB", kind: "database", provider: "", description: "" }]
    value.l0.layers = [{ id: "domain", name: "Domain", description: "" }]
    const item = value.l0.modules[0]!
    item.system = "sys-ghost"
    item.uses_externals = ["ext-ghost"]
    item.layer = "ghost-layer"
    value.l0.systems[0]!.depends_on = ["sys-ghost", "sys-app"]

    const result = codes(value)
    expect(result).toContain("ref-system")
    expect(result).toContain("ref-external")
    expect(result).toContain("unknown-layer")
    expect(result).toContain("ref-system-dep")
    expect(result).toContain("self-dep")
  })

  test("checks disk locations and skips planned entities", () => {
    const root = mkdtempSync(join(tmpdir(), "jin-validate-"))
    const value = arch()
    mkdirSync(join(root, "src", "core"), { recursive: true })
    writeFileSync(join(root, "src", "core.ts"), "")

    try {
      expect(validateArch(value, { checkDisk: true, root }).some((item) => item.code === "location-missing")).toBe(
        false,
      )

      value.l1["mod-core"]!.entities[0]!.status = "planned"
      value.l1["mod-core"]!.entities[0]!.location.file = "src/missing.ts"
      expect(validateArch(value, { checkDisk: true, root }).some((item) => item.code === "location-missing")).toBe(
        false,
      )

      value.l1["mod-core"]!.entities[0]!.status = "active"
      expect(validateArch(value, { checkDisk: true, root }).some((item) => item.code === "location-missing")).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe("formatIssue", () => {
  test("formats errors and locations", () => {
    expect(formatIssue({ level: "error", code: "id-dup", message: "duplicate", path: "arch/L0.yaml" })).toBe(
      "ERROR id-dup [arch/L0.yaml]: duplicate",
    )
    expect(formatIssue({ level: "warning", code: "id-prefix", message: "prefix" })).toBe("WARN id-prefix: prefix")
  })
})
