import type { TimelineDocument } from './types'

export const DEMO_FPS = 24

export const demoDocument: TimelineDocument = {
  id: 'timeline-kit-demo',
  name: 'Timeline Kit Demo',
  fps: DEMO_FPS,
  meta: {
    demo: true,
  },
  tracks: [
    {
      id: 'track-v2',
      name: 'V2: Text',
      type: 'text',
      visible: true,
      clips: [
        {
          id: 'clip-v2-title',
          type: 'text',
          name: 'Ending Title',
          startMs: 5000,
          endMs: 10000,
          resource: 'The End',
          meta: {
            color: '#FFFFFF',
          },
        },
      ],
    },
    {
      id: 'track-v1',
      name: 'V1: Main Video',
      type: 'video',
      visible: true,
      muted: false,
      main: true,
      clips: [
        {
          id: 'clip-v1-open',
          type: 'video',
          name: 'Sintel Short',
          startMs: 0,
          endMs: 4000,
          resource: '/assets/sintel.mp4',
          durationMs: 10000,
          trim: {
            startMs: 2000,
            endMs: 6000,
          },
        },
      ],
    },
    {
      id: 'track-v0',
      name: 'V0: Image',
      type: 'image',
      visible: true,
      clips: [
        {
          id: 'clip-v0-photo',
          type: 'image',
          name: 'Leopard Photo',
          startMs: 5000,
          endMs: 10000,
          resource: '/assets/photo-leopard.jpg',
        },
      ],
    },
    {
      id: 'track-a1',
      name: 'A1: Music',
      type: 'audio',
      muted: false,
      clips: [
        {
          id: 'clip-a1-bgm',
          type: 'audio',
          name: 'Guitar Groove',
          startMs: 0,
          endMs: 10000,
          resource: '/assets/bgm-guitar.mp3',
          durationMs: 22831,
          trim: {
            startMs: 0,
            endMs: 10000,
          },
        },
      ],
    },
  ],
}
