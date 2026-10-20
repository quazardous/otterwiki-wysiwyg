import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { headless } from './helpers.js'

const { roundtrip } = headless()
const fixtures = readdirSync(new URL('./fixtures/', import.meta.url)).filter((f) => f.endsWith('.md'))
const read = (f) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8')
const clone = (x) => JSON.parse(JSON.stringify(x))
const types = (doc) => doc.content.map((n) => n.type)

// the lines of b that are not in a, in order
function addedLines(a, b) {
  const seen = new Set(a.split('\n'))
  return b.split('\n').filter((l) => !seen.has(l))
}

for (const f of fixtures) {
  test(`${f}: loading and saving without edits gives the same bytes`, () => {
    const md = read(f)
    const rt = roundtrip()
    assert.equal(rt.serialize(rt.load(md)), md)
  })
}

test('the wiki syntax is edited visually, not as source', () => {
  const rt = roundtrip()
  const t = types(rt.load(read('otterwiki-syntax.md')))
  for (const type of ['owPanel', 'owSpoiler', 'owFold', 'owAlert', 'table', 'taskList', 'codeBlock', 'image']) {
    assert.ok(t.includes(type) || JSON.stringify(rt.load(read('otterwiki-syntax.md'))).includes(`"${type}"`), `${type} missing: ${t}`)
  }
  const doc = JSON.stringify(rt.load(read('otterwiki-syntax.md')))
  assert.ok(doc.includes('"owWikiLink"'), 'wiki links')
  assert.ok(doc.includes('"highlight"'), '==mark==')
})

test('syntax without a visual form stays verbatim source', () => {
  const rt = roundtrip()
  const doc = rt.load(read('otterwiki-syntax.md'))
  const sources = doc.content.filter((n) => n.type === 'owRawBlock').map((n) => n.attrs.source)
  assert.ok(sources.includes('$$a^2+b^2=c^2$$'))
  assert.ok(sources.includes('{{TOC}}'))
  assert.ok(sources.includes('[^1]: Footnotes can be a single line.'))
  assert.ok(sources.some((s) => s.startsWith('*[HTML]:')))
  assert.ok(sources.some((s) => s.startsWith('<details>')))
})

test('editing one block rewrites that block only', () => {
  const md = read('otterwiki-syntax.md')
  const rt = roundtrip()
  const doc = clone(rt.load(md))
  const quote = doc.content.findIndex((n) => n.type === 'blockquote')
  const text = doc.content[quote].content[0].content[0]
  text.text = text.text.replace('This is a quote.', 'This is an edited quote.')
  const out = rt.serialize(doc)
  assert.deepEqual(addedLines(md, out).filter((l) => l.trim()), ['> This is an edited quote.'])
  assert.equal(out.split('\n').length, md.split('\n').length)
})

test('edited wiki blocks are written back in the wiki syntax', () => {
  const rt = roundtrip()
  const doc = clone(rt.load(read('otterwiki-syntax.md')))
  const edit = (type) => {
    const n = doc.content.find((x) => x.type === type)
    n.content[n.content.length - 1].content.push({ type: 'text', text: ' Edited.' })
    return n
  }
  edit('owPanel')
  edit('owSpoiler')
  edit('owFold')
  edit('owAlert')
  const out = rt.serialize(doc)
  // an edited block goes through the serializer: _emphasis_ becomes *emphasis*
  assert.match(out, /^::: info\n# Head of the block\.\n\nWith \*formatted\* content\. Edited\.\n:::$/m)
  assert.match(out, /^>! Spoiler blocks reveal their\n>! content on click on the icon\. Edited\.$/m)
  assert.match(out, /^>\| # Headline is used as summary\n>\| with the details folded\. Edited\.$/m)
  assert.match(out, /^> \[!NOTE\]\n> Useful for highlighting special\n> information\. Edited\.$/m)
  // and it reads back as the same document
  const again = roundtrip()
  assert.deepEqual(again.load(out), { type: 'doc', content: rt.normalize(doc.content) })
})

test('a new block is added with a blank line around it', () => {
  const md = '# Title\n\nFirst.\n\nLast.\n'
  const rt = roundtrip()
  const doc = clone(rt.load(md))
  doc.content.splice(2, 0, { type: 'paragraph', content: [{ type: 'text', text: 'Inserted.' }] })
  assert.equal(rt.serialize(doc), '# Title\n\nFirst.\n\nInserted.\n\nLast.\n')
})

test('deleting a block keeps the others byte for byte', () => {
  const md = '# Title\n\n* one\n* two\n\n\n\nMiddle.\n\n+ three\n'
  const rt = roundtrip()
  const doc = clone(rt.load(md))
  doc.content.splice(2, 1)
  assert.equal(rt.serialize(doc), '# Title\n\n* one\n* two\n\n+ three\n')
})

test('empty paragraphs (Enter pressed twice) are not written', () => {
  const rt = roundtrip()
  const doc = clone(rt.load('A.\n\nB.\n'))
  doc.content.splice(1, 0, { type: 'paragraph' }, { type: 'paragraph' })
  assert.equal(rt.serialize(doc), 'A.\n\nB.\n')
})

test('a link reference definition is kept as source', () => {
  const rt = roundtrip()
  const doc = rt.load('Reference [link][1].\n\n[1]: https://example.com\n')
  assert.equal(doc.content[1].type, 'owRawBlock')
  assert.equal(doc.content[1].attrs.source, '[1]: https://example.com')
})

test('wiki links keep their exact text', () => {
  const rt = roundtrip()
  const doc = clone(rt.load('See [[Text|Some/Page#anchor]].\n'))
  doc.content[0].content.push({ type: 'text', text: ' More.' })
  assert.equal(rt.serialize(doc), 'See [[Text|Some/Page#anchor]]. More.\n')
})

test('a soft line break is written back as a plain newline, a hard one as two spaces', () => {
  const rt = roundtrip()
  const doc = clone(rt.load('Line one\nline two  \nline three\n'))
  doc.content[0].content.push({ type: 'text', text: ' Edited.' })
  assert.equal(rt.serialize(doc), 'Line one\nline two  \nline three Edited.\n')
})

test('a section runs from its heading to the next heading of the same level or higher', () => {
  const md = '# Page\n\nIntro.\n\n## One\n\nText one.\n\n### Sub\n\nSub text.\n\n## Two\n\nText two.\n'
  const rt = roundtrip()
  rt.load(md)
  assert.deepEqual(rt.section(1), { from: 2, to: 6, title: 'One', level: 2 })
  assert.deepEqual(rt.section(2), { from: 4, to: 6, title: 'Sub', level: 3 })
  assert.deepEqual(rt.section(3), { from: 6, to: 8, title: 'Two', level: 2 })
  assert.equal(rt.section(4), null)
  assert.equal(rt.section(-1), null)
})

test('editing a section rewrites that section only, in place', () => {
  const md = '# Page\n\n* intro\n\n## One\n\nText one.\n\n## Two\n\n+ two\n'
  const rt = roundtrip()
  rt.load(md)
  const range = rt.section(1)
  const nodes = clone(rt.sectionNodes(range))
  nodes[1].content[0].text = 'Edited one.'
  assert.equal(rt.serializeSection(range, nodes), '# Page\n\n* intro\n\n## One\n\nEdited one.\n\n## Two\n\n+ two\n')
  // unchanged: the very same bytes
  assert.equal(rt.serializeSection(range, rt.sectionNodes(range)), md)
})
