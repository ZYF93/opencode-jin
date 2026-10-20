/** A top-level declaration found by a language adapter. */
export interface Symbol {
  name: string
  kind: string
  file: string
  line: number
  is_public: boolean
  responsibility: string
  fields: [string, string][]
  methods: [string, string][]
  relations: [string, string][]
}

/** A reference to another source module from an importing file. */
export interface ImportRef {
  raw: string
  from_file: string
  kind: "dotted" | "path"
}

export interface Adapter {
  language: string
  extensions: readonly string[]
  parse(path: string, root: string): Symbol[]
  imports(path: string, root: string): ImportRef[]
}

export function slugify(name: string): string {
  const value = name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()

  if (!value) return "x"
  return /^\d/.test(value) ? `x${value}` : value
}
