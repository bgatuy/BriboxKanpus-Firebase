// ===== AppSheet =====

/* ========= HASH UTIL (BARU) ========= */
async function sha256File(file) {
  try {
    const buf = await file.arrayBuffer();
    const hashBuf = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2,'0')).join('');
  } catch {
    // fallback kalau SubtleCrypto gak ada
    return `fz_${file.size}_${file.lastModified}_${Math.random().toString(36).slice(2,10)}`;
  }
}

/* ========= SIDEBAR ========= */
const sidebar   = document.querySelector('.sidebar');
const overlay   = document.getElementById('sidebarOverlay') || document.querySelector('.sidebar-overlay');
const sidebarLinks = document.querySelectorAll('.sidebar a');

function openSidebar() { sidebar.classList.add('visible'); overlay?.classList.add('show'); document.body.style.overflow = 'hidden'; }
function closeSidebar() { sidebar.classList.remove('visible'); overlay?.classList.remove('show'); document.body.style.overflow = ''; }
function toggleSidebar() { sidebar.classList.contains('visible') ? closeSidebar() : openSidebar(); }
window.toggleSidebar = toggleSidebar;

overlay?.addEventListener('click', closeSidebar);
document.addEventListener('click', (e) => {
  const isMobile = window.matchMedia('(max-width: 768px)').matches;
  if (!isMobile) return;
  const clickInsideSidebar = sidebar.contains(e.target);
  const clickOnToggle = e.target.closest('.sidebar-toggle-btn');
  if (sidebar.classList.contains('visible') && !clickInsideSidebar && !clickOnToggle) closeSidebar();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sidebar.classList.contains('visible')) closeSidebar(); });
sidebarLinks.forEach(a => a.addEventListener('click', closeSidebar));

document.addEventListener('DOMContentLoaded', function () {
  const title = document.querySelector('.dashboard-header h1')?.textContent?.toLowerCase() || "";
  const body = document.body;
  if (title.includes('trackmate'))      body.setAttribute('data-page', 'trackmate');
  else if (title.includes('appsheet'))  body.setAttribute('data-page', 'appsheet');
  else if (title.includes('serah'))     body.setAttribute('data-page', 'serah');
  else if (title.includes('merge'))     body.setAttribute('data-page', 'merge');

  // init Drive queue di halaman ini juga (aman kalau dipanggil berkali-kali)
  try { window.DriveQueue?.init?.(); } catch {}
});

/* ========= Query DOM ========= */
const pdfInput     = document.getElementById("pdfFile");
const output       = document.getElementById("output");
const copyBtn      = document.getElementById("copyBtn");
const lokasiSelect = document.getElementById("inputLokasi");

/* ========= Toast ========= */
function showToast(message, duration = 3000) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.classList.add('show'), 10);
  const remove = () => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 300); };
  toast.addEventListener('click', remove);
  setTimeout(remove, duration);
}

// === AUTO-CALIBRATE: cari anchor "Diselesaikan Oleh," dan "Nama & Tanda Tangan" ===
async function autoCalibratePdf(buffer){
  const doc = await pdfjsLib.getDocument({ data: buffer }).promise;
  const page = await doc.getPage(1);
  const items = (await page.getTextContent()).items || [];

  // "Diselesaikan Oleh," (kolom tengah)
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

  // titik dasar (x,y) untuk nama
  let x = xA + 95;
  let y = bawah ? (bawah.transform[5] + 12) : (yA - 32);

  // (opsional) info baris UK & SOLUSI – bisa dipakai nanti, tidak wajib
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

/* ========= IndexedDB ========= */
// Samakan schema dengan Trackmate: ada store blob by contentHash
const DB_NAME = "PdfStorage";
const DB_VERSION = 2;
const STORE_NAME = "pdfs";
const STORE_BLOBS = "pdfBlobs";
let db;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(STORE_BLOBS)) {
        db.createObjectStore(STORE_BLOBS, { keyPath: "contentHash" });
      }
    };
    req.onsuccess = (e) => { db = e.target.result; resolve(db); };
    req.onerror   = (e) => reject(e.target.error || e.target.errorCode);
  });
}

// Simpan record histori + blob terindeks contentHash (dedupe lintas modul)
async function savePdfToIndexedDB(fileOrBlob, nameOverride, extra = {}) {
  const blob = fileOrBlob instanceof Blob ? fileOrBlob : null;
  if (!blob) throw new Error('savePdfToIndexedDB: harus File/Blob');
  const name = nameOverride || (fileOrBlob.name || '(tanpa-nama)');
  if (blob.type !== 'application/pdf') throw new Error('Type bukan PDF');
  if (!blob.size) throw new Error('PDF kosong');

  // meta dari autoCalibrate (optional)
  let meta = null;
  try {
    const buf = await blob.arrayBuffer();
    meta = await autoCalibratePdf(buf);       // { x,y,linesUK,linesSOL,dx,dy,v }
  } catch (e) {
    console.warn('autoCalibrate gagal:', e);
  }

  const contentHash = extra.contentHash || null;
  const database = await openDb();

  await new Promise((resolve, reject) => {
    const tx = database.transaction([STORE_NAME, STORE_BLOBS], 'readwrite');
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error || new Error('Tx error'));
    // tabel histori (auto increment)
    tx.objectStore(STORE_NAME).add({
      name,
      dateAdded: new Date().toISOString(),
      data: blob,                // keep for backward-compat
      contentHash: contentHash,  // identitas isi
      meta
    });
    // tabel blob by hash (upsert)
    const putBlob = { contentHash, name, size: blob.size, type: blob.type, blob, meta, savedAt: Date.now() };
    tx.objectStore(STORE_BLOBS).put(putBlob);
  });

  console.log(`✅ Tersimpan: ${name} (${(blob.size/1024).toFixed(1)} KB), hash=${contentHash}, meta:`, meta);
  return { contentHash, meta };
}

/* ========= State ========= */
let lokasiTerpilih = "", unitKerja = "-", kantor = "-", tanggal = "-", problem = "-",
    berangkat = "-", tiba = "-", mulai = "-", selesai = "-", progress = "-",
    jenis = "-", sn = "-", merk = "-", tipe = "-", pic = "-", status = "-",
    currentTanggalRaw = "-";
// Catatan: file aktif pakai window.currentFile agar konsisten antar modul
Object.defineProperty(window, 'currentFile', { writable: true, configurable: true, value: window.currentFile || null });

/* ========= Helpers ========= */
function formatTanggalIndo(tanggalStr) {
  const bulan = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
  const [dd, mm, yyyy] = tanggalStr.split("/");
  return `${dd} ${bulan[parseInt(mm,10)-1]} ${yyyy}`;
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

/* ========= Output ========= */
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
  output.textContent = laporanBaru;
}

lokasiSelect?.addEventListener("change", () => {
  lokasiTerpilih = lokasiSelect.value;
  generateLaporan();
});

/* ========= File Input ========= */
pdfInput?.addEventListener("change", async () => {
  const file = pdfInput.files?.[0];
  if (!file) return;
  window.currentFile = file;

  console.log('🧪 File input:', { name: file.name, type: file.type, size: file.size });
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

// ==== AppSheet: handler tombol "Copy" ====
async function appsheetCopyFile(file) {
  const uid = Auth.getUid();
  if (uid === 'anon') { alert('Harus login.'); return; }
  const sha256 = await sha256File(file);
  const { fileId, deduped } = await DriveSync.savePdfByHash(file, sha256);

  const key = `PdfCatalog__${uid}`;
  const map = JSON.parse(localStorage.getItem(key) || '{}');
  map[sha256] = { fileId, name:file.name, size:file.size, mime:file.type, at: Date.now() };
  localStorage.setItem(key, JSON.stringify(map));

  toast?.(deduped ? 'Pakai file Drive (no re-upload)' : 'PDF diunggah ke Drive');
}

/* ========= Copy & Save ========= */
copyBtn?.addEventListener("click", async () => {
  // Copy ke clipboard (prefer async API)
  const text = output.textContent || '';
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement("textarea");
      ta.value = text; document.body.appendChild(ta); ta.select();
      document.execCommand("copy"); ta.remove();
    }
    copyBtn.textContent = "✔ Copied!";
  } catch {
    copyBtn.textContent = "⚠ Copy gagal";
  }
  setTimeout(() => (copyBtn.textContent = "Copy"), 1500);

  // Simpan histori + blob + antre/upload Drive
  const file = window.currentFile;
  if (!file || !currentTanggalRaw) return;

  // === HASH BARU ===
  const contentHash = await sha256File(file);

  const namaUkerBersih = stripLeadingColon(unitKerja) || '-';
  const histori = JSON.parse(localStorage.getItem("pdfHistori")) || [];

  // DEDUPE BERDASARKAN HASH (file identik saja yang diblokir)
  const isIdentik = histori.some(x => x.contentHash === contentHash);

  if (!isIdentik) {
    const rec = {
      namaUker: namaUkerBersih,
      tanggalPekerjaan: currentTanggalRaw,
      fileName: file.name,
      contentHash,                          // identitas isi
      size: file.size,
      uploadedAt: new Date().toISOString(),
      module: 'appsheet'
    };
    histori.push(rec);
    localStorage.setItem("pdfHistori", JSON.stringify(histori));

    await savePdfToIndexedDB(file, undefined, { contentHash }); // simpan blob + hash

    // === Tulis manifest per-akun ke Drive (supaya device lain langsung lihat) ===
try {
  // ambil array histori terkini (pakai namespace jika ada)
  const arr = (window.AccountStore?.nsKey)
    ? JSON.parse(localStorage.getItem(window.AccountStore.nsKey('pdfHistori')) || '[]')
    : JSON.parse(localStorage.getItem('pdfHistori') || '[]');

  // tentukan UID aktif (fallback 'anon')
  const uid = (window.DriveSync?.getUser?.()?.uid)
           || (window.Auth?.user?.uid)
           || (window.Auth?.currentUser?.()?.uid)
           || 'anon';

  const name = `.bribox_histori__${uid}.json`;
  await window.DriveSync?.putTextFile?.(name, JSON.stringify(arr), 'application/json');
  // (opsional) kasih tahu user diam-diam atau abaikan saja
} catch (e) {
  console.warn('push manifest gagal:', e);
}


    // === Drive: upload langsung kalau siap, kalau tidak antri
    try {
      const res = await (window.DriveQueue?.enqueueOrUpload?.(file, contentHash));
      if (res?.uploaded) {
        showToast('✔ tersimpan & disinkron ke Drive.');
      } else {
        showToast('⏳ tersimpan & ditaruh di antrean Drive.');
      }
    } catch (e) {
      console.warn('enqueue/upload drive gagal:', e);
      showToast('✔ tersimpan lokal. Hubungkan Drive untuk sinkron.');
    }
  } else {
    showToast(`ℹ sudah ada di histori.`);
  }
});
