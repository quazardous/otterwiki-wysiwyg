// The editor's toolbar, for both tabs. It replaces the wiki's own toolbar.
//
// The target is set by index.js:
//   { mode: 'visual', editor }                     the visual editor (Tiptap)
//   { mode: 'markdown', view, undo, redo, page }   a Markdown editor (CodeMirror):
//       the wiki's (page: true) or the section editor's
// Each button has a handler per mode; a button without one is hidden in that mode.

import * as md from './md-actions.js'

const para = () => ({ type: 'paragraph', content: [] })
const visualBlock = (type, attrs) => (t) => t.editor.chain().focus().insertContent({ type, attrs, content: [para()] }).run()
const mdDo = (action, arg) => (t) => md.applyAction(t.view, action, arg)

function wikiPages() {
  // the editor page lists the wiki's pages in its sidebar (WikiLink select)
  const s = document.getElementById('wikilink')
  return s ? [...s.options].map((o) => o.value).filter(Boolean) : []
}

function askPage() {
  const pages = wikiPages()
  const hint = pages.length ? ` (e.g. ${pages.slice(0, 3).join(', ')})` : ''
  const target = window.prompt(`Page to link${hint}`)
  return target && target.trim() ? target.trim() : null
}

function visualWikiLink({ editor }) {
  const page = askPage()
  if (!page) return
  const { from, to, empty } = editor.state.selection
  const text = empty ? '' : editor.state.doc.textBetween(from, to, ' ')
  const inner = text && text !== page ? `${text}|${page}` : page
  editor.chain().focus().insertContent({ type: 'owWikiLink', attrs: { inner } }).run()
}

function visualLink({ editor }) {
  const prev = editor.getAttributes('link').href || ''
  const href = window.prompt('Link URL (empty to remove)', prev)
  if (href === null) return
  if (href === '') editor.chain().focus().extendMarkRange('link').unsetLink().run()
  else editor.chain().focus().extendMarkRange('link').setLink({ href }).run()
}

const IMAGE_PROMPT = 'Image URL or attachment path (you can also paste or drop an image)'

// [icon, title, { visual, markdown }, isActive (visual)] ; '|' separates groups
const BUTTONS = [
  ['fas fa-undo', 'Undo', { visual: (t) => t.editor.chain().focus().undo().run(), markdown: (t) => t.undo() }],
  ['fas fa-redo', 'Redo', { visual: (t) => t.editor.chain().focus().redo().run(), markdown: (t) => t.redo() }],
  ['fas fa-search', 'Search', { markdown: (t) => t.page && window.cmOpenSearch && window.cmOpenSearch() }, null, (t) => t.page && window.cmOpenSearch],
  ['fas fa-exchange-alt', 'Search and replace', { markdown: (t) => t.page && window.cmOpenReplace && window.cmOpenReplace() }, null, (t) => t.page && window.cmOpenReplace],
  '|',
  ['fa fa-bold', 'Bold', { visual: (t) => t.editor.chain().focus().toggleBold().run(), markdown: (t) => md.applyAction(t.view, (s) => md.wrap(s, '**')) }, (e) => e.isActive('bold')],
  ['fa fa-italic', 'Italic', { visual: (t) => t.editor.chain().focus().toggleItalic().run(), markdown: (t) => md.applyAction(t.view, (s) => md.wrap(s, '*')) }, (e) => e.isActive('italic')],
  ['fa fa-strikethrough', 'Strikethrough', { visual: (t) => t.editor.chain().focus().toggleStrike().run(), markdown: (t) => md.applyAction(t.view, (s) => md.wrap(s, '~~')) }, (e) => e.isActive('strike')],
  ['fas fa-highlighter', 'Mark', { visual: (t) => t.editor.chain().focus().toggleHighlight().run(), markdown: (t) => md.applyAction(t.view, (s) => md.wrap(s, '==')) }, (e) => e.isActive('highlight')],
  ['fas fa-code', 'Inline code', { visual: (t) => t.editor.chain().focus().toggleCode().run(), markdown: (t) => md.applyAction(t.view, (s) => md.wrap(s, '`', '`', 'code')) }, (e) => e.isActive('code')],
  '|',
  ['heading', 'Paragraph style'],
  '|',
  ['fas fa-list-ul', 'Bullet list', { visual: (t) => t.editor.chain().focus().toggleBulletList().run(), markdown: mdDo(md.bulletList) }, (e) => e.isActive('bulletList')],
  ['fas fa-list-ol', 'Numbered list', { visual: (t) => t.editor.chain().focus().toggleOrderedList().run(), markdown: mdDo(md.orderedList) }, (e) => e.isActive('orderedList')],
  ['fas fa-tasks', 'Checklist', { visual: (t) => t.editor.chain().focus().toggleTaskList().run(), markdown: mdDo(md.taskList) }, (e) => e.isActive('taskList')],
  ['fas fa-quote-left', 'Quote', { visual: (t) => t.editor.chain().focus().toggleBlockquote().run(), markdown: mdDo(md.quote) }, (e) => e.isActive('blockquote')],
  ['fas fa-file-code', 'Code block', { visual: (t) => t.editor.chain().focus().toggleCodeBlock().run(), markdown: mdDo(md.codeBlock) }, (e) => e.isActive('codeBlock')],
  ['fas fa-minus', 'Horizontal line', { visual: (t) => t.editor.chain().focus().setHorizontalRule().run(), markdown: mdDo(md.horizontalRule) }],
  '|',
  ['fas fa-link', 'Link', {
    visual: visualLink,
    markdown: (t) => {
      const url = window.prompt('Link URL')
      if (url) md.applyAction(t.view, md.link, url)
    },
  }, (e) => e.isActive('link')],
  ['fas fa-book', 'Wiki link', {
    visual: visualWikiLink,
    markdown: (t) => {
      const page = askPage()
      if (page) md.applyAction(t.view, md.wikiLink, page)
    },
  }],
  ['far fa-image', 'Image', {
    visual: (t) => {
      const src = window.prompt(IMAGE_PROMPT)
      if (src) t.editor.chain().focus().setImage({ src, alt: '' }).run()
    },
    markdown: (t) => {
      const src = window.prompt(IMAGE_PROMPT)
      if (src) md.applyAction(t.view, md.image, src)
    },
  }],
  ['table', 'Table'],
  '|',
  ['fas fa-info-circle', 'Coloured block', { visual: visualBlock('owPanel', { family: 'info' }), markdown: mdDo(md.panel) }],
  ['fas fa-exclamation-triangle', 'Alert', { visual: visualBlock('owAlert', { type: 'NOTE' }), markdown: mdDo(md.alert) }],
  ['fas fa-caret-square-down', 'Folded block', { visual: visualBlock('owFold', { summary: 'Summary', level: 3 }), markdown: mdDo(md.fold) }],
  ['fas fa-eye-slash', 'Spoiler', { visual: visualBlock('owSpoiler'), markdown: mdDo(md.spoiler) }],
  ['fab fa-markdown', 'Markdown source block', { visual: (t) => t.editor.chain().focus().insertContent({ type: 'owRawBlock', attrs: { source: '' } }).run() }],
]

const HEADINGS = [['Paragraph', 0], ['Heading 1', 1], ['Heading 2', 2], ['Heading 3', 3], ['Heading 4', 4]]

// the table menu: in the visual editor, Tiptap's commands; in the wiki's own
// Markdown editor, its table commands (window.otterwiki_editor)
const ow = (name, ...args) => () => window.otterwiki_editor && window.otterwiki_editor[name] && window.otterwiki_editor[name](...args)
const TABLE_MENU = [
  ['fas fa-table', 'Insert a table', { visual: (t) => t.editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(), markdown: mdDo(md.table) }],
  '-',
  ['fas fa-plus', 'Add a row below', { visual: (t) => t.editor.chain().focus().addRowAfter().run(), page: ow('table_add_row') }],
  ['fas fa-minus', 'Remove the row', { visual: (t) => t.editor.chain().focus().deleteRow().run(), page: ow('table_remove_row') }],
  ['fas fa-plus-square', 'Add a column right', { visual: (t) => t.editor.chain().focus().addColumnAfter().run(), page: ow('table_add_column') }],
  ['fas fa-minus-square', 'Remove the column', { visual: (t) => t.editor.chain().focus().deleteColumn().run(), page: ow('table_remove_column') }],
  ['fas fa-heading', 'Toggle the header row', { visual: (t) => t.editor.chain().focus().toggleHeaderRow().run() }],
  ['fas fa-trash-alt', 'Delete the table', { visual: (t) => t.editor.chain().focus().deleteTable().run() }],
]

// the handler of an entry for the current target
function handlerOf(handlers, t) {
  if (!handlers || !t) return null
  if (t.mode === 'visual') return handlers.visual || null
  return handlers.markdown || (t.page ? handlers.page : null) || null
}

function iconButton(icon, title) {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'ow-wysiwyg-btn'
  btn.title = title
  btn.innerHTML = `<i class="${icon}"></i>`
  // keep the editor's selection: act on mousedown, not after a focus change
  btn.addEventListener('mousedown', (ev) => ev.preventDefault())
  return btn
}

export function buildToolbar() {
  const bar = document.createElement('div')
  bar.className = 'ow-wysiwyg-toolbar'
  let target = null
  const updaters = [] // run on every target change, selection change
  let unbind = null

  for (const b of BUTTONS) {
    if (b === '|') {
      const sep = Object.assign(document.createElement('span'), { className: 'ow-wysiwyg-sep' })
      bar.append(sep)
      continue
    }
    const [icon, title, handlers, isActive, available] = b
    if (icon === 'heading') {
      const s = document.createElement('select')
      s.className = 'ow-wysiwyg-select'
      s.title = title
      for (const [label, level] of HEADINGS) s.append(new Option(label, String(level)))
      s.addEventListener('change', () => {
        const level = Number(s.value)
        if (target.mode === 'visual') {
          if (level === 0) target.editor.chain().focus().setParagraph().run()
          else target.editor.chain().focus().setHeading({ level }).run()
        } else {
          md.applyAction(target.view, md.heading, level)
          s.value = '0'
        }
      })
      updaters.push(() => {
        if (target.mode !== 'visual') return (s.value = '0')
        const h = HEADINGS.find(([, l]) => l && target.editor.isActive('heading', { level: l }))
        s.value = String(h ? h[1] : 0)
      })
      bar.append(s)
      continue
    }
    if (icon === 'table') {
      bar.append(tableMenu(() => target, updaters))
      continue
    }
    const btn = iconButton(icon, title)
    btn.addEventListener('click', () => {
      const h = handlerOf(handlers, target)
      if (h) h(target)
    })
    updaters.push(() => {
      const ok = handlerOf(handlers, target) && (!available || available(target))
      btn.style.display = ok ? '' : 'none'
      btn.classList.toggle('active', !!(ok && isActive && target.mode === 'visual' && isActive(target.editor)))
    })
    bar.append(btn)
  }

  const update = () => target && updaters.forEach((f) => f())
  return {
    dom: bar,
    setTarget(t) {
      if (unbind) unbind()
      unbind = null
      target = t
      if (t && t.mode === 'visual') {
        t.editor.on('selectionUpdate', update)
        t.editor.on('transaction', update)
        unbind = () => {
          t.editor.off('selectionUpdate', update)
          t.editor.off('transaction', update)
        }
      }
      update()
    },
  }
}

// the Table button: a small menu of table commands
function tableMenu(getTarget, updaters) {
  const wrap = document.createElement('span')
  wrap.className = 'ow-wysiwyg-menu'
  const btn = iconButton('fas fa-table', 'Table')
  btn.innerHTML = '<i class="fas fa-table"></i><i class="fas fa-caret-down ow-wysiwyg-caret"></i>'
  btn.classList.add('ow-wysiwyg-btn-menu')
  const list = document.createElement('div')
  list.className = 'ow-wysiwyg-menu-list'
  const items = []
  for (const entry of TABLE_MENU) {
    if (entry === '-') {
      const hr = Object.assign(document.createElement('div'), { className: 'ow-wysiwyg-menu-sep' })
      list.append(hr)
      items.push({ hr })
      continue
    }
    const [icon, label, handlers] = entry
    const item = document.createElement('button')
    item.type = 'button'
    item.className = 'ow-wysiwyg-menu-item'
    item.innerHTML = `<i class="${icon}"></i> `
    item.append(label)
    item.addEventListener('mousedown', (ev) => ev.preventDefault())
    item.addEventListener('click', () => {
      close()
      const h = handlerOf(handlers, getTarget())
      if (h) h(getTarget())
    })
    list.append(item)
    items.push({ item, handlers, insert: icon === 'fas fa-table' })
  }
  const close = () => {
    list.classList.remove('open')
    document.removeEventListener('mousedown', outside, true)
  }
  const outside = (e) => {
    if (!wrap.contains(e.target)) close()
  }
  btn.addEventListener('click', () => {
    if (list.classList.toggle('open')) document.addEventListener('mousedown', outside, true)
    else close()
  })
  updaters.push(() => {
    const t = getTarget()
    const inTable = t.mode === 'visual' ? t.editor.isActive('table') : true
    let shown = 0
    for (const it of items) {
      if (it.hr) continue
      const h = handlerOf(it.handlers, t)
      it.item.style.display = h ? '' : 'none'
      it.item.disabled = !it.insert && !inTable
      if (h) shown++
    }
    // the separator only between the insert entry and the others
    for (const it of items) if (it.hr) it.hr.style.display = shown > 1 ? '' : 'none'
  })
  wrap.append(btn, list)
  return wrap
}
