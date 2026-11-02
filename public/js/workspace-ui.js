// Presentation helpers shared by the workspace. No requests or account state.
const ICON_SPRITE_URL = '/icons.svg?v=20261102-workspace'
export function createUiIcon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('class', 'ui-icon')
  svg.setAttribute('aria-hidden', 'true')
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use')
  use.setAttribute('href', `${ICON_SPRITE_URL}#${name}`)
  svg.append(use)
  return svg
}

export function filterProjects(projects, query = '') {
  const normalize = (value) => String(value || '').normalize('NFKC').toLocaleLowerCase()
  const words = normalize(query).trim().split(/\s+/).filter(Boolean)
  return projects.filter((project) => words.every((word) => normalize(project.title).includes(word)))
}

// A tab only replaces a section it is editing or has actually changed.
// Other sections may have newer drafts/results written by another tab.
export function mergeWorkspaceSections(snapshot, cached, signatures, activeSection) {
  const merged = { ...snapshot }
  for (const section of ['generate', 'translate', 'outfit', 'style', 'aiTest']) {
    if (!Object.hasOwn(snapshot, section)) continue
    const signature = JSON.stringify(snapshot[section])
    const changed = signatures[section] !== undefined && signatures[section] !== signature
    if (section !== activeSection && !changed && cached?.[section]) merged[section] = cached[section]
    signatures[section] = signature
  }
  return merged
}

export function getCanvasFit(elements, width, height, compact = false) {
  const visible = elements.filter((el) => el.type !== 'connector'
    && [el.x, el.y, el.width, el.height].every(Number.isFinite)
    && el.width > 0 && el.height > 0)
  if (!visible.length || width <= 0 || height <= 0) return null
  const left = Math.min(...visible.map((el) => el.x))
  const top = Math.min(...visible.map((el) => el.y))
  const right = Math.max(...visible.map((el) => el.x + el.width))
  const bottom = Math.max(...visible.map((el) => el.y + el.height))
  const insetX = compact ? 24 : 96
  const insetY = compact ? 96 : 64
  const scale = Math.max(.1, Math.min(1, (width - insetX * 2) / (right - left), (height - insetY * 2) / (bottom - top)))
  return { scale, panX: (width - (right - left) * scale) / 2 - left * scale, panY: (height - (bottom - top) * scale) / 2 - top * scale }
}
