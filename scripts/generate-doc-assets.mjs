// Generates the documentation artwork in docs/assets: cover, docs banner, diagrams and icons.
//
//   node scripts/generate-doc-assets.mjs [previewDir]
//
// SVGs are written by plain string templates (no dependencies). cover.png and banner.png are rendered with
// sharp when it can be found (it is installed transitively by Next.js); otherwise the PNG step is skipped.
// Pass a preview directory to also get PNG previews of every diagram plus an icon contact sheet.
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const PREVIEW = process.argv[2];
const OUT = join(REPO, 'docs/assets');
mkdirSync(join(OUT, 'icons'), { recursive: true });

function loadSharp() {
  const require = createRequire(join(REPO, 'package.json'));
  try {
    return require('sharp');
  } catch {
    const store = join(REPO, 'node_modules/.pnpm');
    const dir = existsSync(store) ? readdirSync(store).find((d) => d.startsWith('sharp@')) : undefined;
    return dir ? require(join(store, dir, 'node_modules/sharp')) : null;
  }
}

// ------------------------------------------------------------------ palette & fonts
const C = {
  bg0: '#0a1222',
  bg1: '#112448',
  card: '#14223f',
  card2: '#1a2b4d',
  border: '#2a3f69',
  line: '#4a6aa5',
  brand: '#2f5fb8',
  brandHi: '#4c82e3',
  sky: '#8fb8ff',
  text: '#f3f7ff',
  muted: '#a9b8d5',
  dim: '#7083a8',
  green: '#3cc58f',
  amber: '#f0b44c',
  orange: '#f08a4b',
  red: '#ef5d5d',
  teal: '#2fc0b0',
  violet: '#9b7cf2',
};
const FONT_BRAND = "Lato, 'Ubuntu Sans', 'Segoe UI', Helvetica, Arial, sans-serif";
const FONT_UI = "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif";

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ------------------------------------------------------------------ icons (24px grid, stroked)
const ICONS = {
  cloud: ['M7 18.5a4.5 4.5 0 0 1-.6-8.96 6 6 0 0 1 11.7 1.46 3.75 3.75 0 0 1-.6 7.5Z'],
  link: [
    'M10 13.5a4.5 4.5 0 0 0 6.4.4l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.6 1.6',
    'M14 10.5a4.5 4.5 0 0 0-6.4-.4l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.6-1.6',
  ],
  search: ['circle:11,11,7', 'M16.2 16.2 21 21'],
  alert: [
    'M10.3 4.2 2.6 17.5a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z',
    'M12 9.5v4',
    'M12 17h.01',
  ],
  dollar: [
    'circle:12,12,9',
    'M14.8 9.2c-.5-.9-1.5-1.4-2.8-1.4-1.6 0-2.8.8-2.8 2 0 2.8 5.8 1.5 5.8 4.4 0 1.2-1.2 2-2.9 2-1.4 0-2.5-.6-3-1.6',
    'M12 6.2v1.6',
    'M12 16.2v1.6',
  ],
  clipboard: [
    'M9 4.5H7a2 2 0 0 0-2 2V19a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6.5a2 2 0 0 0-2-2h-2',
    'rect:9,3,6,3,1',
    'm9 13.5 2 2 4-4.5',
  ],
  bell: ['M6 9.5a6 6 0 0 1 12 0c0 5.5 2.5 7.5 2.5 7.5h-17S6 15 6 9.5Z', 'M10.2 20.5a2 2 0 0 0 3.6 0'],
  shield: ['M12 2.8 4.5 5.6v5.9c0 4.7 3.2 8.4 7.5 9.7 4.3-1.3 7.5-5 7.5-9.7V5.6Z', 'm8.8 12 2.3 2.3 4.2-4.6'],
  chart: ['M3.5 20.5h17', 'M7 16.5v-4', 'M12 16.5V7', 'M17 16.5v-6.5'],
  server: [
    'rect:3.5,4,17,7,2',
    'rect:3.5,13,17,7,2',
    'M7.5 7.5h.01',
    'M7.5 16.5h.01',
    'M11 7.5h5.5',
    'M11 16.5h5.5',
  ],
  calendar: ['rect:3.5,5,17,15.5,2', 'M3.5 10h17', 'M8 3v4', 'M16 3v4'],
  file: ['M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z', 'M14 3v5h5', 'M9 13h6', 'M9 17h4'],
  users: [
    'circle:9,8,3.5',
    'M3 20c.7-3.3 3.1-5.5 6-5.5s5.3 2.2 6 5.5',
    'M15.5 4.7a3.5 3.5 0 0 1 0 6.6',
    'M17.6 14.8c1.7.8 2.9 2.6 3.4 5.2',
  ],
  layers: ['M12 3.5 3 8l9 4.5L21 8Z', 'm3 12 9 4.5 9-4.5', 'm3 16 9 4.5 9-4.5'],
  upload: [
    'M7 18.5a4.5 4.5 0 0 1-.6-8.96 6 6 0 0 1 11.7 1.46 3.75 3.75 0 0 1-.6 7.5',
    'M12 12.5v8',
    'm9 15.5 3-3 3 3',
  ],
  terminal: ['rect:3,4,18,16,2', 'm7 9.5 3 2.5-3 2.5', 'M13 15h4'],
  book: ['M4.5 5a2 2 0 0 1 2-2h13v14h-13a2 2 0 0 0-2 2Z', 'M4.5 19a2 2 0 0 0 2 2h13v-4', 'M9 7.5h6.5'],
  braces: [
    'M8 4C6 4 5.5 5 5.5 7v2.2c0 1.4-.8 2.3-2 2.8 1.2.5 2 1.4 2 2.8V17c0 2 .5 3 2.5 3',
    'M16 4c2 0 2.5 1 2.5 3v2.2c0 1.4.8 2.3 2 2.8-1.2.5-2 1.4-2 2.8V17c0 2-.5 3-2.5 3',
  ],
  key: ['circle:8,15.5,4.5', 'M11.3 12.3 20 3.5', 'M16.5 7l2.8 2.8', 'M14.3 9.3l2 2'],
  flag: ['M5.5 21V4', 'M5.5 4.5h11.5l-2.3 4 2.3 4H5.5'],
  folder: ['M3.5 6.5a2 2 0 0 1 2-2h3.8l2.2 2.5h7a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z'],
  tag: [
    'M3.5 12.2V5A1.5 1.5 0 0 1 5 3.5h7.2l8.8 8.8a1.5 1.5 0 0 1 0 2.1l-6.9 6.9a1.5 1.5 0 0 1-2.1 0Z',
    'circle:8,8,1.6',
  ],
  dashboard: [
    'rect:3.5,3.5,7.5,8,1.5',
    'rect:13,3.5,7.5,5,1.5',
    'rect:13,10.5,7.5,10,1.5',
    'rect:3.5,13.5,7.5,7,1.5',
  ],
  check: ['circle:12,12,9', 'm8.3 12.2 2.6 2.6 4.8-5.3'],
  box: ['M12 2.8 3.8 7.2v9.6l8.2 4.4 8.2-4.4V7.2Z', 'M3.8 7.2 12 11.6l8.2-4.4', 'M12 11.6v9.6'],
  workflow: ['rect:3,3.5,7,6,1.5', 'rect:14,14.5,7,6,1.5', 'M10 6.5h4.5a3 3 0 0 1 3 3v5'],
  globe: [
    'circle:12,12,9',
    'M3 12h18',
    'M12 3c2.5 2.6 3.7 5.6 3.7 9s-1.2 6.4-3.7 9c-2.5-2.6-3.7-5.6-3.7-9S9.5 5.6 12 3Z',
  ],
  database: [
    'ellipse:12,5.5,7.5,2.5',
    'M4.5 5.5v13c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5v-13',
    'M4.5 12c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5',
  ],
  bucket: ['M4 6.5h16l-1.8 12.7A2 2 0 0 1 16.2 21H7.8a2 2 0 0 1-2-1.8Z', 'ellipse:12,6.5,8,2.3'],
  lock: ['rect:4.5,10.5,15,10,2', 'M8 10.5V7.5a4 4 0 0 1 8 0v3'],
  lambda: ['M6.5 3.5h2.3a1.5 1.5 0 0 1 1.4 1L16 19.5a1.5 1.5 0 0 0 1.4 1H19', 'M11.6 9.6 5.5 20.5'],
  clock: ['circle:12,12,9', 'M12 7v5l3.2 2'],
  mail: ['rect:3,5,18,14,2', 'm3.5 6.5 8.5 6.5 8.5-6.5'],
  activity: ['M3 12h4l3-7 4 14 3-7h4'],
  eye: ['M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z', 'circle:12,12,3'],
  sliders: [
    'M4 6h9',
    'M17 6h3',
    'circle:15,6,2',
    'M4 12h3',
    'M11 12h9',
    'circle:9,12,2',
    'M4 18h11',
    'M19 18h1',
    'circle:17,18,2',
  ],
  history: ['M3.5 12a8.5 8.5 0 1 0 2.5-6', 'M3.5 4v4.5H8', 'M12 7.5V12l3 2'],
};

function shapes(name) {
  const list = ICONS[name];
  if (!list) throw new Error(`unknown icon ${name}`);
  return list
    .map((s) => {
      if (s.startsWith('circle:')) {
        const [cx, cy, r] = s.slice(7).split(',');
        return `<circle cx="${cx}" cy="${cy}" r="${r}"/>`;
      }
      if (s.startsWith('ellipse:')) {
        const [cx, cy, rx, ry] = s.slice(8).split(',');
        return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}"/>`;
      }
      if (s.startsWith('rect:')) {
        const [x, y, w, h, rx] = s.slice(5).split(',');
        return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}"/>`;
      }
      return `<path d="${s}"/>`;
    })
    .join('');
}

/** Stroked icon drawn into a box of `size` px at (x, y). */
function glyph(name, x, y, size, color = '#fff', sw = 2) {
  const s = size / 24;
  return `<g transform="translate(${x} ${y}) scale(${s})" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${shapes(name)}</g>`;
}

/** Brand tile with a white glyph (like the app icon). */
function tile(name, x, y, size, fill = 'url(#brandGrad)') {
  const r = size * 0.25;
  const pad = size * 0.22;
  return `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${r}" fill="${fill}"/>${glyph(name, x + pad, y + pad, size - 2 * pad, '#fff', 2.1)}`;
}

/** The CloudSentry logo mark (cloud + check), from apps/web/src/app/icon.svg. */
function logo(x, y, size) {
  const s = size / 32;
  return `<g transform="translate(${x} ${y}) scale(${s})"><rect width="32" height="32" rx="7" fill="url(#brandGrad)"/><path d="M10.5 21.5h11a4.5 4.5 0 0 0 .6-8.96A6 6 0 0 0 10.6 14a3.75 3.75 0 0 0-.1 7.5Z" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"/><path d="m13.5 17.5 2 2 3.5-4" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></g>`;
}

const brandGrad = `<linearGradient id="brandGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${C.brandHi}"/><stop offset="1" stop-color="${C.brand}"/></linearGradient>`;

function bgDefs() {
  return `
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${C.bg0}"/><stop offset="1" stop-color="${C.bg1}"/></linearGradient>
  <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${C.brandHi}" stop-opacity="0.55"/><stop offset="1" stop-color="${C.brandHi}" stop-opacity="0"/></radialGradient>
  <radialGradient id="glow2" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${C.teal}" stop-opacity="0.22"/><stop offset="1" stop-color="${C.teal}" stop-opacity="0"/></radialGradient>
  <pattern id="dots" width="28" height="28" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.1" fill="#ffffff" fill-opacity="0.07"/></pattern>
  <filter id="shadow" x="-20%" y="-20%" width="140%" height="150%"><feGaussianBlur in="SourceAlpha" stdDeviation="14"/><feOffset dy="12" result="b"/><feComponentTransfer><feFuncA type="linear" slope="0.45"/></feComponentTransfer><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  <marker id="arrow" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 10 5 0 10Z" fill="${C.line}"/></marker>
  ${brandGrad}`;
}

const svgOpen = (w, h, title, desc) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="t d"><title id="t">${esc(title)}</title><desc id="d">${esc(desc)}</desc>`;

// ------------------------------------------------------------------ cover (1280x640)
function cover() {
  const W = 1280;
  const H = 640;
  const t = (x, y, size, text, opts = {}) =>
    `<text x="${x}" y="${y}" font-family="${FONT_BRAND}" font-size="${size}" font-weight="${opts.weight ?? 400}" fill="${opts.fill ?? C.text}"${opts.anchor ? ` text-anchor="${opts.anchor}"` : ''}${opts.ls ? ` letter-spacing="${opts.ls}"` : ''}>${esc(text)}</text>`;

  const chips = [
    ['eye', 'Read-only access'],
    ['server', '15 AWS services'],
    ['search', '27 detection rules'],
    ['dollar', 'Priced with AWS list prices'],
  ]
    .map(([icon, label], i) => {
      const x = 88 + (i % 2) * 300;
      const y = 418 + Math.floor(i / 2) * 64;
      return `<g><rect x="${x}" y="${y}" width="284" height="48" rx="24" fill="#ffffff" fill-opacity="0.06" stroke="${C.border}"/>${glyph(icon, x + 16, y + 12, 24, C.sky, 2)}${t(x + 52, y + 31, 19, label, { fill: '#dbe6fb', weight: 600 })}</g>`;
    })
    .join('');

  const rows = [
    ['HIGH', C.orange, 'EC2 instance idle', 'Stop or downsize', 0.92],
    ['MEDIUM', C.amber, 'EBS volume unattached', 'Snapshot, then delete', 0.6],
    ['MEDIUM', C.amber, 'Elastic IP unused', 'Release the address', 0.38],
    ['LOW', C.sky, 'Lambda on x86_64', 'Switch to arm64', 0.22],
  ];
  const cx = 772;
  const cy = 76;
  const cw = 436;
  const rowEls = rows
    .map(([sev, color, title, action, frac], i) => {
      const y = cy + 104 + i * 70;
      const barW = 84;
      return `<g>
        ${i > 0 ? `<line x1="${cx + 24}" y1="${y - 10}" x2="${cx + cw - 24}" y2="${y - 10}" stroke="${C.border}" stroke-opacity="0.7"/>` : ''}
        <rect x="${cx + 24}" y="${y + 6}" width="78" height="24" rx="12" fill="${color}" fill-opacity="0.16"/>
        ${t(cx + 63, y + 23, 12.5, sev, { fill: color, weight: 800, anchor: 'middle', ls: 0.8 })}
        ${t(cx + 116, y + 22, 18, title, { weight: 700 })}
        ${t(cx + 116, y + 46, 15, action, { fill: C.muted })}
        <rect x="${cx + cw - 24 - barW}" y="${y + 13}" width="${barW}" height="10" rx="5" fill="#ffffff" fill-opacity="0.07"/>
        <rect x="${cx + cw - 24 - barW}" y="${y + 13}" width="${(barW * frac).toFixed(1)}" height="10" rx="5" fill="${C.green}"/>
      </g>`;
    })
    .join('');

  // Daily billed cost sparkline (illustrative shape, no figures).
  const pts = [27, 29, 26, 31, 30, 35, 34, 38, 42, 40, 45, 48, 47, 52, 55, 54, 58, 61, 60, 63];
  const sx = cx + 24;
  const sw = cw - 48;
  const sy = cy + 418;
  const step = sw / (pts.length - 1);
  const line = pts.map((p, i) => `${(sx + i * step).toFixed(1)},${(sy + p).toFixed(1)}`).join(' ');
  const area = `M${sx},${sy + 76} L${line.replace(/ /g, ' L')} L${sx + sw},${sy + 76}Z`;

  return `${svgOpen(W, H, 'CloudSentry', 'CloudSentry: find cloud waste, understand the impact, optimize with confidence. Read-only AWS cost optimization.')}
<defs>${bgDefs()}
  <linearGradient id="spark" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.brandHi}" stop-opacity="0.45"/><stop offset="1" stop-color="${C.brandHi}" stop-opacity="0"/></linearGradient>
</defs>
<rect width="${W}" height="${H}" fill="url(#bg)"/>
<rect width="${W}" height="${H}" fill="url(#dots)"/>
<circle cx="1030" cy="150" r="520" fill="url(#glow)"/>
<circle cx="140" cy="640" r="420" fill="url(#glow2)"/>

${logo(88, 122, 88)}
${t(198, 194, 78, 'CloudSentry', { weight: 900, ls: -1 })}
${t(90, 286, 34, 'Find cloud waste. Understand the impact.', { weight: 700, fill: '#e6eefc' })}
${t(90, 332, 34, 'Optimize with confidence.', { weight: 700, fill: C.sky })}
${t(90, 378, 20, 'Read-only cost optimization for AWS accounts.', { fill: C.muted })}
${chips}
${t(90, 588, 17, 'Serverless on AWS  ·  TypeScript  ·  AWS CDK', { fill: C.dim, weight: 600, ls: 0.5 })}

<g filter="url(#shadow)">
  <rect x="${cx}" y="${cy}" width="${cw}" height="500" rx="22" fill="${C.card}" fill-opacity="0.94" stroke="${C.border}"/>
</g>
${t(cx + 24, cy + 46, 21, 'Top opportunities', { weight: 800 })}
${t(cx + 24, cy + 72, 15, 'Latest scan · estimates use AWS list prices', { fill: C.muted })}
<rect x="${cx + cw - 132}" y="${cy + 26}" width="108" height="28" rx="14" fill="${C.green}" fill-opacity="0.16"/>
<circle cx="${cx + cw - 114}" cy="${cy + 40}" r="4.5" fill="${C.green}"/>
${t(cx + cw - 102, cy + 45.5, 14, 'Completed', { fill: C.green, weight: 700 })}
${rowEls}
<line x1="${cx + 24}" y1="${cy + 384}" x2="${cx + cw - 24}" y2="${cy + 384}" stroke="${C.border}"/>
${t(cx + 24, cy + 412, 15, 'Daily billed cost', { fill: C.muted, weight: 700 })}
${t(cx + cw - 24, cy + 412, 15, 'Cost Explorer', { fill: C.dim, anchor: 'end' })}
<path d="${area}" fill="url(#spark)"/>
<polyline points="${line}" fill="none" stroke="${C.sky}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
</svg>`;
}

// ------------------------------------------------------------------ docs banner (1280x200)
function banner() {
  const W = 1280;
  const H = 200;
  const t = (x, y, size, text, opts = {}) =>
    `<text x="${x}" y="${y}" font-family="${FONT_BRAND}" font-size="${size}" font-weight="${opts.weight ?? 400}" fill="${opts.fill ?? C.text}"${opts.anchor ? ` text-anchor="${opts.anchor}"` : ''}${opts.ls ? ` letter-spacing="${opts.ls}"` : ''}>${esc(text)}</text>`;
  const deco = ['search', 'activity', 'alert', 'dollar', 'shield']
    .map((n, i) => tile(n, 900 + i * 68, 72, 52, i % 2 ? C.card2 : 'url(#brandGrad)'))
    .join('');
  return `${svgOpen(W, H, 'CloudSentry documentation', 'CloudSentry documentation banner')}
<defs>${bgDefs()}</defs>
<rect width="${W}" height="${H}" fill="url(#bg)"/>
<rect width="${W}" height="${H}" fill="url(#dots)"/>
<circle cx="1100" cy="40" r="360" fill="url(#glow)"/>
${logo(60, 52, 96)}
${t(180, 112, 58, 'CloudSentry', { weight: 900, ls: -0.5 })}
${t(183, 150, 22, 'Documentation  ·  Find cloud waste. Optimize with confidence.', { fill: C.muted, weight: 600 })}
${deco}
</svg>`;
}

// ------------------------------------------------------------------ shared diagram helpers
const ui = (x, y, size, text, opts = {}) =>
  `<text x="${x}" y="${y}" font-family="${FONT_UI}" font-size="${size}" font-weight="${opts.weight ?? 400}" fill="${opts.fill ?? C.text}"${opts.anchor ? ` text-anchor="${opts.anchor}"` : ''}${opts.rotate ? ` transform="rotate(${opts.rotate} ${x} ${y})"` : ''}>${esc(text)}</text>`;

function node(x, y, w, h, icon, title, sub, fill) {
  const ts = 40;
  return `<g><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" fill="${C.card2}" stroke="${C.border}"/>${tile(icon, x + 14, y + (h - ts) / 2, ts, fill)}${ui(x + 66, y + h / 2 - 3, 17, title, { weight: 700 })}${ui(x + 66, y + h / 2 + 18, 14.5, sub, { fill: C.muted })}</g>`;
}

const arrow = (d, dashed = false) =>
  `<path d="${d}" fill="none" stroke="${C.line}" stroke-width="2.2"${dashed ? ' stroke-dasharray="6 6"' : ''} marker-end="url(#arrow)"/>`;

const container = (x, y, w, h, label, color = C.border) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="18" fill="#ffffff" fill-opacity="0.025" stroke="${color}" stroke-dasharray="7 6"/>${ui(x + 20, y + 26, 13.5, label.toUpperCase(), { fill: C.dim, weight: 700 })}`;

// ------------------------------------------------------------------ how it works (1200x240)
function howItWorks() {
  const W = 1200;
  const H = 240;
  const steps = [
    ['link', 'Connect', 'Read-only role'],
    ['search', 'Scan', 'Resources & usage'],
    ['alert', 'Detect', 'Transparent rules'],
    ['dollar', 'Estimate', 'AWS list prices'],
    ['clipboard', 'Review', 'Accept or dismiss'],
    ['bell', 'Stay informed', 'Alerts & reports'],
  ];
  const cy = 88;
  const els = steps
    .map(([icon, title, sub], i) => {
      const cx = 100 + i * 200;
      const conn =
        i < steps.length - 1
          ? `<path d="M${cx + 54} ${cy}H${cx + 146}" fill="none" stroke="${C.line}" stroke-width="2.2" stroke-dasharray="6 6" marker-end="url(#arrow)"/>`
          : '';
      return `${conn}<circle cx="${cx}" cy="${cy}" r="42" fill="url(#brandGrad)"/><circle cx="${cx}" cy="${cy}" r="42" fill="none" stroke="#ffffff" stroke-opacity="0.18"/>${glyph(icon, cx - 17, cy - 17, 34, '#fff', 2)}<circle cx="${cx + 32}" cy="${cy - 32}" r="14" fill="${C.text}"/>${ui(cx + 32, cy - 26.5, 15, String(i + 1), { fill: C.brand, weight: 800, anchor: 'middle' })}${ui(cx, 172, 21, title, { weight: 700, anchor: 'middle' })}${ui(cx, 200, 16, sub, { fill: C.muted, anchor: 'middle' })}`;
    })
    .join('');
  return `${svgOpen(W, H, 'How CloudSentry works', 'Six steps: connect a read-only role, scan resources and usage, detect waste with transparent rules, estimate savings with AWS list prices, review recommendations, stay informed with alerts and reports.')}
<defs>${bgDefs()}</defs>
<rect width="${W}" height="${H}" rx="20" fill="url(#bg)"/>
<rect width="${W}" height="${H}" rx="20" fill="url(#dots)"/>
${els}
</svg>`;
}

// ------------------------------------------------------------------ architecture (1280x740)
function architecture() {
  const W = 1280;
  const H = 740;
  const c1 = 230;
  const c2 = 462;
  const c3 = 694;
  const cw = 196;
  const c3w = 212;
  const rh = 76;
  const r = [168, 272, 376, 480, 584];
  const mid = (i) => r[i] + rh / 2;

  const els = [];
  els.push(container(206, 118, 724, 598, 'CloudSentry platform account'));
  els.push(container(994, 118, 264, 598, 'Customer AWS account', '#3d6b5c'));

  // Browser
  els.push(node(24, r[0], 158, rh, 'users', 'Browser', 'Your team'));
  els.push(arrow(`M182 ${mid(0)}H226`));

  // Row 1
  els.push(node(c1, r[0], cw, rh, 'globe', 'CloudFront', 'CDN and HTTPS'));
  els.push(node(c2, r[0], cw, rh, 'dashboard', 'Dashboard', 'Static site on S3'));
  els.push(node(c3, r[0], c3w, rh, 'activity', 'CloudWatch', 'Logs and alarms', C.card));
  els.push(arrow(`M${c1 + cw} ${mid(0)}H${c2 - 4}`));
  els.push(ui(c1 + cw + 18, mid(0) - 10, 15, '/', { fill: C.sky, weight: 700, anchor: 'middle' }));

  // Row 2
  els.push(arrow(`M${c1 + 98} ${r[0] + rh}V${r[1] - 4}`));
  els.push(ui(c1 + 110, r[1] - 9, 14.5, '/api/v1/*', { fill: C.sky, weight: 700 }));
  els.push(node(c1, r[1], cw, rh, 'braces', 'API Gateway', 'HTTP API'));
  els.push(node(c2, r[1], cw, rh, 'lock', 'Cognito', 'Sign-in and JWTs'));
  els.push(arrow(`M${c1 + cw} ${mid(1)}H${c2 - 4}`));

  // Row 3
  els.push(arrow(`M${c1 + 98} ${r[1] + rh}V${r[2] - 4}`));
  els.push(node(c1, r[2], cw, rh, 'lambda', 'API functions', 'Lambda per area'));
  const dw = c3 + c3w - c2;
  els.push(
    `<g><rect x="${c2}" y="${r[2]}" width="${dw}" height="${rh}" rx="14" fill="${C.card2}" stroke="${C.border}"/>` +
      `${tile('database', c2 + 14, r[2] + 18, 40)}${ui(c2 + 66, mid(2) - 3, 17, 'DynamoDB', { weight: 700 })}${ui(c2 + 66, mid(2) + 18, 14.5, 'Application data', { fill: C.muted })}` +
      `<line x1="${c2 + dw / 2}" y1="${r[2] + 14}" x2="${c2 + dw / 2}" y2="${r[2] + rh - 14}" stroke="${C.border}"/>` +
      `${tile('bucket', c2 + dw / 2 + 14, r[2] + 18, 40)}${ui(c2 + dw / 2 + 66, mid(2) - 3, 17, 'Amazon S3', { weight: 700 })}${ui(c2 + dw / 2 + 66, mid(2) + 18, 14.5, 'Artifacts, reports', { fill: C.muted })}</g>`,
  );
  els.push(arrow(`M${c1 + cw} ${mid(2)}H${c2 - 4}`));

  // Row 4
  els.push(arrow(`M${c1 + 98} ${r[2] + rh}V${r[4] - 4}`));
  els.push(ui(c1 + 110, mid(3) + 5, 14.5, 'start scan', { fill: C.sky, weight: 700 }));
  els.push(node(c2, r[3], cw, rh, 'clock', 'Scheduler', 'EventBridge'));
  els.push(arrow(`M${c2 + 98} ${r[3] + rh}V${r[4] - 4}`));
  els.push(node(c3, r[3], c3w, rh, 'mail', 'Email alerts', 'Amazon SNS'));
  els.push(arrow(`M${c3 + 106} ${r[4]}V${r[3] + rh + 4}`));
  // workflow -> data (results)
  els.push(arrow(`M${c2 + cw + 18} ${r[4]}V${r[2] + rh + 4}`));

  // Row 5: workflow
  const ww = c3 + c3w - c1;
  els.push(
    `<g><rect x="${c1}" y="${r[4]}" width="${ww}" height="104" rx="14" fill="${C.card2}" stroke="${C.brandHi}" stroke-opacity="0.8"/>` +
      `${tile('workflow', c1 + 16, r[4] + 26, 52)}` +
      `${ui(c1 + 84, r[4] + 36, 19, 'Scan workflow  ·  AWS Step Functions', { weight: 700 })}` +
      `${ui(c1 + 84, r[4] + 62, 15.5, 'Discover → measure → detect → price → save → notify', { fill: C.sky, weight: 600 })}` +
      `${ui(c1 + 84, r[4] + 86, 14.5, '16 parallel discovery workers · 27 rules · AWS Price List API', { fill: C.muted })}</g>`,
  );

  // Customer account
  const kx = 1014;
  const kw = 224;
  els.push(node(kx, r[1], kw, rh, 'shield', 'Read-only role', 'IAM + External ID', 'url(#greenGrad)'));
  els.push(node(kx, r[2], kw, rh, 'server', 'Resources', 'EC2, RDS, EKS, …', C.card));
  els.push(node(kx, r[3], kw, rh, 'activity', 'CloudWatch', 'Usage metrics', C.card));
  els.push(node(kx, r[4], kw, rh, 'dollar', 'Cost Explorer', 'Billed spend', C.card));
  // bus from role
  els.push(
    `<path d="M${kx} ${mid(1)}H${kx - 12}V${mid(4)}" fill="none" stroke="${C.line}" stroke-width="2.2"/>`,
  );
  for (const i of [2, 3, 4]) els.push(arrow(`M${kx - 12} ${mid(i)}H${kx - 4}`));
  // workflow -> role (AssumeRole)
  els.push(arrow(`M${c1 + ww} ${r[4] + 52}H962V${r[1] - 22}H${kx + kw / 2}V${r[1] - 4}`));
  els.push(
    ui(950, 470, 14.5, 'STS AssumeRole · read-only', {
      fill: C.sky,
      weight: 700,
      anchor: 'middle',
      rotate: -90,
    }),
  );

  return `${svgOpen(W, H, 'CloudSentry architecture', 'Serverless architecture: CloudFront serves the static dashboard from S3 and routes /api/v1 to API Gateway with Cognito JWTs; per-area Lambda functions use DynamoDB and S3; manual or scheduled scans run a Step Functions workflow that assumes a read-only role in the customer account to read resources, CloudWatch metrics and Cost Explorer spend, then saves results and sends email alerts through SNS.')}
<defs>${bgDefs()}
  <linearGradient id="greenGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3fbf8a"/><stop offset="1" stop-color="#23855f"/></linearGradient>
</defs>
<rect width="${W}" height="${H}" rx="20" fill="url(#bg)"/>
<rect width="${W}" height="${H}" rx="20" fill="url(#dots)"/>
${ui(28, 56, 26, 'How CloudSentry is built', { weight: 800 })}
${ui(28, 86, 16, 'Fully serverless. Read-only towards customer accounts. Costs almost nothing when idle.', { fill: C.muted })}
${els.join('\n')}
</svg>`;
}

// ------------------------------------------------------------------ scan workflow (1200x690)
function scanWorkflow() {
  const W = 1280;
  const H = 690;
  const bw = 270;
  const bh = 96;
  const xs = [52, 354, 656, 958];
  const ys = [132, 292, 452];
  const steps = [
    ['Validate account', 'Check account, lock scan'],
    ['Assume role', 'Temporary, read-only'],
    ['Discover resources', '16 parallel workers', 'stack'],
    ['Usage metrics', 'CloudWatch, last 30 days', 'soft'],
    ['AWS costs', 'Cost Explorer spend', 'soft'],
    ['Normalize', 'Common resource model'],
    ['Detection rules', '27 transparent rules'],
    ['Recommendations', 'Action, risk, confidence'],
    ['Estimate savings', 'AWS Price List API'],
    ['Persist results', 'Findings and history'],
    ['Scan summary', 'Marks the scan complete'],
    ['Notifications', 'Email through SNS', 'soft'],
  ];
  const els = [];
  steps.forEach(([title, sub, kind], i) => {
    const row = Math.floor(i / 4);
    const col = i % 4;
    const x = xs[col];
    const y = ys[row];
    if (kind === 'stack') {
      els.push(
        `<rect x="${x + 12}" y="${y + 12}" width="${bw}" height="${bh}" rx="14" fill="${C.card}" stroke="${C.border}"/>`,
      );
      els.push(
        `<rect x="${x + 6}" y="${y + 6}" width="${bw}" height="${bh}" rx="14" fill="${C.card}" stroke="${C.border}"/>`,
      );
    }
    els.push(
      `<rect x="${x}" y="${y}" width="${bw}" height="${bh}" rx="14" fill="${C.card2}" stroke="${kind === 'soft' ? C.amber : C.border}"${kind === 'soft' ? ' stroke-opacity="0.75"' : ''}/>`,
    );
    els.push(`<circle cx="${x + 30}" cy="${y + 34}" r="15" fill="url(#brandGrad)"/>`);
    els.push(ui(x + 30, y + 39.5, 14, String(i + 1), { weight: 800, anchor: 'middle' }));
    els.push(ui(x + 56, y + 40, 18, title, { weight: 700 }));
    els.push(ui(x + 56, y + 66, 14.5, sub, { fill: C.muted }));
    if (kind === 'stack') {
      els.push(
        `<rect x="${x + bw - 58}" y="${y + bh - 30}" width="46" height="22" rx="11" fill="${C.brandHi}" fill-opacity="0.2"/>`,
      );
      els.push(ui(x + bw - 35, y + bh - 14.5, 13, '×16', { fill: C.sky, weight: 800, anchor: 'middle' }));
    }
    if (kind === 'soft') {
      els.push(`<circle cx="${x + bw - 20}" cy="${y + bh - 20}" r="6" fill="${C.amber}"/>`);
    }
    // connectors
    if (i < steps.length - 1) {
      if (col < 3) {
        const extra = kind === 'stack' ? 12 : 0;
        els.push(arrow(`M${x + bw + extra} ${y + bh / 2}H${xs[col + 1] - 4}`));
      } else {
        const ny = ys[row + 1];
        const midY = y + bh + (ny - y - bh) / 2;
        els.push(arrow(`M${x + bw / 2} ${y + bh}V${midY}H${xs[0] + bw / 2}V${ny - 4}`));
      }
    }
  });

  const ly = 600;
  return `${svgOpen(W, H, 'CloudSentry scan workflow', 'Twelve steps run by AWS Step Functions: validate account, assume the read-only role, discover resources with 16 parallel workers, collect CloudWatch metrics, read AWS costs, normalize, run detection rules, generate recommendations, estimate savings, persist results, write the scan summary and send notifications. Metrics, costs and notifications never fail a scan; any unexpected error marks the scan failed.')}
<defs>${bgDefs()}</defs>
<rect width="${W}" height="${H}" rx="20" fill="url(#bg)"/>
<rect width="${W}" height="${H}" rx="20" fill="url(#dots)"/>
${ui(52, 58, 26, 'Scan workflow', { weight: 800 })}
${ui(52, 88, 16, 'AWS Step Functions (Standard). State stays small; every step writes its output to S3.', { fill: C.muted })}
${els.join('\n')}
<line x1="52" y1="${ly - 16}" x2="1228" y2="${ly - 16}" stroke="${C.border}"/>
<circle cx="64" cy="${ly + 14}" r="6" fill="${C.amber}"/>
${ui(80, ly + 19, 15, 'Never fails the scan: continues without that data', { fill: C.muted })}
<rect x="640" y="${ly}" width="588" height="56" rx="12" fill="${C.red}" fill-opacity="0.08" stroke="${C.red}" stroke-opacity="0.6" stroke-dasharray="6 5"/>
${glyph('alert', 656, ly + 16, 24, C.red, 2)}
${ui(692, ly + 24, 15, 'Any unexpected error → Mark scan failed', { weight: 700 })}
${ui(692, ly + 44, 14, 'Releases the account lock and sends a failure alert', { fill: C.muted })}
</svg>`;
}

// ------------------------------------------------------------------ icon files (48x48 tiles)
function iconFile(name) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48" role="img" aria-label="${name}"><defs>${brandGrad}</defs><rect width="48" height="48" rx="12" fill="url(#brandGrad)"/>${glyph(name, 12, 12, 24, '#fff', 2.1)}</svg>\n`;
}

// ------------------------------------------------------------------ write + render
const files = {
  'cover.svg': cover(),
  'banner.svg': banner(),
  'how-it-works.svg': howItWorks(),
  'architecture.svg': architecture(),
  'scan-workflow.svg': scanWorkflow(),
};
for (const [name, svg] of Object.entries(files)) writeFileSync(join(OUT, name), svg.trim() + '\n');
for (const name of Object.keys(ICONS)) writeFileSync(join(OUT, 'icons', `${name}.svg`), iconFile(name));

// PNG renders: cover + banner are committed (fixed fonts; cover.png doubles as the social preview image).
const sharp = loadSharp();
if (!sharp) {
  console.warn('sharp not found: SVGs written, PNGs skipped. Render cover.svg / banner.svg to PNG manually.');
} else {
  await sharp(Buffer.from(files['cover.svg'])).png({ compressionLevel: 9 }).toFile(join(OUT, 'cover.png'));
  await sharp(Buffer.from(files['banner.svg']), { density: 144 })
    .resize(1280 * 2, 200 * 2)
    .png({ compressionLevel: 9 })
    .toFile(join(OUT, 'banner.png'));
  if (PREVIEW) {
    mkdirSync(PREVIEW, { recursive: true });
    for (const name of ['cover', 'banner', 'how-it-works', 'architecture', 'scan-workflow']) {
      await sharp(Buffer.from(files[`${name}.svg`]))
        .png()
        .toFile(join(PREVIEW, `${name}.png`));
    }
    const names = Object.keys(ICONS);
    const sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="${names.length * 60}" height="60"><defs>${brandGrad}</defs><rect width="100%" height="100%" fill="#fff"/>${names.map((n, i) => tile(n, 6 + i * 60, 6, 48)).join('')}</svg>`;
    await sharp(Buffer.from(sheet)).png().toFile(join(PREVIEW, 'icons.png'));
  }
}
console.log(`docs/assets: ${Object.keys(files).length} images, ${Object.keys(ICONS).length} icons`);
