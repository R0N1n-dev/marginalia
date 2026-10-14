import test from 'node:test'
import assert from 'node:assert/strict'

// Minimal but structurally valid one-page PDF with correct xref offsets.
function makePdf(title, text) {
  const esc = (s) => s.replace(/([\\()])/g, '\\$1')
  let pdf = '%PDF-1.4\n'
  const objs = []
  const add = (n, body) => {
    objs.push({ n, off: pdf.length })
    pdf += `${n} 0 obj\n${body}\nendobj\n`
  }
  const content = `BT /F1 24 Tf 72 700 Td (${esc(text)}) Tj ET`
  add(1, '<< /Type /Catalog /Pages 2 0 R >>')
  add(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>')
  add(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>')
  add(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  add(5, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`)
  add(6, `<< /Title (${esc(title)}) /Author (Marginalia Tests) >>`)
  const xrefPos = pdf.length
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
  for (const o of objs) pdf += `${String(o.off).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xrefPos}\n%%EOF`
  return new TextEncoder().encode(pdf)
}

test('parsePdf: pages, toc fallback, metadata, text extraction', async () => {
  const { parsePdf, ensurePdfText, destroyPdf } = await import('../src/lib/pdf.js')
  const book = await parsePdf(makePdf('Marginalia Test PDF', 'Hello from a PDF page'), 'notes.pdf')
  try {
    assert.equal(book.format, 'pdf')
    assert.equal(book.title, 'Marginalia Test PDF')
    assert.equal(book.author, 'Marginalia Tests')
    assert.equal(book.chapters.length, 1)
    assert.equal(book.toc[0].label, 'Page 1')
    assert.equal(book.chapters[0].path, 'p1')
    assert.equal(book.textReady, false)
    assert.equal(book.cover, null, 'no document rendering in node')
    await ensurePdfText(book)
    assert.equal(book.textReady, true)
    assert.ok(book.chapters[0].text.includes('Hello from a PDF page'),
      `extracted text: "${book.chapters[0].text}"`)
    await ensurePdfText(book) // idempotent
    assert.ok(book.chapters[0].text.includes('Hello from a PDF page'))
  } finally {
    destroyPdf(book)
  }
})

test('parsePdf: garbage input rejects with a real error', async () => {
  const { parsePdf } = await import('../src/lib/pdf.js')
  const junk = new TextEncoder().encode('%PDF-1.4\nbroken beyond repair')
  await assert.rejects(() => parsePdf(junk, 'x.pdf'))
})
