# 参与贡献

感谢你对 timeline-kit 的关注。本文档说明本地开发环境、常用脚本、提交规范以及发布流程。

## 环境要求

- Node.js 24（测试依赖 Node 24 原生 TypeScript 剥离与 `node:test`）
- pnpm 9
- 端到端测试需要一个 Chromium / Chrome 可执行文件（见下文 `CHROME_BIN`）

## 安装依赖

```bash
pnpm install --frozen-lockfile
```

文档站 `docs/` 有独立的 `package.json`，首次运行文档站前请在该目录内执行 `pnpm install`。

## 常用脚本

| 脚本 | 说明 |
| --- | --- |
| `npm run typecheck` | 核心库与示例的 TypeScript 类型检查 |
| `npm run typecheck:adapters` | React / Vue 适配层的类型检查 |
| `npm run lint` | 代码风格检查（待接入，接入后即可使用） |
| `npm test` | Node 单元测试（数据操作、OTIO、引擎、Store/插件、SlotBridge） |
| `npm run test:e2e` | Chromium CDP 端到端测试，需设置 `CHROME_BIN` |
| `npm run test:all` | 依次执行类型检查、适配层类型检查、单元测试与端到端测试 |
| `npm run build` | 清理并构建库产物到 `dist/`（按入口输出 ESM 与类型声明） |
| `npm run build:demo` | 构建多场景交互 Demo |
| `npm run serve` | 启动本地 Demo 服务器（`http://127.0.0.1:4173/demo/index.html`） |
| `npm run docs:gen-api` | 重新生成 API 参考文档 |
| `npm run docs:verify` | 校验 Astro Starlight 文档站的完整性 |
| `pnpm dev` / `pnpm build`（在 `docs/` 目录内） | 文档站开发服务器与构建，启动前会自动同步资源 |

### 端到端测试与 `CHROME_BIN`

`test:e2e` 通过 CDP 驱动一个真实的 Headless Chromium。若系统无法自动找到浏览器，请显式指定可执行文件路径：

```bash
CHROME_BIN="/path/to/chrome" npm run test:e2e
```

### 文档站资源同步

`docs/public/assets/` 是由 `demo/assets/` 生成的副本，已加入 `.gitignore`，不纳入版本管理。文档站的 `pnpm dev` 与 `pnpm build` 会先执行 `pnpm run sync:assets`（即 `node ../scripts/sync-docs-assets.mjs`）完成同步。

如果直接运行 `npm run docs:verify` 前副本缺失，请先执行一次同步：

```bash
node scripts/sync-docs-assets.mjs
```

## 贡献的授权

本项目采用双许可：以 AGPL-3.0-only 开源，同时向不愿按 AGPL 开源的用户提供商业授权。为了能把社区贡献同样纳入商业授权，提交 Pull Request 即表示你：

- 确认所提交的内容为你本人原创，或你有权提交；
- 同意项目维护者以本项目当前的许可证，以及维护者另行提供的商业授权条款，使用、修改和再授权你的贡献。

如不同意上述条款，请不要提交代码；如有疑问，请先联系 x007xyzabc@gmail.com。

## 提交信息规范

提交信息遵循 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/v1.0.0/)：

```text
<type>(<scope>): <subject>
```

常用 `type`：

- `feat`：新功能
- `fix`：缺陷修复
- `docs`：仅文档变更
- `refactor`：不改变行为的重构
- `test`：测试相关
- `chore`：构建、依赖与工程配置

示例：`fix: scope window shortcuts to the active editor`

## 发布流程

1. 在 `CHANGELOG.md` 的 `## [Unreleased]` 下整理本次变更，并新增对应版本的章节（如 `## [0.2.1] - YYYY-MM-DD`）。
2. 修改根目录 `package.json` 中的 `version`，保持与 CHANGELOG 一致。
3. 将版本变更合入 `main`，再为该提交创建并推送版本标签。

   ```bash
   git switch main
   git pull --ff-only
   git tag v0.2.1
   git push origin v0.2.1
   ```

GitHub Actions 会检查标签与 `package.json` 的稳定版本号一致，运行 CI，再通过 npm Trusted Publishing 将包发布到 `latest`。

## 文档部署

每次更新 `main`，GitHub Actions 都会构建 `docs/` 并部署到 [GitHub Pages](https://x007xyz.github.io/timeline-kit/)。部署工作流会读取 Pages 的站点地址和路径前缀，切换域名后可在 Actions 里手动重新运行 `Deploy documentation`。
