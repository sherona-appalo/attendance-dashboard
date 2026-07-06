
/**
 * att-data.js
 * Intercepts fetch() calls for the dashboard JSON files.
 * Reads from Firestore (cloud) with localStorage as fallback/cache.
 *
 * Attendance files intercepted (stored under collection "attendance"):
 *   face_summary.json        ← att_face_summary
 *   fingerprint_summary.json ← att_fingerprint_summary
 *   greathr_summary.json     ← att_ghr_summary
 *   punch_details.json       ← att_punch_details
 *
 * Reference file intercepted (stored under its own collection "employeeMaster",
 * completely separate from attendance data so it is never affected by the
 * 6-month attendance retention cleanup):
 *   employee_master.json     ← employeeMaster/master
 *
 * Add <script src="firebase-config.js"></script> BEFORE this file in each page.
 * Add <script src="att-data.js"></script>        in <head> of all dashboard pages.
 */


(function () {

  const MAP = {
    'face_summary.json':        { store: 'attendance',     key: 'att_face_summary' },
    'fingerprint_summary.json': { store: 'attendance',     key: 'att_fingerprint_summary' },
    'greathr_summary.json':     { store: 'attendance',     key: 'att_ghr_summary' },
    'punch_details.json':       { store: 'attendance',     key: 'att_punch_details' },
    'employee_master.json':     { store: 'employeeMaster', key: 'master' },
  };
  function normalizeName(n) {
    return (n || '').toString().trim().replace(/\s+/g, ' ').toLowerCase();
  }

  // Punch records carry the Employee ID under different field names
  // depending on source (face/fingerprint use "User ID", Great HR uses
  // "Employee No"). This is confirmed reliable even when the Name spelling
  // differs between sources for the same person.
  // Normalizes an Employee ID for comparison. Numeric IDs are stripped of
  // leading zeros (so "076" and "76" are recognized as the same person) —
  // alphanumeric IDs (e.g. "SEC_001", "H001", "IN_001") are left untouched
  // since those aren't meant to be treated as padded numbers.
  function normalizeId(id) {
    if (id == null) return '';
    const s = String(id).trim();
    if (/^\d+$/.test(s)) return String(parseInt(s, 10));
    return s;
  }

  function getPunchId(p) {
    const id = p['User ID'] || p['Employee No'];
    return id != null ? normalizeId(id) : '';
  }

  // ── Firestore helpers ────────────────────────────────────────────────────
  // Firestore splits large arrays into chunks (max 1 MB per document).
  // We store each dataset as:
  //   collection: <store>          e.g. "attendance" or "employeeMaster"
  //   document:   <key>            e.g. "att_face_summary" or "master"
  //   subcollection: "chunks"      each doc holds { data: <json string>, part: n }

  let _db = null;

  function getDb() {
    if (_db) return _db;
    try {
      const app = firebase.app();
      _db = firebase.firestore(app);
    } catch (e) {
      // Firebase not initialised yet — will fall back to localStorage
      _db = null;
    }
    return _db;
  }

  // localStorage cache key is namespaced by store so employee master and
  // attendance data never collide even if a filename were reused.
  function cacheKey(store, key) {
    return store === 'employeeMaster' ? 'emp_master' : key;
  }

  async function readFromFirestore(store, key) {
    const db = getDb();
    if (!db) return null;
    try {
      const chunks = await db.collection(store).doc(key).collection('chunks').orderBy('part').get();
      if (chunks.empty) return null;
      let all = [];
      chunks.forEach(d => { all = all.concat(JSON.parse(d.data().data)); });
      try { localStorage.setItem(cacheKey(store, key), JSON.stringify(all)); } catch(e){}
      return all;
    } catch (e) {
      console.warn('Firestore read failed, falling back to localStorage:', e.message);
      return null;
    }
  }

  function readFromLocalStorage(store, key) {
    const raw = localStorage.getItem(cacheKey(store, key));
    return raw ? JSON.parse(raw) : [];
  }

  // ── Intercept fetch ──────────────────────────────────────────────────────
  const _fetch = window.fetch.bind(window);

  window.fetch = function (url, opts) {
    const filename = String(url).split('/').pop().split('?')[0];
    const entry = MAP[filename];
    if (!entry) return _fetch(url, opts);

    // Try Firestore first, fall back to localStorage
    return readFromFirestore(entry.store, entry.key).then(data => {
      const result = data || readFromLocalStorage(entry.store, entry.key);
      return {
        ok:   true,
        json: () => Promise.resolve(result),
        text: () => Promise.resolve(JSON.stringify(result)),
      };
    });
  };

  // ── Shared Employee Master / Team lookup helper ─────────────────────────
  // Any dashboard page can call window.AttData.buildTeamLookup() to get a
  // lookup keyed by both Employee ID and Employee Name, then use
  // window.AttData.getTeam(lookup, id, name) to dynamically join an
  // attendance record to its Team without duplicating Team data on every
  // attendance record in storage.

  async function getEmployeeMaster() {
    const data = await readFromFirestore('employeeMaster', 'master');
    return data || readFromLocalStorage('employeeMaster', 'master');
  }

  function buildLookupFromMaster(master) {
    const byId = {}, byName = {};
    (master || []).forEach(e => {
      if (e['Employee ID']) byId[normalizeId(e['Employee ID'])] = e['Team'];
      if (e['Employee Name']) byName[normalizeName(e['Employee Name'])] = e['Team'];
    });
    return { byId, byName };
  }
  // Groups Employee Master rows by Employee ID (same logic used inside
  // getDayAttendance) and returns a lookup from EVERY normalized name
  // variant -> { id, displayName, normNames }. Lets other pages (like the
  // Day View table) collapse name-spelling duplicates the same way the
  // Present/Absent counts already do.
  function getNameGroups(master) {
    const groups = {};
    let noIdCounter = 0;
    (master || []).forEach(e => {
      const rawId = e['Employee ID'] ? normalizeId(e['Employee ID']) : '';
      const rawName = e['Employee Name'] ? String(e['Employee Name']).trim() : '';
      const groupKey = rawId || `__noid_${noIdCounter++}`;
      if (!groups[groupKey]) {
        groups[groupKey] = { id: rawId, displayName: rawName, normNames: new Set() };
      }
      if (rawName) groups[groupKey].normNames.add(normalizeName(rawName));
      if (rawName && rawName.length > (groups[groupKey].displayName || '').length) {
        groups[groupKey].displayName = rawName;
      }
    });

    const byNormName = {};
    Object.values(groups).forEach(g => {
      g.normNames.forEach(n => { byNormName[n] = g; });
    });
    return byNormName;
  }

  async function buildTeamLookup() {
    const master = await getEmployeeMaster();
    return buildLookupFromMaster(master);
  }

  // Employee ID is preferred; falls back to Employee Name; returns '' (Unassigned) if no match.
  function getTeam(lookup, employeeId, employeeName) {
    if (!lookup) return '';
    const id = employeeId != null ? normalizeId(employeeId) : '';
    const name = employeeName != null ? normalizeName(employeeName) : '';
    if (id && lookup.byId[id]) return lookup.byId[id];
    if (name && lookup.byName[name]) return lookup.byName[name];
    return '';
  }

  // List of distinct Team names present in the Employee Master, for populating
  // the Team filter dropdown on Dashboard / Reports / View by Date.
  function listTeams(lookup) {
    const set = new Set();
    Object.values(lookup.byId).forEach(t => { if (t) set.add(t); });
    Object.values(lookup.byName).forEach(t => { if (t) set.add(t); });
    return Array.from(set).sort();
  }

  // ── Shared attendance-calculation core ───────────────────────────────────
  // These functions are the single source of truth for First In / Last Out /
  // Working Hours / Present / Absent logic. Every page (Day View, Employee
  // Lookup, Reports) must use these instead of re-implementing the rules,
  // so results are always identical no matter where they're shown.

  // Sunday = Weekend. Employees are never marked Absent on Sundays and
  // Sundays are excluded from attendance-percentage math. (Future holidays
  // can be added here later without touching the pages that call this.)
  function isSunday(dateStr) {
    if (!dateStr) return false;
    return new Date(dateStr + 'T00:00:00').getDay() === 0;
  }

  function isWorkingDay(dateStr) {
    return !isSunday(dateStr);
  }

  // First In / Last Out / Working Hours for one employee on one date,
  // computed across ALL THREE sources (Face + Fingerprint + Great HR)
  // combined. This must NEVER be filtered by attendance-mode tab — mode
  // tabs only change which punch rows are *displayed*, never these values.
  function getCrossModeTimes(punchData, name, date) {
    const target = normalizeName(name);
    const allForDay = (punchData || []).filter(
      p => normalizeName(p.Name) === target && (p.Date || '').slice(0, 10) === date
    );

    const modeCounts = { face: 0, fingerprint: 0, greathr: 0 };
    allForDay.forEach(p => { if (modeCounts[p.Mode] !== undefined) modeCounts[p.Mode]++; });
    const totalPunches = allForDay.length;

    const times = allForDay.map(p => p.Time).filter(Boolean).sort();

    if (times.length === 0) {
      return { firstIn: '—', lastOut: '—', hours: '—', totalPunches, modeCounts };
    }
    if (times.length === 1) {
      return { firstIn: times[0].slice(0, 5), lastOut: '—', hours: '—', totalPunches, modeCounts };
    }

    const firstIn = times[0].slice(0, 5);
    const lastOut = times[times.length - 1].slice(0, 5);
    const [fh, fm] = firstIn.split(':').map(Number);
    const [lh, lm] = lastOut.split(':').map(Number);
    const hours = Math.round(((lh * 60 + lm) - (fh * 60 + fm)) / 60 * 100) / 100;

    return { firstIn, lastOut, hours, totalPunches, modeCounts };
  }
  // Same as getCrossModeTimes, but matches against a SET of normalized name
  // spellings that all belong to the same Employee ID (handles cases like
  // "Dhamodharan G" / "Dhamodharan Gopal" both being the same person).
  // Matches punches by Employee ID first (reliable across name-spelling
  // variants); falls back to name matching only for punches that have no
  // ID field at all.
  function getCrossModeTimesForId(punchData, id, date, normNamesSet) {
    const allForDay = (punchData || []).filter(p => {
      if ((p.Date || '').slice(0, 10) !== date) return false;
      const pid = getPunchId(p);
      if (id && pid === id) return true;
      if (!pid && normNamesSet && normNamesSet.has(normalizeName(p.Name))) return true;
      return false;
    });

    const modeCounts = { face: 0, fingerprint: 0, greathr: 0 };
    allForDay.forEach(p => { if (modeCounts[p.Mode] !== undefined) modeCounts[p.Mode]++; });
    const totalPunches = allForDay.length;

    const times = allForDay.map(p => p.Time).filter(Boolean).sort();

    if (times.length === 0) {
      return { firstIn: '—', lastOut: '—', hours: '—', totalPunches, modeCounts };
    }
    if (times.length === 1) {
      return { firstIn: times[0].slice(0, 5), lastOut: '—', hours: '—', totalPunches, modeCounts };
    }

    const firstIn = times[0].slice(0, 5);
    const lastOut = times[times.length - 1].slice(0, 5);
    const [fh, fm] = firstIn.split(':').map(Number);
    const [lh, lm] = lastOut.split(':').map(Number);
    const hours = Math.round(((lh * 60 + lm) - (fh * 60 + fm)) / 60 * 100) / 100;

    return { firstIn, lastOut, hours, totalPunches, modeCounts };
  }

  function getCrossModeTimesForNames(punchData, normNamesSet, date) {
    const allForDay = (punchData || []).filter(
      p => normNamesSet.has(normalizeName(p.Name)) && (p.Date || '').slice(0, 10) === date
    );

    const modeCounts = { face: 0, fingerprint: 0, greathr: 0 };
    allForDay.forEach(p => { if (modeCounts[p.Mode] !== undefined) modeCounts[p.Mode]++; });
    const totalPunches = allForDay.length;

    const times = allForDay.map(p => p.Time).filter(Boolean).sort();

    if (times.length === 0) {
      return { firstIn: '—', lastOut: '—', hours: '—', totalPunches, modeCounts };
    }
    if (times.length === 1) {
      return { firstIn: times[0].slice(0, 5), lastOut: '—', hours: '—', totalPunches, modeCounts };
    }

    const firstIn = times[0].slice(0, 5);
    const lastOut = times[times.length - 1].slice(0, 5);
    const [fh, fm] = firstIn.split(':').map(Number);
    const [lh, lm] = lastOut.split(':').map(Number);
    const hours = Math.round(((lh * 60 + lm) - (fh * 60 + fm)) / 60 * 100) / 100;

    return { firstIn, lastOut, hours, totalPunches, modeCounts };
  }

  // Present/Absent/Weekend determination for every employee in the Employee
  // Master, for one date. One punch from ANY source is enough to be Present.
  // Sundays are always 'weekend', never 'absent'.
  async function getDayAttendance(date, punchData, employeeMasterOverride) {
    const master = employeeMasterOverride || await getEmployeeMaster();
    const weekend = isSunday(date);

    const dayPunches = (punchData || []).filter(p => (p.Date || '').slice(0, 10) === date);
    // Primary match: Employee ID (reliable across name-spelling variants).
    const idsWithPunch = new Set(dayPunches.map(getPunchId).filter(Boolean));
    // Fallback match: normalized name, only for punches with no ID at all.
    const namesWithPunchNoId = new Set(
      dayPunches.filter(p => !getPunchId(p)).map(p => normalizeName(p.Name))
    );

    // Group Employee Master rows by Employee ID, since the same ID can appear
    // with multiple name spellings (e.g. "Vigneshwaran R," vs "Vigneshwaran.R").
    // Rows with no Employee ID are kept as their own separate entries.
    const groups = {};
    let noIdCounter = 0;

    (master || []).forEach(e => {
      const rawId = e['Employee ID'] ? String(e['Employee ID']).trim() : '';
      const rawName = e['Employee Name'] ? String(e['Employee Name']).trim() : '';
      const team = e['Team'] || '';
      const groupKey = rawId || `__noid_${noIdCounter++}`;

      if (!groups[groupKey]) {
        groups[groupKey] = { id: rawId, displayName: rawName, team, normNames: new Set() };
      }
      if (rawName) groups[groupKey].normNames.add(normalizeName(rawName));
      if (!groups[groupKey].team && team) groups[groupKey].team = team;
      if (rawName && rawName.length > (groups[groupKey].displayName || '').length) {
        groups[groupKey].displayName = rawName;
      }
    });

    const employees = Object.values(groups).map(g => {
      const hasPunch = g.id
        ? idsWithPunch.has(g.id)
        : [...g.normNames].some(n => namesWithPunchNoId.has(n));

      const times = hasPunch
        ? getCrossModeTimesForId(punchData, g.id, date, g.normNames)
        : { firstIn: '—', lastOut: '—', hours: '—', totalPunches: 0, modeCounts: { face: 0, fingerprint: 0, greathr: 0 } };

      let status;
      if (hasPunch) status = 'present';
      else if (weekend) status = 'weekend';
      else status = 'absent';

      return { id: g.id, name: g.displayName, team: g.team, status, ...times };
    });

    return { date, isWeekend: weekend, employees };
  }

  // Login-status color/tooltip (Early / On Time / Late) — single source of truth
  function getLoginStatus(timeStr) {
    if (!timeStr || timeStr === '—') return null;
    const [h, m] = timeStr.split(':').map(Number);
    const mins = h * 60 + m;
    if (mins < 9 * 60 + 30)  return { color: 'var(--green)', tooltip: 'Early Login' };
    if (mins <= 9 * 60 + 45) return { color: '#4a9eff',      tooltip: 'On Time' };
    return                          { color: 'var(--amber)', tooltip: 'Late Login' };
  }

  // Expected working hours for a date (Saturday = half day, else full day)
  function getExpectedHours(dateStr) {
    if (!dateStr) return 8;
    const day = new Date(dateStr + 'T00:00:00').getDay();
    return day === 6 ? 4 : 8;
  }

  // Full / Half / Short badge classification for a given hours value + date
  function getAttendanceStatus(hoursNum, dateStr) {
    const full = getExpectedHours(dateStr);
    const half = full / 2;
    const h = (hoursNum === '—' || hoursNum === undefined || hoursNum === null) ? 0 : Number(hoursNum);
    if (h >= full) return { cls: 'badge-full', label: 'Full day' };
    if (h >= half) return { cls: 'badge-half', label: 'Half day' };
    return { cls: 'badge-short', label: 'Short' };
  }

  window.AttData = {
    getEmployeeMaster,
    buildTeamLookup,
    getTeam,
    listTeams,
    isSunday,
    isWorkingDay,
    getPunchId,
    normalizeId,
    getCrossModeTimes,
    getCrossModeTimesForNames,
    getCrossModeTimesForId,
    getDayAttendance,
    getLoginStatus,
    getExpectedHours,
    getAttendanceStatus,
  };

})();
