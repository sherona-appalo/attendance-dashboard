/**
 * att-data.js
 * Intercepts fetch() calls for the 4 JSON files and serves from localStorage.
 * Keys written by upload.html match exactly what is intercepted here.
 *
 * localStorage keys → JSON files intercepted:
 *   att_face_summary        → face_summary.json
 *   att_fingerprint_summary → fingerprint_summary.json
 *   att_ghr_summary         → greathr_summary.json
 *   att_punch_details       → punch_details.json
 *
 * Add <script src="att-data.js"></script> to the <head> of:
 *   index.html, reports.html, employee.html, dayview.html
 * That is the ONLY change needed to those files.
 */
(function () {
  const MAP = {
    'face_summary.json':        'att_face_summary',
    'fingerprint_summary.json': 'att_fingerprint_summary',
    'greathr_summary.json':     'att_ghr_summary',
    'punch_details.json':       'att_punch_details',
  };

  const _fetch = window.fetch.bind(window);

  window.fetch = function (url, opts) {
    const filename = String(url).split('/').pop().split('?')[0];
    const key = MAP[filename];
    if (key) {
      const raw = localStorage.getItem(key);
      const data = raw ? JSON.parse(raw) : [];
      return Promise.resolve({
        ok:   true,
        json: () => Promise.resolve(data),
        text: () => Promise.resolve(raw || '[]'),
      });
    }
    return _fetch(url, opts);
  };
})();