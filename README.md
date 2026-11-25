# timeline-kit

框架无关、插件驱动的 **DOM + Canvas 混合时间轴编辑器组件库**，面向中轻度音视频与图文剪辑场景设计，提供开箱即用的完整体验、高度可定制的插槽/策略/插件体系，以及 React / Vue 3 / 原生 TS 多端适配。

- **轻量数据模型 + 双向 OTIO 兼容**：默认对外提供扁平直觉的 `TimelineDocument（tracks / clips）`，同时内置 `timeline-kit/otio` 双向无损适配器兼容 OpenTimelineIO `Timeline.1` 与旧版 FlyCut metadata。
- **混合分层渲染 + 视口虚拟化**：DOM 骨架负责结构、裁剪手柄与任意自定义插槽；Canvas 2D 负责标尺、视频胶片缩略图与音频真实波形；结合脏区通道（`playhead / selection / ruler / tracks / sidebar / toolbar / overlay`）与横向视口虚拟挂载，实现 60fps 播放头推进与百级片段流畅滚动。
- **命令总线与插件化交互**：`TimelineStore` + `CommandBus`（支持内置历史栈或外部全局 Undo/Redo 接管）+ `InteractionManager`（拖拽、裁剪、播放头、滚轮锚点缩放、快捷键、框选多选、网格吸附、外部素材拖入皆为独立插件）。
- **多框架无缝集成**：提供原生 JS/TS、`timeline-kit/react`（Portal + `useSyncExternalStore`）、`timeline-kit/vue`（Teleport + Scoped Slots）及纯逻辑内核 `timeline-kit/core`。

---

## 安装

```bash
npm i timeline-kit
# 或
pnpm add timeline-kit
```

- `react` / `react-dom`（>=18）与 `vue`（>=3.3）是**可选 peer 依赖**，仅在使用 `timeline-kit/react` 或 `timeline-kit/vue` 适配层时需要安装；只使用原生 JS / TS 入口时无需安装。
- 包内同时提供 ESM 产物与 TypeScript 类型声明，无需额外安装 `@types/*`。

### 入口一览

| 入口 | 内容 |
| --- | --- |
| `timeline-kit` | 默认入口：`createTimelineEditor`、`demoDocument`、官方交互插件等，开箱即用的完整编辑器 |
| `timeline-kit/core` | 纯逻辑内核：数据模型与编辑操作、引擎计算、`TimelineStore` / `CommandBus`、插件类型与 `InteractionManager`、框架桥接工具（不含默认 UI 渲染器） |
| `timeline-kit/otio` | OpenTimelineIO 双向适配器（`Timeline.1` 与旧版 FlyCut metadata） |
| `timeline-kit/plugins` | 官方插件集合（框选、磁吸、外部拖入等） |
| `timeline-kit/react` | React 适配层：`TimelineEditor` 组件（Portal + `useSyncExternalStore`）与 `useTimelineSelector` 等 Hooks |
| `timeline-kit/vue` | Vue 3 适配层：`TimelineEditor` 组件（Teleport + 作用域插槽）与 Composables |

### 浏览器支持

- 支持现代 evergreen 浏览器（Chrome、Edge、Firefox、Safari 的最新稳定版本）。
- 语法目标为 ES2022；运行时依赖 **Canvas 2D**，不支持无 Canvas 的环境。

---

## 快速开始

### 1. 原生 JS / TS（开箱即用）

```ts
import {
  createTimelineEditor,
  demoDocument,
  createMarqueeSelectPlugin,
} from 'timeline-kit'

const editor = createTimelineEditor(document.getElementById('timeline')!, {
  document: demoDocument,
  theme: 'dark',
  trackScale: 50,
  trackConfigs: {
    video: { type: 'video', height: 68 },
    audio: { type: 'audio', height: 56 },
    image: { type: 'image', height: 64 },
    text:  { type: 'text',  height: 52 },
  },
  plugins: [createMarqueeSelectPlugin()],
})

editor.subscribeSelector(
  state => state.currentFrame,
  frame => console.log('当前帧:', frame),
)
```

### 2. React

```tsx
import { TimelineEditor, useTimelineSelector } from 'timeline-kit/react'

export function App() {
  return (
    <TimelineEditor
      document={demoDocument}
      theme="dark"
      renderClip={({ clip, isSelected }) => (
        <div className={isSelected ? 'clip-active' : 'clip'}>
          {clip.name}
        </div>
      )}
      onDocumentChange={({ document }) => save(document)}
    />
  )
}
```

### 3. Vue 3

```vue
<template>
  <TimelineEditor :document="doc" theme="dark" @documentchange="onChange">
    <template #clip="{ clip, isSelected }">
      <div :class="['clip', { active: isSelected }]">{{ clip.name }}</div>
    </template>
  </TimelineEditor>
</template>
```

### 4. Headless / 接管全局撤销栈

```ts
const editor = createTimelineEditor(el, {
  document: doc,
  ui: { toolbar: false, sidebar: true, ruler: true },
  history: 'external',
  onBeforeCommand(command, ctx) {
    if (command.type === 'clip:move') {
      hostUndoStack.push(ctx.store.getState().document)
    }
  },
})

editor.exec('clip:split')
```

---

## 目录结构

```text
timeline-kit/
├── src/
│   ├── index.ts                默认开箱即用入口
│   ├── core-entry.ts           纯逻辑内核入口 (timeline-kit/core)
│   ├── otio-entry.ts           OTIO 适配入口 (timeline-kit/otio)
│   ├── plugins-entry.ts        官方插件入口 (timeline-kit/plugins)
│   ├── model/                  TimelineDocument 类型、纯编辑操作与 demoDocument
│   ├── adapters/otio.ts        OTIO <-> TimelineDocument 双向适配器
│   ├── otio-core/              内置 OpenTimelineIO 数据层
│   ├── engine/                 时间缩放、布局、虚拟化、磁吸、放置策略、吸附、命中测试
│   ├── store/                  TimelineStore（选择器订阅/脏通道）+ CommandBus
│   ├── plugins/                InteractionManager + 内置/官方交互与吸附插件
│   ├── renderer/               DOM+Canvas 混合渲染器、标尺、工具栏、侧栏、CSS Tokens
│   ├── editor/                 TimelineEditor 主控制器门面
│   ├── frameworks/             SlotBridge（mount/update/destroy 跨框架桥接）
│   └── utils/trimOffset.ts     裁剪偏移工具
├── adapters/
│   ├── react/index.ts          React 适配层 (Portal + useSyncExternalStore)
│   └── vue/index.ts            Vue 3 适配层 (Teleport + Composables)
├── demo/                       多场景交互示例（胶片/波形/花字/图片/虚拟化/无头/OTIO）
├── tests/                      Node 24 单元测试 + Chromium CDP 端到端测试
└── scripts/                    TS 解析钩子、零依赖本地开发服务器、CDP 测试客户端
```

---

## 本地运行与验证

本仓库使用 Node 24 原生 TS 剥离与内置 `node:test`。运行检查、构建与 Demo 前需要先安装开发依赖（TypeScript、Vite、React、Vue 等）：

```bash
pnpm install
```

```bash
# 构建库产物（输出到 dist/：按入口的 ESM 与 dist/types 类型声明）
npm run build

# 构建多场景交互 Demo（产物位于 dist-demo/）
npm run build:demo

# 类型检查（核心库 + 示例 + React/Vue 适配层）
npm run typecheck
npm run typecheck:adapters

# 单元测试（数据操作、OTIO 转换、引擎布局/虚拟化/吸附/命中、Store/插件/SlotBridge）
npm test

# 启动多场景交互 Demo（浏览器打开 http://127.0.0.1:4173/demo/index.html）
npm run serve

# 真实 Headless Chromium 端到端测试（覆盖全媒体画布渲染、拖拽、裁剪、框选、磁吸、外部拖入、128 片段虚拟化等）
npm run test:e2e

# 重新生成 API 参考文档并校验 Astro Starlight 文档站完整性
npm run docs:gen-api
npm run docs:verify
```

### Astro Starlight (MDX) 文档站

完整中文文档、多框架交互岛屿（Vanilla / React 19 / Vue 3）、7 大活场景 Playground 与自动生成的 API 参考位于 `docs/`：

```bash
cd docs
pnpm install
pnpm dev
```

`docs/public/assets/` 是由 `demo/assets/` 生成的副本，不纳入版本管理；`pnpm dev` 与 `pnpm build` 启动前会自动执行 `scripts/sync-docs-assets.mjs` 完成同步。

---

## 许可证

Copyright (c) 2026 timeline-kit authors <x007xyzabc@gmail.com>

timeline-kit 采用**双许可**：你可以在下面两种许可中任选一种。

### 1. GNU AGPL-3.0（免费）

本项目以 [GNU Affero General Public License v3.0 only](./LICENSE)（`AGPL-3.0-only`）开源。只要遵守 AGPL，任何人都可以免费使用、修改和分发，包括商业用途。AGPL 的核心要求：

- **你的整个应用也必须以 AGPL-3.0 开源。** timeline-kit 是前端库，会被打包进你的应用一起分发给用户，因此你的应用作为整体须使用 AGPL 兼容的许可证，并向用户提供完整源码。
- **通过网络提供服务同样适用。** 用户通过浏览器或网络使用你的应用时，你也必须向这些用户提供对应的完整源码，包括你做的修改。
- 必须保留版权声明和许可证文本。

适合：开源项目、个人学习与研究，以及愿意把自己的产品以 AGPL 开源的团队。

### 2. 商业授权（付费）

如果你**不能或不想**按 AGPL 开源自己的应用，例如闭源商业产品、闭源 SaaS、企业内部不公开源码的系统、需要再分发给客户的私有项目，就需要购买商业授权。商业授权免除 AGPL 的开源义务，具体条款以双方签署的协议为准。

请发邮件至 **x007xyzabc@gmail.com** 洽谈，邮件中说明公司或项目名称、使用场景和预计规模。

### 常见问题

- **只在内部评估、做原型，算不算需要授权？** 评估和开发阶段，只要不分发、也不对外提供服务，可以先按 AGPL 免费使用；决定闭源上线前再取得商业授权即可。
- **我只调用 npm 包，没有修改 timeline-kit 源码，也要开源吗？** 要。AGPL 的义务针对的是包含本库的整个作品，与是否修改本库无关。
- **不确定自己的场景是否合规？** 欢迎邮件咨询。以上说明是便于理解的概述，不构成法律意见，权利义务以 [LICENSE](./LICENSE) 全文和商业授权协议为准。

