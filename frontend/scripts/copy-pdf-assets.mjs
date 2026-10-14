// pdf.js needs cmaps/standard_fonts/wasm for non-Latin and exotic PDFs.
// Copy them into public/ before dev/build so the app stays fully offline.
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const src = (p) => fileURLToPath(new URL(`../node_modules/pdfjs-dist/${p}`, import.meta.url))
const dst = (p) => fileURLToPath(new URL(`../public/pdfjs/${p}`, import.meta.url))

if (!existsSync(src('package.json'))) {
  console.error('pdfjs-dist not installed — run npm install')
  process.exit(1)
}
mkdirSync(fileURLToPath(new URL('../public/', import.meta.url)), { recursive: true })
for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'image_decoders']) {
  cpSync(src(dir), dst(dir), { recursive: true })
}
console.log('pdf.js assets copied to public/pdfjs')
