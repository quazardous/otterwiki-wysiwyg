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
  isFaithful(nodes) {
    if (nodes.length === 0) return false
    return fingerprint(this.parseNodes(this.serializeNodes(nodes))) === fingerprint(nodes)
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
          const fallback = !this.isFaithful(nodes)
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
    // empty paragraphs (Enter pressed twice) have no Markdown form
    const nodes = this.normalize(doc.content || []).filter((n) => !(n.type === 'paragraph' && !(n.content && n.content.length)))
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
      } else {
        // an edited or new node: serialized, possibly merged with the next new ones
        pieces.push({ text: this.serializeNodes([nodes[i]]), block: null })
        i += 1
      }
    }
    return this.join(pieces)
  }

  /**
   * Section `index` of the loaded page (0 = its first top-level heading): the
   * heading and every block up to the next heading of the same level or higher.
   * Returns { from, to, title, level } in block indices, or null.
   */
  section(index) {
    const headings = []
    this.blocks.forEach((b, i) => {
      if (b.nodes.length === 1 && b.nodes[0].type === 'heading') headings.push(i)
    })
    if (!Number.isInteger(index) || index < 0 || index >= headings.length) return null
    const from = headings[index]
    const level = this.blocks[from].nodes[0].attrs.level
    const next = headings.find((i) => i > from && this.blocks[i].nodes[0].attrs.level <= level)
    const title = (this.blocks[from].nodes[0].content || []).map((n) => n.text || '').join('')
    return { from, to: next === undefined ? this.blocks.length : next, title, level }
  }

  /**
   * The whole page, with the blocks of a section replaced by `nodes`.
   */
  serializeSection(range, nodes) {
    const around = (a, b) => this.blocks.slice(a, b).flatMap((blk) => blk.nodes)
    return this.serialize({ type: 'doc', content: [...around(0, range.from), ...nodes, ...around(range.to)] })
  }

  sectionNodes(range) {
    return this.blocks.slice(range.from, range.to).flatMap((b) => b.nodes)
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
