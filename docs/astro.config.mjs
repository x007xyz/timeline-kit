import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@astrojs/react'
import starlight from '@astrojs/starlight'
import vue from '@astrojs/vue'
import { defineConfig } from 'astro/config'

const docsDir = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(docsDir, '..')

export default defineConfig({
  integrations: [
    starlight({
      title: 'timeline-kit',
      description: '框架无关、插件驱动的 DOM + Canvas 时间轴编辑器组件库',
      defaultLocale: 'root',
      locales: {
        root: {
          label: '简体中文',
          lang: 'zh-CN',
        },
      },
      customCss: ['./src/styles/custom.css'],
      sidebar: [
        {
          label: '指南',
          items: [
            { label: '快速开始', slug: 'guide/getting-started' },
            { label: '数据模型与 OTIO 适配', slug: 'guide/data-model-and-otio' },
            { label: '媒体可视化（缩略图与波形）', slug: 'guide/media-visualization' },
            { label: '自定义插槽与花字/图片', slug: 'guide/custom-slots' },
            { label: '编辑策略与外部历史栈', slug: 'guide/policies-and-history' },
            { label: '主题定制、无头模式与虚拟化', slug: 'guide/theming-and-headless' },
          ],
        },
        {
          label: '插件与交互扩展',
          items: [
            { label: '交互管线与插件架构', slug: 'plugins/architecture' },
            { label: '内置与官方插件', slug: 'plugins/builtin-plugins' },
            { label: '编写自定义插件', slug: 'plugins/writing-a-plugin' },
          ],
        },
        {
          label: '多框架集成',
          items: [
            { label: '原生 JS / TypeScript', slug: 'frameworks/vanilla' },
            { label: 'React 集成 (Portal + Hooks)', slug: 'frameworks/react' },
            { label: 'Vue 3 集成 (Teleport + Composables)', slug: 'frameworks/vue' },
          ],
        },
        {
          label: '场景示例集',
          items: [
            { label: '完整工作台（简易画板）', slug: 'examples/studio' },
            { label: '7 大交互场景演示', slug: 'examples/scenarios' },
          ],
        },
        {
          label: 'API 参考',
          items: [
            { label: 'Editor 控制器与选项', slug: 'api/editor' },
            { label: 'Model 与 OTIO 适配器', slug: 'api/model-and-otio' },
            { label: 'Engine、Store 与 Plugins', slug: 'api/engine-store-plugins' },
            { label: 'Renderer 与多框架桥接', slug: 'api/renderer-and-frameworks' },
          ],
        },
      ],
    }),
    react(),
    vue(),
  ],
  vite: {
    plugins: [
      {
        name: 'timeline-kit-resolve-docs-deps',
        resolveId(source, importer, options) {
          if (
            importer
            && !importer.startsWith(docsDir)
            && importer.startsWith(rootDir)
            && (
              source === 'vue'
              || source === 'react'
              || source === 'react-dom'
              || source === 'mediabunny'
              || source.startsWith('react/')
              || source.startsWith('react-dom/')
              || source.startsWith('vue/')
            )
          ) {
            return this.resolve(source, path.join(docsDir, 'package.json'), {
              ...options,
              skipSelf: true,
            })
          }
          return null
        },
      },
    ],
    server: {
      fs: {
        allow: [rootDir],
      },
    },
    resolve: {
      dedupe: ['vue', 'react', 'react-dom'],
      alias: [
        { find: '@flycut/timeline-kit/core', replacement: path.resolve(rootDir, 'src/core-entry.ts') },
        { find: '@flycut/timeline-kit/otio', replacement: path.resolve(rootDir, 'src/otio-entry.ts') },
        { find: '@flycut/timeline-kit/plugins', replacement: path.resolve(rootDir, 'src/plugins-entry.ts') },
        { find: '@flycut/timeline-kit/react', replacement: path.resolve(rootDir, 'adapters/react/index.ts') },
        { find: '@flycut/timeline-kit/vue', replacement: path.resolve(rootDir, 'adapters/vue/index.ts') },
        { find: '@flycut/timeline-kit', replacement: path.resolve(rootDir, 'src/index.ts') },
        { find: '@demo', replacement: path.resolve(rootDir, 'demo') },
      ],
    },
  },
})
