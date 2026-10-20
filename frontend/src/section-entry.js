// The section editor bundle (section-editor.js), loaded by the main editor the
// first time a section is opened: CodeMirror stays out of wysiwyg.js.
import { SectionEditor } from './section.js'

window.otterwikiWysiwygSection = { SectionEditor }
