import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { JinError } from "./error"
import { archHash, loadArchDir, parseL0, saveArchDir } from "./model"
import { findRoot, loadConfig } from "./project"
import type { Arch } from "./types"
import { dumpsYaml } from "./yaml"

const dirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "jin-core-"))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function minimalArch(): Arch {
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
          public_entities: [],
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

describe("parseL0", () => {
  test("parses a minimal snapshot with defaults", () => {
    const l0 = parseL0({
      project: { name: "demo" },
      packages: [{ id: "pkg-core", path: "src/core" }],
      modules: [{ id: "mod-core", package: "pkg-core", path: "src/core" }],
    })

    expect(l0.version).toBe(1)
    expect(l0.project).toEqual({ name: "demo", description: "", languages: [] })
    expect(l0.packages[0]?.name).toBe("pkg-core")
    expect(l0.modules[0]?.status).toBe("active")
  })

  test("rejects unknown keys", () => {
    expect(() => parseL0({ project: { name: "demo" }, surprise: true })).toThrow(JinError)
    expect(() => parseL0({ project: { name: "demo" }, surprise: true })).toThrow("未知字段")
  })
})

describe("loadArchDir / saveArchDir", () => {
  test("round-trips L0 and L1 without changing the architecture hash", () => {
    const dir = tempDir()
    const arch = minimalArch()

    saveArchDir(arch, join(dir, "arch"))
    const loaded = loadArchDir(join(dir, "arch"))

    expect(loaded).toEqual(arch)
    expect(archHash(loaded)).toBe(archHash(arch))
  })

  test("reads L1 files and rejects duplicate module declarations", () => {
    const dir = tempDir()
    const archDir = join(dir, "arch")
    mkdirSync(join(archDir, "L1"), { recursive: true })
    writeFileSync(
      join(archDir, "L0.yaml"),
      dumpsYaml({
        project: { name: "demo" },
        packages: [{ id: "pkg-core", path: "src/core" }],
        modules: [{ id: "mod-core", package: "pkg-core", path: "src/core" }],
      }),
    )
    const l1 = { module: "mod-core", entities: [] }
    writeFileSync(join(archDir, "L1", "a.yaml"), dumpsYaml(l1))
    writeFileSync(join(archDir, "L1", "b.yaml"), dumpsYaml(l1))

    expect(() => loadArchDir(archDir)).toThrow("重复")
  })

  test("removes L1 files that no longer belong to the snapshot", () => {
    const dir = tempDir()
    const archDir = join(dir, "arch")
    const arch = minimalArch()

    saveArchDir(arch, archDir)
    saveArchDir({ ...arch, l1: {} }, archDir)

    expect(loadArchDir(archDir).l1).toEqual({})
  })
})

describe("archHash", () => {
  test("is independent of L1 insertion order but sensitive to content", () => {
    const left = minimalArch()
    const right: Arch = { l0: left.l0, l1: { ...left.l1 } }
    const changed = minimalArch()
    changed.l1["mod-core"]!.entities[0]!.name = "Changed"

    expect(archHash(left)).toBe(archHash(right))
    expect(archHash(left)).not.toBe(archHash(changed))
  })
})

describe("project", () => {
  test("finds the nearest ancestor with an architecture", () => {
    const dir = tempDir()
    const archDir = join(dir, "arch")
    mkdirSync(archDir, { recursive: true })
    writeFileSync(join(archDir, "L0.yaml"), dumpsYaml({ project: { name: "demo" } }))
    mkdirSync(join(dir, "src", "nested"), { recursive: true })

    expect(findRoot(join(dir, "src", "nested"))).toBe(dir)
  })

  test("parses jin.yaml and validates boolean and integer fields", () => {
    const dir = tempDir()
    writeFileSync(
      join(dir, "jin.yaml"),
      dumpsYaml({
        languages: ["typescript"],
        strict: false,
        view_port: 4321,
        scan: { roots: ["src"], exclude_tests: false },
      }),
    )

    expect(loadConfig(dir)).toEqual({
      languages: ["typescript"],
      strict: false,
      view_port: 4321,
      scan: { roots: ["src"], ignore: [], exclude_tests: false },
    })
  })
})
