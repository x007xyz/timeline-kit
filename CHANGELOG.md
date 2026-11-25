# 更新日志

本项目的所有重要变更都记录在此文件中。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

## [0.2.0] - 2026-11-25

首个公开发布版本。

### 新增

- 框架无关的 DOM + Canvas 混合时间轴编辑器，提供开箱即用的完整体验（`timeline-kit`）。
- 轻量 `TimelineDocument`（tracks / clips）数据模型，以及双向无损的 OTIO 适配器（`timeline-kit/otio`），兼容 `Timeline.1` 与旧版 FlyCut metadata。
- 混合分层渲染与横向视口虚拟化：标尺、视频胶片缩略图、音频真实波形基于 Canvas 2D，结构与插槽基于 DOM。
- `TimelineStore` + `CommandBus`，支持内置历史栈或外部全局 Undo/Redo 接管。
- 交互能力以插件形式提供：拖拽、裁剪、播放头、滚轮锚点缩放、快捷键、框选多选、网格吸附、外部素材拖入。
- 纯逻辑内核入口（`timeline-kit/core`）与官方插件入口（`timeline-kit/plugins`）。
- React 适配（`timeline-kit/react`，Portal + `useSyncExternalStore`）与 Vue 3 适配（`timeline-kit/vue`，Teleport + 作用域插槽）。
- 构建产物：按入口拆分的 ESM 输出与类型声明（`dist/`）。

### 变更

- 库构建改为按入口分别输出 ESM 与 `dist/types/**.d.ts` 类型声明。
- 快捷键作用域限定在最近一次使用的编辑器，多个编辑器共享页面时互不干扰。
- 撤销历史改用结构共享，替代深拷贝。

### 无障碍

- 为编辑器补充 ARIA 角色与标签，并增加 live region 用于播报状态变化。

### 测试

- 扩充单元测试、适配器测试与 Chromium 端到端测试。
