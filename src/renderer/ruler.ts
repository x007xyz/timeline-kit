import { getGridSize } from '../engine/timeScale'

export interface RulerDrawOptions {
  startPx: number
  fps: number
  scale: number
  totalFrames: number
  width: number
  height: number
  ratio: number
  palette: {
    bgColor: string
    longColor: string
    shortColor: string
    textColor: string
    subTextColor: string
    focusColor: string
  }
}

function formatDurationSeconds(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(clamped / 3600)
  const minutes = Math.floor((clamped % 3600) / 60)
  const seconds = clamped % 60

  if (hours > 0) {
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
  }
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
}

function formatMajorLabel(bigIndex: number, scale: number): string {
  let seconds = bigIndex
  if (scale < 30) {
    seconds *= 60
  }
  else if (scale < 70) {
    seconds *= 10
  }
  return formatDurationSeconds(seconds)
}

function formatMinorLabel(smallIndex: number, step: number, scale: number): string {
  if (scale < 70 || scale <= 80) {
    return ''
  }
  const index = ((smallIndex % step) + step) % step
  if (index === 0) {
    return ''
  }
  return `${index < 10 ? '0' : ''}${index}f`
}

export function drawTimeRuler(
  context: CanvasRenderingContext2D,
  options: RulerDrawOptions,
): void {
  const { startPx, fps, scale, totalFrames, width, height, ratio, palette } = options
  const safeFps = fps > 0 ? fps : 24
  const step = scale >= 70 ? Math.max(1, Math.round(safeFps)) : 10
  const gridSizeS = getGridSize(scale, safeFps)
  const gridSizeB = gridSizeS * step
  const textSize = 12
  const textScale = 0.83
  const lineWidth = 0.5

  context.setTransform(ratio, 0, 0, ratio, 0, 0)
  context.clearRect(0, 0, width, height)

  context.fillStyle = palette.bgColor
  context.fillRect(0, 0, width, height)

  context.font = `${textSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`
  context.lineWidth = 1
  context.textBaseline = 'middle'
  context.textAlign = 'left'

  if (totalFrames > 0) {
    let fCount = totalFrames
    if (scale < 30) {
      fCount = fCount / safeFps / 6
    }
    else if (scale < 70) {
      fCount = fCount / safeFps
    }
    const focusStart = lineWidth - startPx
    const focusWidth = fCount * gridSizeS - lineWidth
    if (focusWidth > gridSizeS) {
      context.fillStyle = palette.focusColor
      context.fillRect(focusStart, 0, focusWidth, height * 0.375)
    }
  }

  const startValueB = Math.floor(startPx / gridSizeB) * gridSizeB
  const startValueS = Math.floor(startPx / gridSizeS) * gridSizeS
  const endValue = startPx + Math.ceil(width) + gridSizeB

  context.beginPath()
  context.fillStyle = palette.textColor
  context.strokeStyle = palette.longColor

  for (let value = startValueB; value < endValue; value += gridSizeB) {
    const x = value - startPx + lineWidth
    const bigIndex = Math.round(value / gridSizeB)
    context.moveTo(x, 0)
    context.lineTo(x, height * 0.625)

    if (bigIndex >= 0) {
      context.save()
      context.translate(x + 4, height * 0.55)
      context.scale(textScale, textScale)
      context.fillText(formatMajorLabel(bigIndex, scale), 0, 0)
      context.restore()
    }
  }
  context.stroke()

  context.beginPath()
  context.fillStyle = palette.subTextColor
  context.strokeStyle = palette.shortColor

  for (let value = startValueS; value < endValue; value += gridSizeS) {
    const smallIndex = Math.round(value / gridSizeS)
    if (smallIndex < 0) {
      continue
    }
    const x = value - startPx + lineWidth
    if (smallIndex % step !== 0) {
      context.moveTo(x, 0)
      context.lineTo(x, height * 0.34)
    }

    const minorText = formatMinorLabel(smallIndex, step, scale)
    if (minorText) {
      context.save()
      context.translate(x + 3, height * 0.55)
      context.scale(textScale, textScale)
      context.fillText(minorText, 0, 0)
      context.restore()
    }
  }
  context.stroke()

  context.setTransform(1, 0, 0, 1, 0, 0)
}
