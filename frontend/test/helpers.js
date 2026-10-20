// A headless editor model for the tests: the same extensions, schema and
// Markdown manager as the browser editor, without a DOM.

import { getSchemaByResolvedExtensions, resolveExtensions } from '@tiptap/core'
import { MarkdownManager } from '@tiptap/markdown'
import { buildExtensions } from '../src/extensions.js'
import { RoundTrip } from '../src/roundtrip.js'

export function headless() {
  const extensions = resolveExtensions(buildExtensions())
  const schema = getSchemaByResolvedExtensions(extensions)
  const manager = new MarkdownManager({ extensions })
  return { schema, manager, roundtrip: () => new RoundTrip(manager, schema) }
}
