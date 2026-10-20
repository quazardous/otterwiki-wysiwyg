// The README screenshots (docs/*.png), against the local wiki with the demo
// pages (make up && make seed):  make screenshots
import { existsSync } from 'node:fs'
import { chromium } from 'playwright-core'
const OUT = new URL('../../docs', import.meta.url).pathname
const WIKI = process.env.WIKI_URL || 'http://localhost:8080'
const CHROME = process.env.CHROME || ['/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium'].find(existsSync)
const b = await chromium.launch({ executablePath: CHROME, headless: true })
async function shot(name, url, mode, prep, height = 620) {
  const p = await b.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 })
  await p.addInitScript((m) => localStorage.setItem('otterwiki_wysiwyg_mode', m), mode)
  await p.goto(url)
  await p.waitForSelector('.ow-wysiwyg-toolbar-shared')
  if (prep) await prep(p)
  await p.waitForTimeout(400)
  // the editing column, from the tabs down
  const box = await p.evaluate(() => {
    const tabs = document.querySelector('.ow-wysiwyg-tabs').getBoundingClientRect()
    const col = document.getElementById('editor_block').getBoundingClientRect()
    return { x: Math.round(col.left) + 1, y: Math.round(tabs.top) - 4, width: Math.round(col.width) - 2 }
  })
  await p.screenshot({ path: `${OUT}/${name}.png`, clip: { ...box, height } })
  await p.close()
}
// visual: the cursor in the bold word, so the toolbar shows an active button
await shot('visual', `${WIKI}/Syntax-demo?edit`, 'visual', async (p) => {
  await p.waitForSelector('.ow-wysiwyg-content')
  await p.click('.ow-wysiwyg-content p strong')
})
// markdown: a problem in the check panel
await shot('markdown', `${WIKI}/Syntax-demo?edit`, 'source', async (p) => {
  await p.evaluate(() => {
    const cm = window.cm_editor
    const at = cm.state.doc.line(7).to
    cm.dispatch({ changes: { from: at, insert: '\n\n::: warning\nnot closed' } })
  })
  await p.waitForSelector('.ow-wysiwyg-lint-error')
  await p.evaluate(() => window.scrollTo(0, 0))
}, 520)
// a section, with its breadcrumb
await shot('section', `${WIKI}/Syntax-demo?edit&section=2`, 'visual', async (p) => {
  await p.waitForSelector('.ow-wysiwyg-crumb-here')
}, 560)
await b.close()
