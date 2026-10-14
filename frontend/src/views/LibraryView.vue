<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import {
  state, importBook, loadSample, openBook, removeBook, flash,
  addCollection, removeCollection, toggleInCollection,
} from '../lib/store.js'

/* shelf: query + collection filter, most recent first */
const shelf = computed(() => {
  const q = (state.libQuery || '').trim().toLowerCase()
  return [...state.books]
    .filter((b) => state.collectionFilter === 'all' || (b.collectionIds || []).includes(state.collectionFilter))
    .filter((b) => !q || `${b.title} ${b.author} ${b.name}`.toLowerCase().includes(q))
    .sort((a, b) => (b.lastOpened || 0) - (a.lastOpened || 0))
})
const current = computed(() =>
  [...state.books].sort((a, b) => (b.lastOpened || 0) - (a.lastOpened || 0))[0] || null)
const percent = (b) => {
  const total = b.totalChapters || 1
  return Math.min(100, Math.round(((b.chapter || 0) / total) * 100))
}

function coverColor(seed = '') {
  const colors = ['#7A3B2E', '#38513F', '#4A3B63', '#1F2A33', '#8A6D2F', '#5C2E3E', '#2E3A4F']
  let h = 0
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return colors[h % colors.length]
}

/* remove book: two-click confirm */
const armed = ref('')
function open(b) { armed.value = ''; openBook(b.id) }
function onRemove(b, e) {
  e.stopPropagation()
  if (armed.value !== b.id) { armed.value = b.id; return }
  armed.value = ''
  removeBook(b.id)
  flash(`Removed “${b.title}” from your library`)
}

/* collections */
const addingCol = ref(false)
const newColName = ref('')
const armedCol = ref('')
function createCollection() {
  const col = addCollection(newColName.value)
  newColName.value = ''
  addingCol.value = false
  if (col) { state.collectionFilter = col.id; flash(`Created “${col.name}”`) }
}
function onRemoveCol(c, e) {
  e.stopPropagation()
  if (armedCol.value !== c.id) { armedCol.value = c.id; return }
  armedCol.value = ''
  removeCollection(c.id)
  flash(`Deleted collection “${c.name}”`)
}

/* assign menu on the cover */
const menuBook = ref(null)
const menuPos = ref({ x: 0, y: 0 })
function openMenu(b, e) {
  e.stopPropagation()
  const r = e.currentTarget.getBoundingClientRect()
  menuPos.value = { x: Math.min(r.left, window.innerWidth - 236), y: r.bottom + 6 }
  menuBook.value = menuBook.value === b ? null : b
}
function menuToggle(colId) {
  if (menuBook.value) toggleInCollection(menuBook.value, colId)
}
const menuNewName = ref('')
function menuCreate() {
  const col = addCollection(menuNewName.value)
  menuNewName.value = ''
  if (col && menuBook.value) {
    toggleInCollection(menuBook.value, col.id)
    flash(`Added to “${col.name}”`)
  }
}
function onWindowClick() { menuBook.value = null }
onMounted(() => window.addEventListener('click', onWindowClick))
onBeforeUnmount(() => window.removeEventListener('click', onWindowClick))
</script>

<template>
  <div class="appbar">
    <label class="search">
      <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
      <input v-model="state.libQuery" placeholder="Search your library" aria-label="Search your library" />
    </label>
    <button class="btn primary push" :disabled="state.busy" @click="importBook">
      <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
      {{ state.busy ? 'Importing…' : 'Import' }}
    </button>
  </div>

  <div class="lib">
    <!-- first run -->
    <div v-if="!state.books.length" class="empty">
      <div class="empty-mark" aria-hidden="true">M</div>
      <h2>Your shelf is empty</h2>
      <p>Import an ebook from your computer — EPUB, FB2, MOBI, PDF, TXT or HTML —
         drop it anywhere on the window, or start with a sample book.</p>
      <div class="empty-actions">
        <button class="btn primary" :disabled="state.busy" @click="importBook">Import a book</button>
        <button class="btn" @click="loadSample">Try the sample book</button>
      </div>
    </div>

    <template v-else>
      <section v-if="current" class="continue-wrap">
        <h2 class="sect">Continue reading</h2>
        <button class="continue" @click="open(current)">
          <div class="cover c-sm" :style="current.cover ? {} : { background: coverColor(current.title) }">
            <img v-if="current.cover" :src="current.cover" alt="" />
            <template v-else>
              <span class="ct">{{ current.title }}</span>
              <span class="ca">{{ current.author }}</span>
            </template>
          </div>
          <div class="meta">
            <div class="kicker">
              {{ current.totalChapters ? `Chapter ${(current.chapter || 0) + 1} of ${current.totalChapters}` : 'Not opened yet' }}
            </div>
            <h3>{{ current.title }}</h3>
            <div class="au">{{ current.author || 'Unknown author' }}</div>
            <div class="prog">
              <div class="bar"><i :style="{ width: percent(current) + '%' }"></i></div>
              <span class="pv">{{ percent(current) }}%</span>
            </div>
          </div>
          <div class="act"><span class="btn primary">Resume</span></div>
        </button>
      </section>

      <section class="shelf-wrap">
        <!-- collection filter chips -->
        <div class="chipsrow">
          <button class="chip" :class="{ on: state.collectionFilter === 'all' }"
            @click="state.collectionFilter = 'all'">All books · {{ state.books.length }}</button>
          <span v-for="c in state.collections" :key="c.id" class="chipwrap">
            <button class="chip" :class="{ on: state.collectionFilter === c.id }"
              @click="state.collectionFilter = c.id">{{ c.name }}</button>
            <button v-if="state.collectionFilter === c.id" class="chipx"
              :class="{ armed: armedCol === c.id }"
              :title="armedCol === c.id ? 'Click again to delete' : 'Delete collection'"
              @click="onRemoveCol(c, $event)">{{ armedCol === c.id ? 'Delete' : '×' }}</button>
          </span>
          <button v-if="!addingCol" class="chip addcol" @click="addingCol = true">+ New collection</button>
          <input v-else ref="newColInput" v-model="newColName" class="colinput"
            placeholder="Collection name" autofocus
            @keydown.enter.prevent="createCollection"
            @keydown.esc="addingCol = false; newColName = ''"
            @blur="addingCol = false" />
        </div>

        <div class="shelf-head">
          <h2 class="sect">Your shelf</h2>
          <span class="count">{{ shelf.length }} {{ shelf.length === 1 ? 'book' : 'books' }}</span>
        </div>

        <div v-if="shelf.length" class="shelf">
          <div v-for="b in shelf" :key="b.id" class="book" role="button" tabindex="0"
            :aria-label="`Open ${b.title}`" @click="open(b)" @keydown.enter="open(b)"
            @mouseleave="armed = ''">
            <div class="cover" :style="b.cover ? {} : { background: coverColor(b.title) }">
              <img v-if="b.cover" :src="b.cover" alt="" />
              <template v-else>
                <span class="ct">{{ b.title }}</span>
                <span class="ca">{{ b.author }}</span>
              </template>
              <span class="fmt">{{ (b.format || 'epub').toUpperCase() }}</span>
              <button class="rm" :class="{ armed: armed === b.id }"
                :title="armed === b.id ? 'Click again to remove' : 'Remove from library'"
                :aria-label="`Remove ${b.title}`" @click="onRemove(b, $event)">
                {{ armed === b.id ? 'Remove' : '\u00d7' }}
              </button>
              <button class="folder" title="Add to collection" :aria-label="`Add ${b.title} to a collection`"
                @click="openMenu(b, $event)">
                <svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>
              </button>
            </div>
            <div class="bt">{{ b.title }}</div>
            <div class="ba">{{ b.author || b.name }}</div>
            <div class="bp"><i :style="{ width: percent(b) + '%' }"></i></div>
          </div>
        </div>
        <div v-else class="noresults">
          {{ state.collectionFilter !== 'all'
            ? 'No books in this collection yet — hover a cover and use the folder button.'
            : `No books match “${state.libQuery}”.` }}
        </div>
      </section>
    </template>
  </div>

  <!-- collection assignment menu -->
  <div v-if="menuBook" class="colmenu" :style="{ left: menuPos.x + 'px', top: menuPos.y + 'px' }"
    role="menu" @click.stop>
    <div class="cm-title">Add “{{ menuBook.title }}” to…</div>
    <button v-for="c in state.collections" :key="c.id" class="cm-item" role="menuitem"
      @click="menuToggle(c.id)">
      <span class="cm-check" :class="{ on: (menuBook.collectionIds || []).includes(c.id) }">✓</span>
      <span class="cm-name">{{ c.name }}</span>
    </button>
    <p v-if="!state.collections.length" class="cm-empty">No collections yet — name one below.</p>
    <div class="cm-new">
      <input v-model="menuNewName" class="cm-input" placeholder="New collection…"
        @keydown.enter.prevent="menuCreate" @keydown.esc="menuBook = null" />
      <button class="btn sm primary" :disabled="!menuNewName.trim()" @click="menuCreate">Add</button>
    </div>
  </div>
</template>

<style scoped>
.lib { flex: 1; overflow-y: auto; padding: 24px 28px 40px; }
.push { margin-left: auto; }
.sect { font-family: var(--serif); font-size: 17px; font-weight: 600; }

.empty { max-width: 480px; padding: 64px 0; }
.empty-mark {
  width: 54px; height: 54px; border-radius: 14px;
  background: var(--ink); color: var(--paper);
  display: grid; place-items: center;
  font-family: var(--serif); font-size: 26px; font-weight: 600;
  margin-bottom: 22px;
}
.empty h2 { font-family: var(--serif); font-size: 24px; font-weight: 600; margin-bottom: 10px; }
.empty p { color: var(--ink-soft); line-height: 1.6; margin-bottom: 22px; }
.empty-actions { display: flex; gap: 10px; }

.continue-wrap { margin-bottom: 30px; }
.continue-wrap .sect { display: block; margin-bottom: 14px; }
.continue {
  width: 100%; text-align: left; cursor: pointer;
  display: flex; gap: 22px; align-items: stretch;
  background: var(--panel); border: 1px solid var(--line); border-radius: 10px;
  padding: 20px; font: inherit; color: inherit;
  transition: border-color .15s ease;
}
.continue:hover { border-color: var(--ink-faint); }
.continue .meta { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.kicker { font-size: 12px; color: var(--ink-faint); margin-bottom: 6px; }
.meta h3 { font-family: var(--serif); font-size: 21px; font-weight: 600; }
.au { font-size: 13px; color: var(--ink-soft); margin-top: 3px; }
.prog { margin-top: auto; display: flex; align-items: center; gap: 12px; padding-top: 16px; }
.bar { flex: 1; height: 4px; background: var(--line); border-radius: 2px; overflow: hidden; }
.bar i { display: block; height: 100%; background: var(--ink); }
.pv { font-size: 12px; color: var(--ink-soft); font-variant-numeric: tabular-nums; }
.act { display: flex; align-items: center; }

/* collections */
.chipsrow { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 18px; }
.chipwrap { display: inline-flex; align-items: center; }
.chipx {
  border: 0; background: transparent; color: var(--ink-faint);
  font-size: 13px; cursor: pointer; padding: 0 2px; margin-left: -2px;
}
.chipx.armed {
  background: #8E2F2F; color: #fff; border-radius: 4px;
  font-size: 11px; font-weight: 600; padding: 2px 7px; margin-left: 4px;
}
.chip.addcol { border-style: dashed; color: var(--ink-faint); }
.colinput {
  font: inherit; font-size: 12px; width: 150px;
  border: 1px solid var(--ink); border-radius: 20px;
  background: var(--panel); color: var(--ink);
  padding: 4px 11px; outline: none;
}

.shelf-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 16px; }
.count { font-size: 12px; color: var(--ink-faint); }
.shelf { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 24px 20px; }
.book { cursor: pointer; min-width: 0; }
.book .cover { margin-bottom: 9px; transition: transform .15s ease; }
.book:hover .cover, .book:focus-visible .cover { transform: translateY(-3px); }
.bt { font-size: 13px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ba { font-size: 12px; color: var(--ink-faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bp { margin-top: 6px; height: 3px; background: var(--line); border-radius: 2px; overflow: hidden; }
.bp i { display: block; height: 100%; background: var(--ink-faint); }
.noresults { color: var(--ink-faint); font-size: 13px; padding: 30px 0; line-height: 1.5; }

.cover {
  position: relative; aspect-ratio: 2 / 3; overflow: hidden;
  border-radius: 3px 6px 6px 3px;
  box-shadow: 0 1px 2px rgba(27, 28, 31, .16), 0 8px 22px rgba(27, 28, 31, .12);
  padding: 14px 12px; display: flex; flex-direction: column;
  font-family: var(--serif); color: #fff; background: #2E3A4F;
}
[data-theme='dark'] .cover { box-shadow: 0 1px 2px rgba(0, 0, 0, .5), 0 8px 22px rgba(0, 0, 0, .4); }
.cover::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 5px; background: rgba(0, 0, 0, .22); }
.cover img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.cover .ct { font-size: 14px; font-weight: 600; line-height: 1.25; position: relative; }
.cover .ca { font-size: 10.5px; opacity: .85; font-style: italic; margin-top: auto; position: relative; }
.c-sm { width: 110px; flex: none; }

.fmt {
  position: absolute; top: 6px; left: 8px; z-index: 2;
  font-family: var(--sans); font-size: 9px; font-weight: 600; letter-spacing: .06em;
  background: rgba(20, 20, 22, .72); color: #fff;
  border-radius: 4px; padding: 2px 5px;
}
.rm, .folder {
  position: absolute; z-index: 2;
  min-width: 22px; height: 22px; padding: 0 5px;
  border: 0; border-radius: 6px; cursor: pointer;
  background: rgba(20, 20, 22, .72); color: #fff;
  font-size: 14px; line-height: 1; opacity: 0;
  display: grid; place-items: center;
  transition: opacity .12s ease;
}
.rm { top: 6px; right: 6px; }
.folder { top: 34px; right: 6px; }
.folder svg { width: 13px; height: 13px; stroke: currentColor; fill: none; stroke-width: 1.8; }
.book:hover .rm, .book:hover .folder, .rm:focus-visible, .folder:focus-visible { opacity: 1; }
.rm.armed { background: #8E2F2F; font-size: 11px; font-weight: 600; opacity: 1; }

/* collection menu */
.colmenu {
  position: fixed; z-index: 70; width: 224px;
  background: var(--panel); border: 1px solid var(--line);
  border-radius: 9px; box-shadow: var(--shadow-menu);
  padding: 8px; font-family: var(--sans);
}
.cm-title { font-size: 11px; color: var(--ink-faint); padding: 4px 8px 7px; }
.cm-item {
  display: flex; align-items: center; gap: 8px; width: 100%;
  border: 0; background: transparent; cursor: pointer;
  font: inherit; font-size: 13px; color: var(--ink);
  padding: 7px 8px; border-radius: 6px; text-align: left;
}
.cm-item:hover { background: var(--chrome); }
.cm-check { width: 14px; color: var(--ink); opacity: 0; font-size: 12px; }
.cm-check.on { opacity: 1; }
.cm-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cm-empty { font-size: 12px; color: var(--ink-faint); padding: 4px 8px 8px; }
.cm-new { display: flex; gap: 6px; border-top: 1px solid var(--line); padding-top: 8px; margin-top: 4px; }
.cm-input {
  flex: 1; min-width: 0; font: inherit; font-size: 12.5px;
  border: 1px solid var(--line); border-radius: 6px;
  background: var(--paper); color: var(--ink);
  padding: 5px 8px; outline: none;
}
.cm-input:focus { border-color: var(--ink); }
.btn.sm { height: 27px; padding: 0 10px; font-size: 12px; }
</style>
