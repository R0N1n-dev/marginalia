import test from 'node:test'
import assert from 'node:assert/strict'
import { parseText, decodeText } from '../src/lib/text.js'
import { parseBook, detectFormat } from '../src/lib/formats.js'

const enc = (s) => new TextEncoder().encode(s)

test('decodeText: utf-8, BOM, windows-1252 fallback, utf-16le', () => {
  assert.equal(decodeText(enc('héllo — ok')), 'héllo — ok')
  assert.equal(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x68, 0x69])), 'hi')
  // lone 0xE9 is invalid utf-8 → cp1252 é
  assert.equal(decodeText(new Uint8Array([0x63, 0x61, 0x66, 0xe9])), 'café')
  assert.equal(decodeText(new Uint8Array([0xff, 0xfe, 0x68, 0x00, 0x69, 0x00])), 'hi')
})

test('parseText: splits on chapter headings', () => {
  const txt = 'Chapter 1\nThe Start\n\nFirst paragraph here.\n\nSecond one.\n\nChapter 2\nNext\n\nMore text.'
  const book = parseText(enc(txt), 'story.txt')
  assert.equal(book.format, 'txt')
  assert.equal(book.title, 'story')
  assert.equal(book.chapters.length, 2)
  assert.equal(book.toc[0].label, 'Chapter 1')
  assert.equal(book.toc[1].label, 'Chapter 2')
  assert.ok(book.chapters[0].text.includes('First paragraph here.'))
  assert.ok(!book.chapters[0].text.includes('Chapter 2'))
  assert.ok(!/<script/i.test(book.chapters[0].html), 'text is escaped, not html')
})

test('parseText: no headings → single chapter', () => {
  const book = parseText(enc('Just a wall of text.\n\nWith paragraphs.'), 'notes.txt')
  assert.equal(book.chapters.length, 1)
  assert.equal(book.toc[0].label, 'Part 1')
  assert.ok(book.chapters[0].text.includes('With paragraphs.'))
})

test('detectFormat by magic and extension', () => {
  assert.equal(detectFormat(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]), 'x.pdf'), 'pdf')
  assert.equal(detectFormat(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), 'x.epub'), 'zip')
  assert.equal(detectFormat(new Uint8Array([0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,'B'.charCodeAt(0),'O'.charCodeAt(0),'O'.charCodeAt(0),'K'.charCodeAt(0),'M'.charCodeAt(0),'O'.charCodeAt(0),'B'.charCodeAt(0),'I'.charCodeAt(0)]), 'x.azw'), 'mobi')
  assert.equal(detectFormat(enc('<?xml version="1.0"?><FictionBook xmlns="x"></FictionBook>'), 'x.fb2'), 'fb2')
  assert.equal(detectFormat(enc('<!DOCTYPE html><html><body>hi</body></html>'), 'x.html'), 'html')
  assert.equal(detectFormat(enc('plain words'), 'x.txt'), 'txt')
  assert.equal(detectFormat(enc('plain words'), 'weird.xyz'), 'txt', 'unknown ext falls back to text')
})

test('parseBook: single-file html book', async () => {
  const html = '<html><head><title>My Essay</title><style>p{color:red}</style></head>' +
    '<body><h1>My Essay</h1><p onclick="evil()">Hello <em>world</em>.</p><script>alert(1)</script></body></html>'
  const book = await parseBook(enc(html), 'essay.html')
  assert.equal(book.format, 'html')
  assert.equal(book.title, 'My Essay')
  assert.equal(book.chapters.length, 1)
  assert.ok(book.chapters[0].text.includes('Hello world.'))
  assert.ok(!/<script/i.test(book.chapters[0].html))
  assert.ok(!/onclick/.test(book.chapters[0].html))
  assert.ok(!/<style/i.test(book.chapters[0].html))
})

test('parseBook: unsupported archive errors clearly', async () => {
  const { zipSync } = await import('fflate')
  const bytes = zipSync({ 'image1.jpg': enc('not really an image') })
  await assert.rejects(() => parseBook(bytes, 'comics.cbz'), /Unsupported archive/)
})
