// Look of the section editor: the colours of the wiki's own Markdown editor
// (An Otter Wiki, frontend/src/theme.js), light and dark.

import { EditorView } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'

const MONO = 'Consolas, Menlo, Monaco, Lucida Console, Liberation Mono, DejaVu Sans Mono, Bitstream Vera Sans Mono, Courier New, monospace'

const light = HighlightStyle.define([
  { tag: tags.heading, fontWeight: 'bold', color: '#000080' },
  { tag: tags.keyword, fontWeight: 'bold', color: '#000080' },
  { tag: tags.atom, color: '#1890ff' },
  { tag: tags.meta, color: '#808000' },
  { tag: tags.monospace, color: '#a074c4' },
  { tag: tags.link, color: '#1890ff' },
  { tag: tags.special(tags.string), color: '#008000' },
  { tag: tags.strong, fontWeight: 'bold' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.punctuation, color: '#999' },
  { tag: tags.contentSeparator, color: '#999' },
])

const dark = HighlightStyle.define([
  { tag: tags.heading, fontWeight: 'bold', color: '#b48ead' },
  { tag: tags.keyword, color: '#81A1C1' },
  { tag: tags.atom, color: '#bf616a' },
  { tag: tags.meta, color: '#88C0D0' },
  { tag: tags.monospace, color: '#6BBAFF' },
  { tag: tags.link, color: '#1890ff' },
  { tag: tags.special(tags.string), color: '#A3BE8C' },
  { tag: tags.strong, fontWeight: 'bold' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.punctuation, color: '#6BBAFF' },
  { tag: tags.contentSeparator, color: '#6BBAFF' },
])

const base = (isDark) =>
  EditorView.theme({
    '&': {
      minHeight: '14em',
      fontSize: '14px',
      color: isDark ? '#d8dee9' : '#000',
      backgroundColor: isDark ? '#25282c' : '#fff',
      border: `1px solid ${isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.15)'}`,
      borderRadius: '8px',
    },
    '&.cm-focused': { outline: 'none', borderColor: isDark ? '#5ab0ff' : '#1890ff' },
    '.cm-scroller': { fontFamily: MONO, minHeight: '14em' },
    '.cm-content': { caretColor: isDark ? '#f8f8f0' : '#000' },
    '&.cm-focused .cm-cursor': { borderLeftColor: isDark ? '#f8f8f0' : '#000' },
    '.cm-gutters': {
      backgroundColor: 'transparent',
      color: isDark ? '#4c566a' : '#999',
      borderRight: `1px solid ${isDark ? '#4c566a' : '#ddd'}`,
      borderRadius: '8px 0 0 8px',
    },
    '.cm-activeLine': { backgroundColor: isDark ? 'rgba(59,66,82,0.5)' : 'rgba(0,0,0,0.03)' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: isDark ? '#434c5e' : '#d7e8fb',
    },
  }, { dark: isDark })

export function sectionTheme() {
  const isDark = document.body.classList.contains('dark-mode')
  return [base(isDark), syntaxHighlighting(isDark ? dark : light)]
}
