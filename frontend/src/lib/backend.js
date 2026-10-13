// One API over the Wails backend (desktop) and browser fallbacks (web preview):
// native file dialogs + config-dir storage in the app, file input + localStorage
// in the browser. Everything else in the app only talks to this module.
import { PickEpub, PickSavePath, ReadFileB64, ReadStore, WriteStore, WriteFileB64, OpenExternal } from '../../wailsjs/go/main/App'
import { toBase64 } from './epub.js'

export const isWails = () => !!(window.go && window.go.main && window.go.main.App)

function b64ToBytes(b64) {
  const bin = atob(b64)
  const u = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i)
  return u
}

// Returns { path|null, name, bytes } or null when cancelled.
export async function pickEpubBytes() {
  if (isWails()) {
    const path = await PickEpub()
    if (!path) return null
    const bytes = b64ToBytes(await ReadFileB64(path))
    return { path, name: path.split(/[\\/]/).pop(), bytes }
  }
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.epub,application/epub+zip'
    input.addEventListener('change', async () => {
      const f = input.files && input.files[0]
      resolve(f ? { path: null, name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) } : null)
    })
    input.addEventListener('cancel', () => resolve(null))
    input.click()
  })
}

// Re-read a library book's bytes from its saved path (desktop only).
export async function readEpubBytes(path) {
  if (!isWails() || !path) return null
  return b64ToBytes(await ReadFileB64(path))
}

export async function loadStore() {
  if (isWails()) return (await ReadStore()) || ''
  return localStorage.getItem('marginalia-store') || ''
}

export async function saveStore(json) {
  if (isWails()) await WriteStore(json)
  else localStorage.setItem('marginalia-store', json)
}

// Writes the file natively on desktop, falls back to a download in the browser.
// Returns false when the user cancelled the save dialog.
export async function exportText(defaultName, text) {
  if (isWails()) {
    const path = await PickSavePath(defaultName)
    if (!path) return false
    const b64 = toBase64(new TextEncoder().encode(text))
    await WriteFileB64(path, b64)
    return true
  }
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }))
  const a = document.createElement('a')
  a.href = url
  a.download = defaultName
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
  return true
}

export async function openExternal(url) {
  if (isWails()) {
    try { await OpenExternal(url) } catch (e) { /* rejected by Go validation */ }
  } else {
    window.open(url, '_blank', 'noopener')
  }
}
