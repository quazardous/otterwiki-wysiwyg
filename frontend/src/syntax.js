// Tiptap nodes for the Markdown dialect of An Otter Wiki.
//
// Each node owns its Markdown tokenizer, parser and serializer, so a page goes
// Markdown -> editor -> Markdown without losing the wiki's own syntax:
//
//   ::: info|warning|danger|success|...   fancy blocks       -> owPanel
//   >| folded block (first heading = summary)                 -> owFold
//   >! spoiler block                                          -> owSpoiler
//   > [!NOTE] alerts (NOTE, TIP, IMPORTANT, WARNING, CAUTION) -> owAlert
//   [[Text|Page]] wiki links                                  -> owWikiLink
//   <span style="color: …">text</span> coloured text           -> owColor
//
// Syntax the editor does not edit visually (math, embeddings, footnotes,
// abbreviations, raw HTML, ...) is kept verbatim in owRawBlock / owRawInline,
// shown as source and editable as source.
//
// The grammars mirror otterwiki/renderer_plugins.py (An Otter Wiki 2.26).

import { Extension, Mark, Node, mergeAttributes } from '@tiptap/core'

const lines = (src) => src.split('\n')

// Strip a per-line prefix (">|", ">!") and the single space that usually follows it.
function stripPrefix(text, re) {
  return lines(text).map((l) => l.replace(re, '').replace(/^ /, '')).join('\n')
}

// Children of a container block, one blank line between them (some renderers,
// like tables, start with their own newline).
function renderBlocks(h, node) {
  return h.renderChildren(node.content || [], '\n\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, '')
}

// Prefix every line of a rendered block, empty lines get the bare marker.
function prefixLines(prefix, text) {
  return lines(text.replace(/\n+$/, ''))
    .map((l) => (l.trim() === '' ? prefix : `${prefix} ${l}`))
    .join('\n')
}

// Match a run of consecutive lines starting with a given marker at the start of src.
function matchLineRun(src, lineRe) {
  let end = 0
  const all = lines(src)
  for (let i = 0; i < all.length; i++) {
    if (!lineRe.test(all[i])) break
    end += all[i].length + (i < all.length - 1 ? 1 : 0)
  }
  return end > 0 ? src.slice(0, end) : null
}

// ---------------------------------------------------------------- fancy blocks

const PANEL_FAMILIES = ['info', 'warning', 'danger', 'success', 'none']

// the wiki's classes for a fancy block family (render_html_fancy_block)
export function panelClass(family) {
  const f = (family || '').trim()
  if (['info', 'blue'].includes(f)) return 'alert alert-primary'
  if (['warning', 'yellow'].includes(f)) return 'alert alert-secondary'
  if (['danger', 'red'].includes(f)) return 'alert alert-danger'
  if (['success', 'green'].includes(f)) return 'alert alert-success'
  if (['none', 'empty', ''].includes(f)) return 'alert'
  return `alert alert-${f.replace(/[^\w-]/g, '')}`
}

export const OwPanel = Node.create({
  name: 'owPanel',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      family: { default: 'info' },
      fence: { default: ':::' },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-ow-panel]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, {
      'data-ow-panel': node.attrs.family,
      class: `ow-wysiwyg-panel ${panelClass(node.attrs.family)}`,
    }), 0]
  },

  markdownTokenizer: {
    name: 'owPanel',
    level: 'block',
    start: (src) => {
      const m = src.match(/^ {0,3}:{3,}[^:\n]*\n/m)
      return m ? m.index : -1
    },
    tokenize(src, _tokens, lexer) {
      // ( {0,3})(:{3,})([^:\n]*)\n  ...  {0,3}\2[~:]* *\n   (renderer_plugins.py)
      const open = src.match(/^( {0,3})(:{3,})([^:\n]*)\n/)
      if (!open) return
      const fence = open[2]
      const rest = src.slice(open[0].length)
      const closeRe = new RegExp(`^ {0,3}${fence}[~:]* *$`, 'm')
      const close = rest.match(closeRe)
      if (!close) return
      const body = rest.slice(0, close.index).replace(/\n$/, '')
      let end = open[0].length + close.index + close[0].length
      // the closing fence swallows the newlines after it
      while (src[end] === '\n') end++
      return {
        type: 'owPanel',
        raw: src.slice(0, end),
        family: open[3].trim() || 'info',
        fence,
        tokens: lexer.blockTokens(body),
      }
    },
  },

  parseMarkdown(token, h) {
    return h.createNode('owPanel', { family: token.family, fence: token.fence }, h.parseChildren(token.tokens || []))
  },

  renderMarkdown(node, h) {
    const fence = node.attrs.fence || ':::'
    const family = node.attrs.family && node.attrs.family !== 'info' ? ` ${node.attrs.family}` : ' info'
    return `${fence}${family}\n${renderBlocks(h, node)}\n${fence}`
  },
})

export { PANEL_FAMILIES }

// ------------------------------------------------------------- folded blocks

export const OwFold = Node.create({
  name: 'owFold',
  group: 'block',
  content: 'block*',
  defining: true,

  addAttributes() {
    return {
      summary: { default: '' },
      level: { default: 3 },
      open: { default: true, rendered: false },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-ow-fold]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    // the summary is an attribute, edited through the node's header (see editor.js)
    return ['div', mergeAttributes(HTMLAttributes, { 'data-ow-fold': '', class: 'ow-wysiwyg-fold collapse-panel' }),
      ['div', { class: 'ow-wysiwyg-fold-summary collapse-header', contenteditable: 'false' }, node.attrs.summary || '…'],
      ['div', { class: 'collapse-content' }, 0]]
  },

  markdownTokenizer: {
    name: 'owFold',
    level: 'block',
    start: (src) => {
      const m = src.match(/^ {0,3}>\|/m)
      return m ? m.index : -1
    },
    tokenize(src, _tokens, lexer) {
      const raw = matchLineRun(src, /^ {0,3}>\|/)
      if (!raw) return
      let text = stripPrefix(raw, /^ *>\|/)
      let summary = ''
      let level = 3
      const head = text.match(/^(#{1,5})\s*(.*)(\n+|$)/)
      if (head) {
        level = head[1].length
        summary = head[2]
        text = text.slice(head[0].length)
      }
      let end = raw.length
      while (src[end] === '\n') end++
      return { type: 'owFold', raw: src.slice(0, end), summary, level, tokens: lexer.blockTokens(text) }
    },
  },

  parseMarkdown(token, h) {
    return h.createNode('owFold', { summary: token.summary, level: token.level }, h.parseChildren(token.tokens || []))
  },

  renderMarkdown(node, h) {
    const head = node.attrs.summary ? `${'#'.repeat(node.attrs.level || 3)} ${node.attrs.summary}` : ''
    const body = renderBlocks(h, node)
    return prefixLines('>|', [head, body].filter((x) => x !== '').join('\n'))
  },
})

// ------------------------------------------------------------- spoiler blocks

export const OwSpoiler = Node.create({
  name: 'owSpoiler',
  group: 'block',
  content: 'block+',
  defining: true,

  parseHTML() {
    return [{ tag: 'div[data-ow-spoiler]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-ow-spoiler': '', class: 'ow-wysiwyg-spoiler' }), 0]
  },

  markdownTokenizer: {
    name: 'owSpoiler',
    level: 'block',
    start: (src) => {
      const m = src.match(/^ {0,3}>!/m)
      return m ? m.index : -1
    },
    tokenize(src, _tokens, lexer) {
      const raw = matchLineRun(src, /^ {0,3}>!/)
      if (!raw) return
      let end = raw.length
      while (src[end] === '\n') end++
      return { type: 'owSpoiler', raw: src.slice(0, end), tokens: lexer.blockTokens(stripPrefix(raw, /^ *>!/)) }
    },
  },

  parseMarkdown(token, h) {
    return h.createNode('owSpoiler', {}, h.parseChildren(token.tokens || []))
  },

  renderMarkdown(node, h) {
    return prefixLines('>!', renderBlocks(h, node))
  },
})

// ---------------------------------------------------------------------- alerts

export const ALERT_TYPES = ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION']

export const OwAlert = Node.create({
  name: 'owAlert',
  group: 'block',
  content: 'block+',
  defining: true,
  // before the blockquote: "> [!NOTE]" is a blockquote to plain Markdown
  priority: 200,

  addAttributes() {
    return { type: { default: 'NOTE' } }
  },

  parseHTML() {
    return [{ tag: 'div[data-ow-alert]', getAttrs: (el) => ({ type: el.getAttribute('data-ow-alert') }) }]
  },

  renderHTML({ node, HTMLAttributes }) {
    const t = node.attrs.type
    return ['div', mergeAttributes(HTMLAttributes, { 'data-ow-alert': t, class: `ow-wysiwyg-alert quote-alert quote-alert-${t.toLowerCase()}` }),
      ['div', { class: 'quote-alert-header', contenteditable: 'false' }, t.charAt(0) + t.slice(1).toLowerCase()],
      ['div', { class: 'ow-wysiwyg-alert-body' }, 0]]
  },

  markdownTokenizer: {
    name: 'owAlert',
    level: 'block',
    start: (src) => {
      const m = src.match(/^ {0,3}>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/im)
      return m ? m.index : -1
    },
    tokenize(src, _tokens, lexer) {
      const first = src.match(/^ {0,3}>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][^\n]*(\n|$)/i)
      if (!first) return
      const more = matchLineRun(src.slice(first[0].length), /^ {0,3}>/)
      // the renderer only takes an alert with at least one line after the marker
      if (!more) return
      const raw = first[0] + more
      const text = lines(raw)
        .map((l) => l.replace(/^ *>(\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\])?/i, '').replace(/^ /, ''))
        .join('\n')
        .replace(/^\n/, '')
      let end = raw.length
      while (src[end] === '\n') end++
      return { type: 'owAlert', raw: src.slice(0, end), alertType: first[1].toUpperCase(), tokens: lexer.blockTokens(text) }
    },
  },

  parseMarkdown(token, h) {
    return h.createNode('owAlert', { type: token.alertType }, h.parseChildren(token.tokens || []))
  },

  renderMarkdown(node, h) {
    return `> [!${node.attrs.type}]\n${prefixLines('>', renderBlocks(h, node))}`
  },
})

// ------------------------------------------------------------------ wiki links

export const OwWikiLink = Node.create({
  name: 'owWikiLink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    // inner: everything between [[ and ]], kept verbatim ("Text|Page", "Page#anchor")
    return { inner: { default: '' } }
  },

  parseHTML() {
    return [{ tag: 'span[data-ow-wikilink]', getAttrs: (el) => ({ inner: el.getAttribute('data-ow-wikilink') }) }]
  },

  renderHTML({ node, HTMLAttributes }) {
    const inner = node.attrs.inner
    const pipe = inner.indexOf('|')
    const label = pipe >= 0 ? inner.slice(0, pipe) : inner
    return ['span', mergeAttributes(HTMLAttributes, { 'data-ow-wikilink': inner, class: 'ow-wysiwyg-wikilink', title: inner }), label]
  },

  markdownTokenizer: {
    name: 'owWikiLink',
    level: 'inline',
    start: (src) => src.indexOf('[['),
    tokenize(src) {
      const m = src.match(/^\[\[([^|\]]+(?:#[^\]]*)?(?:\|[^\]]+)?)\]\]/)
      if (!m) return
      return { type: 'owWikiLink', raw: m[0], inner: m[1] }
    },
  },

  parseMarkdown(token, h) {
    return h.createNode('owWikiLink', { inner: token.inner })
  },

  renderMarkdown(node) {
    return `[[${node.attrs.inner}]]`
  },
})

// ---------------------------------------------------------------- text colour

// The only coloured text the wiki shows: a span with a colour style (its HTML
// cleaner keeps the style attribute of a span). One colour, no other style.
const COLOR_SPAN = /^<span style="\s*color:\s*([#\w(),.%\s-]+?)\s*;?\s*">([\s\S]*?)<\/span>/i

// a colour as written in the page, kept as is; nothing that could leave the style
export const safeColor = (c) => (/^[#\w(),.%\s-]+$/.test(c || '') ? c.trim() : null)

export const OwColor = Mark.create({
  name: 'owColor',
  // before raw HTML (OwHtml), which would keep the span as source
  priority: 300,

  addAttributes() {
    return { color: { default: null } }
  },

  parseHTML() {
    return [{ tag: 'span[data-ow-color]', getAttrs: (el) => ({ color: safeColor(el.getAttribute('data-ow-color')) }) }]
  },

  renderHTML({ mark, HTMLAttributes }) {
    const color = safeColor(mark.attrs.color)
    return ['span', mergeAttributes(HTMLAttributes, { 'data-ow-color': color, style: color ? `color: ${color}` : null }), 0]
  },

  markdownTokenizer: {
    name: 'owColor',
    level: 'inline',
    start: (src) => {
      const m = src.match(/<span style="\s*color:/i)
      return m ? m.index : -1
    },
    tokenize(src, _tokens, lexer) {
      const m = src.match(COLOR_SPAN)
      // a span inside the coloured text: not ours, it stays HTML
      if (!m || /<span\b/i.test(m[2]) || !safeColor(m[1])) return
      return { type: 'owColor', raw: m[0], color: m[1].trim(), tokens: lexer.inlineTokens(m[2]) }
    },
  },

  parseMarkdown(token, h) {
    return h.applyMark('owColor', h.parseInline(token.tokens || []), { color: token.color })
  },

  renderMarkdown(node, h) {
    return `<span style="color: ${safeColor(node.attrs?.color) || 'inherit'}">${h.renderChildren(node)}</span>`
  },
})

// ----------------------------------------------------- verbatim (source) nodes

// Block-level syntax that is kept as Markdown source: display math, embeddings,
// footnote and abbreviation definitions, raw HTML, and any block the editor
// cannot write back unchanged (see roundtrip.js).
const RAW_BLOCK_RES = [
  /^ {0,3}\$\$[\s\S]*?\$\$ *(\n|$)/, // display math
  /^\{\{[A-Za-z ]+[\s\S]*?\}\} *(\n|$)/, // embeddings: {{Name ...}}
  /^(?:\[\^[^\]\n]+\]:[^\n]*(?:\n|$)(?:(?: {2,}|\t)[^\n]*(?:\n|$)|\n(?= {2,}|\t))*)+/, // footnote definitions
  /^(?:\*\[[^\]\n]+\]:[^\n]*(?:\n|$))+/, // abbreviation definitions
]

export const OwRawBlock = Node.create({
  name: 'owRawBlock',
  group: 'block',
  atom: true,
  selectable: true,
  // before every Markdown block rule, so these never reach the paragraph rule
  priority: 300,

  addAttributes() {
    return { source: { default: '' } }
  },

  parseHTML() {
    return [{ tag: 'pre[data-ow-raw]', preserveWhitespace: 'full', getAttrs: (el) => ({ source: el.textContent }) }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return ['pre', mergeAttributes(HTMLAttributes, { 'data-ow-raw': '', class: 'ow-wysiwyg-raw', title: 'Markdown source, kept as is' }), node.attrs.source]
  },

  markdownTokenizer: {
    name: 'owRawBlock',
    level: 'block',
    start: (src) => {
      const m = src.match(/^( {0,3}\$\$|\{\{[A-Za-z ]|\[\^[^\]\n]+\]:|\*\[[^\]\n]+\]:)/m)
      return m ? m.index : -1
    },
    tokenize(src) {
      for (const re of RAW_BLOCK_RES) {
        const m = src.match(re)
        if (m) {
          let end = m[0].length
          while (src[end] === '\n') end++
          return { type: 'owRawBlock', raw: src.slice(0, end), source: m[0].replace(/\n+$/, '') }
        }
      }
    },
  },

  parseMarkdown(token, h) {
    return h.createNode('owRawBlock', { source: token.source })
  },

  renderMarkdown(node) {
    return node.attrs.source
  },
})

// Inline syntax kept as source: inline math, footnote references, inline HTML.
export const OwRawInline = Node.create({
  name: 'owRawInline',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return { source: { default: '' } }
  },

  parseHTML() {
    return [{ tag: 'code[data-ow-raw-inline]', getAttrs: (el) => ({ source: el.textContent }) }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return ['code', mergeAttributes(HTMLAttributes, { 'data-ow-raw-inline': '', class: 'ow-wysiwyg-raw-inline' }), node.attrs.source]
  },

  markdownTokenizer: {
    name: 'owRawInline',
    level: 'inline',
    start: (src) => {
      const m = src.match(/\$|\[\^/)
      return m ? m.index : -1
    },
    tokenize(src) {
      const m =
        // inline math, the renderer's pattern: $ no space ... no space $
        src.match(/^\$\$(?:\\\$|[^$])+\$\$/) ||
        src.match(/^\$(?=[^\s$])(?:\\\$|[^$])*(?:\\.|[^\s$])\$/) ||
        // footnote reference
        src.match(/^\[\^[^\]\s]+\]/)
      if (!m) return
      return { type: 'owRawInline', raw: m[0], source: m[0] }
    },
  },

  parseMarkdown(token, h) {
    return h.createNode('owRawInline', { source: token.source })
  },

  renderMarkdown(node) {
    return node.attrs.source
  },
})

// Raw HTML, block or inline (marked "html" tokens): kept as source.
export const OwHtml = Extension.create({
  name: 'owHtml',
  markdownTokenName: 'html',
  parseMarkdown(token, h) {
    return token.block
      ? h.createNode('owRawBlock', { source: token.raw.replace(/\n+$/, '') })
      : h.createNode('owRawInline', { source: token.raw })
  },
})

export const otterwikiSyntax = [OwHtml, OwColor, OwRawBlock, OwRawInline, OwAlert, OwPanel, OwFold, OwSpoiler, OwWikiLink]
