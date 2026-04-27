/**
 * Server-side HTML5 starter templates.
 *
 * Each template generates a small in-memory ZIP that the dashboard can save
 * as a brand-new content item. Templates are intentionally tiny and self-
 * contained — no build step, no external CDNs.
 */

import AdmZip from 'adm-zip';

export type TemplateId =
  | 'blank'
  | 'scrolling-text'
  | 'image-caption'
  | 'countdown-timer'
  | 'multi-zone-rotate';

export const TEMPLATE_LIST: Array<{ id: TemplateId; name: string; description: string }> = [
  { id: 'blank',             name: 'Blank',              description: 'Empty index.html and style.css — start from scratch.' },
  { id: 'scrolling-text',    name: 'Scrolling Text',     description: 'Animated CSS marquee with a single editable message.' },
  { id: 'image-caption',     name: 'Image with Caption', description: 'Full-screen image with overlaid title.' },
  { id: 'countdown-timer',   name: 'Countdown Timer',    description: 'JavaScript countdown to a configurable target date.' },
  { id: 'multi-zone-rotate', name: 'Multi-Zone Rotate',  description: '3-zone CSS grid that auto-rotates through items.' },
];

const COMMON_CSS = `* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: 100%; height: 100%; overflow: hidden; font-family: system-ui, sans-serif; background: #000; color: #fff; }
`;

function blank() {
  return {
    'index.html': `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Blank</title><link rel="stylesheet" href="style.css"></head>
<body><main><h1>Edit me</h1></main></body></html>`,
    'style.css': COMMON_CSS + `main { display: flex; align-items: center; justify-content: center; height: 100%; }
h1 { font-size: 6vw; }`,
  };
}

function scrollingText() {
  return {
    'index.html': `<!doctype html>
<html><head><meta charset="utf-8"><title>Scrolling</title><link rel="stylesheet" href="style.css"></head>
<body><div class="marquee"><span id="msg">Replace this message in app.js or directly in index.html</span></div></body></html>`,
    'style.css': COMMON_CSS + `.marquee { position: absolute; top: 50%; transform: translateY(-50%); white-space: nowrap; animation: scroll 18s linear infinite; }
.marquee span { font-size: 8vw; font-weight: 700; color: #fff; padding: 0 5vw; }
@keyframes scroll { 0% { left: 100vw; } 100% { left: -100%; } }`,
  };
}

function imageCaption() {
  return {
    'index.html': `<!doctype html>
<html><head><meta charset="utf-8"><title>Image + Caption</title><link rel="stylesheet" href="style.css"></head>
<body>
  <div class="bg"></div>
  <div class="caption">
    <h1>Your Headline</h1>
    <p>Supporting line of text underneath</p>
  </div>
</body></html>`,
    'style.css': COMMON_CSS + `.bg { position: fixed; inset: 0; background: linear-gradient(135deg, #1e3a8a, #db2777); }
.caption { position: absolute; bottom: 8vh; left: 6vw; max-width: 60vw; }
.caption h1 { font-size: 7vw; line-height: 1.05; text-shadow: 0 2px 12px rgba(0,0,0,.5); }
.caption p  { font-size: 2.6vw; margin-top: 1vh; opacity: .9; }`,
  };
}

function countdownTimer() {
  return {
    'index.html': `<!doctype html>
<html><head><meta charset="utf-8"><title>Countdown</title><link rel="stylesheet" href="style.css"></head>
<body>
  <main>
    <h2 id="label">Doors Open In</h2>
    <div id="clock">--:--:--</div>
  </main>
  <script src="app.js"></script>
</body></html>`,
    'style.css': COMMON_CSS + `main { display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; }
h2 { font-size: 3vw; opacity: .7; letter-spacing: .12em; text-transform: uppercase; }
#clock { font-size: 16vw; font-weight: 800; font-variant-numeric: tabular-nums; margin-top: 2vh; }`,
    'app.js': `// Edit this date — ISO format
const TARGET = new Date('2026-12-31T18:00:00');
function tick() {
  const ms = Math.max(0, TARGET.getTime() - Date.now());
  const s = Math.floor(ms / 1000);
  const h = String(Math.floor(s / 3600)).padStart(2, '0');
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const x = String(s % 60).padStart(2, '0');
  document.getElementById('clock').textContent = h + ':' + m + ':' + x;
}
tick(); setInterval(tick, 1000);`,
  };
}

function multiZoneRotate() {
  return {
    'index.html': `<!doctype html>
<html><head><meta charset="utf-8"><title>Multi-Zone</title><link rel="stylesheet" href="style.css"></head>
<body>
  <div class="grid">
    <section class="zone hero" data-zone="0"></section>
    <section class="zone side" data-zone="1"></section>
    <section class="zone foot" data-zone="2"></section>
  </div>
  <script src="app.js"></script>
</body></html>`,
    'style.css': COMMON_CSS + `.grid { display: grid; grid-template-columns: 2fr 1fr; grid-template-rows: 3fr 1fr; height:100%; gap: 8px; padding: 8px; background: #111; }
.hero { grid-column: 1; grid-row: 1; background: #1e293b; }
.side { grid-column: 2; grid-row: 1; background: #312e81; }
.foot { grid-column: 1 / -1; grid-row: 2; background: #064e3b; }
.zone { display:flex; align-items:center; justify-content:center; font-size: 4vw; transition: opacity 0.5s; }`,
    'app.js': `// Items per zone — edit me
const ITEMS = [
  ['Welcome', 'Have a great day', 'Featured Item: Pizza 12.99'],
  ['News', 'Sports', 'Weather'],
  ['Open until 22:00', 'Free Wi-Fi', 'Follow @brand'],
];
const ROTATE_MS = 5000;
document.querySelectorAll('.zone').forEach((el, i) => {
  let idx = 0;
  function show() {
    el.style.opacity = 0;
    setTimeout(() => { el.textContent = ITEMS[i][idx]; el.style.opacity = 1; }, 250);
    idx = (idx + 1) % ITEMS[i].length;
  }
  show();
  setInterval(show, ROTATE_MS);
});`,
  };
}

const TEMPLATES: Record<TemplateId, () => Record<string, string>> = {
  'blank': blank,
  'scrolling-text': scrollingText,
  'image-caption': imageCaption,
  'countdown-timer': countdownTimer,
  'multi-zone-rotate': multiZoneRotate,
};

/**
 * Build a ZIP for the given template id. Returns a Buffer that can be written
 * to disk as a content item file.
 */
export function buildTemplateZip(id: TemplateId): Buffer {
  const factory = TEMPLATES[id];
  if (!factory) throw new Error(`Unknown template: ${id}`);
  const files = factory();
  const zip = new AdmZip();
  for (const [path, content] of Object.entries(files)) {
    zip.addFile(path, Buffer.from(content, 'utf8'));
  }
  return zip.toBuffer();
}
