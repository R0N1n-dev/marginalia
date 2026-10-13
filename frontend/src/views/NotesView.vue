<script setup>
import { computed, ref } from 'vue'
import { state, deleteNote, flash, openBook } from '../lib/store.js'
import { exportText } from '../lib/backend.js'

const query = ref('')
const bookFilter = ref('all')

const booksWithNotes = computed(() =>
  state.books.filter((b) => state.notes.some((n) => n.bookId === b.id)))

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  return state.notes
    .filter((n) => bookFilter.value === 'all' || n.bookId === bookFilter.value)
    .filter((n) => !q || `${n.quote} ${n.note} ${n.tags.join(' ')}`.toLowerCase().includes(q))
    .sort((a, b) => b.createdAt - a.createdAt)
})

const bookOf = (n) => state.books.find((b) => b.id === n.bookId)
function coverBg(book) {
  if (!book) return 'var(--line)'
  if (book.cover) return `center / cover url(${book.cover})`
  const colors = ['#7A3B2E', '#38513F', '#4A3B63', '#1F2A33', '#8A6D2F', '#5C2E3E', '#2E3A4F']
  let h = 0
  for (const ch of book.title) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return colors[h % colors.length]
}
const COLORS = { sun: 'var(--sun)', mint: 'var(--mint)', sky: 'var(--sky)', rose: 'var(--rose)' }
const when = (t) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

async function exportMarkdown() {
  const groups = state.books
    .map((b) => ({ b, notes: state.notes.filter((n) => n.bookId === b.id).sort((x, y) => x.chapter - y.chapter || x.start - y.start) }))
    .filter((g) => g.notes.length)
  if (!groups.length) { flash('Nothing to export yet'); return }
  let md = ''
  for (const { b, notes } of groups) {
    md += `# ${b.title}${b.author ? ` — ${b.author}` : ''}\n\n`
    for (const n of notes) {
      md += `> ${n.quote}\n\n`
      if (n.note) md += `${n.note}\n\n`
      const meta = [`chapter ${n.chapter + 1}`]
      if (n.tags.length) meta.push(n.tags.join(', '))
      meta.push(when(n.createdAt))
      md += `*${meta.join(' · ')}*\n\n`
    }
    md += '---\n\n'
  }
  const ok = await exportText('marginalia-notes.md', md)
  if (ok) flash(`Exported ${state.notes.length} notes`)
}
</script>

<template>
  <div class="appbar">
    <label class="search">
      <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
      <input v-model="query" placeholder="Search in notes" aria-label="Search in notes" />
    </label>
    <button class="btn push" :disabled="!state.notes.length" @click="exportMarkdown">
      <svg viewBox="0 0 24 24"><path d="M12 3v12m0 0 4-4m-4 4-4-4M4 21h16" /></svg>
      Export Markdown
    </button>
  </div>

  <div class="notes-page">
    <template v-if="state.notes.length">
      <div class="filters">
        <h2>Notes</h2>
        <button class="chip" :class="{ on: bookFilter === 'all' }" @click="bookFilter = 'all'">All books</button>
        <button v-for="b in booksWithNotes" :key="b.id" class="chip"
          :class="{ on: bookFilter === b.id }" @click="bookFilter = b.id">{{ b.title }}</button>
        <span class="count push">{{ filtered.length }} {{ filtered.length === 1 ? 'note' : 'notes' }}</span>
      </div>

      <div v-if="filtered.length" class="grid">
        <article v-for="n in filtered" :key="n.id" class="big-note" :style="{ '--mk': COLORS[n.color] || COLORS.sun }">
          <div class="src">
            <span class="sw" :style="{ background: coverBg(bookOf(n)) }"></span>
            <b>{{ bookOf(n)?.title || 'Removed book' }}</b>
            <span v-if="bookOf(n)">· chapter {{ n.chapter + 1 }}</span>
            <button class="iconbtn x" title="Delete note" aria-label="Delete note" @click="deleteNote(n.id)">
              <svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V5h6v2m-8 0 1 13h8l1-13" /></svg>
            </button>
          </div>
          <blockquote class="q">“{{ n.quote }}”</blockquote>
          <p v-if="n.note" class="n">{{ n.note }}</p>
          <div class="foot">
            <span v-for="t in n.tags" :key="t" class="tagp">{{ t }}</span>
            <span v-if="bookOf(n)" class="jump" role="button" tabindex="0"
              @click="openBook(n.bookId)" @keydown.enter="openBook(n.bookId)">Open in book →</span>
            <span class="push">{{ when(n.createdAt) }}</span>
          </div>
        </article>
      </div>
      <div v-else class="noresults">No notes match “{{ query }}”.</div>
    </template>

    <div v-else class="empty">
      <h2>No notes yet</h2>
      <p>Select any text while reading to highlight it, add a note, and find it all here later.</p>
      <button class="btn primary" @click="state.view = 'library'">Go to your library</button>
    </div>
  </div>
</template>

<style scoped>
.notes-page { flex: 1; overflow-y: auto; padding: 24px 28px 40px; }
.push { margin-left: auto; }

.filters { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 18px; }
.filters h2 { font-family: var(--serif); font-size: 18px; font-weight: 600; margin-right: 8px; }
.count { font-size: 12px; color: var(--ink-faint); }

.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 14px; }
.big-note {
  background: var(--panel); border: 1px solid var(--line);
  border-radius: 9px; padding: 14px 16px; min-width: 0;
}
.src { display: flex; align-items: center; gap: 7px; font-size: 12px; color: var(--ink-faint); margin-bottom: 9px; min-width: 0; }
.src b { font-weight: 500; color: var(--ink-soft); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 220px; }
.src .sw { width: 10px; height: 10px; border-radius: 2px; flex: none; }
.src .x { width: 24px; height: 24px; margin-left: auto; flex: none; opacity: 0; }
.big-note:hover .x, .big-note .x:focus-visible { opacity: 1; }
.src .x svg { width: 14px; height: 14px; }
.q {
  font-family: var(--serif); font-size: 14.5px; line-height: 1.6;
  padding-left: 11px; border-left: 3px solid var(--mk);
}
.n { font-size: 13px; color: var(--ink-soft); line-height: 1.5; margin-top: 10px; }
.foot { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 12px; font-size: 11.5px; color: var(--ink-faint); }
.tagp { border: 1px solid var(--line); border-radius: 4px; padding: 1px 7px; background: var(--chrome); }
.jump { color: var(--ink-soft); cursor: pointer; font-weight: 500; }
.jump:hover { color: var(--ink); }

.empty { max-width: 440px; padding: 64px 0; }
.empty h2 { font-family: var(--serif); font-size: 22px; font-weight: 600; margin-bottom: 10px; }
.empty p { color: var(--ink-soft); line-height: 1.6; margin-bottom: 20px; }
.noresults { color: var(--ink-faint); font-size: 13px; padding: 30px 0; }
</style>
