// The visual editor's toolbar. Font Awesome icons, as in the wiki's own editor.

import { ALERT_TYPES } from './syntax.js'

const para = (text = '') => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] })

function wikiPages() {
  // the editor page lists the wiki's pages in its sidebar (WikiLink select)
  const s = document.getElementById('wikilink')
  return s ? [...s.options].map((o) => o.value).filter(Boolean) : []
}

function promptWikiLink(editor) {
  const pages = wikiPages()
  const hint = pages.length ? ` (e.g. ${pages.slice(0, 3).join(', ')})` : ''
  const target = window.prompt(`Page to link${hint}`)
  if (!target || !target.trim()) return
  const { from, to, empty } = editor.state.selection
  const text = empty ? '' : editor.state.doc.textBetween(from, to, ' ')
  const inner = text && text !== target.trim() ? `${text}|${target.trim()}` : target.trim()
  editor.chain().focus().insertContent({ type: 'owWikiLink', attrs: { inner } }).run()
}

function promptLink(editor) {
  const prev = editor.getAttributes('link').href || ''
  const href = window.prompt('Link URL (empty to remove)', prev)
  if (href === null) return
  if (href === '') editor.chain().focus().extendMarkRange('link').unsetLink().run()
  else editor.chain().focus().extendMarkRange('link').setLink({ href }).run()
}

function promptImage(editor) {
  const src = window.prompt('Image URL or attachment path (you can also paste or drop an image)')
  if (src) editor.chain().focus().setImage({ src, alt: '' }).run()
}

const block = (type, attrs) => (editor) =>
  editor.chain().focus().insertContent({ type, attrs, content: [para()] }).run()

// [icon, title, run, isActive?] ; '|' separates groups
const BUTTONS = [
  ['fas fa-undo', 'Undo', (e) => e.chain().focus().undo().run()],
  ['fas fa-redo', 'Redo', (e) => e.chain().focus().redo().run()],
  '|',
  ['fa fa-bold', 'Bold', (e) => e.chain().focus().toggleBold().run(), (e) => e.isActive('bold')],
  ['fa fa-italic', 'Italic', (e) => e.chain().focus().toggleItalic().run(), (e) => e.isActive('italic')],
  ['fa fa-strikethrough', 'Strikethrough', (e) => e.chain().focus().toggleStrike().run(), (e) => e.isActive('strike')],
  ['fas fa-highlighter', 'Mark', (e) => e.chain().focus().toggleHighlight().run(), (e) => e.isActive('highlight')],
  ['fas fa-code', 'Inline code', (e) => e.chain().focus().toggleCode().run(), (e) => e.isActive('code')],
  '|',
  ['heading', 'Paragraph style'],
  '|',
  ['fas fa-list-ul', 'Bullet list', (e) => e.chain().focus().toggleBulletList().run(), (e) => e.isActive('bulletList')],
  ['fas fa-list-ol', 'Numbered list', (e) => e.chain().focus().toggleOrderedList().run(), (e) => e.isActive('orderedList')],
  ['fas fa-tasks', 'Checklist', (e) => e.chain().focus().toggleTaskList().run(), (e) => e.isActive('taskList')],
  ['fas fa-quote-left', 'Quote', (e) => e.chain().focus().toggleBlockquote().run(), (e) => e.isActive('blockquote')],
  ['fas fa-file-code', 'Code block', (e) => e.chain().focus().toggleCodeBlock().run(), (e) => e.isActive('codeBlock')],
  ['fas fa-minus', 'Horizontal line', (e) => e.chain().focus().setHorizontalRule().run()],
  '|',
  ['fas fa-link', 'Link', promptLink, (e) => e.isActive('link')],
  ['fas fa-book', 'Wiki link', promptWikiLink],
  ['far fa-image', 'Image', promptImage],
  ['fas fa-table', 'Table', (e) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()],
  ['table', 'Table tools'],
  '|',
  ['fas fa-info-circle', 'Coloured block', block('owPanel', { family: 'info' })],
  ['fas fa-exclamation-triangle', 'Alert', block('owAlert', { type: 'NOTE' })],
  ['fas fa-caret-square-down', 'Folded block', block('owFold', { summary: 'Summary', level: 3 })],
  ['fas fa-eye-slash', 'Spoiler', block('owSpoiler')],
  ['fab fa-markdown', 'Markdown source block', (e) => e.chain().focus().insertContent({ type: 'owRawBlock', attrs: { source: '' } }).run()],
]

const HEADINGS = [['Paragraph', 0], ['Heading 1', 1], ['Heading 2', 2], ['Heading 3', 3], ['Heading 4', 4]]

const TABLE_TOOLS = [
  ['Add row below', (e) => e.chain().focus().addRowAfter().run()],
  ['Add column right', (e) => e.chain().focus().addColumnAfter().run()],
  ['Delete row', (e) => e.chain().focus().deleteRow().run()],
  ['Delete column', (e) => e.chain().focus().deleteColumn().run()],
  ['Toggle header row', (e) => e.chain().focus().toggleHeaderRow().run()],
  ['Delete table', (e) => e.chain().focus().deleteTable().run()],
]

export function buildToolbar(editor) {
  const bar = document.createElement('div')
  bar.className = 'ow-wysiwyg-toolbar'
  const refresh = []

  for (const b of BUTTONS) {
    if (b === '|') {
      bar.append(Object.assign(document.createElement('span'), { className: 'ow-wysiwyg-sep' }))
      continue
    }
    const [icon, title, run, isActive] = b
    if (icon === 'heading') {
      const s = document.createElement('select')
      s.className = 'ow-wysiwyg-select'
      s.title = title
      for (const [label, level] of HEADINGS) s.append(new Option(label, String(level)))
      s.addEventListener('change', () => {
        const level = Number(s.value)
        if (level === 0) editor.chain().focus().setParagraph().run()
        else editor.chain().focus().setHeading({ level }).run()
      })
      refresh.push(() => {
        const h = HEADINGS.find(([, l]) => l && editor.isActive('heading', { level: l }))
        s.value = String(h ? h[1] : 0)
      })
      bar.append(s)
      continue
    }
    if (icon === 'table') {
      const s = document.createElement('select')
      s.className = 'ow-wysiwyg-select'
      s.title = title
      s.append(new Option('Table…', ''))
      TABLE_TOOLS.forEach(([label], i) => s.append(new Option(label, String(i))))
      s.addEventListener('change', () => {
        if (s.value !== '') TABLE_TOOLS[Number(s.value)][1](editor)
        s.value = ''
      })
      refresh.push(() => (s.disabled = !editor.isActive('table')))
      bar.append(s)
      continue
    }
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'btn btn-xs ow-wysiwyg-btn'
    btn.title = title
    btn.innerHTML = `<i class="${icon}"></i>`
    // keep the editor's selection: act on mousedown, not after a focus change
    btn.addEventListener('mousedown', (ev) => ev.preventDefault())
    btn.addEventListener('click', () => run(editor))
    if (isActive) refresh.push(() => btn.classList.toggle('active', isActive(editor)))
    bar.append(btn)
  }

  const update = () => refresh.forEach((f) => f())
  editor.on('selectionUpdate', update)
  editor.on('transaction', update)
  update()
  return bar
}

export { ALERT_TYPES }
