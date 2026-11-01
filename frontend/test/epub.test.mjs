import test from 'node:test'
import assert from 'node:assert/strict'
import { zipSync } from 'fflate'
import { DOMParser } from '@xmldom/xmldom'
import { parseEpub, resolvePath, zipDir } from '../src/lib/epub.js'
import { buildSampleEpub } from '../src/lib/sample.js'
import { absOffset, locate, textLength, unwrapMarks } from '../src/lib/marks.js'
import { parseBook } from '../src/lib/formats.js'

const enc = new TextEncoder()

test('parseBook: a .epub zip routes to the EPUB parser instead of being rejected', async () => {
  const bytes = buildSampleEpub()
  const book = await parseBook(bytes, 'the-salt-path-sample.epub')
  assert.equal(book.format, 'epub')
  assert.equal(book.title, 'The Salt Path')
  assert.equal(book.chapters.length, 3)
  assert.equal(book.toc[0].label, '1. The letting go')
})

test('parseEpub: sample book metadata, spine, toc, cover', () => {
  const book = parseEpub(buildSampleEpub())
  assert.equal(book.title, 'The Salt Path')
  assert.equal(book.author, 'H. R. Marlowe')
  assert.ok(book.cover.startsWith('data:image/svg+xml;base64,'), 'cover data url')
  assert.equal(book.chapters.length, 3)
  assert.equal(book.toc.length, 4, 'flat + nested toc entries')
  assert.equal(book.toc[0].label, '1. The letting go')
  assert.equal(book.toc[0].depth, 0, 'top level unindented')
  assert.equal(book.toc[1].label, '2. A map with no roads')
  assert.equal(book.toc[1].depth, 0)
  assert.equal(book.toc[2].label, 'The causeway', 'nested entry follows its parent')
  assert.equal(book.toc[2].depth, 1, 'nested entry indented')
  assert.equal(book.toc[2].frag, 'half')
  assert.equal(book.toc[3].label, '3. Lantern hours')
  assert.equal(book.toc[3].depth, 0)
  assert.equal(book.toc[0].href, 'OEBPS/ch1.xhtml')
  assert.ok(book.chapters[0].text.includes('sold on a Tuesday'))
  assert.ok(book.chapters[1].text.includes('ordinance') === false) // sanity: no hallucinated text
  assert.ok(book.chapters[1].text.includes('ordnance survey'))
  assert.ok(!book.chapters[0].text.includes('The letting go'), 'duplicated chapter heading stripped from text')
  assert.ok(!/<h2>/i.test(book.chapters[0].html), 'duplicated chapter heading stripped from html')
  assert.ok(!book.chapters[2].text.includes('Lantern hours'), 'chapter 3 heading stripped too')
  assert.ok(book.chapters[1].text.trimStart().startsWith('The coastal path'), 'body text survives stripping')
})

test('parseEpub: hostile content is stripped, links rewritten', () => {
  const opf = `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="i">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>X</dc:title><dc:id id="i">x</dc:id></metadata>
<manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest>
<spine><itemref idref="c1"/></spine></package>`
  const c1 = `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title>
<style>body{}</style><script>alert(1)</script></head><body>
<p onclick="evil()" style="color:red" class="x">Hello <em>world</em>.</p>
<img src="pic.png" onerror="evil()" srcset="a 1x"/>
<a href="https://example.com">ext</a> <a href="#top">frag</a> <a href="other.xhtml#p2">int</a>
<a href="javascript:evil()">js</a><iframe src="x"></iframe></body></html>`
  const bytes = zipSync({
    'mimetype': [enc.encode('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': enc.encode(`<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="ops.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`),
    'ops.opf': enc.encode(opf),
    'c1.xhtml': enc.encode(c1),
    'pic.png': new Uint8Array([137, 80, 78, 71]),
  })
  const book = parseEpub(bytes)
  const html = book.chapters[0].html
  assert.ok(!/<script/i.test(html), 'no script element')
  assert.ok(!html.includes('iframe'), 'no iframe')
  assert.ok(!html.includes('onclick'), 'no onclick')
  assert.ok(!html.includes('onerror'), 'no onerror')
  assert.ok(!html.includes('style='), 'no inline style')
  assert.ok(!html.includes('class='), 'no class')
  assert.ok(html.includes('data-ext="https://example.com"'), 'external link flagged')
  assert.ok(html.includes('data-frag="#top"'), 'fragment link kept')
  assert.ok(html.includes('data-chap="other.xhtml"'), 'internal link resolved')
  assert.ok(html.includes('data-frag="#p2"'), 'internal fragment kept')
  assert.ok(!html.includes('javascript:'), 'javascript: urls removed')
  assert.ok(html.includes('data:image/png;base64,'), 'image inlined')
})

test('resolvePath and zipDir', () => {
  assert.equal(resolvePath('OEBPS/text', '../images/pic.png'), 'OEBPS/images/pic.png')
  assert.equal(resolvePath('OEBPS', './ch1.xhtml#x'), 'OEBPS/ch1.xhtml')
  assert.equal(zipDir('OEBPS/text/ch.xhtml'), 'OEBPS/text')
})

// ---- offset helpers against a DOM (xmldom in tests, real DOM in the app) ----
const doc = new DOMParser().parseFromString(
  '<html xmlns="http://www.w3.org/1999/xhtml"><body><div id="r">One <em>two</em> three</div></body></html>',
  'application/xhtml+xml')
const root = doc.getElementById('r')

test('textLength over nested markup', () => {
  assert.equal(textLength(root), 'One two three'.length)
})

test('absOffset/locate roundtrip across element boundaries', () => {
  const em = doc.getElementById('r').childNodes[1] // <em>
  const twoText = em.childNodes[0]
  assert.equal(absOffset(root, twoText, 0), 4, 'start of "two"')
  assert.equal(absOffset(root, twoText, 3), 7, 'end of "two"')
  // whole phrase "two three" spans <em> boundary
  const loc = locate(root, 4, 14)
  assert.ok(loc, 'located')
  assert.equal(loc[0].nodeValue.slice(loc[1], loc[0].nodeValue.length) + ' three', 'two three')
})

test('locate handles empty and out-of-range input', () => {
  assert.equal(locate(root, 5, 5), null, 'empty range')
  const clamped = locate(root, 0, 9999) // end beyond text gets clamped
  assert.ok(clamped, 'clamped range located')
  assert.equal(clamped[0].nodeValue, 'One ', 'starts at first text node')
  assert.equal(clamped[2].nodeValue, ' three', 'ends at last text node')
  assert.equal(clamped[3], 6, 'end clamped to last text length')
  const inside = locate(root, 4, 6) // fully inside <em> text
  assert.ok(inside, 'single-node range found')
  assert.equal(inside[0].nodeValue.slice(inside[1], inside[3]), 'tw')
})

test('unwrapMarks restores original text', () => {
  const original = root.textContent
  // simulate a mark by wrapping the em's text
  const em = doc.getElementById('r').childNodes[1]
  const mark = doc.createElement('mark')
  mark.setAttribute('class', 'hl')
  mark.setAttribute('data-hl', 'n1')
  const t = em.childNodes[0]
  em.replaceChild(mark, t)
  mark.appendChild(t)
  assert.equal(root.textContent, original, 'wrapping does not change text')
  unwrapMarks(root)
  assert.equal(root.textContent, original, 'unwrap restores text')
  // no leftover mark nodes
  const walker = (n, acc = []) => { if (n.nodeType === 1 && (n.getAttribute && n.getAttribute('class') === 'hl')) acc.push(n); for (const c of n.childNodes || []) walker(c, acc); return acc }
  assert.equal(walker(root).length, 0, 'all marks removed')
})
