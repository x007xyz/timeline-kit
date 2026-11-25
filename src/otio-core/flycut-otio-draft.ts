import type { RationalTime, TimeRange } from "./types";

/**
 * OTIO-centered schema draft types derived from docs/design-docs/editor-domain-model.md.
 *
 * These types are intentionally additive:
 * - they do not replace the current runtime schema
 * - they provide a concrete TypeScript landing zone for the OTIO-centered model
 * - they can be imported gradually while the rest of the codebase still uses legacy metadata shapes
 */

export type ProjectId = string;
export type AssetId = string;
export type TimelineId = string;
export type TrackId = string;
export type ClipId = string;
export type TransitionId = string;
export type EffectId = string;
export type KeyframeTrackId = string;

export type FlycutTimebaseDraft = "frames" | "seconds";
export type FlycutPreviewScaleModeDraft = "fit" | "fill" | "stretch";
export type FlycutTrackRoleDraft = "main" | "overlay" | "title" | "caption" | "bgm" | "sfx" | "voiceover";
export type FlycutAssetTypeDraft = "video" | "audio" | "image" | "gif" | "svg" | "text";
export type FlycutAnchorDraft = "center" | "top-left" | "top-right" | "bottom-left" | "bottom-right";
export type FlycutFitModeDraft = "fill" | "fit" | "stretch" | "none";
export type FlycutBlendModeDraft = "normal" | "multiply" | "screen" | "overlay" | "darken" | "lighten";
export type FlycutKeyframeEasingDraft = "linear" | "ease-in" | "ease-out" | "ease-in-out" | "bezier";

export interface FlycutProjectSettingsDraft {
  fps: number;
  sampleRate: number;
  timebase: FlycutTimebaseDraft;
  dropFrame?: boolean;
  canvasWidth: number;
  canvasHeight: number;
  aspectRatio: string;
  background?: string;
  previewScaleMode?: FlycutPreviewScaleModeDraft;
  defaultTransitionDurationFrames?: number;
}

export interface FlycutTimelineMetadataDraft {
  project: FlycutProjectSettingsDraft;
}

export interface FlycutTrackMetadataDraft {
  role?: FlycutTrackRoleDraft;
  main?: boolean;
  locked?: boolean;
  hidden?: boolean;
  muted?: boolean;
}

export interface FlycutCropDraft {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FlycutClipVisualDraft {
  anchor?: FlycutAnchorDraft;
  x: number;
  y: number;
  width?: number;
  height?: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  opacity: number;
  blendMode?: FlycutBlendModeDraft;
  fit?: FlycutFitModeDraft;
  crop?: FlycutCropDraft;
}

export interface FlycutKeyframeDraft<T = unknown> {
  time: RationalTime;
  value: T;
  easing?: FlycutKeyframeEasingDraft;
}

export interface FlycutClipAnimationTrackDraft<T = unknown> {
  id: KeyframeTrackId;
  property: string;
  keyframes: Array<FlycutKeyframeDraft<T>>;
}

export interface FlycutClipAnimationDraft {
  tracks: Array<FlycutClipAnimationTrackDraft>;
}

export interface FlycutClipAudioDraft {
  gain?: number;
  muted?: boolean;
  fadeInSec?: number;
  fadeOutSec?: number;
}

export interface FlycutVisualEffectDraft {
  id: EffectId;
  type: string;
  enabled: boolean;
  params: Record<string, unknown>;
}

export interface FlycutTextStyleDraft {
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number | string;
  fill?: string;
  align?: "left" | "center" | "right" | "justify";
  lineHeight?: number;
  stroke?: string;
  strokeWidth?: number;
  background?: string;
}

export interface FlycutClipMetadataDraft {
  assetType?: FlycutAssetTypeDraft;
  role?: FlycutTrackRoleDraft;
  visual?: FlycutClipVisualDraft;
  animation?: FlycutClipAnimationDraft;
  audio?: FlycutClipAudioDraft;
  visualEffects?: Array<FlycutVisualEffectDraft>;
  textStyle?: FlycutTextStyleDraft;
}

export interface FlycutTimelineMetadataContainerDraft {
  flycut: FlycutTimelineMetadataDraft;
}

export interface FlycutTrackMetadataContainerDraft {
  flycut: FlycutTrackMetadataDraft;
}

export interface FlycutClipMetadataContainerDraft {
  flycut: FlycutClipMetadataDraft;
}

export interface FlycutPointDraft {
  OTIO_SCHEMA: "V2d.1";
  x: number;
  y: number;
}

export interface FlycutBoundsDraft {
  OTIO_SCHEMA: "Box2d.1";
  min: FlycutPointDraft;
  max: FlycutPointDraft;
}

export interface FlycutExternalReferenceDraft {
  OTIO_SCHEMA: "ExternalReference.1";
  target_url: string;
  available_range?: TimeRange;
  available_image_bounds?: FlycutBoundsDraft;
  metadata?: Record<string, unknown>;
}

export interface FlycutGeneratorReferenceDraft {
  OTIO_SCHEMA: "GeneratorReference.1";
  generator_kind: string;
  parameters: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface FlycutMissingReferenceDraft {
  OTIO_SCHEMA: "MissingReference.1";
  metadata?: Record<string, unknown>;
}

export type FlycutMediaReferenceDraft =
  | FlycutExternalReferenceDraft
  | FlycutGeneratorReferenceDraft
  | FlycutMissingReferenceDraft;

export interface FlycutEffectDraft {
  OTIO_SCHEMA: "Effect.1";
  name: string;
  effect_name: string;
  metadata?: Record<string, unknown>;
}

export interface FlycutClipDraft {
  OTIO_SCHEMA: "Clip.1";
  id: ClipId;
  name: string;
  source_range: TimeRange;
  media_reference: FlycutMediaReferenceDraft;
  effects?: FlycutEffectDraft[];
  metadata?: Record<string, unknown>;
}

export interface FlycutGapDraft {
  OTIO_SCHEMA: "Gap.1";
  source_range: TimeRange;
  metadata?: Record<string, unknown>;
}

export interface FlycutTransitionDraft {
  OTIO_SCHEMA: "Transition.1";
  id: TransitionId;
  name: string;
  transition_type: string;
  in_offset: RationalTime;
  out_offset: RationalTime;
  metadata?: Record<string, unknown>;
}

export type FlycutTrackItemDraft = FlycutClipDraft | FlycutGapDraft | FlycutTransitionDraft;

export interface FlycutTrackDraft {
  OTIO_SCHEMA: "Track.1";
  id: TrackId;
  name: string;
  kind: "Video" | "Audio";
  metadata?: Record<string, unknown>;
  children: FlycutTrackItemDraft[];
}

export interface FlycutStackDraft {
  OTIO_SCHEMA: "Stack.1";
  children: FlycutTrackDraft[];
}

export interface FlycutTimelineDraft {
  OTIO_SCHEMA: "Timeline.1";
  id: TimelineId;
  name: string;
  metadata?: Record<string, unknown>;
  tracks: FlycutStackDraft;
}

export interface FlycutResolvedFrameNodeDraft {
  clipId: ClipId;
  assetId?: AssetId;
  type: string;
  visible: boolean;
  opacity: number;
  transform: {
    x: number;
    y: number;
    scaleX: number;
    scaleY: number;
    rotation: number;
  };
  width?: number;
  height?: number;
  crop?: FlycutCropDraft;
  blendMode?: FlycutBlendModeDraft;
  content?: Record<string, unknown>;
  effects: Array<{
    id: EffectId;
    type: string;
    params: Record<string, unknown>;
  }>;
}

export interface FlycutResolvedAudioNodeDraft {
  clipId: ClipId;
  assetId?: AssetId;
  gain: number;
  muted: boolean;
  playbackRate: number;
}

export interface FlycutResolvedFrameSceneDraft {
  time: number;
  canvas: {
    width: number;
    height: number;
    background?: string;
  };
  nodes: Array<FlycutResolvedFrameNodeDraft>;
  audio: Array<FlycutResolvedAudioNodeDraft>;
}
