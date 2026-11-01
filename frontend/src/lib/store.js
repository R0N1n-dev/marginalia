// Global app state: library, notes, bookmarks, collections, current book
// session, theme. Persistence is one JSON document (backend decides where).
import { reactive } from 'vue'
import * as backend from './backend.js'
import { parseBook, ACCEPT_ATTR } from './formats.js'
import { buildSampleEpub } from './sample.js'

const STORE_VERSION = 2
const sessionBytes = new Map() // bookId -> bytes; browser mode keeps books in memory for the session

export const uid = () =>
  (crypto.randomUUID && crypto.randomUUID()) || `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`

const systemTheme = () =>
  (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light'

export const state = reactive({
  view: 'library', // 'library' | 'reader' | 'notes'
  libQuery: '',
  theme: 'light',
  fontScale: 1,
  focus: false, // distraction-free reading: only the page, no chrome
  books: [],
  notes: [],
  collections: [],
  collectionFilter: 'all', // 'all' | collection id
  current: null, // { book, epub, chapter }
  flash: '',
  error: '',
  busy: false,
})

let flashTimer = null
export function flash(msg) {
  state.flash = msg
  clearTimeout(flashTimer)
  flashTimer = setTimeout(() => { state.flash = '' }, 3200)
}
export function fail(msg) {
  state.error = msg
  setTimeout(() => { if (state.error === msg) state.error = '' }, 6000)
}

let persistTimer = null
function persist() {
  clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    const data = JSON.stringify({
      v: STORE_VERSION,
      theme: state.theme,
      fontScale: state.fontScale,
      focus: state.focus,
      books: state.books,
      notes: state.notes,
      collections: state.collections,
    })
    backend.saveStore(data).catch(() => fail("Couldn't save your library"))
  }, 250)
}
export { persist }

export async function init() {
  state.theme = systemTheme()
  try {
    const raw = await backend.loadStore()
    if (raw) {
      const data = JSON.parse(raw)
      state.books = (data.books || []).map((b) => ({ ...b, bookmarks: b.bookmarks || [], collectionIds: b.collectionIds || [] }))
      state.notes = data.notes || []
      state.collections = data.collections || []
      state.fontScale = data.fontScale || 1
      state.focus = !!data.focus
      if (data.theme) state.theme = data.theme
    }
  } catch (e) {
    fail('Could not read saved data — starting fresh')
  }
  applyTheme()
}

export function applyTheme() {
  document.documentElement.dataset.theme = state.theme
}
export function toggleTheme() {
  state.theme = state.theme === 'dark' ? 'light' : 'dark'
  applyTheme()
  persist()
}
export function setFontScale(delta) {
  state.fontScale = Math.min(1.6, Math.max(0.8, Math.round((state.fontScale + delta) * 10) / 10))
  persist()
}
export function setFocus(on) {
  state.focus = !!on
  persist()
}
export function toggleFocus() { setFocus(!state.focus) }

const touch = (book) => { book.lastOpened = Date.now() }

async function startReading(book, bytes) {
  try {
    const epub = await parseBook(bytes, book.name)
    book.title = epub.title || book.title
    book.author = epub.author || book.author
    if (epub.cover) book.cover = epub.cover
    book.format = epub.format
    book.totalChapters = epub.chapters.length
    state.current = { book, epub, chapter: Math.min(book.chapter || 0, epub.chapters.length - 1) }
    state.view = 'reader'
    touch(book)
    persist()
  } catch (e) {
    fail(`Couldn't read “${book.name}”: ${e.message}`)
  }
}

async function ingest({ bytes, path = null, name }) {
  const existing = state.books.find((b) => (b.path && path && b.path === path) || (!path && b.name === name))
  if (existing) {
    sessionBytes.set(existing.id, bytes)
    await startReading(existing, bytes)
    flash('Already in your library — opened it')
    return
  }
  const epub = await parseBook(bytes, name)
  const book = {
    id: uid(),
    name,
    path,
    title: epub.title,
    author: epub.author,
    cover: epub.cover,
    format: epub.format,
    totalChapters: epub.chapters.length,
    sample: false,
    bookmarks: [],
    collectionIds: [],
    addedAt: Date.now(),
    lastOpened: Date.now(),
    chapter: 0,
  }
  sessionBytes.set(book.id, bytes)
  state.books.unshift(book)
  await startReading(book, bytes)
  flash(`Imported “${book.title}”`)
}

export async function importBook() {
  try {
    state.busy = true
    const picked = await backend.pickEpubBytes()
    if (!picked) return
    await ingest(picked)
  } catch (e) {
    fail(e.message || 'That file could not be imported')
  } finally {
    state.busy = false
  }
}

// Drag-and-drop / file-input: same path as the dialog, just a different way in.
export async function importFile(file) {
  if (!file) return
  const known = ACCEPT_ATTR.split(',').some((ext) => ext.startsWith('.') && file.name.toLowerCase().endsWith(ext))
  try {
    state.busy = true
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (!known) {
      const { detectFormat } = await import('./formats.js')
      if (detectFormat(bytes, file.name) === 'txt') {
        fail('Unsupported file type')
        return
      }
    }
    await ingest({ bytes, path: null, name: file.name })
  } catch (e) {
    fail(e.message || 'That file could not be imported')
  } finally {
    state.busy = false
  }
}

export async function loadSample() {
  const existing = state.books.find((b) => b.sample)
  const bytes = buildSampleEpub()
  if (existing) {
    sessionBytes.set(existing.id, bytes)
    await startReading(existing, bytes)
    return
  }
  const epub = await parseBook(bytes, 'the-salt-path-sample.epub')
  const book = {
    id: uid(), name: 'the-salt-path-sample.epub', path: null, title: epub.title,
    author: epub.author, cover: epub.cover, format: 'epub', totalChapters: epub.chapters.length,
    sample: true, bookmarks: [], collectionIds: [],
    addedAt: Date.now(), lastOpened: Date.now(), chapter: 0,
  }
  sessionBytes.set(book.id, bytes)
  state.books.unshift(book)
  await startReading(book, bytes)
}

export async function openBook(id) {
  const book = state.books.find((b) => b.id === id)
  if (!book) return
  let bytes = sessionBytes.get(id)
  if (!bytes && book.sample) bytes = buildSampleEpub()
  if (!bytes) bytes = await backend.readEpubBytes(book.path)
  if (!bytes) {
    // file moved (desktop) or session restarted (browser): ask for it again
    flash(`Choose “${book.name}” again to reopen it`)
    const picked = await backend.pickEpubBytes()
    if (!picked) return
    book.path = picked.path || book.path
    bytes = picked.bytes
  }
  sessionBytes.set(id, bytes)
  await startReading(book, bytes)
}

export function closeReader() {
  saveProgress()
  state.current = null
  state.view = 'library'
}

let progressTimer = null
export function saveProgress() {
  const cur = state.current // capture: the reader may close before the debounce fires
  if (!cur) return
  clearTimeout(progressTimer)
  progressTimer = setTimeout(() => {
    cur.book.chapter = cur.chapter
    persist()
  }, 300)
}

export function goToChapter(i) {
  if (!state.current) return
  const max = state.current.epub.chapters.length - 1
  state.current.chapter = Math.max(0, Math.min(max, i))
  saveProgress()
}

/* ---------- bookmarks ---------- */
export function isBookmarked(chapter, page) {
  const b = state.current && state.current.book
  return !!(b && (b.bookmarks || []).some((m) => m.chapter === chapter && m.page === page))
}
export function toggleBookmark(chapter, page, label) {
  const b = state.current && state.current.book
  if (!b) return
  b.bookmarks = b.bookmarks || []
  const at = b.bookmarks.findIndex((m) => m.chapter === chapter && m.page === page)
  if (at >= 0) {
    b.bookmarks.splice(at, 1)
    flash('Bookmark removed')
  } else {
    b.bookmarks.push({ id: uid(), chapter, page, label, createdAt: Date.now() })
    flash('Bookmarked')
  }
  persist()
}
export function removeBookmark(bookId, bookmarkId) {
  const b = state.books.find((x) => x.id === bookId)
  if (!b || !b.bookmarks) return
  b.bookmarks = b.bookmarks.filter((m) => m.id !== bookmarkId)
  persist()
}
export function goToBookmark(bm) {
  if (!state.current) return
  goToChapter(bm.chapter)
  return bm.page || 0 // reader restores the page after the chapter watcher runs
}

/* ---------- collections ---------- */
export function addCollection(name) {
  const clean = (name || '').trim()
  if (!clean) return null
  const existing = state.collections.find((c) => c.name.toLowerCase() === clean.toLowerCase())
  if (existing) return existing
  const col = { id: uid(), name: clean, createdAt: Date.now() }
  state.collections.push(col)
  persist()
  return col
}
export function removeCollection(id) {
  state.collections = state.collections.filter((c) => c.id !== id)
  for (const b of state.books) b.collectionIds = (b.collectionIds || []).filter((c) => c !== id)
  if (state.collectionFilter === id) state.collectionFilter = 'all'
  persist()
}
export function toggleInCollection(book, colId) {
  book.collectionIds = book.collectionIds || []
  const at = book.collectionIds.indexOf(colId)
  if (at >= 0) book.collectionIds.splice(at, 1)
  else book.collectionIds.push(colId)
  persist()
}

/* ---------- notes ---------- */
export function addNote({ chapter, start, end, color, quote, note = '', tags = [] }) {
  if (!state.current) return null
  const n = {
    id: uid(), bookId: state.current.book.id, chapter,
    start, end, color, quote, note, tags, createdAt: Date.now(),
  }
  state.notes.push(n)
  persist()
  return n
}
export function updateNote(id, patch) {
  const n = state.notes.find((x) => x.id === id)
  if (!n) return
  Object.assign(n, patch)
  persist()
}
export function deleteNote(id) {
  const i = state.notes.findIndex((x) => x.id === id)
  if (i >= 0) {
    state.notes.splice(i, 1)
    persist()
  }
}
export const notesOfCurrentChapter = () =>
  state.current ? state.notes.filter((n) => n.bookId === state.current.book.id && n.chapter === state.current.chapter) : []
export const notesOfBook = (bookId) => state.notes.filter((n) => n.bookId === bookId)

export function removeBook(id) {
  state.books = state.books.filter((b) => b.id !== id)
  state.notes = state.notes.filter((n) => n.bookId !== id)
  sessionBytes.delete(id)
  persist()
}
