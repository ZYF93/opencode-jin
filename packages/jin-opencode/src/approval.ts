import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import type { Decision, DecisionAuthentication } from "@jin/core"

const FIELDS = ["req", "version", "decision", "comments", "decided_by", "decided_at", "target_hash"] as const

function payload(decision: Decision): string {
  return JSON.stringify(FIELDS.map((field) => decision[field] ?? ""))
}

function secret(): string {
  const configured = process.env.JIN_APPROVAL_SECRET
  if (configured) return configured

  const path =
    process.env.JIN_APPROVAL_KEY_FILE ??
    join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "opencode", "jin", "approval.key")
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    writeFileSync(path, randomBytes(32).toString("hex"), { mode: 0o600 })
  }
  return readFileSync(path, "utf8").trim()
}

/**
 * Server-owned approval authentication. Decisions are signed with a key agents cannot
 * obtain through the project, so editing meta.yaml or decisions/*.yaml cannot approve a
 * proposal. The signature covers the target hash, so approval cannot be replayed after
 * the target snapshot changes.
 */
export function createDecisionAuthentication(): DecisionAuthentication {
  const key = secret()

  return {
    sign(decision) {
      return createHmac("sha256", key).update(payload(decision)).digest("hex")
    },
    verify(decision) {
      if (!decision.signature) return false
      const expected = createHmac("sha256", key).update(payload(decision)).digest()
      const actual = Buffer.from(decision.signature, "hex")
      return actual.length === expected.length && timingSafeEqual(actual, expected)
    },
  }
}
