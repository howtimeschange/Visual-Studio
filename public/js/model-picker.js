// The select remains the single source of model availability and change events.
export function createModelPicker({ select, trigger, popover, list, label }) {
  function render() {
    label.textContent = select.selectedOptions[0]?.textContent || '选择模型'
    trigger.title = label.textContent
    trigger.disabled = select.disabled
    list.replaceChildren(...[...select.options].filter(option => !option.hidden).map(option => {
      const button = document.createElement('button')
      button.type = 'button'; button.className = 'agent-model-option'
      button.setAttribute('role', 'option'); button.setAttribute('aria-selected', String(option.selected))
      button.dataset.model = option.value; button.disabled = option.disabled
      const text = document.createElement('span'), title = document.createElement('strong'), hint = document.createElement('small')
      title.textContent = option.textContent
      hint.textContent = option.title.startsWith(`${option.textContent} · `) ? option.title.slice(option.textContent.length + 3) : option.title
      text.append(title, hint)
      const check = document.createElement('span'); check.className = 'agent-model-check'; check.setAttribute('aria-hidden', 'true'); check.textContent = option.selected ? '✓' : ''
      button.append(text, check)
      return button
    }))
  }
  const enabled = () => [...list.querySelectorAll('[role="option"]:not(:disabled)')]
  const focusSelected = () => (list.querySelector('[aria-selected="true"]:not(:disabled)') || enabled()[0])?.focus()
  list.addEventListener('click', event => {
    const option = event.target.closest('[data-model]')
    if (!option || option.disabled) return
    select.value = option.dataset.model
    select.dispatchEvent(new Event('change', { bubbles: true }))
    render(); popover.hidePopover(); trigger.focus()
  })
  list.addEventListener('keydown', event => {
    const items = enabled(), index = items.indexOf(document.activeElement)
    const next = event.key === 'ArrowDown' ? (index + 1) % items.length : event.key === 'ArrowUp' ? (index + items.length - 1) % items.length : event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : -1
    if (next >= 0) { event.preventDefault(); items[next]?.focus() }
  })
  trigger.addEventListener('keydown', event => {
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return
    event.preventDefault(); popover.showPopover(); focusSelected()
  })
  popover.addEventListener('beforetoggle', event => { if (event.newState === 'open') render() })
  popover.addEventListener('toggle', event => {
    trigger.setAttribute('aria-expanded', String(event.newState === 'open'))
    if (event.newState === 'open') focusSelected()
  })
  select.addEventListener('change', render)
  render()
  return { render }
}
