// Option WYSIWYG_SECTION_EDIT: the Markdown source of one section of the page,
// in an editor of its own, under the Markdown tab ("Whole page" | "Section").
//
// The section is the exact source text from its heading to the next heading of
// the same level or higher (RoundTrip.sections). Every keystroke writes the page
// back to the wiki's own editor as  before + section + after, so drafts, live
// preview and save always have the whole page. New headings typed here are new
// sections of the page.

import { EditorState } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, drawSelection, highlightActiveLine } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab, undo, redo } from '@codemirror/commands'
import { markdownMode } from './markdown-mode.js'
import { sectionTheme } from './section-theme.js'

export class SectionEditor {
  /**
   * @param {EditorView} page the wiki's editor (the whole page)
   * @param {RoundTrip} roundtrip to find the sections of the page
   * @param {(text: string) => void} onChange called with the section text after each change
   */
  constructor(page, roundtrip, onChange) {
    this.page = page
    this.roundtrip = roundtrip
    this.onChange = onChange
    this.view = null
    this.before = ''
    this.after = ''
    this.dom = document.createElement('div')
    this.dom.className = 'ow-wysiwyg-section-editor'
    // A shadow root of its own: this CodeMirror comes from another bundle than
    // the wiki's, and two copies on one document replace each other's adopted
    // style sheets (the wiki's editor, or this one, loses its colours).
    this.shadow = this.dom.attachShadow({ mode: 'open' })
    this.mount = document.createElement('div')
    this.shadow.append(this.mount)
    // Keys typed here stay here: from outside, the shadow root hides the editable
    // element, and the wiki's keyboard shortcuts (c: create page, e: edit...)
    // would take the letters for themselves.
    for (const type of ['keydown', 'keypress', 'keyup']) this.dom.addEventListener(type, (e) => e.stopPropagation())
  }

  get pageText() {
    return this.page.state.doc.toString()
  }

  sections() {
    this.roundtrip.load(this.pageText)
    return this.roundtrip.sections()
  }

  get text() {
    return this.view ? this.view.state.doc.toString() : ''
  }

  // open section `index` of the page as it is now; false if there is none
  open(index) {
    const page = this.pageText
    const s = this.sections()[index]
    if (!s) return false
    this.close()
    this.index = index
    this.title = s.title
    this.before = page.slice(0, s.start)
    this.after = page.slice(s.end)
    this.view = new EditorView({
      parent: this.mount,
      root: this.shadow,
      state: EditorState.create({
        doc: page.slice(s.start, s.end),
        extensions: [
          lineNumbers(),
          history(),
          drawSelection(),
          highlightActiveLine(),
          EditorView.lineWrapping,
          markdownMode,
          sectionTheme(),
          keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) this.write()
          }),
        ],
      }),
    })
    this.onChange(this.text)
    return true
  }

  // the whole page, with this section's new text, into the wiki's editor
  write() {
    const page = this.before + this.text + this.after
    if (page !== this.pageText) {
      this.page.dispatch({ changes: { from: 0, to: this.page.state.doc.length, insert: page } })
    }
    this.onChange(this.text)
  }

  jump(line) {
    if (!this.view) return
    const doc = this.view.state.doc
    const pos = doc.line(Math.min(Math.max(line, 1), doc.lines)).from
    this.view.dispatch({ selection: { anchor: pos }, scrollIntoView: true })
    this.view.focus()
  }

  // for the toolbar: the wiki's undo works on its own editor only
  undo() {
    if (this.view) undo(this.view)
  }

  redo() {
    if (this.view) redo(this.view)
  }

  focus() {
    if (this.view) this.view.focus()
  }

  close() {
    if (!this.view) return
    this.view.destroy()
    this.view = null
  }
}
