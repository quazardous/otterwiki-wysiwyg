// Check the plugin on a wiki's pages: for every .md file of a directory (the
// wiki's git repository), does loading and saving without edits give the same
// bytes, and how many blocks would the visual editor keep as Markdown source.
// Prints page names and counts only, never the pages' content.
//
// Usage: node tools/check-pages.mjs <directory>      (make check-pages DIR=…)
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { headless } from '../test/helpers.js'

const dir = process.argv[2]
if (!dir) {
  console.error('usage: node tools/check-pages.mjs <directory>')
  process.exit(2)
}
const files = []
const walk = (d) =>
  readdirSync(d).forEach((f) => {
    if (f === '.git') return
    const p = join(d, f)
    if (statSync(p).isDirectory()) walk(p)
    else if (f.endsWith('.md')) files.push(p)
  })
walk(dir)

const { roundtrip } = headless()
let identical = 0
let grey = 0
let blocks = 0
for (const f of files.sort()) {
  const rt = roundtrip()
  const md = readFileSync(f, 'utf8')
  const same = rt.serialize(rt.load(md)) === md
  const g = rt.blocks.filter((b) => b.fallback).length
  if (same) identical++
  blocks += rt.blocks.length
  grey += g
  if (!same || g) console.log(`${same ? '  ' : '✗ '}${relative(dir, f)}${same ? '' : ': NOT written back unchanged'}${g ? `: ${g} block(s) kept as source` : ''}`)
}
console.log(`${identical}/${files.length} pages written back unchanged; ${grey} block(s) of ${blocks} kept as Markdown source`)
process.exit(identical === files.length ? 0 : 1)
