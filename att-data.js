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
      if (e['Employee ID']) byId[String(e['Employee ID']).trim()] = e['Team'];
      if (e['Employee Name']) byName[String(e['Employee Name']).trim()] = e['Team'];
    });
    return { byId, byName };
  }

  async function buildTeamLookup() {
    const master = await getEmployeeMaster();
    return buildLookupFromMaster(master);
  }

  // Employee ID is preferred; falls back to Employee Name; returns '' (Unassigned) if no match.
  function getTeam(lookup, employeeId, employeeName) {
    if (!lookup) return '';
    const id = employeeId != null ? String(employeeId).trim() : '';
    const name = employeeName != null ? String(employeeName).trim() : '';
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
    const allForDay = (punchData || []).filter(
      p => p.Name === name && (p.Date || '').slice(0, 10) === date
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
    const namesWithPunch = new Set(dayPunches.map(p => p.Name));

    const employees = (master || []).map(e => {
      const id = e['Employee ID'] ? String(e['Employee ID']).trim() : '';
      const name = e['Employee Name'] ? String(e['Employee Name']).trim() : '';
      const team = e['Team'] || '';
      const hasPunch = namesWithPunch.has(name);
      const times = hasPunch
        ? getCrossModeTimes(punchData, name, date)
        : { firstIn: '—', lastOut: '—', hours: '—', totalPunches: 0, modeCounts: { face: 0, fingerprint: 0, greathr: 0 } };

      let status;
      if (hasPunch) status = 'present';
      else if (weekend) status = 'weekend';
      else status = 'absent';

      return { id, name, team, status, ...times };
    });

    // Employees who punched but have no Employee Master record must still
    // count as present, or Present + Absent will undercount vs the raw
    // punch-based "All" total shown on the Day View tabs.
    const masterNames = new Set(employees.map(e => e.name));
    namesWithPunch.forEach(name => {
      if (!masterNames.has(name)) {
        const times = getCrossModeTimes(punchData, name, date);
        employees.push({ id: '', name, team: '', status: 'present', ...times });
      }
    });

    return { date, isWeekend: weekend, employees };
  }

  window.AttData = {
    getEmployeeMaster,
    buildTeamLookup,
    getTeam,
    listTeams,
    isSunday,
    isWorkingDay,
    getCrossModeTimes,
    getDayAttendance,
  };

})();
