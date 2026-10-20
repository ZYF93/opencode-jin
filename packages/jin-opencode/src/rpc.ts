export * as JinRpc from "./rpc.js"

import { Rpc } from "@opencode/schema/rpc"
import { optional } from "@opencode/schema/schema"
import { Schema } from "effect"

const text = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4_000))
const req = Schema.String.check(Schema.isMinLength(3), Schema.isMaxLength(128))
const version = Schema.Int.check(Schema.isGreaterThan(0))
const decision = Schema.Literals(["approved", "rejected"])

const portable = <S extends Schema.ConstraintDecoder<unknown>>(schema: S) => Schema.toStandardSchemaV1(schema)
const Failure = Schema.Struct({ message: Schema.String })
const errors = { failed: portable(Failure) } as const

export const Issue = Schema.Struct({
  level: Schema.Literals(["error", "warning"]),
  code: Schema.String,
  message: Schema.String,
  path: optional(Schema.String),
})
export type Issue = typeof Issue.Type

export const Bootstrap = Schema.Struct({
  root: Schema.String,
  packages: Schema.Int,
  modules: Schema.Int,
  entities: Schema.Int,
  roots: Schema.Array(Schema.String),
  languages: Schema.Array(Schema.String),
  systems: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)),
  notes: Schema.Array(Schema.String),
  skipped_files: Schema.Array(Schema.String),
  skipped_dirs: Schema.Array(Schema.String),
  deps: Schema.Record(Schema.String, Schema.Array(Schema.String)),
  issues: Schema.Array(Issue),
})
export type Bootstrap = typeof Bootstrap.Type

export const Applied = Schema.Struct({
  version: Schema.Int,
  at: Schema.String,
})

export const ProposalMeta = Schema.Struct({
  id: req,
  title: Schema.String,
  description: optional(Schema.String),
  acceptance: optional(Schema.Array(Schema.String)),
  scope: optional(Schema.Array(Schema.String)),
  author: optional(Schema.String),
  created_at: Schema.String,
  updated_at: Schema.String,
  status: Schema.Literals(["draft", "in_review", "approved", "rejected", "applied"]),
  base_hash: optional(Schema.String),
  applied: optional(Schema.NullOr(Applied)),
})
export type ProposalMeta = typeof ProposalMeta.Type

export const VersionSummary = Schema.Struct({
  req: Schema.String,
  version: Schema.Int,
  summary: optional(Schema.Array(Schema.String)),
  rationale: optional(Schema.String),
  created_at: Schema.String,
})
export type VersionSummary = typeof VersionSummary.Type

export const Decision = Schema.Struct({
  req: req,
  version: Schema.Int,
  decision,
  comments: Schema.String,
  decided_by: Schema.String,
  decided_at: Schema.String,
  target_hash: optional(Schema.String),
  signature: optional(Schema.String),
})
export type Decision = typeof Decision.Type

export const HistoryEntry = Schema.Struct({
  req: req,
  title: Schema.String,
  applied_version: Schema.Int,
  decided_at: Schema.String,
  applied_at: Schema.String,
  summary: Schema.Record(Schema.String, Schema.Unknown),
})
export type HistoryEntry = typeof HistoryEntry.Type

export const DriftIssue = Schema.Struct({
  level: Schema.Literals(["error", "warning", "info"]),
  code: Schema.String,
  message: Schema.String,
  module: Schema.String,
  entity: Schema.String,
  file: Schema.String,
})
export type DriftIssue = typeof DriftIssue.Type

export const DriftReport = Schema.Struct({
  issues: Schema.Array(DriftIssue),
  checked_entities: Schema.Int,
  checked_files: Schema.Int,
  errors: Schema.Int,
  warnings: Schema.Int,
})
export type DriftReport = typeof DriftReport.Type

export const ProposalInfo = Schema.Struct({
  req: req,
  title: Schema.String,
  status: Schema.Literals(["draft", "in_review", "approved", "rejected", "applied"]),
  created_at: Schema.String,
  updated_at: Schema.String,
  versions: Schema.Array(Schema.Int),
  latest_version: Schema.NullOr(Schema.Int),
  decisions: Schema.Record(Schema.String, decision),
})
export type ProposalInfo = typeof ProposalInfo.Type

export const TargetVersion = Schema.Struct({
  req: req,
  version,
  target_dir: Schema.String,
  l0_path: Schema.String,
  l1_dir: Schema.String,
})
export type TargetVersion = typeof TargetVersion.Type

export const State = Schema.Struct({
  root: Schema.String,
  hasArch: Schema.Boolean,
  arch: Schema.NullOr(Schema.Unknown),
  proposals: Schema.Array(ProposalInfo),
  history: Schema.Array(HistoryEntry),
  validation: Schema.Array(Issue),
  drift: DriftReport,
})
export type State = typeof State.Type

export const Review = Schema.Struct({
  req: req,
  meta: ProposalMeta,
  version,
  base_label: Schema.String,
  versions: Schema.Array(Schema.Int),
  summary: VersionSummary,
  base: Schema.Record(Schema.String, Schema.Unknown),
  target: Schema.Record(Schema.String, Schema.Unknown),
  diff: Schema.Record(Schema.String, Schema.Unknown),
  decision: Schema.NullOr(Decision),
  applied: Schema.NullOr(Applied),
  current_hash: Schema.String,
  base_hash: Schema.String,
  target_hash: Schema.String,
})
export type Review = typeof Review.Type

export const Resolution = Schema.Struct({
  req,
  version,
  decision,
  applied: Schema.Boolean,
  continued: Schema.Boolean,
})
export type Resolution = typeof Resolution.Type

export const ApprovalRequest = Schema.Struct({
  sessionID: Schema.String,
  req,
  version,
  title: Schema.String,
})
export type ApprovalRequest = typeof ApprovalRequest.Type

/** Server-side Jin lifecycle. The desktop and web clients only present these results. */
export const Definition = Rpc.define({
  id: "jin",
  methods: {
    state: { input: portable(Schema.Struct({})), output: portable(State), errors },
    bootstrap: {
      input: portable(
        Schema.Struct({
          languages: optional(Schema.Array(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(40)))),
        }),
      ),
      output: portable(Bootstrap),
      errors,
    },
    review: {
      input: portable(
        Schema.Struct({
          req,
          version,
          base: optional(Schema.String.check(Schema.isMaxLength(64))),
        }),
      ),
      output: portable(Review),
      errors,
    },
    create: {
      input: portable(
        Schema.Struct({
          req,
          title: text,
          description: optional(Schema.String.check(Schema.isMaxLength(20_000))),
          acceptance: optional(Schema.Array(Schema.String.check(Schema.isMaxLength(4_000)))),
          scope: optional(Schema.Array(Schema.String.check(Schema.isMaxLength(2_000)))),
          author: optional(Schema.String.check(Schema.isMaxLength(200))),
        }),
      ),
      output: portable(ProposalMeta),
      errors,
    },
    revise: {
      input: portable(
        Schema.Struct({
          req,
          seed: optional(Schema.Literals(["previous", "current"])),
        }),
      ),
      output: portable(TargetVersion),
      errors,
    },
    validate: {
      input: portable(Schema.Struct({ req, version })),
      output: portable(Schema.Array(Issue)),
      errors,
    },
    decide: {
      input: portable(
        Schema.Struct({
          req,
          version,
          decision,
          comments: optional(Schema.String.check(Schema.isMaxLength(20_000))),
          decided_by: optional(Schema.String.check(Schema.isMaxLength(200))),
          target_hash: optional(Schema.String.check(Schema.isMaxLength(64))),
        }),
      ),
      output: portable(Decision),
      errors,
    },
    resolve: {
      input: portable(
        Schema.Struct({
          req,
          version,
          decision,
          comments: optional(Schema.String.check(Schema.isMaxLength(20_000))),
          target_hash: optional(Schema.String.check(Schema.isMaxLength(64))),
          sessionID: Schema.String.check(Schema.isMinLength(1)),
          resume: optional(Schema.Boolean),
        }),
      ),
      output: portable(Resolution),
      errors,
    },
    apply: {
      input: portable(
        Schema.Struct({
          req,
          version,
          force: optional(Schema.Boolean),
          commit: optional(Schema.Boolean),
        }),
      ),
      output: portable(HistoryEntry),
      errors,
    },
  },
  events: { approval: { schema: portable(ApprovalRequest) } },
})
