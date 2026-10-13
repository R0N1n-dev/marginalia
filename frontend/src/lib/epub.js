// EPUB parser. Pure functions over bytes — works in the webview and in Node tests
// (@xmldom/xmldom provides the DOM in both). No browser APIs required.
import { unzipSync, strFromU8 } from 'fflate'
import { DOMParser, XMLSerializer } from '@xmldom/xmldom'

// Lenient: real-world EPUBs are full of malformed XHTML. xmldom recovers a
// partial DOM instead of throwing, which is all we need after sanitizing.
const parser = new DOMParser({ onError: () => {} })

const DROPPED = new Set(['script', 'style', 'link', 'meta', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'audio', 'video', 'svg'])

function parseXml(str, mime = 'application/xhtml+xml') {
  return parser.parseFromString(str, mime)
}

// Walk elements matching a local name (prefix-agnostic: dc:title matches "title").
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

function textOf(root) {
  let s = ''
  const walk = (n) => {
    if (n.nodeType === 3) { s += n.nodeValue; return }
    if (n.nodeType === 1 && DROPPED.has((n.nodeName || '').toLowerCase())) return
    for (const c of n.childNodes || []) walk(c)
  }
  walk(root)
  return s
}

export function zipDir(path) {
  const i = path.lastIndexOf('/')
  return i < 0 ? '' : path.slice(0, i)
}

export function resolvePath(baseDir, rel) {
  rel = rel.split('#')[0]
  const parts = (baseDir ? baseDir + '/' + rel : rel).split('/')
  const out = []
  for (const p of parts) {
    if (p === '' || p === '.') continue
    if (p === '..') out.pop()
    else out.push(p)
  }
  return out.join('/')
}

const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  svg: 'image/svg+xml', webp: 'image/webp', avif: 'image/avif',
}

export function toBase64(u8) {
  let s = ''
  const CH = 0x8000
  for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH))
  return btoa(s)
}

function imageDataUrl(files, resolvedPath) {
  const bytes = files[resolvedPath]
  if (!bytes) return null
  const ext = resolvedPath.split('.').pop().toLowerCase()
  const mime = MIME[ext]
  if (!mime) return null
  return `data:${mime};base64,${toBase64(bytes)}`
}

// Remove anything that could execute or escape the reader chrome, and rewrite
// links/images to in-app forms. Book content is untrusted input.
function sanitizeChapter(html, chapterDir, files, zipPath, titleHint) {
  const doc = parseXml(html)
  const body = byTag(doc, 'body')[0] || doc.documentElement
  if (!body) return { html: '', text: '' }

  const drop = []
  const visit = (n) => {
    if (n.nodeType !== 1) return
    const tag = (n.nodeName || '').toLowerCase()
    if (DROPPED.has(tag)) { drop.push(n); return }
    // copy attrs first: live NamedNodeMap mutates while removing
    for (const attr of Array.from(n.attributes || [])) {
      const name = attr.name.toLowerCase()
      const value = attr.value || ''
      if (name.startsWith('on') || name === 'style' || name === 'class' || name === 'srcset') {
        n.removeAttribute(attr.name)
        continue
      }
      if (name === 'href') {
        if (/^https?:/i.test(value)) {
          n.setAttribute('data-ext', value)
          n.removeAttribute('href')
        } else if (value.startsWith('#')) {
          n.setAttribute('data-frag', value)
          n.removeAttribute('href')
        } else if (/^(mailto|tel):/i.test(value)) {
          // keep mailto/tel as-is; anything else with a scheme is dropped
        } else if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
          n.removeAttribute('href')
        } else {
          const [file, frag] = value.split('#')
          const resolved = resolvePath(chapterDir, file)
          if (resolved === zipPath) {
            if (frag) n.setAttribute('data-frag', '#' + frag)
          } else {
            n.setAttribute('data-chap', resolved)
            if (frag) n.setAttribute('data-frag', '#' + frag)
          }
          n.removeAttribute('href')
        }
      } else if (name === 'src') {
        if (/^(https?:|data:)/i.test(value)) continue
        const resolved = resolvePath(chapterDir, value)
        const url = imageDataUrl(files, resolved)
        if (url) n.setAttribute('src', url)
        else n.removeAttribute('src')
      }
    }
    for (const c of Array.from(n.childNodes || [])) visit(c)
  }
  visit(body)
  for (const n of drop) n.parentNode && n.parentNode.removeChild(n)

  // The reader renders its own chapter heading; drop the duplicate the EPUB
  // repeats at the top of the file (must happen before text extraction so
  // saved highlight offsets always agree with the rendered text).
  const firstEl = Array.from(body.childNodes || []).find((c) => c.nodeType === 1)
  if (firstEl && titleHint && /^h[1-6]$/.test((firstEl.nodeName || '').toLowerCase())) {
    const norm = (x) => x.toLowerCase().replace(/^\s*\d+[.)]?\s*/, '').replace(/\s+/g, ' ').trim()
    if (norm(textOf(firstEl)) === norm(titleHint)) body.removeChild(firstEl)
  }

  const inner = Array.from(body.childNodes || [])
    .map((c) => new XMLSerializer().serializeToString(c))
    .join('')
  return { html: inner, text: textOf(body) }
}

function navToc(opfDir, opf, files) {
  const navItem = byTag(opf, 'item').find((i) => (i.getAttribute('properties') || '').split(/\s+/).includes('nav'))
  if (!navItem) return null
  const navPath = resolvePath(opfDir, navItem.getAttribute('href'))
  const bytes = files[navPath]
  if (!bytes) return null
  const doc = parseXml(strFromU8(bytes))
  const navs = byTag(doc, 'nav')
  const nav = navs.find((n) => (n.getAttribute('epub:type') || n.getAttribute('type') || '').includes('toc')) || navs[0]
  if (!nav) return null
  const base = zipDir(navPath)
  const out = []
  // start at -1 so nav > ol (the top level) lands on depth 0
  const walk = (n, depth) => {
    if (n.nodeType !== 1) return
    const tag = (n.nodeName || '').toLowerCase()
    if (tag === 'a') {
      const href = n.getAttribute('href')
      if (href) out.push({ label: textOf(n).trim() || href, href: resolvePath(base, href), frag: href.split('#')[1] || null, depth })
      return
    }
    if (tag === 'ol' || tag === 'ul') depth += 1
    for (const c of n.childNodes || []) walk(c, depth)
  }
  for (const c of nav.childNodes || []) walk(c, -1)
  return out.length ? out : null
}

function ncxToc(opfDir, opf, files) {
  const ncxItem = byTag(opf, 'item').find((i) => (i.getAttribute('media-type') || '').includes('dtbncx'))
  if (!ncxItem) return null
  const ncxPath = resolvePath(opfDir, ncxItem.getAttribute('href'))
  const bytes = files[ncxPath]
  if (!bytes) return null
  const doc = parseXml(strFromU8(bytes))
  const base = zipDir(ncxPath)
  const out = []
  const navMap = byTag(doc, 'navMap')[0]
  const directPoints = (parent, depth) => {
    for (const c of parent.childNodes || []) {
      if (c.nodeType !== 1 || (c.nodeName || '').toLowerCase() !== 'navpoint') continue
      const label = byTag(c, 'text')[0]
      const content = byTag(c, 'content')[0]
      const src = content && content.getAttribute('src')
      if (src) out.push({ label: textOf(label).trim(), href: resolvePath(base, src), frag: src.split('#')[1] || null, depth })
      directPoints(c, depth + 1)
    }
  }
  if (navMap) directPoints(navMap, 0)
  return out.length ? out : null
}

export function parseEpub(bytes) {
  const files = unzipSync(bytes)
  const containerBytes = files['META-INF/container.xml']
  if (!containerBytes) throw new Error('Not an EPUB: missing META-INF/container.xml')
  const container = parseXml(strFromU8(containerBytes))
  const rootfile = byTag(container, 'rootfile')[0]
  const opfPath = rootfile && rootfile.getAttribute('full-path')
  if (!opfPath || !files[opfPath]) throw new Error('Not an EPUB: missing package file')
  const opfDir = zipDir(opfPath)
  const opf = parseXml(strFromU8(files[opfPath]))

  const title = (byTag(opf, 'title')[0] ? textOf(byTag(opf, 'title')[0]).trim() : '') || 'Untitled'
  const creator = byTag(opf, 'creator')[0] ? textOf(byTag(opf, 'creator')[0]).trim() : ''

  const manifest = {}
  for (const item of byTag(opf, 'item')) {
    manifest[item.getAttribute('id')] = {
      href: resolvePath(opfDir, item.getAttribute('href')),
      mediaType: item.getAttribute('media-type') || '',
      properties: item.getAttribute('properties') || '',
    }
  }

  // Cover: EPUB3 cover-image property, else the legacy <meta name="cover"> id.
  let cover = null
  const coverItem = Object.values(manifest).find((m) => m.properties.split(/\s+/).includes('cover-image'))
  const metaCover = byTag(opf, 'meta').find((m) => m.getAttribute('name') === 'cover')
  const legacy = metaCover && manifest[metaCover.getAttribute('content')]
  const target = coverItem || legacy
  if (target && target.mediaType.startsWith('image/')) cover = imageDataUrl(files, target.href)

  const spine = []
  for (const ref of byTag(opf, 'itemref')) {
    const item = manifest[ref.getAttribute('idref')]
    if (item && item.mediaType.includes('html')) spine.push(item.href)
  }
  if (!spine.length) throw new Error('EPUB has no readable chapters')

  const realToc = navToc(opfDir, opf, files) || ncxToc(opfDir, opf, files)
  // first entry for a path wins: nested/fragment entries share the chapter href
  const labelFor = new Map()
  if (realToc) for (const e of realToc) if (!labelFor.has(e.href)) labelFor.set(e.href, e.label)

  const chapters = []
  for (const path of [...new Set(spine)]) {
    const b = files[path]
    if (!b) continue
    const { html, text } = sanitizeChapter(strFromU8(b), zipDir(path), files, path, labelFor.get(path))
    chapters.push({ path, html, text })
  }
  if (!chapters.length) throw new Error('EPUB chapters could not be read')

  const toc = realToc || chapters.map((c, i) => ({ label: 'Chapter ' + (i + 1), href: c.path, frag: null, depth: 0 }))

  return { title, author: creator, cover, toc, chapters }
}
