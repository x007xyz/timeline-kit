import {
  otioDemoTimeline,
  type EditPolicies,
  type TimelineDocument,
  type TrackConfigMap,
  type UIConfig,
} from '../src/index'
import type { ExternalDropItem } from '../src/plugins'
import type { Timeline as OtioTimeline } from '../src/otio-core'

export type ScenarioId
  = | 'full-studio'
    | 'podcast-audio'
    | 'video-filmstrip'
    | 'fancy-text-graphics'
    | 'virtualized-stress'
    | 'headless-external-history'
    | 'otio-roundtrip'

export interface ScenarioDefinition {
  id: ScenarioId
  title: string
  description: string
  document?: TimelineDocument
  otioTimeline?: OtioTimeline
  trackScale: number
  isMagnetEnabled?: boolean
  ui?: UIConfig
  history?: 'internal' | 'external'
  policies?: Partial<EditPolicies>
  enableMarquee?: boolean
  enableGridSnap?: boolean
  gridStepMs?: number
}

export interface MaterialPaletteItem extends ExternalDropItem {
  badge: string
}

export const MATERIAL_PALETTE: MaterialPaletteItem[] = [
  {
    badge: 'VIDEO',
    type: 'video',
    name: 'Flower Blooming.mp4',
    durationMs: 5056,
    resource: '/assets/flower.mp4',
  },
  {
    badge: 'AUDIO',
    type: 'audio',
    name: 'T-Rex Roar SFX.mp3',
    durationMs: 2074,
    resource: '/assets/sfx-roar.mp3',
    meta: { audioRole: 'sfx' },
  },
  {
    badge: '花字',
    type: 'text',
    name: '弹幕花字',
    durationMs: 3000,
    resource: '前方高能名场面！',
    meta: { preset: 'variety' },
  },
  {
    badge: 'IMAGE',
    type: 'image',
    name: 'Surfer Action.jpg',
    durationMs: 2500,
    resource: '/assets/photo-surfer.jpg',
    meta: { format: 'JPG' },
  },
]

function buildVirtualizedStressDocument(): TimelineDocument {
  const tracks: TimelineDocument['tracks'] = [
    { id: 'stress-text', type: 'text', name: '字幕花字轨', visible: true, clips: [] },
    { id: 'stress-video', type: 'video', name: '主视频轨', visible: true, main: true, clips: [] },
    { id: 'stress-image', type: 'image', name: '实拍照片轨', visible: true, clips: [] },
    { id: 'stress-audio', type: 'audio', name: '多段真实音轨', muted: false, clips: [] },
  ]
  const videos = [
    { name: 'Sintel', url: '/assets/sintel.mp4', dur: 14000 },
    { name: 'Rabbit', url: '/assets/rabbit.mp4', dur: 7800 },
    { name: 'Flower', url: '/assets/flower.mp4', dur: 5056 },
    { name: 'Bug', url: '/assets/bug.mp4', dur: 6766 },
  ]
  const audios = [
    { name: 'Guitar BGM', url: '/assets/bgm-guitar.mp3', dur: 22831, role: 'bgm' },
    { name: 'Sintel Dialogue', url: '/assets/sintel-dialogue.mp3', dur: 12000, role: 'voice' },
    { name: 'Viper Synth', url: '/assets/bgm-viper.mp3', dur: 40933, role: 'bgm' },
    { name: 'Rabbit Audio', url: '/assets/rabbit-audio.mp3', dur: 7778, role: 'voice' },
  ]
  const photos = [
    { name: 'Leopard.jpg', url: '/assets/photo-leopard.jpg' },
    { name: 'Balloon.jpg', url: '/assets/photo-balloon.jpg' },
    { name: 'Surfer.jpg', url: '/assets/photo-surfer.jpg' },
  ]
  const presets = ['neon', 'variety', 'gradient', 'subtitle']

  for (let i = 0; i < 32; i += 1) {
    const startMs = i * 10000
    const vid = videos[i % videos.length]
    const aud = audios[i % audios.length]
    const pho = photos[i % photos.length]
    const vidLen = Math.min(vid.dur, 4800)
    const audLen = Math.min(aud.dur, 8500)

    tracks[0].clips.push({
      id: `stress-txt-${i}`,
      type: 'text',
      name: `花字 #${i + 1}`,
      startMs: startMs + 500,
      endMs: startMs + 6500,
      resource: `真实片段 #${i + 1}`,
      meta: { preset: presets[i % presets.length] },
    })
    tracks[1].clips.push({
      id: `stress-vid-${i}`,
      type: 'video',
      name: `${vid.name} #${i + 1}`,
      startMs,
      endMs: startMs + vidLen,
      durationMs: vid.dur,
      trim: { startMs: 0, endMs: vidLen },
      resource: vid.url,
    })
    tracks[2].clips.push({
      id: `stress-img-${i}`,
      type: 'image',
      name: pho.name,
      startMs: startMs + 1500,
      endMs: startMs + 5500,
      resource: pho.url,
      meta: { format: 'JPG' },
    })
    tracks[3].clips.push({
      id: `stress-aud-${i}`,
      type: 'audio',
      name: `${aud.name} #${i + 1}`,
      startMs,
      endMs: startMs + audLen,
      durationMs: aud.dur,
      trim: { startMs: 0, endMs: audLen },
      resource: aud.url,
      meta: { audioRole: aud.role },
    })
  }

  return {
    id: 'stress-128-clips',
    name: '128 Clips Virtualization Stress',
    fps: 24,
    tracks,
  }
}

export const SCENARIOS: Record<ScenarioId, ScenarioDefinition> = {
  'full-studio': {
    id: 'full-studio',
    title: '全媒体综合剪辑',
    description: '基于 Mediabunny (WebCodecs CanvasSink + AudioBufferSink) 真实解码 MP4 胶片、MP3 波形、JPG 照片、花字与画布同步预览',
    trackScale: 50,
    enableMarquee: true,
    document: {
      id: 'studio-doc',
      name: 'Full Studio Timeline',
      fps: 24,
      tracks: [
        {
          id: 'track-fancy-text',
          type: 'text',
          name: 'T1: 花字与字幕',
          visible: true,
          clips: [
            {
              id: 'txt-neon-1',
              type: 'text',
              name: '霓虹开场',
              startMs: 500,
              endMs: 3800,
              resource: '赛博霓虹 · TIMELINE KIT',
              meta: { preset: 'neon' },
            },
            {
              id: 'txt-variety-2',
              type: 'text',
              name: '综艺花字',
              startMs: 4500,
              endMs: 8200,
              resource: '真实媒体全链路解码！',
              meta: { preset: 'variety' },
            },
            {
              id: 'txt-sub-3',
              type: 'text',
              name: '双语字幕',
              startMs: 8600,
              endMs: 12000,
              resource: 'Frame-accurate video & WebAudio editing',
              meta: { preset: 'subtitle' },
            },
          ],
        },
        {
          id: 'track-image',
          type: 'image',
          name: 'P1: 实拍图片',
          visible: true,
          clips: [
            {
              id: 'img-leopard',
              type: 'image',
              name: 'Leopard.jpg',
              startMs: 1200,
              endMs: 5200,
              resource: '/assets/photo-leopard.jpg',
              meta: { format: 'JPG' },
            },
            {
              id: 'img-balloon',
              type: 'image',
              name: 'Balloon.jpg',
              startMs: 6500,
              endMs: 10200,
              resource: '/assets/photo-balloon.jpg',
              meta: { format: 'JPG' },
            },
          ],
        },
        {
          id: 'track-main-video',
          type: 'video',
          name: 'V1: 主视频轨',
          visible: true,
          muted: false,
          main: true,
          clips: [
            {
              id: 'vid-opening',
              type: 'video',
              name: 'Sintel Short.mp4',
              startMs: 0,
              endMs: 4500,
              durationMs: 14000,
              trim: { startMs: 5000, endMs: 9500 },
              resource: '/assets/sintel.mp4',
            },
            {
              id: 'vid-cyber',
              type: 'video',
              name: 'Flower.mp4',
              startMs: 5200,
              endMs: 10200,
              durationMs: 5056,
              trim: { startMs: 0, endMs: 5000 },
              resource: '/assets/flower.mp4',
            },
          ],
        },
        {
          id: 'track-bgm',
          type: 'audio',
          name: 'A1: 背景音乐',
          muted: false,
          clips: [
            {
              id: 'aud-bgm-main',
              type: 'audio',
              name: 'Guitar Groove.mp3',
              startMs: 0,
              endMs: 11500,
              durationMs: 22831,
              trim: { startMs: 0, endMs: 11500 },
              resource: '/assets/bgm-guitar.mp3',
              meta: { audioRole: 'bgm' },
            },
          ],
        },
        {
          id: 'track-voice',
          type: 'audio',
          name: 'A2: 对白与音效',
          muted: false,
          clips: [
            {
              id: 'aud-voice-intro',
              type: 'audio',
              name: 'Sintel Dialogue.mp3',
              startMs: 800,
              endMs: 4800,
              durationMs: 12000,
              trim: { startMs: 500, endMs: 4500 },
              resource: '/assets/sintel-dialogue.mp3',
              meta: { audioRole: 'voice' },
            },
            {
              id: 'aud-sfx-hit',
              type: 'audio',
              name: 'T-Rex Roar.mp3',
              startMs: 5200,
              endMs: 7274,
              durationMs: 2074,
              trim: { startMs: 0, endMs: 2074 },
              resource: '/assets/sfx-roar.mp3',
              meta: { audioRole: 'sfx' },
            },
          ],
        },
      ],
    },
  },

  'podcast-audio': {
    id: 'podcast-audio',
    title: '多轨真实音频波形',
    description: '4 条音轨经 Mediabunny AudioBufferSink 解码真实 MP3 PCM 峰值波形 + 500ms 网格吸附',
    trackScale: 50,
    enableGridSnap: true,
    gridStepMs: 500,
    document: {
      id: 'podcast-doc',
      name: 'Podcast Multi-Track Audio',
      fps: 30,
      tracks: [
        {
          id: 'pod-host',
          type: 'audio',
          name: 'Dialogue Stem',
          main: true,
          clips: [
            {
              id: 'pod-host-1',
              type: 'audio',
              name: 'Sintel 对白 1.mp3',
              startMs: 0,
              endMs: 4500,
              durationMs: 12000,
              trim: { startMs: 0, endMs: 4500 },
              resource: '/assets/sintel-dialogue.mp3',
              meta: { audioRole: 'voice' },
            },
            {
              id: 'pod-host-2',
              type: 'audio',
              name: 'Sintel 对白 2.mp3',
              startMs: 6500,
              endMs: 11000,
              durationMs: 12000,
              trim: { startMs: 5000, endMs: 9500 },
              resource: '/assets/sintel-dialogue.mp3',
              meta: { audioRole: 'voice' },
            },
          ],
        },
        {
          id: 'pod-guest',
          type: 'audio',
          name: 'Ambient Stem',
          clips: [
            {
              id: 'pod-guest-1',
              type: 'audio',
              name: 'Rabbit 环境声.mp3',
              startMs: 3500,
              endMs: 8500,
              durationMs: 7778,
              trim: { startMs: 1000, endMs: 6000 },
              resource: '/assets/rabbit-audio.mp3',
              meta: { audioRole: 'voice' },
            },
          ],
        },
        {
          id: 'pod-bgm',
          type: 'audio',
          name: 'Synth Bed',
          clips: [
            {
              id: 'pod-bgm-1',
              type: 'audio',
              name: 'Viper Synth.mp3',
              startMs: 0,
              endMs: 12000,
              durationMs: 40933,
              trim: { startMs: 0, endMs: 12000 },
              resource: '/assets/bgm-viper.mp3',
              meta: { audioRole: 'bgm' },
            },
          ],
        },
        {
          id: 'pod-sfx',
          type: 'audio',
          name: 'SFX Hits',
          clips: [
            {
              id: 'pod-sfx-1',
              type: 'audio',
              name: 'T-Rex Roar.mp3',
              startMs: 4500,
              endMs: 6500,
              durationMs: 2074,
              trim: { startMs: 0, endMs: 2000 },
              resource: '/assets/sfx-roar.mp3',
              meta: { audioRole: 'sfx' },
            },
          ],
        },
      ],
    },
  },

  'video-filmstrip': {
    id: 'video-filmstrip',
    title: '多轨真实视频抽帧',
    description: '4 个真实 MP4 视频经 Mediabunny CanvasSink 按裁剪区间稀疏抽取 WebCodecs 帧绘制胶片条',
    trackScale: 50,
    document: {
      id: 'filmstrip-doc',
      name: 'Multi-Camera Filmstrip',
      fps: 24,
      tracks: [
        {
          id: 'cam-b-roll',
          type: 'video',
          name: 'B-Roll 叠加',
          visible: true,
          clips: [
            {
              id: 'broll-flower',
              type: 'video',
              name: 'Flower.mp4',
              startMs: 2000,
              endMs: 6500,
              durationMs: 5056,
              trim: { startMs: 200, endMs: 4700 },
              resource: '/assets/flower.mp4',
            },
            {
              id: 'broll-bug',
              type: 'video',
              name: 'Bug Video.mp4',
              startMs: 7500,
              endMs: 11500,
              durationMs: 6766,
              trim: { startMs: 1000, endMs: 5000 },
              resource: '/assets/bug.mp4',
            },
          ],
        },
        {
          id: 'cam-a-roll',
          type: 'video',
          name: 'A-Roll 主机位',
          visible: true,
          main: true,
          clips: [
            {
              id: 'aroll-sintel',
              type: 'video',
              name: 'Sintel Short.mp4',
              startMs: 0,
              endMs: 5500,
              durationMs: 14000,
              trim: { startMs: 0, endMs: 5500 },
              resource: '/assets/sintel.mp4',
            },
            {
              id: 'aroll-rabbit',
              type: 'video',
              name: 'Rabbit.mp4',
              startMs: 5500,
              endMs: 11000,
              durationMs: 7800,
              trim: { startMs: 500, endMs: 6000 },
              resource: '/assets/rabbit.mp4',
            },
          ],
        },
      ],
    },
  },

  'fancy-text-graphics': {
    id: 'fancy-text-graphics',
    title: '花字 / 照片 / 框选',
    description: '霓虹、综艺、渐变、字幕四种花字 + 实拍 JPG 照片 + 空白处拖拽框选多选（自动跳过锁定轨）',
    trackScale: 50,
    enableMarquee: true,
    policies: { allowOverlap: false },
    document: {
      id: 'graphics-doc',
      name: 'Fancy Text & Photos',
      fps: 24,
      tracks: [
        {
          id: 'gfx-text-1',
          type: 'text',
          name: '花字轨 1',
          visible: true,
          clips: [
            {
              id: 'gfx-neon',
              type: 'text',
              name: '霓虹标题',
              startMs: 400,
              endMs: 3600,
              resource: '赛博之夜 2026',
              meta: { preset: 'neon' },
            },
            {
              id: 'gfx-gradient',
              type: 'text',
              name: '渐变金字',
              startMs: 4200,
              endMs: 7600,
              resource: 'GOLDEN MOMENT',
              meta: { preset: 'gradient' },
            },
          ],
        },
        {
          id: 'gfx-text-2',
          type: 'text',
          name: '花字轨 2',
          visible: true,
          clips: [
            {
              id: 'gfx-variety',
              type: 'text',
              name: '综艺大字',
              startMs: 1800,
              endMs: 5400,
              resource: '笑不活了！！',
              meta: { preset: 'variety' },
            },
            {
              id: 'gfx-sub',
              type: 'text',
              name: '底栏字幕',
              startMs: 6000,
              endMs: 10000,
              resource: '按住空白处拖动可框选多个片段',
              meta: { preset: 'subtitle' },
            },
          ],
        },
        {
          id: 'gfx-locked',
          type: 'image',
          name: '角标轨(已锁定)',
          locked: true,
          visible: true,
          clips: [
            {
              id: 'gfx-logo-locked',
              type: 'image',
              name: 'Surfer.jpg',
              startMs: 0,
              endMs: 10000,
              resource: '/assets/photo-surfer.jpg',
              meta: { format: 'JPG' },
            },
          ],
        },
      ],
    },
  },

  'virtualized-stress': {
    id: 'virtualized-stress',
    title: '128 片段虚拟化压测',
    description: '4 轨 128 个真实媒体片段总时长 320s，验证横向视口虚拟挂载与滚动卸载生命周期',
    trackScale: 50,
    document: buildVirtualizedStressDocument(),
  },

  'headless-external-history': {
    id: 'headless-external-history',
    title: '无头外壳 + 外部历史栈',
    description: '关闭内置工具栏（ui.toolbar=false），通过 onBeforeCommand 将操作接入宿主全局撤销栈',
    trackScale: 50,
    ui: { toolbar: false, sidebar: true, ruler: true },
    history: 'external',
    document: {
      id: 'headless-doc',
      name: 'Headless External History',
      fps: 24,
      tracks: [
        {
          id: 'hl-video',
          type: 'video',
          name: 'Video',
          main: true,
          clips: [
            {
              id: 'hl-v1',
              type: 'video',
              name: 'Sintel.mp4',
              startMs: 0,
              endMs: 4000,
              durationMs: 14000,
              trim: { startMs: 0, endMs: 4000 },
              resource: '/assets/sintel.mp4',
            },
            {
              id: 'hl-v2',
              type: 'video',
              name: 'Flower.mp4',
              startMs: 4500,
              endMs: 8500,
              durationMs: 5056,
              trim: { startMs: 500, endMs: 4500 },
              resource: '/assets/flower.mp4',
            },
          ],
        },
        {
          id: 'hl-text',
          type: 'text',
          name: 'Text',
          clips: [
            {
              id: 'hl-t1',
              type: 'text',
              name: '外部命令栏控制',
              startMs: 1000,
              endMs: 6000,
              resource: '由外部应用控制栏执行 Split / Undo / Redo',
              meta: { preset: 'gradient' },
            },
          ],
        },
      ],
    },
  },

  'otio-roundtrip': {
    id: 'otio-roundtrip',
    title: 'OTIO 双向导入导出',
    description: '直接使用 OpenTimelineIO Schema 初始化，编辑后实时导出标准 Timeline.1 JSON',
    trackScale: 50,
    otioTimeline: otioDemoTimeline,
  },
}

export function createScenarioTrackConfigs(
  fancySlot: TrackConfigMap['text']['clip'],
  imageSlot: TrackConfigMap['image']['clip'],
): TrackConfigMap {
  return {
    video: { type: 'video', height: 68 },
    audio: { type: 'audio', height: 56 },
    image: { type: 'image', height: 64, clip: imageSlot },
    text: { type: 'text', height: 52, clip: fancySlot },
  }
}

export function countDocumentClips(doc: TimelineDocument): number {
  return doc.tracks.reduce((sum, track) => sum + track.clips.length, 0)
}
