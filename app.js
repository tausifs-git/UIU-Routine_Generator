
const DAY_ORDER = ['Sat','Sun','Mon','Tue','Wed'];
const DAY_FULL = {Sat:'Saturday', Sun:'Sunday', Mon:'Monday', Tue:'Tuesday', Wed:'Wednesday'};
// UIU's fixed class-period boundaries: 8:30, 9:50, 11:10, 12:30, 1:50, 3:10, 4:30
const SLOT_MARKS = [8*60+30, 9*60+50, 11*60+10, 12*60+30, 13*60+50, 15*60+10, 16*60+30];
const GRID_START = SLOT_MARKS[0];
const GRID_END = SLOT_MARKS[SLOT_MARKS.length - 1];
const PX_PER_MIN = 0.62; // small, fixed scale — keeps the routine compact

// Each concept defines its own --c1..--c8; referencing the variable (not a
// literal hex) means switching concepts recolors every block automatically.
const PALETTE_SIZE = 8;
function courseColor(code) {
  let h = 0;
  for (let i=0;i<code.length;i++) h = (h*31 + code.charCodeAt(i)) >>> 0;
  return `var(--c${(h % PALETTE_SIZE) + 1})`;
}
// Small cycling tilt set for the "diary" concept's taped-note look; harmless
// elsewhere since --tilt-on is 0 for every other concept.
const TILT = [-0.8, 0.7, -0.5, 0.9, -0.6, 0.5];
let tiltCounter = 0;

// ---------- index data ----------
const byCode = {}; // code -> {title, credit, sections:[...]}
const bySl = {};   // sl -> section, used to reconstruct saved routines
for (const s of COURSES) {
  if (!byCode[s.code]) byCode[s.code] = { title: s.title, credit: s.credit, program: s.program, sections: [] };
  byCode[s.code].sections.push(s);
  bySl[s.sl] = s;
}
const ALL_CODES = Object.keys(byCode).sort();

// ---------- state ----------
let myCourses = [];       // array of course codes
let facultyRank = {};     // code -> [faculty names, rank order, index 0 = most preferred]
let currentSolutions = []; // top-N solutions from solver
let altIndex = 0;
let savedRoutines = [];   // [{id, name, savedAt, picks: {code: sl}, score}]

const MAX_RANKED_FACULTY = 3;

function defaultFacultyOrder(code) {
  const seen = new Set();
  const order = [];
  byCode[code].sections.forEach(s => {
    const f = s.faculty || 'TBA';
    if (!seen.has(f)) { seen.add(f); order.push(f); }
  });
  return order;
}
// Keeps a course's shortlist valid against its actual faculty list (new
// course, or a saved shortlist that no longer matches the data), and caps it
// at MAX_RANKED_FACULTY without disturbing the order the user already set.
function ensureFacultyRank(code) {
  const valid = new Set(defaultFacultyOrder(code));
  const cur = (facultyRank[code] || []).filter(f => valid.has(f));
  facultyRank[code] = cur.slice(0, MAX_RANKED_FACULTY);
}

function loadState() {
  try {
    const raw = localStorage.getItem('uiu-routine-state-v1');
    if (raw) {
      const parsed = JSON.parse(raw);
      myCourses = (parsed.myCourses || []).filter(c => byCode[c]);
      facultyRank = parsed.facultyRank || {};
      savedRoutines = (parsed.savedRoutines || []).filter(r => r && r.picks && typeof r.picks === 'object');
    }
  } catch (e) { /* ignore */ }
  myCourses.forEach(ensureFacultyRank);
}
function saveState() {
  try {
    localStorage.setItem('uiu-routine-state-v1', JSON.stringify({ myCourses, facultyRank, savedRoutines }));
  } catch (e) { /* ignore */ }
}

// ---------- theme ----------
// Four complete, fixed visual designs (not light/dark variants of one
// palette) — "diary" is the default.
const CONCEPTS = ['board', 'dusk', 'diary', 'soft'];

function initConcept() {
  const root = document.documentElement;
  let c = null;
  try { c = localStorage.getItem('uiu-routine-concept'); } catch(e){}
  if (!CONCEPTS.includes(c)) c = 'board';
  root.setAttribute('data-concept', c);
  const conceptSelect = document.getElementById('conceptSelect');
  conceptSelect.value = c;
  conceptSelect.addEventListener('change', (e) => {
    const next = CONCEPTS.includes(e.target.value) ? e.target.value : 'board';
    root.setAttribute('data-concept', next);
    try { localStorage.setItem('uiu-routine-concept', next); } catch(e){}
  });
}

// ---------- onboarding ----------
function initOnboarding() {
  const panel = document.getElementById('onboarding');
  let dismissed = false;
  try { dismissed = localStorage.getItem('uiu-routine-onboarding-dismissed') === '1'; } catch(e){}
  if (dismissed) { panel.style.display = 'none'; return; }
  document.getElementById('onboardingClose').addEventListener('click', () => {
    panel.style.display = 'none';
    try { localStorage.setItem('uiu-routine-onboarding-dismissed', '1'); } catch(e){}
  });
}

// ---------- search ----------
const searchBox = document.getElementById('searchBox');
const searchResults = document.getElementById('searchResults');
const searchClear = document.getElementById('searchClear');

function runSearch(q) {
  searchClear.style.display = q ? 'block' : 'none';
  q = q.trim().toLowerCase();
  searchResults.innerHTML = '';
  if (!q) return;
  const hits = [];
  for (const code of ALL_CODES) {
    const info = byCode[code];
    const facultyList = [...new Set(info.sections.map(s => s.faculty).filter(Boolean))];
    const hay = (code + ' ' + info.title + ' ' + facultyList.join(' ')).toLowerCase();
    if (hay.includes(q)) hits.push(code);
  }
  hits.slice(0, 40).forEach(code => {
    const info = byCode[code];
    const already = myCourses.includes(code);
    const row = document.createElement('div');
    row.className = 'search-hit';
    row.innerHTML = `
      <div class="meta">
        <div class="code">${code}</div>
        <div class="title">${info.title}</div>
        <div class="n">${info.sections.length} section${info.sections.length>1?'s':''} · ${info.credit ?? '—'} credit${info.credit===1?'':'s'}</div>
      </div>
    `;
    const btn = document.createElement('button');
    btn.className = 'btn small' + (already ? ' ghost' : '');
    btn.textContent = already ? 'Added' : '+ Add';
    btn.disabled = already;
    btn.addEventListener('click', () => {
      myCourses.push(code);
      ensureFacultyRank(code);
      saveState();
      renderMyCourses();
      runSearch(searchBox.value);
    });
    row.appendChild(btn);
    searchResults.appendChild(row);
  });
  if (hits.length === 0) {
    searchResults.innerHTML = '<div class="empty-note">No matches.</div>';
  }
}
searchBox.addEventListener('input', () => runSearch(searchBox.value));
searchClear.addEventListener('click', () => {
  searchBox.value = '';
  runSearch('');
  searchBox.focus();
});

// ---------- my courses panel ----------
function updateGenerateButtonState() {
  const btn = document.getElementById('generateBtn');
  btn.disabled = myCourses.length === 0;
  btn.title = myCourses.length === 0 ? 'Add at least one course first' : '';
}

function renderMyCourses() {
  const wrap = document.getElementById('myCourses');
  wrap.innerHTML = '';
  if (myCourses.length === 0) {
    wrap.innerHTML = '<div class="empty-note">Nothing added yet. Search above and add the courses you plan to take — add the lab code too, if the course has one (e.g. both CSE 2215 and CSE 2216).</div>';
    updateGenerateButtonState();
    return;
  }
  myCourses.forEach(code => {
    ensureFacultyRank(code);
    const info = byCode[code];
    const card = document.createElement('div');
    card.className = 'course-card';
    card.innerHTML = `
      <div class="head">
        <div>
          <div class="code">${code}</div>
          <div class="title">${info.title}</div>
          <div class="credit">${info.sections.length} sections · ${info.credit ?? '—'} credit${info.credit===1?'':'s'}</div>
        </div>
        <button class="remove-x" title="Remove" aria-label="Remove ${code}">✕</button>
      </div>
      <div class="frank-add-row"></div>
      <div class="frank-list"></div>
    `;
    card.querySelector('.remove-x').addEventListener('click', () => {
      myCourses = myCourses.filter(c => c !== code);
      delete facultyRank[code];
      saveState();
      renderMyCourses();
      runSearch(searchBox.value);
    });
    renderFacultyPicker(card, code);
    wrap.appendChild(card);
  });
  updateGenerateButtonState();
}

// ---------- faculty shortlist: add dropdown + draggable ranked list ----------
let dragCtx = null; // { code, listEl, idx }

function renderFacultyPicker(card, code) {
  renderFacultyAddControl(card.querySelector('.frank-add-row'), card, code);
  renderFacultyRankList(card.querySelector('.frank-list'), card, code);
}

function renderFacultyAddControl(addRow, card, code) {
  const chosen = facultyRank[code] || [];
  addRow.innerHTML = '';
  if (chosen.length >= MAX_RANKED_FACULTY) {
    addRow.innerHTML = `<span class="frank-max-note">Maximum selected</span>`;
    return;
  }
  const available = defaultFacultyOrder(code).filter(f => !chosen.includes(f));
  const select = document.createElement('select');
  select.className = 'frank-add';
  select.innerHTML = `<option value="">+ Add a faculty…</option>` +
    available.map(f => `<option value="${f}">${f}</option>`).join('');
  select.addEventListener('change', () => {
    if (!select.value) return;
    facultyRank[code] = [...(facultyRank[code] || []), select.value];
    saveState();
    renderFacultyPicker(card, code);
  });
  addRow.appendChild(select);
}

function renderFacultyRankList(listEl, card, code) {
  const order = facultyRank[code] || [];
  listEl.innerHTML = '';
  if (order.length === 0) {
    listEl.innerHTML = '<div class="frank-empty">No faculty picked yet — choose up to 3 above to rank them.</div>';
    return;
  }
  order.forEach((name, idx) => {
    const row = document.createElement('div');
    row.className = 'frank-row';
    row.innerHTML = `<span class="frank-num">${idx+1}</span><span class="frank-name">${name}</span><button class="frank-remove" title="Remove" aria-label="Remove ${name}">✕</button><span class="frank-handle">⠿</span>`;
    row.querySelector('.frank-remove').addEventListener('click', () => {
      facultyRank[code] = facultyRank[code].filter(f => f !== name);
      saveState();
      renderFacultyPicker(card, code);
    });
    row.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.frank-remove')) return;
      if (e.button !== undefined && e.button !== 0) return;
      e.preventDefault();
      dragCtx = { code, listEl, card, idx };
      row.classList.add('dragging');
    });
    listEl.appendChild(row);
  });
}

document.addEventListener('pointermove', (e) => {
  if (!dragCtx) return;
  const { code, listEl, card } = dragCtx;
  const rows = [...listEl.children];
  if (!rows.length) return;
  const y = e.clientY;
  let newIdx = rows.findIndex(r => {
    const rect = r.getBoundingClientRect();
    return y < rect.top + rect.height / 2;
  });
  if (newIdx === -1) newIdx = rows.length - 1;
  if (newIdx !== dragCtx.idx) {
    const arr = facultyRank[code];
    const [item] = arr.splice(dragCtx.idx, 1);
    arr.splice(newIdx, 0, item);
    dragCtx.idx = newIdx;
    renderFacultyRankList(listEl, card, code);
    listEl.children[newIdx].classList.add('dragging');
  }
});
document.addEventListener('pointerup', () => {
  if (!dragCtx) return;
  saveState();
  dragCtx = null;
});

// ---------- conflict logic ----------
function overlap(a, b) { return a.start < b.end && b.start < a.end; }
function sectionsConflict(a, b) {
  for (const ma of a.meets) for (const mb of b.meets) {
    if (ma.day === mb.day && overlap(ma, mb)) return true;
  }
  return false;
}

// ---------- solver ----------
function solve(codes) {
  const order = [...codes].sort((a,b) => byCode[a].sections.length - byCode[b].sections.length);
  const TOP_N = 12;
  const top = []; // {picks: {code:section}, score: {...}}
  let nodes = 0;
  const NODE_BUDGET = 400000;
  const picks = {};

  function scoreCombo() {
    let facultyScore = 0;   // sum of rank positions chosen — lower is better
    let topChoiceCount = 0; // how many courses landed their #1-ranked faculty
    const dayMap = {};
    for (const code in picks) {
      const sec = picks[code];
      const order = facultyRank[code] || [];
      const name = sec.faculty || 'TBA';
      let rankIdx = order.indexOf(name);
      if (rankIdx === -1) rankIdx = order.length; // not in the ranking — treat as least preferred
      facultyScore += rankIdx;
      if (rankIdx === 0) topChoiceCount++;
      for (const m of sec.meets) {
        (dayMap[m.day] = dayMap[m.day] || []).push(m);
      }
    }
    let gapMinutes = 0;
    let extremePenalty = 0;
    for (const day in dayMap) {
      const arr = dayMap[day].slice().sort((a,b) => a.start - b.start);
      for (let i=0;i<arr.length;i++) {
        if (arr[i].start < 9*60+30) extremePenalty++;
        if (arr[i].end > 15*60+30) extremePenalty++;
        if (i>0) gapMinutes += Math.max(0, arr[i].start - arr[i-1].end);
      }
    }
    const daysUsed = Object.keys(dayMap).length;
    return { facultyScore, topChoiceCount, gapMinutes, daysUsed, extremePenalty };
  }
  function better(a, b) {
    if (a.facultyScore !== b.facultyScore) return a.facultyScore - b.facultyScore;
    if (a.gapMinutes !== b.gapMinutes) return a.gapMinutes - b.gapMinutes;
    if (a.daysUsed !== b.daysUsed) return a.daysUsed - b.daysUsed;
    return a.extremePenalty - b.extremePenalty;
  }
  function considerComplete() {
    const score = scoreCombo();
    const entry = { picks: { ...picks }, score };
    if (top.length < TOP_N) {
      top.push(entry);
      top.sort((x,y) => better(x.score, y.score));
    } else if (better(score, top[top.length-1].score) < 0) {
      top[top.length-1] = entry;
      top.sort((x,y) => better(x.score, y.score));
    }
  }
  function backtrack(i) {
    if (nodes > NODE_BUDGET) return;
    if (i === order.length) { considerComplete(); return; }
    const code = order[i];
    for (const sec of byCode[code].sections) {
      nodes++;
      if (nodes > NODE_BUDGET) return;
      let conflict = false;
      for (const otherCode in picks) {
        if (sectionsConflict(sec, picks[otherCode])) { conflict = true; break; }
      }
      if (!conflict) {
        picks[code] = sec;
        backtrack(i+1);
        delete picks[code];
      }
    }
  }
  backtrack(0);
  return { solutions: top, truncated: nodes > NODE_BUDGET };
}

function pairDiagnostics(codes) {
  const bad = [];
  for (let i=0;i<codes.length;i++) {
    for (let j=i+1;j<codes.length;j++) {
      const a = byCode[codes[i]].sections, b = byCode[codes[j]].sections;
      let anyFree = false;
      outer: for (const sa of a) for (const sb of b) {
        if (!sectionsConflict(sa, sb)) { anyFree = true; break outer; }
      }
      if (!anyFree) bad.push([codes[i], codes[j]]);
    }
  }
  return bad;
}

// ---------- rendering the routine ----------
function renderStatus(html, kind) {
  document.getElementById('statusArea').innerHTML = html ? `<div class="status-banner ${kind}">${html}</div>` : '';
}

function fmtTime(mins) {
  let h = Math.floor(mins/60), m = mins%60;
  const ap = h >= 12 ? 'PM' : 'AM';
  let h12 = h % 12; if (h12 === 0) h12 = 12;
  return `${h12}:${String(m).padStart(2,'0')} ${ap}`;
}

function activeDays(picksArr) {
  const set = new Set();
  picksArr.forEach(([code, sec]) => sec.meets.forEach(m => set.add(m.day)));
  return DAY_ORDER.filter(d => set.has(d));
}

function renderGrid(picksObj) {
  const picksArr = Object.entries(picksObj);
  // Always show all 5 official class days, even ones with nothing scheduled —
  // UIU runs Sat–Wed, so an empty Monday is still part of the week, not absent.
  const days = DAY_ORDER;
  const gridWrap = document.getElementById('gridWrap');
  const grid = document.getElementById('grid');
  gridWrap.style.display = 'block';
  grid.style.setProperty('--ndays', days.length);

  const totalMin = GRID_END - GRID_START;
  const pxPerMin = PX_PER_MIN;
  const bodyHeight = totalMin * pxPerMin;
  // The last time label (4:30 PM) is vertically centered on its gridline, so
  // without this it pokes a few px below the grid and gets clipped. Grow the
  // container a touch beyond the last gridline to give it room to breathe —
  // gridlines/blocks still use the unpadded `bodyHeight` scale, unaffected.
  const LABEL_PAD = 11;
  const containerHeight = bodyHeight + LABEL_PAD;
  tiltCounter = 0;

  let html = `<div class="corner"></div>`;
  days.forEach(d => html += `<div class="daycol-head">${DAY_FULL[d]}</div>`);

  html += `<div class="hourlabels" style="height:${containerHeight}px">`;
  SLOT_MARKS.forEach(t => {
    const top = (t - GRID_START) * pxPerMin;
    html += `<div class="hl" style="top:${top}px">${fmtTime(t)}</div>`;
  });
  html += `</div>`;

  days.forEach(day => {
    html += `<div class="daybody" style="height:${containerHeight}px">`;
    SLOT_MARKS.forEach(t => {
      const top = (t - GRID_START) * pxPerMin;
      html += `<div class="slotline" style="top:${top}px"></div>`;
    });
    picksArr.forEach(([code, sec]) => {
      sec.meets.filter(m => m.day === day).forEach(m => {
        const top = (m.start - GRID_START) * pxPerMin;
        const height = Math.max(22, (m.end - m.start) * pxPerMin);
        const color = courseColor(code);
        const tilt = TILT[tiltCounter++ % TILT.length];
        html += `<div class="block" style="top:${top}px; height:${height}px; --bc:${color}; --tilt:${tilt}">
          <div class="bcode">${code} · ${sec.section}</div>
          <div class="bfac">${fmtTime(m.start)}–${fmtTime(m.end)}</div>
          <div class="bfac">${sec.faculty || 'TBA'}${sec.room ? ' · ' + sec.room : ''}</div>
        </div>`;
      });
    });
    html += `</div>`;
  });

  grid.innerHTML = html;
}

function renderSummary(picksObj, score) {
  const strip = document.getElementById('summaryStrip');
  strip.style.display = 'flex';
  const picksArr = Object.entries(picksObj);
  const totalCredits = picksArr.reduce((s,[c]) => s + (byCode[c].credit || 0), 0);
  const days = activeDays(picksArr);
  strip.innerHTML = `
    <div class="summary-item"><b>${picksArr.length}</b> courses</div>
    <div class="summary-item"><b>${totalCredits}</b> credits</div>
    <div class="summary-item"><b>${days.length}</b> days on campus (${days.map(d=>d).join(', ')})</div>
    <div class="summary-item"><b>${score.topChoiceCount}</b> top-choice faculty picks</div>
    <div class="summary-item"><b>${Math.round(score.gapMinutes/60*10)/10} h</b> total gap time</div>
  `;
}

function renderSectionDetail(picksObj) {
  const wrap = document.getElementById('sectionDetail');
  const rows = Object.entries(picksObj).map(([code, sec]) => {
    const info = byCode[code];
    const dayStr = sec.meets.map(m => `${m.day} ${fmtTime(m.start)}–${fmtTime(m.end)}`).join(' · ');
    return `<tr>
      <td><span class="swatch" style="background:${courseColor(code)}"></span>${code}</td>
      <td>${info.title}</td>
      <td>${sec.section}</td>
      <td>${sec.faculty || 'TBA'}</td>
      <td>${dayStr}</td>
      <td>${sec.room || '—'}</td>
    </tr>`;
  }).join('');
  wrap.innerHTML = `
    <h3 style="font-size:15px;margin-bottom:8px">Section details</h3>
    <table class="section-table">
      <thead><tr><th>Code</th><th>Title</th><th>Sec</th><th>Faculty</th><th>When</th><th>Room</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderSolutionAt(idx) {
  if (!currentSolutions.length) return;
  altIndex = ((idx % currentSolutions.length) + currentSolutions.length) % currentSolutions.length;
  const { picks, score } = currentSolutions[altIndex];
  document.getElementById('emptyMain').style.display = 'none';
  renderGrid(picks);
  renderSummary(picks, score);
  renderSectionDetail(picks);
  const altNav = document.getElementById('altNav');
  if (currentSolutions.length > 1) {
    altNav.style.display = 'flex';
    document.getElementById('altLabel').textContent = `Option ${altIndex+1} of ${currentSolutions.length}`;
  } else {
    altNav.style.display = 'none';
  }
  document.getElementById('saveRoutineBtn').style.display = 'inline-block';
}

// ---------- saved routines ----------
function renderSavedList(selectId) {
  const picker = document.getElementById('savedPicker');
  const select = document.getElementById('savedSelect');
  const meta = document.getElementById('savedMeta');

  if (savedRoutines.length === 0) {
    picker.style.display = 'none';
    select.innerHTML = '';
    meta.textContent = '';
    return;
  }

  picker.style.display = 'flex';

  const ordered = savedRoutines.slice().reverse(); // newest first
  select.innerHTML = ordered.map(entry => `<option value="${entry.id}">${entry.name}</option>`).join('');
  const toSelect = selectId && savedRoutines.some(r => r.id === selectId) ? selectId : ordered[0].id;
  select.value = toSelect;
  updateSavedMeta();
}

function updateSavedMeta() {
  const select = document.getElementById('savedSelect');
  const meta = document.getElementById('savedMeta');
  const entry = savedRoutines.find(r => r.id === select.value);
  if (!entry) { meta.textContent = ''; return; }
  const picksArr = Object.entries(entry.picks);
  const credits = picksArr.reduce((s,[c]) => s + (byCode[c] ? (byCode[c].credit || 0) : 0), 0);
  meta.textContent = `${picksArr.length} course${picksArr.length===1?'':'s'} · ${credits} credit${credits===1?'':'s'}`;
}

function viewSavedRoutine(entry) {
  const picks = {};
  for (const code in entry.picks) {
    const sec = bySl[entry.picks[code]];
    if (sec) picks[code] = sec;
  }
  if (Object.keys(picks).length === 0) {
    renderStatus('Could not load that saved routine — the underlying section data may have changed.', 'warn');
    return;
  }
  currentSolutions = [{ picks, score: entry.score || { facultyScore: 0, topChoiceCount: 0, gapMinutes: 0, daysUsed: 0, extremePenalty: 0 } }];
  altIndex = 0;
  renderStatus(`Viewing saved routine “${entry.name}”.`, 'ok');
  renderSolutionAt(0);
}

document.getElementById('savedSelect').addEventListener('change', (e) => {
  updateSavedMeta();
  const entry = savedRoutines.find(r => r.id === e.target.value);
  if (entry) viewSavedRoutine(entry);
});

document.getElementById('deleteSavedBtn').addEventListener('click', () => {
  const select = document.getElementById('savedSelect');
  if (!select.value) return;
  savedRoutines = savedRoutines.filter(r => r.id !== select.value);
  saveState();
  renderSavedList();
});

document.getElementById('saveRoutineBtn').addEventListener('click', () => {
  if (!currentSolutions.length) return;
  const { picks, score } = currentSolutions[altIndex];
  const defaultName = `Routine ${savedRoutines.length + 1}`;
  const name = (window.prompt('Name this routine:', defaultName) || '').trim();
  if (!name) return;
  const entry = {
    id: 'r' + Date.now() + Math.random().toString(36).slice(2, 7),
    name,
    savedAt: Date.now(),
    picks: Object.fromEntries(Object.entries(picks).map(([code, sec]) => [code, sec.sl])),
    score,
  };
  savedRoutines.push(entry);
  saveState();
  renderSavedList(entry.id);
});

document.getElementById('prevAlt').addEventListener('click', () => renderSolutionAt(altIndex - 1));
document.getElementById('nextAlt').addEventListener('click', () => renderSolutionAt(altIndex + 1));

document.getElementById('generateBtn').addEventListener('click', () => {
  if (myCourses.length === 0) {
    renderStatus('Add at least one course first.', 'warn');
    return;
  }
  const btn = document.getElementById('generateBtn');
  btn.disabled = true;
  btn.textContent = 'Searching combinations…';
  renderStatus('', '');
  setTimeout(() => {
    const { solutions, truncated } = solve(myCourses);
    finishGenerate(solutions, truncated);
    btn.disabled = false;
    btn.textContent = 'Generate best routine';
  }, 20);
});

function finishGenerate(solutions, truncated) {
  currentSolutions = solutions;
  altIndex = 0;
  const note = document.getElementById('solverNote');
  if (solutions.length === 0) {
    document.getElementById('gridWrap').style.display = 'none';
    document.getElementById('summaryStrip').style.display = 'none';
    document.getElementById('sectionDetail').innerHTML = '';
    document.getElementById('emptyMain').style.display = 'none';
    document.getElementById('saveRoutineBtn').style.display = 'none';
    const bad = pairDiagnostics(myCourses);
    let msg = 'No clash-free combination exists across every section of your selected courses.';
    if (bad.length) {
      msg += ' These pairs never fit together in any section: ' + bad.map(p => p.join(' & ')).join('; ') + '.';
    }
    renderStatus(msg, 'warn');
    note.style.display = 'none';
  } else {
    renderStatus(`Found ${solutions.length} clash-free option${solutions.length>1?'s':''}, ranked best first.`, 'ok');
    renderSolutionAt(0);
    note.style.display = truncated ? 'block' : 'none';
    note.textContent = truncated ? 'Note: the search space was very large, so this ranks the best options found within a time budget — not necessarily every possible combination.' : '';
  }
}

// ---------- init ----------
loadState();
initConcept();
initOnboarding();
renderMyCourses();
renderSavedList();
