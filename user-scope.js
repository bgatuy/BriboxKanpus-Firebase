/* ===========================
 *  user-scope.js  (shared)
 *  — Namespacing storage & DB per-akun
 *  — Alias kompat lama (kunci publik) tetap ada
 *  — Event "account:changed" ketika UID berubah
 * =========================== */
(function () {
  // ---- Konfigurasi default: kunci publik yang ingin kita mirror ----
  const _MIRROR_KEYS = new Set(['pdfHistori']); // tambah sesuai kebutuhan: 'monthlyForm', 'monthlyData', dll.

  // ---- Ambil UID akun saat ini, atau 'anon' ----
  function getUidOrAnon() {
    try {
      // Prioritas: DriveSync (kalau kamu pakai auth wrapper sendiri)
      const ds = (window.DriveSync && typeof DriveSync.getUser === 'function') ? DriveSync.getUser() : null;
      if (ds && ds.uid) return String(ds.uid);

      // Alternatif: objek Auth (kalau kamu punya)
      if (window.Auth) {
        const u = Auth.user || (typeof Auth.currentUser === 'function' ? Auth.currentUser() : null);
        if (u && u.uid) return String(u.uid);
      }
    } catch {}
    return 'anon';
  }

  // ---- Bentuk nama kunci per-akun ----
  function nsKey(baseKey) { return `${baseKey}::${getUidOrAnon()}`; }

  // ---- Baca/tulis JSON ke localStorage per-akun + mirror ke kunci publik untuk kompat lama ----
  function readNsJSON(baseKey, fallback) {
    try {
      const raw = localStorage.getItem(nsKey(baseKey));
      if (raw == null) return cloneDefault(fallback);
      const val = JSON.parse(raw);
      return (val == null ? cloneDefault(fallback) : val);
    } catch {
      return cloneDefault(fallback);
    }
  }
  function writeNsJSON(baseKey, value, alsoMirrorPublicKey = baseKey) {
    const safe = JSON.stringify(value);
    localStorage.setItem(nsKey(baseKey), safe);
    if (alsoMirrorPublicKey) {
      // alias publik (kompat modul lama): isinya SELALU milik akun aktif
      localStorage.setItem(alsoMirrorPublicKey, safe);
    }
    // notifikasi ke listener lain (opsional)
    try {
      window.dispatchEvent(new StorageEvent('storage', { key: nsKey(baseKey), newValue: safe }));
    } catch {}
  }

  // ---- Nama IndexedDB per-akun ----
  function currentDbName(base = 'PdfStorage') {
    const uid = getUidOrAnon();
    return uid === 'anon' ? base : `${base}__${uid}`;
  }

  // ---- Sinkron alias publik untuk 1 kunci ----
  function syncAliasPublic(baseKey) {
    try {
      const raw = localStorage.getItem(nsKey(baseKey)) ?? defaultByKey(baseKey);
      localStorage.setItem(baseKey, raw);
    } catch {}
  }

  // ---- Sinkron alias publik untuk semua kunci mirror ----
  function syncAllMirrors() {
    _MIRROR_KEYS.forEach((k) => syncAliasPublic(k));
  }

  // ---- Util kecil ----
  function defaultByKey(baseKey) {
    // fallback default untuk mirror bila belum ada data per-akun
    // kamu bisa extend kalau butuh tipe lain
    if (baseKey === 'pdfHistori') return '[]';
    return '[]';
  }
  function cloneDefault(v) {
    if (Array.isArray(v)) return v.slice();
    if (v && typeof v === 'object') return { ...v };
    return v;
  }

  // ---- API untuk menambah/atur daftar kunci yang di-mirror publik ----
  function setMirrorKeys(arr) {
    _MIRROR_KEYS.clear();
    (arr || []).forEach(k => _MIRROR_KEYS.add(String(k)));
    syncAllMirrors();
  }
  function addMirrorKey(key) { _MIRROR_KEYS.add(String(key)); syncAliasPublic(String(key)); }
  function removeMirrorKey(key) { _MIRROR_KEYS.delete(String(key)); }

  // ---- Eventing: beri tahu halaman lain ketika akun berganti ----
  let __lastUid = null;
  function dispatchAccountChanged(uid) {
    try {
      document.dispatchEvent(new CustomEvent('account:changed', { detail: { uid } }));
    } catch {}
  }

  async function watchAuthAndSwapStores() {
    const now = getUidOrAnon();
    if (now !== __lastUid) {
      __lastUid = now;
      // refresh semua alias publik agar UI lama baca data akun aktif
      syncAllMirrors();
      // beritahu semua modul/page untuk re-open DB / rehydrate data jika perlu
      dispatchAccountChanged(now);
    }
  }

  // ---- Hook ke sistem auth bila tersedia ----
  if (window.DriveSync && typeof DriveSync.onAuthStateChanged === 'function') {
    try { DriveSync.onAuthStateChanged(watchAuthAndSwapStores); } catch {}
  }
  // Fallback polling ringan + lifecycle event
  setInterval(watchAuthAndSwapStores, 1500);
  window.addEventListener('pageshow', watchAuthAndSwapStores);

  // ---- Optional: kalau ada perubahan storage antar-tab untuk kunci per-akun, perbaharui alias publiknya ----
  window.addEventListener('storage', (e) => {
    try {
      if (!e || !e.key) return;
      // kalau ada entry "baseKey::uid" berubah di tab lain → sinkronkan alias publik untuk baseKey itu
      const m = e.key.match(/^([^:]+)::(.+)$/);
      if (m && _MIRROR_KEYS.has(m[1])) {
        syncAliasPublic(m[1]);
      }
    } catch {}
  });

  // ---- Ekspor ke global ----
  window.AccountNS = {
    // core
    getUidOrAnon,
    nsKey,
    readNsJSON,
    writeNsJSON,
    currentDbName,

    // mirror control
    setMirrorKeys,
    addMirrorKey,
    removeMirrorKey,
    syncAliasPublic,
    watchAuthAndSwapStores,
  };

  // ---- Bootstrap sekali ----
  watchAuthAndSwapStores();
})();
