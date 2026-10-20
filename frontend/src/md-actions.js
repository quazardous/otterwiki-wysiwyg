// The toolbar's actions in the Markdown tab: they write the wiki's Markdown
// syntax into the source. Pure functions on (text, selection), applied to a
// CodeMirror view by applyAction(): the wiki's editor and the section editor
// come from two bundles, plain change objects work with both.
//
// Each action: ({ text, from, to }, arg?) -> { from, to, insert, select: [anchor, head] }
// (one change: replace text[from, to) by insert, then select).

const lineStart = (text, pos) => text.lastIndexOf('\n', pos - 1) + 1
const lineEnd = (text, pos) => {
  const i = text.indexOf('\n', pos)
  return i < 0 ? text.length : i
}

// the whole lines touched by the selection
function lines(sel) {
  const from = lineStart(sel.text, sel.from)
  const to = lineEnd(sel.text, Math.max(sel.from, sel.to - (sel.to > sel.from && sel.text[sel.to - 1] === '\n' ? 1 : 0)))
  return { from, to, body: sel.text.slice(from, to) }
}

// **text**: wrap the selection, or unwrap it when it is already wrapped
export function wrap(sel, before, after = before, placeholder = 'text') {
  const { text, from, to } = sel
  if (text.slice(from - before.length, from) === before && text.slice(to, to + after.length) === after) {
    return { from: from - before.length, to: to + after.length, insert: text.slice(from, to), select: [from - before.length, to - before.length] }
  }
  const inner = from === to ? placeholder : text.slice(from, to)
  return { from, to, insert: before + inner + after, select: [from + before.length, from + before.length + inner.length] }
}

// a prefix on every selected line ("- ", "> "...); removed when all lines have it
export function linePrefix(sel, prefix, strip = null) {
  const l = lines(sel)
  const rows = l.body.split('\n')
  const has = (r) => r.startsWith(prefix)
  const all = rows.every((r) => r.trim() === '' || has(r))
  const out = rows.map((r, i) => {
    if (r.trim() === '' && rows.length > 1) return r
    if (all) return r.slice(prefix.length)
    const bare = strip ? r.replace(strip, '') : r
    return typeof prefix === 'function' ? prefix(i) + bare : prefix + bare
  })
  const insert = out.join('\n')
  return { from: l.from, to: l.to, insert, select: [l.from, l.from + insert.length] }
}

const LIST_MARK = /^(\s*)([-*+]|\d+[.)])(\s+\[[ xX]\])?\s+/

export const bulletList = (sel) => linePrefix(sel, '- ', LIST_MARK)
export const taskList = (sel) => linePrefix(sel, '- [ ] ', LIST_MARK)
export function orderedList(sel) {
  const l = lines(sel)
  const rows = l.body.split('\n')
  if (rows.every((r) => r.trim() === '' || /^\d+[.)]\s/.test(r))) return linePrefix(sel, '', /^\d+[.)]\s+/)
  let n = 0
  const insert = rows.map((r) => (r.trim() === '' && rows.length > 1 ? r : `${++n}. ${r.replace(LIST_MARK, '')}`)).join('\n')
  return { from: l.from, to: l.to, insert, select: [l.from, l.from + insert.length] }
}
export const quote = (sel) => linePrefix(sel, '> ')

// # heading level on the current line(s); 0 = paragraph
export function heading(sel, level) {
  const l = lines(sel)
  const insert = l.body
    .split('\n')
    .map((r) => {
      const bare = r.replace(/^ {0,3}#{1,6}\s*/, '')
      return level ? `${'#'.repeat(level)} ${bare}` : bare
    })
    .join('\n')
  return { from: l.from, to: l.to, insert, select: [l.from + insert.length, l.from + insert.length] }
}

// a block on lines of its own, with a blank line around it
export function block(sel, opening, closing, placeholder = 'text', linePrefixStr = '') {
  const { text } = sel
  const l = sel.from === sel.to ? { from: sel.from, to: sel.to, body: '' } : lines(sel)
  const body = (l.body || placeholder).split('\n').map((r) => linePrefixStr + r).join('\n')
  // a blank line between the block and the text around it, if there is any
  const prev = text.slice(0, l.from)
  const rest = text.slice(l.to)
  const gap = (side, edge) => (side.trim() === '' ? '' : edge === '\n\n' ? '' : edge.endsWith('\n') || edge.startsWith('\n') ? '\n' : '\n\n')
  const before = gap(prev, prev.slice(-2) === '\n\n' ? '\n\n' : prev.slice(-1) === '\n' ? '\n' : '')
  const after = gap(rest, rest.slice(0, 2) === '\n\n' ? '\n\n' : rest.slice(0, 1) === '\n' ? '\n' : '')
  const head = opening ? `${opening}\n` : ''
  const tail = closing ? `\n${closing}` : ''
  const insert = `${before}${head}${body}${tail}${after}`
  const start = l.from + before.length + head.length
  return { from: l.from, to: l.to, insert, select: [start, start + body.length] }
}

export const codeBlock = (sel) => block(sel, '```', '```', 'code')
export const panel = (sel, family = 'info') => block(sel, `::: ${family}`, ':::')
export const alert = (sel, type = 'NOTE') => block(sel, `> [!${type}]`, '', 'text', '> ')
export const fold = (sel) => block(sel, '>| ### Summary', '', 'text', '>| ')
export const spoiler = (sel) => block(sel, '', '', 'text', '>! ')
export const horizontalRule = (sel) => block({ ...sel, to: sel.from }, '', '', '---')

export function table(sel) {
  return block({ ...sel, to: sel.from }, '', '', '| Column 1 | Column 2 | Column 3 |\n| -------- | -------- | -------- |\n|          |          |          |')
}

// [text](url) / [[Page]] / ![alt](src): the selection is the text
export function link(sel, url) {
  const t = sel.text.slice(sel.from, sel.to) || 'link'
  const insert = `[${t}](${url})`
  return { from: sel.from, to: sel.to, insert, select: [sel.from + 1, sel.from + 1 + t.length] }
}

export function wikiLink(sel, page) {
  const t = sel.text.slice(sel.from, sel.to)
  const insert = t && t !== page ? `[[${t}|${page}]]` : `[[${page}]]`
  return { from: sel.from, to: sel.to, insert, select: [sel.from + insert.length, sel.from + insert.length] }
}

export function image(sel, src) {
  const alt = sel.text.slice(sel.from, sel.to)
  const insert = `![${alt}](${src})`
  return { from: sel.from, to: sel.to, insert, select: [sel.from + insert.length, sel.from + insert.length] }
}

// apply an action to a CodeMirror 6 view (any bundle: plain objects only)
export function applyAction(view, action, arg) {
  const s = view.state.selection.main
  const sel = { text: view.state.doc.toString(), from: s.from, to: s.to }
  const r = action(sel, arg)
  view.dispatch({ changes: { from: r.from, to: r.to, insert: r.insert }, selection: { anchor: r.select[0], head: r.select[1] }, scrollIntoView: true })
  view.focus()
}
