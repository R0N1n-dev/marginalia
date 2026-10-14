// PDF support via pdf.js (Apache-2.0). Pages become "chapters": the reader
// shows them as canvases; text is extracted lazily for search.
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import { stem } from './text.js'

let workerReady = false
async function ensureWorker() {
  if (workerReady) return
  workerReady = true
  // Vite-only import (node tests skip it; pdf.js falls back to its fake worker)
  if (typeof window !== 'undefined') {
    try {
      const mod = await import('pdfjs-dist/legacy/build/pdf.worker.mjs?url')
      pdfjsLib.GlobalWorkerOptions.workerSrc = mod.default
    } catch (e) { /* fake worker */ }
  }
}

const ASSET_BASE = '/pdfjs/'

function getDocument(bytes) {
  return pdfjsLib.getDocument({
    data: bytes.slice(), // pdf.js detaches the buffer; keep session bytes intact
    cMapUrl: ASSET_BASE + 'cmaps/',
    cMapPacked: true,
    standardFontDataUrl: ASSET_BASE + 'standard_fonts/',
    wasmUrl: ASSET_BASE + 'wasm/',
    isEvalSupported: false,
  }).promise
}

async function renderCover(pdf) {
  if (typeof document === 'undefined') return null
  try {
    const page = await pdf.getPage(1)
    const base = page.getViewport({ scale: 1 })
    const scale = Math.min(420 / base.width, 620 / base.height)
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport }).promise
    return canvas.toDataURL('image/jpeg', 0.72)
  } catch (e) {
    return null
  }
}

async function resolveDestPage(pdf, dest) {
  if (typeof dest === 'string') dest = await pdf.getPageIndex(dest) + 1 // named dest -> index handled below
  if (Array.isArray(dest)) {
    const ref = dest[0]
    try {
      const idx = await pdf.getPageIndex(ref)
      return idx + 1
    } catch (e) { return null }
  }
  if (typeof dest === 'number') return dest + 1
  return null
}

export async function parsePdf(bytes, name) {
  await ensureWorker()
  const pdf = await getDocument(bytes)
  let title = ''
  let author = ''
  try {
    const meta = await pdf.getMetadata()
    title = ((meta && meta.info && meta.info.Title) || '').trim()
    author = ((meta && meta.info && meta.info.Author) || '').trim()
  } catch (e) { /* metadata optional */ }

  const numPages = pdf.numPages
  const chapters = []
  for (let i = 1; i <= numPages; i++) {
    chapters.push({ path: `p${i}`, html: '', text: '' })
  }

  let toc = []
  try {
    const outline = await pdf.getOutline()
    if (outline && outline.length) {
      const flat = []
      const walk = (items, depth) => {
        for (const it of items || []) {
          flat.push({ it, depth })
          if (it.items) walk(it.items, depth + 1)
        }
      }
      walk(outline, 0)
      for (const { it, depth } of flat) {
        const pageNo = await resolveDestPage(pdf, it.dest)
        if (pageNo && pageNo <= numPages) {
          toc.push({
            label: (it.title || '').trim() || `Page ${pageNo}`,
            href: `p${pageNo}`,
            frag: null,
            depth,
          })
        }
      }
    }
  } catch (e) { /* no outline */ }
  if (!toc.length) {
    for (let i = 1; i <= numPages; i++) toc.push({ label: `Page ${i}`, href: `p${i}`, frag: null, depth: 0 })
  }

  const cover = await renderCover(pdf)
  return {
    format: 'pdf',
    title: title || stem(name),
    author,
    cover,
    toc,
    chapters,
    pdf, // live handle: session-only, never serialized
    textReady: false,
  }
}

// Fill chapter text (for find-in-book and page notes) on first use.
export async function ensurePdfText(book) {
  if (!book.pdf || book.textReady) return
  for (let i = 0; i < book.chapters.length; i++) {
    const c = book.chapters[i]
    if (c.text) continue
    try {
      const page = await book.pdf.getPage(i + 1)
      const tc = await page.getTextContent()
      c.text = tc.items.map((x) => ('str' in x ? x.str : '')).join(' ')
    } catch (e) { /* page unreadable */ }
  }
  book.textReady = true
}

export async function renderPdfPage(book, index, canvas, maxW, maxH) {
  if (!book.pdf) return
  if (book._renderTask) {
    try { book._renderTask.cancel() } catch (e) { /* superseded */ }
    book._renderTask = null
  }
  const page = await book.pdf.getPage(index + 1)
  const base = page.getViewport({ scale: 1 })
  const scale = Math.min(maxW / base.width, maxH / base.height)
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const viewport = page.getViewport({ scale: scale * dpr })
  canvas.width = Math.floor(viewport.width)
  canvas.height = Math.floor(viewport.height)
  canvas.style.width = Math.floor(viewport.width / dpr) + 'px'
  canvas.style.height = Math.floor(viewport.height / dpr) + 'px'
  const task = page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport })
  book._renderTask = task
  await task.promise
  if (book._renderTask === task) book._renderTask = null
}

export function destroyPdf(book) {
  if (book && book._renderTask) {
    try { book._renderTask.cancel() } catch (e) { /* already done */ }
    book._renderTask = null
  }
  if (book && book.pdf) {
    try { book.pdf.destroy() } catch (e) { /* already destroyed */ }
    book.pdf = null
  }
}
