/* drive-queue.js — Offline Upload Queue for Google Drive (BRIBOX KANPUS)
 *
 * Tujuan:
 * - Jika upload ke Google Drive gagal (offline / token belum ada), simpan file ke IndexedDB.
 * - Saat jaringan kembali online atau Drive tersambung, otomatis coba upload ulang (flush queue).
 *
 * Dependensi: drive-sync.js (window.DriveSync.*)
 * Cara pakai (ringkas):
 *   <script defer src="drive-sync.js"></script>
 *   <script defer src="drive-queue.js"></script>
 *   <script>
 *     document.addEventListener('DOMContentLoaded', () => DriveQueue.init());
 *
 *     // Saat ingin upload:
 *     await DriveQueue.enqueueOrUpload(file, hash, 'trackmate');
 *   </script>
 */

;(()=>{
  const DB_NAME  = 'BriboxQueue';
  const DB_STORE = 'uploads';
  let   db       = null;
  let   flushing = false;

  function openDb(){
    return new Promise((resolve, reject)=>{
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = (e)=>{
        const db = e.target.result;
        if(!db.objectStoreNames.contains(DB_STORE)){
          const store = db.createObjectStore(DB_STORE, { keyPath:'id', autoIncrement:true });
          store.createIndex('by_status', 'status', { unique:false });
          store.createIndex('by_created', 'createdAt', { unique:false });
          store.createIndex('by_hash', 'hash', { unique:false });
        }
      };
      req.onsuccess = (e)=> resolve(e.target.result);
      req.onerror   = ()=> reject(new Error('Gagal buka IndexedDB'));
    });
  }

  async function getDb(){
    if(db) return db;
    db = await openDb();
    return db;
  }

  function tx(storeName, mode='readonly'){
    return getDb().then(d => d.transaction(storeName, mode).objectStore(storeName));
  }

  function put(item){
    return new Promise(async (resolve, reject)=>{
      const store = await tx(DB_STORE, 'readwrite');
      const req = store.put(item);
      req.onsuccess = ()=> resolve(req.result);
      req.onerror   = ()=> reject(new Error('Gagal simpan queue'));
    });
  }

  function del(id){
    return new Promise(async (resolve, reject)=>{
      const store = await tx(DB_STORE, 'readwrite');
      const req = store.delete(id);
      req.onsuccess = ()=> resolve(true);
      req.onerror   = ()=> reject(new Error('Gagal hapus item queue'));
    });
  }

  async function allPending(limit=100){
    const store = await tx(DB_STORE, 'readonly');
    const idx = store.index('by_status');
    const out = [];
    return new Promise((resolve, reject)=>{
      const range = IDBKeyRange.only('pending');
      const req = idx.openCursor(range);
      req.onsuccess = (e)=>{
        const cursor = e.target.result;
        if(cursor){
          out.push(cursor.value);
          if(out.length >= limit) return resolve(out);
          cursor.continue();
        } else resolve(out);
      };
      req.onerror = ()=> reject(new Error('Gagal membaca queue'));
    });
  }

  function isOnline(){ return typeof navigator !== 'undefined' ? navigator.onLine : true; }

  async function tryUploadItem(item){
    if(!window.DriveSync || !DriveSync.isLogged()){
      // Coba silent connect: jika pernah consent, ini akan sukses tanpa klik
      try{
        if(window.DriveSync && DriveSync.signInSilent) await DriveSync.signInSilent();
      }catch{ /* silent fail */ }
    }
    if(!window.DriveSync || !DriveSync.isLogged()) throw new Error('Drive belum tersambung');
    // Lakukan upload
    const res = await DriveSync.uploadPdf(item.file, item.hash, item.moduleName);
    return res;
  }

  function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }

  async function flush(){
    if(flushing) return;
    flushing = true;
    try{
      const items = await allPending(200);
      for(const it of items){
        // Backoff sederhana berdasar attempts
        const attempts = it.attempts || 0;
        const delay = Math.min(30000, attempts * 1000); // max 30s
        if(delay) await sleep(delay);

        try{
          await tryUploadItem(it);
          await del(it.id);
          console.debug('[DriveQueue] uploaded:', it.name);
        }catch(e){
          // update attempts & lastError
          it.attempts = (it.attempts || 0) + 1;
          it.lastError = String(e && e.message || e);
          it.status = 'pending';
          await put(it);
          console.warn('[DriveQueue] retry later:', it.name, it.lastError);
        }
      }
    } finally {
      flushing = false;
    }
  }

  async function enqueue(file, hash, moduleName){
    const item = {
      status    : 'pending',
      name      : file && file.name || 'noname.pdf',
      hash      : hash || String(Date.now()),
      moduleName: moduleName || 'general',
      file      : file,  // Blob aman disimpan di IndexedDB
      attempts  : 0,
      createdAt : Date.now()
    };
    const id = await put(item);
    return id;
  }

  async function enqueueOrUpload(file, hash, moduleName){
    if(!file) throw new Error('File kosong');
    // Jika online & drive ready ⇒ langsung upload
    if(isOnline() && window.DriveSync && DriveSync.isLogged()){
      try{
        const res = await DriveSync.uploadPdf(file, hash, moduleName);
        return { uploaded:true, res };
      }catch(e){
        // Jatuh ke queue
      }
    }
    // Simpan ke queue
    const id = await enqueue(file, hash, moduleName);
    // Jadwalkan flush jika kembali online
    scheduleFlushSoon();
    return { uploaded:false, queuedId:id };
  }

  let flushTimer = null;
  function scheduleFlushSoon(){
    if(flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, 1500);
  }

  function init(){
    // Flush saat online kembali
    window.addEventListener('online', scheduleFlushSoon);
    // Flush saat tab fokus
    document.addEventListener('visibilitychange', ()=>{
      if(document.visibilityState === 'visible') scheduleFlushSoon();
    });
    // Flush beberapa saat setelah load
    scheduleFlushSoon();
  }

  // Public API
  window.DriveQueue = {
    init,
    enqueue,
    enqueueOrUpload,
    flush,
    allPending
  };
})();
