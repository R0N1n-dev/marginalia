import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// Real-world fixture, not committed (tests skip when absent):
// https://github.com/lojban/cll — The Complete Lojban Language, MOBI.
const fixtures = [join(homedir(), 'fixtures/cll.mobi'), join(homedir(), 'fixtures/codex.mobi')]
const fixture = fixtures.find((f) => existsSync(f))

test('parseMobi: real MOBI file through foliate', { skip: !fixture && 'no fixture in ~/fixtures' }, async () => {
  const { JSDOM } = await import('jsdom')
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://local.test/' })
  globalThis.DOMParser = dom.window.DOMParser
  globalThis.document = dom.window.document
  globalThis.Node = dom.window.Node
  globalThis.Element = dom.window.Element
  globalThis.HTMLElement = dom.window.HTMLElement
  globalThis.getComputedStyle = dom.window.getComputedStyle
  globalThis.XMLSerializer = dom.window.XMLSerializer
  globalThis.HTMLSerializer = dom.window.XMLSerializer
  // jsdom lacks innerText (foliate reads it for toc labels) and createObjectURL
  Object.defineProperty(dom.window.HTMLElement.prototype, 'innerText', {
    configurable: true,
    get() { return this.textContent },
  })
  if (!dom.window.URL.createObjectURL) {
    dom.window.URL.createObjectURL = () => 'blob:https://local.test/fake'
  }
  globalThis.URL = dom.window.URL

  const { parseMobi } = await import('../src/lib/mobi.js')
  const bytes = new Uint8Array(readFileSync(fixture))
  const book = await parseMobi(bytes, 'fixture.mobi')

  assert.equal(book.format, 'mobi')
  assert.ok(book.title.trim().length > 2, `title: "${book.title}"`)
  assert.ok(book.chapters.length > 0, 'chapters exist')
  assert.ok(book.chapters[0].text.length > 200, `first chapter text (${book.chapters[0].text.length} chars)`)
  assert.ok(book.toc.length > 0, 'toc parsed')
  for (const t of book.toc.slice(0, 10)) {
    assert.ok(t.label && t.label.trim(), 'toc labels present')
    assert.ok(/^s\d+$/.test(t.href), `toc maps to a section (${t.href})`)
  }
  const html = book.chapters.map((c) => c.html).join('')
  assert.ok(!/<script/i.test(html), 'no live scripts')
  assert.ok(!/\son\w+=/i.test(html.replace(/data-[\w-]+=/g, '')), 'no on* handlers')
})
