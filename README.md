<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="OpenCode logo">
    </picture>
  </a>
</p>
<p align="center">The open source AI coding agent.</p>
<p align="center"><strong>This fork adds Jin: architecture-driven development with one-click approval.</strong></p>
<p align="center">
  <a href="https://opencode.ai/discord"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord" /></a>
  <a href="https://www.npmjs.com/package/@opencode/cli"><img alt="npm" src="https://img.shields.io/npm/v/@opencode/cli?style=flat-square" /></a>
  <a href="https://github.com/anomalyco/opencode/actions/workflows/publish.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/anomalyco/opencode/publish.yml?style=flat-square&branch=dev" /></a>
</p>

<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh.md">简体中文</a> |
  <a href="README.zht.md">繁體中文</a> |
  <a href="README.ko.md">한국어</a> |
  <a href="README.de.md">Deutsch</a> |
  <a href="README.es.md">Español</a> |
  <a href="README.fr.md">Français</a> |
  <a href="README.it.md">Italiano</a> |
  <a href="README.da.md">Dansk</a> |
  <a href="README.ja.md">日本語</a> |
  <a href="README.pl.md">Polski</a> |
  <a href="README.ru.md">Русский</a> |
  <a href="README.bs.md">Bosanski</a> |
  <a href="README.ar.md">العربية</a> |
  <a href="README.no.md">Norsk</a> |
  <a href="README.br.md">Português (Brasil)</a> |
  <a href="README.th.md">ไทย</a> |
  <a href="README.tr.md">Türkçe</a> |
  <a href="README.uk.md">Українська</a> |
  <a href="README.bn.md">বাংলা</a> |
  <a href="README.gr.md">Ελληνικά</a> |
  <a href="README.vi.md">Tiếng Việt</a>
</p>

---

> [!IMPORTANT]
> **This repository is the Jin fork of OpenCode.** Jin adds an architecture
> graph, structural proposals, and a one-click approval gate to OpenCode
> Desktop. The upstream installation commands below install upstream OpenCode,
> not this fork. To run Jin, use [Run Jin locally](#run-jin-locally) and the
> full [Jin guide](./JIN.md).

## Jin

**Architecture-driven development for OpenCode Desktop.**

Jin gives the coding agent an explicit architecture to work against. Structural
changes become reviewable proposals instead of silent edits, and a
server-enforced approval gate sits between the agent and `arch/`. Approval is
one click: the decision is signed, the target architecture is applied, and the
agent continues automatically.

<p align="center">
  <img src="docs/jin/approval-dark.png" alt="Jin approval panel in OpenCode Desktop" width="860">
</p>
<p align="center"><sub>The agent validates a proposal; Jin opens automatically. One decision applies or rejects it and resumes the agent.</sub></p>

### What makes it different

- **The architecture is part of the loop.** Agents create and revise proposals
  against a real L0/L1 model, then validate the target against the code.
- **Approval is one action.** `Approve & apply` signs the decision, applies the
  target, and resumes the agent. There is no separate approve-then-apply step.
- **Rejection is useful.** A rejected proposal carries an optional review
  comment back to the agent, which resumes and revises instead of silently
  continuing.
- **The server owns the gate.** The desktop is the review surface, not the
  security boundary. Decisions are HMAC-signed and bound to the target hash the
  user reviewed.

### See the architecture, not just the diff

<p align="center">
  <img src="docs/jin/graph.png" alt="Jin architecture graph with direct dependency edges and inspector" width="1000">
</p>
<p align="center"><sub>Graph fixture: a proposal diff, direct dependency edges, and the entity inspector.</sub></p>

The graph renders systems, layers, modules, entities, fields, methods, and
direct dependency edges. Hover or select a node to trace only its relations;
unrelated parts fade out. Cross-layer module edges are blue dashed, entity edges
are cyan solid, and proposals show added/removed/changed/moved nodes in green,
red, amber, and purple. Entity selection opens a full inspector in the right
column.

### Capabilities

| Capability | What it does |
| --- | --- |
| **Live architecture graph** | Systems, layers, modules, entities, fields, methods, direct edges, focus mode, and a right-side inspector. |
| **Structural proposals** | Versioned targets under `arch/proposals/<REQ>/`, with rationale, acceptance criteria, structural diff, and history. |
| **One-click approval** | Signed `resolve` applies the target and sends a synthetic continuation to the session. Rejection does the same with comments. |
| **Auto-open review** | A valid `jin_validate` emits an `approval` event; the desktop opens Jin in Review mode and selects the pending proposal. |
| **Drift detection** | After apply, Jin compares declared locations and symbols with real declarations and reports errors and warnings. |
| **Bilingual UI** | English and Simplified Chinese, light and dark themes, responsive narrow layout. |
| **Agent tools** | `jin_arch_read`, `jin_status`, `jin_proposal_create`, `jin_proposal_revise`, `jin_proposal_read`, `jin_validate`, and a manual `jin_apply` fallback. |

### The approval flow

1. The agent creates a proposal and edits only
   `versions/vN/target-L0.yaml` and `versions/vN/target-L1/*.yaml`.
2. `jin_validate` checks the target against the live code. Errors go back to the
   agent; a valid target moves to `in_review`.
3. The desktop opens Jin automatically and selects the pending proposal.
4. The user clicks **Approve & apply** or **Reject** once. The server signs the
   decision, binds it to the reviewed target hash, and sends a synthetic
   continuation message.
5. On approval the target is written to `arch/`; on rejection only the decision
   and comment are stored. Either way, the agent resumes automatically.

Agents cannot approve. Editing `meta.yaml` or `decisions/*.yaml` by hand does not
approve a proposal; the server verifies the signature and target hash before
applying.

### Run Jin locally

```bash
git clone git@github.com:ZYF93/opencode-jin.git
cd opencode-jin
bun install
bun run dev:desktop
```

Then:

1. Open or create a project in the desktop app.
2. Open the **Architecture** side panel (or run the
   `Open Jin architecture` command).
3. If the project has no `arch/L0.yaml`, click **Scan current code**. Jin writes
   a draft through the same scanner as the server and never overwrites an
   existing architecture.
4. Ask the agent for a structural change and tell it to create a Jin proposal,
   edit only the target files, and validate.
5. Review the target, diff, and drift warnings. Approve or reject once. The
   agent continues automatically.

> [!TIP]
> The normal agent instruction is "validate, then wait for the user's
> decision." `jin_validate` is the handoff point.

### Supported languages

| Language | What is extracted |
| --- | --- |
| TypeScript / JavaScript | Exported declarations, classes, types, functions, component/page/store entities, fields, methods, and usage relations. |
| Python | Top-level classes and functions, method signatures, fields, and dotted imports. |
| Java | Top-level types. |
| Kotlin | Top-level types and functions. |

The adapters are declaration-level and intentionally approximate; they are not a
compiler. Missing locations and symbols are validation errors, while
unregistered public symbols are warnings.

### Packages and docs

| Path | Role |
| --- | --- |
| [`packages/jin-core`](./packages/jin-core) | L0/L1 model, YAML IO, scanner, validation, diff, drift, proposal lifecycle, apply gate. |
| [`packages/jin-opencode`](./packages/jin-opencode) | OpenCode server plugin, RPC surface, agent tools, approval event, synthetic continuation. |
| [`packages/gui-extensions/src/jin`](./packages/gui-extensions/src/jin) | Desktop panel, architecture graph, diff review, inspector, i18n. |
| [`JIN.md`](./JIN.md) | Full English user guide: model, approval contract, security, development, troubleshooting. |
| [`JIN.zh.md`](./JIN.zh.md) | 完整中文使用指南。 |

Jin ships no model credentials and no Python sidecar. Models are supplied by the
user through OpenCode. The approval secret can be set with
`JIN_APPROVAL_SECRET`, `JIN_APPROVAL_KEY_FILE`, or a generated
`~/.local/share/opencode/jin/approval.key` (mode `0600`).

---

## Upstream OpenCode

[![OpenCode Terminal UI](packages/web/src/assets/lander/screenshot.png)](https://opencode.ai)

Everything below this line is the upstream OpenCode README. The installation
commands install upstream OpenCode, not Jin. For this fork, use the Jin quick
start above.

### Installation

```bash
# YOLO
curl -fsSL https://opencode.ai/v2/install | bash

# Package managers
npm i -g @opencode/cli@latest      # or bun/pnpm/yarn
brew install anomalyco/tap/opencode-v2 # macOS and Linux (recommended, always up to date)
brew install opencode              # macOS and Linux (official brew formula, updated less)
sudo pacman -S opencode            # Arch Linux (Stable)
paru -S opencode-beta              # Arch Linux (Latest from AUR)
mise use -g opencode               # Any OS
nix run github:anomalyco/opencode  # Nix
```

> [!TIP]
> Remove versions older than 0.1.x before installing.

### Desktop App (BETA)

OpenCode is also available as a desktop application. Download it from [opencode.ai/download](https://opencode.ai/download).

| Platform              | Download                           |
| --------------------- | ---------------------------------- |
| macOS (Apple Silicon) | `opencode-desktop-mac-arm64.dmg`   |
| macOS (Intel)         | `opencode-desktop-mac-x64.dmg`     |
| Windows               | `opencode-desktop-win-x64.exe`     |
| Linux                 | `.deb`, `.rpm`, or `.AppImage`     |

```bash
# macOS (Homebrew)
brew install --cask opencode-desktop
```

#### Installation Directory

The install script respects the following priority order for the installation path:

1. `$OPENCODE_INSTALL_DIR` - Custom installation directory
2. `$XDG_BIN_DIR` - XDG Base Directory Specification compliant path
3. `$HOME/bin` - Standard user binary directory (if it exists or can be created)
4. `$HOME/.opencode/bin` - Default fallback

```bash
# Examples
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://opencode.ai/v2/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://opencode.ai/v2/install | bash
```

### Agents

OpenCode includes two built-in agents you can switch between with the `Tab` key.

- **build** - Default, full-access agent for development work
- **plan** - Read-only agent for analysis and code exploration
  - Denies file edits by default
  - Asks permission before running bash commands
  - Ideal for exploring unfamiliar codebases or planning changes

Also included is a **general** subagent for complex searches and multistep tasks.
This is used internally and can be invoked using `@general` in messages.

Learn more about [agents](https://opencode.ai/docs/agents).

### Documentation

For more info on how to configure OpenCode, [**head over to our docs**](https://opencode.ai/docs).

### Contributing

If you're interested in contributing to OpenCode, please read our [contributing docs](./CONTRIBUTING.md) before submitting a pull request.

### Building on OpenCode

If you are working on a project that's related to OpenCode and is using "opencode" as part of its name, for example "opencode-dashboard" or "opencode-mobile", please add a note to your README to clarify that it is not built by the OpenCode team and is not affiliated with us in any way.

---

**Join our community** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
