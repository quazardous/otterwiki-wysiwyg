# Changelog

## 0.2.2 — 2026-10-22

- The controls of the wiki blocks work again: the style of a coloured block, the
  type of an alert, the summary of a folded block, the Markdown source boxes and
  the wiki links. Tiptap gives node views no `updateAttributes` (mark views
  only), so each control threw on use and changed nothing; the plugin now builds
  it from the node's position.

## 0.2.1 — 2026-10-20

- A line of non-breaking spaces (the `&nbsp;` spacers of other editors) is a
  blank line in the visual editor, no longer a Markdown source box; kept as
  is on save.
- Spaces next to each other (double spaces, a space and a non-breaking space)
  no longer make a block Markdown source.
- `make check-pages DIR=…`: check the plugin on a whole wiki (counts only).

## 0.2.0 — 2026-10-20

- Text colour: a palette in the toolbar (both tabs), written as
  `<span style="color: …">`, which the wiki shows in colour. Coloured spans
  already in a page are edited visually.

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
