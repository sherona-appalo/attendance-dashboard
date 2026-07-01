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

  window.AttData = {
    getEmployeeMaster,
    buildTeamLookup,
    getTeam,
    listTeams,
  };

})();