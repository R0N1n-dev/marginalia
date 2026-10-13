<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { state, init, toggleTheme, closeReader, importFile } from './lib/store.js'

function goLibrary() {
  if (state.view === 'reader' && state.current) closeReader()
  else state.view = 'library'
}

/* drag a .epub anywhere onto the window to import it */
const dragOver = ref(false)
let dragDepth = 0
function onDragEnter(e) {
  if (e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files')) {
    dragDepth++
    dragOver.value = true
  }
}
function onDragLeave() {
  dragDepth = Math.max(0, dragDepth - 1)
  if (!dragDepth) dragOver.value = false
}
function onDrop(e) {
  e.preventDefault()
  dragDepth = 0
  dragOver.value = false
  const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]
  if (f) importFile(f)
}
function onDragOver(e) { e.preventDefault() }

onMounted(() => {
  window.addEventListener('dragenter', onDragEnter)
  window.addEventListener('dragleave', onDragLeave)
  window.addEventListener('dragover', onDragOver)
  window.addEventListener('drop', onDrop)
})
onBeforeUnmount(() => {
  window.removeEventListener('dragenter', onDragEnter)
  window.removeEventListener('dragleave', onDragLeave)
  window.removeEventListener('dragover', onDragOver)
  window.removeEventListener('drop', onDrop)
})
import LibraryView from './views/LibraryView.vue'
import ReaderView from './views/ReaderView.vue'
import NotesView from './views/NotesView.vue'

init()
</script>

<template>
  <div class="shell">
    <nav class="rail" aria-label="Main">
      <div class="logo" aria-hidden="true">M</div>
      <button
        :class="{ on: state.view === 'library' || state.view === 'reader' }"
        title="Library" aria-label="Library" @click="goLibrary">
        <svg viewBox="0 0 24 24"><path d="M4 19V5a1 1 0 0 1 1-1h3a2 2 0 0 1 2 2v13M4 19a1 1 0 0 0 1 1h3a2 2 0 0 0 2-2M14 19V6a1 1 0 0 1 1-1h3a2 2 0 0 1 2 2v12a1 1 0 0 1-1 1h-3a2 2 0 0 1-2-2"/></svg>
      </button>
      <button
        :class="{ on: state.view === 'notes' }"
        title="Notes" aria-label="Notes" @click="state.view = 'notes'">
        <svg viewBox="0 0 24 24"><path d="M5 4h14v12l-4 4H5z"/><path d="M15 20v-4h4M8 9h8M8 13h5"/></svg>
      </button>
      <button class="push" style="margin-top: auto" :title="state.theme === 'dark' ? 'Switch to light' : 'Switch to dark'"
        aria-label="Toggle theme" @click="toggleTheme">
        <svg v-if="state.theme === 'dark'" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6l1.4 1.4m10 10 1.4 1.4m0-12.8-1.4 1.4m-10 10-1.4 1.4"/></svg>
        <svg v-else viewBox="0 0 24 24"><path d="M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10z"/></svg>
      </button>
    </nav>

    <main class="main">
      <ReaderView v-if="state.view === 'reader' && state.current" />
      <NotesView v-else-if="state.view === 'notes'" />
      <LibraryView v-else />
    </main>

    <div v-if="dragOver" class="dropzone" aria-hidden="true">
      <div class="dz">Drop your EPUB to import it</div>
    </div>

    <div class="toasts" aria-live="polite">
      <div v-if="state.error" class="toast err">{{ state.error }}</div>
      <div v-if="state.flash" class="toast">{{ state.flash }}</div>
    </div>
  </div>
</template>

<style scoped>
.dropzone {
  position: fixed; inset: 0; z-index: 80;
  background: color-mix(in srgb, var(--ink) 28%, transparent);
  display: grid; place-items: center; pointer-events: none;
}
.dz {
  background: var(--paper); color: var(--ink);
  border: 2px dashed var(--ink); border-radius: 12px;
  padding: 22px 34px; font-size: 15px; font-weight: 500;
}
</style>
