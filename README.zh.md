<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="OpenCode logo">
    </picture>
  </a>
</p>
<p align="center">开源的 AI Coding Agent。</p>
<p align="center"><strong>本分支加入 Jin：面向架构的开发方式与一键审批。</strong></p>
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
> **本仓库是 OpenCode 的 Jin 分支。** Jin 在 OpenCode Desktop 中加入架构图、
> 结构化提案和一键审批门。下方安装命令安装的是上游 OpenCode，不是 Jin。
> 运行 Jin 请见 [本地运行 Jin](#本地运行-jin)，完整说明见
> [JIN.zh.md](./JIN.zh.md)。

## Jin

**面向架构的 AI 开发方式，运行在 OpenCode Desktop 中。**

Jin 让 Coding Agent 在明确的架构约束下工作。结构性改动不再直接改代码，而是
变成可审阅的提案；Agent 与 `arch/` 之间有一道由服务器强制执行的审批门。审批
只需一次点击：服务器签名并应用目标架构，然后 Agent 自动继续。

<p align="center">
  <img src="docs/jin/approval-dark.png" alt="OpenCode Desktop 中的 Jin 审批面板" width="860">
</p>
<p align="center"><sub>Agent 校验提案后，Jin 自动打开；一次点击即可应用或拒绝，并让 Agent 继续。</sub></p>

### 为什么不一样

- **架构进入开发闭环。** Agent 针对真实的 L0/L1 模型创建和修订提案，并用代码
  校验目标。
- **审批只有一个动作。** `批准并应用` 会签名、应用目标并恢复 Agent，不存在
  "先批准再应用"的第二步。
- **拒绝也是有用的反馈。** 拒绝可以带审阅备注回到 Agent，Agent 会自动继续并
  修订，而不是默默往下做。
- **审批门在服务器。** 桌面端只是审阅界面，不是安全边界。决策由 HMAC 签名，
  并绑定到用户审阅时的目标哈希。

### 看到架构，而不只是代码 diff

<p align="center">
  <img src="docs/jin/graph.png" alt="Jin 架构图：直接依赖边与实体检查器" width="1000">
</p>
<p align="center"><sub>架构图夹具：提案差异、直接依赖边与实体检查器。</sub></p>

架构图展示系统、分层、模块、实体、字段、方法和直接依赖边。悬浮或选中节点时只
保留直接关系，其余部分淡出。跨层模块依赖是蓝色虚线，实体依赖是青色实线；提案
中的新增、删除、变更、移动节点分别用绿、红、琥珀、紫标注。选中实体会在右侧栏
打开完整检查器。

### 核心能力

| 能力 | 说明 |
| --- | --- |
| **实时架构图** | 系统、分层、模块、实体、字段、方法、直接依赖边、聚焦模式和右侧检查器。 |
| **结构化提案** | 目标快照按版本保存在 `arch/proposals/<REQ>/`，包含理由、验收标准、结构差异和历史。 |
| **一键审批** | 签名的 `resolve` 会应用目标并向会话发送合成继续消息；拒绝同样自动继续。 |
| **自动打开审阅** | `jin_validate` 通过后发出 `approval` 事件，桌面端自动切到审阅模式并选中提案。 |
| **漂移检测** | 应用后把声明的位置和符号与真实代码对比，报告错误和警告。 |
| **双语界面** | 简体中文 / English，明暗主题，窄窗口自适应。 |
| **Agent 工具** | `jin_arch_read`、`jin_status`、`jin_proposal_create`、`jin_proposal_revise`、`jin_proposal_read`、`jin_validate`，以及手动兜底 `jin_apply`。 |

### 审批流程

1. Agent 创建提案，只编辑 `versions/vN/target-L0.yaml` 和
   `versions/vN/target-L1/*.yaml`。
2. `jin_validate` 用真实代码校验目标。有错误回到 Agent；通过后提案进入
   `in_review`。
3. 桌面端自动打开 Jin 并选中待审批提案。
4. 用户点击一次 **批准并应用** 或 **拒绝**。服务器签名决策、绑定审阅时的目标
   哈希，并发送合成继续消息。
5. 批准会把目标写入 `arch/`；拒绝只保存决策和备注。两种结果都会让 Agent 自动
   继续。

Agent 不能批准。手动修改 `meta.yaml` 或 `decisions/*.yaml` 不会生效；服务器在
应用前会验证签名和目标哈希。

### 本地运行 Jin

```bash
git clone git@github.com:ZYF93/opencode-jin.git
cd opencode-jin
bun install
bun run dev:desktop
```

然后：

1. 在桌面端打开或创建一个项目。
2. 打开侧边栏的 **架构** 面板（或运行 `Open Jin architecture` 命令）。
3. 如果项目没有 `arch/L0.yaml`，点击 **扫描当前代码**。Jin 会用与服务器相同的
   扫描器生成草稿，不会覆盖已有架构。
4. 让 Agent 做结构性改动，并要求它创建 Jin 提案、只编辑目标文件并校验。
5. 查看目标、差异和漂移提示。批准或拒绝一次，Agent 会自动继续。

> [!TIP]
> 正常的 Agent 指令是"校验，然后等待用户决策"。`jin_validate` 就是交接点。

### 支持的语言

| 语言 | 提取内容 |
| --- | --- |
| TypeScript / JavaScript | 导出声明的类、类型、函数、组件/页面/Store 实体、字段、方法和使用关系。 |
| Python | 顶层类和函数、方法签名、字段、点号导入。 |
| Java | 顶层类型。 |
| Kotlin | 顶层类型和函数。 |

适配器是声明级的，故意保持近似，不是编译器。缺少位置或符号是校验错误，未登记
的公开符号是警告。

### 包与文档

| 路径 | 作用 |
| --- | --- |
| [`packages/jin-core`](./packages/jin-core) | L0/L1 模型、YAML 读写、扫描器、校验、差异、漂移、提案生命周期、应用门。 |
| [`packages/jin-opencode`](./packages/jin-opencode) | OpenCode 服务器插件、RPC、Agent 工具、审批事件、合成继续消息。 |
| [`packages/gui-extensions/src/jin`](./packages/gui-extensions/src/jin) | 桌面面板、架构图、差异审阅、检查器、国际化。 |
| [`JIN.zh.md`](./JIN.zh.md) | 完整中文使用指南：模型、审批契约、安全、开发、排错。 |
| [`JIN.md`](./JIN.md) | Full English user guide. |

Jin 不内置模型凭据，也不带 Python sidecar。模型由用户通过 OpenCode 提供。审批
密钥可以用 `JIN_APPROVAL_SECRET`、`JIN_APPROVAL_KEY_FILE` 设置，或使用自动生成
的 `~/.local/share/opencode/jin/approval.key`（权限 `0600`）。

---

## 上游 OpenCode

[![OpenCode Terminal UI](packages/web/src/assets/lander/screenshot.png)](https://opencode.ai)

以下内容是上游 OpenCode 的 README。安装命令安装的是上游 OpenCode，不是 Jin。
本分支请使用上面的 Jin 快速开始。

### 安装

```bash
# 直接安装 (YOLO)
curl -fsSL https://opencode.ai/v2/install | bash

# 软件包管理器
npm i -g @opencode/cli@latest      # 也可使用 bun/pnpm/yarn
brew install anomalyco/tap/opencode-v2 # macOS 和 Linux（推荐，始终保持最新）
brew install opencode              # macOS 和 Linux（官方 brew formula，更新频率较低）
sudo pacman -S opencode            # Arch Linux (Stable)
paru -S opencode-beta              # Arch Linux (Latest from AUR)
mise use -g opencode               # 任意系统
nix run github:anomalyco/opencode  # Nix
```

> [!TIP]
> 安装前请先移除 0.1.x 之前的旧版本。

### 桌面应用程序 (BETA)

OpenCode 也提供桌面版应用。可从 [opencode.ai/download](https://opencode.ai/download) 下载。

| 平台                  | 下载文件                           |
| --------------------- | ---------------------------------- |
| macOS (Apple Silicon) | `opencode-desktop-mac-arm64.dmg`   |
| macOS (Intel)         | `opencode-desktop-mac-x64.dmg`     |
| Windows               | `opencode-desktop-win-x64.exe`     |
| Linux                 | `.deb`、`.rpm` 或 AppImage         |

```bash
# macOS (Homebrew Cask)
brew install --cask opencode-desktop
```

#### 安装目录

安装脚本按照以下优先级决定安装路径：

1. `$OPENCODE_INSTALL_DIR` - 自定义安装目录
2. `$XDG_BIN_DIR` - 符合 XDG 基础目录规范的路径
3. `$HOME/bin` - 如果存在或可创建的用户二进制目录
4. `$HOME/.opencode/bin` - 默认备用路径

```bash
# 示例
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://opencode.ai/v2/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://opencode.ai/v2/install | bash
```

### Agents

OpenCode 内置两种 Agent，可用 `Tab` 键快速切换：

- **build** - 默认模式，具备完整权限，适合开发工作
- **plan** - 只读模式，适合代码分析与探索
  - 默认拒绝修改文件
  - 运行 bash 命令前会询问
  - 便于探索未知代码库或规划改动

另外还包含一个 **general** 子 Agent，用于复杂搜索和多步任务，内部使用，也可在消息中输入 `@general` 调用。

了解更多 [Agents](https://opencode.ai/docs/agents) 相关信息。

### 文档

更多配置说明请查看我们的 [**官方文档**](https://opencode.ai/docs)。

### 参与贡献

如有兴趣贡献代码，请在提交 PR 前阅读 [贡献指南 (Contributing Docs)](./CONTRIBUTING.md)。

### 基于 OpenCode 进行开发

如果你在项目名中使用了 “opencode”（如 “opencode-dashboard” 或 “opencode-mobile”），请在 README 里注明该项目不是 OpenCode 团队官方开发，且不存在隶属关系。

---

**加入我们的社区** [飞书](https://applink.feishu.cn/client/chat/chatter/add_by_link?link_token=52ao9352-5623-4fa0-b7dd-3407c392c1af&qr_code=true) | [X.com](https://x.com/opencode)
