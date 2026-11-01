import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MIN_PAGE_WIDTH, MAX_PAGE_WIDTH,
  columnWidth, pagesInFlow, scrollLeftFor, pageAt, railPercent,
} from '../src/lib/paginate.js'

test('columnWidth: fills the room on normal widths, caps the measure when wide', () => {
  assert.equal(columnWidth(800), 660, 'wide room → capped measure with margins')
  assert.equal(columnWidth(1400), MAX_PAGE_WIDTH)
  assert.equal(columnWidth(600), 552, 'room minus both gutters')
  assert.equal(columnWidth(0), MIN_PAGE_WIDTH, 'unmeasured room falls back to the minimum')
  // tiny window: never wider than the room itself, so nothing is cut off
  assert.equal(columnWidth(300), 300)
  assert.ok(columnWidth(280) <= 280)
})

test('columnWidth never exceeds the room, so a page can never bleed outside', () => {
  for (const room of [200, 240, 260, 300, 320, 332, 368, 369, 500, 720, 1600, 2400]) {
    assert.ok(columnWidth(room) <= Math.max(MIN_PAGE_WIDTH, room), `room ${room}`)
  }
})

test('pagesInFlow: inverts the n*page + (n-1)*gap width of a column flow', () => {
  const width = (n, page, gap) => n * page + (n - 1) * gap
  const page = 640, gap = 45
  for (const n of [1, 2, 3, 7, 42]) {
    assert.equal(pagesInFlow(width(n, page, gap), page, gap), n, `${n} columns`)
  }
  // a single column (or a slightly overflowing one) is one page
  assert.equal(pagesInFlow(0, page, gap), 1)
  assert.equal(pagesInFlow(page, page, gap), 1)
  assert.equal(pagesInFlow(page + 7, page, gap), 1, 'rounding noise does not invent a page')
  assert.equal(pagesInFlow(NaN, page, gap), 1)
})

test('scrollLeftFor / pageAt are inverses, so paging is exact', () => {
  const step = 655
  for (const i of [0, 1, 5, 30]) {
    const left = scrollLeftFor(i, step)
    assert.equal(left, i * step)
    assert.equal(pageAt(left, 0, step), i)
  }
  assert.equal(scrollLeftFor(-3, step), 0, 'negative indices clamp')
})

test('pageAt maps an element inside a column to that page', () => {
  const step = 642, col = 600
  assert.equal(pageAt(step * 2 + 12, 0, step), 2, 'near the left edge of page 2')
  assert.equal(pageAt(step * 2 + col - 4, 0, step), 2, 'near the right edge of page 2')
  assert.equal(pageAt(120, 100, step), 0, 'flow offset by its own left edge')
})

test('railPercent clamps to the rail', () => {
  assert.equal(railPercent(100, 100, 400), 0)
  assert.equal(railPercent(300, 100, 400), 50)
  assert.equal(railPercent(900, 100, 400), 100)
  assert.equal(railPercent(120, 100, 0), 0)
})
