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

test('sections run from a heading to the next heading of the same level or higher', () => {
  const md = '# Page\n\nIntro.\n\n## One\n\nText one.\n\n### Sub\n\nSub text.\n\n## Two\n\nText two.\n'
  const rt = roundtrip()
  rt.load(md)
  const s = rt.sections()
  assert.deepEqual(s.map((x) => [x.title, x.level]), [['Page', 1], ['One', 2], ['Sub', 3], ['Two', 2]])
  assert.equal(md.slice(s[1].start, s[1].end), '## One\n\nText one.\n\n### Sub\n\nSub text.\n\n')
  assert.equal(md.slice(s[2].start, s[2].end), '### Sub\n\nSub text.\n\n')
  assert.equal(md.slice(s[3].start, s[3].end), '## Two\n\nText two.\n')
  assert.equal(s[0].end, md.length)
})

test('headings inside blocks, code and front matter are not sections', () => {
  const md = '---\ntitle: T\n---\n# A\n\n::: info\n# In a block\n:::\n\n```\n# in code\n```\n\n>| # Fold\n>| text\n\n## B\n'
  const rt = roundtrip()
  rt.load(md)
  assert.deepEqual(rt.sections().map((x) => x.title), ['A', 'B'])
})

test('replacing a section source keeps the rest of the page byte for byte', () => {
  const md = '# Page\n\n* intro\n\n## One\n\nText one.\n\n## Two\n\n+ two\n'
  const rt = roundtrip()
  rt.load(md)
  const one = rt.sections()[1]
  const edited = '## One\n\nEdited.\n\n## Added section\n\nNew.\n\n'
  const out = md.slice(0, one.start) + edited + md.slice(one.end)
  assert.equal(out, '# Page\n\n* intro\n\n## One\n\nEdited.\n\n## Added section\n\nNew.\n\n## Two\n\n+ two\n')
  rt.load(out)
  assert.deepEqual(rt.sections().map((x) => x.title), ['Page', 'One', 'Added section', 'Two'])
})

test('coloured text is edited visually, untouched blocks keep their spelling', () => {
  const md = 'A <span style="color:green">**green**</span> word.\n\nAnother <span style="color: #e03131">red</span>.\n'
  const rt = roundtrip()
  const doc = clone(rt.load(md))
  assert.ok(JSON.stringify(doc).includes('"owColor"'))
  assert.equal(rt.serialize(doc), md)
  doc.content[1].content.push({ type: 'text', text: ' Edited.' })
  assert.equal(rt.serialize(doc), 'A <span style="color:green">**green**</span> word.\n\nAnother <span style="color: #e03131">red</span>. Edited.\n')
})

test('a span with another style, or nested spans, stays HTML', () => {
  const rt = roundtrip()
  const doc = rt.load('A <span style="background: red">x</span> and <span style="color: red">a <span>b</span></span>.\n')
  assert.ok(!JSON.stringify(doc).includes('"owColor"'))
})

test('a line of non-breaking spaces is a blank line in the editor, kept as it was', () => {
  const md = 'First.\n\n\u00a0\n\nSecond.\n'
  const rt = roundtrip()
  const doc = clone(rt.load(md))
  assert.deepEqual(doc.content.map((n) => n.type), ['paragraph', 'paragraph', 'paragraph'])
  assert.ok(!rt.blocks.some((b) => b.fallback))
  assert.equal(rt.serialize(doc), md)
  doc.content[2].content[0].text = 'Second, edited.'
  assert.equal(rt.serialize(doc), 'First.\n\n\u00a0\n\nSecond, edited.\n')
})

test('double spaces in a table cell do not make it source', () => {
  const md = '| a | b |\n| --- | --- |\n| two  spaces | x |\n'
  const rt = roundtrip()
  rt.load(md)
  assert.ok(!rt.blocks.some((b) => b.fallback))
  assert.equal(rt.serialize(rt.load(md)), md)
})
