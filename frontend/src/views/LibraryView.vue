<script setup>
import { computed } from 'vue'
import { ref } from 'vue'
import { state, importBook, loadSample, openBook, removeBook, flash } from '../lib/store.js'

const shelf = computed(() => {
  const q = (state.libQuery || '').trim().toLowerCase()
  const books = [...state.books].sort((a, b) => (b.lastOpened || 0) - (a.lastOpened || 0))
  if (!q) return books
  return books.filter((b) => `${b.title} ${b.author} ${b.name}`.toLowerCase().includes(q))
})
const current = computed(() => shelf.value[0] || null)
// Deterministic muted cover color for books without cover art.
function coverColor(seed = '') {
  const colors = ['#7A3B2E', '#38513F', '#4A3B63', '#1F2A33', '#8A6D2F', '#5C2E3E', '#2E3A4F']
  let h = 0
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return colors[h % colors.length]
}
const armed = ref('') // book id awaiting second click to confirm removal
function open(b) { armed.value = ''; openBook(b.id) }
function onRemove(b, e) {
  e.stopPropagation()
  if (armed.value !== b.id) { armed.value = b.id; return }
  armed.value = ''
  removeBook(b.id)
  flash(`Removed “${b.title}” from your library`)
}
const percent = (b) => {
  const total = b.totalChapters || 1
  return Math.min(100, Math.round(((b.chapter || 0) / total) * 100))
}
</script>

<template>
  <div class="appbar">
    <label class="search">
      <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
      <input v-model="state.libQuery" placeholder="Search your library" aria-label="Search your library" />
    </label>
    <button class="btn primary push" :disabled="state.busy" @click="importBook">
      <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
      {{ state.busy ? 'Importing…' : 'Import EPUB' }}
    </button>
  </div>

  <div class="lib">
    <!-- first run -->
    <div v-if="!state.books.length" class="empty">
      <div class="empty-mark" aria-hidden="true">M</div>
      <h2>Your shelf is empty</h2>
      <p>Import an EPUB file from your computer, or start with a short sample book to see how reading and highlighting work.</p>
      <div class="empty-actions">
        <button class="btn primary" :disabled="state.busy" @click="importBook">Import EPUB</button>
        <button class="btn" @click="loadSample">Try the sample book</button>
      </div>
    </div>

    <template v-else>
      <section v-if="current && shelf.length" class="continue-wrap">
        <h2 class="sect">Continue reading</h2>
        <button class="continue" @click="openBook(current.id)">
          <div class="cover c-sm" :style="current.cover ? { background: 'var(--chrome)' } : { background: '#2E3A4F' }">
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
        <div class="shelf-head">
          <h2 class="sect">Your shelf</h2>
          <span class="count">{{ shelf.length }} {{ shelf.length === 1 ? 'book' : 'books' }}</span>
        </div>
        <div v-if="shelf.length" class="shelf">
          <div v-for="b in shelf" :key="b.id" class="book" role="button" tabindex="0"
            :aria-label="`Open ${b.title}`" @click="open(b)" @keydown.enter="open(b)" @mouseleave="armed = ''">
            <div class="cover" :style="b.cover ? {} : { background: coverColor(b.title) }">
              <img v-if="b.cover" :src="b.cover" alt="" />
              <template v-else>
                <span class="ct">{{ b.title }}</span>
                <span class="ca">{{ b.author }}</span>
              </template>
              <button class="rm" :class="{ armed: armed === b.id }"
                :title="armed === b.id ? 'Click again to remove' : 'Remove from library'"
                :aria-label="`Remove ${b.title}`" @click="onRemove(b, $event)">
                {{ armed === b.id ? 'Remove' : '\u00d7' }}
              </button>
            </div>
            <div class="bt">{{ b.title }}</div>
            <div class="ba">{{ b.author || b.name }}</div>
            <div class="bp"><i :style="{ width: percent(b) + '%' }"></i></div>
          </div>
        </div>
        <div v-else class="noresults">No books match “{{ state.libQuery }}”.</div>
      </section>
    </template>
  </div>
</template>


<style scoped>
.lib { flex: 1; overflow-y: auto; padding: 24px 28px 40px; }
.push { margin-left: auto; }
.sect { font-family: var(--serif); font-size: 17px; font-weight: 600; }

.empty { max-width: 460px; padding: 64px 0; }
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

.continue-wrap { margin-bottom: 34px; }
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

.shelf-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 16px; }
.count { font-size: 12px; color: var(--ink-faint); }
.shelf { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 24px 20px; }
.book { cursor: pointer; min-width: 0; }
.book .cover { margin-bottom: 9px; transition: transform .15s ease; }
.book:hover .cover { transform: translateY(-3px); }
.book:focus-visible .cover { transform: translateY(-3px); }
.bt { font-size: 13px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ba { font-size: 12px; color: var(--ink-faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bp { margin-top: 6px; height: 3px; background: var(--line); border-radius: 2px; overflow: hidden; }
.bp i { display: block; height: 100%; background: var(--ink-faint); }
.noresults { color: var(--ink-faint); font-size: 13px; padding: 30px 0; }

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
.rm {
  position: absolute; top: 6px; right: 6px; z-index: 2;
  min-width: 22px; height: 22px; padding: 0 5px;
  border: 0; border-radius: 6px; cursor: pointer;
  background: rgba(20, 20, 22, .72); color: #fff;
  font-size: 14px; line-height: 1; opacity: 0;
  transition: opacity .12s ease;
}
.book:hover .rm, .rm:focus-visible { opacity: 1; }
.rm.armed { background: #8E2F2F; font-size: 11px; font-weight: 600; opacity: 1; }
.cover .ct { font-size: 14px; font-weight: 600; line-height: 1.25; position: relative; }
.cover .ca { font-size: 10.5px; opacity: .85; font-style: italic; margin-top: auto; position: relative; }
.c-sm { width: 110px; flex: none; }
</style>
