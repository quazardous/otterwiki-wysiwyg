// Bundle the editor into the Python package's static folder, with the
// licenses of the bundled packages (THIRD-PARTY-LICENSES.txt).
import * as esbuild from 'esbuild'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const OUT = '../otterwiki_wysiwyg/static'

const options = {
  entryPoints: { wysiwyg: 'src/index.js', sections: 'src/sections.js', 'section-editor': 'src/section-entry.js' },
  bundle: true,
  format: 'iife',
  minify: true,
  target: ['es2020'],
  outdir: OUT,
  legalComments: 'none',
  metafile: true,
  logLevel: 'info',
}

// the package.json directory of a bundled file
function packageDir(file) {
  let dir = dirname(file)
  while (dir.includes('node_modules') && !existsSync(join(dir, 'package.json'))) dir = dirname(dir)
  return dir
}

function writeLicenses(metafile) {
  const dirs = new Set()
  for (const input of Object.keys(metafile.inputs)) {
    if (input.includes('node_modules/')) dirs.add(packageDir(input))
  }
  const parts = []
  for (const dir of [...dirs].sort()) {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    const file = readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.|$)/i.test(f))
    const text = file ? readFileSync(join(dir, file), 'utf8').trim() : `License: ${pkg.license || 'unknown'} (no license file in the package)`
    parts.push(`${pkg.name}@${pkg.version} (${pkg.license || 'unknown'})\n\n${text}`)
  }
  writeFileSync(join(OUT, 'THIRD-PARTY-LICENSES.txt'),
    `Packages bundled in wysiwyg.js, section-editor.js and sections.js, with their licenses.\n\n${'='.repeat(78)}\n\n` +
    parts.join(`\n\n${'='.repeat(78)}\n\n`) + '\n')
  console.log(`  ${OUT}/THIRD-PARTY-LICENSES.txt  ${dirs.size} packages`)
}

if (process.argv.includes('--watch')) {
  const ctx = await esbuild.context({ ...options, minify: false, sourcemap: 'inline', metafile: false })
  await ctx.watch()
} else {
  const result = await esbuild.build(options)
  writeLicenses(result.metafile)
}
