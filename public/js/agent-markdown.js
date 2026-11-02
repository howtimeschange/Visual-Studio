// Deliberately bounded Markdown for model output. Raw HTML is always escaped;
// only known tags and http(s)/local links are emitted, and images never auto-load.
const escape = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

function safeLink(value) {
  const url = value.trim()
  if (/[\x00-\x20\x7f\\]/.test(url)) return ''
  if (/^https?:\/\//i.test(url) || /^\/(?!\/)/.test(url) || url.startsWith('#')) return escape(url)
  return ''
}

function inline(text, depth = 0) {
  if (depth > 8) return escape(text)
  const tokens = /(`+)([\s\S]*?)\1|!\[([^\]]*)\]\(([^\n]*?)\)|\[([^\]]+)\]\(([^\s)]*)(?:\s+"[^"]*")?\)|\*\*([^\n]+?)\*\*|__([^\n]+?)__|~~([^\n]+?)~~|\*([^*\n]+?)\*|_([^_\n]+?)_/g
  let result = '', offset = 0
  for (const match of text.matchAll(tokens)) {
    result += escape(text.slice(offset, match.index))
    if (match[1]) result += `<code>${escape(match[2])}</code>`
    else if (match[3] !== undefined) result += escape(`[图片：${match[3]}]`)
    else if (match[5] !== undefined) {
      const href = safeLink(match[6])
      result += href ? `<a href="${href}" target="_blank" rel="noopener noreferrer">${inline(match[5], depth + 1)}</a>` : inline(match[5], depth + 1)
    } else {
      const tag = match[7] || match[8] ? 'strong' : match[9] ? 'del' : 'em'
      result += `<${tag}>${inline(match[7] || match[8] || match[9] || match[10] || match[11], depth + 1)}</${tag}>`
    }
    offset = match.index + match[0].length
  }
  return result + escape(text.slice(offset))
}

const listItem = (line) => line.match(/^(\s*)([-+*]|\d+[.)])\s+(.+)$/)
const cells = (line) => line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, '|'))
const tableRule = (line) => line.includes('|') && cells(line).every((cell) => /^:?-{3,}:?$/.test(cell))
const startsBlock = (line) => /^\s*(#{1,6}\s|```|~~~|>|(?:[-*_]\s*){3,}$)/.test(line) || listItem(line)

function blocks(lines, depth = 0) {
  if (depth > 12) return `<p>${escape(lines.join('\n'))}</p>`
  let html = '', i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) { i++; continue }
    const fence = line.match(/^\s{0,3}(`{3,}|~{3,})\s*([\w-]*)[^\n]*$/)
    if (fence) {
      const code = []; i++
      while (i < lines.length && !new RegExp(`^\\s{0,3}${fence[1][0]}{${fence[1].length},}\\s*$`).test(lines[i])) code.push(lines[i++])
      if (i < lines.length) i++
      html += `<pre><code${fence[2] ? ` class="language-${escape(fence[2])}"` : ''}>${escape(code.join('\n'))}</code></pre>`
      continue
    }
    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*$/)
    if (heading) { html += `<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`; i++; continue }
    if (/^\s{0,3}(?:[-*_]\s*){3,}$/.test(line)) { html += '<hr>'; i++; continue }
    if (/^\s{0,3}>/.test(line)) {
      const quote = []
      while (i < lines.length && /^\s{0,3}>/.test(lines[i])) quote.push(lines[i++].replace(/^\s{0,3}> ?/, ''))
      html += `<blockquote>${blocks(quote, depth + 1)}</blockquote>`; continue
    }
    if (i + 1 < lines.length && line.includes('|') && tableRule(lines[i + 1])) {
      const header = cells(line), rows = []; i += 2
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) rows.push(cells(lines[i++]))
      html += `<div class="agent-md-table"><table><thead><tr>${header.map((cell) => `<th>${inline(cell)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${header.map((_, col) => `<td>${inline(row[col] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
      continue
    }
    const first = listItem(line)
    if (first) {
      const indent = first[1].length, ordered = /^\d/.test(first[2]), tag = ordered ? 'ol' : 'ul'
      html += `<${tag}${ordered && parseInt(first[2]) !== 1 ? ` start="${parseInt(first[2])}"` : ''}>`
      while (i < lines.length) {
        const item = listItem(lines[i])
        if (!item || item[1].length !== indent || /^\d/.test(item[2]) !== ordered) break
        const contentIndent = item[0].length - item[3].length
        const body = [item[3]]; i++
        while (i < lines.length) {
          const next = listItem(lines[i]), spaces = lines[i].match(/^\s*/)[0].length
          if (next && next[1].length <= indent) break
          if (!lines[i].trim()) {
            const after = lines[i + 1] || '', afterSpaces = after.match(/^\s*/)[0].length
            if (afterSpaces <= indent) { i++; break }
          } else if (spaces <= indent) break
          body.push(lines[i].slice(Math.min(spaces, contentIndent))); i++
        }
        html += `<li>${blocks(body, depth + 1)}</li>`
      }
      html += `</${tag}>`; continue
    }
    const paragraph = [line]; i++
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i]) && !(i + 1 < lines.length && tableRule(lines[i + 1]))) paragraph.push(lines[i++])
    html += `<p>${paragraph.map((part) => inline(part)).join('<br>')}</p>`
  }
  return html
}

export function agentMarkdownToHtml(source) {
  return blocks(String(source || '').slice(0, 60000).replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n'))
}
