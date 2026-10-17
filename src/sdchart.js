// Line chart of a running result against its expected path with ±1σ and ±2σ
// bands. points: [{ actual, center, sd }] cumulative per round, starting at 0.

const W = 520;
const H = 220;
const PAD = { top: 12, right: 12, bottom: 26, left: 58 };

function niceStep(range) {
  const raw = range / 4;
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
}

function fmt(x) {
  const abs = Math.abs(x);
  const s = abs >= 10000 ? `$${(abs / 1000).toFixed(0)}K` : abs >= 1000 ? `$${(abs / 1000).toFixed(1)}K` : `$${Math.round(abs)}`;
  return x < 0 ? `−${s}` : s;
}

export function drawSdChart(container, points, { label }) {
  const n = points.length - 1;
  if (n < 1) {
    container.innerHTML = '<p class="note">Play a few hands to see this chart.</p>';
    return;
  }
  let lo = 0;
  let hi = 0;
  for (const p of points) {
    lo = Math.min(lo, p.actual, p.center - 2 * p.sd);
    hi = Math.max(hi, p.actual, p.center + 2 * p.sd);
  }
  const step = niceStep(hi - lo);
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  if (hi === lo) hi = lo + step;

  const iw = W - PAD.left - PAD.right;
  const ih = H - PAD.top - PAD.bottom;
  const x = (i) => PAD.left + (i / n) * iw;
  const y = (v) => PAD.top + (1 - (v - lo) / (hi - lo)) * ih;
  const line = (f) => points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(f(p)).toFixed(1)}`).join('');
  const band = (k) =>
    line((p) => p.center + k * p.sd) +
    points
      .map((p, i) => [i, p])
      .reverse()
      .map(([i, p]) => `L${x(i).toFixed(1)},${y(p.center - k * p.sd).toFixed(1)}`)
      .join('') +
    'Z';

  const grid = [];
  for (let v = lo; v <= hi + step / 2; v += step) {
    grid.push(
      `<line x1="${PAD.left}" x2="${W - PAD.right}" y1="${y(v)}" y2="${y(v)}" class="sd-grid${Math.abs(v) < step / 2 ? ' zero' : ''}"/>` +
        `<text x="${PAD.left - 6}" y="${y(v) + 4}" text-anchor="end" class="sd-tick">${fmt(v)}</text>`
    );
  }
  const xTicks = [0, Math.round(n / 2), n]
    .filter((v, i, a) => a.indexOf(v) === i)
    .map((i) => `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" class="sd-tick">${i}</text>`);

  const last = points[n];
  const z = last.sd > 0 ? (last.actual - last.center) / last.sd : 0;

  container.innerHTML = `
    <div class="sd-legend">
      <span><i class="sw actual"></i>Your net</span>
      <span><i class="sw center"></i>Expected</span>
      <span><i class="sw b1"></i>±1σ</span>
      <span><i class="sw b2"></i>±2σ</span>
    </div>
    <div class="sd-plot">
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}: net ${fmt(last.actual)}, expected ${fmt(last.center)}, ${z.toFixed(1)} standard deviations">
        ${grid.join('')}
        <path d="${band(2)}" class="sd-band b2"/>
        <path d="${band(1)}" class="sd-band b1"/>
        <path d="${line((p) => p.center)}" class="sd-center"/>
        <path d="${line((p) => p.actual)}" class="sd-actual"/>
        <circle cx="${x(n)}" cy="${y(last.actual)}" r="4" class="sd-dot"/>
        ${xTicks.join('')}
        <line class="sd-cross" y1="${PAD.top}" y2="${H - PAD.bottom}" visibility="hidden"/>
        <rect x="${PAD.left}" y="${PAD.top}" width="${iw}" height="${ih}" fill="transparent" class="sd-hit"/>
      </svg>
      <div class="sd-tip" hidden></div>
    </div>
    <p class="sd-read">After ${n} round${n === 1 ? '' : 's'}: ${fmt(last.actual)} vs ${fmt(last.center)} expected, <strong>${z >= 0 ? '+' : '−'}${Math.abs(z).toFixed(2)}σ</strong> (σ = ${fmt(last.sd)}).</p>`;

  const svg = container.querySelector('svg');
  const cross = container.querySelector('.sd-cross');
  const tip = container.querySelector('.sd-tip');
  const move = (e) => {
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.max(0, Math.min(n, Math.round(((px - PAD.left) / iw) * n)));
    const p = points[i];
    cross.setAttribute('x1', x(i));
    cross.setAttribute('x2', x(i));
    cross.setAttribute('visibility', 'visible');
    const zi = p.sd > 0 ? (p.actual - p.center) / p.sd : 0;
    tip.hidden = false;
    tip.innerHTML = `Round ${i}<br>Net <b>${fmt(p.actual)}</b><br>Expected ${fmt(p.center)}<br>${zi >= 0 ? '+' : '−'}${Math.abs(zi).toFixed(2)}σ`;
    const left = (x(i) / W) * r.width;
    tip.style.left = `${Math.min(Math.max(left, 50), r.width - 50)}px`;
  };
  const hide = () => {
    cross.setAttribute('visibility', 'hidden');
    tip.hidden = true;
  };
  const hit = container.querySelector('.sd-hit');
  hit.addEventListener('pointermove', move);
  hit.addEventListener('pointerdown', move);
  hit.addEventListener('pointerleave', hide);
}

// Builds cumulative points from per-round history entries using the given
// expected-value and variance keys.
export function cumulative(history, evKey, varKey) {
  const points = [{ actual: 0, center: 0, sd: 0 }];
  let actual = 0;
  let center = 0;
  let variance = 0;
  for (const r of history) {
    actual += r.net;
    center += r[evKey];
    variance += r[varKey];
    points.push({ actual, center, sd: Math.sqrt(variance) });
  }
  return points;
}
