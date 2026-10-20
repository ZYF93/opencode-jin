# Jin Desktop

This repository is a fork of [OpenCode](https://github.com/anomalyco/opencode)
for Jin: architecture-driven development with a server-enforced review gate,
inside the OpenCode desktop app.

## Ground rules

- `origin` is the OpenCode upstream. Fetch and rebase from `origin/dev`
  deliberately; do not treat this fork as a one-way copy.
- Jin-specific work lives under `packages/gui-extensions/src/jin/` and in the
  `packages/jin-*` packages. Avoid changing OpenCode core unless a feature
  cannot be expressed through the GUI extension or plugin APIs.
- Keep the Jin extension isolated so it can later move to an external GUI
  extension package if OpenCode opens that path.
- Keep commits local until a fork remote and a distribution decision exist.
- Jin ships no Python/CPython sidecar, model credentials, or API keys. Models
  are supplied by the user through OpenCode.

## Fork integration points

Jin is additive by design. Only these upstream files change:

- `bun.lock`;
- `packages/core/package.json` and
  `packages/core/src/plugin/internal.ts` to register the server plugin;
- `packages/gui-extensions/package.json` and
  `packages/gui-extensions/src/{main,renderer}.ts` to register the built-in GUI
  extension.

Everything under `packages/jin-core`, `packages/jin-opencode`, and
`packages/gui-extensions/src/jin` is new. Most upstream rebases should only
conflict on those registration lines; keep upstream's changes and re-add the
Jin imports and entries.

## Upstream rebase

Use this before publishing any build or starting the next slice:

```bash
git fetch origin
git rebase origin/dev
bun install
bun run check
```

If a rebase changes the GUI extension or plugin registration APIs, update the
Jin entries in the files listed above instead of copying upstream files over the
fork wholesale.

## Shipped slices

### `@jin/core` (`packages/jin-core`)

- L0/L1 model, YAML IO, project discovery, validation, structural diff.
- Bootstrap scanner: root detection, monorepo systems, package/module boundaries,
  entity and relation generation, and import-based dependency inference.
- Proposal lifecycle: create, revise, review, decisions, apply, history.
- Server-side apply gate: approval must exist, the base hash must still match
  (or `force` must be explicit), and approval is bound to the target hash.
- Drift adapters for TS/JS, Python, Java, and Kotlin:
  - TS/JS extract declarations, members, and usage relations;
  - Python extracts top-level classes/functions, method signatures, fields, and
    dotted imports;
  - Java/Kotlin extract top-level types and Kotlin top-level functions;
  - missing locations/symbols/module paths are errors;
  - unregistered symbols and out-of-module locations are warnings;
  - planned entities that already exist are informational.
- The adapters are declaration-level and approximate. Python remains the parity
  oracle in `../Jin`; `scan/fixtures/scan-parity.json` locks the full bootstrap
  result for the mixed-language fixture.

### `@jin/opencode` (`packages/jin-opencode`)

- OpenCode server plugin registered through `packages/core/src/plugin/internal.ts`.
- Portable RPC surface: `state`, `bootstrap`, `review`, `create`, `revise`,
  `validate`, `decide`, `resolve`, `apply`, plus the `approval` event.
- Agent tools: `jin_arch_read`, `jin_status`, `jin_proposal_create`,
  `jin_proposal_revise`, `jin_proposal_read`, `jin_validate`, `jin_apply`.
- Agents cannot approve. A successful `jin_validate` marks the proposal
  `in_review` and emits `approval`, which opens the desktop review panel. The
  one-click desktop `resolve` writes a decision signed with a server-owned
  HMAC key, applies the approved target, and sends a synthetic session message
  so the agent continues without the user repeating the decision. `apply`
  verifies the signature and the approved target hash before writing `arch/`.
  `decide` and `apply` remain available as lower-level RPC methods, but the
  desktop uses `resolve`.
- The signing key is read from `JIN_APPROVAL_SECRET`, else
  `JIN_APPROVAL_KEY_FILE`, else
  `$XDG_DATA_HOME/opencode/jin/approval.key` (or
  `~/.local/share/opencode/jin/approval.key`). The key is created with mode
  `0600`. Editing `meta.yaml` or `decisions/*.yaml` by hand does not approve a
  proposal.

### Desktop panel (`packages/gui-extensions/src/jin`)

- Pinned `Architecture` side-panel tab, opened by the `Open Jin architecture`
  command or the session review toggle.
- Bootstrap: a project without `arch/L0.yaml` gets a `Scan current code` action.
  The server writes the draft through the same scanner as the Python oracle;
  existing architectures are never overwritten.
- `Review` mode: project status, validation, drift, proposal queue, version
  selection, diff, one-click approval/rejection, and applied history.
  Approval and apply are one action. Rejection returns the optional comment to
  the agent. Either decision sends a synthetic continuation message, so the
  agent resumes without another user prompt.
- A pending proposal is highlighted with an amber approval card and a header
  badge. The agent's `jin_validate` emits an `approval` RPC event, and the
  desktop opens the Jin panel in Review mode automatically. If the session
  cannot resume, the panel reports that the decision was saved but the user
  must send a message.
- `Architecture` mode: unified vertical graph with systems, layers, modules,
  entity member lists, and cross-layer dependencies.
- Graph language:
  - module-level cross-layer dependencies are blue dashed and connect module
    headers directly through the local column gap;
  - entity-level cross-layer dependencies are cyan solid and connect entity
    cards directly;
  - cross-column routes bow through the local gap, while same-column routes arc
    outside the card edge instead of joining a global side bus;
  - the overview keeps edges faint; hovering or selecting an entity traces only
    entity-level relations, and hovering or selecting a module traces only
    module-level relations, while unrelated systems, layers, modules, cards and
    edges fade out;
  - focused relations draw above system (L0) labels and entity cards so the
    source and target remain readable;
  - added nodes use green borders and `+` badges, removed nodes use red dashed
    borders, tint and hatching, changed nodes use amber borders and `~` badges,
    and moved nodes use purple dashed borders and `›` badges; the header legend
    shows each sample;
  - layers run as rows, with modules wrapping across at most two responsive
    columns so direct edges stay readable;
  - entity cards show fields and methods inline; `Expand all` / `Collapse all`
    change the current view.
- Selecting a proposal in the graph switch renders its target snapshot, with
  added/removed/changed/moved nodes folded in from the base snapshot. The
  current architecture is shown when no proposal is selected.
- Entity selection opens the full fields, methods, and relations inspector in
  the right-hand column, not below the graph.
- Post-apply review reads code drift from `State.drift`.

## Development

```bash
bun install
bun run dev:desktop
```

Focused checks:

```bash
bun run --cwd packages/jin-core test
bun run --cwd packages/jin-core typecheck
bun run --cwd packages/jin-opencode typecheck
bun run --cwd packages/gui-extensions test src/jin/graph.test.ts
bun run --cwd packages/gui-extensions typecheck
bun run --cwd packages/core test test/jin-plugin.test.ts
```

Full verification from the repository root:

```bash
bun run lint
bun run check
```

Manual Electron smoke test (Linux). It uses the source CLI, an isolated test
root, and the built renderer, so it does not touch the user's normal server or
provider credentials:

```bash
bun run --cwd packages/desktop build
cd packages/desktop
OPENCODE_CHANNEL=local \
OPENCODE_VERSION=2.0.0-local-desktop \
OPENCODE_DESKTOP_CLI_DEV=$PWD/../cli \
OPENCODE_DESKTOP_ISOLATED_SERVER=1 \
OPENCODE_DESKTOP_SERVER_CHANNEL=local \
OPENCODE_DESKTOP_TEST_ROOT=/tmp/opencode/jin-desktop-smoke \
JIN_APPROVAL_SECRET=jin-smoke \
./node_modules/.bin/electron . --no-sandbox
```

Verified in this shell: sidecar startup and reuse, Jin panel load, existing
architecture validation and post-apply drift, bootstrap generation for a project
without `arch/L0.yaml`, the `approval` event that opens Review mode, one-click
approve-and-apply, and the synthetic continuation message that resumes the
agent.

Visual review of the graph without the desktop shell:

```bash
bun run dev:storybook
# Extensions / Jin / Architecture Graph Story
```

## Packaging

Local desktop builds use the upstream desktop scripts; keep the outputs local
until a fork remote and distribution decision exist.

```bash
bun run --cwd packages/desktop build
bun run --cwd packages/desktop package:linux # or package:mac / package:win
```

The desktop app embeds the Jin GUI extension and connects to an OpenCode server
running the Jin plugin. A packaged build does not bundle a model key; users
connect their own provider through OpenCode.

## Current gaps

1. Add an automated Electron smoke test. Manual Linux Electron verification
   covers sidecar startup, Jin panel load, architecture validation/drift, and
   bootstrap generation. The web app flow covers proposal review, signed
   decision, apply, and drift refresh; the runtime integration test covers the
   RPC gate.
2. Add drift caching or on-demand refresh if full `state` scans become slow on
   large repositories.
3. Decide the fork remote and distribution path, then verify a packaged Jin
   build.
4. Keep `JIN.md` current as the migration slices land.

The OpenCode app and desktop build instructions remain in the upstream
`README.md` and `packages/desktop/README.md`.
