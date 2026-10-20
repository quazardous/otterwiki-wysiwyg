// otterwiki-wysiwyg: a visual editor for An Otter Wiki.
//
// The wiki's own Markdown editor (CodeMirror 6, `window.cm_editor`) stays in
// charge: drafts, live preview, save and "unsaved changes" all read it. The
// visual editor is a second view of the same page: every change made in it is
// written back to CodeMirror as Markdown (roundtrip.js keeps untouched blocks
// byte for byte), and switching back to the source shows exactly that text.

import { Editor } from '@tiptap/core'
import { buildExtensions } from './extensions.js'
import { nodeViews } from './nodeviews.js'
import { buildToolbar } from './toolbar.js'
import { RoundTrip } from './roundtrip.js'
import { lintMarkdown } from './lint.js'
import './wysiwyg.css'

const STORAGE_KEY = 'otterwiki_wysiwyg_mode'

function remember(mode) {
  try {
    localStorage.setItem(STORAGE_KEY, mode)
  } catch (e) {}
}

function remembered() {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch (e) {
    return null
  }
}

// /Some/Page/save -> /Some/Page/inline_attachment (the wiki's paste upload endpoint)
function uploadUrl() {
  const form = document.getElementById('saveform')
  return form ? form.getAttribute('action').replace(/\/save(\?.*)?$/, '/inline_attachment') : null
}

async function uploadImage(file) {
  const url = uploadUrl()
  if (!url) throw new Error('no upload endpoint')
  const body = new FormData()
  body.append('file', file, file.name || 'pasted.png')
  const token = document.querySelector('meta[name="csrf-token"]')
  const res = await fetch(url, { method: 'POST', body, headers: token ? { 'X-CSRFToken': token.content } : {} })
  if (!res.ok) throw new Error(`upload failed: ${res.status}`)
  const json = await res.json()
  if (!json.filename) throw new Error('upload: no filename in the answer')
  return json.filename
}

// option WYSIWYG_SECTION_EDIT: the section to edit, from ?section=N (sections.js)
function requestedSection() {
  const config = window.otterwiki_wysiwyg || {}
  if (!config.sectionEdit) return null
  const n = new URLSearchParams(location.search).get('section')
  return n !== null && /^\d+$/.test(n) ? Number(n) : null
}

class VisualEditor {
  constructor(cm) {
    this.cm = cm
    this.editor = null
    this.host = null
    this.syncing = false
    this.section = requestedSection()
    this.range = null
  }

  get cmText() {
    return this.cm.state.doc.toString()
  }

  // write the visual document back to CodeMirror (drafts, preview and save follow)
  sync() {
    if (!this.editor) return
    const doc = this.editor.getJSON()
    const md = this.range ? this.roundtrip.serializeSection(this.range, doc.content || []) : this.roundtrip.serialize(doc)
    if (md === this.cmText) return
    this.syncing = true
    this.cm.dispatch({ changes: { from: 0, to: this.cm.state.doc.length, insert: md } })
    this.syncing = false
  }

  open(container, problems = []) {
    const extensions = buildExtensions({ nodeViews })
    this.host = document.createElement('div')
    this.host.className = 'ow-wysiwyg'
    const surface = document.createElement('div')
    surface.className = 'ow-wysiwyg-surface page'
    this.editor = new Editor({
      element: surface,
      extensions,
      content: '',
      editorProps: {
        attributes: { class: 'ow-wysiwyg-content', spellcheck: 'true' },
        handlePaste: (view, event) => this.dropFiles(event.clipboardData && event.clipboardData.files),
        handleDrop: (view, event) => this.dropFiles(event.dataTransfer && event.dataTransfer.files),
      },
    })
    this.roundtrip = new RoundTrip(this.editor.markdown, this.editor.schema)
    // load without recording an undo step nor a change
    const doc = this.roundtrip.load(this.cmText)
    this.range = this.section === null ? null : this.roundtrip.section(this.section)
    const content = this.range ? { type: 'doc', content: this.roundtrip.sectionNodes(this.range) } : doc
    this.editor.commands.setContent(content, { emitUpdate: false })
    this.editor.on('update', () => this.sync())

    const shown = this.range ? this.roundtrip.blocks.slice(this.range.from, this.range.to) : this.roundtrip.blocks
    const raw = shown.filter((b) => b.nodes.length === 1 && b.nodes[0].type === 'owRawBlock').length
    this.host.append(buildToolbar(this.editor))
    if (this.section !== null) this.host.append(this.sectionBanner(container, problems))
    const errors = problems.filter((p) => p.severity === 'error').length
    if (errors) {
      const warn = document.createElement('div')
      warn.className = 'ow-wysiwyg-note ow-wysiwyg-note-error'
      warn.textContent = `The Markdown has ${errors} error${errors > 1 ? 's' : ''} (see the Markdown tab): this page may not look as intended.`
      this.host.append(warn)
    }
    if (raw) {
      const note = document.createElement('div')
      note.className = 'ow-wysiwyg-note'
      note.textContent = `${raw} block${raw > 1 ? 's are' : ' is'} kept as Markdown source (shown in grey): they are saved exactly as written.`
      this.host.append(note)
    }
    this.host.append(surface)
    container.append(this.host)
    this.editor.commands.focus('start')
  }

  // "Editing section X: edit the whole page"
  sectionBanner(container, problems) {
    const banner = document.createElement('div')
    banner.className = 'ow-wysiwyg-note ow-wysiwyg-section'
    const whole = document.createElement('button')
    whole.type = 'button'
    whole.className = 'btn btn-xs ml-10'
    whole.textContent = 'Edit the whole page'
    whole.addEventListener('click', () => {
      this.section = null
      this.close()
      this.open(container, problems)
    })
    banner.append(this.range
      ? `Editing the section "${this.range.title}" only: the rest of the page is kept as is.`
      : `Section ${this.section + 1} not found in this page.`)
    banner.append(whole)
    return banner
  }

  dropFiles(files) {
    const images = [...(files || [])].filter((f) => f.type.startsWith('image/'))
    if (!images.length) return false
    for (const f of images) {
      uploadImage(f)
        .then((src) => this.editor.chain().focus().setImage({ src, alt: src.replace(/^\.\//, '') }).run())
        .catch((e) => window.alert(`Image upload failed: ${e.message}`))
    }
    return true
  }

  close() {
    if (!this.editor) return
    this.sync()
    this.editor.destroy()
    this.editor = null
    this.host.remove()
    this.host = null
  }
}

// Problems of the Markdown source (lint.js), under the source editor.
class LintPanel {
  constructor(cm, onCount) {
    this.cm = cm
    this.onCount = onCount
    this.dom = document.createElement('div')
    this.dom.className = 'ow-wysiwyg-lint'
    this.timer = null
    this.problems = []
    this.roundtrip = null
  }

  // the checks reuse a headless round trip with the editor's schema
  attach(roundtrip) {
    this.roundtrip = roundtrip
    this.run()
  }

  schedule() {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.run(), 400)
  }

  run() {
    this.problems = lintMarkdown(this.cm.state.doc.toString(), this.roundtrip)
    this.render()
    this.onCount(this.problems)
  }

  jump(line) {
    const doc = this.cm.state.doc
    const pos = doc.line(Math.min(Math.max(line, 1), doc.lines)).from
    this.cm.dispatch({ selection: { anchor: pos }, scrollIntoView: true })
    this.cm.focus()
  }

  render() {
    this.dom.textContent = ''
    if (!this.problems.length) {
      this.dom.append(Object.assign(document.createElement('div'), { className: 'ow-wysiwyg-lint-ok', textContent: 'Markdown check: no problem.' }))
      return
    }
    for (const p of this.problems) {
      const row = document.createElement('button')
      row.type = 'button'
      row.className = `ow-wysiwyg-lint-item ow-wysiwyg-lint-${p.severity}`
      row.innerHTML = `<i class="fas ${p.severity === 'error' ? 'fa-times-circle' : 'fa-exclamation-triangle'}"></i> <b>Line ${p.line}</b> `
      row.append(document.createTextNode(p.message))
      row.addEventListener('click', () => this.jump(p.line))
      this.dom.append(row)
    }
  }
}

function install() {
  const cm = window.cm_editor
  const block = document.getElementById('editor_block')
  const splitBtn = document.getElementById('split_btn')
  if (!cm || !block) return false

  const visual = new VisualEditor(cm)
  // the wiki's formatting buttons act on CodeMirror: hidden in the visual tab
  const sourceTools = () => [...document.querySelectorAll('.btn-editor')].map((b) => b.closest('.dropdown') || b)

  // tabs: Visual | Markdown (with the number of problems found by the check)
  const tabs = document.createElement('div')
  tabs.className = 'ow-wysiwyg-tabs'
  const tab = (id, icon, label) => {
    const t = document.createElement('button')
    t.type = 'button'
    t.id = id
    t.className = 'ow-wysiwyg-tab'
    t.innerHTML = `<i class="${icon}"></i> ${label} <span class="ow-wysiwyg-badge"></span>`
    tabs.append(t)
    return t
  }
  const visualTab = tab('wysiwyg_tab_visual', 'fas fa-magic', 'Visual')
  const sourceTab = tab('wysiwyg_tab_source', 'fab fa-markdown', 'Markdown')
  block.before(tabs)

  const lint = new LintPanel(cm, (problems) => {
    const errors = problems.filter((p) => p.severity === 'error').length
    const badge = sourceTab.querySelector('.ow-wysiwyg-badge')
    badge.textContent = problems.length ? String(problems.length) : ''
    badge.className = `ow-wysiwyg-badge${errors ? ' error' : problems.length ? ' warning' : ''}`
    sourceTab.title = problems.length ? `${problems.length} Markdown problem(s), ${errors} error(s)` : 'Markdown source'
  })
  // above the source: the page can be long
  cm.dom.before(lint.dom)
  cm.dom.addEventListener('cm6change', () => {
    if (!visual.syncing) lint.schedule()
  })
  // a headless round trip for the checks: same extensions and schema as the editor
  const probe = new Editor({ extensions: buildExtensions(), content: '' })
  lint.attach(new RoundTrip(probe.markdown, probe.schema))

  const setVisual = (on) => {
    if (on === !!visual.editor) return
    if (on) {
      // the live preview shows the source: not with the visual editor
      if (splitBtn && splitBtn.classList.contains('btn-primary')) splitBtn.click()
      block.classList.add('ow-wysiwyg-visual')
      visual.open(block, lint.problems)
    } else {
      visual.close()
      block.classList.remove('ow-wysiwyg-visual')
      lint.run()
      cm.focus()
    }
    for (const t of sourceTools()) t.style.display = on ? 'none' : ''
    if (splitBtn) splitBtn.style.display = on ? 'none' : ''
    visualTab.classList.toggle('active', on)
    sourceTab.classList.toggle('active', !on)
    remember(on ? 'visual' : 'source')
  }

  visualTab.addEventListener('click', () => setVisual(true))
  sourceTab.addEventListener('click', () => setVisual(false))
  // the save button reads CodeMirror: make sure it has the last keystroke
  document.addEventListener('mousedown', (e) => {
    if (visual.editor && e.target.closest('#save-page-btn, #saveform, #preview_btn')) visual.sync()
  }, true)

  setVisual(remembered() !== 'source')
  if (!visual.editor) {
    visualTab.classList.remove('active')
    sourceTab.classList.add('active')
  }
  return true
}

// the wiki creates its editor on load; wait for it
function start(tries = 0) {
  if (install()) return
  if (tries < 50) setTimeout(() => start(tries + 1), 100)
}

if (document.readyState === 'complete') start()
else window.addEventListener('load', () => start())
