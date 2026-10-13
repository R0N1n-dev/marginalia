// Text-offset helpers for highlights. Character offsets are measured over
// textContent of the rendered chapter body: marks wrap text without changing
// textContent, so saved offsets stay valid across re-renders.
// Node-agnostic (only childNodes/nodeValue/nodeType) so Node tests can use xmldom.

const TEXT = 3
const ELEM = 1

export function textLength(node) {
  if (node.nodeType === TEXT) return node.nodeValue.length
  let n = 0
  for (const c of node.childNodes || []) n += textLength(c)
  return n
}

// Absolute text offset of (targetNode, innerOffset) inside root.
export function absOffset(root, target, inner) {
  let acc = 0
  let res = -1
  const walk = (n) => {
    if (res >= 0) return
    if (n === target) {
      res = acc + (n.nodeType === TEXT
        ? Math.min(inner, n.nodeValue.length)
        : [...(n.childNodes || [])].slice(0, inner).reduce((a, c) => a + textLength(c), 0))
      return
    }
    if (n.nodeType === TEXT) { acc += n.nodeValue.length; return }
    for (const c of n.childNodes || []) walk(c)
  }
  walk(root)
  return res
}

// Map absolute [start,end) offsets back to concrete text nodes/offsets.
// Returns null when the range is empty or beyond the text.
export function locate(root, start, end) {
  if (end <= start) return null
  let acc = 0
  let sn = null, so = 0, en = null, eo = 0, lastN = null, lastO = 0
  const walk = (n) => {
    if (en) return
    if (n.nodeType === TEXT) {
      const len = n.nodeValue.length
      if (!sn && start < acc + len) { sn = n; so = start - acc }
      if (end <= acc + len) { en = n; eo = Math.min(end - acc, len); return }
      lastN = n
      lastO = len
      acc += len
      return
    }
    for (const c of n.childNodes || []) walk(c)
  }
  walk(root)
  if (!sn) return null
  if (!en) { en = lastN; eo = lastO } // clamp: end past the text
  if (!en) return null
  return [sn, so, en, eo]
}

// Wrap [start,end) in a <mark class="hl"> using the extract/insert technique,
// which handles ranges crossing element boundaries (em, sup, …).
export function applyMark(doc, root, start, end, id) {
  const loc = locate(root, start, end)
  if (!loc) return null
  const range = doc.createRange()
  range.setStart(loc[0], loc[1])
  range.setEnd(loc[2], loc[3])
  const mark = doc.createElement('mark')
  mark.className = 'hl'
  mark.setAttribute('data-hl', id)
  try {
    mark.appendChild(range.extractContents())
    range.insertNode(mark)
  } catch (e) {
    // pathological ranges (e.g. selection ended inside a removed subtree): skip
    return null
  }
  return mark
}

// Remove all marks under root and merge the text nodes back together so
// offsets are measured against a clean tree again.
export function unwrapMarks(root) {
  const marks = []
  const isHl = (n) =>
    (n.classList && n.classList.contains('hl')) ||
    (n.getAttribute && /(^|\s)hl(\s|$)/.test(n.getAttribute('class') || ''))
  const walk = (n) => {
    if (n.nodeType === ELEM && isHl(n)) { marks.push(n); return }
    for (const c of n.childNodes || []) walk(c)
  }
  walk(root)
  for (const m of marks) {
    const parent = m.parentNode
    if (!parent) continue
    while (m.firstChild) parent.insertBefore(m.firstChild, m)
    parent.removeChild(m)
    parent.normalize && parent.normalize()
  }
}
