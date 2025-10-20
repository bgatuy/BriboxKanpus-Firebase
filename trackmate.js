// ====== Trackmate ======
//
// Fitur inti:
// - Per akun (localStorage & IndexedDB namespaced per UID; guest terpisah dari akun login)
// - Sinkron lintas device via manifest .bribox_histori__<uid>.json di "Bribox Kanpus"
// - Upload PDF asli ke Google Drive, prioritas DriveSync/DriveQueue (tanpa subfolder, langsung di root "Bribox Kanpus")
// - Fallback ke gapi kalau memang ada gapi client (opsional)
// - Parsing & output lama dipertahankan, posisi TTD aman (auto-calibrate)

'use strict';

// ---------- HASH UTIL ----------
async function sha256File(file) {
  try {
    const buf = await file.arrayBuffer();
    const hashBuf = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2,'0')).join('');
  } catch {
    return `fz_${file.size}_${file.lastModified}_${Math.random().toString(36).slice(2,10)}`;
  }
}

// ---------- SIDEBAR ----------
const sidebar   = document.querySelector('.sidebar');
const overlay   = document.getElementById('sidebarOverlay') || document.querySelector('.sidebar-overlay');
const sidebarLinks = document.querySelectorAll('.sidebar a');

function openSidebar(){ sidebar?.classList.add('visible'); overlay?.classList.add('show'); document.body.style.overflow='hidden'; }
function closeSidebar(){ sidebar?.classList.remove('visible'); overlay?.classList.remove('show'); document.body.style.overflow=''; }
function toggleSidebar(){ (sidebar?.classList.contains('visible') ? closeSidebar() : openSidebar()); }
window.toggleSidebar = toggleSidebar;

overlay?.addEventListener('click', closeSidebar);
document.addEventListener('click', (e)=> {
  const isMobile = window.matchMedia('(max-width: 768px)').matches;
  if (!isMobile) return;
  const clickInsideSidebar = sidebar?.contains(e.target);
  const clickOnToggle = e.target.closest?.('.sidebar-toggle-btn');
  if (sidebar?.classList.contains('visible') && !clickInsideSidebar && !clickOnToggle) closeSidebar();
});
document.addEventListener('keydown', (e)=>{ if (e.key==='Escape' && sidebar?.classList.contains('visible')) closeSidebar(); });
sidebarLinks.forEach(a=>a.addEventListener('click', closeSidebar));

document.addEventListener('DOMContentLoaded', function () {
  const title = document.querySelector('.dashboard-header h1')?.textContent?.toLowerCase() || "";
  const body = document.body;
  if (title.includes('trackmate'))      body.setAttribute('data-page', 'trackmate');
  else if (title.includes('appsheet'))  body.setAttribute('data-page', 'appsheet');
  else if (title.includes('serah'))     body.setAttribute('data-page', 'serah');
  else if (title.includes('merge'))     body.setAttribute('data-page', 'merge');
  try { window.DriveQueue?.init?.(); } catch {}
});

// ---------- QUERY DOM ----------
const fileInput    = document.getElementById('pdfFile');
const output       = document.getElementById('output');
const copyBtn      = document.getElementById('copyBtn');
const lokasiSelect = document.getElementById('inputLokasi');

// ---------- USER CONTEXT (per-akun) ----------
function getUidOrAnon() {
  try {
    return (window.DriveSync?.getUser?.()?.uid) ||
           (window.Auth && (Auth.user?.uid || Auth.currentUser?.()?.uid)) ||
           'anon';
  } catch { return 'anon'; }
}
const PUBLIC_HIST_KEY = 'pdfHistori';
function userHistKey(){
  if (window.AccountNS?.nsKey) return window.AccountNS.nsKey(PUBLIC_HIST_KEY);
  return `${PUBLIC_HIST_KEY}::${getUidOrAnon()}`;
}
function syncHistAliasFromUser(){
  const raw = localStorage.getItem(userHistKey()) ?? '[]';
  localStorage.setItem(PUBLIC_HIST_KEY, raw);
}
let __lastUid = null;
let __rehydrateTimer = null;
async function watchAuthAndSwapStores(){
  const now = getUidOrAnon();
  if (now !== __lastUid){
    __lastUid = now;
    try{ if (db){ db.close(); db=null; } }catch{}
    // refresh alias local
    syncHistAliasFromUser();
    // rehydrate dari Drive (manifest) — throttle 1x dalam 1 detik
    if (__rehydrateTimer) clearTimeout(__rehydrateTimer);
    __rehydrateTimer = setTimeout(async () => {
      try{
        const cloud = await driveLoadHistoriManifest();
        if (Array.isArray(cloud)) {
          localStorage.setItem(userHistKey(), JSON.stringify(cloud));
          syncHistAliasFromUser();
        }
      }catch(e){ console.warn('rehydrate manifest fail:', e); }
    }, 1000);
   }
}
watchAuthAndSwapStores();
window.DriveSync?.onAuthStateChanged?.(watchAuthAndSwapStores);
window.addEventListener('storage', (e)=>{ if (e.key && e.key.startsWith('pdfHistori::')) syncHistAliasFromUser(); });
window.addEventListener('pageshow', watchAuthAndSwapStores);
window.addEventListener('beforeunload', ()=>{ try{ if(db){ db.close(); db=null; } }catch{} });

// ---------- AUTO-CALIBRATE (anchor kolom TTD) ----------
async function autoCalibratePdf(buffer){
  if (!window.pdfjsLib?.getDocument) return null;
  const doc = await pdfjsLib.getDocument({ data: buffer }).promise;
  const page = await doc.getPage(1);
  const items = (await page.getTextContent()).items || [];

  // "Diselesaikan Oleh"
  let atas = items.find(it => /Diselesaikan\s*Oleh/i.test(it.str));
  if(!atas){
    for(let i=0;i<items.length-1;i++){
      if(/Diselesaikan/i.test(items[i].str) && /Oleh/i.test(items[i+1].str)){ atas = items[i]; break; }
    }
  }
  if (!atas){ try{doc.destroy()}catch{}; return null; }

  const xA = atas.transform[4], yA = atas.transform[5];

  // "Nama & Tanda Tangan" di bawahnya yang se-kolom
  const kandidat = items.filter(it =>
    /Nama\s*&?\s*Tanda\s*&?\s*Tangan/i.test(it.str) && it.transform && it.transform[5] < yA
  );
  let bawah=null, best=Infinity;
  for(const it of kandidat){
    const x = it.transform[4], y = it.transform[5];
    const dx=Math.abs(x-xA), dy=Math.max(0,yA-y);
    const score = 1.6*dx + dy;
    if (dx <= 120 && score < best){ best = score; bawah = it; }
  }

  // titik dasar (x,y) untuk nama di kolom tengah TTD
  let x = xA + 95;
  let y = bawah ? (bawah.transform[5] + 12) : (yA - 32);

  // info tambahan (opsional)
  const first = r => items.find(it => r.test(it.str));
  const labUK = first(/Unit\s*Kerja/i), labKC = first(/Kantor\s*Cabang/i);
  let linesUK = 0;
  if (labUK && labKC){
    const yTop = labUK.transform[5], yBot = labKC.transform[5]-1;
    const xL = labUK.transform[4] + 40, xR = xL + 260;
    const ys=[];
    for(const it of items){
      if(!it.transform) continue;
      const x0=it.transform[4], y0=it.transform[5];
      if (y0<=yTop+2 && y0>=yBot-2 && x0>=xL && x0<=xR){
        const yy = Math.round(y0/2)*2;
        if(!ys.some(v=>Math.abs(v-yy)<2)) ys.push(yy);
      }
    }
    linesUK = Math.max(1, Math.min(5, ys.length||0));
  }

  const labSol = first(/Solusi\/?Perbaikan/i), labStatus = first(/Status\s*Pekerjaan/i);
  let linesSOL = 0;
  if (labSol && labStatus){
    const yTop = labSol.transform[5] + 1, yBot = labStatus.transform[5] + 2;
    const xL = labSol.transform[4] + 120, xR = xL + 300;
    const ys=[];
    for(const it of items){
      if(!it.transform) continue;
      const x0=it.transform[4], y0=it.transform[5];
      if (y0>=yBot && y0<=yTop && x0>=xL && x0<=xR){
        const yy = Math.round(y0/2)*2;
        if(!ys.some(v=>Math.abs(v-yy)<2)) ys.push(yy);
      }
    }
    linesSOL = Math.max(1, Math.min(6, ys.length||0));
  }

  try{ doc.destroy() }catch{}
  return { x, y, linesUK, linesSOL, dx:0, dy:0, v:1 };
}

// ---------- INDEXEDDB (per-UID) ----------
const DB_VERSION  = 2;
const STORE_NAME  = "pdfs";
const STORE_BLOBS = "pdfBlobs";
let db;

function currentDbName() {
  try {
    if (window.AccountNS?.currentDbName) return window.AccountNS.currentDbName('PdfStorage');
  } catch {}
  return 'PdfStorage';
}

function openDb() {
  const DB_NAME = currentDbName();
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const _db = event.target.result;
      if (!_db.objectStoreNames.contains(STORE_NAME))  _db.createObjectStore(STORE_NAME,  { keyPath:'id', autoIncrement:true });
      if (!_db.objectStoreNames.contains(STORE_BLOBS)) _db.createObjectStore(STORE_BLOBS, { keyPath:'contentHash' });
    };

    request.onsuccess = (event) => {
      db = event.target.result;
      db.__name = DB_NAME;
      db.onversionchange = () => { try{ db.close(); }catch{} db=null; };
      resolve(db);
    };
    request.onerror  = (event) => reject(event.target.error || event.target.errorCode);
    request.onblocked = () => console.warn("IndexedDB open blocked");
  });
}
async function ensureDb(){
  const want = currentDbName();
  if (db && db.__name === want) return db;
  try{ if(db){ db.close(); } }catch{}
  db = null;
  return await openDb();
}

/** simpan blob by hash (+meta) */
async function saveBlobByHash(fileOrBlob, contentHash) {
  const blob = fileOrBlob instanceof Blob ? fileOrBlob : null;
  if (!blob) throw new Error("saveBlobByHash: argumen harus File/Blob");
  if (blob.type !== "application/pdf") throw new Error("Type bukan PDF");
  if (!blob.size) throw new Error("PDF kosong");
  if (!contentHash) throw new Error("contentHash wajib");

  const database = await ensureDb();
  if (!database) throw new Error("IndexedDB tidak tersedia / gagal dibuka");

  let meta = null;
  try {
    const buf = await blob.arrayBuffer();
    if (typeof autoCalibratePdf === "function") meta = await autoCalibratePdf(buf);
  } catch (e) { console.warn("autoCalibrate gagal (saveBlobByHash):", e); }

  return new Promise((resolve, reject) => {
    const tx = database.transaction([STORE_BLOBS], "readwrite");
    const store = tx.objectStore(STORE_BLOBS);
    const value = {
      contentHash,
      name: (/** @type {File} */(fileOrBlob)).name || "document.pdf",
      size: blob.size,
      dateAdded: new Date().toISOString(),
      data: blob,
      meta
    };
    const req = store.put(value);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error || new Error("Tx error"));
    req.onerror   = () => reject(req.error || new Error("Req error"));
  });
}

/** simpan ke store lama (kompat) */
async function savePdfToIndexedDB_keepSchema(fileOrBlob, { contentHash } = {}) {
  const blob = fileOrBlob instanceof Blob ? fileOrBlob : null;
  if (!blob) throw new Error('savePdfToIndexedDB: argumen harus File/Blob');
  if (blob.type !== 'application/pdf') throw new Error('Type bukan PDF');
  if (!blob.size) throw new Error('PDF kosong');

  let meta = null;
  try {
    const buf = await blob.arrayBuffer();
    if (typeof autoCalibratePdf === "function") meta = await autoCalibratePdf(buf);
  } catch (e) { console.warn('autoCalibrate gagal:', e); }

  const database = await ensureDb();
  if (!database) throw new Error("IndexedDB tidak tersedia / gagal dibuka");

  await new Promise((resolve, reject) => {
    const tx = database.transaction([STORE_NAME], 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const payload = {
      name: (/** @type {File} */(fileOrBlob)).name || '(tanpa-nama)',
      dateAdded: new Date().toISOString(),
      data: blob,
      contentHash: contentHash || null,
      meta
    };
    const req = store.add(payload);
    tx.oncomplete = resolve;
    tx.onerror    = () => reject(tx.error || new Error('Tx error'));
    req.onerror   = () => reject(req.error || new Error('Req error'));
  });

  console.log(`✅ Tersimpan (pdfs): ${fileOrBlob.name} (${(blob.size/1024).toFixed(1)} KB), meta:`, meta);
}

// ---------- GOOGLE DRIVE (Bribox Kanpus) ----------

// Manifest (sinkron antar device di root "Bribox Kanpus")
const MANIFEST_BASENAME = '.bribox_histori';
function manifestName() { return `${MANIFEST_BASENAME}__${getUidOrAnon()}.json`; }

// helper base64 (untuk gapi fallback)
function base64FromBlobAsync(blob){
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result||'').split(',')[1]||'');
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });
}

// ambil manifest dari Drive
async function driveLoadHistoriManifest() {
  try {
    if (window.DriveSync?.getJson) {
      const obj = await DriveSync.getJson(manifestName());
      return obj?.data ?? null;
    }
  } catch (e) {
    console.warn('DriveSync getJson fail:', e);
  }

  // gapi fallback
  if (!await driveIsReady_gapi()) return null;
  try {
    const parentId = await driveEnsureRoot_gapi();
    const q = [`'${parentId}' in parents`,`trashed=false`,`name='${manifestName().replace(/'/g,"\\'")}'`].join(' and ');
    const r = await gapi.client.drive.files.list({ q, fields: 'files(id,name)' });
    const f = r?.result?.files?.[0];
    if (!f) return null;
    const fileResp = await gapi.client.drive.files.get({ fileId: f.id, alt: 'media' });
    return JSON.parse(fileResp.body || 'null');
  } catch(e) {
    console.warn('load manifest (gapi) fail:', e);
    return null;
  }
}

// simpan manifest ke Drive (debounced oleh scheduleSaveManifest)
async function driveSaveHistoriManifest(arr) {
  const json = JSON.stringify(Array.isArray(arr) ? arr : [], null, 0);

  // DriveSync path
  if (window.DriveSync?.putJson) {
    try {
      await DriveSync.putJson(manifestName(), JSON.parse(json));
      return true;
    } catch (e) {
      console.warn('DriveSync putJson fail:', e);
    }
  }

  // gapi fallback
  if (!await driveIsReady_gapi()) return false;
  try {
    const parentId = await driveEnsureRoot_gapi();
    const search = await gapi.client.drive.files.list({
      q: [`'${parentId}' in parents`,`trashed=false`,`name='${manifestName().replace(/'/g,"\\'")}'`].join(' and '),
      fields: 'files(id,name)'
    });
    const existing = search?.result?.files?.[0];

    const boundary = '-------314159265358979323846';
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelim = `\r\n--${boundary}--`;
    const metadata = { name: manifestName(), parents: [parentId], mimeType: 'application/json' };
    const body = delimiter + 'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
                 json + closeDelim;
    const common = {
      params: { uploadType: 'multipart', fields: 'id' },
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body
    };

    let resp;
    if (existing) {
      resp = await gapi.client.request({ path: `/upload/drive/v3/files/${existing.id}`, method: 'PATCH', ...common });
    } else {
      resp = await gapi.client.request({ path: '/upload/drive/v3/files', method: 'POST', ...common });
    }
    return !!resp?.result?.id;
  } catch(e) {
    console.warn('save manifest (gapi) fail:', e);
    return false;
  }
}

// Debounce penyimpanan manifest agar tidak terlalu sering
let _manifestTimer = null;
function scheduleSaveManifest() {
  if (_manifestTimer) clearTimeout(_manifestTimer);
  _manifestTimer = setTimeout(async () => {
    _manifestTimer = null;
    try { await driveSaveHistoriManifest(readHistoriSafe()); } catch {}
  }, 800);
}

// ==== Upload PDF asli: DriveSync/DriveQueue first ====
async function uploadViaDriveQueue(file, contentHash) {
  if (!file) throw new Error('File kosong');
  if (!window.DriveQueue?.enqueueOrUpload && !window.DriveSync?.savePdfByHash) {
    return { ok: false, reason: 'NO_API' };
  }

  try {
    // Pakai queue kalau ada — langsung upload bila online & login, atau di-queue jika tidak
    if (window.DriveQueue?.enqueueOrUpload) {
      const { uploaded } = await DriveQueue.enqueueOrUpload(file, contentHash);
      if (uploaded) {
        showToast('☁️ Tersimpan ke Google Drive', 2500, 'success');
        return { ok: true, immediate: true };
      }
      showToast('☁️ Dijadwalkan ke Google Drive (offline/tertunda)', 2800, 'info');
      return { ok: true, immediate: false };
    }
    // Fallback langsung via DriveSync (idempoten by hash)
    await DriveSync.savePdfByHash(file, contentHash);
    showToast('☁️ Tersimpan ke Google Drive', 2500, 'success');
    return { ok: true, immediate: true };
  } catch (e) {
    return { ok: false, reason: String(e?.message || e) };
  }
}

// ==== (Opsional) GAPI FALLBACK jika memang gapi client tersedia ====
async function driveIsReady_gapi() {
  try { return !!(window.gapi?.client?.drive && window.gapi.client.getToken()); }
  catch { return false; }
}
async function driveEnsureRoot_gapi(){
  const DRIVE_ROOT_NAME = 'Bribox Kanpus';
  const q = [
    `mimeType='application/vnd.google-apps.folder'`,
    `name='${DRIVE_ROOT_NAME.replace(/'/g,"\\'")}'`,
    `'root' in parents`,
    `trashed=false`
  ].join(' and ');
  const res = await gapi.client.drive.files.list({ q, fields:'files(id,name)', spaces:'drive' });
  if (res?.result?.files?.length) return res.result.files[0].id;
  const create = await gapi.client.drive.files.create({
    fields:'id',
    resource:{ name:DRIVE_ROOT_NAME, mimeType:'application/vnd.google-apps.folder', parents:['root'] }
  });
  return create.result.id;
}
async function driveFindByHash_gapi(parentId, contentHash) {
  const q = [
    `'${parentId}' in parents`,
    `trashed=false`,
    `appProperties has { key='contentHash' and value='${contentHash}' }`,
    `mimeType='application/pdf'`
  ].join(' and ');
  const res = await gapi.client.drive.files.list({ q, fields: 'files(id,name)', spaces: 'drive' });
  return res?.result?.files?.[0] || null;
}
async function driveUploadPdfOriginal_gapi({ file, contentHash, parentId }) {
  const boundary = '-------314159265358979323846';
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelim = `\r\n--${boundary}--`;
  const metadata = {
    name: (file?.name || 'document.pdf'),
    parents: [parentId],
    mimeType: 'application/pdf',
    appProperties: {
      contentHash: contentHash || '',
      module: 'trackmate',
      uploadedAt: new Date().toISOString()
    },
    description: 'BRIBOX KANPUS original PDF (auto-synced)'
  };
  const base64Data = await base64FromBlobAsync(file);
  const body =
    delimiter + 'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) +
    delimiter + 'Content-Type: application/pdf\r\nContent-Transfer-Encoding: base64\r\n\r\n' +
    base64Data + closeDelim;

  const res = await gapi.client.request({
    path: '/upload/drive/v3/files',
    method: 'POST',
    params: { uploadType: 'multipart', fields: 'id' },
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body
  });
  return res?.result?.id || null;
}

// API yang dipakai handler Copy
async function tryUploadOriginalToDrive(file, contentHash /*, metaIgnored */) {
  // A) Jalur utama: DriveQueue/DriveSync
  const q = await uploadViaDriveQueue(file, contentHash);
  if (q.ok) return true;

  // B) Fallback opsional: hanya kalau gapi client benar2 tersedia
  if (await driveIsReady_gapi()) {
    try {
      const parentId = await driveEnsureRoot_gapi();
      const dup      = await driveFindByHash_gapi(parentId, contentHash);
      if (dup?.id) { showToast('☁️ Sudah ada di Google Drive', 2200, 'info'); return true; }

      const id = await driveUploadPdfOriginal_gapi({ file, contentHash, parentId });
      if (id) { showToast('☁️ Tersimpan ke Google Drive', 2500, 'success'); return true; }
    } catch (e) {
      console.warn('gapi fallback error:', e);
    }
  }

  showToast('ℹ Google Drive belum tersambung', 2500, 'info');
  return false;
}

// ---------- Helpers ----------
const clean = (x) => String(x || '')
  .replace(/[\u00A0\u2007\u202F]/g, ' ')
  .replace(/\u00C2/g, '')
  .replace(/\s+/g, ' ')
  .trim();
function stripLeadingColon(s) { return (s || '').replace(/^\s*:+\s*/, ''); }
function formatTanggalIndonesia(tanggal) {
  if (!tanggal) return '-';
  const bulan = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
  const [dd, mm, yyyy] = tanggal.split('/');
  return `${dd} ${bulan[parseInt(mm,10)-1]} ${yyyy}`;
}
function extractFlexibleBlock(lines, startLabel, stopLabels = []) {
  const norm = s => (s || '').replace(/[\u00A0\u2007\u202F]/g, ' ').replace(/\s+/g, ' ').trim();
  const text = (lines || []).map(x => x || '').join('\n');
  const startRe = new RegExp(`${startLabel}\\s*:\\s*`, 'i');
  const mStart  = startRe.exec(text);
  if (!mStart) return '';
  const tail = text.slice(mStart.index + mStart[0].length);
  const stopParts = [];
  for (const lbl of stopLabels) stopParts.push(`${lbl}\\s*:\\s*`);
  if (stopLabels.some(s => /^tanggal$/i.test(s))) stopParts.push(`Tanggal(?:\\s*Tiket)?\\s+\\d{1,2}[/-]\\d{1,2}[/-]\\d{2,4}`);
  if (stopLabels.some(s => /^kantor\\s*cabang$/i.test(s))) stopParts.push(`(?<!^)Kantor\\s*Cabang(?!\\s*:)`);
  stopParts.push(`[\\r\\n]+[A-Za-z][A-Za-z/() ]+\\s*:\\s*`);
  const stopPattern = stopParts.join('|');
  const cutRe = new RegExp(`([\\s\\S]*?)(?=${stopPattern})`, 'i');
  const mCut  = cutRe.exec(tail);
  const captured = mCut ? mCut[1] : tail;
  return norm(captured);
}

// ---------- State ----------
let unitKerja = "-", kantorCabang = "-", tanggalFormatted = "-", tanggalRaw = "",
    problem = "-", berangkat = "-", tiba = "-", mulai = "-", selesai = "-",
    solusi = "-", jenisPerangkat = "-", serial = "-", merk = "-", type = "-",
    pic = "-", status = "-";

// ---------- Events ----------
lokasiSelect?.addEventListener("change", updateOutput);

fileInput?.addEventListener('change', async function () {
  const file = fileInput.files[0];
  if (!file || file.type !== 'application/pdf') return;

  const reader = new FileReader();
  reader.onload = async function () {
    try {
      const typedarray = new Uint8Array(reader.result);
      const pdf = await pdfjsLib.getDocument(typedarray).promise;

      let rawText = '';
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        rawText += content.items.map(item => item.str).join('\n') + '\n';
      }

      const lines = rawText.split('\n');

      unitKerja       = stripLeadingColon(extractFlexibleBlock(lines,'Unit Kerja',['Kantor Cabang','Tanggal']) || '-');
      kantorCabang    = stripLeadingColon(extractFlexibleBlock(lines,'Kantor Cabang',['Tanggal','Pelapor']) || '-');
      tanggalRaw      = rawText.match(/Tanggal(?:\sTiket)?\s*:\s*(\d{2}\/\d{2}\/\d{4})/)?.[1] || '';
      tanggalFormatted= tanggalRaw ? formatTanggalIndonesia(tanggalRaw) : '-';
      problem         = extractFlexibleBlock(lines,'Trouble Dilaporkan',['Masalah','Solusi','Progress']) || '-';

      const ambilJam = (text, label) => text.match(new RegExp(`${label}\\s+(\\d{2}:\\d{2})(?::\\d{2})?`))?.[1] || '';
      berangkat = ambilJam(rawText, 'Berangkat') || '-';
      tiba      = ambilJam(rawText, 'Tiba') || '-';
      mulai     = ambilJam(rawText, 'Mulai') || '-';
      selesai   = ambilJam(rawText, 'Selesai') || '-';

      solusi          = extractFlexibleBlock(lines,'Solusi/Perbaikan',['STATUS','Jenis Perangkat','SN','Merk','Type']) || '-';
      jenisPerangkat  = clean(rawText.match(/Jenis Perangkat\s*:\s*(.+)/)?.[1]) || '-';
      serial          = clean(rawText.match(/SN\s*:\s*(.+)/)?.[1]) || '-';
      merk            = clean(rawText.match(/Merk\s*:\s*(.+)/)?.[1]) || '-';
      type            = clean(rawText.match(/Type\s*:\s*(.+)/)?.[1]) || '-';
      (() => {
        const stops = [
          'Jabatan','Jenis Perangkat','Serial Number','SN','Merk','Type',
          'Status','STATUS','Tanggal','Nama','Tanda','Cap','Progress',
          'Unit Kerja','Kantor Cabang'
        ];
        const block = extractFlexibleBlock(lines, '(?:Pelapor|PIC)', stops) || '';
        const m = block.match(/^\s*([^()\[\]\n]+?)\s*(?:[\(\[]\s*([^()\[\]]+?)\s*[\)\]])?\s*$/);
        const name = clean(m ? m[1] : block);
        const jab  = clean(m && m[2] ? m[2] : extractFlexibleBlock(lines, 'Jabatan', stops) || '');
        pic = jab ? `${name} (${jab})` : (name || '-');
      })();

      status          = clean(rawText.match(/STATUS PEKERJAAN\s*:\s*(.+)/)?.[1]) || '-';

      updateOutput();
    } catch (err) {
      console.error("Gagal memproses PDF:", err);
      alert("Terjadi kesalahan saat membaca PDF.");
    }
  };
  reader.readAsArrayBuffer(file);
});

// ---------- Output ----------
function updateOutput() {
  const lokasiTerpilih = lokasiSelect?.value || '';
  const unitKerjaLengkap = (lokasiTerpilih && unitKerja !== '-') ? `${unitKerja} (${lokasiTerpilih})` : unitKerja;

  const finalOutput =
`Selamat Pagi/Siang/Sore Petugas Call Center, Update Pekerjaan

Unit Kerja : ${unitKerjaLengkap}
Kantor Cabang : ${kantorCabang}

Tanggal : ${tanggalFormatted}

Jenis Pekerjaan (Problem) : ${problem}

Berangkat : ${berangkat}
Tiba : ${tiba}
Mulai : ${mulai}
Selesai : ${selesai}

Progress : ${solusi}

Jenis Perangkat : ${jenisPerangkat}
Serial Number : ${serial}
Merk Perangkat : ${merk}
Type Perangkat : ${type}

PIC : ${pic}
Status : ${status}`;

  if (output) output.textContent = finalOutput;
}

// ---------- Storage helpers (per-uid) ----------
function readHistoriSafe() {
  try {
    const raw = localStorage.getItem(userHistKey()) ?? '[]';
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}
function writeHistori(arr) {
  const safe = JSON.stringify(Array.isArray(arr) ? arr : []);
  localStorage.setItem(userHistKey(), safe);       // ruang user aktif
  localStorage.setItem(PUBLIC_HIST_KEY, safe);     // alias publik (kompat modul lain)
  scheduleSaveManifest();                          // sinkron ke Drive (debounce)
}
/* Duplikat: hash sama (prioritas), atau fallback nama+size (untuk entri lama) */
function isDuplicateRow(row, file, hash) {
  if (!row) return false;
  if (hash && row.contentHash && row.contentHash === hash) return true;
  if (file && row.fileName && row.size != null) {
    return row.fileName === file.name && Number(row.size) === Number(file.size);
  }
  return false;
}

// ---------- Copy & Save Histori ----------
copyBtn?.addEventListener("click", async () => {
  try {
    // copy text
    const text = (typeof output !== "undefined" && output?.textContent) ? output.textContent : "";
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else {
        const ta = document.createElement("textarea");
        ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove();
      }
    } catch {}
    if (copyBtn) { copyBtn.textContent = "✔ Copied!"; setTimeout(() => (copyBtn.textContent = "Copy"), 1500); }

    // validasi file (pakai fallback window.currentFile)
    const file = (fileInput?.files?.[0]) || (window.currentFile || null);
    if (!file) { showToast("⚠ Tidak ada file PDF yang dipilih.", 3500, "warn"); return; }

    // hash
    let contentHash;
    try { contentHash = await sha256File(file); }
    catch { contentHash = `fz_${file.size}_${file.lastModified}_${Math.random().toString(36).slice(2,10)}`; }

    // entri histori
    const unitKerjaVal  = (typeof unitKerja === "string" ? unitKerja : (document.querySelector("#unitKerja")?.value || "")) || "";
    const tanggalRawVal = (typeof tanggalRaw  === "string" ? tanggalRaw  : (document.querySelector("#tanggalPekerjaan")?.value || "")) || "";
    const namaUkerBersih = (typeof stripLeadingColon === "function" ? (stripLeadingColon(unitKerjaVal) || "-") : (unitKerjaVal || "-"));

    const newEntry = {
      namaUker: namaUkerBersih,
      tanggalPekerjaan: tanggalRawVal,
      fileName: file.name || "-",
      contentHash,
      size: file.size,
      uploadedAt: new Date().toISOString()
    };

    // === Drive idempoten + katalog per-akun ===
    let uploadedViaHash = false;
    try {
      const uid = (window.Auth?.getUid?.() || 'anon');
      if (uid === 'anon') {
        alert('Harus login dulu untuk menyimpan ke Drive.');
      } else {
        const ok = await (window.DriveSync?.tryResume?.() || Promise.resolve(false));
        if (!ok && !window.DriveSync?.isLogged?.()) {
          showToast('ℹ Klik "Connect Google Drive" untuk menyalakan sinkronisasi.', 3500, 'info');
        } else {
          // Upload idempoten: /Bribox Kanpus/pdfs/<sha256>.pdf
          const { fileId, deduped } = await DriveSync.savePdfByHash(file, contentHash);
          console.log('[Drive] savePdfByHash OK:', { fileId, deduped, hash: contentHash });
          await ensureInPdfs(fileId);

          // simpan katalog
          const catKey = `PdfCatalog__${uid}`;
          const catMap = JSON.parse(localStorage.getItem(catKey) || '{}');
          catMap[contentHash] = { fileId, name:file.name, size:file.size, mime:file.type, at:Date.now() };
          localStorage.setItem(catKey, JSON.stringify(catMap));

          uploadedViaHash = true; // sukses lewat jalur idempoten
          showToast(deduped ? '☁️ Pakai file yang sudah ada di Drive' : '☁️ PDF diunggah ke Drive', 2500, 'success');
        }
      }
    } catch (e) {
      console.warn('[Trackmate] Drive idempoten gagal:', e);
      // lanjut simpan histori lokal supaya UX tetap jalan
    }

    // duplikat?
    const histori = readHistoriSafe();
    const exists = histori.length > 0 && histori.some(r => isDuplicateRow(r, file, contentHash));
    if (exists) {
      // tetap coba upload (DriveQueue akan dedupe)
      try { await tryUploadOriginalToDrive(file, contentHash); } catch {}
      showToast("ℹ Sudah ada di histori", 3000, "info");
      return;
    }

    // simpan ke localStorage (ruang user) & alias
    histori.push(newEntry);
    writeHistori(histori);

    // paralel: IDB + Drive
    const TIMEOUT_MS = 12000;

    const idbPromise = Promise.race([
      (async () => {
        await savePdfToIndexedDB_keepSchema(file, { contentHash });
        // Jika ingin juga menyimpan ke store blob keyed-by-hash:
        // await saveBlobByHash(file, contentHash);
      })(),
      new Promise((_, rej) => setTimeout(() => rej(new Error("IDB timeout")), TIMEOUT_MS))
    ]).catch(err => { console.warn("IndexedDB gagal/timeout:", err); return null; });

    const drivePromise = (async () => {
      if (uploadedViaHash) return true; // sudah sukses via savePdfByHash di atas
      try {
        const res = await window.DriveQueue?.enqueueOrUpload?.(file, contentHash);
        try { await window.DriveQueue?.flush?.(); } catch {}
        if (res?.uploaded) return true;
      } catch {}
      try { await DriveSync?.savePdfByHash?.(file, contentHash); return true; } catch {}
      return false;
    })();

    // ===== Helper: pastikan file ada di subfolder /pdfs (DriveSync API valid) =====
    async function ensureInPdfs(fileId) {
      try {
        const rootId = await DriveSync.ensureFolder?.();     // id folder "Bribox Kanpus"
        const pdfsId = await DriveSync.ensureSub?.('pdfs');  // id subfolder "pdfs"
        if (!rootId || !pdfsId) return;

        const token = DriveSync.getAccessToken?.();
        if (!token) return;

        // cek parent saat ini
        const metaRes = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=parents`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!metaRes.ok) return;
        const meta = await metaRes.json();
        const curParents = (meta.parents || []).join(',');

        // jika belum punya parent "pdfs", tambahkan + (opsional) hapus parent lama
        if (!meta.parents || !meta.parents.includes(pdfsId)) {
          await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?addParents=${encodeURIComponent(pdfsId)}&removeParents=${encodeURIComponent(curParents)}`, {
            method: 'PATCH',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({})
          });
          console.log('[Drive] moved file into /Bribox Kanpus/pdfs');
        }
      } catch (e) {
        console.warn('[Drive] ensureInPdfs failed:', e);
      }
    }

    const [idbResult] = await Promise.all([idbPromise, drivePromise]);

    if (idbResult === null) {
      showToast("⚠ Histori disimpan. File PDF asli gagal disimpan lokal (coba ulang).", 5000);
    } else {
      showToast("✔ Berhasil disimpan ke histori", 3000);
    }

  } catch (err) {
    console.error("Copy handler error:", err);
    showToast(`❌ Error: ${err?.message || err}`, 4500, "warn");
  }
});

// ---------- Toast util ----------
function showToast(message, duration = 3000, variant = "success") {
  let el = document.querySelector(".toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    document.body.appendChild(el);
  }
  const bg = variant === "info" ? "#0d6efd" : variant === "warn" ? "#f59e0b" : "#28a745";
  el.style.background = bg;
  el.textContent = String(message);
  el.classList.remove("show", "hiding");
  if (el._hideTimer) clearTimeout(el._hideTimer);
  requestAnimationFrame(() => { requestAnimationFrame(() => { el.classList.add("show"); }); });
  el._hideTimer = setTimeout(() => {
    el.classList.add("hiding"); el.classList.remove("show");
    const onEnd = () => { el.classList.remove("hiding"); el.removeEventListener("transitionend", onEnd); };
    el.addEventListener("transitionend", onEnd, { once: true });
  }, duration);
  el.onclick = () => { if (el._hideTimer) clearTimeout(el._hideTimer); el.classList.add("hiding"); el.classList.remove("show"); };
}

// ---------- Debug & Migrasi (opsional) ----------
async function debugListPDF() {
  const database = await ensureDb();
  const out = { pdfs: [], pdfBlobs: [] };

  await new Promise(res => {
    const tx = database.transaction([STORE_NAME], 'readonly');
    const st = tx.objectStore(STORE_NAME);
    const req = st.getAll();
    req.onsuccess = () => { out.pdfs = (req.result || []).map(v => ({ name:v.name, hash:v.contentHash, hasMeta: !!v.meta })); res(); };
    req.onerror = () => res();
  });

  await new Promise(res => {
    const tx = database.transaction([STORE_BLOBS], 'readonly');
    const st = tx.objectStore(STORE_BLOBS);
    const req = st.getAll();
    req.onsuccess = () => { out.pdfBlobs = (req.result || []).map(v => ({ name:v.name, hash:v.contentHash, hasMeta: !!v.meta })); res(); };
    req.onerror = () => res();
  });

  console.table(out.pdfs); console.table(out.pdfBlobs);
}
window.debugListPDF = debugListPDF;

async function migrateFillMetaPdfBlobs() {
  const database = await ensureDb();
  const tx = database.transaction([STORE_BLOBS], 'readwrite');
  const st = tx.objectStore(STORE_BLOBS);
  const req = st.getAll();
  req.onsuccess = async () => {
    const rows = req.result || [];
    for (const row of rows) {
      if (row && row.data instanceof Blob && row.data.type === 'application/pdf' && !row.meta) {
        try {
          const buf = await row.data.arrayBuffer();
          const meta = typeof autoCalibratePdf === "function" ? await autoCalibratePdf(buf) : null;
          if (meta) {
            row.meta = meta;
            await new Promise(r2 => { const put = st.put(row); put.onsuccess = r2; put.onerror = r2; });
          }
        } catch(e) { console.warn('migrate meta fail:', e); }
      }
    }
  };
}
window.migrateFillMetaPdfBlobs = migrateFillMetaPdfBlobs;
