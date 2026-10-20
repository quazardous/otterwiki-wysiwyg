// A light CodeMirror stream mode for the wiki's Markdown, for the section
// editor: @codemirror/lang-markdown would bring HTML, CSS and JavaScript modes.
// Highlighting only, line by line; tags are the standard @lezer/highlight ones.

import { StreamLanguage } from '@codemirror/language'
import { tags } from '@lezer/highlight'

export const markdownMode = StreamLanguage.define({
  name: 'markdown',
  // token names -> highlight tags (see theme.js for their colours)
  tokenTable: {
    heading: tags.heading,
    keyword: tags.keyword,
    list: tags.atom,
    meta: tags.meta,
    monospace: tags.monospace,
    link: tags.link,
    special: tags.special(tags.string),
    strong: tags.strong,
    emphasis: tags.emphasis,
    strikethrough: tags.strikethrough,
    separator: tags.punctuation,
    contentSeparator: tags.contentSeparator,
  },
  startState: () => ({ fence: null }),
  copyState: (s) => ({ fence: s.fence }),
  token(stream, state) {
    // inside a code fence: everything is code until the closing fence
    if (state.fence) {
      if (stream.sol() && stream.match(new RegExp(`^ {0,3}${state.fence}[\`~]*\\s*$`))) {
        state.fence = null
        return 'meta'
      }
      stream.skipToEnd()
      return 'monospace'
    }
    if (stream.sol()) {
      const fence = stream.match(/^ {0,3}(`{3,}|~{3,})/)
      if (fence) {
        state.fence = fence[1]
        stream.skipToEnd()
        return 'meta'
      }
      if (stream.match(/^ {0,3}#{1,6}(\s|$)/)) {
        stream.skipToEnd()
        return 'heading'
      }
      // wiki blocks and quotes: ::: info, >| fold, >! spoiler, > quote, > [!NOTE]
      if (stream.match(/^ {0,3}:{3,}.*$/) || stream.match(/^ {0,3}>\s*\[![A-Za-z]+\]/) || stream.match(/^ {0,3}>[|!]?/)) return 'keyword'
      if (stream.match(/^\s*([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/)) return 'list'
      if (stream.match(/^ {0,3}([-*_])(\s*\1){2,}\s*$/)) return 'contentSeparator'
      if (stream.match(/^\s*\|/)) return 'separator'
    }
    if (stream.match(/^`[^`]*`/)) return 'monospace'
    if (stream.match(/^\[\[[^\]]+\]\]/)) return 'link'
    if (stream.match(/^!?\[[^\]]*\]\([^)]*\)/)) return 'link'
    if (stream.match(/^==[^=]+==/)) return 'special'
    if (stream.match(/^(\*\*|__)(?=\S).+?\1/)) return 'strong'
    if (stream.match(/^(\*|_)(?=\S).+?\1/)) return 'emphasis'
    if (stream.match(/^~~.+?~~/)) return 'strikethrough'
    if (stream.match(/^\|/)) return 'separator'
    stream.next()
    stream.eatWhile(/[^`[!=*_~|\\]/)
    return null
  },
})
