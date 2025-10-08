/* ===========================
 *  user-scope.js  (shared)
 *  — Namespacing storage & DB per-akun
 *  — Alias kompat lama (kunci publik) tetap ada
 *  — Event "account:changed" ketika UID berubah
 *  — Broadcast lintas-tab agar mirror cepat sinkron
 * =========================== */
(function () {
  'use strict';

  // ---- Kunci yang di-mirror ke key publik (dibaca kode lama) ----
  const _MIRROR_KEYS = new Set(['pdfHistori', 'pdfHistoriRev']);

  // ---- BroadcastChannel tunggal untuk modul account ----
  const bc = ('BroadcastChannel' in window) ? new BroadcastChannel('bribox-account') : null;

  // (opsional) dengarkan broadcast dari drive untuk re-check akun
  const bcDrive = ('BroadcastChannel' in window) ? new BroadcastChannel('bribox-drive') : null;
  bcDrive?.addEventListener?.('message', (ev) => {
    if (ev?.data?.type === 'drive-auth') scheduleWatch(0);
  });

  // ---- Ambil UID akun saat ini, atau 'anon' ----
  function getUidOrAnon() {
    try {
      const ds = (window.DriveSync && typeof DriveSync.getUser === 'function') ? DriveSync.getUser() : null;
      if (ds && ds.uid) return String(ds.uid);
    } catch {}
    try {
      if (window.Auth) {
        const u = (typeof Auth.currentUser === 'function' ? Auth.currentUser() : (Auth.user || null));
        if (u && u.uid) return String(u.uid);
        if (typeof Auth.getUid === 'function') return String(Auth.getUid() || 'anon');
      }
    } catch {}
    return 'anon';
  }

  // ---- Bentuk nama kunci per-akun ----
  function nsKey(baseKey) { return `${baseKey}::${getUidOrAnon()}`; }

  // ---- Util kecil ----
  function cloneDefault(v) {
    if (Array.isArray(v)) return v.slice();
    if (v && typeof v === 'object') return { ...v };
    return v;
  }

  // ---- Baca/tulis JSON per-akun + mirror ke kunci publik untuk kompat lama ----
  function readNsJSON(baseKey, fallback) {
    try {
      const raw = localStorage.getItem(nsKey(baseKey));
      if (raw == null) return cloneDefault(fallback);
      const val = JSON.parse(raw);
      return (val == null ? cloneDefault(fallback) : val);
    } catch { return cloneDefault(fallback); }
  }

  // Catatan:
  // - Param ke-3 kompat lama: jika boolean true => paksa mirror ke baseKey.
  // - Jika string => paksa mirror ke nama itu.
  // - Default: hanya mirror bila baseKey terdaftar di _MIRROR_KEYS.
  function writeNsJSON(baseKey, value, alsoMirrorPublicKey = baseKey) {
    const safe = JSON.stringify(value ?? null);
    const k = nsKey(baseKey);
    try { localStorage.setItem(k, safe); } catch {}

    let pubKey = null;
    let force = false;
    if (alsoMirrorPublicKey === true) { pubKey = baseKey; force = true; }
    else if (typeof alsoMirrorPublicKey === 'string') { pubKey = alsoMirrorPublicKey; force = true; }
    else { pubKey = baseKey; } // default candidate

    if (force || _MIRROR_KEYS.has(pubKey)) {
      try { localStorage.setItem(pubKey, safe); } catch {}
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

  // ---- Nilai default untuk alias publik ----
  function defaultByKey(baseKey) {
    if (baseKey === 'pdfHistori')    return '[]';
    if (baseKey === 'pdfHistoriRev') return '0';
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

  // ---- API publik untuk atur daftar kunci mirror ----
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
    try { document.dispatchEvent(new CustomEvent('account:changed', { detail: { uid } })); } catch {}
    try { bc?.postMessage({ type: 'account', uid }); } catch {}
  }

  function watchAuthAndSwapStores() {
    const now = getUidOrAnon();
    if (now !== __lastUid) {
      __lastUid = now;
      // refresh semua alias publik agar UI lama baca data akun aktif
      syncAllMirrors();
      // beritahu semua modul/page untuk re-open DB / rehydrate data jika perlu
      dispatchAccountChanged(now);
    }
  }

  // Debounce kecil untuk event beruntun
  let _watchTimer = null;
  function scheduleWatch(delay = 150) {
    if (_watchTimer) clearTimeout(_watchTimer);
    _watchTimer = setTimeout(() => { _watchTimer = null; watchAuthAndSwapStores(); }, delay);
  }

  // ---- Hook ke sistem auth/drive bila tersedia ----
  if (window.DriveSync && typeof DriveSync.onAuthStateChanged === 'function') {
    try { DriveSync.onAuthStateChanged(() => scheduleWatch(0)); } catch {}
  }
  // Auth versi kita mem-broadcast event 'auth:change'
  window.addEventListener('auth:change', () => scheduleWatch(0));

  // Fallback polling ringan + lifecycle event
  const POLL_MS = 1500;
  setInterval(() => scheduleWatch(0), POLL_MS);
  window.addEventListener('pageshow', () => scheduleWatch(0));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') scheduleWatch(0); });

  // ---- Jika ada perubahan storage kunci per-akun di tab lain → sinkronkan alias publik ----
  window.addEventListener('storage', (e) => {
    try {
      if (!e || !e.key) return;
      const m = e.key.match(/^([^:]+)::(.+)$/); // "<baseKey>::<uid>"
      if (m && _MIRROR_KEYS.has(m[1])) syncAliasPublic(m[1]);
    } catch {}
  });

  // ---- Terima broadcast lintas-tab ----
  bc?.addEventListener('message', (ev) => {
    const msg = ev?.data || {};
    if (msg.type === 'account') {
      syncAllMirrors();
    } else if (msg.type === 'ns' && typeof msg.baseKey === 'string') {
      syncAliasPublic(msg.baseKey);
    }
  });

  // ---- Ekspor ke global ----
  window.AccountNS = {
    // core
    getUidOrAnon,
    nsKey,
    readNsJSON,
    writeNsJSON,
    currentDbName,
    // LS per-akun (alias sederhana, aman dipakai di modul lain)
    getItem: (k) => {
      try { return localStorage.getItem(nsKey(k)); } catch { return null; }
    },
    setItem: (k, v) => {
      try { localStorage.setItem(nsKey(k), v); } catch {}
      if (_MIRROR_KEYS.has(k)) syncAliasPublic(k);
      try { bc?.postMessage({ type:'ns', baseKey: k }); } catch {}
    },
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
  'use strict';

  const bc = ('BroadcastChannel' in window) ? new BroadcastChannel('bribox-account') : null;

  function acctUid(){
    try { return window.AccountNS?.getUidOrAnon?.() || 'anon'; } catch { return 'anon'; }
  }
  function nsKey(k){
    if (window.AccountNS?.nsKey) return window.AccountNS.nsKey(k);
    const id = acctUid() || 'anon';
    return `bribox:${id}:${k}`;
  }

  // pastikan kunci mirror utama terdaftar
  try {
    window.AccountNS?.addMirrorKey?.('pdfHistori');
    window.AccountNS?.addMirrorKey?.('pdfHistoriRev');
  } catch {}

  window.AccountStore = {
    nsKey,
    getUid: () => acctUid(),

    loadHistori(){
      try{
        const h = localStorage.getItem(nsKey('pdfHistori'));
        if (h != null) localStorage.setItem('pdfHistori', h);
        const r = localStorage.getItem(nsKey('pdfHistoriRev'));
        if (r != null) localStorage.setItem('pdfHistoriRev', r);
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
      try { bc?.postMessage({ type:'ns', baseKey:'pdfHistori' }); } catch {}
      try { bc?.postMessage({ type:'ns', baseKey:'pdfHistoriRev' }); } catch {}
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
      try { bc?.postMessage({ type:'ns', baseKey:'pdfHistoriRev' }); } catch {}
    }
  };

  document.addEventListener('DOMContentLoaded', ()=> window.AccountStore.loadHistori());
})();
