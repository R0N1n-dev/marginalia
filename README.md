# Marginalia

A desktop e-book reader and annotator built with **Wails v2** + **Vue 3**. Read, highlight,
annotate, bookmark and organise your books — in light or dark.

![formats](https://img.shields.io/badge/formats-EPUB%20%C2%B7%20PDF%20%C2%B7%20MOBI%20%C2%B7%20FB2%20%C2%B7%20HTML%20%C2%B7%20TXT-success)

## Features

- **Six formats, one library** — EPUB, PDF, MOBI/AZW3, FB2, HTML and plain text. Drag a file
  onto the window or use Import; format badges show what's what.
- **Reading** — paginated EPUB flow with a table-of-contents rail, nested chapters, a bottom
  scrubber with time-remaining, resume-where-you-left-off, and per-page navigation for PDFs.
  Pages are true single pages: the column flow is clipped to exactly one page wide, so the
  next page never peeks in at the edge, the text gets a comfortable measure and the page sits
  centred with margins on wide windows.
- **Focus mode** — press `f` (or the frame button) to drop everything but the page: rails,
  contents, marginalia and scrubber step aside, a hairline at the top of the window shows how
  far through the book you are, and `Esc` brings it all back. Your place is kept.
- **Keyboard** — `←` `→` / `Space` to turn pages, `Home` `End` for the ends of a chapter,
  `f` focus, `t` contents, `b` bookmark, `+` `−` text size, `?` for the full list. Paging
  backwards past the start of a chapter lands on the previous chapter's last page.
- **Highlighting & notes** — select text, pick one of four highlighter colours, attach a note.
  Highlights render as colored flags on the page edge — each flag sits on the page where its
  highlight actually is, at the right height; notes appear in the *marginalia* rail beside the
  text they belong to. PDFs get page-level notes.
- **Notes overview** — every highlight across every book, filtered by book or colour, with
  tags, search, and **Markdown export**.
- **Bookmarks** — flag a page or passage and jump back to it from the reader.
- **Collections** — group books into custom shelves (Reading, Research, …) and filter the
  library by them.
- **Progress** — reading progress and position persist per book and save on close.
- **Themes** — quiet greyscale chrome in light and dark, following system preference on first
  run; the only colour in the app comes from your own highlights and covers.
- **Offline** — no network required: fonts, PDF.js worker and all parsers ship with the app.
- **Sample book** — "Try the sample book" imports a generated EPUB so the app works before you
  have any files; it self-heals after a restart.

## Architecture

| Layer | Tech |
|---|---|
| Shell | Wails v2 (Go) — window, file dialogs, file I/O, JSON persistence |
| UI | Vue 3 + Vite, plain CSS variables for theming, no UI framework |
| EPUB | own parser (zip + opf/nav/ncx + chapter DOM) with offset-stable text extraction |
| MOBI/AZW3 | [foliate-js](https://github.com/johnfactotum/foliate-js) (MIT), lazy-loaded |
| PDF | [pdf.js](https://mozilla.github.io/pdf.js/) (Apache-2.0), lazy-loaded with its worker |
| FB2 / HTML / TXT | own parsers over a shared sanitizer |
| Pagination | CSS multi-column flow, one column per page (`lib/paginate.js`) |

Parsers are pure JavaScript and unit-tested in Node (`npm test`) — no browser required.
Highlights store character offsets into the extracted chapter text, so they survive
re-pagination and font-size changes.

### Layout

```
main.go / app.go        Wails bindings: file dialogs, reads, JSON store, external links
frontend/src/
  backend/              thin API layer (Wails in the app, browser stubs in dev)
  lib/                  parsers: epub, mobi, pdf, fb2, text, html, dispatch, sanitizer, marks,
                        paginate (page geometry)
  stores/               library, reading state, highlights, collections, theme
  views/                LibraryView, ReaderView, NotesView
  components/           marginalia rail, nav, popover, …
frontend/src/assets/fonts/   self-hosted IBM Plex Sans + Literata (OFL)
```

## Development

Prerequisites: Go ≥ 1.21, Node ≥ 20, [Wails CLI v2](https://wails.io/docs/gettingstarted/installation).

```sh
npm --prefix frontend install   # once
wails dev                       # live reload; also serves on http://localhost:34115
```

In the browser dev server the Go layer is swapped for browser stubs (File picker via
`<input type=file>`, `localStorage`-backed store), so the full UI works in a plain browser too.

### Tests

```sh
npm --prefix frontend test      # 28 tests: parsers, offsets, pagination, dispatch, FB2, MOBI, PDF
```

### Build

```sh
wails build                     # production binary in build/bin/
wails build -tags webkit2_41    # Ubuntu 24.04 / newer WebKitGTK
```

## Data & privacy

Everything is local. Library metadata, progress, highlights, bookmarks and collections live in
a JSON file next to your user config; books are never copied or uploaded. External links open
in the system browser.

## Credits

- [foliate-js](https://github.com/johnfactotum/foliate-js) — MOBI/KF8 parsing (MIT)
- [pdf.js](https://github.com/mozilla/pdf.js) — PDF rendering (Apache-2.0)
- [Wails](https://wails.io), [Vue](https://vuejs.org)
- Type: [IBM Plex Sans](https://www.ibm.com/plex/) & [Literata](https://www.google.com/get/noto/)
  (SIL OFL), self-hosted.

## License

MIT (your project — change as needed).
