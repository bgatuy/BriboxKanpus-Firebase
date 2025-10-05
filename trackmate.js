// ====== Trackmate ======

/* ========= HASH UTIL ========= */
async function sha256File(file) {
  try {
    const buf = await file.arrayBuffer();
    const hashBuf = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2,'0')).join('');
  } catch {
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
});

/* ========= Query DOM ========= */
const fileInput    = document.getElementById('pdfFile');
const output       = document.getElementById('output');
const copyBtn      = document.getElementById('copyBtn');
const lokasiSelect = document.getElementById('inputLokasi');

/* ========= AUTO-CALIBRATE (aman kalau pdf.js belum ada) ========= */
async function autoCalibratePdf(buffer){
  try{
    if (!window.pdfjsLib?.getDocument) return null;
    const doc = await pdfjsLib.getDocument({ data: buffer }).promise;
    const page = await doc.getPage(1);
    const items = (await page.getTextContent()).items || [];

    let atas = items.find(it => /Diselesaikan\s*Oleh/i.test(it.str));
    if(!atas){
      for(let i=0;i<items.length-1;i++){
        if(/Diselesaikan/i.test(items[i].str) && /Oleh/i.test(items[i+1].str)){ atas = items[i]; break; }
      }
    }
    if (!atas){ try{doc.destroy()}catch{}; return null; }

    const xA = atas.transform[4], yA = atas.transform[5];
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
    let x = xA + 95;
    let y = bawah ? (bawah.transform[5] + 12) : (yA - 32);
    try{ doc.destroy() }catch{}
    return { x, y, dx:0, dy:0, v:1 };
  }catch{ return null; }
}

/* ========= IndexedDB (dua store: pdfs & pdfBlobs) ========= */
const DB_NAME     = "PdfStorage";
const DB_VERSION  = 2;
const STORE_NAME  = "pdfs";
const STORE_BLOBS = "pdfBlobs";
let db;

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const _db = event.target.result;
      if (!_db.objectStoreNames.contains(STORE_NAME))  _db.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
      if (!_db.objectStoreNames.contains(STORE_BLOBS)) _db.createObjectStore(STORE_BLOBS, { keyPath: "contentHash" });
    };
    request.onsuccess = (event) => {
      db = event.target.result;
      db.onversionchange = () => { try{db.close()}catch{}; db=null; };
      resolve(db);
    };
    request.onerror = (e) => reject(e.target.error || e.target.errorCode);
  });
}
async function ensureDb(){ if(db) return db; try{ return await openDb(); }catch{ return null; } }

async function saveBlobByHash(fileOrBlob, contentHash){
  const blob = fileOrBlob instanceof Blob ? fileOrBlob : null;
  if (!blob) throw new Error("saveBlobByHash: argumen harus File/Blob");
  if (blob.type !== "application/pdf" || !blob.size) throw new Error("Blob bukan PDF/empty");
  if (!contentHash) throw new Error("contentHash wajib");
  const database = await ensureDb(); if(!database) throw new Error("DB gagal");
  return new Promise((resolve,reject)=>{
    const tx = database.transaction([STORE_BLOBS], "readwrite");
    const st = tx.objectStore(STORE_BLOBS);
    const put = st.put({
      contentHash,
      name: (/** @type {File} */(fileOrBlob)).name || "document.pdf",
      size: blob.size,
      dateAdded: new Date().toISOString(),
      data: blob
    });
    tx.oncomplete = ()=>resolve();
    tx.onerror = ()=>reject(tx.error||new Error("Tx error"));
    put.onerror = ()=>reject(put.error||new Error("Req error"));
  });
}

async function savePdfToIndexedDB_keepSchema(fileOrBlob, { contentHash } = {}) {
  const blob = fileOrBlob instanceof Blob ? fileOrBlob : null;
  if (!blob) throw new Error('savePdfToIndexedDB: argumen harus File/Blob');
  if (blob.type !== 'application/pdf' || !blob.size) throw new Error('Blob bukan PDF/empty');

  let meta = null;
  try {
    const buf = await blob.arrayBuffer();
    meta = await autoCalibratePdf(buf);
  } catch {}

  const database = await ensureDb(); if(!database) throw new Error("DB gagal");
  await new Promise((resolve, reject) => {
    const tx = database.transaction([STORE_NAME], 'readwrite');
    const st = tx.objectStore(STORE_NAME);
    const req = st.add({
      name: (/** @type {File} */(fileOrBlob)).name || '(tanpa-nama)',
      dateAdded: new Date().toISOString(),
      data: blob,
      contentHash: contentHash || null,
      meta
    });
    tx.oncomplete = resolve;
    tx.onerror = ()=>reject(tx.error||new Error('Tx error'));
    req.onerror = ()=>reject(req.error||new Error('Req error'));
  });
}

/* ========= Helpers parsing ========= */
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
  const cutRe = new RegExp(`([\\s\\S]*?)(?=${stopParts.join('|')})`, 'i');
  const mCut  = cutRe.exec(tail);
  return norm(mCut ? mCut[1] : tail);
}

/* ========= State ========= */
let unitKerja = "-", kantorCabang = "-", tanggalFormatted = "-", tanggalRaw = "",
    problem = "-", berangkat = "-", tiba = "-", mulai = "-", selesai = "-",
    solusi = "-", jenisPerangkat = "-", serial = "-", merk = "-", type = "-",
    pic = "-", status = "-";

/* ========= Events ========= */
lokasiSelect?.addEventListener("change", updateOutput);

fileInput?.addEventListener('change', async function () {
  const file = fileInput.files[0];
  if (!file || file.type !== 'application/pdf') return;

  const reader = new FileReader();
  reader.onload = async function () {
    try {
      const typedarray = new Uint8Array(reader.result);
      const pdf = await (window.pdfjsLib?.getDocument ? pdfjsLib.getDocument(typedarray).promise : Promise.reject('pdf.js tidak ada'));

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
        const stops = ['Jabatan','Jenis Perangkat','Serial Number','SN','Merk','Type','Status','STATUS','Tanggal','Nama','Tanda','Cap','Progress','Unit Kerja','Kantor Cabang'];
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

/* ========= Output ========= */
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

/* ========= Copy & Save Histori (background save + silent Drive upload) ========= */
copyBtn?.addEventListener("click", async () => {
  try {
    // Copy teks (dengan fallback)
    const text = output?.textContent || "";
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else { const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove(); }
    } catch {}

    // feedback kecil di tombol (toast global kamu sudah ada)
    if (copyBtn) { copyBtn.textContent = "✔ Copied!"; setTimeout(()=>copyBtn.textContent="Copy", 1500); }

    // Validasi file
    const file = fileInput?.files?.[0];
    if (!file) { showToast("⚠ Tidak ada file PDF yang dipilih.", 3500, "warn"); return; }

    // Hash
    let contentHash;
    try { contentHash = await sha256File(file); }
    catch { contentHash = `fz_${file.size}_${file.lastModified}_${Math.random().toString(36).slice(2,10)}`; }

    // Entri histori
    const unitKerjaVal   = typeof unitKerja === "string" ? unitKerja : "";
    const tanggalRawVal  = typeof tanggalRaw  === "string" ? tanggalRaw : "";
    const namaUkerBersih = stripLeadingColon(unitKerjaVal) || "-";

    const newEntry = {
      namaUker: namaUkerBersih,
      tanggalPekerjaan: tanggalRawVal,
      fileName: file.name || "-",
      contentHash,
      size: file.size,
      uploadedAt: new Date().toISOString()
    };

    const histori = JSON.parse(localStorage.getItem('pdfHistori') || '[]');
    if (!histori.some(x => x.contentHash === contentHash)) {
      localStorage.setItem('pdfHistori', JSON.stringify([...histori, newEntry]));
    } else {
      showToast("ℹ Sudah ada di histori", 3000, "info");
      return;
    }

    // Simpan PDF ke IndexedDB (dua store). Jangan blok UI lama—pakai timeout proteksi.
    const TIMEOUT_MS = 3000;
    try{
      await Promise.race([
        (async()=>{
          await savePdfToIndexedDB_keepSchema(file, { contentHash });
          await saveBlobByHash(file, contentHash); // juga ke store baru keyed by hash
        })(),
        new Promise((_,rej)=>setTimeout(()=>rej(new Error("IDB timeout")), TIMEOUT_MS))
      ]);
      showToast("✔ Berhasil disimpan ke histori", 3000, "success");
    }catch(e){
      console.warn("IndexedDB gagal/timeout:", e);
      showToast("⚠ Histori disimpan. File PDF asli gagal disimpan (Refresh Page & input ulang).", 5000, "warn");
    }

    // SILENT UPLOAD ke Google Drive (root “Bribox Kanpus”, nama asli). Tanpa UI status.
    try{
      const ok = await (window.DriveSync?.tryResume?.() || Promise.resolve(false));
      if (ok || window.DriveSync?.isLogged?.()) {
        window.DriveSync.uploadPdf(file, null, null, { simpleName: true }).catch(()=>{});
      }
    }catch{ /* diam */ }

  } catch (err) {
    console.error("Copy handler error:", err);
    showToast(`❌ Error: ${err?.message || err}`, 4500, "warn");
  }
});

/* ========= Toast util ========= */
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
  el.classList.remove("show","hiding");
  if (el._hideTimer) clearTimeout(el._hideTimer);
  requestAnimationFrame(()=>requestAnimationFrame(()=>el.classList.add("show")));
  el._hideTimer = setTimeout(()=>{
    el.classList.add("hiding"); el.classList.remove("show");
    const onEnd=()=>{ el.classList.remove("hiding"); el.removeEventListener("transitionend", onEnd); };
    el.addEventListener("transitionend", onEnd, { once:true });
  }, duration);
  el.onclick = ()=>{ if (el._hideTimer) clearTimeout(el._hideTimer); el.classList.add("hiding"); el.classList.remove("show"); };
}
