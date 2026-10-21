const DAY_ORDER = ["Sat", "Sun", "Mon", "Tue", "Wed"];
const DAY_FULL = {
  Sat: "Saturday",
  Sun: "Sunday",
  Mon: "Monday",
  Tue: "Tuesday",
  Wed: "Wednesday",
};
// UIU's fixed class-period boundaries: 8:30, 9:50, 11:10, 12:30, 1:50, 3:10, 4:30
const SLOT_MARKS = [
  8 * 60 + 30,
  9 * 60 + 50,
  11 * 60 + 10,
  12 * 60 + 30,
  13 * 60 + 50,
  15 * 60 + 10,
  16 * 60 + 30,
];
const SLOT_COUNT = SLOT_MARKS.length - 1; // 6 slots

const PALETTE_SIZE = 8;
function courseColor(code) {
  let h = 0;
  for (let i = 0; i < code.length; i++) h = (h * 31 + code.charCodeAt(i)) >>> 0;
  return `var(--c${(h % PALETTE_SIZE) + 1})`;
}

function fmtTime(mins) {
  let h = Math.floor(mins / 60),
    m = mins % 60;
  const ap = h >= 12 ? "PM" : "AM";
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ap}`;
}

// ---------- index data ----------
const byCode = {}; // code -> {title, credit, sections:[...], kind: 'theory'|'lab'}
for (const s of COURSES) {
  if (!byCode[s.code])
    byCode[s.code] = { title: s.title, credit: s.credit, sections: [] };
  byCode[s.code].sections.push(s);
}
for (const code in byCode) {
  const secs = byCode[code].sections;
  const durations = secs.map((s) =>
    s.meets[0] ? s.meets[0].end - s.meets[0].start : 80,
  );
  const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
  // A lecture meets twice a week for ~80 min each; a lab meets once for ~150
  // min. Anything markedly longer than one standard period is treated as a
  // lab — a simplification on purpose, matching the grid's 6 fixed periods.
  byCode[code].kind = avg > 110 ? "lab" : "theory";
}
const ALL_CODES = Object.keys(byCode).sort();
// Every theory course here is a single cell now, not two: UIU lectures
// always meet on a fixed day-pair (Sat+Tue or Sun+Wed) at the same time, so
// placing it once fills both days automatically rather than being dragged
// twice. A lab is still one cell, 2 units, but only starts where a real lab
// block actually starts (8:30, 11:10, or 1:50 — never mid-period).
function unitCount(kind) {
  return 1;
}
const PAIR_DAY = { Sat: "Tue", Tue: "Sat", Sun: "Wed", Wed: "Sun" };
const LAB_START_SLOTS = new Set([0, 2, 4]);

// ---------- state ----------
let myCourses = []; // array of course codes
let instances = []; // [{id, code, kind, placed, day, slot}]
let instSeq = 0;
let previewCode = null; // course code currently being "previewed" (green availability)

function makeInstance(code) {
  return {
    id: "i" + instSeq++ + "_" + Math.random().toString(36).slice(2, 7),
    code,
    kind: byCode[code].kind,
    placed: false,
    day: null,
    slot: null,
  };
}
// Keeps a course's cell count correct (1 cell either way, now) without
// disturbing cells that are already placed.
function ensureInstances(code) {
  const want = unitCount(byCode[code].kind);
  let have = instances.filter((x) => x.code === code);
  if (have.length < want) {
    for (let i = have.length; i < want; i++) instances.push(makeInstance(code));
  } else if (have.length > want) {
    let extra = have.length - want;
    const removable = have
      .filter((x) => !x.placed)
      .concat(have.filter((x) => x.placed));
    const removeIds = new Set(removable.slice(0, extra).map((x) => x.id));
    instances = instances.filter((x) => !removeIds.has(x.id));
  }
}

function loadState() {
  try {
    const raw = localStorage.getItem("uiu-custom-builder-v1");
    if (raw) {
      const parsed = JSON.parse(raw);
      myCourses = (parsed.myCourses || []).filter((c) => byCode[c]);
      instances = (parsed.instances || []).filter((x) => byCode[x.code]);
    }
  } catch (e) {
    /* ignore */
  }
  myCourses.forEach(ensureInstances);
  // drop instances for courses no longer in myCourses (defensive)
  const validCodes = new Set(myCourses);
  instances = instances.filter((x) => validCodes.has(x.code));
}
function saveState() {
  try {
    localStorage.setItem(
      "uiu-custom-builder-v1",
      JSON.stringify({ myCourses, instances }),
    );
  } catch (e) {
    /* ignore */
  }
}

// ---------- concept (shared with the main page) ----------
const CONCEPTS = ["board", "dusk", "diary", "soft"];
function initConcept() {
  const root = document.documentElement;
  let c = null;
  try {
    c = localStorage.getItem("uiu-routine-concept");
  } catch (e) {}
  if (!CONCEPTS.includes(c)) c = "board";
  root.setAttribute("data-concept", c);
  const conceptSelect = document.getElementById("conceptSelect");
  conceptSelect.value = c;
  conceptSelect.addEventListener("change", (e) => {
    const next = CONCEPTS.includes(e.target.value) ? e.target.value : "board";
    root.setAttribute("data-concept", next);
    try {
      localStorage.setItem("uiu-routine-concept", next);
    } catch (e) {}
  });
}

// ---------- onboarding ----------
function initOnboarding() {
  const panel = document.getElementById("onboarding");
  let dismissed = false;
  try {
    dismissed = localStorage.getItem("uiu-custom-onboarding-dismissed") === "1";
  } catch (e) {}
  if (dismissed) {
    panel.style.display = "none";
    return;
  }
  document.getElementById("onboardingClose").addEventListener("click", () => {
    panel.style.display = "none";
    try {
      localStorage.setItem("uiu-custom-onboarding-dismissed", "1");
    } catch (e) {}
  });
}

// ---------- search ----------
const searchBox = document.getElementById("searchBox");
const searchResults = document.getElementById("searchResults");
const searchClear = document.getElementById("searchClear");

function runSearch(q) {
  searchClear.style.display = q ? "block" : "none";
  q = q.trim().toLowerCase();
  searchResults.innerHTML = "";
  if (!q) return;
  const hits = [];
  for (const code of ALL_CODES) {
    const info = byCode[code];
    const facultyList = [
      ...new Set(info.sections.map((s) => s.faculty).filter(Boolean)),
    ];
    const hay = (
      code +
      " " +
      info.title +
      " " +
      facultyList.join(" ")
    ).toLowerCase();
    if (hay.includes(q)) hits.push(code);
  }
  hits.slice(0, 40).forEach((code) => {
    const info = byCode[code];
    const already = myCourses.includes(code);
    const row = document.createElement("div");
    row.className = "search-hit";
    row.innerHTML = `
      <div class="meta">
        <div class="code">${code}</div>
        <div class="title">${info.title}</div>
        <div class="n">${info.kind === "lab" ? "Lab" : "Theory"} · ${info.sections.length} section${info.sections.length > 1 ? "s" : ""} · ${info.credit ?? "—"} credit${info.credit === 1 ? "" : "s"}</div>
      </div>
    `;
    const btn = document.createElement("button");
    btn.className = "btn small" + (already ? " ghost" : "");
    btn.textContent = already ? "Added" : "+ Add";
    btn.disabled = already;
    btn.addEventListener("click", () => {
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
searchBox.addEventListener("input", () => runSearch(searchBox.value));
searchClear.addEventListener("click", () => {
  searchBox.value = "";
  runSearch("");
  searchBox.focus();
});

// ---------- my courses (sidebar cell tray) ----------
function renderMyCourses() {
  const wrap = document.getElementById("myCourses");
  wrap.innerHTML = "";
  if (myCourses.length === 0) {
    wrap.innerHTML =
      '<div class="empty-note">Nothing added yet. Search above and add the courses you want to lay out — a theory cell auto-pairs onto Sat+Tue or Sun+Wed when you place it; a lab cell is a single, longer block on one day.</div>';
    return;
  }
  myCourses.forEach((code) => {
    const info = byCode[code];
    const unplaced = instances.filter((x) => x.code === code && !x.placed);
    const card = document.createElement("div");
    card.className =
      "course-card" + (code === previewCode ? " previewing" : "");
    card.innerHTML = `
      <div class="head">
        <div>
          <div class="code">${code}</div>
          <div class="title">${info.title}</div>
          <div class="credit">${info.kind === "lab" ? "Lab" : "Theory"} · ${info.sections.length} sections · ${info.credit ?? "—"} credit${info.credit === 1 ? "" : "s"}</div>
        </div>
        <button class="remove-x" title="Remove" aria-label="Remove ${code}">✕</button>
      </div>
      <div class="cell-tray"></div>
    `;
    card.addEventListener("click", () => toggleCoursePreview(code));
    card.querySelector(".remove-x").addEventListener("click", (e) => {
      e.stopPropagation();
      myCourses = myCourses.filter((c) => c !== code);
      instances = instances.filter((x) => x.code !== code);
      if (previewCode === code) previewCode = null;
      saveState();
      renderMyCourses();
      renderGrid();
      renderPlacementDetail();
      runSearch(searchBox.value);
    });
    const tray = card.querySelector(".cell-tray");
    if (unplaced.length === 0) {
      tray.innerHTML =
        '<div class="cell-tray-empty">All cells placed on the grid</div>';
    } else {
      unplaced.forEach((inst) => {
        const chip = document.createElement("div");
        chip.className = "cell-chip " + inst.kind;
        chip.textContent =
          inst.kind === "lab"
            ? "Lab cell · 2 units"
            : "Theory cell · pairs 2 days";
        chip.addEventListener("pointerdown", (e) =>
          startDrag(e, inst.id, chip),
        );
        tray.appendChild(chip);
      });
    }
    wrap.appendChild(card);
  });
}

// ---------- grid occupancy + matching ----------
// A placed theory instance occupies its chosen day AND the paired day at the
// same slot (they're never offered separately in real sections); a placed
// lab instance occupies its one day across its two consecutive slots.
function occupiedMap(excludeId) {
  const map = {};
  instances.forEach((inst) => {
    if (!inst.placed || inst.id === excludeId) return;
    if (inst.kind === "theory") {
      map[inst.day + "|" + inst.slot] = inst.id;
      map[PAIR_DAY[inst.day] + "|" + inst.slot] = inst.id;
    } else {
      map[inst.day + "|" + inst.slot] = inst.id;
      map[inst.day + "|" + (inst.slot + 1)] = inst.id;
    }
  });
  return map;
}
// Shared validity rule, used both for an actual instance being placed
// (canPlace) and for the generic "could anything of this kind go here"
// check the availability preview uses (slotFree) — one place to encode:
// Monday has no theory pairing so it's lab-only, and a lab can only start
// on one of the three real lab blocks (8:30, 11:10, 1:50), never in between.
function canPlaceGeneric(kind, day, slot, excludeId) {
  if (slot < 0 || slot >= SLOT_COUNT) return false;
  const occ = occupiedMap(excludeId);
  if (kind === "theory") {
    if (day === "Mon") return false; // Monday isn't part of a Sat/Tue or Sun/Wed pair
    const partner = PAIR_DAY[day];
    if (occ[day + "|" + slot]) return false;
    if (occ[partner + "|" + slot]) return false;
    return true;
  }
  if (!LAB_START_SLOTS.has(slot)) return false; // only the 3 real lab start times
  if (occ[day + "|" + slot]) return false;
  if (occ[day + "|" + (slot + 1)]) return false;
  return true;
}
function canPlace(inst, day, slot) {
  return canPlaceGeneric(inst.kind, day, slot, inst.id);
}
function slotFree(day, slot, kind) {
  return canPlaceGeneric(kind, day, slot, undefined);
}
function findMatches(code, day, slot) {
  // Real sections don't line up perfectly with the 6 clean period boundaries
  // (labs in particular run a few minutes either side of them), so this
  // checks genuine time overlap with the cell's whole window rather than an
  // exact start-time match, which would silently miss real sections.
  const span = byCode[code].kind === "lab" ? 2 : 1; // lab spans 2 grid units, theory 1
  const winStart = SLOT_MARKS[slot];
  const winEnd = SLOT_MARKS[Math.min(slot + span, SLOT_MARKS.length - 1)];
  return byCode[code].sections.filter((s) =>
    s.meets.some((m) => m.day === day && m.start < winEnd && winStart < m.end),
  );
}
function clearPreview() {
  document.querySelectorAll(".drop-cell.slot-available").forEach((cell) => {
    cell.classList.remove("slot-available");
    cell.removeAttribute("title");
  });
}
function applyPreview(code) {
  clearPreview();
  const kind = byCode[code].kind;
  DAY_ORDER.forEach((day) => {
    for (let slot = 0; slot < SLOT_COUNT; slot++) {
      if (!slotFree(day, slot, kind)) continue;
      const matches = findMatches(code, day, slot);
      if (!matches.length) continue;
      const cell = document.querySelector(
        `.drop-cell[data-day="${day}"][data-slot="${slot}"]`,
      );
      if (!cell) continue;
      cell.classList.add("slot-available");
      cell.title = matches
        .map(
          (s) =>
            `${s.section}: ${s.faculty || "TBA"}${s.room ? " · " + s.room : ""}`,
        )
        .join("\n");
    }
  });
}
function toggleCoursePreview(code) {
  previewCode = previewCode === code ? null : code;
  renderMyCourses();
  if (previewCode) applyPreview(previewCode);
  else clearPreview();
}
document.addEventListener("click", (e) => {
  if (!previewCode) return;
  if (e.target.closest(".course-card, .drop-cell, .placed-token")) return;
  previewCode = null;
  renderMyCourses();
  clearPreview();
});

// ---------- drag and drop (pointer-based, works for mouse/touch/pen) ----------
let dragInst = null;
let hoverCell = null;

function startDrag(e, instId, el) {
  if (e.button !== undefined && e.button !== 0) return;
  e.preventDefault();
  dragInst = instId;
  // A theory cell renders as two tokens (one per paired day) — mark both as
  // being dragged, not just the one actually under the pointer.
  document
    .querySelectorAll(`.placed-token[data-inst="${instId}"]`)
    .forEach((t) => t.classList.add("dragging"));
  el.classList.add("dragging");
  const inst = instances.find((x) => x.id === instId);
  if (inst) {
    previewCode = inst.code;
    applyPreview(inst.code);
  }
}
function clearHover() {
  if (hoverCell) {
    hoverCell.classList.remove("drop-ok", "drop-bad");
    hoverCell = null;
  }
}
document.addEventListener("pointermove", (e) => {
  if (!dragInst) return;
  clearHover();
  const el = document.elementFromPoint(e.clientX, e.clientY);
  const cellEl = el && el.closest("[data-day][data-slot]");
  if (cellEl) {
    const inst = instances.find((x) => x.id === dragInst);
    const day = cellEl.dataset.day,
      slot = parseInt(cellEl.dataset.slot, 10);
    const ok = inst && canPlace(inst, day, slot);
    cellEl.classList.add(ok ? "drop-ok" : "drop-bad");
    hoverCell = cellEl;
  }
});
document.addEventListener("pointerup", (e) => {
  if (!dragInst) return;
  const inst = instances.find((x) => x.id === dragInst);
  const el = document.elementFromPoint(e.clientX, e.clientY);
  const cellEl = el && el.closest("[data-day][data-slot]");
  clearHover();
  if (cellEl && inst) {
    const day = cellEl.dataset.day,
      slot = parseInt(cellEl.dataset.slot, 10);
    if (canPlace(inst, day, slot)) {
      inst.placed = true;
      inst.day = day;
      inst.slot = slot;
    }
  }
  dragInst = null;
  previewCode = null;
  clearPreview();
  saveState();
  renderMyCourses();
  renderGrid();
  renderPlacementDetail();
});

// ---------- grid rendering ----------
function renderGrid() {
  const grid = document.getElementById("cgrid");
  grid.style.setProperty("--ndays", DAY_ORDER.length);

  let html =
    '<div class="cgrid-corner" style="grid-column:1; grid-row:1"></div>';
  DAY_ORDER.forEach(
    (d, di) =>
      (html += `<div class="cgrid-head${d === "Mon" ? " mon-col" : ""}" style="grid-column:${di + 2}; grid-row:1">${DAY_FULL[d]}</div>`),
  );

  for (let s = 0; s < SLOT_COUNT; s++) {
    html += `<div class="cgrid-time" style="grid-row:${s + 2}">${fmtTime(SLOT_MARKS[s])}</div>`;
  }

  DAY_ORDER.forEach((d, di) => {
    for (let s = 0; s < SLOT_COUNT; s++) {
      html += `<div class="drop-cell${d === "Mon" ? " mon-col" : ""}" data-day="${d}" data-slot="${s}" style="grid-column:${di + 2}; grid-row:${s + 2}"></div>`;
    }
  });

  function renderToken(inst, day, span) {
    const di = DAY_ORDER.indexOf(day);
    const matches = findMatches(inst.code, day, inst.slot);
    const color = courseColor(inst.code);
    return `<div class="placed-token" data-inst="${inst.id}"
      style="grid-column:${di + 2}; grid-row:${inst.slot + 2} / span ${span}; --bc:${color}">
      <div class="pt-head">
        <span class="pt-code">${inst.code}</span>
        <button class="pt-remove" data-inst="${inst.id}" aria-label="Unplace ${inst.code}">✕</button>
      </div>
      <div class="pt-kind">${inst.kind === "lab" ? "Lab · 2 units" : "Theory · 1 unit"}</div>
      <div class="pt-match ${matches.length ? "ok" : "warn"}">${matches.length ? matches.length + " section" + (matches.length > 1 ? "s" : "") + " here" : "⚠ none here"}</div>
    </div>`;
  }
  instances.forEach((inst) => {
    if (!inst.placed) return;
    if (inst.kind === "lab") {
      html += renderToken(inst, inst.day, 2);
    } else {
      // A theory cell always shows on both days of its pair — that's the
      // whole point of the pairing, not an implementation detail to hide.
      html += renderToken(inst, inst.day, 1);
      html += renderToken(inst, PAIR_DAY[inst.day], 1);
    }
  });

  grid.innerHTML = html;

  grid.querySelectorAll(".placed-token").forEach((tok) => {
    tok.addEventListener("pointerdown", (e) => {
      if (e.target.closest(".pt-remove")) return;
      startDrag(e, tok.dataset.inst, tok);
    });
  });
  grid.querySelectorAll(".pt-remove").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const inst = instances.find((x) => x.id === btn.dataset.inst);
      if (inst) {
        inst.placed = false;
        inst.day = null;
        inst.slot = null;
      }
      saveState();
      renderMyCourses();
      renderGrid();
      renderPlacementDetail();
    });
  });

  // The rebuild above creates fresh cells with no highlight classes at all,
  // so if a preview was active, re-apply it against the grid's current
  // (possibly just-changed) occupancy — otherwise a stale `previewCode`
  // could leave the UI showing highlights that no longer match reality, or
  // none at all despite still being "on".
  if (previewCode) applyPreview(previewCode);
}

// ---------- placement details table ----------
function renderPlacementDetail() {
  const wrap = document.getElementById("placementDetail");
  // Each course now has exactly one instance — a theory cell always
  // represents both days of its pair, a lab cell its one two-slot block —
  // so there's no longer a need to merge duplicate cells; just one row per
  // placed course, with the "When" column listing every day it meets.
  const placed = instances
    .filter((x) => x.placed)
    .sort(
      (a, b) =>
        DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day) || a.slot - b.slot,
    );
  if (placed.length === 0) {
    wrap.innerHTML = "";
    return;
  }

  const rowsHtml = placed
    .map((inst) => {
      const info = byCode[inst.code];
      const matches = findMatches(inst.code, inst.day, inst.slot);
      const days =
        inst.kind === "lab" ? [inst.day] : [inst.day, PAIR_DAY[inst.day]];
      const endSlotIdx = inst.slot + (inst.kind === "lab" ? 2 : 1);
      const when = days
        .map(
          (d) =>
            `${DAY_FULL[d]} ${fmtTime(SLOT_MARKS[inst.slot])}–${fmtTime(SLOT_MARKS[endSlotIdx])}`,
        )
        .join(" · ");
      const matchCell = matches.length
        ? matches
            .map(
              (s) =>
                `${s.section} · ${s.faculty || "TBA"}${s.room ? " · " + s.room : ""}`,
            )
            .join("<br>")
        : `<span style="color:var(--danger-ink)">⚠ No section meets ${inst.code} at this time.</span>`;
      return `<tr>
      <td><span class="swatch" style="background:${courseColor(inst.code)}"></span>${inst.code} — ${info.title}</td>
      <td>${inst.kind === "lab" ? "Lab" : "Theory"}</td>
      <td>${when}</td>
      <td>${matchCell}</td>
    </tr>`;
    })
    .join("");

  wrap.innerHTML = `
    <h3 style="font-size:15px;margin-bottom:8px">Placement details</h3>
    <table class="section-table">
      <thead><tr><th>Course</th><th>Type</th><th>When</th><th>Available sections</th></tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  `;
}

// ---------- clear placements ----------
document.getElementById("clearGridBtn").addEventListener("click", () => {
  instances.forEach((inst) => {
    inst.placed = false;
    inst.day = null;
    inst.slot = null;
  });
  saveState();
  renderMyCourses();
  renderGrid();
  renderPlacementDetail();
});

// ---------- reset everything (shared across both pages) ----------
document.getElementById("resetBtn").addEventListener("click", () => {
  const ok = window.confirm(
    "This removes every course, faculty ranking, saved routine, and custom layout stored in this browser (on both the Routine Builder and Custom Routine Builder pages), and resets the design back to default. This can't be undone. Continue?",
  );
  if (!ok) return;
  try {
    localStorage.removeItem("uiu-routine-state-v1");
    localStorage.removeItem("uiu-routine-concept");
    localStorage.removeItem("uiu-routine-onboarding-dismissed");
    localStorage.removeItem("uiu-custom-builder-v1");
    localStorage.removeItem("uiu-custom-onboarding-dismissed");
  } catch (e) {
    /* ignore */
  }
  window.location.reload();
});

// ---------- init ----------
loadState();
initConcept();
initOnboarding();
renderMyCourses();
renderGrid();
renderPlacementDetail();
