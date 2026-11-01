<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import {
  state, goToChapter, saveProgress, addNote, flash,
  notesOfCurrentChapter, setFontScale,
  isBookmarked, toggleBookmark, removeBookmark, toggleFocus,
} from '../lib/store.js'
import { openExternal } from '../lib/backend.js'
import { textLength, absOffset, locate, applyMark, unwrapMarks } from '../lib/marks.js'
import {
  columnWidth, pagesInFlow, scrollLeftFor, pageAt, railPercent,
} from '../lib/paginate.js'
import MarginaliaPanel from './MarginaliaPanel.vue'

const room = ref(null)    // reading room: centres the page and clips what surrounds it
const vp = ref(null)      // the page: a box exactly one page wide that clips the flow
const pdfCanvas = ref(null) // pdf page render target
const flow = ref(null)    // column container (own heading + book text)
const body = ref(null)    // book text only — highlight offsets are measured here

const page = ref(0)
const pages = ref(1)
const showToc = ref(true)
const showFind = ref(false)
const showHelp = ref(false)
const framed = ref(false)      // room to spare around the page → draw its edges
const pageFlags = ref([])      // highlight flags that belong to the current page
const selection = ref(null) // {start, end, rect}
const activeNoteId = ref('')
const editingId = ref('')
const findQ = ref('')
const results = ref([])
const findBusy = ref(false)

let PAGE = 620 // width of one page (the visible box)
let COL = 570 // text measure inside it
let INSET = 25 // gutter between the text and the page edge
let GAP = 50 // gutter between two columns (== both page gutters)
let pendingOffset = null
let pendingPage = null
let ro = null
let pdfMod = null
let pdfBook = null
let renderSeq = 0
let pdfResizeTimer = null

const book = computed(() => state.current && state.current.book)
const epub = computed(() => state.current && state.current.epub)
const idx = computed(() => state.current ? state.current.chapter : 0)
const chapter = computed(() => epub.value ? epub.value.chapters[idx.value] : null)
const chapterTitle = computed(() => {
  if (!epub.value) return ''
  const e = epub.value.toc.find((t) => t.href === (chapter.value && chapter.value.path))
  return e ? e.label : `Chapter ${idx.value + 1}`
})
const chapterNotes = computed(() => notesOfCurrentChapter().sort((a, b) => a.start - b.start))
const bookNotesCount = computed(() => state.notes.filter((n) => n.bookId === (book.value && book.value.id)).length)
const percent = computed(() => {
  if (!epub.value) return 0
  const total = epub.value.chapters.length
  return Math.min(100, Math.round(((idx.value + (page.value + 1) / pages.value) / total) * 100))
})
const isPdf = computed(() => !!(state.current && state.current.epub && state.current.epub.format === 'pdf'))
const bookmarks = computed(() => {
  const b = state.current && state.current.book
  return [...((b && b.bookmarks) || [])].sort((x, y) => x.chapter - y.chapter || (x.page || 0) - (y.page || 0))
})
const bookmarked = computed(() => isBookmarked(idx.value, page.value))

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/* ---------- pagination: CSS columns, exactly one column visible ----------
   The chapter is laid out as a column flow inside `.pagebox`, a scroll box that
   is *exactly one page wide* (PAGE). Everything past its right edge — the
   following columns — is clipped instead of peeking into the reading room, and
   the page is centred so wide windows get margins rather than half a neighbour.
   The text measure is narrower than the page by a gutter either side; the
   column gap equals both gutters, so one page turn is exactly PAGE pixels. */
async function layout({ keepPage = true, marks = true } = {}) {
  const v = vp.value
  const r = room.value
  if (!v || !r || !flow.value) return
  PAGE = columnWidth(r.clientWidth)
  INSET = Math.max(8, Math.min(26, Math.round(PAGE * 0.06)))
  COL = PAGE - INSET * 2
  GAP = INSET * 2
  framed.value = r.clientWidth - PAGE >= 40
  r.style.setProperty('--pagew', PAGE + 'px')
  v.style.width = PAGE + 'px'
  flow.value.style.width = COL + 'px'
  flow.value.style.columnWidth = COL + 'px'
  flow.value.style.columnGap = GAP + 'px'
  await nextTick()
  pages.value = pagesInFlow(flow.value.scrollWidth, COL, GAP)
  if (!keepPage) page.value = 0
  page.value = Math.min(page.value, pages.value - 1)
  applyScroll(false)
  if (marks) applyMarks()
  positionFlags()
  if (pendingOffset !== null) {
    const off = pendingOffset
    pendingOffset = null
    await scrollToOffset(off)
  }
}

const step = () => COL + GAP // where one page starts relative to the last

async function loadPdfMod() {
  if (!pdfMod) pdfMod = await import('../lib/pdf.js')
  return pdfMod
}
async function renderCurrentPdf() {
  if (!isPdf.value || !epub.value || !room.value || !pdfCanvas.value) return
  pdfBook = epub.value
  const seq = ++renderSeq
  try {
    const mod = await loadPdfMod()
    if (seq !== renderSeq) return
    await mod.renderPdfPage(
      epub.value, idx.value, pdfCanvas.value,
      Math.max(240, room.value.clientWidth - 48),
      Math.max(240, room.value.clientHeight - 36),
    )
  } catch (e) {
    if (seq === renderSeq) flash('Could not render that PDF page')
  }
}
function schedulePdfRender() {
  clearTimeout(pdfResizeTimer)
  pdfResizeTimer = setTimeout(renderCurrentPdf, 150)
}

/* Page turns are a transform on the column flow, not a scroll: the page box
   clips, so only the current page can ever be seen, and the last page needs no
   trailing slack to land flush. */
function applyScroll(smooth) {
  const f = flow.value
  if (!f) return
  const animate = smooth && !reducedMotion()
  f.style.transition = animate ? 'transform .26s cubic-bezier(.2,.7,.2,1)' : 'none'
  f.style.transform = `translateX(${-scrollLeftFor(page.value, step())}px)`
  positionFlags()
}
function setPage(n) {
  const next = Math.max(0, Math.min(pages.value - 1, n))
  if (next === page.value) return
  page.value = next
  applyScroll(true)
  clearSelection()
}
async function nextPage() {
  if (page.value < pages.value - 1) setPage(page.value + 1)
  else if (idx.value < epub.value.chapters.length - 1) { goToChapter(idx.value + 1); await nextTick(); }
}
async function prevPage() {
  if (page.value > 0) setPage(page.value - 1)
  else if (idx.value > 0) { pendingPage = -1; goToChapter(idx.value - 1) } // land on its last page
}

/* ---------- highlights ---------- */
function applyMarks() {
  const b = body.value
  if (!b) return
  unwrapMarks(b)
  const len = textLength(b)
  for (const n of chapterNotes.value) {
    if (n.start >= len) continue
    applyMark(document, b, n.start, Math.min(n.end, len), n.id)
  }
  positionFlags()
}

/* Page-edge flags: only the highlights that live on the page you are reading,
   placed at their true height on it. The page a highlight falls on is measured
   relative to the flow's own rect, so the page-turn transform cancels out and
   the flags stay correct even mid-turn. */
function positionFlags() {
  const b = body.value
  const v = vp.value
  if (!b || !v || !framed.value || !chapterNotes.value.length) { pageFlags.value = []; return }
  const box = v.getBoundingClientRect()
  const flowLeft = flow.value.getBoundingClientRect().left
  const len = textLength(b)
  const out = []
  for (const n of chapterNotes.value) {
    const start = Math.max(0, n.start)
    const end = Math.min(n.end, len)
    if (end <= start) continue // page-level notes (PDFs) have no text to point at
    const loc = locate(b, start, end)
    if (!loc) continue
    const node = loc[0].nodeType === 3 ? loc[0].parentElement : loc[0]
    if (!node || !node.getBoundingClientRect) continue
    const r = node.getBoundingClientRect()
    if (pageAt(r.left, flowLeft, step()) !== page.value) continue
    out.push({ id: n.id, color: n.color, quote: n.quote, top: railPercent(r.top + 4, box.top, box.height) })
  }
  pageFlags.value = out
}

function onSelect() {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || !sel.rangeCount) { selection.value = null; return }
  const range = sel.getRangeAt(0)
  if (!body.value || !body.value.contains(range.commonAncestorContainer)) { selection.value = null; return }
  const s = absOffset(body.value, range.startContainer, range.startOffset)
  const e = absOffset(body.value, range.endContainer, range.endOffset)
  if (s < 0 || e < 0 || e <= s) { selection.value = null; return }
  const r = range.getBoundingClientRect()
  selection.value = { start: s, end: e, rect: { cx: r.left + r.width / 2, top: r.top, bottom: r.bottom } }
}

const popStyle = computed(() => {
  if (!selection.value) return {}
  const { cx, top } = selection.value.rect
  const above = top > 76
  return above
    ? { left: cx + 'px', top: top - 10 + 'px', transform: 'translate(-50%, -100%)' }
    : { left: cx + 'px', top: top + selection.value.rect.bottom - selection.value.rect.top + 10 + 'px', transform: 'translate(-50%, 0)' }
})

function clearSelection() {
  selection.value = null
  const sel = window.getSelection()
  if (sel) sel.removeAllRanges()
}

async function createHighlight(color, withNote = false) {
  const sel = selection.value
  if (!sel || !body.value) return
  const quote = body.value.textContent.slice(sel.start, sel.end)
  const n = addNote({ chapter: idx.value, start: sel.start, end: sel.end, color, quote })
  clearSelection()
  applyMarks()
  activeNoteId.value = n.id
  if (withNote) editingId.value = n.id
}

async function copyQuote() {
  const sel = selection.value
  if (!sel || !body.value) return
  const quote = body.value.textContent.slice(sel.start, sel.end)
  clearSelection()
  try {
    await navigator.clipboard.writeText(quote)
    flash('Copied to clipboard')
  } catch (e) {
    flash('Copy is unavailable here')
  }
}

/* ---------- clicks: marks, links ---------- */
async function onBodyClick(e) {
  const hl = e.target.closest && e.target.closest('[data-hl]')
  if (hl) {
    activeNoteId.value = hl.getAttribute('data-hl')
    return
  }
  const ext = e.target.closest && e.target.closest('[data-ext]')
  if (ext) { e.preventDefault(); openExternal(ext.getAttribute('data-ext')); return }
  const chap = e.target.closest && e.target.closest('[data-chap]')
  if (chap) {
    const path = chap.getAttribute('data-chap')
    const i = epub.value.chapters.findIndex((c) => c.path === path)
    if (i >= 0) {
      const frag = chap.getAttribute('data-frag')
      if (frag) pendingFrag = frag.slice(1)
      goToChapter(i)
    }
    return
  }
  const fragLink = e.target.closest && e.target.closest('[data-frag]')
  if (fragLink && !chap) {
    pendingFrag = fragLink.getAttribute('data-frag').slice(1)
    await flushFrag()
  }
}

let pendingFrag = null
async function flushFrag() {
  if (!pendingFrag || !body.value) return
  const id = pendingFrag
  pendingFrag = null
  const el = body.value.querySelector('[id="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]') ||
    body.value.querySelector('[name="' + id + '"]')
  if (el) await scrollToElement(el)
}

async function scrollToElement(el) {
  await nextTick()
  if (!vp.value || !flow.value) return
  // both rects carry the page-turn transform, so the difference is the
  // element's offset within the un-transformed column flow
  const flowLeft = flow.value.getBoundingClientRect().left
  setPage(pageAt(el.getBoundingClientRect().left, flowLeft, step()))
}

async function scrollToOffset(off) {
  if (!body.value) return
  const len = textLength(body.value)
  const loc = locate(body.value, Math.min(off, Math.max(0, len - 1)), Math.min(off + 1, len))
  if (!loc) return
  const node = loc[0].nodeType === 3 ? loc[0].parentElement : loc[0]
  if (node) await scrollToElement(node)
}

function bmLabel() {
  if (isPdf.value) return `Page ${idx.value + 1}`
  return chapterTitle.value + (pages.value > 1 ? ` · p.${page.value + 1}` : '')
}
function toggleBm() { toggleBookmark(idx.value, page.value, bmLabel()) }
function jumpBookmark(bm) {
  if (bm.chapter === idx.value) setPage(bm.page || 0)
  else { pendingPage = bm.page || 0; goToChapter(bm.chapter) }
}
function createPageNote() {
  const n = addNote({
    chapter: idx.value, start: 0, end: 0, color: 'sun',
    quote: `Page ${idx.value + 1}`,
  })
  if (n) {
    activeNoteId.value = n.id
    editingId.value = n.id
  }
}

function onNoteSelect(id) {
  activeNoteId.value = id
  const mark = body.value && body.value.querySelector('[data-hl="' + id + '"]')
  if (mark) scrollToElement(mark)
}
function stopEdit() { editingId.value = '' }

/* ---------- find in book ---------- */
async function runFind() {
  if (isPdf.value && epub.value && !epub.value.textReady) {
    findBusy.value = true
    try {
      const mod = await loadPdfMod()
      await mod.ensurePdfText(epub.value)
    } catch (e) { /* leave results empty */ }
    findBusy.value = false
  }
  const q = findQ.value.trim().toLowerCase()
  results.value = []
  if (!q || !epub.value) return
  const out = []
  for (let i = 0; i < epub.value.chapters.length && out.length < 40; i++) {
    const text = epub.value.chapters[i].text
    const lower = text.toLowerCase()
    let from = 0
    for (let k = 0; k < 3 && out.length < 40; k++) {
      const at = lower.indexOf(q, from)
      if (at < 0) break
      const pre = text.slice(Math.max(0, at - 46), at).replace(/\s+/g, ' ')
      const hit = text.slice(at, at + q.length)
      const post = text.slice(at + q.length, at + q.length + 46).replace(/\s+/g, ' ')
      out.push({ chapter: i, start: at, snippet: (at > 46 ? '…' : '') + pre + hit + post + '…' })
      from = at + q.length
    }
  }
  results.value = out
}

async function jumpToResult(r) {
  showFind.value = false
  if (r.chapter === idx.value) {
    await nextTick()
    layout({ keepPage: false }).then(() => scrollToOffset(r.start))
  } else {
    pendingOffset = r.start
    goToChapter(r.chapter)
  }
}

/* ---------- toc + scrubber ---------- */
async function tocClick(entry) {
  const i = epub.value.chapters.findIndex((c) => c.path === entry.href)
  if (i < 0) return
  if (entry.frag && i === idx.value) {
    pendingFrag = entry.frag
    await flushFrag()
    return
  }
  if (entry.frag) pendingFrag = entry.frag
  goToChapter(i)
}

function scrub(e) {
  const r = e.currentTarget.getBoundingClientRect()
  const frac = Math.min(0.999, Math.max(0, (e.clientX - r.left) / r.width))
  const total = epub.value.chapters.length
  goToChapter(Math.floor(frac * total))
}

function onDocDown(e) {
  // hide a stale popover when clicking elsewhere; native selection handling
  // must not be disturbed, so only the popover state is cleared here.
  if (selection.value && !(e.target.closest && e.target.closest('.pop'))) selection.value = null
}

function onKey(e) {
  const t = e.target
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) {
    if (e.key === 'Escape') { showFind.value = false; showHelp.value = false; t.blur() }
    return
  }
  const k = e.key
  if (k === 'ArrowRight' || k === 'PageDown' || k === ' ') { e.preventDefault(); nextPage() }
  else if (k === 'ArrowLeft' || k === 'PageUp') { e.preventDefault(); prevPage() }
  else if (k === 'Home') { e.preventDefault(); setPage(0) }
  else if (k === 'End') { e.preventDefault(); setPage(pages.value - 1) }
  else if (k === '+' || k === '=') { e.preventDefault(); setFontScale(0.1) }
  else if (k === '-' || k === '_') { e.preventDefault(); setFontScale(-0.1) }
  else if (k === 'f' || k === 'F') { toggleFocusMode() }
  else if (k === 't' || k === 'T') {
    if (state.focus) { toggleFocus(); showToc.value = true }
    else showToc.value = !showToc.value
  }
  else if (k === 'b' || k === 'B') { toggleBm() }
  else if (k === '?' || (k === '/' && e.shiftKey)) { showHelp.value = !showHelp.value }
  else if (k === 'Escape') {
    if (showHelp.value) { showHelp.value = false; return }
    if (state.focus) { toggleFocusMode(); return }
    clearSelection()
    if (showFind.value) showFind.value = false
  }
}

/* Toggle distraction-free reading; the page keeps its place. */
async function toggleFocusMode() {
  const wasNativeSelection = selection.value
  toggleFocus()
  if (state.focus) flash('Focus mode — Esc to leave')
  if (wasNativeSelection) clearSelection()
  await nextTick()
  await layout({ keepPage: true })
}

/* ---------- lifecycle ---------- */
watch(() => state.current && state.current.chapter, async () => {
  activeNoteId.value = ''
  editingId.value = ''
  clearSelection()
  await nextTick()
  await layout({ keepPage: false })
  if (pendingPage !== null) {
    const p = pendingPage // -1 means "the last page" (paging backwards into a chapter)
    pendingPage = null
    page.value = 0
    setPage(p < 0 ? pages.value - 1 : p)
  }
  await flushFrag()
  if (isPdf.value) renderCurrentPdf()
})
watch(() => state.fontScale, () => layout({ keepPage: true }))
watch([showFind], () => { if (!showFind.value) findQ.value = '' })
// focus mode (re)mounts the chrome around the page, so the column is re-measured
watch(() => state.focus, async () => { await nextTick(); await layout({ keepPage: true }) })
watch(() => state.current && state.current.book && state.current.book.id, () => { pageFlags.value = [] })

onMounted(async () => {
  window.addEventListener('keydown', onKey)
  window.addEventListener('mousedown', onDocDown)
  if (window.ResizeObserver) {
    ro = new ResizeObserver(() => {
      layout({ keepPage: true })
      if (isPdf.value) schedulePdfRender()
    })
    ro.observe(room.value)
  } else {
    window.addEventListener('resize', onResize)
  }
  await layout({ keepPage: false })
  await flushFrag()
  if (isPdf.value) renderCurrentPdf()
})
function onResize() { layout({ keepPage: true }); if (isPdf.value) schedulePdfRender() }
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('mousedown', onDocDown)
  window.removeEventListener('resize', onResize)
  if (ro) ro.disconnect()
  clearTimeout(pdfResizeTimer)
  if (pdfBook && pdfMod) pdfMod.destroyPdf(pdfBook)
  pdfBook = null
  saveProgress()
})

const COLORS = { sun: 'var(--sun)', mint: 'var(--mint)', sky: 'var(--sky)', rose: 'var(--rose)' }
</script>

<template>
  <div class="reader" v-if="chapter" :class="{ focus: state.focus }">
    <!-- focus mode: a hairline that shows how far through the book you are -->
    <div v-if="state.focus" class="focusline" aria-hidden="true"><i :style="{ width: percent + '%' }"></i></div>

    <!-- contents / find -->
    <nav class="toccol" v-if="showToc && !state.focus" aria-label="Contents">
      <template v-if="!showFind">
      <div class="toc">
        <div class="th">Contents</div>
        <a v-for="(e, i) in epub.toc" :key="i" href="#"
          :class="{ on: e.href === chapter.path && !e.frag }"
          :style="{ paddingLeft: 18 + (e.depth || 0) * 14 + 'px' }"
          @click.prevent="tocClick(e)">
          <span class="lbl">{{ e.label }}</span>
        </a>
      </div>
      <div v-if="bookmarks.length" class="bmsec">
        <div class="th">Bookmarks</div>
        <div v-for="bm in bookmarks" :key="bm.id" class="bmrow">
          <button class="bmlink" :title="bm.label" @click="jumpBookmark(bm)">{{ bm.label }}</button>
          <button class="iconbtn bmrm" title="Remove bookmark" aria-label="Remove bookmark"
            @click="removeBookmark(book.id, bm.id)">
            <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>
          </button>
        </div>
      </div>
      </template>
      <div v-if="showFind" class="find">
        <div class="th">Find in book</div>
        <label class="search fsearch">
          <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <input v-model="findQ" placeholder="Search…" aria-label="Search in book" @input="runFind" />
        </label>
        <div class="fresults">
          <p v-if="findBusy" class="fhint">Reading the PDF…</p>
          <button v-for="(r, i) in results" :key="i" class="fresult" @click="jumpToResult(r)">
            <span class="fchap">Ch. {{ r.chapter + 1 }}</span>
            <span class="fsnip">{{ r.snippet }}</span>
          </button>
          <p v-if="findQ && !results.length" class="fhint">No matches in this book.</p>
          <p v-if="!findQ" class="fhint">Type to search every chapter.</p>
        </div>
      </div>
    </nav>

    <!-- page -->
    <div class="pagewrap">
      <div class="readbar" v-if="!state.focus">
        <button class="iconbtn" :class="{ on: showToc }" title="Toggle contents (t)" aria-label="Toggle contents" @click="showToc = !showToc">
          <svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h10" /></svg>
        </button>
        <button class="iconbtn" :class="{ on: showFind }" title="Find in book" aria-label="Find in book" @click="showFind = !showFind">
          <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        </button>
        <span class="where"><b>{{ chapterTitle }}</b> · chapter {{ idx + 1 }} of {{ epub.chapters.length }}</span>
        <span class="right">
          <button v-if="isPdf" class="iconbtn" title="Add a note for this page" aria-label="Add a note for this page" @click="createPageNote">
            <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
          </button>
          <button class="iconbtn" :class="{ on: bookmarked }"
            :title="bookmarked ? 'Remove bookmark (b)' : 'Bookmark this page (b)'"
            :aria-label="bookmarked ? 'Remove bookmark' : 'Bookmark this page'" @click="toggleBm">
            <svg viewBox="0 0 24 24"><path d="M7 4h10v16l-5-4-5 4z" :fill="bookmarked ? 'currentColor' : 'none'"/></svg>
          </button>
          <button class="iconbtn" title="Smaller text (−)" aria-label="Smaller text" @click="setFontScale(-0.1)">
            <svg viewBox="0 0 24 24"><path d="M5 12h14" /></svg>
          </button>
          <button class="iconbtn" title="Larger text (+)" aria-label="Larger text" @click="setFontScale(0.1)">
            <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
          </button>
          <button class="iconbtn" title="Focus mode (f)" aria-label="Focus mode" @click="toggleFocusMode">
            <svg viewBox="0 0 24 24"><path d="M9 4H4v5M15 4h5v5M15 20h5v-5M9 20H4v-5" /></svg>
          </button>
          <button class="iconbtn" title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts" @click="showHelp = !showHelp">
            <svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h.01M11 10h.01M15 10h.01M8 14h8"/></svg>
          </button>
          <span class="notecount" title="Notes in this chapter">{{ bookNotesCount }} notes</span>
        </span>
      </div>

      <div class="viewport" ref="room" :class="{ framed }" @mouseup="onSelect" @click="onBodyClick">
        <!-- page-edge flags for the highlights on this page (pagebox gutter) -->
        <div v-if="framed && pageFlags.length" class="flags">
          <button v-for="f in pageFlags" :key="f.id" type="button" class="flag"
            :class="{ active: f.id === activeNoteId }"
            :style="{ background: COLORS[f.color] || COLORS.sun, top: f.top + '%' }"
            :title="f.quote"
            :aria-label="'Highlight: ' + f.quote"
            @click="onNoteSelect(f.id)"></button>
        </div>

        <!-- exactly one page wide: the rest of the chapter is clipped away -->
        <div v-if="!isPdf" class="pagebox" ref="vp">
          <article class="flow" ref="flow" :style="{ fontSize: 16.5 * state.fontScale + 'px' }">
            <div class="chnum">Chapter {{ idx + 1 }}</div>
            <h3>{{ chapterTitle }}</h3>
            <div class="body" ref="body" v-html="chapter.html"></div>
          </article>
        </div>
        <canvas v-else ref="pdfCanvas" class="pdfcanvas" aria-label="PDF page"></canvas>

        <div v-if="selection" class="pop" :style="popStyle" role="toolbar" aria-label="Highlight actions" @mousedown.prevent>
          <button class="dot" style="background: var(--sun)" title="Highlight in yellow" @click="createHighlight('sun')"></button>
          <button class="dot" style="background: var(--mint)" title="Highlight in green" @click="createHighlight('mint')"></button>
          <button class="dot" style="background: var(--sky)" title="Highlight in blue" @click="createHighlight('sky')"></button>
          <button class="dot" style="background: var(--rose)" title="Highlight in pink" @click="createHighlight('rose')"></button>
          <span class="sep"></span>
          <button class="lbl" @click="createHighlight('sun', true)">Note…</button>
          <span class="sep"></span>
          <button class="lbl" @click="copyQuote">Copy</button>
        </div>

        <button class="edge l" title="Previous page" aria-label="Previous page" @click="prevPage">
          <svg viewBox="0 0 24 24"><path d="m15 5-7 7 7 7" /></svg>
        </button>
        <button class="edge r" title="Next page" aria-label="Next page" @click="nextPage">
          <svg viewBox="0 0 24 24"><path d="m9 5 7 7-7 7" /></svg>
        </button>

        <!-- the only chrome left in focus mode: a way back, on hover -->
        <button v-if="state.focus" class="fexit" title="Exit focus mode (Esc)" aria-label="Exit focus mode" @click="toggleFocusMode">
          <svg viewBox="0 0 24 24"><path d="M9 4H4v5M15 4h5v5M15 20h5v-5M9 20H4v-5" /></svg>
          <span>Esc</span>
        </button>
      </div>

      <div class="scrub" v-if="!state.focus">
        <span class="pct">{{ percent }}%</span>
        <div class="bar" role="slider" aria-label="Reading position" :aria-valuenow="percent" aria-valuemin="0" aria-valuemax="100" @click="scrub">
          <i :style="{ width: percent + '%' }"></i>
        </div>
        <span class="pct">Page {{ page + 1 }} of {{ pages }} in this chapter</span>
        <span class="push pct">{{ chapterNotes.length }} {{ chapterNotes.length === 1 ? 'highlight' : 'highlights' }} here</span>
      </div>
    </div>

    <MarginaliaPanel
      v-if="!state.focus"
      :notes="chapterNotes"
      :active-id="activeNoteId"
      :editing-id="editingId"
      :total="bookNotesCount"
      @select="onNoteSelect"
      @stop-edit="stopEdit"
    />

    <!-- keyboard reference -->
    <div v-if="showHelp" class="helpsheet" @click.self="showHelp = false">
      <div class="helpcard" role="dialog" aria-label="Keyboard shortcuts">
        <div class="hh">
          <span>Keyboard</span>
          <button class="iconbtn" title="Close" aria-label="Close" @click="showHelp = false">
            <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </div>
        <dl>
          <div><dt><kbd>←</kbd> <kbd>→</kbd></dt><dd>Previous / next page</dd></div>
          <div><dt><kbd>Space</kbd></dt><dd>Next page</dd></div>
          <div><dt><kbd>Home</kbd> <kbd>End</kbd></dt><dd>First / last page of the chapter</dd></div>
          <div><dt><kbd>f</kbd></dt><dd>Focus mode — just this page</dd></div>
          <div><dt><kbd>t</kbd></dt><dd>Contents</dd></div>
          <div><dt><kbd>b</kbd></dt><dd>Bookmark this page</dd></div>
          <div><dt><kbd>+</kbd> <kbd>−</kbd></dt><dd>Text size</dd></div>
          <div><dt><kbd>Esc</kbd></dt><dd>Leave focus mode / close panels</dd></div>
          <div><dt><kbd>?</kbd></dt><dd>This list</dd></div>
        </dl>
        <p class="fnote">Select text to highlight it or leave a note.</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ---------- reader shell: contents | page | marginalia ---------- */
.reader {
  flex: 1; min-width: 0; min-height: 0;
  display: flex; align-items: stretch;
  position: relative; overflow: hidden;
}

/* focus mode: a hairline progress mark, everything else invisible */
.focusline {
  position: absolute; top: 0; left: 0; right: 0; height: 2px;
  z-index: 20; pointer-events: none;
}
.focusline i {
  display: block; height: 100%;
  background: color-mix(in srgb, var(--ink) 40%, transparent);
  transition: width .25s ease;
}

/* ---------- contents / find column ---------- */
.toccol {
  width: 224px; flex: none;
  border-right: 1px solid var(--line);
  background: var(--chrome);
  overflow-y: auto; min-height: 0;
}
.th {
  font-size: 12px; font-weight: 600; color: var(--ink-faint);
  padding: 16px 18px 10px;
}
.toc a {
  display: block; padding: 7px 18px;
  font-size: 13px; line-height: 1.35;
  color: var(--ink-soft); text-decoration: none;
}
.toc a:hover { color: var(--ink); }
.toc a.on {
  background: var(--panel); color: var(--ink); font-weight: 500;
  box-shadow: inset 2px 0 0 var(--ink);
}
.toc .lbl { display: block; }

.find { display: flex; flex-direction: column; min-height: 0; height: 100%; }
.fsearch { margin: 0 14px 12px; max-width: none; }
.fresults { overflow-y: auto; display: flex; flex-direction: column; }
.fresult {
  text-align: left; border: 0; background: transparent; cursor: pointer;
  padding: 9px 18px; border-top: 1px solid var(--line);
  display: flex; flex-direction: column; gap: 3px;
}
.fresult:hover { background: var(--panel); }
.fchap { font-size: 11px; color: var(--ink-faint); }
.fsnip {
  font-family: var(--serif); font-size: 12.5px; line-height: 1.45; color: var(--ink);
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.fhint { font-size: 12.5px; color: var(--ink-faint); padding: 8px 18px; line-height: 1.5; }

/* ---------- page column ---------- */
.pagewrap { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.readbar {
  height: 46px; flex: none;
  border-bottom: 1px solid var(--line);
  display: flex; align-items: center; gap: 6px;
  padding: 0 16px; color: var(--ink-soft);
}
.readbar .iconbtn.on { background: rgba(127, 127, 127, .18); color: var(--ink); }
.readbar .where { margin: 0 8px; font-size: 12.5px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.readbar .where b { font-weight: 500; color: var(--ink); }
.readbar .right { margin-left: auto; display: flex; align-items: center; gap: 2px; }
.notecount {
  font-size: 11.5px; color: var(--ink-faint);
  border: 1px solid var(--line); border-radius: 20px;
  padding: 3px 9px; margin-left: 6px; white-space: nowrap;
}

/* ---------- reading room + the page itself ---------- */
.viewport {
  position: relative; flex: 1; min-height: 0;
  overflow: hidden;              /* nothing outside the page can be seen */
  display: flex; justify-content: center;
  padding: 10px 0;
}
/* The page: a box exactly one page wide that clips the column flow. The flow is
   many columns long and is moved with a transform, so the next page can never
   be seen past this edge — no scrollbar, no sliver, no half page. */
.pagebox {
  position: relative; flex: none;
  height: 100%; overflow: hidden;
  background: var(--paper);
}
.viewport.framed .pagebox {
  border-radius: 3px;
  box-shadow:
    0 0 0 1px var(--line),
    0 1px 2px color-mix(in srgb, var(--ink) 6%, transparent),
    0 14px 34px color-mix(in srgb, var(--ink) 9%, transparent);
}

.flow {
  margin: 0 auto;
  height: 100%;
  column-fill: auto;
  font-family: var(--serif);
  line-height: 1.72;
  color: var(--ink);
  position: relative;
  padding: 30px 0 10px;
  will-change: transform;
  backface-visibility: hidden;
}
.chnum { font-family: var(--sans); font-size: 12px; color: var(--ink-faint); margin-bottom: 4px; }
.flow h3 {
  font-family: var(--serif); font-size: 1.28em; font-weight: 600;
  margin-bottom: 1em; letter-spacing: .005em;
}

/* book content (v-html) */
.body { position: relative; }
.body :deep(p) { margin-bottom: 1.15em; orphans: 2; widows: 2; }
/* highlights that come with the book itself, in the app's own highlighter */
.body :deep(mark:not(.hl)) {
  background: color-mix(in srgb, var(--sun) 65%, transparent);
  color: inherit; padding: 0 .08em; border-radius: 2px;
}
.body :deep(p:first-child)::first-letter { font-size: 2.4em; line-height: .9; float: left; padding: .06em .09em 0 0; font-weight: 500; }
.body :deep(h1), .body :deep(h2), .body :deep(h4) {
  font-family: var(--serif); font-weight: 600; line-height: 1.3;
  margin: 1.4em 0 .7em; break-after: avoid;
}
.body :deep(h1) { font-size: 1.35em; }
.body :deep(h2) { font-size: 1.2em; }
.body :deep(h4) { font-size: 1.02em; }
.body :deep(blockquote) {
  margin: 1.3em 0; padding-left: 16px;
  border-left: 3px solid var(--line);
  color: var(--ink-soft); font-style: italic;
}
.body :deep(img), .body :deep(svg) { max-width: 100%; height: auto; display: block; margin: 1.2em auto; }
.body :deep(figure) { margin: 1.3em 0; text-align: center; }
.body :deep(figcaption) { font-family: var(--sans); font-size: .78em; color: var(--ink-faint); margin-top: .5em; }
.body :deep(pre) {
  font-family: ui-monospace, monospace; font-size: .82em; line-height: 1.5;
  white-space: pre-wrap; word-break: break-word;
  background: var(--chrome); border: 1px solid var(--line);
  border-radius: 6px; padding: 10px 12px; margin: 1.2em 0;
}
.body :deep(code) { font-family: ui-monospace, monospace; font-size: .88em; }
.body :deep(a), .body :deep([data-ext]), .body :deep([data-chap]), .body :deep([data-frag]) {
  color: inherit; text-decoration: underline;
  text-decoration-color: var(--ink-faint); text-underline-offset: 2px;
  cursor: pointer;
}
.body :deep(a:hover), .body :deep([data-ext]:hover), .body :deep([data-chap]:hover) {
  text-decoration-color: var(--ink);
}
.body :deep(hr) { border: 0; border-top: 1px solid var(--line); margin: 1.6em 0; }
.body :deep(table) { width: 100%; border-collapse: collapse; font-family: var(--sans); font-size: .85em; margin: 1.2em 0; }
.body :deep(th), .body :deep(td) { border: 1px solid var(--line); padding: 6px 8px; text-align: left; }
.body :deep(sup a), .body :deep(a[href]) { }
.body :deep(.pagebreak) { display: none; }

/* highlights */
.body :deep(mark.hl) {
  background: linear-gradient(transparent 58%, var(--mk, var(--sun)) 58%);
  color: inherit; padding: 0 1px; cursor: pointer;
  -webkit-box-decoration-break: clone; box-decoration-break: clone;
}
.body :deep(mark.hl.active) { outline: 1px solid var(--ink); outline-offset: 1px; }
.viewport ::selection { background: color-mix(in srgb, var(--sun) 45%, transparent); }

/* page-edge flags: the highlights on the page you are reading, in the gutter */
.flags {
  position: absolute; z-index: 6;
  top: 10px; bottom: 10px;
  right: max(2px, calc((100% - var(--pagew, 620px)) / 2 - 20px));
  width: 16px; pointer-events: none;
}
.flag {
  position: absolute; right: 0;
  display: block; width: 16px; height: 5px; border-radius: 0 3px 3px 0;
  pointer-events: auto; cursor: pointer; opacity: .85;
  border: 0; padding: 0;
}
.flag:hover, .flag.active { width: 22px; opacity: 1; }

/* focus mode chrome: a quiet way out, revealed on hover */
.fexit {
  position: absolute; right: 14px; bottom: 10px; z-index: 22;
  display: inline-flex; align-items: center; gap: 6px;
  height: 26px; padding: 0 10px; border-radius: 14px; cursor: pointer;
  border: 1px solid var(--line); background: var(--panel); color: var(--ink-soft);
  font-size: 11.5px; opacity: 0;
  transition: opacity .15s ease;
}
.viewport:hover .fexit, .fexit:focus-visible { opacity: 1; }
.fexit svg { width: 12px; height: 12px; stroke: currentColor; fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }

/* keyboard reference */
.helpsheet {
  position: fixed; inset: 0; z-index: 90;
  display: grid; place-items: center; padding: 24px;
  background: color-mix(in srgb, var(--ink) 22%, transparent);
  animation: fade .12s ease-out;
}
.helpcard {
  width: 366px; max-width: 100%;
  background: var(--panel); border: 1px solid var(--line);
  border-radius: 12px; box-shadow: var(--shadow-menu);
  padding: 14px 16px 14px;
}
.hh {
  display: flex; align-items: center; justify-content: space-between;
  font-size: 11px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase;
  color: var(--ink-faint); margin-bottom: 8px;
}
.helpcard dl { display: flex; flex-direction: column; gap: 7px; }
.helpcard dl > div { display: flex; align-items: baseline; gap: 10px; }
.helpcard dt { flex: none; width: 112px; display: flex; align-items: center; gap: 4px; }
.helpcard dd { font-size: 12.5px; color: var(--ink-soft); }
.helpcard kbd {
  font-family: var(--sans); font-size: 11px; line-height: 1;
  padding: 3px 5px; border: 1px solid var(--line); border-bottom-width: 2px;
  border-radius: 4px; background: var(--chrome); color: var(--ink);
}
.fnote {
  margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--line);
  font-size: 12px; color: var(--ink-faint);
}
@keyframes fade { from { opacity: 0; } to { opacity: 1; } }

/* selection popover */
.pop {
  position: fixed; z-index: 40;
  display: flex; align-items: center; gap: 3px;
  background: var(--ink); color: var(--paper);
  border-radius: 8px; padding: 5px 7px;
  box-shadow: var(--shadow-menu);
  font-size: 12px;
}
.pop .dot { width: 17px; height: 17px; border: 0; border-radius: 50%; cursor: pointer; padding: 0; }
.pop .dot:hover { transform: scale(1.15); }
.pop .sep { width: 1px; height: 16px; background: color-mix(in srgb, var(--paper) 30%, transparent); margin: 0 4px; }
.pop .lbl {
  border: 0; background: transparent; color: inherit;
  font: inherit; font-size: 12px; padding: 0 6px; cursor: pointer; opacity: .85;
}
.pop .lbl:hover { opacity: 1; }

/* edge page-turn buttons */
.edge {
  position: absolute; top: 50%; transform: translateY(-50%);
  width: 40px; height: 64px; border: 0; border-radius: 8px;
  background: transparent; color: var(--ink-faint);
  cursor: pointer; opacity: 0; transition: opacity .15s ease;
  display: grid; place-items: center;
}
.viewport:hover .edge { opacity: .7; }
.edge:hover { opacity: 1 !important; background: color-mix(in srgb, var(--ink) 7%, transparent); color: var(--ink); }
.edge svg { width: 22px; height: 22px; stroke: currentColor; fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.edge.l { left: 4px; }
.edge.r { right: 4px; }
.edge:disabled { visibility: hidden; }

/* scrubber */
.scrub {
  height: 40px; flex: none;
  border-top: 1px solid var(--line);
  display: flex; align-items: center; gap: 14px;
  padding: 0 18px;
  font-size: 12px; color: var(--ink-soft);
}
.scrub .bar { flex: 1; max-width: 420px; height: 4px; background: var(--line); border-radius: 2px; cursor: pointer; overflow: hidden; }
.scrub .bar i { display: block; height: 100%; background: var(--ink); }
.scrub .pct { font-variant-numeric: tabular-nums; white-space: nowrap; }
.scrub .push { margin-left: auto; }

@media (max-width: 980px) {
  .toccol { display: none; }
  .notecount { display: none; }
}
</style>

<style scoped>
.bmsec { border-top: 1px solid var(--line); margin-top: 8px; padding-top: 4px; }
.bmrow { display: flex; align-items: center; gap: 2px; padding: 2px 10px 2px 18px; }
.bmlink {
  flex: 1; min-width: 0; text-align: left;
  border: 0; background: transparent; cursor: pointer;
  font: inherit; font-size: 12.5px; color: var(--ink-soft);
  padding: 5px 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.bmlink:hover { color: var(--ink); }
.bmrm { width: 24px; height: 24px; opacity: 0; flex: none; }
.bmrow:hover .bmrm, .bmrm:focus-visible { opacity: 1; }
.bmrm svg { width: 12px; height: 12px; }

.pdfcanvas {
  position: absolute; inset: 0; margin: auto;
  box-shadow: var(--shadow-menu); border-radius: 2px;
  max-width: calc(100% - 24px); max-height: calc(100% - 24px);
}
</style>
