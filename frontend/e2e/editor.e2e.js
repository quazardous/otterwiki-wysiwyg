// End-to-end test against a running wiki with the plugin (make up && make seed):
//   WIKI_URL=http://localhost:8080 node --test e2e/
// Uses the system's Chrome/Chromium through playwright-core (CHROME=/path to override).

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { chromium } from 'playwright-core'

const WIKI = process.env.WIKI_URL || 'http://localhost:8080'
const CHROME = process.env.CHROME || ['/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium'].find(existsSync)
const DEMO = readFileSync(new URL('../test/fixtures/otterwiki-syntax.md', import.meta.url), 'utf8')

let browser
let page
const errors = []

before(async () => {
  browser = await chromium.launch({ executablePath: CHROME, headless: true })
})

after(async () => {
  await browser.close()
})

// mode: the editor tab to open on ('visual' or 'source'), as remembered by the browser
// query: extra query string of the editor URL (e.g. '&section=2')
async function openEditor(path, mode = 'visual', query = '') {
  page = await browser.newPage()
  await page.addInitScript((m) => localStorage.setItem('otterwiki_wysiwyg_mode', m), mode)
  page.on('pageerror', (e) => errors.push(e.message))
  // a missing attachment of the demo page (/<page>/a/<file>) is not an error of the plugin
  page.on('response', (r) => r.status() >= 400 && !/\/a\//.test(r.url()) && errors.push(`${r.status()} ${r.url()}`))
  page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && errors.push(m.text()))
  await page.goto(`${WIKI}/${path}?edit${query}`)
  await page.waitForSelector(query ? '.ow-wysiwyg-tabs' : mode === 'visual' ? '.ow-wysiwyg-content' : '#wysiwyg_tab_source.active')
}

const cmText = () => page.evaluate(() => window.cm_editor.state.doc.toString())
// the raw source as stored (the wiki appends a "[]: # (url)" reference line to ?raw)
const source = async (path) =>
  (await (await fetch(`${WIKI}/${path}/source?raw`)).text()).replace(/\n\n\[\]: # \([^)]*\)$/, '\n')

async function save(message) {
  await page.click('#save-page-btn')
  await page.fill('#commit-message', message)
  await Promise.all([page.waitForNavigation(), page.click('#saveform input[type=submit]')])
}

test('the visual editor opens by default and changes nothing', async () => {
  // a fresh copy of the demo page
  await openEditor('E2e-demo', 'source')
  await page.evaluate((md) => window.cm_editor.dispatch({ changes: { from: 0, to: window.cm_editor.state.doc.length, insert: md } }), DEMO)
  await save('e2e: demo page')
  assert.equal(await source('E2e-demo'), DEMO)

  await openEditor('E2e-demo')
  assert.equal(await cmText(), DEMO, 'opening the visual editor rewrote the page')
  const counts = await page.evaluate(() => ({
    panels: document.querySelectorAll('.ow-wysiwyg-panel').length,
    alerts: document.querySelectorAll('.ow-wysiwyg-alert').length,
    folds: document.querySelectorAll('.ow-wysiwyg-fold').length,
    raw: document.querySelectorAll('.ow-wysiwyg-raw').length,
    wikilinks: document.querySelectorAll('.ow-wysiwyg-wikilink').length,
    tables: document.querySelectorAll('.ow-wysiwyg-content table').length,
  }))
  assert.deepEqual(counts, { panels: 2, alerts: 2, folds: 1, raw: 5, wikilinks: 2, tables: 1 })
})

test('typing in a paragraph changes that line only, and saves', async () => {
  await openEditor('E2e-demo')
  await page.click('.ow-wysiwyg-content blockquote p')
  await page.keyboard.press('End')
  await page.keyboard.type(' Typed in the visual editor.')
  const md = await cmText()
  const changed = md.split('\n').filter((l, i) => l !== DEMO.split('\n')[i])
  assert.deepEqual(changed, ['> It can span multiple lines! Typed in the visual editor.'])
  await save('e2e: visual edit')
  assert.equal(await source('E2e-demo'), md)
})

test('a new coloured block is written in the wiki syntax', async () => {
  await openEditor('E2e-demo')
  await page.click('.ow-wysiwyg-content h1')
  await page.keyboard.press('End')
  await page.click('button[title="Coloured block"]')
  await page.keyboard.type('New block text')
  assert.match(await cmText(), /\n::: info\nNew block text\n:::\n/)
})

test('switching to the source and back keeps the text', async () => {
  await openEditor('E2e-demo')
  const before = await cmText()
  await page.click('#wysiwyg_tab_source')
  assert.equal(await page.isVisible('.ow-wysiwyg'), false)
  await page.click('#wysiwyg_tab_visual')
  await page.waitForSelector('.ow-wysiwyg-content')
  assert.equal(await cmText(), before)
})

test('the Markdown tab checks the source and jumps to a problem', async () => {
  await openEditor('E2e-demo', 'source')
  await page.waitForSelector('.ow-wysiwyg-lint-ok')
  // break the page: an unclosed ::: block at the end
  await page.evaluate(() => {
    const cm = window.cm_editor
    cm.dispatch({ changes: { from: cm.state.doc.length, insert: '\n::: info\nnever closed\n' } })
  })
  await page.waitForSelector('.ow-wysiwyg-lint-error')
  assert.equal(await page.textContent('#wysiwyg_tab_source .ow-wysiwyg-badge'), '1')
  const line = await page.evaluate(() => window.cm_editor.state.doc.lines - 2)
  assert.match(await page.textContent('.ow-wysiwyg-lint-error'), new RegExp(`Line ${line} .*never closed`))
  await page.click('.ow-wysiwyg-lint-error')
  const cursorLine = await page.evaluate(() => window.cm_editor.state.doc.lineAt(window.cm_editor.state.selection.main.head).number)
  assert.equal(cursorLine, line)
  // the visual tab warns about it
  await page.click('#wysiwyg_tab_visual')
  await page.waitForSelector('.ow-wysiwyg-note-error')
})

// needs WYSIWYG_SECTION_EDIT=true (docker-compose.yml)
test('section edit: a pencil per top-level heading opens its section, visual first, Markdown too', async () => {
  page = await browser.newPage()
  await page.goto(`${WIKI}/E2e-demo`)
  const links = await page.$$eval('.ow-wysiwyg-section-edit', (as) => as.map((a) => a.getAttribute('href')))
  // the demo page: # Otter Wiki syntax, then 6 ## headings (the alert's # heading is not a section)
  assert.equal(links.length, 7)
  assert.match(links[2], /\?edit&section=2$/)

  // the pencil opens the section in the visual tab (even if Markdown was the last tab)
  await openEditor('E2e-demo', 'source', '&section=2')
  await page.waitForSelector('.ow-wysiwyg-content')
  assert.equal(await page.textContent('.ow-wysiwyg-crumb-here'), 'Quotes and blocks')
  assert.deepEqual(await page.$$eval('.ow-wysiwyg-content > h2', (hs) => hs.map((h) => h.textContent)), ['Quotes and blocks'])
  // the Markdown tab: the same section, in its own editor
  await page.click('#wysiwyg_tab_source')
  await page.waitForSelector('.ow-wysiwyg-section-editor .cm-editor')
  assert.equal(await page.evaluate(() => window.cm_editor.dom.offsetHeight), 0, 'the whole page editor is hidden')
  // the section editor is in a shadow root: Playwright locators pierce it
  const sectionText = () => page.locator('.ow-wysiwyg-section-editor .cm-content').innerText()
  const text = await sectionText()
  assert.match(text, /^## Quotes and blocks/)
  assert.doesNotMatch(text, /## Tables/)

  // typing, and adding a section, changes the page in place
  const before = await cmText()
  await page.click('.ow-wysiwyg-section-editor .cm-content')
  await page.keyboard.press('Control+Home')
  await page.keyboard.press('End')
  await page.keyboard.type(' (edited)')
  await page.keyboard.press('Control+End')
  await page.keyboard.type('## Added section\n\nNew text.\n\n')
  const after = await cmText()
  assert.ok(after.startsWith(before.slice(0, before.indexOf('## Quotes and blocks'))), 'the page before the section is untouched')
  assert.ok(after.endsWith(before.slice(before.indexOf('## Tables'))), 'the page after the section is untouched')
  assert.match(after, /## Quotes and blocks \(edited\)\n/)
  assert.match(after, /## Added section\n\nNew text\.\n\n## Tables/)

  // letters stay in the editor (no wiki shortcut fired), Ctrl+S still saves
  assert.equal(await page.evaluate(() => document.getElementById('modal-leave').classList.contains('show')), false)

  // the new section is in the list (refreshed with the check); the visual tab
  // keeps the section; back to the whole page
  await page.waitForFunction(() => [...document.querySelectorAll('#wysiwyg_subtab_section option')].some((o) => o.textContent.trim() === 'Added section'))
  await page.click('#wysiwyg_tab_visual')
  await page.waitForSelector('.ow-wysiwyg-crumb-here')
  assert.equal(await page.textContent('.ow-wysiwyg-crumb-here'), 'Quotes and blocks (edited)')
  const visualHeadings = await page.$$eval('.ow-wysiwyg-content > h2', (hs) => hs.map((h) => h.textContent))
  // "## Added section" is a heading of the same level: a new section of its own
  assert.deepEqual(visualHeadings, ['Quotes and blocks (edited)'])
  await page.click('#wysiwyg_tab_source')
  await page.waitForSelector('.ow-wysiwyg-section-editor .cm-content')
  await page.click('#wysiwyg_subtab_page')
  assert.ok((await page.evaluate(() => window.cm_editor.dom.offsetHeight)) > 100)
  assert.equal(await cmText(), after)
})

test('layout: one editor at a time, the visual one in view, readable sizes', async () => {
  await openEditor('E2e-demo')
  const visual = await page.evaluate(() => ({
    cm: window.cm_editor.dom.offsetHeight,
    surfaceTop: document.querySelector('.ow-wysiwyg-surface').getBoundingClientRect().top,
    tabFont: parseFloat(getComputedStyle(document.querySelector('.ow-wysiwyg-tab')).fontSize),
  }))
  assert.equal(visual.cm, 0, 'the source editor is hidden in the visual tab')
  assert.ok(visual.surfaceTop < 400, `the visual editor starts at ${visual.surfaceTop}px`)
  assert.ok(visual.tabFont >= 12, `tab font ${visual.tabFont}px`)
  await page.click('#wysiwyg_tab_source')
  const source = await page.evaluate(() => ({
    cm: window.cm_editor.dom.offsetHeight,
    visual: document.querySelectorAll('.ow-wysiwyg').length,
  }))
  assert.ok(source.cm > 100, 'the source editor is shown in the Markdown tab')
  assert.equal(source.visual, 0)
})

test('one toolbar, above the editing area, in both tabs; the wiki\'s own is hidden', async () => {
  await openEditor('E2e-demo', 'source')
  assert.equal(await page.$$eval('.navbar .btn-editor', (bs) => bs.filter((b) => b.offsetParent).length), 0)
  const place = () => page.evaluate(() => {
    const bar = document.querySelector('.ow-wysiwyg-toolbar-shared')
    return bar ? Math.round(bar.getBoundingClientRect().top) : null
  })
  const mdTop = await place()
  assert.ok(mdTop !== null, 'toolbar after the tabs')
  // Markdown: bold wraps the selection, undo restores it
  await page.evaluate(() => {
    const cm = window.cm_editor
    const l = cm.state.doc.line(3)
    cm.dispatch({ selection: { anchor: l.from, head: l.from + 4 } })
  })
  await page.click('.ow-wysiwyg-toolbar button[title="Bold"]')
  assert.match(await page.evaluate(() => window.cm_editor.state.doc.line(3).text), /^\*\*Text\*\*/)
  await page.click('.ow-wysiwyg-toolbar button[title="Undo"]')
  assert.match(await page.evaluate(() => window.cm_editor.state.doc.line(3).text), /^Text with/)
  await page.click('#wysiwyg_tab_visual')
  await page.waitForSelector('.ow-wysiwyg-content')
  assert.equal(await place(), mdTop, 'same place in both tabs')
})

test('text colour: the palette writes a coloured span, the wiki shows it in colour', async () => {
  await openEditor('E2e-demo')
  // select "bold" in the first paragraph
  await page.dblclick('.ow-wysiwyg-content p strong')
  await page.click('button[title="Text colour"]')
  await page.click('.ow-wysiwyg-menu-list.open .ow-wysiwyg-menu-item:has-text("Red")')
  const md = await cmText()
  assert.match(md, /<span style="color: #e03131">\*\*bold\*\*<\/span>|\*\*<span style="color: #e03131">bold<\/span>\*\*/)
  await save('e2e: colour')
  const html = await (await fetch(`${WIKI}/E2e-demo`)).text()
  assert.match(html, /<span style="color: #e03131">/)
  // the Markdown tab: the same button takes the colour off
  await openEditor('E2e-demo', 'source')
  await page.evaluate(() => {
    const cm = window.cm_editor
    const text = cm.state.doc.toString()
    const at = text.indexOf('bold</span>') === -1 ? text.indexOf('**bold**</span>') : text.indexOf('bold</span>')
    const len = text.indexOf('bold</span>') === -1 ? 8 : 4
    cm.dispatch({ selection: { anchor: at, head: at + len } })
  })
  await page.click('button[title="Text colour"]')
  await page.click('.ow-wysiwyg-menu-list.open .ow-wysiwyg-menu-item:has-text("No colour")')
  assert.doesNotMatch(await cmText(), /<span style="color/)
})

test('no JavaScript error', () => {
  assert.deepEqual(errors, [])
})
