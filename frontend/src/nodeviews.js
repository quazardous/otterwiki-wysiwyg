// Browser-only node views: the small controls that edit what is not text in
// the wiki blocks (panel colour, alert type, fold summary) and the source
// editors of the verbatim nodes. syntax.js stays DOM-free for the tests.

import { ALERT_TYPES, PANEL_FAMILIES, panelClass } from './syntax.js'

function el(tag, attrs = {}, children = []) {
  const e = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v)
    else e.setAttribute(k, v)
  }
  for (const c of [].concat(children)) e.append(c)
  return e
}

function select(options, value, onChange, title) {
  const s = el('select', { class: 'ow-wysiwyg-select', title, contenteditable: 'false' })
  for (const o of options) s.append(el('option', { value: o }, o))
  s.value = value
  s.addEventListener('change', () => onChange(s.value))
  return s
}

// events inside these controls belong to them, not to the editor
const isControl = (event) => event.target.closest && event.target.closest('.ow-wysiwyg-control')

const views = {
  owPanel: () => ({ node, updateAttributes }) => {
    const contentDOM = el('div', { class: 'ow-wysiwyg-panel-body' })
    // a family the menu does not list (blue, red...) is kept, and listed
    const families = PANEL_FAMILIES.includes(node.attrs.family) ? PANEL_FAMILIES : [...PANEL_FAMILIES, node.attrs.family]
    const family = select(families, node.attrs.family, (v) => updateAttributes({ family: v }), 'Block style')
    const dom = el('div', { class: 'ow-wysiwyg-panel alert' }, [
      el('div', { class: 'ow-wysiwyg-control', contenteditable: 'false' }, [family]),
      contentDOM,
    ])
    const paint = (n) => {
      dom.className = `ow-wysiwyg-panel ${panelClass(n.attrs.family)}`
      family.value = n.attrs.family
    }
    paint(node)
    return {
      dom,
      contentDOM,
      stopEvent: isControl,
      ignoreMutation: (m) => !contentDOM.contains(m.target),
      update: (n) => n.type.name === 'owPanel' && (paint(n), true),
    }
  },

  owAlert: () => ({ node, updateAttributes }) => {
    const contentDOM = el('div', { class: 'ow-wysiwyg-alert-body' })
    const type = select(ALERT_TYPES, node.attrs.type, (v) => updateAttributes({ type: v }), 'Alert type')
    const dom = el('div', {}, [el('div', { class: 'quote-alert-header ow-wysiwyg-control', contenteditable: 'false' }, [type]), contentDOM])
    const paint = (n) => {
      dom.className = `ow-wysiwyg-alert quote-alert quote-alert-${n.attrs.type.toLowerCase()}`
      type.value = n.attrs.type
    }
    paint(node)
    return {
      dom,
      contentDOM,
      stopEvent: isControl,
      ignoreMutation: (m) => !contentDOM.contains(m.target),
      update: (n) => n.type.name === 'owAlert' && (paint(n), true),
    }
  },

  owFold: () => ({ node, updateAttributes }) => {
    // the wiki's markup: <details class="collapse-panel"><summary class="collapse-header">
    const contentDOM = el('div', { class: 'collapse-content' })
    const summary = el('input', { class: 'ow-wysiwyg-fold-summary', type: 'text', placeholder: 'Summary (always visible)' })
    summary.value = node.attrs.summary
    summary.addEventListener('input', () => updateAttributes({ summary: summary.value }))
    const header = el('summary', { class: 'collapse-header ow-wysiwyg-control', contenteditable: 'false' }, [summary])
    // always open while editing: a click in the summary edits it
    header.addEventListener('click', (e) => e.preventDefault())
    const dom = el('details', { class: 'ow-wysiwyg-fold collapse-panel', open: '' }, [header, contentDOM])
    return {
      dom,
      contentDOM,
      stopEvent: isControl,
      ignoreMutation: (m) => !contentDOM.contains(m.target),
      update: (n) => {
        if (n.type.name !== 'owFold') return false
        if (summary.value !== n.attrs.summary) summary.value = n.attrs.summary
        return true
      },
    }
  },

  owRawBlock: () => ({ node, updateAttributes }) => {
    const area = el('textarea', { class: 'ow-wysiwyg-raw-source', spellcheck: 'false', rows: '1' })
    area.value = node.attrs.source
    const fit = () => {
      area.style.height = 'auto'
      area.style.height = `${area.scrollHeight + 2}px`
    }
    area.addEventListener('input', () => {
      fit()
      updateAttributes({ source: area.value })
    })
    const dom = el('div', { class: 'ow-wysiwyg-raw ow-wysiwyg-control', contenteditable: 'false' }, [
      el('div', { class: 'ow-wysiwyg-raw-label' }, 'Markdown'),
      area,
    ])
    requestAnimationFrame(fit)
    return {
      dom,
      stopEvent: isControl,
      ignoreMutation: () => true,
      update: (n) => {
        if (n.type.name !== 'owRawBlock') return false
        if (area.value !== n.attrs.source) {
          area.value = n.attrs.source
          fit()
        }
        return true
      },
    }
  },

  owRawInline: () => ({ node, updateAttributes }) => {
    const dom = el('code', { class: 'ow-wysiwyg-raw-inline', title: 'Markdown source: click to edit' }, node.attrs.source)
    dom.addEventListener('click', () => {
      const v = window.prompt('Markdown source', node.attrs.source)
      if (v !== null && v !== '') updateAttributes({ source: v })
    })
    return { dom, update: (n) => n.type.name === 'owRawInline' && ((dom.textContent = n.attrs.source), (node = n), true) }
  },

  owWikiLink: () => ({ node, updateAttributes }) => {
    const label = (inner) => (inner.includes('|') ? inner.slice(0, inner.indexOf('|')) : inner)
    const dom = el('span', { class: 'ow-wysiwyg-wikilink', title: `[[${node.attrs.inner}]]: click to edit` }, label(node.attrs.inner))
    dom.addEventListener('click', () => {
      const v = window.prompt('Wiki link: Page, or Text|Page', node.attrs.inner)
      if (v !== null && v.trim() !== '') updateAttributes({ inner: v.trim() })
    })
    return {
      dom,
      update: (n) => {
        if (n.type.name !== 'owWikiLink') return false
        node = n
        dom.textContent = label(n.attrs.inner)
        dom.title = `[[${n.attrs.inner}]]: click to edit`
        return true
      },
    }
  },
}

// Tiptap hands updateAttributes to mark views only, not to node views: without it every control
// above threw on use (block style, alert type, fold summary, sources, wiki links). Built here from
// the node's position, on the node as it is now in the document.
function withUpdate(view) {
  return (props) => view({
    ...props,
    updateAttributes: (attrs) => {
      const pos = props.getPos()
      const { state, view: pm } = props.editor
      const current = typeof pos === 'number' ? state.doc.nodeAt(pos) : null
      if (current) pm.dispatch(state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, ...attrs }))
    },
  })
}

export const nodeViews = Object.fromEntries(Object.entries(views).map(([name, make]) => [name, () => withUpdate(make())]))
