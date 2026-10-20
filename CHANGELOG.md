# Changelog

## 0.1.0 — 2026-10-20

- Visual and Markdown tabs in the page editor.
- Markdown check in the Markdown tab: problems listed by line, click to jump.
- One toolbar for both tabs, in place of the wiki's; in the Markdown tab it
  writes the Markdown (and keeps the wiki's search, replace and table tools).
- Option `WYSIWYG_SECTION_EDIT`: one section at a time, in both tabs, with a
  breadcrumb; a pencil on each heading opens it in the visual tab.
- Flat, Material-like toolbar and tabs.
- Lossless round trip: untouched blocks are saved byte for byte.
- The wiki's Markdown dialect: `:::` blocks, alerts, folded blocks, spoilers,
  `==mark==`, `[[WikiLinks]]`, tables, checklists, code blocks, images.
- Source boxes for math, embeddings, footnotes, abbreviations, raw HTML.
- Paste and drop of images, uploaded as page attachments.
- Soft line breaks (a plain newline in a paragraph) stay plain newlines.
