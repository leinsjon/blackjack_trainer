// Vector casino chips: base color, six edge spots, an inlaid center with the
// denomination, and a gloss highlight. SVG keeps them crisp at any size.

const STYLES = {
  5: { base: '#c8102e', edge: '#ffffff', text: '#ffffff' },
  25: { base: '#0b7a3e', edge: '#ffffff', text: '#ffffff' },
  100: { base: '#18181b', edge: '#f5f5f4', accent: '#c8102e', text: '#ffffff' },
  500: { base: '#5b2a8f', edge: '#f4d35e', text: '#ffffff' },
  1000: { base: '#f0b323', edge: '#1c1917', text: '#1c1917' },
};

const NS = 'http://www.w3.org/2000/svg';
const R_SPOTS = 43;
const SPOT_ARC = (2 * Math.PI * R_SPOTS) / 6;

// Gradients shared by every chip, added to the page once.
function ensureDefs() {
  if (document.getElementById('chip-defs')) return;
  const svg = document.createElementNS(NS, 'svg');
  svg.id = 'chip-defs';
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.position = 'absolute';
  svg.innerHTML = `
    <defs>
      <radialGradient id="chip-rim" cx="50%" cy="50%" r="50%">
        <stop offset="78%" stop-color="#000" stop-opacity="0"/>
        <stop offset="100%" stop-color="#000" stop-opacity="0.35"/>
      </radialGradient>
      <radialGradient id="chip-face" cx="50%" cy="42%" r="60%">
        <stop offset="0%" stop-color="#fff" stop-opacity="0.22"/>
        <stop offset="100%" stop-color="#fff" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="chip-gloss" cx="32%" cy="24%" r="62%">
        <stop offset="0%" stop-color="#fff" stop-opacity="0.38"/>
        <stop offset="45%" stop-color="#fff" stop-opacity="0.08"/>
        <stop offset="100%" stop-color="#fff" stop-opacity="0"/>
      </radialGradient>
    </defs>`;
  document.body.prepend(svg);
}

export function chipSVG(value) {
  ensureDefs();
  const s = STYLES[value] ?? STYLES[5];
  const label = value >= 1000 ? `${value / 1000}K` : String(value);
  const size = label.length >= 3 ? 23 : 27;
  const spot = 15;
  // A thin stripe of a second color centered in each edge spot.
  const accent = s.accent
    ? `<circle cx="50" cy="50" r="${R_SPOTS}" fill="none" stroke="${s.accent}" stroke-width="11"
         stroke-dasharray="4 ${SPOT_ARC - 4}" stroke-dashoffset="${-(spot - 4) / 2}" transform="rotate(-7 50 50)"/>`
    : '';
  return `
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r="49" fill="${s.base}"/>
      <circle cx="50" cy="50" r="${R_SPOTS}" fill="none" stroke="${s.edge}" stroke-width="11"
        stroke-dasharray="${spot} ${SPOT_ARC - spot}" transform="rotate(-7 50 50)"/>
      ${accent}
      <circle cx="50" cy="50" r="49" fill="url(#chip-rim)"/>
      <circle cx="50" cy="50" r="36.5" fill="none" stroke="#000" stroke-opacity="0.35" stroke-width="1.5"/>
      <circle cx="50" cy="50" r="34" fill="${s.base}" stroke="${s.edge}" stroke-width="1.8"/>
      <circle cx="50" cy="50" r="30" fill="none" stroke="${s.edge}" stroke-opacity="0.75" stroke-width="1.1" stroke-dasharray="1.6 2.6"/>
      <circle cx="50" cy="50" r="27" fill="url(#chip-face)"/>
      <text x="50" y="50" dy="0.36em" text-anchor="middle" font-size="${size}" font-weight="800"
        font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" fill="${s.text}" letter-spacing="-0.5">${label}</text>
      <circle cx="50" cy="50" r="49" fill="url(#chip-gloss)"/>
      <circle cx="50" cy="50" r="48.6" fill="none" stroke="#000" stroke-opacity="0.45" stroke-width="1"/>
    </svg>`;
}
