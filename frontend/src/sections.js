// otterwiki-wysiwyg, option WYSIWYG_SECTION_EDIT: a pencil link on each heading
// of the page being read, to open the editor on that section only.
//
// Sections are numbered like the editor numbers them (index.js): the headings
// of the page's top level, in order. In the rendered page these are the
// headings that are direct children of article.page; headings inside a block
// (an alert's title, a folded block) are not sections.

import './sections.css'

function install() {
  const article = document.querySelector('article.page')
  if (!article) return
  const headings = [...article.children].filter((h) => /^H[1-6]$/.test(h.tagName))
  headings.forEach((h, i) => {
    const a = document.createElement('a')
    a.className = 'ow-wysiwyg-section-edit'
    a.href = `${location.pathname}?edit&section=${i}`
    a.title = 'Edit this section'
    a.innerHTML = '<i class="fas fa-pencil-alt"></i>'
    h.append(a)
  })
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install)
else install()
