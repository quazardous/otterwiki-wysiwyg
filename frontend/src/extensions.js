// The editor's extensions, shared by the browser bundle and the tests.

import StarterKit from '@tiptap/starter-kit'
import HardBreak from '@tiptap/extension-hard-break'
import { Markdown } from '@tiptap/markdown'
import { TableKit } from '@tiptap/extension-table'
import Highlight from '@tiptap/extension-highlight'
import Image from '@tiptap/extension-image'
import { TaskList, TaskItem } from '@tiptap/extension-list'
import { otterwikiSyntax } from './syntax.js'

// A line break inside a paragraph. Markdown has two: a soft one (a plain newline,
// joined into the paragraph by the wiki) and a hard one ("  " or "\\" at the end
// of the line). In a browser the editor turns a newline in the text into a <br>,
// so soft ones are kept as breaks marked soft, written back as a plain newline
// (see splitSoftBreaks in roundtrip.js).
const LineBreak = HardBreak.extend({
  addAttributes() {
    return {
      soft: {
        default: false,
        // in the DOM too: typing makes the browser re-read the paragraph
        parseHTML: (el) => el.hasAttribute('data-soft'),
        renderHTML: (attrs) => (attrs.soft ? { 'data-soft': '' } : {}),
      },
    }
  },
  renderMarkdown: (node) => (node.attrs && node.attrs.soft ? '\n' : '  \n'),
})

// nodeViews: { nodeName: () => nodeViewFactory }, browser only (nodeviews.js)
export function buildExtensions({ nodeViews = {} } = {}) {
  const syntax = otterwikiSyntax.map((ext) => (nodeViews[ext.name] ? ext.extend({ addNodeView: nodeViews[ext.name] }) : ext))
  return [
    StarterKit.configure({
      // ++underline++ is not part of the wiki's Markdown
      underline: false,
      hardBreak: false,
      link: { openOnClick: false, autolink: true },
    }),
    LineBreak,
    TableKit.configure({ table: { resizable: false } }),
    Highlight,
    Image,
    TaskList,
    TaskItem.configure({ nested: true }),
    ...syntax,
    Markdown,
  ]
}
