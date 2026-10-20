import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { checkDrift } from "../drift"
import { saveArchDir } from "../model"
import { Project } from "../project"
import type { Arch } from "../types"
import { JavaAdapter, KotlinAdapter, PythonAdapter } from "."

const dirs: string[] = []

function directory(): string {
  const root = mkdtempSync(join(tmpdir(), "jin-scan-"))
  dirs.push(root)
  return root
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe("PythonAdapter", () => {
  test("extracts classes, functions, signatures, and relations", () => {
    const root = directory()
    const file = join(root, "pkg/tasks.py")
    mkdirSync(join(root, "pkg"), { recursive: true })
    writeFileSync(
      file,
      `"""Task models."""\n` +
        `from __future__ import annotations\n` +
        `from .models import Task\n` +
        `import app.services as services\n` +
        `\n` +
        `class Task(BaseModel):\n` +
        `    """A task."""\n` +
        `    name: str\n` +
        `    owner: User | None = None\n` +
        `\n` +
        `    def __init__(self, name: str, owner: User | None = None):\n` +
        `        self.name = name\n` +
        `        self.owner: User | None = owner\n` +
        `\n` +
        `    def assign(self, owner: User) -> Task:\n` +
        `        return self.save(owner)\n` +
        `\n` +
        `class Status(Enum):\n` +
        `    open = "open"\n` +
        `\n` +
        `@dataclass(frozen=True)\n` +
        `class Point:\n` +
        `    x: int\n` +
        `\n` +
        `@app.get("/tasks")\n` +
        `async def list_tasks() -> list[Task]:\n` +
        `    service = TaskService()\n` +
        `    return service.list()\n`,
    )

    const adapter = new PythonAdapter()
    const symbols = adapter.parse(file, root)

    expect(symbols.map((symbol) => symbol.name)).toEqual(["Task", "Status", "Point", "list_tasks"])
    expect(symbols.map((symbol) => symbol.kind)).toEqual(["entity", "enum", "entity", "route"])

    const task = symbols[0]!
    expect(task.file).toBe("pkg/tasks.py")
    expect(task.is_public).toBeTrue()
    expect(task.responsibility).toBe("A task.")
    expect(task.fields).toEqual([
      ["name", "str"],
      ["owner", "User | None"],
    ])
    expect(task.methods).toContainEqual(["__init__", "__init__(name: str, owner: User | None = None)"])
    expect(task.relations).toContainEqual(["extends", "BaseModel"])
    expect(task.relations).toContainEqual(["references", "User"])
    expect(task.relations).toContainEqual(["references", "Task"])
    expect(task.relations).toContainEqual(["uses", "save"])

    const listTasks = symbols[3]!
    expect(listTasks.is_public).toBeTrue()
    expect(listTasks.relations).toContainEqual(["references", "Task"])
    expect(listTasks.relations).toContainEqual(["uses", "TaskService"])
    expect(listTasks.relations).toContainEqual(["uses", "get"])
    expect(listTasks.relations).toContainEqual(["uses", "list"])

    expect(adapter.imports(file, root)).toEqual([
      { raw: "__future__", from_file: "pkg/tasks.py", kind: "dotted" },
      { raw: "pkg.models", from_file: "pkg/tasks.py", kind: "dotted" },
      { raw: "app.services", from_file: "pkg/tasks.py", kind: "dotted" },
    ])
  })
})

describe("JavaAdapter", () => {
  test("extracts top-level types and Javadoc", () => {
    const root = directory()
    const file = join(root, "src/TaskService.java")
    mkdirSync(join(root, "src"), { recursive: true })
    writeFileSync(
      file,
      `package demo;\n` +
        `/** A service. */\n` +
        `public class TaskService extends Base implements Runnable {\n` +
        `  private String name;\n` +
        `}\n` +
        `class Helper {}\n`,
    )

    const symbols = new JavaAdapter().parse(file, root)
    expect(symbols.map((symbol) => symbol.name)).toEqual(["TaskService", "Helper"])
    expect(symbols[0]!.kind).toBe("class")
    expect(symbols[0]!.is_public).toBeTrue()
    expect(symbols[0]!.responsibility).toBe("A service.")
    expect(symbols[1]!.is_public).toBeFalse()
  })
})

describe("KotlinAdapter", () => {
  test("extracts top-level types and functions", () => {
    const root = directory()
    const file = join(root, "src/Tasks.kt")
    mkdirSync(join(root, "src"), { recursive: true })
    writeFileSync(
      file,
      `package demo\n` +
        `/** A task. */\n` +
        `data class Task(val id: String)\n` +
        `class Service\n` +
        `object Registry\n` +
        `enum class Status { OPEN }\n` +
        `fun useTask(): Task = Task("1")\n` +
        `private fun hidden() {}\n`,
    )

    const symbols = new KotlinAdapter().parse(file, root)
    expect(symbols.map((symbol) => symbol.name)).toEqual(["Task", "Service", "Registry", "Status", "useTask", "hidden"])
    expect(symbols.map((symbol) => symbol.kind)).toEqual(["entity", "class", "object", "class", "function", "function"])
    expect(symbols[0]!.responsibility).toBe("A task.")
    expect(symbols[0]!.is_public).toBeTrue()
    expect(symbols[5]!.is_public).toBeFalse()
  })
})

describe("drift adapters", () => {
  test("recognizes Python, Java, and Kotlin source files", () => {
    const root = directory()
    mkdirSync(join(root, "src"), { recursive: true })
    writeFileSync(join(root, "src/tasks.py"), `class Task:\n    pass\n`)
    writeFileSync(join(root, "src/TaskService.java"), `public class TaskService {}\n`)
    writeFileSync(join(root, "src/Tasks.kt"), `fun useTask() {}\n`)

    const project = new Project(root)
    saveArchDir(arch(), project.archDir)

    const report = checkDrift(project)
    expect(report.checked_entities).toBe(3)
    expect(report.errors).toBe(0)
    expect(report.issues.some((issue) => issue.code === "no-adapter")).toBeFalse()
  })
})

function arch(): Arch {
  return {
    l0: {
      version: 1,
      project: { name: "demo", description: "", languages: [] },
      systems: [],
      packages: [{ id: "pkg-src", name: "src", path: "src", responsibility: "" }],
      modules: [
        {
          id: "mod-src",
          name: "src",
          package: "pkg-src",
          path: "src",
          responsibility: "",
          layer: "",
          system: "",
          depends_on: [],
          uses_externals: [],
          public_entities: ["ent-task", "ent-service", "ent-use-task"],
          status: "active",
        },
      ],
      externals: [],
      layers: [],
      constraints: [],
    },
    l1: {
      "mod-src": {
        version: 1,
        module: "mod-src",
        entities: [
          {
            id: "ent-task",
            kind: "class",
            name: "Task",
            location: { file: "src/tasks.py", symbol: "Task" },
            responsibility: "",
            expose: "public",
            status: "active",
            fields: [],
            methods: [],
            relations: [],
          },
          {
            id: "ent-service",
            kind: "class",
            name: "TaskService",
            location: { file: "src/TaskService.java", symbol: "TaskService" },
            responsibility: "",
            expose: "public",
            status: "active",
            fields: [],
            methods: [],
            relations: [],
          },
          {
            id: "ent-use-task",
            kind: "function",
            name: "useTask",
            location: { file: "src/Tasks.kt", symbol: "useTask" },
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
