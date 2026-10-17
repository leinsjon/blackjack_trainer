// Learn-to-count trainer: a short Hi-Lo guide, progressive drills, an
// in-game count quiz and progress tracking.

import { buildShoe, hiLo } from './game.js';

// ---------- logic (no DOM) ----------

export const DRILLS = [
  {
    id: 'tags',
    level: 1,
    title: 'Card values',
    blurb: 'One card at a time. Tap its Hi-Lo value: +1, 0 or −1.',
    goal: '95% accuracy, under 1 second a card',
    size: 1,
    rounds: 25,
  },
  {
    id: 'pairs',
    level: 2,
    title: 'Pairs',
    blurb: 'Two cards at once. Give their combined value. Learn to see cancelling pairs (a 5 and a K) as zero at a glance.',
    goal: '90% accuracy',
    size: 2,
    rounds: 20,
  },
  {
    id: 'groups',
    level: 3,
    title: 'Small groups',
    blurb: 'Three to five cards, like a player’s hand plus a hit. Give their net value.',
    goal: '90% accuracy',
    size: [3, 5],
    rounds: 15,
  },
  {
    id: 'deck',
    level: 4,
    title: 'Deck countdown',
    blurb: 'Count down a deck with one card removed. Cards flip one at a time; tap to go faster. At the end, enter your running count. A full deck sums to 0, so the answer tells you the missing card.',
    goal: 'Exact count in under 30 seconds',
    size: 'deck',
  },
  {
    id: 'truecount',
    level: 5,
    title: 'True count',
    blurb: 'Given a running count and the decks left, pick the true count (running count ÷ decks left).',
    goal: '90% accuracy',
    size: 'tc',
    rounds: 15,
  },
];

// Cards for one prompt of a drill, from a shuffled deck.
export function drillCards(drill, rng = Math.random) {
  const deck = buildShoe(1, rng);
  if (drill.size === 'deck') return deck.slice(0, 51);
  const n = Array.isArray(drill.size)
    ? drill.size[0] + Math.floor(rng() * (drill.size[1] - drill.size[0] + 1))
    : drill.size;
  return deck.slice(0, n);
}

export const countOf = (cards) => cards.reduce((s, c) => s + hiLo(c), 0);

// A true-count question: running count, decks left (half-deck steps, as you
// would estimate from the discard tray), the answer and four choices.
export function trueCountQuestion(rng = Math.random) {
  const decksLeft = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5][Math.floor(rng() * 10)];
  const target = [-3, -2, -1, 1, 2, 3, 4, 5][Math.floor(rng() * 8)];
  const rc = Math.round(target * decksLeft) || target;
  const answer = Math.round((rc / decksLeft) * 2) / 2;
  // Distractors: one off either side, and the classic slip of not dividing.
  const choices = new Set([answer, rc, answer - 1, answer + 1]);
  for (const extra of [answer + 2, answer - 2, answer + 0.5]) if (choices.size < 4) choices.add(extra);
  return { rc, decksLeft, answer, choices: [...choices].sort((a, b) => a - b) };
}

// In-game quiz grading: running count must be exact, true count within ±0.5.
export function gradeQuiz({ rc, tc }, actual) {
  return {
    rcCorrect: rc === actual.rc,
    tcCorrect: Number.isFinite(tc) && Math.abs(tc - actual.tc) <= 0.5,
  };
}

const PROGRESS_KEY = 'bj.countProgress';

export function loadProgress() {
  try {
    const p = JSON.parse(localStorage.getItem(PROGRESS_KEY) || 'null');
    if (p && typeof p === 'object') return { drills: p.drills || {}, quiz: p.quiz || [] };
  } catch {
    // fall through
  }
  return { drills: {}, quiz: [] };
}

export function saveProgress(p) {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(p));
  } catch {
    // storage unavailable
  }
}

// Whether a drill run met its goal (used for the next-step suggestion).
export function passed(drillId, run) {
  if (!run) return false;
  if (drillId === 'tags') return run.accuracy >= 0.95 && run.avgMs <= 1000;
  if (drillId === 'deck') return run.accuracy === 1 && run.ms <= 30000;
  return run.accuracy >= 0.9;
}

// ---------- UI ----------

const signed = (n) => (n > 0 ? `+${n}` : n === 0 ? '0' : `−${Math.abs(n)}`);

function cardHTML(card) {
  const red = card.suit === '♥' || card.suit === '♦';
  return `<div class="card dealt${red ? ' red' : ''}" aria-label="${card.rank}${card.suit}"><div class="corner">${card.rank}<span>${card.suit}</span></div><div class="pip">${card.suit}</div></div>`;
}

const GUIDE = `
  <section class="ct-lesson">
    <h3>1. Why counting works</h3>
    <p>Tens and aces help you: more blackjacks (paid 3 to 2), better doubles, and more dealer busts. Small cards help the dealer. When the cards left in the shoe are rich in tens and aces, you have the edge, so you bet more. When they are poor, you bet the minimum.</p>
  </section>
  <section class="ct-lesson">
    <h3>2. Hi-Lo card values</h3>
    <div class="ct-tags">
      <div><b class="pos">+1</b><span>2 3 4 5 6</span></div>
      <div><b>0</b><span>7 8 9</span></div>
      <div><b class="neg">−1</b><span>10 J Q K A</span></div>
    </div>
    <p>There are as many +1 cards as −1 cards, so a full deck counts to exactly 0.</p>
  </section>
  <section class="ct-lesson">
    <h3>3. The running count</h3>
    <p>Start at 0 after the shuffle and add each card's value as it is dealt, including every player's cards and the dealer's hole card when it flips. Example: 5, K, 3, 9, 2 is +1 −1 +1 0 +1 = <b>+2</b>.</p>
    <p>Tip: count in pairs. A small card and a big card cancel out (5 + K = 0), so you can skip them.</p>
  </section>
  <section class="ct-lesson">
    <h3>4. The true count</h3>
    <p>A +6 means more with 1 deck left than with 6. Divide the running count by the decks still in the shoe: <b>true count = running count ÷ decks left</b>. +6 with 3 decks left is a true count of +2. Estimate decks left from the discard tray (here, the shoe in the top right corner shows it).</p>
  </section>
  <section class="ct-lesson">
    <h3>5. Using it</h3>
    <p>Each +1 of true count shifts the edge about 0.5% toward you. With a typical 0.5% house edge, you break even around a true count of +1. A simple spread: bet 1 unit at a true count of +1 or lower, then 2 units at +2, 4 at +3 and 8 at +4 or higher. Play basic strategy throughout; count-based strategy changes come later.</p>
  </section>
  <section class="ct-lesson">
    <h3>6. How to practice</h3>
    <p>Work through the drills in order. Move on when you hit each goal. Then turn on the <b>in-game count quiz</b> in Rules → Training: it stops you every few rounds to ask for the running and true count. Keep the count on the table hidden while you practice.</p>
  </section>`;

export function initCountTrainer({ dialog }) {
  let progress = loadProgress();
  let tab = 'learn';
  let timer = null;

  const body = dialog.querySelector('.ct-body');
  const tabs = dialog.querySelectorAll('[data-ct-tab]');
  tabs.forEach((b) => b.addEventListener('click', () => show(b.dataset.ctTab)));
  dialog.querySelector('.ct-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => clearTimeout(timer));

  function show(name) {
    clearTimeout(timer);
    tab = name;
    tabs.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.ctTab === tab)));
    if (tab === 'learn') body.innerHTML = GUIDE;
    else if (tab === 'drills') renderDrillList();
    else renderProgress();
  }

  function lastRun(id) {
    const runs = progress.drills[id] || [];
    return runs[runs.length - 1];
  }

  function bestRun(id) {
    const runs = progress.drills[id] || [];
    if (id === 'deck') return runs.filter((r) => r.accuracy === 1).sort((a, b) => a.ms - b.ms)[0];
    return [...runs].sort((a, b) => b.accuracy - a.accuracy || a.avgMs - b.avgMs)[0];
  }

  function runSummary(id, r) {
    if (!r) return 'Not tried yet';
    if (id === 'deck') return `${r.accuracy === 1 ? 'Exact' : `Off by ${Math.abs(r.off)}`} in ${(r.ms / 1000).toFixed(1)}s`;
    return `${Math.round(r.accuracy * 100)}%${r.avgMs ? `, ${(r.avgMs / 1000).toFixed(2)}s each` : ''}`;
  }

  function nextDrill() {
    return DRILLS.find((d) => !(progress.drills[d.id] || []).some((r) => passed(d.id, r)));
  }

  function renderDrillList() {
    const next = nextDrill();
    body.innerHTML = `
      <p class="note">${next ? `Suggested next: <b>Level ${next.level}, ${next.title}</b>.` : 'You have passed every drill. Keep sharp with the deck countdown and the in-game quiz.'}</p>
      <ul class="ct-drills">${DRILLS.map((d) => {
        const done = (progress.drills[d.id] || []).some((r) => passed(d.id, r));
        return `
        <li class="ct-drill${d === next ? ' next' : ''}">
          <div>
            <div class="ct-drill-title">Level ${d.level}: ${d.title}${done ? ' <span class="ct-pass">Passed</span>' : ''}</div>
            <div class="ct-drill-blurb">${d.blurb}</div>
            <div class="ct-drill-meta">Goal: ${d.goal} · Best: ${runSummary(d.id, bestRun(d.id))}</div>
          </div>
          <button type="button" class="btn deal" data-start="${d.id}">Start</button>
        </li>`;
      }).join('')}</ul>`;
    body.querySelectorAll('[data-start]').forEach((b) =>
      b.addEventListener('click', () => startDrill(DRILLS.find((d) => d.id === b.dataset.start)))
    );
  }

  function record(id, run) {
    (progress.drills[id] ??= []).push({ t: Date.now(), ...run });
    progress.drills[id] = progress.drills[id].slice(-100);
    saveProgress(progress);
  }

  function startDrill(drill) {
    if (drill.size === 'deck') return startDeck(drill);
    let i = 0;
    let correct = 0;
    let totalMs = 0;
    let q;
    let shownAt;

    const next = () => {
      if (i >= drill.rounds) return finish();
      i++;
      if (drill.size === 'tc') {
        q = trueCountQuestion();
        body.innerHTML = frame(`
          <div class="ct-tc">
            <div><small>Running count</small><b>${signed(q.rc)}</b></div>
            <div><small>Decks left</small><b>${q.decksLeft}</b></div>
          </div>`, q.choices.map((v) => `<button type="button" class="btn ct-ans" data-v="${v}">${signed(v)}</button>`).join(''));
      } else {
        const cards = drillCards(drill);
        q = { cards, answer: countOf(cards) };
        const range = drill.size === 1 ? [-1, 0, 1] : drill.size === 2 ? [-2, -1, 0, 1, 2] : [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5];
        body.innerHTML = frame(
          `<div class="cards ct-cards">${cards.map(cardHTML).join('')}</div>`,
          range.map((v) => `<button type="button" class="btn ct-ans" data-v="${v}">${signed(v)}</button>`).join('')
        );
      }
      shownAt = performance.now();
      body.querySelectorAll('.ct-ans').forEach((b) => b.addEventListener('click', () => answer(Number(b.dataset.v), b)));
    };

    const frame = (prompt, answers) => `
      <div class="ct-run">
        <div class="ct-run-head"><span>Level ${drill.level}: ${drill.title}</span><span>${i} / ${drill.rounds} · ${correct} right</span></div>
        <div class="ct-prompt">${prompt}</div>
        <div class="ct-answers${answers.split('ct-ans').length > 6 ? ' wide' : ''}">${answers}</div>
        <div class="ct-fb" aria-live="polite"></div>
      </div>`;

    const answer = (v, btn) => {
      const ms = performance.now() - shownAt;
      totalMs += ms;
      const ok = v === q.answer;
      if (ok) correct++;
      body.querySelectorAll('.ct-ans').forEach((b) => (b.disabled = true));
      btn.classList.add(ok ? 'right' : 'wrong');
      const fb = body.querySelector('.ct-fb');
      fb.className = `ct-fb ${ok ? 'good' : 'bad'}`;
      fb.innerHTML = ok
        ? `✓ ${signed(q.answer)}`
        : drill.size === 'tc'
          ? `✗ ${signed(q.rc)} ÷ ${q.decksLeft} = <b>${signed(q.answer)}</b>`
          : `✗ It's <b>${signed(q.answer)}</b>: ${q.cards.map((c) => `${c.rank} ${signed(hiLo(c))}`).join(', ')}`;
      timer = setTimeout(next, ok ? 450 : 1800);
    };

    const finish = () => {
      const run = { accuracy: correct / drill.rounds, avgMs: Math.round(totalMs / drill.rounds), n: drill.rounds };
      record(drill.id, run);
      summary(drill, run, `${correct} of ${drill.rounds} right (${Math.round(run.accuracy * 100)}%), ${(run.avgMs / 1000).toFixed(2)}s per answer.`);
    };

    next();
  }

  function startDeck(drill) {
    const cards = drillCards(drill);
    const answer = countOf(cards);
    const speeds = { slow: 1500, medium: 900, fast: 550 };
    body.innerHTML = `
      <div class="ct-run">
        <div class="ct-run-head"><span>Level 4: Deck countdown</span><span></span></div>
        <p class="note">Cards flip automatically at the speed you pick. Tap the card to flip the next one sooner. Keep the count in your head.</p>
        <div class="ct-answers">
          ${Object.keys(speeds).map((k) => `<button type="button" class="btn ct-ans" data-speed="${k}">${k[0].toUpperCase() + k.slice(1)}</button>`).join('')}
        </div>
      </div>`;
    body.querySelectorAll('[data-speed]').forEach((b) => b.addEventListener('click', () => run(speeds[b.dataset.speed])));

    function run(interval) {
      let i = 0;
      const start = performance.now();
      body.innerHTML = `
        <div class="ct-run">
          <div class="ct-run-head"><span>Deck countdown</span><span class="ct-left">51 left</span></div>
          <button type="button" class="ct-prompt ct-deck" aria-label="Next card"></button>
          <div class="ct-fb"></div>
        </div>`;
      const slot = body.querySelector('.ct-deck');
      const left = body.querySelector('.ct-left');
      const flip = () => {
        clearTimeout(timer);
        if (i >= cards.length) return ask(performance.now() - start);
        slot.innerHTML = cardHTML(cards[i]);
        i++;
        left.textContent = `${cards.length - i} left`;
        timer = setTimeout(flip, interval);
      };
      slot.addEventListener('click', flip);
      flip();
    }

    function ask(ms) {
      body.innerHTML = `
        <div class="ct-run">
          <div class="ct-run-head"><span>Deck countdown</span><span>${(ms / 1000).toFixed(1)}s</span></div>
          <p>What is your running count?</p>
          <div class="ct-stepper">
            <button type="button" class="btn ghost" data-step="-1">−</button>
            <output class="ct-val">0</output>
            <button type="button" class="btn ghost" data-step="1">+</button>
          </div>
          <button type="button" class="btn deal ct-submit">Check</button>
        </div>`;
      let v = 0;
      const out = body.querySelector('.ct-val');
      body.querySelectorAll('[data-step]').forEach((b) =>
        b.addEventListener('click', () => {
          v += Number(b.dataset.step);
          out.textContent = signed(v);
        })
      );
      body.querySelector('.ct-submit').addEventListener('click', () => {
        const run = { accuracy: v === answer ? 1 : 0, off: v - answer, ms: Math.round(ms) };
        record('deck', run);
        const missing = -answer; // the removed card's tag brings the deck back to 0
        const tagName = missing === 1 ? 'a low card (2–6)' : missing === 0 ? 'a neutral card (7–9)' : 'a ten or ace';
        summary(
          drill,
          run,
          v === answer
            ? `Exact: ${signed(answer)} in ${(ms / 1000).toFixed(1)}s. So the missing card was ${tagName}.${ms > 30000 ? ' Next goal: under 30 seconds.' : ''}`
            : `You said ${signed(v)}; the count was ${signed(answer)}, so the missing card was ${tagName}. Time: ${(ms / 1000).toFixed(1)}s.`
        );
      });
    }
  }

  function summary(drill, run, text) {
    const ok = passed(drill.id, run);
    body.innerHTML = `
      <div class="ct-run">
        <div class="ct-run-head"><span>Level ${drill.level}: ${drill.title}</span></div>
        <div class="ct-summary ${ok ? 'good' : ''}">
          <b>${ok ? 'Goal met!' : 'Keep going'}</b>
          <p>${text}</p>
          <p class="note">Goal: ${drill.goal}.</p>
        </div>
        <div class="ct-answers">
          <button type="button" class="btn deal" data-again>Again</button>
          <button type="button" class="btn ghost" data-back>All drills</button>
        </div>
      </div>`;
    body.querySelector('[data-again]').addEventListener('click', () => startDrill(drill));
    body.querySelector('[data-back]').addEventListener('click', () => show('drills'));
  }

  function renderProgress() {
    const quiz = progress.quiz;
    const recent = quiz.slice(-20);
    const pct = (k) => (recent.length ? `${Math.round((recent.filter((q) => q[k]).length / recent.length) * 100)}%` : '–');
    const spark = (id) => {
      const runs = (progress.drills[id] || []).slice(-12);
      if (!runs.length) return '';
      return `<span class="ct-spark">${runs
        .map((r) => {
          const h = id === 'deck' ? (r.accuracy ? Math.max(0.15, Math.min(1, 30000 / r.ms)) : 0.08) : Math.max(0.08, r.accuracy);
          return `<i style="height:${Math.round(h * 100)}%" class="${passed(id, r) ? 'ok' : ''}" title="${runSummary(id, r)}"></i>`;
        })
        .join('')}</span>`;
    };
    body.innerHTML = `
      <table class="mistake-table ct-progress">
        <thead><tr><th>Drill</th><th class="num">Runs</th><th>Last</th><th>Best</th><th>Trend</th></tr></thead>
        <tbody>${DRILLS.map((d) => `
          <tr>
            <td>${d.level}. ${d.title}</td>
            <td class="num">${(progress.drills[d.id] || []).length}</td>
            <td>${runSummary(d.id, lastRun(d.id)).replace('Not tried yet', '–')}</td>
            <td>${runSummary(d.id, bestRun(d.id)).replace('Not tried yet', '–')}</td>
            <td>${spark(d.id)}</td>
          </tr>`).join('')}</tbody>
      </table>
      <h3>In-game count quiz</h3>
      <p class="note">${quiz.length ? `${quiz.length} checks so far. Last 20: running count right ${pct('rcCorrect')}, true count right ${pct('tcCorrect')} (within ±0.5).` : 'No checks yet. Turn on the quiz in Rules → Training to get asked for the count while you play.'}</p>
      ${recent.length ? `<ol class="ct-quiz-log">${recent.slice().reverse().map((q) => `
        <li><span>${new Date(q.t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
        <span class="${q.rcCorrect ? 'pos' : 'neg'}">RC ${signed(q.rc)} (was ${signed(q.actualRc)})</span>
        <span class="${q.tcCorrect ? 'pos' : 'neg'}">TC ${Number.isFinite(q.tc) ? signed(q.tc) : '–'} (was ${signed(Math.round(q.actualTc * 10) / 10)})</span></li>`).join('')}</ol>` : ''}
      <div class="dialog-actions"><button type="button" class="pill-btn" data-reset-progress>Reset counting progress</button></div>`;
    body.querySelector('[data-reset-progress]').addEventListener('click', () => {
      if (!window.confirm('Reset all counting drill and quiz progress?')) return;
      progress = { drills: {}, quiz: [] };
      saveProgress(progress);
      renderProgress();
    });
  }

  return {
    open(start = tab) {
      progress = loadProgress();
      show(start);
      dialog.showModal();
    },
    // In-game quiz: asks for the running and true count, records the result
    // and calls done() when the player continues.
    quiz({ rc, tc, decksLeft }, quizDialog, done) {
      const form = quizDialog.querySelector('form');
      const fb = quizDialog.querySelector('.cq-fb');
      const rcIn = form.elements.rc;
      const tcIn = form.elements.tc;
      rcIn.value = '';
      tcIn.value = '';
      fb.innerHTML = '';
      quizDialog.querySelector('.cq-decks').textContent = `${decksLeft.toFixed(1)} decks left in the shoe.`;
      const submit = form.querySelector('.cq-check');
      const cont = form.querySelector('.cq-continue');
      submit.hidden = false;
      cont.hidden = true;
      rcIn.disabled = tcIn.disabled = false;
      submit.onclick = (e) => {
        e.preventDefault();
        const ans = { rc: Math.round(Number(rcIn.value)), tc: tcIn.value === '' ? NaN : Number(tcIn.value) };
        if (rcIn.value === '') return rcIn.focus();
        const g = gradeQuiz(ans, { rc, tc });
        progress = loadProgress();
        progress.quiz.push({ t: Date.now(), rc: ans.rc, tc: ans.tc, actualRc: rc, actualTc: tc, ...g });
        progress.quiz = progress.quiz.slice(-500);
        saveProgress(progress);
        rcIn.disabled = tcIn.disabled = true;
        fb.innerHTML = `
          <p class="${g.rcCorrect ? 'pos' : 'neg'}">${g.rcCorrect ? '✓' : '✗'} Running count: ${signed(rc)}</p>
          <p class="${g.tcCorrect ? 'pos' : 'neg'}">${g.tcCorrect ? '✓' : '✗'} True count: ${signed(rc)} ÷ ${decksLeft.toFixed(1)} = ${signed(Math.round(tc * 10) / 10)}</p>`;
        submit.hidden = true;
        cont.hidden = false;
        cont.focus();
      };
      cont.onclick = (e) => {
        e.preventDefault();
        quizDialog.close();
        done();
      };
      quizDialog.showModal();
      rcIn.focus();
    },
  };
}
