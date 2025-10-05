// ====== Trackmate ======

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



document.addEventListener('DOMContentLoaded', () => {
  const pdfInput  = document.getElementById('pdfFile');
  const lokasiSel = document.getElementById('inputLokasi');
  const output    = document.getElementById('output'); // di AppSheet kamu juga punya <pre id="output">

  async function sha256Hex(ab){
    const h = await crypto.subtle.digest('SHA-256', ab);
    return Array.from(new Uint8Array(h)).map(b=>b.toString(16).padStart(2,'0')).join('');
  }

  async function maybeUpload(){
    const file   = pdfInput?.files?.[0];
    const lokasi = (lokasiSel?.value || '').trim();
    if (!file || !lokasi) return;
    if (!DriveSync?.isLogged?.()) { alert('Sambungkan Google Drive dulu.'); return; }

    output && (output.textContent = 'Menghitung hash & menyiapkan upload...');
    const hash = await sha256Hex(await file.arrayBuffer());

    try {
      const exist = await DriveSync.findByHashPrefix(hash, lokasi);
      let meta;
      if (exist) {
        meta = { id: exist.id, name: exist.name };
        output && (output.textContent = 'File sudah ada, tidak diupload ulang.');
      } else {
        output && (output.textContent = 'Mengupload ke Drive...');
        meta = await DriveSync.uploadPdf(file, hash, lokasi);
        output && (output.textContent = 'Upload selesai.');
      }
      const url = `https://drive.google.com/file/d/${meta.id}/view`;
      output && (output.textContent += `\nNama: ${meta.name}\nLink: ${url}`);
    } catch (e) {
      output && (output.textContent = 'Gagal upload: ' + (e?.message || e));
      console.error('[upload error]', e);
    }
  }

  pdfInput?.addEventListener('change', maybeUpload);
  lokasiSel?.addEventListener('change', maybeUpload);
});





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

//* ========= IndexedDB (UPDATED) ========= */
const DB_NAME     = "PdfStorage";   // tetap
const DB_VERSION  = 2;              // ↑ perlu untuk menambah store baru
const STORE_NAME  = "pdfs";         // store lama (kompat)
const STORE_BLOBS = "pdfBlobs";     // store baru: blob by contentHash
let db;

/** Open DB dan siapkan store lama & baru */
function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const _db = event.target.result;
      // Pastikan store lama ada (kompatibilitas)
      if (!_db.objectStoreNames.contains(STORE_NAME)) {
        _db.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
      }
      // Store baru untuk simpan/overwrite blob per contentHash
      if (!_db.objectStoreNames.contains(STORE_BLOBS)) {
        _db.createObjectStore(STORE_BLOBS, { keyPath: "contentHash" });
      }
    };

    request.onsuccess = (event) => {
      db = event.target.result;
      // Jika versi berubah di tab lain, tutup supaya tidak blocked
      db.onversionchange = () => { try { db.close(); } catch {} db = null; };
      resolve(db);
    };

    request.onerror = (event) => {
      console.error("IndexedDB error:", event.target.error || event.target.errorCode);
      reject(event.target.error || event.target.errorCode);
    };

    request.onblocked = () => {
      console.warn("IndexedDB open blocked (mungkin ada tab lain masih terbuka).");
    };
  });
}

/** Pastikan koneksi DB siap dipakai (re-open jika null) */
async function ensureDb() {
  if (db) return db;
  try { return await openDb(); }
  catch (e) { console.warn("openDb gagal:", e); return null; }
}

/** Lifecycle: stabil setelah Back/Forward (bfcache) */
window.addEventListener('pageshow', async (e) => {
  if (e.persisted) {
    // (opsional) reset file input di luar snippet ini: fileInput?.value = '';
    await ensureDb();
  }
});
window.addEventListener('pagehide', () => {
  try { if (db) { db.close(); db = null; } } catch {}
});

/** === BARU ===
 * Simpan blob PDF ke store baru, keyed by contentHash (overwrite-safe).
 * Ini yang dipakai di handler "Copy" versi optimistic UI.
 */
async function saveBlobByHash(fileOrBlob, contentHash) {
  const blob = fileOrBlob instanceof Blob ? fileOrBlob : null;
  if (!blob) throw new Error("saveBlobByHash: argumen harus File/Blob");
  if (blob.type !== "application/pdf") throw new Error("Type bukan PDF");
  if (!blob.size) throw new Error("PDF kosong");
  if (!contentHash) throw new Error("contentHash wajib");

  const database = await ensureDb();
  if (!database) throw new Error("IndexedDB tidak tersedia / gagal dibuka");

  return new Promise((resolve, reject) => {
    const tx = database.transaction([STORE_BLOBS], "readwrite");
    const store = tx.objectStore(STORE_BLOBS);

    const value = {
      contentHash,
      name: (/** @type {File} */(fileOrBlob)).name || "document.pdf",
      size: blob.size,
      dateAdded: new Date().toISOString(),
      data: blob
    };

    const req = store.put(value);        // put = overwrite (tanpa double)
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error || new Error("Tx error"));
    req.onerror   = () => reject(req.error || new Error("Req error"));
  });
}

/** === LAMA (dipertahankan untuk kompatibilitas) ===
 * Simpan ke store lama `pdfs` + titip contentHash & meta.
 * Sekarang sudah:
 *  - pakai ensureDb()
 *  - fail-fast yang jelas
 */
async function savePdfToIndexedDB_keepSchema(fileOrBlob, { contentHash } = {}) {
  const blob = fileOrBlob instanceof Blob ? fileOrBlob : null;
  if (!blob) throw new Error('savePdfToIndexedDB: argumen harus File/Blob');
  if (blob.type !== 'application/pdf') throw new Error('Type bukan PDF');
  if (!blob.size) throw new Error('PDF kosong');

  // (opsional) kalibrasi/ekstrak meta
  let meta = null;
  try {
    const buf = await blob.arrayBuffer();
    if (typeof autoCalibratePdf === "function") {
      meta = await autoCalibratePdf(buf);
    }
  } catch (e) {
    console.warn('autoCalibrate gagal:', e);
  }

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

/* ========= Helpers ========= */
const clean = (x) => String(x || '')
  .replace(/[\u00A0\u2007\u202F]/g, ' ')  // NBSP family -> spasi biasa
  .replace(/\u00C2/g, '')                 // buang 'Â' sisa decode
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
  const norm = s => (s || '')
    .replace(/[\u00A0\u2007\u202F]/g, ' ')   // NBSP family -> space
    .replace(/\s+/g, ' ')
    .trim();

  const text = (lines || []).map(x => x || '').join('\n');

  const startRe = new RegExp(`${startLabel}\\s*:\\s*`, 'i');
  const mStart  = startRe.exec(text);
  if (!mStart) return '';

  const tail = text.slice(mStart.index + mStart[0].length);

  const stopParts = [];
  for (const lbl of stopLabels) stopParts.push(`${lbl}\\s*:\\s*`);
  if (stopLabels.some(s => /^tanggal$/i.test(s))) {
    stopParts.push(`Tanggal(?:\\s*Tiket)?\\s+\\d{1,2}[/-]\\d{1,2}[/-]\\d{2,4}`);
  }
  if (stopLabels.some(s => /^kantor\\s*cabang$/i.test(s))) {
    stopParts.push(`(?<!^)Kantor\\s*Cabang(?!\\s*:)`);
  }
  stopParts.push(`[\\r\\n]+[A-Za-z][A-Za-z/() ]+\\s*:\\s*`);

  const stopPattern = stopParts.join('|');
  const cutRe = new RegExp(`([\\s\\S]*?)(?=${stopPattern})`, 'i');
  const mCut  = cutRe.exec(tail);
  const captured = mCut ? mCut[1] : tail;

  return norm(captured);
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
      // berhenti sebelum label berikutnya
      const stops = [
        'Jabatan','Jenis Perangkat','Serial Number','SN','Merk','Type',
        'Status','STATUS','Tanggal','Nama','Tanda','Cap','Progress',
        'Unit Kerja','Kantor Cabang'
      ];
      // dukung "Pelapor :" ATAU "PIC :"
      const block = extractFlexibleBlock(lines, '(?:Pelapor|PIC)', stops) || '';

      // Format yang didukung: "Nama" atau "Nama (Jabatan)"
      const m = block.match(/^\s*([^()\[\]\n]+?)\s*(?:[\(\[]\s*([^()\[\]]+?)\s*[\)\]])?\s*$/);
      const name = clean(m ? m[1] : block);
      // kalau ada label "Jabatan :" terpisah, angkut juga
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

/* ========= Copy & Save Histori (single final toast) ========= */
copyBtn?.addEventListener("click", async () => {
  try {
    // 0) Copy teks ke clipboard (pakai API modern + fallback)
const text = (typeof output !== "undefined" && output?.textContent) ? output.textContent : "";
try {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
  } else {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }
} catch (_) {
  // diamkan; nanti toast tetap muncul
}
if (copyBtn) {
  copyBtn.textContent = "✔ Copied!";
  setTimeout(() => (copyBtn.textContent = "Copy"), 1500);
}


    // 1) Validasi file
    const file = fileInput?.files?.[0];
    if (!file) { showToast("⚠ Tidak ada file PDF yang dipilih.", 3500, "warn"); return; }

    // 2) Hash (pakai fallback jika hashing error)
    let contentHash;
    try { contentHash = await sha256File(file); }
    catch { contentHash = `fz_${file.size}_${file.lastModified}_${Math.random().toString(36).slice(2,10)}`; }

    // 3) Siapkan entri histori
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

    const histori = JSON.parse(localStorage.getItem('pdfHistori')) || [];
    const exists = histori.some(x => x.contentHash === contentHash);

    // 4) Jika sudah ada ⇒ 1 toast biru (info), selesai
    if (exists) {
      showToast("ℹ Sudah ada di histori", 3000, "info");
      return;
    }

    // 5) Belum ada ⇒ simpan ke histori (localStorage), lalu coba simpan file ke IDB
    histori.push(newEntry);
    localStorage.setItem('pdfHistori', JSON.stringify(histori));

    const TIMEOUT_MS = 3000; // 3s batas tunggu supaya gak lama
    try {
      await Promise.race([
        savePdfToIndexedDB_keepSchema(file, { contentHash }),  // simpan file asli + hash
        new Promise((_, rej) => setTimeout(() => rej(new Error("IDB timeout")), TIMEOUT_MS))
      ]);

      // Sukses penuh ⇒ 1 toast hijau
      showToast("✔ Berhasil disimpan ke histori", 3000, "success");

    } catch (err) {
      console.warn("IndexedDB gagal/timeout:", err);
      // Histori sudah tersimpan, tapi file asli gagal ⇒ 1 toast kuning
      showToast("⚠ Histori disimpan. File PDF asli gagal disimpan (Refresh Page & Input kembali file yang sama).", 5000, "warn");
    }

  } catch (err) {
    console.error("Copy handler error:", err);
    showToast(`❌ Error: ${err?.message || err}`, 4500, "warn");
  }
});

/* ========= Toast util (FAST & RELIABLE, mobile friendly) =========
   Pakai: showToast("Berhasil", 3000, "success"|"info"|"warn")
*/
function showToast(message, duration = 3000, variant = "success") {
  // 1) Ambil / buat elemen tunggal
  let el = document.querySelector(".toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    document.body.appendChild(el);
  }

  // 2) Tema warna sederhana via inline style (kompatibel dengan CSS kamu)
  const bg =
    variant === "info" ? "#0d6efd" :
    variant === "warn" ? "#f59e0b" :
    "#28a745";
  el.style.background = bg;

  // 3) Set teks & reset state
  el.textContent = String(message);
  el.classList.remove("show", "hiding");
  if (el._hideTimer) clearTimeout(el._hideTimer);

  // 4) iOS-safe: commit style dulu baru tambahkan .show (double rAF)
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      el.classList.add("show");
    });
  });

  // 5) Auto-hide + cleanup setelah transisi
  el._hideTimer = setTimeout(() => {
    el.classList.add("hiding");
    el.classList.remove("show");
    const onEnd = () => {
      el.classList.remove("hiding");
      el.removeEventListener("transitionend", onEnd);
    };
    el.addEventListener("transitionend", onEnd, { once: true });
  }, duration);

  // 6) Klik untuk tutup cepat (opsional)
  el.onclick = () => {
    if (el._hideTimer) clearTimeout(el._hideTimer);
    el.classList.add("hiding");
    el.classList.remove("show");
  };
}

