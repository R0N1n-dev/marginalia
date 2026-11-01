// Format detection + dispatch. One normalized shape for every format:
// { format, title, author, cover, toc, chapters:[{path, html, text}] }
// PDF additionally carries a live pdf.js handle (session only, never persisted).
import { unzipSync } from 'fflate'
import { parseEpub, sanitizeFragment } from './epub.js'
import { parseFb2 } from './fb2.js'
import { parseText, decodeText, stem } from './text.js'

const latin1 = (u8, from, to) => {
  let s = ''
  for (let i = from; i < to && i < u8.length; i++) s += String.fromCharCode(u8[i])
  return s
}

export function detectFormat(bytes, name = '') {
  const ext = ((name.match(/\.([^.]+)$/) || [])[1] || '').toLowerCase()
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05)) return 'zip'
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return 'pdf'
  const palm = latin1(bytes, 60, 68)
  if (palm === 'BOOKMOBI' || palm === 'TEXtREAd') return 'mobi'
  const head = latin1(bytes, 0, 1024)
  if (/<FictionBook[\s>]/i.test(head)) return 'fb2'
  if (/^\s*(?:<\?xml[^>]*\?>\s*)?(?:<!DOCTYPE[^>]*>\s*)?<html[\s>]/i.test(head)) return 'html'
  if (['mobi', 'azw', 'azw3', 'prc', 'azw11', 'pdb'].includes(ext)) return 'mobi'
  if (ext === 'fb2') return 'fb2'
  if (ext === 'html' || ext === 'htm' || ext === 'xhtml') return 'html'
  if (ext === 'pdf') return 'pdf'
  return 'txt'
}

function parseHtml(bytes, name) {
  const text = decodeText(bytes)
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(text)
  const title = m ? m[1].replace(/<[^>]+>/g, '').trim().replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>') : ''
  const { html, text: plain } = sanitizeFragment(text, null)
  if (!plain.trim()) throw new Error('That HTML file has no readable text')
  return {
    format: 'html',
    title: title || stem(name),
    author: '',
    cover: null,
    toc: [{ label: title || stem(name), href: 'h0', frag: null, depth: 0 }],
    chapters: [{ path: 'h0', html, text: plain }],
  }
}

export async function parseBook(bytes, name = '') {
  let fmt = detectFormat(bytes, name)
  if (fmt === 'zip') {
    // fflate hands the filter an info object, not a bare path.
    const files = unzipSync(bytes, {
      filter: (f) => f.name === 'META-INF/container.xml' || /\.fb2$/i.test(f.name),
    })
    if (files['META-INF/container.xml']) fmt = 'epub'
    else if (Object.keys(files).some((k) => /\.fb2$/i.test(k))) fmt = 'fb2'
    else throw new Error('Unsupported archive — only EPUB and .fb2.zip are recognized')
  }
  switch (fmt) {
    case 'epub':
      return { format: 'epub', ...parseEpub(bytes) }
    case 'fb2':
      return parseFb2(bytes)
    case 'txt':
      return parseText(bytes, name)
    case 'html':
      return parseHtml(bytes, name)
    case 'mobi': {
      const { parseMobi } = await import('./mobi.js')
      return parseMobi(bytes, name)
    }
    case 'pdf': {
      const { parsePdf } = await import('./pdf.js')
      return parsePdf(bytes, name)
    }
    default:
      throw new Error(`Unsupported format: ${fmt}`)
  }
}

export const SUPPORTED_EXT = ['.epub', '.fb2', '.mobi', '.azw', '.azw3', '.prc', '.pdf', '.txt', '.html', '.htm', '.md']
export const ACCEPT_ATTR = '.epub,.fb2,.zip,.mobi,.azw,.azw3,.prc,.pdf,.txt,.html,.htm,.md'
