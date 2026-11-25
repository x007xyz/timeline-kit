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

- 库构建改为按入口分别输出 ESM 与 `dist/types/**.d.ts` 类型声明；类型声明中的相对路径带显式扩展名，`moduleResolution` 为 `bundler`、`node16`、`nodenext` 时均可解析。
- 快捷键作用域限定在最近一次使用的编辑器，多个编辑器共享页面时互不干扰。
- 撤销历史改用结构共享（新增导出 `shareStructure`）：历史栈保存文档引用，未变化的轨道与片段在版本间复用，不再每步深拷贝整份文档。
- `getTrimOffset` 的参数类型由 `any` 改为 `unknown`（对调用方兼容）。

### 修复

- Vue 适配层：挂载后才传入的 `onBeforeCommand` 钩子此前不会被调用。
- OTIO 导出：此前逐段把间隔与时长取整到帧，误差会沿轨道累积（59.94 fps 下 40 个片段约偏 3.6 帧）；现在按绝对帧边界取整，单个边界误差不超过半帧。导入时如 `timelineKit` 元数据中的精确毫秒仍与 OTIO 位置一致，则无损还原。
- OTIO 导入：缺少 `source_range` 的 `Clip.1` 此前会抛出 TypeError；现按 OTIO 语义回退到媒体的 `available_range`。
- OTIO 往返：没有裁剪信息的视频/音频片段此前导入后会凭空多出 `trim`；现在仅对外部 OTIO 才由 `source_range` 推导裁剪。
- 拖拽片段后松手回到原位，此前仍会记录一条无变化的撤销记录。

### 无障碍

- 根节点 `role="application"`，可通过 `ui.ariaLabel` 自定义名称（默认 "Timeline"）。
- 轨道为带状态说明的 `group` / `listbox`，片段为带时间范围标签的 `option` 并同步 `aria-selected`。
- 播放头为可聚焦的 `slider`（`aria-valuenow` / `aria-valuetext`）；轨道与磁吸开关提供 `aria-pressed`；装饰性 Canvas 设为 `aria-hidden`。
- `:focus-visible` 焦点样式；`aria-live="polite"` 区域播报选择变化。

### 许可证

- 双许可：以 [AGPL-3.0-only](./LICENSE) 开源；不能或不想按 AGPL 开源自身应用的用户，可联系 x007xyzabc@gmail.com 取得商业授权。

### 工程

- 引入 ESLint（typescript-eslint）与 GitHub Actions CI（lint、类型检查、单元测试、构建、打包检查、E2E）。
- 开启 `noUnusedLocals` / `noUnusedParameters`；React / Vue 适配层改用真实类型做类型检查。
- `docs/public/assets` 改为由 `demo/assets` 同步生成，不再重复纳入版本管理。

### 测试

- 单元测试由 17 个增至 175 个：覆盖磁吸/放置引擎、全部交互插件、`getTrimOffset`、OTIO 边界情况（非整数帧率、缺字段、Gap）、结构共享与历史栈，以及 React / Vue 适配层行为（happy-dom）。
- E2E 测试由 18 个增至 27 个：新增无障碍属性与多实例快捷键用例。

### 已知限制

- 无障碍标签目前为英文，而工具栏按钮的提示文字为中文，读屏输出会混合两种语言；后续版本计划提供本地化配置。
