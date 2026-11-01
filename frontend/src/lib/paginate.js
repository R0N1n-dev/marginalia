// Page geometry for the column-based reader: a chapter is laid out as CSS
// columns and exactly one column is shown at a time, framed in the middle of
// the reading room. The maths lives here — pure functions — so it can be unit
// tested in Node without a browser.

export const MIN_PAGE_WIDTH = 320
export const MAX_PAGE_WIDTH = 660 // keeps the measure readable on wide screens
const SIDE_GUTTER = 24 // breathing room either side of the column

// Width of one text column inside a room `roomWidth` px wide. Wide windows get
// a comfortable measure with margins; narrow ones fill what they have.
export function columnWidth(roomWidth, gutter = SIDE_GUTTER) {
  const room = Number(roomWidth) || 0
  if (!(room > 0)) return MIN_PAGE_WIDTH
  const avail = room - gutter * 2
  if (avail < MIN_PAGE_WIDTH) return Math.max(160, Math.floor(room))
  return Math.round(Math.min(MAX_PAGE_WIDTH, avail))
}

// How many columns the flow produced. A flow of n columns is
// n*page + (n-1)*gap wide, so invert that: n = (width + gap) / (page + gap).
export function pagesInFlow(scrollWidth, pageWidth, gap) {
  const width = Number(scrollWidth) || 0
  if (!(pageWidth > 0) || !(width > pageWidth)) return 1
  return Math.max(1, Math.round((width + gap) / (pageWidth + gap)))
}

// Scroll offset that puts page `index` at the left edge of the page box.
export function scrollLeftFor(index, step) {
  return Math.max(0, Number(index) || 0) * (Number(step) || 0)
}

// Page index a horizontal content offset falls on. `left` and `flowLeft` must be
// measured in the same space (i.e. both in viewport coordinates).
export function pageAt(left, flowLeft, step) {
  if (!(step > 0)) return 0
  // floor, not round: any content of page k lies within [k*step, k*step+step],
  // which is always nearer to k's start than to the next page's.
  return Math.max(0, Math.floor((left - flowLeft) / step))
}

// Where a y offset sits on the page-edge rail, as a percentage from its top.
export function railPercent(y, railTop, railHeight) {
  if (!(railHeight > 0)) return 0
  return Math.min(100, Math.max(0, ((y - railTop) / railHeight) * 100))
}
