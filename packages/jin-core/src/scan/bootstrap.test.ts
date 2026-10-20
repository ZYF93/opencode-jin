import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { l0ToDict, l1ToDict } from "../model"
import { Project } from "../project"
import { detectRoots, scanProject } from "./bootstrap"

const dirs: string[] = []

function directory(): string {
  const root = mkdtempSync(join(tmpdir(), "jin-bootstrap-"))
  dirs.push(root)
  return root
}

function write(root: string, path: string, content = ""): void {
  const file = join(root, path)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, content)
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe("scanProject", () => {
  test("matches the Python scanner on a mixed-language monorepo", () => {
    const root = join(directory(), "demo")
    write(root, "apps/web/package.json", `{"dependencies":{"react":"18"}}`)
    write(root, "packages/lib/package.json", `{"dependencies":{"lodash":"4"}}`)
    write(root, "services/api/pyproject.toml", `[project]\ndependencies=["fastapi"]`)
    write(root, "services/api/app/__init__.py")
    write(root, "services/api/tests/test_service.py", `class Fake:\n    pass\n`)
    write(root, "apps/web/src/components/Button.tsx", `export function Button() {\n  return <button>ok</button>\n}\n`)
    write(
      root,
      "apps/web/src/api/client.ts",
      `import { Button } from "../components/Button"\n\nexport function fetchData() {\n  return Button\n}\n`,
    )
    write(root, "packages/lib/src/index.ts", `export function helper() {\n  return 1\n}\n`)
    write(root, "services/api/app/models.py", `class Task:\n    """A task."""\n    name: str\n`)
    write(
      root,
      "services/api/app/service.py",
      `from api.app.models import Task\n\nclass TaskService:\n    def get(self) -> Task:\n        return Task()\n`,
    )

    const project = new Project(root)
    const { arch, report } = scanProject(project)

    expect(report.roots).toEqual(["apps", "packages", "services"])
    expect(report.languages).toEqual(["python", "typescript"])
    expect(report.entity_count).toBe(5)
    expect(report.modules).toEqual([
      { id: "mod-api", path: "apps/web/src/api", files: 1, entities: 1 },
      { id: "mod-components", path: "apps/web/src/components", files: 1, entities: 1 },
      { id: "mod-src", path: "packages/lib/src", files: 1, entities: 1 },
      { id: "mod-app", path: "services/api/app", files: 3, entities: 2 },
    ])
    expect(report.skipped_dirs).toEqual(["services/api/tests"])
    expect(report.systems).toEqual([])
    expect(report.deps).toEqual({ "mod-api": ["mod-components"] })

    expect(arch.l0.packages).toEqual([
      { id: "pkg-web", name: "web", path: "apps/web", responsibility: "" },
      { id: "pkg-lib", name: "lib", path: "packages/lib", responsibility: "" },
      { id: "pkg-api", name: "api", path: "services/api", responsibility: "" },
    ])
    expect(arch.l0.modules.map((module) => module.id)).toEqual(["mod-api", "mod-components", "mod-src", "mod-app"])
    expect(arch.l0.modules[0]!.depends_on).toEqual(["mod-components"])
    expect(arch.l0.modules[3]!.public_entities).toEqual(["cls-task", "cls-task-service"])

    const app = arch.l1["mod-app"]!
    const task = app.entities.find((entity) => entity.name === "Task")!
    expect(task.kind).toBe("class")
    expect(task.responsibility).toBe("A task.")
    expect(task.fields).toEqual([{ name: "name", type: "str", description: "" }])
    expect(task.expose).toBe("public")
    expect(task.status).toBe("active")

    const service = app.entities.find((entity) => entity.name === "TaskService")!
    expect(service.methods).toEqual([{ name: "get", signature: "get() -> Task", description: "" }])
    expect(service.relations).toEqual([{ type: "references", target: "cls-task" }])

    expect(report.notes).toContain("实体关系: 解析 1 条；0 个同名歧义/未找到目标已跳过")
    expect(report.notes).toContain("近似适配器（声明级符号 + 字段/方法/关系近似）: typescript；复杂语法可能遗漏")

    const actual = {
      arch: {
        l0: l0ToDict(arch.l0),
        l1: Object.fromEntries(Object.entries(arch.l1).map(([id, value]) => [id, l1ToDict(value)])),
      },
      report,
    }
    const expected = JSON.parse(readFileSync(join(import.meta.dir, "fixtures/scan-parity.json"), "utf8"))
    expect(actual).toEqual(expected)
  })

  test("detects systems from configured roots and assigns modules", () => {
    const root = directory()
    write(root, "jin.yaml", `scan:\n  roots:\n    - web\n    - api\n`)
    write(root, "web/package.json", `{"dependencies":{"react":"18"}}`)
    write(root, "web/src/App.tsx", `export function App() {\n  return <main>ok</main>\n}\n`)
    write(root, "api/pyproject.toml", `[project]\ndependencies=["fastapi"]`)
    write(root, "api/app/__init__.py")
    write(root, "api/app/main.py", `class App:\n    pass\n`)

    const { arch, report } = scanProject(new Project(root))
    expect(report.roots).toEqual(["web", "api"])
    expect(report.systems).toEqual([
      { id: "sys-api", name: "api", kind: "backend", path: "api" },
      { id: "sys-web", name: "web", kind: "frontend", path: "web" },
    ])
    expect(arch.l0.systems.map((system) => system.id)).toEqual(["sys-api", "sys-web"])
    expect(arch.l0.modules.map((module) => [module.id, module.system])).toEqual([
      ["mod-app", "sys-api"],
      ["mod-src", "sys-web"],
    ])
    expect(report.notes).toContain("检测到 2 个系统（monorepo 顶层 manifest）: sys-api(backend), sys-web(frontend)")
  })

  test("refines a class extending an interface into implements", () => {
    const root = directory()
    write(root, "src/pkg/__init__.py")
    write(root, "src/pkg/api.py", `class Repo(Protocol):\n    pass\n`)
    write(root, "src/pkg/impl.py", `class SqlRepo(Repo):\n    pass\n`)

    const { arch } = scanProject(new Project(root))
    const entities = arch.l1["mod-pkg"]!.entities
    const repo = entities.find((entity) => entity.name === "Repo")!
    const sql = entities.find((entity) => entity.name === "SqlRepo")!

    expect(repo.kind).toBe("interface")
    expect(sql.relations).toEqual([{ type: "implements", target: repo.id }])
  })

  test("filters languages on request", () => {
    const root = directory()
    write(root, "src/app.py", `class Task:\n    pass\n`)
    write(root, "src/app.ts", `export function task() {}\n`)

    const { report } = scanProject(new Project(root), ["python"])
    expect(report.languages).toEqual(["python"])
    expect(report.entity_count).toBe(1)
  })
})

describe("detectRoots", () => {
  test("prefers Java source roots", () => {
    const root = directory()
    write(root, "src/main/java/com/acme/App.java", `public class App {}\n`)
    write(root, "src/web/app.ts", `export function app() {}\n`)

    expect(detectRoots(new Project(root))).toEqual(["src/main/java"])
  })

  test("returns source-bearing top-level candidates", () => {
    const root = directory()
    write(root, "app/page.tsx", `export function Page() {}\n`)
    write(root, "packages/ui/index.ts", `export function ui() {}\n`)
    write(root, "docs/readme.md", `# docs\n`)

    expect(detectRoots(new Project(root))).toEqual(["app", "packages"])
  })
})
