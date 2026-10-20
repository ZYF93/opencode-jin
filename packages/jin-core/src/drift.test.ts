import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { checkDrift } from "./drift"
import { saveArchDir } from "./model"
import { Project } from "./project"
import { TypeScriptAdapter } from "./scan"
import type { Arch } from "./types"

const dirs: string[] = []

function project(): Project {
  const root = mkdtempSync(join(tmpdir(), "jin-drift-"))
  dirs.push(root)
  mkdirSync(join(root, "src"), { recursive: true })
  const value = new Project(root)
  saveArchDir(baseArch(), value.archDir)
  return value
}

function baseArch(modulePath = "src", entityStatus: "active" | "planned" = "active"): Arch {
  return {
    l0: {
      version: 1,
      project: { name: "demo", description: "", languages: [] },
      systems: [],
      packages: [{ id: "pkg-core", name: "Core", path: "src", responsibility: "" }],
      modules: [
        {
          id: "mod-core",
          name: "Core",
          package: "pkg-core",
          path: modulePath,
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
            kind: "class",
            name: "Core",
            location: { file: "src/core.ts", symbol: "Core" },
            responsibility: "",
            expose: "public",
            status: entityStatus,
            fields: [],
            methods: [],
            relations: [],
          },
        ],
      },
    },
  }
}

function writeCore(value: Project, source: string, file = "src/core.ts"): void {
  writeFileSync(join(value.root, file), source)
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe("TypeScriptAdapter", () => {
  test("extracts declarations, members, and relations", () => {
    const dir = mkdtempSync(join(tmpdir(), "jin-ts-"))
    dirs.push(dir)
    const file = join(dir, "sample.tsx")
    writeFileSync(
      file,
      `import { Base } from "./base"\n` +
        `export class Panel extends Base implements Props {\n` +
        `  title: string\n` +
        `  open(value: string): void {}\n` +
        `}\n` +
        `export function usePanel(input: string) {}\n` +
        `export const Card = (props: Props) => <Panel />\n`,
    )

    const symbols = new TypeScriptAdapter().parse(file, dir)
    expect(symbols.map((symbol) => symbol.name)).toEqual(["Panel", "usePanel", "Card"])
    expect(symbols[0]?.fields).toContainEqual(["title", "string"])
    expect(symbols[0]?.methods).toContainEqual(["open", "open(value: string): void"])
    expect(symbols[0]?.relations).toContainEqual(["extends", "Base"])
    expect(symbols[0]?.relations).toContainEqual(["implements", "Props"])
    expect(symbols[2]?.kind).toBe("component")
    expect(symbols[2]?.relations).toContainEqual(["renders", "Panel"])
  })
})

describe("checkDrift", () => {
  test("finds the registered symbol and reports unregistered peers", () => {
    const value = project()
    writeCore(value, `export class Core {}\nexport function helper() {}\n`)

    const report = checkDrift(value)
    expect(report.checked_entities).toBe(1)
    expect(report.checked_files).toBe(1)
    expect(report.errors).toBe(0)
    expect(report.issues.map((issue) => issue.code)).toContain("symbol-unregistered")
    expect(report.issues.find((issue) => issue.code === "symbol-unregistered")?.message).toContain("helper")
  })

  test("reports a missing location file", () => {
    const value = project()
    const report = checkDrift(value)

    expect(report.errors).toBe(1)
    expect(report.issues.find((issue) => issue.code === "location-missing")?.entity).toBe("ent-core")
  })

  test("reports a missing symbol in an existing file", () => {
    const value = project()
    writeCore(value, `export class Renamed {}\n`)

    const report = checkDrift(value)
    expect(report.issues.find((issue) => issue.code === "symbol-missing")?.entity).toBe("ent-core")
  })

  test("reports planned entities that are already present", () => {
    const value = project()
    saveArchDir(baseArch("src", "planned"), value.archDir)
    writeCore(value, `export class Core {}\n`)

    const report = checkDrift(value)
    expect(report.errors).toBe(0)
    expect(report.issues.find((issue) => issue.code === "planned-present")?.level).toBe("info")
  })

  test("reports a module path that does not exist", () => {
    const value = project()
    saveArchDir(baseArch("missing"), value.archDir)
    writeCore(value, `export class Core {}\n`)

    const report = checkDrift(value)
    expect(report.issues.find((issue) => issue.code === "module-path-missing")?.module).toBe("mod-core")
  })

  test("skips test files when configured", () => {
    const value = project()
    writeCore(value, `export class Core {}\n`)
    mkdirSync(join(value.root, "src/tests"), { recursive: true })
    writeCore(value, `export class Extra {}\n`, "src/tests/core.ts")

    const report = checkDrift(value)
    expect(report.issues.some((issue) => issue.file === "src/tests/core.ts")).toBe(false)
  })
})
