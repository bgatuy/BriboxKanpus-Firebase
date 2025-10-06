/* ===========================
 *  user-scope.js  (shared)
 *  — Namespacing storage & DB per-akun
 *  — Alias kompat lama (kunci publik) tetap ada
 *  — Event "account:changed" ketika UID berubah
 *  — Broadcast lintas-tab agar mirror cepat sinkron
 * =========================== */
(function () {
  // ---- Kunci yang di-mirror ke key publik (dibaca kode lama) ----
  const _MIRROR_KEYS = new Set(['pdfHistori', 'pdfHistoriRev']);

  // ---- Ambil UID akun saat ini, atau 'anon' ----
  function getUidOrAnon() {
    try {
      const ds = (window.DriveSync && typeof DriveSync.getUser === 'function') ? DriveSync.getUser() : null;
      if (ds && ds.uid) return String(ds.uid);
      if (window.Auth) {
        const u = Auth.user || (typeof Auth.currentUser === 'function' ? Auth.currentUser() : null);
        if (u && u.uid) return String(u.uid);
      }
    } catch {}
    return 'anon';
  }

  // ---- Bentuk nama kunci per-akun ----
  function nsKey(baseKey) { return `${baseKey}::${getUidOrAnon()}`; }

  // ---- Baca/tulis JSON per-akun + mirror ke kunci publik untuk kompat lama ----
  function readNsJSON(baseKey, fallback) {
    try {
      const raw = localStorage.getItem(nsKey(baseKey));
      if (raw == null) return cloneDefault(fallback);
      const val = JSON.parse(raw);
      return (val == null ? cloneDefault(fallback) : val);
    } catch { return cloneDefault(fallback); }
  }
  function writeNsJSON(baseKey, value, alsoMirrorPublicKey = baseKey) {
    const safe = JSON.stringify(value);
    const k = nsKey(baseKey);
    localStorage.setItem(k, safe);
    if (alsoMirrorPublicKey) {
      // alias publik (kompat modul lama): isinya SELALU milik akun aktif
      localStorage.setItem(alsoMirrorPublicKey, safe);
    }
    // notify intra-tab
    try { document.dispatchEvent(new CustomEvent('ns:changed', { detail: { baseKey, key: k } })); } catch {}
    // notify lintas-tab (opsional)
    try { bc?.postMessage({ type: 'ns', baseKey }); } catch {}
  }

  // ---- Nama IndexedDB per-akun ----
  function currentDbName(base = 'PdfStorage') {
    const uid = getUidOrAnon();
    return uid === 'anon' ? base : `${base}__${uid}`;
  }

  // ---- Sinkron alias publik untuk 1 kunci ----
  function defaultByKey(baseKey) {
    if (baseKey === 'pdfHistori')   return '[]';
    if (baseKey === 'pdfHistoriRev')return '0';
    return '[]';
  }
  function syncAliasPublic(baseKey) {
    try {
      const raw = localStorage.getItem(nsKey(baseKey));
      localStorage.setItem(baseKey, raw ?? defaultByKey(baseKey));
    } catch {}
  }

  // ---- Sinkron alias publik untuk semua kunci mirror ----
  function syncAllMirrors() { _MIRROR_KEYS.forEach((k) => syncAliasPublic(k)); }

  // ---- Util kecil ----
  function cloneDefault(v) {
    if (Array.isArray(v)) return v.slice();
    if (v && typeof v === 'object') return { ...v };
    return v;
  }

  // ---- API publik untuk atur daftar kunci mirror ----
  function setMirrorKeys(arr) {
    _MIRROR_KEYS.clear();
    (arr || []).forEach(k => _MIRROR_KEYS.add(String(k)));
    syncAllMirrors();
  }
  function addMirrorKey(key) { _MIRROR_KEYS.add(String(key)); syncAliasPublic(String(key)); }
  function removeMirrorKey(key) { _MIRROR_KEYS.delete(String(key)); }

  // ---- BroadcastChannel untuk lintas-tab ----
  const bc = ('BroadcastChannel' in window) ? new BroadcastChannel('bribox-account') : null;

  // ---- Eventing: beri tahu halaman lain ketika akun berganti ----
  let __lastUid = null;
  function dispatchAccountChanged(uid) {
    try { document.dispatchEvent(new CustomEvent('account:changed', { detail: { uid } })); } catch {}
    try { bc?.postMessage({ type: 'account', uid }); } catch {}
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

  // ---- Jika ada perubahan storage kunci per-akun di tab lain → sinkronkan alias publik ----
  window.addEventListener('storage', (e) => {
    try {
      if (!e || !e.key) return;
      const m = e.key.match(/^([^:]+)::(.+)$/);
      if (m && _MIRROR_KEYS.has(m[1])) syncAliasPublic(m[1]);
    } catch {}
  });

  // ---- Terima broadcast lintas-tab ----
  bc?.addEventListener('message', (ev) => {
    const msg = ev?.data || {};
    if (msg.type === 'account')    syncAllMirrors();
    else if (msg.type === 'ns' && typeof msg.baseKey === 'string') syncAliasPublic(msg.baseKey);
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

/* ==============================================================
 *  AccountStore (kompat lama) — dibridge ke AccountNS
 *  Gunakan namespace yang SAMA dengan AccountNS agar konsisten
 * ============================================================== */
(function(){
  function acctUid(){
    try { return window.AccountNS?.getUidOrAnon?.() || 'anon'; } catch { return 'anon'; }
  }
  function nsKey(k){
    if (window.AccountNS?.nsKey) return window.AccountNS.nsKey(k);
    const id = acctUid() || 'anon';
    return `bribox:${id}:${k}`;
  }

  window.AccountStore = {
    nsKey,
    getUid: () => acctUid(),
    loadHistori(){
      try{
        const h = localStorage.getItem(nsKey('pdfHistori'));
        if (h) localStorage.setItem('pdfHistori', h);
        const r = localStorage.getItem(nsKey('pdfHistoriRev'));
        if (r) localStorage.setItem('pdfHistoriRev', r);
      }catch{}
    },
    saveHistori(arr){
      const s = JSON.stringify(arr||[]);
      try{
        localStorage.setItem(nsKey('pdfHistori'), s);
        localStorage.setItem('pdfHistori', s); // mirror utk kode lama
        // broadcast rev otomatis
        const rev = String(Date.now());
        localStorage.setItem(nsKey('pdfHistoriRev'), rev);
        localStorage.setItem('pdfHistoriRev', rev);
      }catch{}
      // kabari modul lain
      try { document.dispatchEvent(new CustomEvent('ns:changed', { detail: { baseKey: 'pdfHistori' } })); } catch {}
      try { ('BroadcastChannel' in window) && new BroadcastChannel('bribox-account').postMessage({ type:'ns', baseKey:'pdfHistori' }); } catch {}
      try { ('BroadcastChannel' in window) && new BroadcastChannel('bribox-account').postMessage({ type:'ns', baseKey:'pdfHistoriRev' }); } catch {}
      return arr;
    },
    setRev(rev){
      const v = String(rev||0);
      try{
        localStorage.setItem(nsKey('pdfHistoriRev'), v);
        localStorage.setItem('pdfHistoriRev', v);
      }catch{}
      // kabari modul lain
      try { document.dispatchEvent(new CustomEvent('ns:changed', { detail: { baseKey: 'pdfHistoriRev' } })); } catch {}
      try { ('BroadcastChannel' in window) && new BroadcastChannel('bribox-account').postMessage({ type:'ns', baseKey:'pdfHistoriRev' }); } catch {}
    }
  };

  document.addEventListener('DOMContentLoaded', ()=> window.AccountStore.loadHistori());
})();
