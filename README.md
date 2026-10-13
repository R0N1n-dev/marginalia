# Marginalia

A desktop e-book reader and annotator. Import EPUBs, read them in a paginated
view, highlight in four colors, keep notes with tags, and export everything to
Markdown.

Built with **Wails v2** (Go backend) and **Vue 3** (JavaScript, Vite).

## Features

- **Import** — native file dialog or drag & drop anywhere onto the window
- **Library** — covers, continue-reading, progress, remove books (two-click confirm)
- **Reader** — paginated pages (arrows, edge buttons, ← → / Space / PageUp / PageDown keys),
  nested table of contents, click-to-jump progress scrubber
- **Annotate** — select text → highlight in yellow/green/blue/pink, add a note with tags;
  a marginalia panel sits beside the text; colored flags mark highlights on the page edge
- **Find** — search every chapter and jump to the match
- **Notes** — filter by book, search, jump back to the passage, export Markdown
- **Comfort** — light/dark theme, adjustable text size, self-hosted fonts (works offline)
- **Sample book** built in so you can try everything without a file

## Running

Requirements: Go 1.25+, Node 18+, [Wails CLI v2](https://wails.io):

```sh
go install github.com/wailsapp/wails/v2/cmd/wails@latest
wails dev                 # dev server with hot reload
```

Building:

```sh
wails build               # most Linux distros (webkit2gtk-4.0)
wails build -tags webkit2_41   # Ubuntu 24.04+ / webkit2gtk-4.1
```

Frontend only (browser preview — uses localStorage + file input instead of
the native dialogs):

```sh
cd frontend && npm install && npm run dev
```

## Tests

The EPUB parser and highlight-offset logic are pure functions with Node tests:

```sh
cd frontend && node --test test/*.test.mjs
```

## Data & privacy

Library and notes are stored as one JSON document in the OS config directory
(`~/.config/marginalia/store.json` on Linux). Book files are never copied —
they're read from their original path. No network access, no telemetry.

## Repository layout

```
main.go / app.go        Wails app: file dialogs, storage, external links
frontend/src/lib/       epub.js (parser), marks.js (highlight offsets),
                        sample.js (built-in book), store.js, backend.js
frontend/src/views/     Library, Reader, Notes, MarginaliaPanel
frontend/test/          Node tests for parser + offset logic
design/mockup.html      The approved HTML mockup this UI was built from
```
