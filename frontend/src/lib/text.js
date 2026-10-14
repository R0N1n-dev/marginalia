// Plain text books: decode, split into chapters on heading-looking lines.
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function stem(name) {
  return (name || 'Untitled').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Untitled'
}

export function decodeText(bytes) {
  // BOM sniffing first, then strict UTF-8, then Windows-1252 as a fallback.
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3))
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2))
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes.subarray(2))
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (e) {
    return new TextDecoder('windows-1252').decode(bytes)
  }
}

const HEADING = new RegExp(
  '^(?:' +
  '(?:chapter|part|book|section|story|essay|letter|prologue|epilogue|introduction|preface|afterword|appendix)' +
  '\\s+(?:\\w+|[0-9IVXLC]+)?[^\\n]{0,50}' +
  '|[0-9]{1,3}[.)]\\s+\\S[^\\n]{0,50}' +
  '|[IVXLC]{1,8}[.)]\\s+\\S[^\\n]{0,50}' +
  ')\\s*$', 'i')

const isHeading = (t) => t.length <= 70 && HEADING.test(t) && !/^[-=_*#]+$/.test(t)

const stripTags = (html) =>
  html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')

function chunkHtml(lines) {
  const paras = lines.join('\n').split(/\n{2,}/)
  const html = paras
    .map((p) => {
      const inner = p.split('\n').map((l) => esc(l.trim())).filter(Boolean)
      return inner.length ? `<p>${inner.join('<br/>')}</p>` : ''
    })
    .filter(Boolean).join('')
  return html
}

export function parseText(bytes, name) {
  const raw = decodeText(bytes).replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '')
  const lines = raw.split('\n')

  const heads = []
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim()
    if (t && isHeading(t)) heads.push(i)
  }

  // slice into [start, end) ranges; preamble before the first heading included
  const ranges = []
  if (!heads.length) {
    ranges.push([0, lines.length])
  } else {
    if (heads[0] > 0) ranges.push([0, heads[0]])
    for (let h = 0; h < heads.length; h++) {
      ranges.push([heads[h], h + 1 < heads.length ? heads[h + 1] : lines.length])
    }
  }

  const chapters = []
  const toc = []
  for (const [start, end] of ranges) {
    let bodyLines = lines.slice(start, end)
    while (bodyLines.length && !bodyLines[0].trim()) bodyLines.shift()
    let label = null
    if (bodyLines.length && isHeading(bodyLines[0].trim())) label = bodyLines.shift().trim()
    const html = chunkHtml(bodyLines)
    if (!stripTags(html).trim()) continue
    const path = `t${chapters.length}`
    chapters.push({ path, html, text: stripTags(html) })
    toc.push({ label: label || `Part ${chapters.length}`, href: path, frag: null, depth: 0 })
  }
  if (!chapters.length) throw new Error('No readable text found')

  return { format: 'txt', title: stem(name), author: '', cover: null, toc, chapters }
}
