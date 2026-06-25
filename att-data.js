/**
 * att-data.js
 * Intercepts fetch() calls for the 4 JSON files.
 * Reads from Firestore (cloud) with localStorage as fallback/cache.
 *
 * Files intercepted:
 *   face_summary.json        ← att_face_summary
 *   fingerprint_summary.json ← att_fingerprint_summary
 *   greathr_summary.json     ← att_ghr_summary
 *   punch_details.json       ← att_punch_details
 *
 * Add <script src="firebase-config.js"></script> BEFORE this file in each page.
 * Add <script src="att-data.js"></script>        in <head> of all 4 dashboard pages.
 */
(function () {

  const MAP = {
    'face_summary.json':        'att_face_summary',
    'fingerprint_summary.json': 'att_fingerprint_summary',
    'greathr_summary.json':     'att_ghr_summary',
    'punch_details.json':       'att_punch_details',
  };

  // ── Firestore helpers ────────────────────────────────────────────────────
  // Firestore splits large arrays into chunks (max 1 MB per document).
  // We store each dataset as:
  //   collection: "attendance"
  //   document:   <key>            e.g. "att_face_summary"
  //   field:      "data"           JSON string of the array

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

  async function readFromFirestore(key) {
    const db = getDb();
    if (!db) return null;
    try {
      const chunks = await db.collection('attendance').doc(key).collection('chunks').orderBy('part').get();
      if (chunks.empty) return null;
      let all = [];
      chunks.forEach(d => { all = all.concat(JSON.parse(d.data().data)); });
      try { localStorage.setItem(key, JSON.stringify(all)); } catch(e){}
      return all;
    } catch (e) {
      console.warn('Firestore read failed, falling back to localStorage:', e.message);
      return null;
    }
  }

  function readFromLocalStorage(key) {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  }

  // ── Intercept fetch ──────────────────────────────────────────────────────
  const _fetch = window.fetch.bind(window);

  window.fetch = function (url, opts) {
    const filename = String(url).split('/').pop().split('?')[0];
    const key = MAP[filename];
    if (!key) return _fetch(url, opts);

    // Try Firestore first, fall back to localStorage
    return readFromFirestore(key).then(data => {
      const result = data || readFromLocalStorage(key);
      return {
        ok:   true,
        json: () => Promise.resolve(result),
        text: () => Promise.resolve(JSON.stringify(result)),
      };
    });
  };

})();