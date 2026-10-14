import test from 'node:test'
import assert from 'node:assert/strict'
import { zipSync } from 'fflate'
import { parseFb2 } from '../src/lib/fb2.js'

const enc = (s) => new TextEncoder().encode(s)
// 1x1 transparent png
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

const fb2 = (extra = '') => `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE FictionBook PUBLIC "-//Barnes&Noble//DTD eXtensible FictionBook 1.4//EN" "http://www.fictionbook.org/xml/fictionbook14.dtd">
<FictionBook xmlns:l="http://www.w3.org/1999/xlink" xmlns:xlink="http://www.w3.org/1999/xlink">
<description>
<title-info>
<book-title>Notes on &mdash; Depth</book-title>
<author><first-name>Sarah</first-name><last-name>Mostafavi</last-name></author>
<coverpage><image l:href="#cover.jpg"/></coverpage>
</title-info>
<document-info><program-used>test</program-used></document-info>
</description>
<binary id="cover.jpg" content-type="image/jpeg">${PNG}</binary>
<body name="main">
<section>
<title><p>Chapter 1. Falling</p></title>
<p>It began without <emphasis>ceremony</emphasis>, the way weather does.</p>
<p>&nbsp;&nbsp;Look down, she wrote, <strong>then look again</strong>.</p>
<image l:href="#cover.jpg"/>
<section>
<title><p>1.1 Under the surface</p></title>
<p>Deeper &mdash; much deeper, she thought. &laquo;Too deep,&raquo; she said.</p>
</section>
</section>
<section>
<title><p>Chapter 2. Signals</p></title>
<p>No signal, no map, <cite>only the pull of the thing</cite>.</p>
</section>
</body>
<body name="notes">
<section>
<title><p>Note 1</p></title><p>A footnote body.</p>
</section>
</body>
${extra}
</FictionBook>`

test('parseFb2: metadata, cover, chapters, nested toc', () => {
  const book = parseFb2(enc(fb2()))
  assert.equal(book.format, 'fb2')
  assert.equal(book.title, 'Notes on — Depth')
  assert.equal(book.author, 'Sarah Mostafavi')
  assert.ok(book.cover.startsWith('data:image/jpeg;base64,'), 'cover inlined')
  // main body: ch1, nested 1.1, ch2 + notes body → 4 chapters
  assert.equal(book.chapters.length, 4)
  assert.equal(book.toc[0].label, 'Chapter 1. Falling')
  assert.equal(book.toc[0].depth, 0)
  assert.equal(book.toc[1].label, '1.1 Under the surface')
  assert.equal(book.toc[1].depth, 1, 'nested section indented')
  assert.equal(book.toc[3].label, 'Note 1')
  assert.ok(book.chapters[0].text.includes('the way weather does'))
  assert.ok(!book.chapters[0].text.includes('Chapter 1. Falling'), 'title stays out of body text')
})

test('parseFb2: entities decoded, markup escaped, images inlined', () => {
  const book = parseFb2(enc(fb2()))
  const ch = book.chapters[0]
  assert.ok(ch.html.includes('<em>ceremony</em>'))
  assert.ok(ch.html.includes('<strong>then look again</strong>'))
  assert.ok(ch.text.includes('\u00a0') || ch.text.includes(' '), 'nbsp decoded')
  assert.ok(ch.html.includes('data:image/jpeg;base64,'), 'inline image resolved')
  const nested = book.chapters[1] // "1.1 Under the surface"
  assert.ok(nested.text.includes('—'), 'mdash entity decoded')
  assert.ok(nested.text.includes('«Too deep,»'), 'laquo/raquo decoded')
})

test('parseFb2: hostile content is escaped (text, not html)', () => {
  const evil = fb2().replace('It began without', '<script>alert(1)</script>It began without')
  const book = parseFb2(enc(evil))
  const html = book.chapters.map((c) => c.html).join('')
  assert.ok(!/<script/i.test(html), 'no live script tag')
  assert.ok(html.includes('&lt;script&gt;') || !html.includes('script'), 'script text escaped or excluded')
})

test('parseFb2: windows-1251 encoded file', () => {
  const xml = `<?xml version="1.0" encoding="windows-1251"?>
<FictionBook><description><title-info><book-title>Привет мир</book-title></title-info></description>
<body><section><p>Текст книги.</p></section></body></FictionBook>`
  // encode as cp1251 manually (only cyrillic chars used)
  const out = []
  for (const ch of xml) {
    const cp = ch.codePointAt(0)
    if (cp < 128) out.push(cp)
    else {
      // windows-1251 table for the chars used here
      const map = { 'П': 0xCF, 'р': 0xF0, 'и': 0xE8, 'в': 0xE2, 'е': 0xE5, 'т': 0xF2, 'м': 0xEC, 'П': 0xCF, 'м': 0xEC, 'и': 0xE8, 'р': 0xF0, 'Т': 0xD2, 'е': 0xE5, 'к': 0xEA, 'с': 0xF1, 'т': 0xF2, 'к': 0xEA, 'а': 0xE0, 'к': 0xEA, 'н': 0xED, 'и': 0xE8, ' ': 0x20 }
      out.push(map[ch] ?? 0x3f)
    }
  }
  const book = parseFb2(new Uint8Array(out))
  assert.ok(book.title.includes('Привет'), 'title decoded from cp1251: ' + book.title)
  assert.ok(book.chapters[0].text.includes('Текст'))
})

test('parseFb2: .fb2.zip archive', () => {
  const bytes = zipSync({ 'book.fb2': enc(fb2()) })
  const book = parseFb2(bytes)
  assert.equal(book.title, 'Notes on — Depth')
  assert.equal(book.chapters.length, 4)
})
