export function createSvgIcon(paths: readonly string[], options: { color?: string, size?: number } = {}): SVGSVGElement {
  const svgNS = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(svgNS, 'svg')
  const size = options.size ?? 16
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('width', String(size))
  svg.setAttribute('height', String(size))
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', options.color ?? 'currentColor')
  svg.setAttribute('stroke-width', '2')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.classList.add('tk-lucide')
  for (const d of paths) {
    const path = document.createElementNS(svgNS, 'path')
    path.setAttribute('d', d)
    svg.appendChild(path)
  }
  return svg
}

export function createTrackTypeIcon(type: string): SVGSVGElement {
  if (type === 'audio') {
    return createSvgIcon(['M12 3v18', 'M8 8v8', 'M16 8v8', 'M4 13v-2', 'M20 13v-2'], { color: '#2f7d62' })
  }
  if (type === 'image') {
    return createSvgIcon(['M5 19h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2Z', 'm8 11-3 4h10l-4-6-3 4Z', 'M9 9h.01'], { color: '#d97706' })
  }
  if (type === 'text') {
    return createSvgIcon(['M4 7V4h16v3', 'M9 20h6', 'M12 4v16'], { color: '#a21caf' })
  }
  return createSvgIcon(['M2 7.5 12 2l10 5.5v9L12 22 2 16.5Z', 'M12 22v-9'], { color: '#475569' })
}

export function createTrackActionIcon(command: 'locked' | 'visible' | 'muted', active: boolean): SVGSVGElement {
  if (command === 'locked') {
    return active
      ? createSvgIcon(['M7 11V7a5 5 0 0 1 10 0v4', 'M5 11h14v10H5z'], { size: 14 })
      : createSvgIcon(['M8 11V7a4 4 0 1 1 8 0', 'M5 11h14v10H5z'], { size: 14 })
  }
  if (command === 'visible') {
    return active
      ? createSvgIcon(['M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z', 'M3 3l18 18'], { size: 14 })
      : createSvgIcon(['M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z', 'M12 15a3 3 0 1 1 0-6 3 3 0 0 1 0 6Z'], { size: 14 })
  }
  return active
    ? createSvgIcon(['M11 5 6 9H2v6h4l5 4V5Z', 'M22 9l-6 6', 'M16 9l6 6'], { size: 14 })
    : createSvgIcon(['M11 5 6 9H2v6h4l5 4V5Z', 'M15.5 8.5a5 5 0 0 1 0 7'], { size: 14 })
}

export function createToolbarIcon(id: string): SVGSVGElement {
  if (id === 'undo') {
    return createSvgIcon(['M9 14 4 9l5-5', 'M20 20a8 8 0 0 0-8-8H4'], { size: 16 })
  }
  if (id === 'redo') {
    return createSvgIcon(['m15 14 5-5-5-5', 'M4 20a8 8 0 0 1 8-8h8'], { size: 16 })
  }
  if (id === 'split') {
    return createSvgIcon(['M16 3h5v18h-5', 'M8 3H3v18h5', 'M12 8v8', 'M12 12h0'], { size: 16 })
  }
  if (id === 'delete') {
    return createSvgIcon(['M3 6h18', 'M8 6V4h8v2', 'M19 6l-1 14H6L5 6', 'M10 11v6', 'M14 11v6'], { size: 16 })
  }
  if (id === 'magnetSnap') {
    return createSvgIcon(['M6 15V6a2 2 0 0 1 2-2h3v5', 'M18 15V6a2 2 0 0 0-2-2h-3v5', 'M6 15a6 6 0 0 0 12 0', 'M6 15h4', 'M14 15h4'], { size: 16 })
  }
  if (id === 'fitToView') {
    return createSvgIcon(['M8 3H5a2 2 0 0 0-2 2v3', 'M16 3h3a2 2 0 0 1 2 2v3', 'M8 21H5a2 2 0 0 1-2-2v-3', 'M16 21h3a2 2 0 0 0 2-2v-3'], { size: 16 })
  }
  if (id === 'zoom-in') {
    return createSvgIcon(['M12 5v14', 'M5 12h14'], { size: 16 })
  }
  if (id === 'zoom-out') {
    return createSvgIcon(['M5 12h14'], { size: 16 })
  }
  return createSvgIcon(['M12 12h0'], { size: 16 })
}
