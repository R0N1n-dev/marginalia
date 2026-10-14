// MOBI/AZW/PRC adapter around foliate-js (MIT), which handles MOBI7 + KF8.
// foliate uses live browser DOM APIs, so this module runs in the webview.
import { MOBI } from 'foliate-js/mobi.js'
import { unzlibSync } from 'fflate'
import { sanitizeTree, toBase64 } from './epub.js'
import { stem } from './text.js'

async function blobToDataURL(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer())
  return `data:${blob.type || 'image/jpeg'};base64,${toBase64(buf)}`
}

export async function parseMobi(bytes, name) {
  const book = await new MOBI({ unzlib: unzlibSync }).open(new Blob([bytes]))
  const meta = book.metadata || {}
  const title = (typeof meta.title === 'string' && meta.title.trim()) || stem(name)
  const author = Array.isArray(meta.author)
    ? meta.author.filter(Boolean).join(', ')
    : (typeof meta.author === 'string' ? meta.author : '')

  let cover = null
  try {
    const c = book.getCover && (await book.getCover())
    if (c) cover = await blobToDataURL(c)
  } catch (e) { /* no cover */ }

  const sections = book.sections || []
  const chapters = []
  const seen = new Set()
  for (let i = 0; i < sections.length; i++) {
    let doc
    try {
      doc = await sections[i].createDocument()
    } catch (e) {
      continue
    }
    const root = (doc && doc.body) || (doc && doc.documentElement)
    if (!root) continue
    sanitizeTree(root, {})
    const html = root.innerHTML || ''
    const text = root.textContent || ''
    if (!text.trim()) continue
    chapters.push({ path: `s${i}`, html, text })
    seen.add(`s${i}`)
  }
  if (!chapters.length) throw new Error('That MOBI file has no readable text')

  // foliate toc: {label, href:'filepos:…', subitems} — map each entry to a section
  const flat = []
  const walk = (items, depth) => {
    for (const it of items || []) {
      if (it.label) flat.push({ label: it.label, href: it.href, depth })
      if (it.subitems) walk(it.subitems, depth + 1)
    }
  }
  walk(book.toc, 0)
  const toc = []
  for (const it of flat) {
    if (!it.href) continue
    let path = null
    try {
      const r = await book.resolveHref(it.href)
      if (r && r.index >= 0) path = `s${r.index}`
    } catch (e) { /* unparsable href */ }
    if (path && seen.has(path)) toc.push({ label: it.label, href: path, frag: null, depth: it.depth })
  }
  if (!toc.length) {
    chapters.forEach((c, i) => toc.push({ label: `Section ${i + 1}`, href: c.path, frag: null, depth: 0 }))
  }
  return { format: 'mobi', title, author, cover, toc, chapters }
}
