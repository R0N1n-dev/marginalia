<script setup>
import { ref, watch, nextTick } from 'vue'
import { updateNote, deleteNote } from '../lib/store.js'

const props = defineProps({
  notes: { type: Array, required: true },
  activeId: { type: String, default: '' },
  editingId: { type: String, default: '' },
  total: { type: Number, default: 0 },
})
const emit = defineEmits(['select', 'stop-edit'])

const list = ref(null)
watch(() => props.activeId, async (id) => {
  if (!id) return
  await nextTick()
  const el = list.value && list.value.querySelector('.note.active')
  if (el) el.scrollIntoView({ block: 'nearest' })
})

const draftText = ref('')
const draftTags = ref('')
const editor = ref(null)

watch(() => props.editingId, (id) => {
  const n = props.notes.find((x) => x.id === id)
  if (n) {
    draftText.value = n.note
    draftTags.value = n.tags.join(', ')
    nextTick(() => editor.value && editor.value.focus())
  }
})

function save() {
  const n = props.notes.find((x) => x.id === props.editingId)
  if (!n) return
  updateNote(n.id, {
    note: draftText.value.trim(),
    tags: draftTags.value.split(',').map((t) => t.trim()).filter(Boolean),
  })
  emit('stop-edit')
}
function cancel() { emit('stop-edit') }

const COLORS = { sun: 'var(--sun)', mint: 'var(--mint)', sky: 'var(--sky)', rose: 'var(--rose)' }
</script>

<template>
  <aside class="marg" aria-label="Marginalia">
    <div class="mh">
      <span>Marginalia</span>
      <span class="cnt">{{ total }} in book</span>
    </div>

    <div class="notes" ref="list">
      <div v-for="n in notes" :key="n.id" class="note"
        :class="{ editing: editingId === n.id, active: activeId === n.id }"
        :style="{ '--mk': COLORS[n.color] || COLORS.sun }"
        @click="emit('select', n.id)">
        <blockquote class="q">“{{ n.quote }}”</blockquote>

        <template v-if="editingId === n.id">
          <textarea ref="editor" v-model="draftText" class="ed" rows="3"
            placeholder="Why does this matter?" @keydown.esc="cancel" @keydown.meta.enter="save" @keydown.ctrl.enter="save"></textarea>
          <input v-model="draftTags" class="ed tags" placeholder="Tags, comma separated" @keydown.esc="cancel" @keydown.enter.prevent="save" />
          <div class="ed-act">
            <button class="btn sm" @click.stop="cancel">Cancel</button>
            <button class="btn sm primary" @click.stop="save">Save note</button>
          </div>
        </template>

        <template v-else>
          <p v-if="n.note" class="n">{{ n.note }}</p>
          <div class="nm">
            <span v-for="t in n.tags" :key="t" class="tag">{{ t }}</span>
            <button class="iconbtn del" title="Delete note" aria-label="Delete note" @click.stop="deleteNote(n.id)">
              <svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V5h6v2m-8 0 1 13h8l1-13" /></svg>
            </button>
          </div>
        </template>
      </div>

      <p v-if="!notes.length" class="hint">Select any text on the page to highlight it or leave a note.</p>
    </div>
  </aside>
</template>

<style scoped>
.marg {
  width: 268px; flex: none;
  border-left: 1px solid var(--line);
  background: var(--chrome);
  display: flex; flex-direction: column; min-height: 0;
}
.mh {
  padding: 14px 16px 10px;
  display: flex; align-items: center; justify-content: space-between;
  font-size: 12px; font-weight: 600; color: var(--ink-faint);
}
.cnt { font-weight: 400; }
.notes { padding: 2px 12px 16px; overflow-y: auto; display: flex; flex-direction: column; gap: 9px; }

.note {
  background: var(--panel); border: 1px solid var(--line);
  border-radius: 8px; padding: 10px 11px; cursor: pointer;
  transition: border-color .12s ease;
}
.note:hover { border-color: var(--ink-faint); }
.note.active { border-color: var(--ink); }
.note.editing { cursor: default; }
.q {
  font-family: var(--serif); font-size: 12.5px; line-height: 1.55;
  padding-left: 9px; border-left: 3px solid var(--mk);
}
.n { font-size: 12px; color: var(--ink-soft); margin-top: 7px; line-height: 1.45; }
.nm { display: flex; gap: 6px; align-items: center; margin-top: 8px; flex-wrap: wrap; }
.tag {
  font-size: 11px; color: var(--ink-faint);
  background: var(--chrome); border: 1px solid var(--line);
  border-radius: 4px; padding: 1px 6px;
}
.note .del { width: 22px; height: 22px; margin-left: auto; opacity: 0; }
.note:hover .del, .note .del:focus-visible { opacity: 1; }
.note .del svg { width: 13px; height: 13px; }

.ed {
  width: 100%; margin-top: 8px; resize: vertical;
  font: inherit; font-size: 12.5px; color: var(--ink);
  background: var(--paper); border: 1px solid var(--line);
  border-radius: 6px; padding: 7px 8px; line-height: 1.45;
}
.ed:focus { outline: none; border-color: var(--ink); }
.ed.tags { resize: none; margin-top: 6px; font-size: 12px; }
.ed-act { display: flex; gap: 6px; justify-content: flex-end; margin-top: 8px; }
.btn.sm { height: 26px; padding: 0 10px; font-size: 12px; }

.hint { font-size: 12.5px; color: var(--ink-faint); line-height: 1.5; padding: 8px 4px; }
</style>
