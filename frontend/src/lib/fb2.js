// FB2 parser (plain and .fb2.zip). Pure + node-testable via @xmldom/xmldom.
// Output markup is generated from a whitelist — book text is always escaped,
// so this path needs no sanitizer pass.
import { unzipSync, strFromU8 } from 'fflate'
import { DOMParser } from '@xmldom/xmldom'

const parser = new DOMParser({ onError: () => {} })

function byTag(root, name) {
  const out = []
  const walk = (n) => {
    if (n.nodeType === 1) {
      const local = (n.localName || n.nodeName.split(':').pop()).toLowerCase()
      if (local === name) out.push(n)
    }
    for (const c of n.childNodes || []) walk(c)
  }
  walk(root)
  return out
}
const first = (root, name) => byTag(root, name)[0]
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function textOf(n) {
  let s = ''
  const walk = (x) => {
    if (x.nodeType === 3) { s += x.nodeValue; return }
    if (x.nodeType === 1) for (const c of x.childNodes || []) walk(c)
  }
  walk(n)
  return s
}

// FB2 files frequently declare entities from their DTD; xmldom has no DTD
// resolver, so map the common ones before parsing.
const NAMED = {
  nbsp: '\u00a0', shy: '\u00ad', mdash: '\u2014', ndash: '\u2013', hellip: '\u2026',
  laquo: '\u00ab', raquo: '\u00bb', copy: '\u00a9', trade: '\u2122', deg: '\u00b0',
  bull: '\u2022', middot: '\u00b7', times: '\u00d7', divide: '\u00f7',
  lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201c', rdquo: '\u201d',
  minus: '\u2212', plusmn: '\u00b1', frac12: '\u00bd', euro: '\u20ac', pound: '\u00a3',
}
function repairEntities(xml) {
  return xml.replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, (m, name) => {
    const rep = NAMED[name]
    if (rep !== undefined) return rep
    return /^(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+)$/.test(name) ? m : ''
  })
}

function decodeXml(u8) {
  // encoding is declared in the prolog; read it as latin1 first
  let pre = ''
  for (let i = 0; i < Math.min(u8.length, 400); i++) pre += String.fromCharCode(u8[i])
  const m = /encoding=["']([\w-]+)["']/.exec(pre)
  let label = (m && m[1]) || 'utf-8'
  if (/^utf-?16$/i.test(label)) label = 'utf-8'
  try {
    return new TextDecoder(label.toLowerCase(), { fatal: false }).decode(u8)
  } catch (e) {
    return new TextDecoder('utf-8').decode(u8)
  }
}

function pickZipEntry(files) {
  const keys = Object.keys(files)
  const entry = keys.find((k) => /\.fb2$/i.test(k)) ||
    keys.find((k) => !/\/$/.test(k) && !/^\./.test(k))
  if (!entry) throw new Error('No .fb2 file inside the archive')
  return files[entry]
}

function inlineHtml(n, bin) {
  if (n.nodeType === 3) return esc(n.nodeValue)
  if (n.nodeType !== 1) return ''
  const tag = (n.localName || n.nodeName.split(':').pop()).toLowerCase()
  const kids = () => Array.from(n.childNodes || []).map((c) => inlineHtml(c, bin)).join('')
  switch (tag) {
    case 'strong': case 'b': return `<strong>${kids()}</strong>`
    case 'emphasis': case 'i': case 'em': return `<em>${kids()}</em>`
    case 'strike': case 's': return `<s>${kids()}</s>`
    case 'sub': return `<sub>${kids()}</sub>`
    case 'sup': return `<sup>${kids()}</sup>`
    case 'image': {
      const href = n.getAttribute('l:href') || n.getAttribute('xlink:href') || n.getAttribute('href') || ''
      const id = href.replace(/^#/, '')
      const url = bin[id]
      return url ? `<img src="${url}" alt=""/>` : ''
    }
    case 'br': return '<br/>'
    case 'a': return kids() // links in FB2 are internal footnote refs: keep text only
    default: return kids()
  }
}

function sectionToHtml(section, bin, depth) {
  const out = []
  const epigraph = first(section, 'epigraph')
  if (epigraph) out.push(`<blockquote>${Array.from(epigraph.childNodes || []).map((c) => inlineHtml(c, bin)).join('')}</blockquote>`)
  for (const c of section.childNodes || []) {
    if (c.nodeType !== 1) continue
    const tag = (c.localName || c.nodeName.split(':').pop()).toLowerCase()
    if (tag === 'title' || tag === 'epigraph' || tag === 'section') continue
    if (tag === 'p') out.push(`<p>${inlineHtml(c, bin)}</p>`)
    else if (tag === 'subtitle') out.push(`<p><strong>${inlineHtml(c, bin)}</strong></p>`)
    else if (tag === 'cite') out.push(`<blockquote>${Array.from(c.childNodes || []).map((x) => inlineHtml(x, bin)).join('')}</blockquote>`)
    else if (tag === 'table') {
      const rows = byTag(c, 'tr').map((tr) =>
        `<tr>${byTag(tr, 'td').concat(byTag(tr, 'th')).map((td) => `<td>${inlineHtml(td, bin)}</td>`).join('')}</tr>`).join('')
      out.push(`<table>${rows}</table>`)
    } else if (tag === 'image') {
      const h = inlineHtml(c, bin)
      if (h) out.push(h)
    } else if (tag === 'empty-line') out.push('<hr/>')
    else if (tag === 'annotation') out.push(`<blockquote>${Array.from(c.childNodes || []).map((x) => inlineHtml(x, bin)).join('')}</blockquote>`)
  }
  return out.join('')
}

function plainOf(html) {
  return html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|h\d|blockquote|tr|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/\u00a0/g, ' ')
}

export function parseFb2(bytesIn) {
  let bytes = bytesIn
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) bytes = pickZipEntry(unzipSync(bytes))
  const xml = repairEntities(decodeXml(bytes))
    .replace(/<!DOCTYPE[\s\S]*?>/i, '')
  let doc
  try {
    doc = parser.parseFromString(xml, 'application/xml')
  } catch (e) {
    throw new Error('That FB2 file is not valid XML')
  }
  const desc = first(doc, 'description')
  const ti = desc && first(desc, 'title-info')

  const title = ti ? textOf(first(ti, 'book-title') || { childNodes: [] }).trim() : ''
  let author = ''
  if (ti) {
    const a = first(ti, 'author')
    if (a) {
      author = ['first-name', 'middle-name', 'last-name', 'nickname']
        .map((k) => textOf(first(a, k) || { childNodes: [] }).trim()).filter(Boolean).join(' ')
    }
  }

  // embedded binaries: id -> data url
  const bin = {}
  for (const b of byTag(doc, 'binary')) {
    const id = b.getAttribute('id')
    const type = b.getAttribute('content-type') || 'image/jpeg'
    const data = textOf(b).replace(/\s+/g, '')
    if (id && data) bin[id] = `data:${type};base64,${data}`
  }
  let cover = null
  if (ti) {
    const cp = first(ti, 'coverpage')
    const img = cp && first(cp, 'image')
    const href = img && (img.getAttribute('l:href') || img.getAttribute('xlink:href') || img.getAttribute('href') || '')
    if (href) cover = bin[href.replace(/^#/, '')] || null
  }

  const chapters = []
  const toc = []
  const bodies = byTag(doc, 'body')
  for (const body of bodies.length ? bodies : [doc]) {
    const bodyName = (body.getAttribute('name') || '').toLowerCase()
    const noteBody = bodyName.includes('note')
    const processSection = (section, depth) => {
      const t = first(section, 'title')
      const label = t ? byTag(t, 'p').map((p) => textOf(p).trim()).filter(Boolean).join(' — ') : ''
      const html = sectionToHtml(section, bin, depth)
      const subs = []
      for (const c of section.childNodes || []) {
        if (c.nodeType === 1 && (c.localName || '').toLowerCase() === 'section') subs.push(c)
      }
      // parent section contributes its own content first, subsections after
      if (html.trim()) {
        const path = `fb2-${chapters.length}`
        chapters.push({ path, html, text: plainOf(html) })
        toc.push({ label: label || `Section ${chapters.length}`, href: path, frag: null, depth: noteBody ? depth + 1 : depth })
      }
      for (const sub of subs) processSection(sub, depth + 1)
    }
    for (const c of body.childNodes || []) {
      if (c.nodeType === 1 && (c.localName || c.nodeName.split(':').pop()).toLowerCase() === 'section') processSection(c, 0)
    }
  }
  if (!chapters.length) throw new Error('FB2 has no readable sections')

  return {
    format: 'fb2',
    title: title || 'Untitled',
    author,
    cover,
    toc: toc.length ? toc : chapters.map((c, i) => ({ label: `Section ${i + 1}`, href: c.path, frag: null, depth: 0 })),
    chapters,
  }
}
