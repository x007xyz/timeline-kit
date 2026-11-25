import { useEffect, useRef, useState } from 'react'
import { demoDocument, type ClipRenderContext } from 'timeline-kit'
import {
  TimelineEditor,
  useTimelineSelector,
  type TimelineEditorRef,
} from 'timeline-kit/react'
import { createShowcaseMediaProvider } from '@demo/mediaShowcase'
import { createTimelinePreviewPlayer } from '@demo/previewPlayer'

const showcaseMediaProvider = createShowcaseMediaProvider()

export default function ReactTimelineDemo() {
  const editorRef = useRef<TimelineEditorRef | null>(null)
  const previewHostRef = useRef<HTMLDivElement | null>(null)
  const [editorInstance, setEditorInstance] = useState<ReturnType<TimelineEditorRef['getEditor']>>(null)
  const [accent, setAccent] = useState<'#2563eb' | '#7c3aed'>('#2563eb')

  const currentFrame = useTimelineSelector(editorInstance, s => s.currentFrame) ?? 0
  const selectedId = useTimelineSelector(editorInstance, s => s.selection.clipId) ?? 'none'

  useEffect(() => {
    const host = previewHostRef.current
    if (!editorInstance || !host) {
      return
    }
    const handle = createTimelinePreviewPlayer(host, editorInstance)
    return () => handle.destroy()
  }, [editorInstance])

  return (
    <div className="tk-framework-demo not-content">
      <div className="tk-framework-demo-bar">
        <span>
          <strong>React 19 Island</strong> · frame {currentFrame} · selected {selectedId}
        </span>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            className="tk-doc-btn"
            onClick={() => setAccent(prev => (prev === '#2563eb' ? '#7c3aed' : '#2563eb'))}
          >
            切换 Portal 插槽主题色
          </button>
          <button
            type="button"
            className="tk-doc-btn"
            onClick={() => editorRef.current?.fitToView()}
          >
            适应窗口
          </button>
        </div>
      </div>

      <div className="tk-doc-preview-host" ref={previewHostRef} />

      <div style={{ height: '320px' }}>
        <TimelineEditor
          ref={editorRef}
          document={demoDocument}
          theme="dark"
          mediaProvider={showcaseMediaProvider}
          onReady={setEditorInstance}
          renderClip={(ctx: ClipRenderContext) => (
            <div
              className="tk-framework-clip-slot"
              style={{
                background: ctx.isSelected
                  ? `linear-gradient(135deg, ${accent}, #0f172a)`
                  : 'linear-gradient(135deg, #1e293b, #0f172a)',
              }}
            >
              <span style={{ fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                [JSX] {ctx.clip.name}
              </span>
              <span style={{ fontSize: '10px', opacity: 0.78 }}>
                {ctx.clip.type} · {ctx.clip.startMs}–{ctx.clip.endMs}ms
              </span>
            </div>
          )}
        />
      </div>
    </div>
  )
}
