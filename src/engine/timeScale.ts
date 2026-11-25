const SCALE_STOPS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100] as const

function getStopPixelsPerSecond(stopIndex: number, fps: number): number {
  const safeFps = fps > 0 ? fps : 24
  switch (stopIndex) {
    case 0: return 10 / 6
    case 1: return 25 / 6
    case 2: return 40 / 6
    case 3: return 10
    case 4: return 20
    case 5: return 40
    case 6: return 80
    case 7: return 10 * safeFps
    case 8: return 20 * safeFps
    case 9: return 50 * safeFps
    case 10: return 100 * safeFps
    default: return 40
  }
}

export function clampTrackScale(scale: number): number {
  if (!Number.isFinite(scale)) {
    return 50
  }
  return Math.max(0, Math.min(100, scale))
}

export function getPixelsPerSecond(scale: number, fps: number = 24): number {
  const clamped = clampTrackScale(scale)
  const exactIndex = clamped / 10
  const lowIndex = Math.floor(exactIndex)
  const highIndex = Math.min(SCALE_STOPS.length - 1, Math.ceil(exactIndex))

  if (lowIndex === highIndex) {
    return getStopPixelsPerSecond(lowIndex, fps)
  }

  const ratio = exactIndex - lowIndex
  const lowPps = getStopPixelsPerSecond(lowIndex, fps)
  const highPps = getStopPixelsPerSecond(highIndex, fps)
  return lowPps + (highPps - lowPps) * ratio
}

export function getGridSize(scale: number, fps: number = 24): number {
  const clamped = clampTrackScale(scale)
  const safeFps = fps > 0 ? fps : 24
  const pps = getPixelsPerSecond(clamped, safeFps)

  if (clamped < 30) {
    return pps * 6
  }
  if (clamped < 70) {
    return pps
  }
  return pps / safeFps
}

export function getFramePixel(scale: number, fps: number = 24): number {
  const safeFps = fps > 0 ? fps : 24
  return getPixelsPerSecond(scale, safeFps) / safeFps
}

export function msToPx(ms: number, pixelsPerSecond: number): number {
  return (ms / 1000) * pixelsPerSecond
}

export function pxToMs(px: number, pixelsPerSecond: number): number {
  if (pixelsPerSecond <= 0) {
    return 0
  }
  return (px / pixelsPerSecond) * 1000
}

export function frameToSeconds(frame: number, fps: number): number {
  return fps <= 0 ? 0 : frame / fps
}

export function secondsToFrame(seconds: number, fps: number): number {
  return fps <= 0 ? 0 : Math.round(seconds * fps)
}

export function msToFrame(ms: number, fps: number): number {
  return fps <= 0 ? 0 : Math.round((ms / 1000) * fps)
}

export function frameToMs(frame: number, fps: number): number {
  return fps <= 0 ? 0 : (frame / fps) * 1000
}

export function pxToFrame(px: number, scale: number, fps: number): number {
  const framePixel = getFramePixel(scale, fps)
  if (framePixel <= 0) {
    return 0
  }
  return Math.round(px / framePixel)
}

export function scaleToPixelsPerSecond(scale: number, fps: number = 30): number {
  return getPixelsPerSecond(scale, fps)
}
