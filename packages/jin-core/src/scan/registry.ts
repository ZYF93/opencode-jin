import type { Adapter } from "./base"
import { JavaAdapter, KotlinAdapter } from "./jvm"
import { PythonAdapter } from "./python"
import { TypeScriptAdapter } from "./ts"

export const EXT_LANG: Record<string, string> = {
  ".py": "python",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".java": "java",
  ".kt": "kotlin",
  ".kts": "kotlin",
}

const typescript = new TypeScriptAdapter()

export const ADAPTERS: Record<string, Adapter> = {
  python: new PythonAdapter(),
  typescript,
  javascript: typescript,
  java: new JavaAdapter(),
  kotlin: new KotlinAdapter(),
}

export const TEST_DIRS = new Set(["test", "tests", "__tests__", "spec", "testing"])
export const TEST_FILE_PATTERNS = ["test_", "_test.", "conftest.py", "Test.java", "Test.kt", "Tests.java", "Tests.kt"]

export function isTestPath(path: string): boolean {
  const parts = path.split("/").map((part) => part.toLowerCase())
  if (parts.some((part) => TEST_DIRS.has(part))) return true

  const name = parts.at(-1) ?? ""
  return TEST_FILE_PATTERNS.some((pattern) => name.startsWith(pattern) || name.endsWith(pattern))
}
