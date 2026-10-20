import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { parse, stringify } from "yaml"
import { JinError } from "./error"

/** Read a YAML file. Returns `null` for an empty document, matching the Python loader. */
export function loadYaml(path: string): unknown {
  const text = readFileSync(path, "utf8")

  try {
    return parse(text) ?? null
  } catch (cause) {
    throw new JinError(`YAML 解析失败: ${path}`, { cause })
  }
}

/** Serialize a value with the same two-space indentation used by Jin's Python writer. */
export function dumpsYaml(value: unknown): string {
  return stringify(value, { indent: 2, lineWidth: 0 })
}

/** Write a YAML file, creating its parent directory. */
export function dumpYaml(value: unknown, path: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, dumpsYaml(value), "utf8")
}
