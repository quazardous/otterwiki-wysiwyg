import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { headless } from './helpers.js'
import { lintMarkdown } from '../src/lint.js'

const { roundtrip } = headless()
const lint = (md) => lintMarkdown(md, roundtrip())
const brief = (md) => lint(md).map((p) => `${p.line} ${p.severity}`)

test('the syntax demo has no problem', () => {
  const md = readFileSync(new URL('./fixtures/otterwiki-syntax.md', import.meta.url), 'utf8')
  assert.deepEqual(lint(md), [])
})

test('an unclosed code fence is an error at its line', () => {
  assert.deepEqual(brief('# T\n\n```python\nprint(1)\n'), ['3 error'])
})

test('an unclosed ::: block is an error, a closed one is fine', () => {
  assert.deepEqual(brief('::: info\ntext\n'), ['1 error'])
  assert.deepEqual(brief('::: info\ntext\n:::\n'), [])
  assert.deepEqual(brief(':::: warning\n::: info\nx\n:::\n::::\n'), [])
})

test('a stray closing ::: is a warning', () => {
  assert.deepEqual(brief('text\n\n:::\n'), ['3 warning'])
})

test('an alert without a body line is an error, an unknown type a warning', () => {
  assert.deepEqual(brief('> [!NOTE]\n\nafter\n'), ['1 error'])
  assert.deepEqual(brief('> [!NOTE]\n> body\n'), [])
  assert.deepEqual(brief('> [!HINT]\n> body\n'), ['1 warning'])
})

test('an unclosed wiki link is a warning', () => {
  assert.deepEqual(brief('See [[Some Page and more.\n'), ['1 warning'])
  assert.deepEqual(brief('See [[Some Page]].\n'), [])
})

test('table rows with the wrong number of columns', () => {
  assert.deepEqual(brief('| a | b |\n| --- |\n| 1 | 2 |\n'), ['2 error'])
  assert.deepEqual(brief('| a | b |\n| --- | --- |\n| 1 | 2 | 3 |\n| 4 | 5 |\n'), ['3 warning'])
  assert.deepEqual(brief('| a | b |\n| --- | --- |\n| `x|y` | 2 |\n'), [])
})

test('a block the visual editor cannot write back is reported', () => {
  const problems = lint('Reference [link][1].\n\n[1]: https://example.com\n')
  assert.equal(problems.length, 1)
  assert.equal(problems[0].line, 3)
  assert.match(problems[0].message, /Markdown source/)
})

test('code is not checked', () => {
  assert.deepEqual(brief('```\n::: info\n> [!NOTE]\n[[x\n```\n'), [])
})
