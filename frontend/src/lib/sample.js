// Builds a small EPUB in memory so the app is usable on first run (and so the
// parser has a fixture that goes through the exact same import path).
import { zipSync } from 'fflate'

const coverSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600" viewBox="0 0 400 600">
<rect width="400" height="600" fill="#2E3A4F"/>
<rect x="0" y="0" width="10" height="600" fill="#00000033"/>
<text x="200" y="250" font-family="Georgia, serif" font-size="44" fill="#FCFCFA" text-anchor="middle">The Salt</text>
<text x="200" y="310" font-family="Georgia, serif" font-size="44" fill="#FCFCFA" text-anchor="middle">Path</text>
<text x="200" y="380" font-family="Georgia, serif" font-style="italic" font-size="22" fill="#cfd6e2" text-anchor="middle">H. R. Marlowe</text>
</svg>`

const ch = (n, title, body) => `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title></head>
<body><h2>${n}. ${title}</h2>${body}</body></html>`

const chapters = [
  ch(1, 'The letting go', `
<p>The house had been sold on a Tuesday, which Mara thought afterward was a deliberate cruelty of the calendar — a working day, a day when everyone else was busy and could not be asked to notice.</p>
<p>She carried one box to the car and came back for another, and by the fourth trip the rooms had already begun to sound unfamiliar, the way a word sounds when you say it too many times.</p>
<p><em>Nothing is ever only one thing</em>, her father used to say, usually about weather, occasionally about people. She had not believed him until the week the rain would not stop.</p>`),
  ch(2, 'A map with no roads', `
<p>The coastal path was not on any map she owned. It existed, according to the man at the hardware store, in the gap between the ordnance survey sheet and the tide table, and you could walk it only for four hours out of every eight.</p>
<p>She wrote his instructions down on the back of an envelope and misplaced them twice before understanding that the losing was part of it — that a route remembered is a route that holds.</p>
<p>Halfway along the causeway the gulls stood facing the wind in a line so exact it might have been measured, and she thought: <mark>that is what commitment looks like when nobody is watching</mark>.</p>`),
  ch(3, 'Lantern hours', `
<p>By the third week she had stopped counting the days and started counting the light: how long the headland held the evening, how the lamp turned before it was properly dark.</p>
<p>The keeper came out at four and again at nine, and in between the tower did its work alone. She asked him once whether it was lonely. He considered this the way some people consider a price.</p>
<p>"It's consistent," he said. "Lonely's what happens when people aren't."</p>`),
]

const nav = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Contents</title></head><body>
<nav epub:type="toc"><ol>
<li><a href="ch1.xhtml">1. The letting go</a></li>
<li><a href="ch2.xhtml">2. A map with no roads</a>
  <ol><li><a href="ch2.xhtml#half">The causeway</a></li></ol>
</li>
<li><a href="ch3.xhtml">3. Lantern hours</a></li>
</ol></nav></body></html>`

const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:title>The Salt Path</dc:title>
<dc:creator>H. R. Marlowe</dc:creator>
<dc:language>en</dc:language>
<dc:id id="id">marg-sample-1</dc:id>
<meta name="cover" content="cover-img"/>
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="cover-img" href="cover.svg" media-type="image/svg+xml"/>
<item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
<item id="c2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
<item id="c3" href="ch3.xhtml" media-type="application/xhtml+xml"/>
</manifest>
<spine>
<itemref idref="c1"/><itemref idref="c2"/><itemref idref="c3"/>
</spine>
</package>`

const container = `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`

const encoder = new TextEncoder()
const file = (s) => encoder.encode(s)

export function buildSampleEpub() {
  return zipSync({
    'mimetype': [file('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': file(container),
    'OEBPS/content.opf': file(opf),
    'OEBPS/nav.xhtml': file(nav),
    'OEBPS/cover.svg': file(coverSvg),
    'OEBPS/ch1.xhtml': file(chapters[0]),
    'OEBPS/ch2.xhtml': file(chapters[1]),
    'OEBPS/ch3.xhtml': file(chapters[2]),
  }, { level: 6 })
}
