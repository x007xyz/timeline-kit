# timeline-kit

框架无关、插件驱动的 **DOM + Canvas 混合时间轴编辑器组件库**，面向中轻度音视频与图文剪辑场景设计，提供开箱即用的完整体验、高度可定制的插槽/策略/插件体系，以及 React / Vue 3 / 原生 TS 多端适配。

- **轻量数据模型 + 双向 OTIO 兼容**：默认对外提供扁平直觉的 `TimelineDocument（tracks / clips）`，同时内置 `timeline-kit/otio` 双向无损适配器兼容 OpenTimelineIO `Timeline.1` 与旧版 FlyCut metadata。
- **混合分层渲染 + 视口虚拟化**：DOM 骨架负责结构、裁剪手柄与任意自定义插槽；Canvas 2D 负责标尺、视频胶片缩略图与音频真实波形；结合脏区通道（`playhead / selection / ruler / tracks / sidebar / toolbar / overlay`）与横向视口虚拟挂载，实现 60fps 播放头推进与百级片段流畅滚动。
- **命令总线与插件化交互**：`TimelineStore` + `CommandBus`（支持内置历史栈或外部全局 Undo/Redo 接管）+ `InteractionManager`（拖拽、裁剪、播放头、滚轮锚点缩放、快捷键、框选多选、网格吸附、外部素材拖入皆为独立插件）。
- **多框架无缝集成**：提供原生 JS/TS、`timeline-kit/react`（Portal + `useSyncExternalStore`）、`timeline-kit/vue`（Teleport + Scoped Slots）及纯逻辑内核 `timeline-kit/core`。

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

本仓库使用 Node 24 原生 TS 剥离与内置 `node:test`，无需安装第三方依赖即可运行全部检查与多场景 Demo：

```bash
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

