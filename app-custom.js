const DAY_ORDER = ['Sat','Sun','Mon','Tue','Wed'];
const DAY_FULL = {Sat:'Saturday', Sun:'Sunday', Mon:'Monday', Tue:'Tuesday', Wed:'Wednesday'};
// UIU's fixed class-period boundaries: 8:30, 9:50, 11:10, 12:30, 1:50, 3:10, 4:30
const SLOT_MARKS = [8*60+30, 9*60+50, 11*60+10, 12*60+30, 13*60+50, 15*60+10, 16*60+30];
const SLOT_COUNT = SLOT_MARKS.length - 1; // 6 slots

const PALETTE_SIZE = 8;
function courseColor(code) {
  let h = 0;
  for (let i=0;i<code.length;i++) h = (h*31 + code.charCodeAt(i)) >>> 0;
  return `var(--c${(h % PALETTE_SIZE) + 1})`;
}

function fmtTime(mins) {
  let h = Math.floor(mins/60), m = mins%60;
  const ap = h >= 12 ? 'PM' : 'AM';
  let h12 = h % 12; if (h12 === 0) h12 = 12;
  return `${h12}:${String(m).padStart(2,'0')} ${ap}`;
}

// ---------- index data ----------
const byCode = {}; // code -> {title, credit, sections:[...], kind: 'theory'|'lab'}
for (const s of COURSES) {
  if (!byCode[s.code]) byCode[s.code] = { title: s.title, credit: s.credit, sections: [] };
  byCode[s.code].sections.push(s);
}
for (const code in byCode) {
  const secs = byCode[code].sections;
  const durations = secs.map(s => (s.meets[0] ? s.meets[0].end - s.meets[0].start : 80));
  const avg = durations.reduce((a,b) => a+b, 0) / durations.length;
  // A lecture meets twice a week for ~80 min each; a lab meets once for ~150
  // min. Anything markedly longer than one standard period is treated as a
  // lab — a simplification on purpose, matching the grid's 6 fixed periods.
  byCode[code].kind = avg > 110 ? 'lab' : 'theory';
}
const ALL_CODES = Object.keys(byCode).sort();
function unitCount(kind) { return kind === 'lab' ? 1 : 2; }

// ---------- state ----------
let myCourses = [];   // array of course codes
let instances = [];   // [{id, code, kind, placed, day, slot}]
let instSeq = 0;

function makeInstance(code) {
  return { id: 'i' + (instSeq++) + '_' + Math.random().toString(36).slice(2,7), code, kind: byCode[code].kind, placed: false, day: null, slot: null };
}
// Keeps a course's cell count correct (2 for theory, 1 for lab) without
// disturbing cells that are already placed.
function ensureInstances(code) {
  const want = unitCount(byCode[code].kind);
  let have = instances.filter(x => x.code === code);
  if (have.length < want) {
    for (let i = have.length; i < want; i++) instances.push(makeInstance(code));
  } else if (have.length > want) {
    let extra = have.length - want;
    const removable = have.filter(x => !x.placed).concat(have.filter(x => x.placed));
    const removeIds = new Set(removable.slice(0, extra).map(x => x.id));
    instances = instances.filter(x => !removeIds.has(x.id));
  }
}

function loadState() {
  try {
    const raw = localStorage.getItem('uiu-custom-builder-v1');
    if (raw) {
      const parsed = JSON.parse(raw);
      myCourses = (parsed.myCourses || []).filter(c => byCode[c]);
      instances = (parsed.instances || []).filter(x => byCode[x.code]);
    }
  } catch (e) { /* ignore */ }
  myCourses.forEach(ensureInstances);
  // drop instances for courses no longer in myCourses (defensive)
  const validCodes = new Set(myCourses);
  instances = instances.filter(x => validCodes.has(x.code));
}
function saveState() {
  try {
    localStorage.setItem('uiu-custom-builder-v1', JSON.stringify({ myCourses, instances }));
  } catch (e) { /* ignore */ }
}

// ---------- concept (shared with the main page) ----------
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
  try { dismissed = localStorage.getItem('uiu-custom-onboarding-dismissed') === '1'; } catch(e){}
  if (dismissed) { panel.style.display = 'none'; return; }
  document.getElementById('onboardingClose').addEventListener('click', () => {
    panel.style.display = 'none';
    try { localStorage.setItem('uiu-custom-onboarding-dismissed', '1'); } catch(e){}
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
        <div class="n">${info.kind === 'lab' ? 'Lab' : 'Theory'} · ${info.sections.length} section${info.sections.length>1?'s':''} · ${info.credit ?? '—'} credit${info.credit===1?'':'s'}</div>
      </div>
    `;
    const btn = document.createElement('button');
    btn.className = 'btn small' + (already ? ' ghost' : '');
    btn.textContent = already ? 'Added' : '+ Add';
    btn.disabled = already;
    btn.addEventListener('click', () => {
      myCourses.push(code);
      ensureInstances(code);
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

// ---------- my courses (sidebar cell tray) ----------
function renderMyCourses() {
  const wrap = document.getElementById('myCourses');
  wrap.innerHTML = '';
  if (myCourses.length === 0) {
    wrap.innerHTML = '<div class="empty-note">Nothing added yet. Search above and add the courses you want to lay out — each theory course gives you 2 draggable cells (it meets twice a week), each lab course gives you 1 (it meets once, for a longer block).</div>';
    return;
  }
  myCourses.forEach(code => {
    const info = byCode[code];
    const unplaced = instances.filter(x => x.code === code && !x.placed);
    const card = document.createElement('div');
    card.className = 'course-card';
    card.innerHTML = `
      <div class="head">
        <div>
          <div class="code">${code}</div>
          <div class="title">${info.title}</div>
          <div class="credit">${info.kind === 'lab' ? 'Lab' : 'Theory'} · ${info.sections.length} sections · ${info.credit ?? '—'} credit${info.credit===1?'':'s'}</div>
        </div>
        <button class="remove-x" title="Remove" aria-label="Remove ${code}">✕</button>
      </div>
      <div class="cell-tray"></div>
    `;
    card.querySelector('.remove-x').addEventListener('click', () => {
      myCourses = myCourses.filter(c => c !== code);
      instances = instances.filter(x => x.code !== code);
      saveState();
      renderMyCourses();
      renderGrid();
      renderPlacementDetail();
      runSearch(searchBox.value);
    });
    const tray = card.querySelector('.cell-tray');
    if (unplaced.length === 0) {
      tray.innerHTML = '<div class="cell-tray-empty">All cells placed on the grid</div>';
    } else {
      unplaced.forEach(inst => {
        const chip = document.createElement('div');
        chip.className = 'cell-chip ' + inst.kind + (inst.id === placingInstId ? ' chip-active' : '');
        chip.textContent = inst.kind === 'lab' ? 'Lab cell · 2 units' : 'Theory cell · 1 unit';
        chip.addEventListener('pointerdown', (e) => startDrag(e, inst.id, chip));
        chip.addEventListener('click', () => togglePlacing(inst.id));
        tray.appendChild(chip);
      });
    }
    wrap.appendChild(card);
  });
}

// ---------- grid occupancy + matching ----------
function occupiedMap(excludeId) {
  const map = {};
  instances.forEach(inst => {
    if (!inst.placed || inst.id === excludeId) return;
    map[inst.day + '|' + inst.slot] = inst.id;
    if (inst.kind === 'lab') map[inst.day + '|' + (inst.slot + 1)] = inst.id;
  });
  return map;
}
function canPlace(inst, day, slot) {
  if (slot < 0 || slot >= SLOT_COUNT) return false;
  if (inst.kind === 'lab' && slot === SLOT_COUNT - 1) return false; // no room for the 2nd unit
  const occ = occupiedMap(inst.id);
  if (occ[day + '|' + slot]) return false;
  if (inst.kind === 'lab' && occ[day + '|' + (slot + 1)]) return false;
  return true;
}
function findMatches(code, day, slot) {
  // Real sections don't line up perfectly with the 6 clean period boundaries
  // (labs in particular run a few minutes either side of them), so this
  // checks genuine time overlap with the cell's whole window rather than an
  // exact start-time match, which would silently miss real sections.
  const span = byCode[code].kind === 'lab' ? 2 : 1; // lab spans 2 grid units, theory 1
  const winStart = SLOT_MARKS[slot];
  const winEnd = SLOT_MARKS[Math.min(slot + span, SLOT_MARKS.length - 1)];
  return byCode[code].sections.filter(s => s.meets.some(m => m.day === day && m.start < winEnd && winStart < m.end));
}

// ---------- click-to-place: an alternative to dragging ----------
// Clicking a cell (unplaced chip, or an already-placed token to relocate it)
// lights up every grid slot it could legally go in, in one of two colors —
// a real section is actually offered there, or it's merely free — so the
// person can see every option before committing, then click one to place it.
let placingInstId = null;

function instById(id) { return instances.find(x => x.id === id); }

function togglePlacing(instId) {
  dragInst = null;
  placingInstId = (placingInstId === instId) ? null : instId;
  renderMyCourses();
  renderGrid();
}
function cancelPlacing() {
  if (!placingInstId) return;
  placingInstId = null;
  renderMyCourses();
  renderGrid();
}
function applyAvailabilityHighlights() {
  if (!placingInstId) return;
  const inst = instById(placingInstId);
  if (!inst) return;
  DAY_ORDER.forEach(day => {
    for (let slot = 0; slot < SLOT_COUNT; slot++) {
      const cell = document.querySelector(`.drop-cell[data-day="${day}"][data-slot="${slot}"]`);
      if (!cell || !canPlace(inst, day, slot)) continue;
      const matches = findMatches(inst.code, day, slot);
      if (matches.length) cell.classList.add('slot-available');
    }
  });
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') cancelPlacing(); });
document.addEventListener('click', (e) => {
  if (!placingInstId) return;
  if (e.target.closest('.cell-chip, .placed-token, .drop-cell, .pt-remove')) return;
  cancelPlacing();
});

// ---------- drag and drop (pointer-based, works for mouse/touch/pen) ----------
// Dragging shares the exact same whole-grid green preview as click-to-place
// (applyAvailabilityHighlights reads placingInstId), so picking a cell up —
// by dragging OR by clicking — shows every slot with a real section the
// moment it's picked up, not just the one under the cursor.
let dragInst = null;
let hoverCell = null;

// A finger (or even a mouse cursor sitting right on a small cell) covers up
// the exact spot being targeted, so both the hit-test and the visible "drag
// ghost" chip are offset above the real pointer position — the cell being
// targeted stays fully visible the whole time instead of hiding under it.
const DRAG_OFFSET_Y = 44;
let dragGhost = null;

function startDrag(e, instId, el) {
  if (e.button !== undefined && e.button !== 0) return;
  e.preventDefault();
  dragInst = instId;
  placingInstId = instId;
  el.classList.add('dragging');
  applyAvailabilityHighlights();
  const inst = instById(instId);
  dragGhost = document.createElement('div');
  dragGhost.className = 'drag-ghost';
  dragGhost.style.setProperty('--bc', courseColor(inst.code));
  dragGhost.textContent = inst.code + (inst.kind === 'lab' ? ' · Lab' : ' · Theory');
  document.body.appendChild(dragGhost);
  positionGhost(e.clientX, e.clientY);
}
function positionGhost(x, y) {
  if (!dragGhost) return;
  dragGhost.style.left = x + 'px';
  dragGhost.style.top = (y - DRAG_OFFSET_Y) + 'px';
}
function removeGhost() {
  if (dragGhost) { dragGhost.remove(); dragGhost = null; }
}
function clearHover() {
  if (hoverCell) { hoverCell.classList.remove('cell-hover'); hoverCell = null; }
}
// Finds the (day, slot) under a point by grid geometry rather than
// elementFromPoint — a placed token sits visually on top of its drop-cell
// and has no day/slot of its own, so hit-testing the DOM would lose track
// of the cursor the instant it passed over an already-occupied cell.
function cellFromPoint(clientX, clientY) {
  const grid = document.getElementById('cgrid');
  const rect = grid.getBoundingClientRect();
  const x = clientX - rect.left, y = clientY - rect.top;
  if (x < 0 || y < 0 || x > rect.width || y > rect.height) return null;
  const cs = getComputedStyle(grid);
  const colSizes = cs.gridTemplateColumns.trim().split(/\s+/).map(parseFloat);
  const rowSizes = cs.gridTemplateRows.trim().split(/\s+/).map(parseFloat);
  function trackAt(pos, sizes) {
    let acc = 0;
    for (let i = 0; i < sizes.length; i++) { acc += sizes[i]; if (pos < acc) return i; }
    return -1;
  }
  const colIdx = trackAt(x, colSizes); // 0 = time-label column
  const rowIdx = trackAt(y, rowSizes); // 0 = header row
  if (colIdx < 1 || rowIdx < 1) return null;
  const day = DAY_ORDER[colIdx - 1];
  const slot = rowIdx - 1;
  if (!day || slot < 0 || slot >= SLOT_COUNT) return null;
  return { day, slot };
}
document.addEventListener('pointermove', (e) => {
  if (!dragInst) return;
  positionGhost(e.clientX, e.clientY);
  clearHover();
  const hit = cellFromPoint(e.clientX, e.clientY - DRAG_OFFSET_Y);
  if (!hit) return;
  // If a placed token covers this spot, ring the token itself (it's drawn
  // on top and would otherwise hide a ring on the cell beneath it).
  const covering = instances.find(x => x.placed && x.day === hit.day &&
    (x.slot === hit.slot || (x.kind === 'lab' && x.slot + 1 === hit.slot)));
  const target = covering
    ? document.querySelector(`.placed-token[data-inst="${covering.id}"]`)
    : document.querySelector(`.drop-cell[data-day="${hit.day}"][data-slot="${hit.slot}"]`);
  if (target) { target.classList.add('cell-hover'); hoverCell = target; }
});
document.addEventListener('pointerup', (e) => {
  if (!dragInst) return;
  const inst = instances.find(x => x.id === dragInst);
  const hit = cellFromPoint(e.clientX, e.clientY - DRAG_OFFSET_Y);
  clearHover();
  removeGhost();
  if (hit && inst && canPlace(inst, hit.day, hit.slot)) {
    inst.placed = true; inst.day = hit.day; inst.slot = hit.slot;
  }
  dragInst = null;
  placingInstId = null;
  saveState();
  renderMyCourses();
  renderGrid();
  renderPlacementDetail();
});

// ---------- grid rendering ----------
function renderGrid() {
  const grid = document.getElementById('cgrid');
  grid.style.setProperty('--ndays', DAY_ORDER.length);

  let html = '<div class="cgrid-corner" style="grid-column:1; grid-row:1"></div>';
  DAY_ORDER.forEach((d, di) => html += `<div class="cgrid-head" style="grid-column:${di+2}; grid-row:1">${DAY_FULL[d]}</div>`);

  for (let s = 0; s < SLOT_COUNT; s++) {
    html += `<div class="cgrid-time" style="grid-row:${s+2}">${fmtTime(SLOT_MARKS[s])}</div>`;
  }

  DAY_ORDER.forEach((d, di) => {
    for (let s = 0; s < SLOT_COUNT; s++) {
      html += `<div class="drop-cell" data-day="${d}" data-slot="${s}" style="grid-column:${di+2}; grid-row:${s+2}"></div>`;
    }
  });

  instances.forEach(inst => {
    if (!inst.placed) return;
    const di = DAY_ORDER.indexOf(inst.day);
    const span = inst.kind === 'lab' ? 2 : 1;
    const matches = findMatches(inst.code, inst.day, inst.slot);
    const color = courseColor(inst.code);
    const titleAttr = matches.length
      ? matches.map(s => `${s.section}: ${s.faculty || 'TBA'}${s.room ? ' · ' + s.room : ''}`).join('\n')
      : 'No section meets this course at this day/time.';
    html += `<div class="placed-token${inst.id === placingInstId ? ' token-active' : ''}" data-inst="${inst.id}" title="${titleAttr.replace(/"/g,'&quot;')}"
      style="grid-column:${di+2}; grid-row:${inst.slot+2} / span ${span}; --bc:${color}">
      <div class="pt-head">
        <span class="pt-code">${inst.code}</span>
        <button class="pt-remove" data-inst="${inst.id}" aria-label="Unplace ${inst.code}">✕</button>
      </div>
      <div class="pt-kind">${inst.kind === 'lab' ? 'Lab · 2 units' : 'Theory · 1 unit'}</div>
      <div class="pt-match ${matches.length ? 'ok' : 'warn'}">${matches.length ? matches.length + ' section' + (matches.length>1?'s':'') + ' here' : '⚠ none here'}</div>
    </div>`;
  });

  grid.innerHTML = html;

  // click-to-place: clicking a lit-up slot while an instance is "picked up"
  // (via a sidebar chip or a placed token) commits it there.
  grid.querySelectorAll('.drop-cell').forEach(cell => {
    cell.addEventListener('click', () => {
      if (!placingInstId) return;
      const inst = instById(placingInstId);
      const day = cell.dataset.day, slot = parseInt(cell.dataset.slot, 10);
      if (inst && canPlace(inst, day, slot)) {
        inst.placed = true; inst.day = day; inst.slot = slot;
        placingInstId = null;
        saveState();
        renderMyCourses();
        renderGrid();
        renderPlacementDetail();
      } else {
        cancelPlacing();
      }
    });
  });
  grid.querySelectorAll('.placed-token').forEach(tok => {
    tok.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.pt-remove')) return;
      startDrag(e, tok.dataset.inst, tok);
    });
    tok.addEventListener('click', (e) => {
      if (e.target.closest('.pt-remove')) return;
      togglePlacing(tok.dataset.inst);
    });
  });
  grid.querySelectorAll('.pt-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const inst = instances.find(x => x.id === btn.dataset.inst);
      if (inst) { inst.placed = false; inst.day = null; inst.slot = null; }
      if (placingInstId === btn.dataset.inst) placingInstId = null;
      saveState();
      renderMyCourses();
      renderGrid();
      renderPlacementDetail();
    });
  });

  applyAvailabilityHighlights();
}

// ---------- placement details table ----------
function renderPlacementDetail() {
  const wrap = document.getElementById('placementDetail');
  const placed = instances.filter(x => x.placed).sort((a,b) =>
    DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day) || a.slot - b.slot
  );
  if (placed.length === 0) { wrap.innerHTML = ''; return; }
  const rows = placed.map(inst => {
    const info = byCode[inst.code];
    const matches = findMatches(inst.code, inst.day, inst.slot);
    const endSlotIdx = inst.slot + (inst.kind === 'lab' ? 2 : 1);
    const timeLabel = `${fmtTime(SLOT_MARKS[inst.slot])}–${fmtTime(SLOT_MARKS[endSlotIdx])}`;
    const matchCell = matches.length
      ? matches.map(s => `${s.section} · ${s.faculty || 'TBA'}${s.room ? ' · ' + s.room : ''}`).join('<br>')
      : `<span style="color:var(--danger-ink)">⚠ No section meets ${inst.code} on ${DAY_FULL[inst.day]} at this time.</span>`;
    return `<tr>
      <td><span class="swatch" style="background:${courseColor(inst.code)}"></span>${DAY_FULL[inst.day]}</td>
      <td>${timeLabel}</td>
      <td>${inst.code} — ${info.title}</td>
      <td>${inst.kind === 'lab' ? 'Lab' : 'Theory'}</td>
      <td>${matchCell}</td>
    </tr>`;
  }).join('');
  wrap.innerHTML = `
    <h3 style="font-size:15px;margin-bottom:8px">Placement details</h3>
    <table class="section-table">
      <thead><tr><th>Day</th><th>Time</th><th>Course</th><th>Type</th><th>Available sections</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

// ---------- clear placements ----------
document.getElementById('clearGridBtn').addEventListener('click', () => {
  instances.forEach(inst => { inst.placed = false; inst.day = null; inst.slot = null; });
  saveState();
  renderMyCourses();
  renderGrid();
  renderPlacementDetail();
});

// ---------- reset everything (shared across both pages) ----------
document.getElementById('resetBtn').addEventListener('click', () => {
  const ok = window.confirm(
    'This removes every course, faculty ranking, saved routine, and custom layout stored in this browser (on both the Routine Builder and Custom Routine Builder pages), and resets the design back to default. This can\'t be undone. Continue?'
  );
  if (!ok) return;
  try {
    localStorage.removeItem('uiu-routine-state-v1');
    localStorage.removeItem('uiu-routine-concept');
    localStorage.removeItem('uiu-routine-onboarding-dismissed');
    localStorage.removeItem('uiu-custom-builder-v1');
    localStorage.removeItem('uiu-custom-onboarding-dismissed');
  } catch (e) { /* ignore */ }
  window.location.reload();
});

// ---------- init ----------
loadState();
initConcept();
initOnboarding();
renderMyCourses();
renderGrid();
renderPlacementDetail();