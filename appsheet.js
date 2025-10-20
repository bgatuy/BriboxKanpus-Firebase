// ===== AppSheet (rapi & kompat) =====

// ---------- HASH UTIL ----------
async function sha256File(file) {
  try {
    const buf = await file.arrayBuffer();
    const hashBuf = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return `fz_${file.size}_${file.lastModified}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

// ---------- SIDEBAR ----------
const sidebar = document.querySelector('.sidebar');
const overlay = document.getElementById('sidebarOverlay') || document.querySelector('.sidebar-overlay');
const sidebarLinks = document.querySelectorAll('.sidebar a');

function openSidebar() { sidebar?.classList.add('visible'); overlay?.classList.add('show'); document.body.style.overflow = 'hidden'; }
function closeSidebar() { sidebar?.classList.remove('visible'); overlay?.classList.remove('show'); document.body.style.overflow = ''; }
function toggleSidebar() { sidebar?.classList.contains('visible') ? closeSidebar() : openSidebar(); }
window.toggleSidebar = toggleSidebar;

overlay?.addEventListener('click', closeSidebar);
document.addEventListener('click', (e) => {
  const isMobile = window.matchMedia('(max-width: 768px)').matches;
  if (!isMobile) return;
  if (sidebar?.classList.contains('visible') && !sidebar.contains(e.target) && !e.target.closest('.sidebar-toggle-btn')) closeSidebar();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sidebar?.classList.contains('visible')) closeSidebar(); });
sidebarLinks.forEach(a => a.addEventListener('click', closeSidebar));

document.addEventListener('DOMContentLoaded', function () {
  const title = document.querySelector('.dashboard-header h1')?.textContent?.toLowerCase() || "";
  const body = document.body;
  if (title.includes('trackmate')) body.setAttribute('data-page', 'trackmate');
  else if (title.includes('appsheet')) body.setAttribute('data-page', 'appsheet');
  else if (title.includes('serah')) body.setAttribute('data-page', 'serah');
  else if (title.includes('merge')) body.setAttribute('data-page', 'merge');
  try { window.DriveQueue?.init?.(); } catch {}
});

// ---------- QUERY DOM ----------
const pdfInput     = document.getElementById("pdfFile");
const output       = document.getElementById("output");
const copyBtn      = document.getElementById("copyBtn");
const lokasiSelect = document.getElementById("inputLokasi");

// ---------- USER / HISTORI PER-AKUN ----------
const PUBLIC_HIST_KEY = 'pdfHistori';

function getUidOrAnon() {
  try {
    if (window.AccountNS?.getUidOrAnon) return window.AccountNS.getUidOrAnon();
    return (window.Auth?.getUid?.())
        || (window.Auth?.user?.uid)
        || (window.Auth?.currentUser?.()?.uid)
        || 'anon';
  } catch { return 'anon'; }
}

function userHistKey() {
  try {
    if (window.AccountNS?.nsKey) return window.AccountNS.nsKey(PUBLIC_HIST_KEY);
  } catch {}
  return `${PUBLIC_HIST_KEY}::${getUidOrAnon()}`;
}

function manifestName() { return `.bribox_histori__${getUidOrAnon()}.json`; }

function readHistori() {
  try {
    const raw = localStorage.getItem(userHistKey()) || '[]';
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function writeHistoriLocal(arr) {
  const json = JSON.stringify(Array.isArray(arr) ? arr : []);
  localStorage.setItem(userHistKey(), json);      // ruang user aktif
  localStorage.setItem(PUBLIC_HIST_KEY, json);    // alias publik (kompat modul lama)
}

let _manifestTimer = null;
function scheduleSaveManifest(arr) {
  if (_manifestTimer) clearTimeout(_manifestTimer);
  _manifestTimer = setTimeout(async () => {
    _manifestTimer = null;
    try { await window.DriveSync?.putJson?.(manifestName(), Array.isArray(arr) ? arr : []); } catch {}
  }, 700);
}

// sinkron alias saat UID berganti / tab lain update
function syncHistAliasFromUser() {
  try { localStorage.setItem(PUBLIC_HIST_KEY, localStorage.getItem(userHistKey()) ?? '[]'); } catch {}
}
window.addEventListener('storage', (e) => {
  if (!e || !e.key) return;
  const uid = getUidOrAnon();
  if (e.key === `${PUBLIC_HIST_KEY}::${uid}`) syncHistAliasFromUser();
});
if (window.DriveSync?.onAuthStateChanged) window.DriveSync.onAuthStateChanged(syncHistAliasFromUser);
if (window.AccountNS?.watchAuthAndSwapStores) try { window.AccountNS.watchAuthAndSwapStores(); } catch {}

// ---------- TOAST ----------
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

// ---------- AUTO-CALIBRATE ----------
async function autoCalibratePdf(buffer) {
  if (!window.pdfjsLib?.getDocument) return null;
  const doc = await pdfjsLib.getDocument({ data: buffer }).promise;
  const page = await doc.getPage(1);
  const items = (await page.getTextContent()).items || [];

  let atas = items.find(it => /Diselesaikan\s*Oleh/i.test(it.str));
  if (!atas) {
    for (let i = 0; i < items.length - 1; i++) {
      if (/Diselesaikan/i.test(items[i].str) && /Oleh/i.test(items[i + 1].str)) { atas = items[i]; break; }
    }
  }
  if (!atas) { try { doc.destroy(); } catch {} return null; }

  const xA = atas.transform[4], yA = atas.transform[5];

  const kandidat = items.filter(it =>
    /Nama\s*&?\s*Tanda\s*&?\s*Tangan/i.test(it.str) &&
    it.transform && it.transform[5] < yA
  );
  let bawah = null, best = Infinity;
  for (const it of kandidat) {
    const x = it.transform[4], y = it.transform[5];
    const dx = Math.abs(x - xA), dy = Math.max(0, yA - y);
    const score = 1.6 * dx + dy;
    if (dx <= 120 && score < best) { best = score; bawah = it; }
  }

  let x = xA + 95;
  let y = bawah ? (bawah.transform[5] + 12) : (yA - 32);

  const first = r => items.find(it => r.test(it.str));
  const labUK = first(/Unit\s*Kerja/i), labKC = first(/Kantor\s*Cabang/i);
  let linesUK = 0;
  if (labUK && labKC) {
    const yTop = labUK.transform[5], yBot = labKC.transform[5] - 1;
    const xL = labUK.transform[4] + 40, xR = xL + 260;
    const ys = [];
    for (const it of items) {
      if (!it.transform) continue;
      const x0 = it.transform[4], y0 = it.transform[5];
      if (y0 <= yTop + 2 && y0 >= yBot - 2 && x0 >= xL && x0 <= xR) {
        const yy = Math.round(y0 / 2) * 2;
        if (!ys.some(v => Math.abs(v - yy) < 2)) ys.push(yy);
      }
    }
    linesUK = Math.max(1, Math.min(5, ys.length || 0));
  }

  const labSol = first(/Solusi\/?Perbaikan/i), labStatus = first(/Status\s*Pekerjaan/i);
  let linesSOL = 0;
  if (labSol && labStatus) {
    const yTop = labSol.transform[5] + 1, yBot = labStatus.transform[5] + 2;
    const xL = labSol.transform[4] + 120, xR = xL + 300;
    const ys = [];
    for (const it of items) {
      if (!it.transform) continue;
      const x0 = it.transform[4], y0 = it.transform[5];
      if (y0 >= yBot && y0 <= yTop && x0 >= xL && x0 <= xR) {
        const yy = Math.round(y0 / 2) * 2;
        if (!ys.some(v => Math.abs(v - yy) < 2)) ys.push(yy);
      }
    }
    linesSOL = Math.max(1, Math.min(6, ys.length || 0));
  }

  try { doc.destroy(); } catch {}
  return { x, y, linesUK, linesSOL, dx: 0, dy: 0, v: 1 };
}

// ---------- IndexedDB (per-UID bila AccountNS tersedia) ----------
const DB_VERSION = 2;
const STORE_NAME = "pdfs";
const STORE_BLOBS = "pdfBlobs";
let db;

function currentDbName() {
  try { if (window.AccountNS?.currentDbName) return window.AccountNS.currentDbName('PdfStorage'); } catch {}
  return 'PdfStorage';
}

function openDb() {
  const DB_NAME = currentDbName();
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const _db = e.target.result;
      if (!_db.objectStoreNames.contains(STORE_NAME))  _db.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
      if (!_db.objectStoreNames.contains(STORE_BLOBS)) _db.createObjectStore(STORE_BLOBS, { keyPath: "contentHash" });
    };
    req.onsuccess = (e) => {
      db = e.target.result;
      db.__name = DB_NAME;
      db.onversionchange = () => { try { db.close(); } catch {} db = null; };
      resolve(db);
    };
    req.onerror = (e) => reject(e.target.error || e.target.errorCode);
  });
}

async function ensureDb() {
  const want = currentDbName();
  if (db && db.__name === want) return db;
  try { if (db) db.close(); } catch {}
  db = null;
  return await openDb();
}

// Simpan record histori + blob by hash (kompat dengan trackmate)
async function savePdfToIndexedDB(fileOrBlob, nameOverride, { contentHash } = {}) {
  const blob = fileOrBlob instanceof Blob ? fileOrBlob : null;
  if (!blob) throw new Error('savePdfToIndexedDB: harus File/Blob');
  const name = nameOverride || (fileOrBlob.name || '(tanpa-nama)');
  if (blob.type !== 'application/pdf') throw new Error('Type bukan PDF');
  if (!blob.size) throw new Error('PDF kosong');

  let meta = null;
  try { meta = await autoCalibratePdf(await blob.arrayBuffer()); } catch (e) { console.warn('autoCalibrate gagal:', e); }

  const database = await ensureDb();
  await new Promise((resolve, reject) => {
    const tx = database.transaction([STORE_NAME, STORE_BLOBS], 'readwrite');
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error || new Error('Tx error'));
    tx.objectStore(STORE_NAME).add({
      name,
      dateAdded: new Date().toISOString(),
      data: blob,               // keep for backward-compat
      contentHash: contentHash || null,
      meta
    });
    tx.objectStore(STORE_BLOBS).put({
      contentHash: contentHash || null,
      name,
      size: blob.size,
      type: blob.type,
      data: blob,
      meta,
      savedAt: Date.now()
    });
  });

  console.log(`✅ Tersimpan (IDB): ${name} ${(blob.size/1024).toFixed(1)} KB, hash=${contentHash}`);
  return { contentHash, meta };
}

// ---------- STATE ----------
let lokasiTerpilih = "", unitKerja = "-", kantor = "-", tanggal = "-", problem = "-",
    berangkat = "-", tiba = "-", mulai = "-", selesai = "-", progress = "-",
    jenis = "-", sn = "-", merk = "-", tipe = "-", pic = "-", status = "-",
    currentTanggalRaw = "-";

Object.defineProperty(window, 'currentFile', { writable: true, configurable: true, value: window.currentFile || null });

// ---------- HELPERS ----------
function formatTanggalIndo(tanggalStr) {
  if (!tanggalStr || !/^\d{2}\/\d{2}\/\d{4}$/.test(tanggalStr)) return "-";
  const bulan = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
  const [dd, mm, yyyy] = tanggalStr.split("/");
  return `${dd} ${bulan[parseInt(mm, 10) - 1]} ${yyyy}`;
}
function ambil(text, regex, fallback = "-") {
  const match = text.match(regex);
  return match?.[1]?.trim() || fallback;
}
function cleanJam(text) {
  if (!text || text === "-") return "-";
  const match = text.match(/\d{2}[.:]\d{2}/);
  return match ? match[0].replace(/\./g, ":") : "-";
}
function stripLeadingColon(s) { return (s || '').replace(/^\s*:+\s*/, ''); }

// ---------- OUTPUT ----------
function generateLaporan() {
  const unitKerjaLengkap = (lokasiTerpilih && unitKerja !== "-") ? `${unitKerja} (${lokasiTerpilih})` : unitKerja;
  const laporanBaru =
`Selamat Pagi/Siang/Sore Petugas Call Center, Update Pekerjaan

Unit Kerja : ${unitKerjaLengkap}
Kantor Cabang : ${kantor}

Tanggal : ${tanggal}

Jenis Pekerjaan (Problem) : ${problem}

Berangkat : ${berangkat}
Tiba : ${tiba}
Mulai : ${mulai}
Selesai : ${selesai}

Progress : ${progress}

Jenis Perangkat : ${jenis}
Serial Number : ${sn}
Merk Perangkat : ${merk}
Type Perangkat : ${tipe}

PIC : ${pic}
Status : ${status}`;
  if (output) output.textContent = laporanBaru;
}

lokasiSelect?.addEventListener("change", () => { lokasiTerpilih = lokasiSelect.value; generateLaporan(); });

// ---------- FILE INPUT ----------
pdfInput?.addEventListener("change", async () => {
  const file = pdfInput.files?.[0];
  if (!file) return;
  window.currentFile = file;

  if (file.type !== 'application/pdf' || !file.size) { alert('File bukan PDF valid.'); return; }

  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;

  let rawText = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    rawText += content.items.map(i => i.str).join(" ") + "\n";
  }
  rawText = rawText.replace(/\s+/g, " ").trim();

  unitKerja = stripLeadingColon(ambil(rawText, /Unit Kerja\s*:\s*(.+?)\s+(Perangkat|Kantor Cabang)/));
  kantor    = ambil(rawText, /Kantor Cabang\s*:\s*(.+?)\s+(Tanggal|Asset ID|Tanggal\/Jam)/);
  const tglRaw = ambil(rawText, /Tanggal\/Jam\s*:\s*(\d{2}\/\d{2}\/\d{4})/);
  currentTanggalRaw = tglRaw;
  tanggal  = tglRaw !== "-" ? formatTanggalIndo(tglRaw) : "-";

  problem  = ambil(rawText, /Trouble Dilaporkan\s*:\s*(.+?)\s+(Solusi|Progress|KETERANGAN)/i);
  if (problem === "-") problem = ambil(rawText, /Problem\s*[:\-]?\s*(.+?)\s+(Solusi|Progress|KETERANGAN)/i);

  berangkat = cleanJam(ambil(rawText, /BERANGKAT\s+(\d{2}[.:]\d{2})/));
  tiba      = cleanJam(ambil(rawText, /TIBA\s+(\d{2}[.:]\d{2})/));
  mulai     = cleanJam(ambil(rawText, /MULAI\s+(\d{2}[.:]\d{2})/));
  selesai   = cleanJam(ambil(rawText, /SELESAI\s+(\d{2}[.:]\d{2})/));

  progress = ambil(rawText, /Solusi\s*\/?\s*Perbaikan\s*:\s*(.+?)\s+(KETERANGAN|Status|$)/i);
  jenis    = ambil(rawText, /Perangkat\s*[:\-]?\s*(.+?)\s+(Kantor Cabang|SN|Asset ID)/i);
  sn       = ambil(rawText, /SN\s*[:\-]?\s*([A-Za-z0-9\-]+)/i);
  tipe     = ambil(rawText, /Type\s*[:\-]?\s*([A-Za-z0-9\s\-]+?)(?=\s+(SN|PW|Status|PIC|$))/i);
  merk     = ambil(rawText, /Merk\s*[:\-]?\s*([A-Za-z]+)/i);

  if ((merk === "-" || !merk) && tipe && tipe !== "-") {
    const t = tipe.toUpperCase();
    if (t.includes("LENOVO")) merk = "LENOVO";
    else if (t.includes("DELL")) merk = "DELL";
    else if (t.includes("HP"))   merk = "HP";
    else if (t.includes("ASUS")) merk = "ASUS";
    else if (t.includes("ACER")) merk = "ACER";
    else if (t.includes("AXIOO")) merk = "AXIOO";
    else if (t.includes("MSI"))   merk = "MSI";
    else if (t.includes("ZYREX")) merk = "ZYREX";
  }

  pic    = ambil(rawText, /Pelapor\s*:\s*(.+?)\s+(Type|Status|$)/);
  if (pic.includes("(")) pic = pic.split("(")[0].trim();
  status = ambil(rawText, /Status Pekerjaan\s*:?\s*(Done|Pending|On\s?Progress|Done By Repairing)/i);

  generateLaporan();
});

// ===== CLOUD SYNC (AppSheet) =====
(function(){
  const MANIFEST_BASENAME = '.bribox_histori';
  function manifestName() { return `${MANIFEST_BASENAME}__${getUidOrAnon()}.json`; }

  async function driveLoadHistoriManifest() {
    try {
      if (window.DriveSync?.getJson) {
        const obj = await DriveSync.getJson(manifestName());
        return obj?.data ?? null;
      }
    } catch (e) {
      console.warn('[AppSheet] DriveSync getJson fail:', e);
    }
    return null;
  }

  async function driveSaveHistoriManifest(arr) {
    const json = JSON.stringify(Array.isArray(arr) ? arr : [], null, 0);
    if (window.DriveSync?.putJson) {
      try {
        await DriveSync.putJson(manifestName(), JSON.parse(json));
        return true;
      } catch (e) {
        console.warn('[AppSheet] DriveSync putJson fail:', e);
      }
    }
    return false;
  }

  // Pull cloud to local
  async function pullCloudToLocal() {
    try {
      const cloud = await driveLoadHistoriManifest();
      if (Array.isArray(cloud)) {
        const local = readHistori();
        // Merge: prefer cloud entries by contentHash
        const merged = mergeHistori(local, cloud);
        writeHistoriLocal(merged);
        scheduleSaveManifest(merged);
        return true;
      }
    } catch (e) {
      console.warn('[AppSheet] Pull cloud failed:', e);
    }
    return false;
  }

  function mergeHistori(local, cloud) {
    const map = new Map();
    
    // Add all local entries
    local.forEach(item => {
      if (item.contentHash) {
        map.set(item.contentHash, item);
      }
    });
    
    // Add/update with cloud entries (prefer newer)
    cloud.forEach(item => {
      if (item.contentHash) {
        const existing = map.get(item.contentHash);
        if (!existing || (item.uploadedAt > existing.uploadedAt)) {
          map.set(item.contentHash, item);
        }
      }
    });
    
    return Array.from(map.values()).sort((a, b) => 
      new Date(b.uploadedAt) - new Date(a.uploadedAt)
    );
  }

  // Expose to global
  window.AppSheetSync = {
    pullCloudToLocal,
    driveSaveHistoriManifest
  };

  // Auto-pull on page load if Drive connected
  document.addEventListener('DOMContentLoaded', async () => {
    setTimeout(async () => {
      try {
        const ok = await (window.DriveSync?.tryResume?.() || Promise.resolve(false));
        if (ok || window.DriveSync?.isLogged?.()) {
          await pullCloudToLocal();
        }
      } catch (e) {
        console.warn('[AppSheet] Auto-pull failed:', e);
      }
    }, 1000);
  });
})();

// ---------- COPY & SAVE ----------
copyBtn?.addEventListener("click", async () => {
  // 1) Copy text
  const text = output?.textContent || '';
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
    else { const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove(); }
    copyBtn.textContent = "✔ Copied!";
  } catch { copyBtn.textContent = "⚠ Copy gagal"; }
  setTimeout(() => (copyBtn.textContent = "Copy"), 1500);

  // 2) Validasi file & tanggal
  const file = window.currentFile;
  if (!file) { showToast("⚠ Tidak ada file PDF yang dipilih.", 3500, "warn"); return; }
  if (!currentTanggalRaw || currentTanggalRaw === "-") { showToast("⚠ Tanggal/Jam tidak terdeteksi.", 3500, "warn"); /* tetap lanjut simpan */ }

  // 3) Hash isi file
  const contentHash = await sha256File(file);

  // 4) Pastikan user login
  const uid = (window.Auth?.getUid?.() || 'anon');
  if (uid === 'anon') { alert('Harus login dulu.'); return; }

  // 5) Coba upload idempoten ke Drive (jalur utama) + catat katalog
  let uploadedViaHash = false;
  try {
    const ok = await (window.DriveSync?.tryResume?.() || Promise.resolve(false));
    if (!ok && !window.DriveSync?.isLogged?.()) { alert('Silakan klik "Connect Google Drive" dulu.'); return; }

    const { fileId, deduped } = await DriveSync.savePdfByHash(file, contentHash);

    const catKey = `PdfCatalog__${uid}`;
    const catMap = JSON.parse(localStorage.getItem(catKey) || '{}');
    catMap[contentHash] = { fileId, name: file.name, size: file.size, mime: file.type, at: Date.now() };
    localStorage.setItem(catKey, JSON.stringify(catMap));

    uploadedViaHash = true;
    showToast(deduped ? '☁️ Pakai file yang sudah ada di Drive' : '☁️ PDF diunggah ke Drive', 2500, 'success');
  } catch (e) {
    console.warn('[AppSheet] Drive idempoten gagal:', e);
    // Fallback: antre di DriveQueue (akan auto-flush saat online/tersambung)
    try {
      const res = await window.DriveQueue?.enqueueOrUpload?.(file, contentHash);
      try { await window.DriveQueue?.flush?.(); } catch {}
      if (res?.uploaded) uploadedViaHash = true;
      showToast(res?.uploaded ? '☁️ Tersimpan ke Drive' : '☁️ Dijadwalkan ke Drive', 2600, res?.uploaded ? 'success' : 'info');
    } catch {}
  }

  // 6) Dedupe histori (hash; fallback nama+size utk entri lama)
  const histKey = `pdfHistori::${uid}`;
  const histori = JSON.parse(localStorage.getItem(histKey) || '[]');
  const exists = histori.some(r => (r.contentHash && r.contentHash === contentHash) || (r.fileName === file.name && Number(r.size) === Number(file.size)));
  if (exists) { showToast('ℹ Sudah ada di histori', 2600, 'info'); return; }

  // 7) Tambah entri histori
  const rec = {
    namaUker: stripLeadingColon(unitKerja) || '-',
    tanggalPekerjaan: currentTanggalRaw || '',
    fileName: file.name,
    contentHash,
    size: file.size,
    uploadedAt: new Date().toISOString(),
    module: 'appsheet'
  };
  const newHist = [...histori, rec];
  writeHistoriLocal(newHist);
  scheduleSaveManifest(newHist);

  // 8) Simpan blob lokal (offline)
  try { await savePdfToIndexedDB(file, undefined, { contentHash }); }
  catch (e) { console.warn('IDB gagal:', e); }

  showToast('✔ Tersimpan & disinkron.', 3000, 'success');
});
