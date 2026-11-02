import { gptImageSizeError, gptImageSizeIsExperimental, suggestGptImageSize } from './image-model-constraints.js'

// Edits are a draft until Apply. Cancel/Escape never changes the chosen size.
export function createImageSizeDialog(dialog, { onApply, onClose }) {
  const field = name => dialog.querySelector(`[data-size-${name}]`)
  const width = field('width'), height = field('height'), lock = field('lock')
  const error = field('error'), suggestion = field('suggestion'), apply = field('apply')
  let ratio = 1, recommended = ''
  const size = () => `${width.value}x${height.value}`
  function refresh() {
    const issue = gptImageSizeError(size())
    error.textContent = issue || (gptImageSizeIsExperimental(size()) ? '实验尺寸 · 生成可能需要更长时间。' : '尺寸符合模型规则。')
    error.dataset.invalid = String(Boolean(issue))
    apply.disabled = Boolean(issue)
    recommended = issue ? suggestGptImageSize(width.value, height.value) : ''
    suggestion.hidden = !recommended
    suggestion.textContent = recommended ? `采用建议 ${recommended.replace('x', ' × ')}` : ''
    const preview = field('preview')
    const previewRatio = Math.max(.1, Number(width.value) / Number(height.value) || 1)
    preview.style.width = `${Math.min(44, 48 * previewRatio)}px`
    preview.style.height = `${Math.min(48, 44 / previewRatio)}px`
    field('pixels').textContent = `${width.value || '—'} × ${height.value || '—'} px`
  }
  for (const input of [width, height]) input.addEventListener('input', () => {
    if (lock.checked && Number(input.value) > 0) {
      const other = input === width ? height : width
      other.value = String(Math.max(16, Math.round(Number(input.value) * (input === width ? 1 / ratio : ratio) / 16) * 16))
    }
    refresh()
  })
  lock.addEventListener('change', () => { ratio = Number(width.value) / Number(height.value) || 1 })
  field('swap').addEventListener('click', () => { const w = width.value; width.value = height.value; height.value = w; ratio = 1 / ratio; refresh() })
  suggestion.addEventListener('click', () => { [width.value, height.value] = recommended.split('x'); ratio = Number(width.value) / Number(height.value); refresh() })
  field('cancel').addEventListener('click', () => dialog.close())
  dialog.querySelector('form').addEventListener('submit', event => {
    event.preventDefault()
    if (gptImageSizeError(size())) { refresh(); return }
    onApply(size()); dialog.close()
  })
  dialog.addEventListener('close', onClose)
  return { open(currentSize) {
    [width.value, height.value] = currentSize.split('x')
    ratio = Number(width.value) / Number(height.value); lock.checked = true
    document.querySelectorAll('[popover]:popover-open').forEach(popover => popover.hidePopover())
    refresh(); dialog.showModal(); width.focus()
  } }
}
