/* drive-queue.js — Offline Upload Queue for Google Drive (BRIBOX KANPUS)
 *
 * Flow:
 * - Kalau Drive siap ⇒ upload langsung (silent).
 * - Kalau gagal/offline ⇒ simpan ke IndexedDB, lalu di-flush otomatis saat online/drive tersambung.
 *
 * Depends: drive-sync.js (window.DriveSync.*)
 */

;(() => {
  const DB_NAME  = 'BriboxQueue';
  const DB_STORE = 'uploads';
  let   db       = null;
  let   flushing = false;
  let   flushTimer = null;

  // ---------- IndexedDB ----------
  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(DB_STORE)) {
          const store = db.createObjectStore(DB_STORE, { keyPath: 'id', autoIncrement: true });
          store.createIndex('by_status',  'status',    { unique: false });
          store.createIndex('by_created', 'createdAt', { unique: false });
          store.createIndex('by_hash',    'hash',      { unique: false });
        }
      };
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror   = () => reject(new Error('Gagal buka IndexedDB'));
    });
  }
  async function getDb(){ return db || (db = await openDb()); }
  function storeTx(mode = 'readonly') { return getDb().then(d => d.transaction(DB_STORE, mode).objectStore(DB_STORE)); }

  function put(item){
    return storeTx('readwrite').then(store => new Promise((res, rej) => {
      const req = store.put(item);
      req.onsuccess = () => res(req.result);
      req.onerror   = () => rej(new Error('Gagal simpan queue'));
    }));
  }
  function del(id){
    return storeTx('readwrite').then(store => new Promise((res, rej) => {
      const req = store.delete(id);
      req.onsuccess = () => res(true);
      req.onerror   = () => rej(new Error('Gagal hapus item queue'));
    }));
  }

  async function findPendingByHash(hash){
    if (!hash) return null;
    const store = await storeTx('readonly');
    const idx = store.index('by_hash');
    return new Promise((resolve, reject) => {
      const req = idx.openCursor(IDBKeyRange.only(hash));
      req.onsuccess = (e) => {
        const cur = e.target.result;
        if (!cur) return resolve(null);
        const v = cur.value;
        if (v.status === 'pending') return resolve(v);
        cur.continue();
      };
      req.onerror = () => reject(new Error('Gagal baca index hash'));
    });
  }

  async function allPending(limit = 100) {
    const store = await storeTx('readonly');
    const idx = store.index('by_status');
    const out = [];
    return new Promise((resolve, reject) => {
      const req = idx.openCursor(IDBKeyRange.only('pending'));
      req.onsuccess = (e) => {
        const cur = e.target.result;
        if (cur) {
          out.push(cur.value);
          if (out.length >= limit) return resolve(out);
          cur.continue();
        } else resolve(out);
      };
      req.onerror = () => reject(new Error('Gagal membaca queue'));
    });
  }

  // ---------- Helpers ----------
  const isOnline = () => (typeof navigator !== 'undefined' ? navigator.onLine : true);
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  async function ensureDriveReady(){
    if (window.DriveSync?.isLogged?.()) return true;
    try { if (window.DriveSync?.tryResume) return await DriveSync.tryResume(); } catch {}
    return false;
  }

  // ---------- Core upload ----------
  async function tryUploadItem(item){
    const ready = await ensureDriveReady();
    if (!ready) throw new Error('Drive belum tersambung');
    // Upload selalu ke ROOT Bribox Kanpus, nama file asli (simpleName:true)
    return await DriveSync.uploadPdf(item.file, null, null, { simpleName: true });
  }

  // ---------- Flush logic ----------
  async function flush() {
    if (flushing) return;
    flushing = true;
    try {
      const items = await allPending(200);
      for (const it of items) {
        // backoff sederhana + jitter
        const attempts = it.attempts || 0;
        const base = Math.min(30000, Math.max(0, attempts) * 1000);
        const jitter = Math.floor(Math.random() * 400);
        if (base) await sleep(base + jitter);

        try {
          await tryUploadItem(it);
          await del(it.id);
          // console.debug('[DriveQueue] uploaded:', it.name);
        } catch (e) {
          it.attempts  = (it.attempts || 0) + 1;
          it.lastError = String(e?.message || e);
          it.status    = 'pending';
          await put(it);
          // console.warn('[DriveQueue] retry later:', it.name, it.lastError);
        }
      }
    } finally {
      flushing = false;
    }
  }

  function scheduleFlushSoon() {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, 1500);
  }

  // ---------- Queue API ----------
  async function enqueue(file, hash) {
    const item = {
      status    : 'pending',
      name      : (file && file.name) || 'noname.pdf',
      hash      : hash || null,
      file      : file,          // Blob tersimpan via structured clone
      attempts  : 0,
      createdAt : Date.now()
    };

    // dedupe: jika hash sama & masih pending ⇒ jangan double
    const dup = await findPendingByHash(item.hash);
    if (dup) return dup.id;

    return await put(item);
  }

  async function enqueueOrUpload(file, hash /*, _moduleName ignored */) {
    if (!file) throw new Error('File kosong');

    // kalau online & drive ready ⇒ coba upload langsung
    if (isOnline() && (await ensureDriveReady())) {
      try {
        const res = await DriveSync.uploadPdf(file, null, null, { simpleName: true });
        return { uploaded: true, res };
      } catch {
        // jatuh ke queue
      }
    }

    const id = await enqueue(file, hash || null);
    scheduleFlushSoon();
    return { uploaded: false, queuedId: id };
  }

  function init() {
    // flush ketika online kembali
    window.addEventListener('online', scheduleFlushSoon);
    // flush saat tab aktif
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') scheduleFlushSoon();
    });
    // flush saat ada broadcast login dari halaman lain
    if ('BroadcastChannel' in window) {
      try {
        const bc = new BroadcastChannel('bribox-drive');
        bc.addEventListener('message', (ev) => {
          if (ev.data?.type === 'drive-auth' && ev.data.status === 'in') scheduleFlushSoon();
        });
      } catch {}
    }
    // flush awal setelah load
    scheduleFlushSoon();
  }

  // ---------- Public API ----------
  window.DriveQueue = {
    init,
    enqueue,
    enqueueOrUpload,
    flush,
    allPending
  };
})();
