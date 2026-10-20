// Markdown checks for the source tab: what would break, or degrade, the page
// in the wiki or in the visual editor. DOM-free, so it is tested like the
// round trip.
//
// Each problem: { line (1-based), severity: 'error' | 'warning', message }.
//   error   the wiki itself will not render it as meant (unclosed block...)
//   warning the page renders, but the visual editor can only show that part as
//           Markdown source, or something looks unintended

const FENCE = /^ {0,3}(`{3,}|~{3,})/
const PANEL_OPEN = /^( {0,3})(:{3,})([^:\n]*)$/
const ALERT = /^ {0,3}>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i
const ALERT_LIKE = /^ {0,3}>\s*\[!([A-Za-z]+)\]/
const TABLE_DELIM = /^ {0,3}\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/

// column count of a table row, escaped pipes and code spans do not split
function columns(line) {
  const cells = line.trim().replace(/\\\|/g, '').replace(/`[^`]*`/g, '').replace(/^\||\|$/g, '').split('|')
  return cells.length
}

export function lintMarkdown(markdown, roundtrip) {
  const problems = []
  const lines = markdown.split('\n')
  const add = (line, severity, message) => problems.push({ line, severity, message })

  // line by line: fences, wiki blocks, links, tables
  let fence = null // open code fence: { marker, line }
  const panels = [] // open ::: blocks: { fence, line }
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    const n = i + 1
    if (fence) {
      if (l.trim().startsWith(fence.marker) && l.trim().replace(/[`~]/g, '') === '') fence = null
      continue
    }
    const f = l.match(FENCE)
    if (f) {
      fence = { marker: f[1], line: n }
      continue
    }

    const p = l.match(PANEL_OPEN)
    if (p) {
      const name = p[3].trim()
      if (name === '') {
        // a bare fence closes the innermost block of the same length or more
        const k = panels.findLastIndex((b) => p[2].length >= b.fence.length)
        if (k >= 0) panels.splice(k, 1)
        else add(n, 'warning', `"${p[2]}" closes no block`)
      } else {
        panels.push({ fence: p[2], line: n })
      }
    }

    if (ALERT_LIKE.test(l) && !ALERT.test(l)) {
      add(n, 'warning', `unknown alert "${l.match(ALERT_LIKE)[1]}": use NOTE, TIP, IMPORTANT, WARNING or CAUTION`)
    } else if (ALERT.test(l) && !/^ {0,3}>/.test(lines[i + 1] || '')) {
      add(n, 'error', 'an alert needs at least one "> " line after its marker, or it shows as a plain quote')
    }

    // [[ without ]] on the same line
    const opens = (l.match(/\[\[/g) || []).length
    const closes = (l.match(/\]\]/g) || []).length
    if (opens > closes) add(n, 'warning', 'wiki link "[[" is not closed with "]]" on the same line')

    // table rows against the delimiter row
    if (TABLE_DELIM.test(l) && l.includes('-') && i > 0 && lines[i - 1].includes('|')) {
      const want = columns(lines[i - 1])
      if (columns(l) !== want) add(n, 'error', `table: the delimiter row has ${columns(l)} columns, the header ${want}`)
      for (let j = i + 1; j < lines.length && lines[j].includes('|') && lines[j].trim() !== ''; j++) {
        if (columns(lines[j]) !== want) add(j + 1, 'warning', `table row with ${columns(lines[j])} columns instead of ${want}`)
      }
    }
  }
  if (fence) add(fence.line, 'error', `code block opened with ${fence.marker} is never closed: the rest of the page is code`)
  for (const b of panels) add(b.line, 'error', `block "${lines[b.line - 1].trim()}" is never closed with "${b.fence}"`)

  // what the visual editor keeps as source because it cannot write it back as is
  if (roundtrip) {
    roundtrip.load(markdown)
    for (const b of roundtrip.blocks) {
      if (!b.fallback) continue
      const line = markdown.slice(0, b.start).split('\n').length
      add(line, 'warning', 'the visual editor shows this block as Markdown source (it could not write it back unchanged)')
    }
  }

  return problems.sort((a, b) => a.line - b.line || (a.severity === 'error' ? -1 : 1))
}
