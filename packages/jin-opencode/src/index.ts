import { Plugin } from "@opencode/plugin"
import type { Info } from "@opencode/plugin/promise/tool"
import { Session } from "@opencode/schema/session"
import { optional } from "@opencode/schema/schema"
import { Schema } from "effect"
import { JinService } from "./service.js"
import { Definition, type ApprovalRequest } from "./rpc.js"

const req = Schema.String.check(Schema.isMinLength(3), Schema.isMaxLength(128))
const version = Schema.Int.check(Schema.isGreaterThan(0))

const Empty = Schema.Struct({})
const CreateInput = Schema.Struct({
  req,
  title: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4_000)),
  description: optional(Schema.String.check(Schema.isMaxLength(20_000))),
  acceptance: optional(Schema.Array(Schema.String.check(Schema.isMaxLength(4_000)))),
  scope: optional(Schema.Array(Schema.String.check(Schema.isMaxLength(2_000)))),
  author: optional(Schema.String.check(Schema.isMaxLength(200))),
})
const ReviseInput = Schema.Struct({
  req,
  seed: optional(Schema.Literals(["previous", "current"])),
})
const ProposalInput = Schema.Struct({ req, version: optional(version) })
const ValidateInput = Schema.Struct({ req, version: optional(version) })
const ApplyInput = Schema.Struct({
  req,
  version: optional(version),
  force: optional(Schema.Boolean),
  commit: optional(Schema.Boolean),
})

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

type FailedCall<E> = {
  error(type: "failed", message: string, data: { message: string }): E
}

async function attempt<T, E>(call: FailedCall<E>, run: () => T | Promise<T>): Promise<T | E> {
  try {
    return await run()
  } catch (error) {
    const detail = message(error)
    return call.error("failed", detail, { message: detail })
  }
}

const json = (value: unknown) => JSON.stringify(value, null, 2)

function continuation(req: string, version: number, decision: "approved" | "rejected", comments = ""): string {
  const detail = comments.trim() ? ` Review comments: ${comments.trim()}` : ""
  if (decision === "approved") {
    return `Jin proposal ${req} v${version} was approved and applied in the desktop panel.${detail} Continue implementation now. The live architecture matches the target snapshot. Do not call jin_apply again.`
  }
  return `Jin proposal ${req} v${version} was rejected in the desktop panel.${detail} Stop implementing this proposal. Revise it and call jin_validate again only if the user asks.`
}

type ApprovalAnnouncer = (request: ApprovalRequest) => Promise<boolean>

function tools(service: JinService, announceApproval: ApprovalAnnouncer): Info[] {
  return [
    {
      name: "jin_arch_read",
      description:
        "Read the current Jin architecture snapshot (L0 modules and L1 entities) before proposing a change. Returns JSON.",
      input: Empty,
      async execute() {
        const state = service.state()
        return {
          content: json({
            root: state.root,
            hasArch: state.hasArch,
            arch: state.arch,
            validation: state.validation,
          }),
          metadata: { root: state.root, hasArch: state.hasArch },
        }
      },
    },
    {
      name: "jin_status",
      description:
        "Show the Jin architecture status: root, module/entity counts, proposal queue, decisions, and current validation.",
      input: Empty,
      async execute() {
        const state = service.state()
        const arch = state.arch as { l0: { modules?: unknown[] }; l1: Record<string, { entities?: unknown[] }> } | null
        const entities = arch ? Object.values(arch.l1).reduce((sum, l1) => sum + (l1.entities?.length ?? 0), 0) : 0

        return {
          content: json({
            root: state.root,
            hasArch: state.hasArch,
            modules: arch?.l0.modules?.length ?? 0,
            entities,
            proposals: state.proposals,
            validation: state.validation,
          }),
          metadata: {
            root: state.root,
            hasArch: state.hasArch,
            proposals: state.proposals.length,
          },
        }
      },
    },
    {
      name: "jin_proposal_create",
      description:
        "Create a Jin architecture proposal. The returned target snapshot paths are the only files to edit. Do not edit meta.yaml or decisions; the user approves or rejects proposals in the desktop Architecture panel.",
      input: CreateInput,
      async execute(input, context) {
        const meta = service.create({ ...input, author: input.author ?? String(context.agent) })
        const target = service.target(meta.id, 1)

        return {
          content: `Created ${meta.id} v${target.version}.
Edit only these target files:
- ${target.l0_path}
- ${target.l1_dir}/*.yaml

Do not edit meta.yaml or decisions. Run jin_validate when the target is ready; a valid target opens the desktop approval panel automatically. Approval applies the architecture and resumes you. Do not call jin_apply.`,
          metadata: { req: meta.id, version: target.version, target: target.target_dir },
        }
      },
    },
    {
      name: "jin_proposal_revise",
      description:
        "Create the next version of a Jin proposal from the previous target (or from the current architecture). Returns the target snapshot paths to edit.",
      input: ReviseInput,
      async execute(input) {
        const target = service.revise(input.req, input.seed ?? "previous")

        return {
          content: `Created ${input.req} v${target.version}.
Edit only these target files:
- ${target.l0_path}
- ${target.l1_dir}/*.yaml

Do not edit meta.yaml or decisions. Run jin_validate when the target is ready; a valid target opens the desktop approval panel automatically. Approval applies the architecture and resumes you. Do not call jin_apply.`,
          metadata: { req: input.req, version: target.version, target: target.target_dir },
        }
      },
    },
    {
      name: "jin_proposal_read",
      description:
        "Read a Jin proposal target snapshot as JSON. Use this to inspect the planned architecture without opening files.",
      input: ProposalInput,
      async execute(input) {
        const selected = input.version ?? service.versions(input.req).at(-1)
        if (!selected) throw new Error(`Proposal ${input.req} has no versions`)
        const view = service.review(input.req, selected)

        return {
          content: json({
            req: view.req,
            version: view.version,
            meta: view.meta,
            summary: view.summary,
            decision: view.decision,
            applied: view.applied,
            target: view.target,
            diff: view.diff,
          }),
          metadata: { req: input.req, version: selected },
        }
      },
    },
    {
      name: "jin_validate",
      description:
        "Validate a Jin proposal target snapshot. When it has no errors, request desktop approval and open the review panel. Do not call jin_apply; approval applies the architecture and resumes the agent.",
      input: ValidateInput,
      async execute(input, context) {
        const selected = input.version ?? service.versions(input.req).at(-1)
        if (!selected) throw new Error(`Proposal ${input.req} has no versions`)
        const issues = service.validate(input.req, selected)
        const errors = issues.filter((issue) => issue.level === "error")

        if (errors.length > 0) {
          return {
            content: json({ errors: errors.length, issues }),
            metadata: { req: input.req, version: selected, errors: errors.length, approval: false },
          }
        }

        const review = service.review(input.req, selected)
        if (review.applied) {
          return {
            content: `Proposal ${input.req} v${selected} is already applied.`,
            metadata: { req: input.req, version: selected, errors: 0, approval: false },
          }
        }

        service.requestApproval(input.req, selected)
        const opened = await announceApproval({
          sessionID: String(context.sessionID),
          req: input.req,
          version: selected,
          title: review.meta.title,
        })
        const warnings = issues.length > 0 ? ` ${issues.length} warning(s) remain.` : ""

        return {
          content: `Proposal ${input.req} v${selected} is valid.${warnings} ${
            opened ? "The approval panel is open." : "The approval request is pending; open the Jin architecture panel."
          } Wait for the user's decision. Approval applies the architecture and resumes you automatically. Do not call jin_apply.`,
          metadata: { req: input.req, version: selected, errors: 0, approval: true },
        }
      },
    },
    {
      name: "jin_apply",
      description:
        "Manually apply an approved Jin proposal version. The normal desktop approval flow applies on approval and resumes the agent, so call this only when the user explicitly asks to retry an approved proposal. The server rejects the call unless the signed approval exists and the proposal base hash still matches the live architecture.",
      input: ApplyInput,
      async execute(input) {
        const selected = input.version ?? service.versions(input.req).at(-1)
        if (!selected) throw new Error(`Proposal ${input.req} has no versions`)
        const current = service.review(input.req, selected)
        if (current.applied) {
          return {
            content: json({
              applied: `${current.req} v${selected}`,
              title: current.meta.title,
              already_applied: true,
            }),
            metadata: {
              req: current.req,
              version: selected,
              applied_at: current.applied?.at ?? "",
            },
          }
        }

        const entry = service.apply(input.req, selected, {
          force: input.force,
          commit: input.commit,
        })

        return {
          content: json({
            applied: `${entry.req} v${entry.applied_version}`,
            title: entry.title,
            summary: entry.summary,
          }),
          metadata: {
            req: entry.req,
            version: entry.applied_version,
            applied_at: entry.applied_at,
          },
        }
      },
    },
  ]
}

export default Plugin.define({
  id: "jin",
  async setup(ctx) {
    const service = new JinService(ctx.location.directory)
    const rpc = await ctx.rpc.register(Definition, {
      state: (_input, call) => attempt(call, () => service.state()),
      bootstrap: (input, call) => attempt(call, () => service.bootstrap(input.languages)),
      review: (input, call) => attempt(call, () => service.review(input.req, input.version, input.base ?? "current")),
      create: (input, call) =>
        attempt(call, () =>
          service.create({
            req: input.req,
            title: input.title,
            description: input.description,
            acceptance: input.acceptance,
            scope: input.scope,
            author: input.author,
          }),
        ),
      revise: (input, call) => attempt(call, () => service.revise(input.req, input.seed ?? "previous")),
      validate: (input, call) => attempt(call, () => service.validate(input.req, input.version)),
      decide: (input, call) =>
        attempt(call, () =>
          service.decide(input.req, input.version, input.decision, input.comments, input.decided_by, input.target_hash),
        ),
      resolve: (input, call) =>
        attempt(call, async () => {
          const resolved = service.resolve(
            input.req,
            input.version,
            input.decision,
            input.comments,
            input.target_hash,
          )
          const resume = input.resume ?? true
          const continued = await Promise.resolve()
            .then(() =>
              ctx.session.synthetic({
                sessionID: Session.ID.make(input.sessionID),
                text: continuation(input.req, input.version, resolved.decision.decision, input.comments),
                description: "Jin architecture decision",
                resume,
              }),
            )
            .then(
              () => resume,
              () => false,
            )

          return {
            req: input.req,
            version: input.version,
            decision: resolved.decision.decision,
            applied: resolved.history !== null,
            continued,
          }
        }),
      apply: (input, call) =>
        attempt(call, () =>
          service.apply(input.req, input.version, {
            force: input.force,
            commit: input.commit,
          }),
        ),
    })

    const announceApproval: ApprovalAnnouncer = (request) =>
      rpc.events.emit("approval", request).then(
        () => true,
        () => false,
      )

    await ctx.tool.transform((editor) => {
      for (const tool of tools(service, announceApproval)) editor.add(tool)
    })

    return () => rpc.dispose()
  },
})
