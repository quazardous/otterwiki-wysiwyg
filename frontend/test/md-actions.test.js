import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as md from '../src/md-actions.js'

// "a|b|c" marks the selection with | (one | = a caret)
function sel(marked) {
  const from = marked.indexOf('|')
  const rest = marked.slice(from + 1)
  const second = rest.indexOf('|')
  const text = marked.slice(0, from) + (second < 0 ? rest : rest.slice(0, second) + rest.slice(second + 1))
  return { text, from, to: second < 0 ? from : from + second }
}
function run(marked, action, arg) {
  const s = sel(marked)
  const r = action(s, arg)
  return s.text.slice(0, r.from) + r.insert + s.text.slice(r.to)
}

test('bold wraps the selection, and unwraps it', () => {
  assert.equal(run('a |word| b', (s) => md.wrap(s, '**')), 'a **word** b')
  assert.equal(run('a **|word|** b', (s) => md.wrap(s, '**')), 'a word b')
  assert.equal(run('a | b', (s) => md.wrap(s, '==')), 'a ==text== b')
})

test('lists and quotes prefix every selected line, and toggle off', () => {
  assert.equal(run('|one\ntwo|\n', md.bulletList), '- one\n- two\n')
  assert.equal(run('|- one\n- two|\n', md.bulletList), 'one\ntwo\n')
  assert.equal(run('|* one\n+ two|', md.bulletList), '- one\n- two')
  assert.equal(run('|one\ntwo|', md.orderedList), '1. one\n2. two')
  assert.equal(run('|one|', md.taskList), '- [ ] one')
  assert.equal(run('x\n|one\ntwo|\ny', md.quote), 'x\n> one\n> two\ny')
})

test('heading sets the level of the line', () => {
  assert.equal(run('Ti|tle\n', md.heading, 2), '## Title\n')
  assert.equal(run('### Ti|tle\n', md.heading, 1), '# Title\n')
  assert.equal(run('## Ti|tle', md.heading, 0), 'Title')
})

test('wiki blocks are written on lines of their own', () => {
  assert.equal(run('Before.\n\n|', md.panel), 'Before.\n\n::: info\ntext\n:::')
  assert.equal(run('Before.|', md.alert), 'Before.\n\n> [!NOTE]\n> text')
  assert.equal(run('|one\ntwo|\n', md.fold), '>| ### Summary\n>| one\n>| two\n')
  assert.equal(run('|secret|', md.spoiler), '>! secret')
  assert.equal(run('|x = 1|', md.codeBlock), '```\nx = 1\n```')
})

test('links', () => {
  assert.equal(run('see |here|.', md.link, 'https://x'), 'see [here](https://x).')
  assert.equal(run('see |Text|.', md.wikiLink, 'Some/Page'), 'see [[Text|Some/Page]].')
  assert.equal(run('see |.', md.wikiLink, 'Page'), 'see [[Page]].')
  assert.equal(run('|', md.image, 'a.png'), '![](a.png)')
})

test('a table template is inserted after the paragraph', () => {
  const out = run('Text.|', md.table)
  assert.match(out, /^Text\.\n\n\| Column 1 \| Column 2 \| Column 3 \|\n\| -+ \| -+ \| -+ \|\n\|/)
})
