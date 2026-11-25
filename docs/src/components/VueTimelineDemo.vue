<script setup lang="ts">
import { onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { demoDocument, type TimelineEditor as VanillaTimelineEditor } from 'timeline-kit'
import { TimelineEditor, useTimelineSelector } from 'timeline-kit/vue'
import { createShowcaseMediaProvider } from '@demo/mediaShowcase'
import { createTimelinePreviewPlayer, type TimelinePreviewPlayerHandle } from '@demo/previewPlayer'

const showcaseMediaProvider = createShowcaseMediaProvider()

const editorCompRef = ref<{ fitToView: () => number | null } | null>(null)
const previewHostRef = ref<HTMLElement | null>(null)
const editorInstance = shallowRef<VanillaTimelineEditor | null>(null)
const badgePrefix = ref('Vue Slot')

const currentFrame = useTimelineSelector(editorInstance, s => s.currentFrame)
const selectedId = useTimelineSelector(editorInstance, s => s.selection.clipId)

let previewHandle: TimelinePreviewPlayerHandle | null = null

watch(
  [previewHostRef, editorInstance],
  ([host, ed]) => {
    previewHandle?.destroy()
    previewHandle = null
    if (host && ed) {
      previewHandle = createTimelinePreviewPlayer(host, ed)
    }
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  previewHandle?.destroy()
  previewHandle = null
})

function onReady(editor: VanillaTimelineEditor) {
  editorInstance.value = editor
}

function toggleLabel() {
  badgePrefix.value = badgePrefix.value === 'Vue Slot' ? 'Teleported' : 'Vue Slot'
}
</script>

<template>
  <div class="tk-framework-demo not-content">
    <div class="tk-framework-demo-bar">
      <span>
        <strong>Vue 3 Island</strong> · frame {{ currentFrame ?? 0 }} · selected {{ selectedId ?? 'none' }}
      </span>
      <div style="display: flex; gap: 8px;">
        <button type="button" class="tk-doc-btn" @click="toggleLabel">
          切换 Teleport 插槽标签
        </button>
        <button type="button" class="tk-doc-btn" @click="editorCompRef?.fitToView()">
          适应窗口
        </button>
      </div>
    </div>

    <div ref="previewHostRef" class="tk-doc-preview-host" />

    <div style="height: 320px;">
      <TimelineEditor
        ref="editorCompRef"
        :document="demoDocument"
        theme="dark"
        :media-provider="showcaseMediaProvider"
        @ready="onReady"
      >
        <template #clip="{ clip, isSelected }">
          <div
            class="tk-framework-clip-slot"
            :style="{
              background: isSelected
                ? 'linear-gradient(135deg, #059669, #0f172a)'
                : 'linear-gradient(135deg, #1e293b, #0f172a)',
            }"
          >
            <span style="font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
              [{{ badgePrefix }}] {{ clip.name }}
            </span>
            <span style="font-size: 10px; opacity: 0.78;">
              {{ clip.type }} · {{ clip.startMs }}–{{ clip.endMs }}ms
            </span>
          </div>
        </template>
      </TimelineEditor>
    </div>
  </div>
</template>
