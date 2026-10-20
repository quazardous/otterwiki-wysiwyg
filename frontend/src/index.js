// otterwiki-wysiwyg: a visual editor for An Otter Wiki.
//
// The wiki's own Markdown editor (CodeMirror 6, `window.cm_editor`) stays in
// charge: drafts, live preview, save and "unsaved changes" all read it. The
// visual editor is a second view of the same page: every change made in it is
// written back to CodeMirror as Markdown (roundtrip.js keeps untouched blocks
// byte for byte), and switching back to the source shows exactly that text.
//
// Tabs: Visual | Markdown. Under Markdown, with the option WYSIWYG_SECTION_EDIT,
// sub-tabs: Whole page | Section (section.js, the source of one section only).

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

const config = window.otterwiki_wysiwyg || {}

// section-editor.js, next to this script, loaded on first use (CodeMirror)
const bundleUrl = document.currentScript ? document.currentScript.src : ''
let sectionBundle = null
function loadSectionEditor() {
  if (window.otterwikiWysiwygSection) return Promise.resolve(window.otterwikiWysiwygSection)
  sectionBundle ??= new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = bundleUrl.replace(/wysiwyg\.js(\?|$)/, 'section-editor.js$1')
    s.onload = () => resolve(window.otterwikiWysiwygSection)
    s.onerror = () => reject(new Error('could not load section-editor.js'))
    document.head.append(s)
  })
  return sectionBundle
}

// option WYSIWYG_SECTION_EDIT: the section to open, from ?section=N (sections.js)
function requestedSection() {
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
  }

  get cmText() {
    return this.cm.state.doc.toString()
  }

  // write the visual document back to CodeMirror (drafts, preview and save follow)
  sync() {
    if (!this.editor) return
    // a section: its new text, between the untouched rest of the page
    const md = this.before + this.roundtrip.serialize(this.editor.getJSON()) + this.after
    if (md === this.cmText) return
    this.syncing = true
    this.cm.dispatch({ changes: { from: 0, to: this.cm.state.doc.length, insert: md } })
    this.syncing = false
  }

  /**
   * @param {object} [section] { title, start, end } offsets in the page source
   *   (RoundTrip.sections): edit that section only
   */
  open(container, problems = [], section = null) {
    const page = this.cmText
    this.before = section ? page.slice(0, section.start) : ''
    this.after = section ? page.slice(section.end) : ''
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
    const text = section ? page.slice(section.start, section.end) : page
    this.editor.commands.setContent(this.roundtrip.load(text), { emitUpdate: false })
    this.editor.on('update', () => this.sync())

    const raw = this.roundtrip.blocks.filter((b) => b.nodes.length === 1 && b.nodes[0].type === 'owRawBlock').length
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

// Problems of the Markdown source (lint.js), above the source editor. The target
// is the editor in view: the whole page, or one section.
class LintPanel {
  constructor(target, onCount) {
    this.target = target // { text(), jump(line) }
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
    this.problems = lintMarkdown(this.target.text(), this.roundtrip)
    this.render()
    this.onCount(this.problems)
  }

  jump(line) {
    this.target.jump(line)
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
  // one toolbar for both tabs, in place of the wiki's (hidden by wysiwyg.css)
  const toolbar = buildToolbar()
  toolbar.dom.classList.add('ow-wysiwyg-toolbar-shared')
  tabs.after(toolbar.dom)
  const pageTarget2 = {
    mode: 'markdown',
    page: true,
    view: cm,
    undo: () => window.otterwiki_editor && window.otterwiki_editor.undo(),
    redo: () => window.otterwiki_editor && window.otterwiki_editor.redo(),
  }
  const visualTarget = () => ({ mode: 'visual', editor: visual.editor })

  // the whole page in the wiki's editor
  const pageTarget = {
    text: () => cm.state.doc.toString(),
    jump: (line) => {
      const doc = cm.state.doc
      cm.dispatch({ selection: { anchor: doc.line(Math.min(Math.max(line, 1), doc.lines)).from }, scrollIntoView: true })
      cm.focus()
    },
  }
  const lint = new LintPanel(pageTarget, (problems) => {
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
  // a headless round trip for the checks and the sections: same schema as the editor
  const probe = new Editor({ extensions: buildExtensions(), content: '' })
  const probeTrip = new RoundTrip(probe.markdown, probe.schema)
  lint.attach(probeTrip)

  // ---- Markdown sub-tabs: Whole page | Section (option WYSIWYG_SECTION_EDIT)
  let section = null
  let subtabs = null
  // the open section (index in RoundTrip.sections), for both tabs; null = whole page
  let current = null
  const sectionSpan = (index) => {
    probeTrip.load(cm.state.doc.toString())
    return probeTrip.sections()[index] || null
  }
  if (config.sectionEdit) {
    // the editor itself comes with section-editor.js, on first use
    section = { dom: document.createElement('div'), editor: null }
    const sectionTrip = new RoundTrip(probe.markdown, probe.schema)
    const editorFor = () =>
      section.editor
        ? Promise.resolve(section.editor)
        : loadSectionEditor().then(({ SectionEditor }) => {
            section.editor = new SectionEditor(cm, sectionTrip, () => {
              lint.schedule()
              clearTimeout(section.timer)
              section.timer = setTimeout(() => section.refresh(), 400)
            })
            section.dom.append(section.editor.dom)
            return section.editor
          })
    // Whole page | Section…, at the right of the tabs: both tabs follow them
    subtabs = document.createElement('div')
    subtabs.className = 'ow-wysiwyg-scope'
    const whole = document.createElement('button')
    whole.type = 'button'
    whole.id = 'wysiwyg_subtab_page'
    whole.className = 'ow-wysiwyg-subtab'
    whole.innerHTML = '<i class="far fa-file-alt"></i> Whole page'
    const pick = document.createElement('select')
    pick.id = 'wysiwyg_subtab_section'
    pick.className = 'ow-wysiwyg-section-pick'
    pick.title = 'Edit one section only'
    const pickWrap = document.createElement('label')
    pickWrap.className = 'ow-wysiwyg-scope-pick'
    pickWrap.title = pick.title
    pickWrap.innerHTML = '<i class="fas fa-paragraph"></i>'
    pickWrap.append(pick)
    subtabs.append(whole, pickWrap)
    tabs.append(subtabs)
    lint.dom.after(section.dom)
    // in a section: Page › parent heading › section, each one clickable
    const crumbs = document.createElement('nav')
    crumbs.className = 'ow-wysiwyg-crumbs'
    crumbs.setAttribute('aria-label', 'Section')
    crumbs.style.display = 'none'
    tabs.after(crumbs)
    const pageName = decodeURIComponent(location.pathname.replace(/^\/+|\/+$/g, '')) || 'Home'
    const paintCrumbs = () => {
      crumbs.textContent = ''
      if (current === null) return (crumbs.style.display = 'none')
      probeTrip.load(cm.state.doc.toString())
      const list = probeTrip.sections()
      const here = list[current]
      if (!here) return (crumbs.style.display = 'none')
      const trail = []
      let level = here.level
      for (let i = current - 1; i >= 0; i--) {
        if (list[i].level < level) {
          trail.unshift(list[i])
          level = list[i].level
        }
      }
      const link = (label, onClick) => {
        const b = document.createElement('button')
        b.type = 'button'
        b.className = 'ow-wysiwyg-crumb'
        b.textContent = label
        b.addEventListener('click', onClick)
        return b
      }
      const sep = () => Object.assign(document.createElement('span'), { className: 'ow-wysiwyg-crumb-sep', textContent: '›' })
      crumbs.append(link(pageName, () => choose(null)))
      for (const t of trail) crumbs.append(sep(), link(t.title || '(untitled)', () => choose(t.index)))
      crumbs.append(sep(), Object.assign(document.createElement('span'), { className: 'ow-wysiwyg-crumb-here', textContent: here.title || '(untitled)' }))
      crumbs.style.display = ''
    }

    const fillSections = () => {
      probeTrip.load(cm.state.doc.toString())
      const list = probeTrip.sections()
      pick.textContent = ''
      pick.append(new Option(list.length ? 'Section…' : 'Section… (no heading)', ''))
      for (const s of list) pick.append(new Option(`${'\u2003'.repeat(s.level - 1)}${s.title || '(untitled)'}`, String(s.index)))
      pick.disabled = !list.length
    }
    const showSection = (index) =>
      editorFor().then((ed) => {
        if (index === null || !ed.open(index)) return showPage()
        current = index
        block.classList.add('ow-wysiwyg-section-mode')
        lint.target = { text: () => ed.text, jump: (line) => ed.jump(line) }
        toolbar.setTarget({ mode: 'markdown', page: false, view: ed.view, undo: () => ed.undo(), redo: () => ed.redo() })
        fillSections()
        paintScope()
        lint.run()
        ed.focus()
      }).catch((e) => {
        window.alert(e.message)
        showPage()
      })
    const showPage = () => {
      current = null
      if (section.editor) section.editor.close()
      block.classList.remove('ow-wysiwyg-section-mode')
      lint.target = pageTarget
      if (!visual.editor) toolbar.setTarget(pageTarget2)
      paintScope()
      lint.run()
    }
    // the scope (whole page, or section `current`) in both tabs
    const paintScope = () => {
      fillSections()
      pick.value = current === null ? '' : String(current)
      pickWrap.classList.toggle('active', current !== null)
      whole.classList.toggle('active', current === null)
      paintCrumbs()
    }
    // pick a scope from the current tab
    const choose = (index) => {
      if (visual.editor) {
        // the visual tab: reopen it on the section, or on the whole page
        current = index === null ? null : sectionSpan(index) ? index : null
        visual.close()
        visual.open(block, lint.problems, current === null ? null : sectionSpan(current))
        toolbar.setTarget(visualTarget())
        paintScope()
      } else if (index === null) {
        showPage()
      } else {
        showSection(index)
      }
    }
    whole.addEventListener('click', () => choose(null))
    // the list is the page's headings as they are now (new ones included)
    pick.addEventListener('focus', () => {
      const v = pick.value
      fillSections()
      pick.value = v
    })
    pick.addEventListener('change', () => choose(pick.value === '' ? null : Number(pick.value)))
    section.showPage = showPage
    section.showSection = showSection
    section.refresh = () => paintScope()
    section.paint = paintScope
    fillSections()
    whole.classList.add('active')
  }

  const setVisual = (on) => {
    if (on === !!visual.editor) return
    if (on) {
      // the live preview shows the source: not with the visual editor
      if (splitBtn && splitBtn.classList.contains('btn-primary')) splitBtn.click()
      // the open section stays open in the visual tab
      const span = current === null ? null : sectionSpan(current)
      if (section && section.editor) section.editor.close()
      block.classList.add('ow-wysiwyg-visual')
      visual.open(block, lint.problems, span)
      toolbar.setTarget(visualTarget())
      if (section) section.paint()
    } else {
      visual.close()
      block.classList.remove('ow-wysiwyg-visual')
      // back to the section that was open, as it is now
      if (section && current !== null) section.showSection(current)
      else {
        toolbar.setTarget(pageTarget2)
        lint.run()
        cm.focus()
      }
    }
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

  // ?section=N (the pencil of a heading): that section, in the visual tab
  const wanted = section ? requestedSection() : null
  if (wanted !== null && sectionSpan(wanted)) {
    current = wanted
    setVisual(true)
  } else {
    setVisual(remembered() !== 'source')
  }
  if (!visual.editor) {
    visualTab.classList.remove('active')
    sourceTab.classList.add('active')
    if (current === null) toolbar.setTarget(pageTarget2)
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
