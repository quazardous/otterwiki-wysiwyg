// Lossless Markdown round trip for the visual editor.
//
// A Markdown serializer always normalizes: list markers, escaping, blank lines,
// table padding... Saving a page from a visual editor would then rewrite every
// block of it, even the ones nobody touched, and fill the git history with noise.
//
// So the page is cut into top-level blocks with the same lexer the editor uses.
// Each block remembers its exact source and the editor nodes it produced. When
// the document is written back, a run of nodes that is still identical to a
// block's nodes is written as that block's ORIGINAL source; only blocks that
// were edited (or are new) go through the serializer. Opening a page and saving
// it without changes gives the very same bytes.
//
// A block the editor cannot write back faithfully (serialize then parse does not
// give the same nodes) is loaded as an owRawBlock: it stays Markdown source,
// editable as source, and is never rewritten by the serializer.

const FRONTMATTER = /^---\n[\s\S]*?\n---(\n|$)/

const fingerprint = (nodes) => JSON.stringify(nodes)

// Runs of spaces in text, as the wiki shows them: one space. Only to tell
// whether a block can be written back (a table cell loses its double spaces,
// and a non-breaking space next to a space),
// never to match blocks. Code keeps its spaces.
function collapseSpaces(nodes) {
  return nodes.map(function walk(n) {
    if (n.type === 'codeBlock') return n
    const out = { ...n }
    if (n.type === 'text' && !(n.marks || []).some((m) => m.type === 'code')) out.text = n.text.replace(/[ \u00a0]{2,}/g, ' ')
    if (n.content) out.content = n.content.map(walk)
    return out
  })
}

// one empty paragraph
const isSpacer = (nodes) => nodes.length === 1 && nodes[0].type === 'paragraph' && !(nodes[0].content && nodes[0].content.length)

// A newline inside a text node (a soft line break of Markdown) becomes a
// hardBreak marked soft: the browser would turn it into a hard one anyway.
// Code keeps its newlines.
export function splitSoftBreaks(node) {
  if (node.type === 'codeBlock' || !node.content) return node
  const content = []
  for (const child of node.content) {
    if (child.type === 'text' && child.text.includes('\n')) {
      child.text.split('\n').forEach((part, i) => {
        if (i > 0) content.push({ type: 'hardBreak', attrs: { soft: true } })
        if (part !== '') content.push({ ...child, text: part })
      })
    } else {
      content.push(splitSoftBreaks(child))
    }
  }
  return { ...node, content }
}

// Leading and trailing newlines of a block belong to the separators around it.
function trimNewlines(raw) {
  const start = raw.length - raw.replace(/^\n+/, '').length
  const body = raw.slice(start).replace(/\n+$/, '')
  return { start, body }
}

export class RoundTrip {
  /**
   * @param {object} manager the MarkdownManager of the editor (editor.markdown, or a standalone one)
   * @param {object} schema the ProseMirror schema of the editor: nodes are compared once
   *   completed with their default attributes, as the editor holds them
   */
  constructor(manager, schema) {
    this.manager = manager
    this.schema = schema
    this.source = ''
    this.blocks = []
  }

  normalize(nodes) {
    return nodes.map((n) => this.schema.nodeFromJSON(n).toJSON())
  }

  parseNodes(markdown) {
    return this.normalize((this.manager.parse(markdown).content || []).map(splitSoftBreaks))
  }

  serializeNodes(nodes) {
    return this.manager.serialize({ type: 'doc', content: nodes }).replace(/\n+$/, '')
  }

  // a block is safe to edit visually when writing it back reads as the same nodes
  isFaithful(nodes, body = '') {
    if (nodes.length === 0) return false
    // A spacer: a line of non-breaking spaces (&nbsp; paragraphs of other
    // editors), an empty paragraph in the editor. It has no Markdown form of its
    // own, but untouched it is written back as it was (serialize).
    if (isSpacer(nodes) && /^[\s\u00a0]*$/.test(body) && body.includes('\u00a0')) return true
    return fingerprint(collapseSpaces(this.parseNodes(this.serializeNodes(nodes)))) === fingerprint(collapseSpaces(nodes))
  }

  /**
   * Load a page. Returns the editor document (JSON).
   */
  load(markdown) {
    this.source = markdown
    this.blocks = []
    let offset = 0
    const fm = markdown.match(FRONTMATTER)
    if (fm) {
      const body = fm[0].replace(/\n$/, '')
      this.addBlock(0, body, [{ type: 'owRawBlock', attrs: { source: body } }])
      offset = fm[0].length
    }
    const tokens = this.manager.instance.lexer(markdown.slice(offset))
    for (const token of tokens) {
      const raw = token.raw || ''
      if (token.type !== 'space') {
        const { start, body } = trimNewlines(raw)
        if (body !== '') {
          let nodes = this.parseNodes(body)
          const fallback = !this.isFaithful(nodes, body)
          if (fallback) nodes = [{ type: 'owRawBlock', attrs: { source: body } }]
          this.addBlock(offset + start, body, nodes, fallback)
        }
      }
      offset += raw.length
    }
    return { type: 'doc', content: this.blocks.flatMap((b) => b.nodes) }
  }

  // fallback: a block kept as source because the editor could not write it back
  addBlock(start, body, nodes, fallback = false) {
    nodes = this.normalize(nodes)
    this.blocks.push({ start, end: start + body.length, body, nodes, fp: fingerprint(nodes), fallback })
  }

  /**
   * Write the editor document back to Markdown.
   */
  serialize(doc) {
    const nodes = this.normalize(doc.content || [])
    const pieces = []
    const used = new Set()
    let next = 0 // the block expected next, to keep blocks in their original order
    let i = 0
    while (i < nodes.length) {
      const b = this.matchBlock(nodes, i, next, used)
      if (b !== null) {
        used.add(b)
        pieces.push({ text: this.blocks[b].body, block: b })
        i += this.blocks[b].nodes.length
        next = b + 1
      } else if (isSpacer([nodes[i]])) {
        // a new empty paragraph (Enter pressed twice) has no Markdown form
        i += 1
      } else {
        // an edited or new node: serialized
        pieces.push({ text: this.serializeNodes([nodes[i]]), block: null })
        i += 1
      }
    }
    return this.join(pieces)
  }

  /**
   * The sections of the loaded page, in its Markdown source: one per top-level
   * heading, from the heading to the next heading of the same level or higher.
   * Offsets are in the source; `end` is the start of the next such heading (the
   * blank lines before it belong to the section), or the end of the page.
   * @returns {{ index, title, level, start, end }[]}
   */
  sections() {
    const headings = this.blocks.filter((b) => b.nodes.length === 1 && b.nodes[0].type === 'heading')
    return headings.map((b, index) => {
      const level = b.nodes[0].attrs.level
      const next = headings.slice(index + 1).find((h) => h.nodes[0].attrs.level <= level)
      const title = (b.nodes[0].content || []).map((n) => n.text || n.attrs?.inner || '').join('').trim()
      return { index, title, level, start: b.start, end: next ? next.start : this.source.length }
    })
  }

  // the unused block whose nodes start at nodes[i], preferring the expected one
  matchBlock(nodes, i, next, used) {
    const fits = (b) => {
      const blk = this.blocks[b]
      return !used.has(b) && fingerprint(nodes.slice(i, i + blk.nodes.length)) === blk.fp
    }
    if (next < this.blocks.length && fits(next)) return next
    for (let b = 0; b < this.blocks.length; b++) if (fits(b)) return b
    return null
  }

  join(pieces) {
    if (pieces.length === 0) return ''
    const src = this.source
    let out = ''
    pieces.forEach((p, k) => {
      if (k === 0) {
        // leading blank lines of the page, if it still starts with its first block
        out += p.block === 0 ? src.slice(0, this.blocks[0].start) : ''
      } else {
        const prev = pieces[k - 1]
        out += prev.block !== null && p.block === prev.block + 1
          ? src.slice(this.blocks[prev.block].end, this.blocks[p.block].start) // original separator
          : '\n\n'
      }
      out += p.text
    })
    const last = pieces[pieces.length - 1]
    const lastBlock = this.blocks.length - 1
    out += last.block === lastBlock ? src.slice(this.blocks[lastBlock].end) : '\n'
    return out
  }
}
