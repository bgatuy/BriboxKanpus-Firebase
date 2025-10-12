// ===== FORM SERAH TERIMA =====

/*************************
 *   ELEMENTS & GLOBALS  *
 *************************/
const tbody = document.getElementById('historiBody');
const inputTanggalSerah = document.getElementById('tglSerahTerima');
const btnGenerate = document.getElementById('btnGenerate'); // tombol lama (tetap)
const btnReset = document.getElementById('btnReset');
const selNama = document.getElementById('selNamaTTD');

// Tombol baru (opsional – hanya jika ada di HTML)
const btnGenCombo     = document.getElementById('btnGenCombo');
const btnGenCMOnly    = document.getElementById('btnGenCMOnly');
const btnGenFilesOnly = document.getElementById('btnGenFilesOnly');

// Master checkbox (opsional – jika kamu tambah di header)
const pickAll = document.getElementById('pickAll');

// Debug flags (boleh dibuat false kalau sudah stabil)
const DEBUG_SHOW_MARKER = false;   // titik oranye
const DEBUG_CONSOLE_LOG = false;   // log stamping & meta

/********************
 *   UI: SPINNER    *
 ********************/
const spinner = document.createElement('div');
spinner.className = 'loading-spinner';
spinner.innerHTML = '<div class="spinner"></div>';
document.body.appendChild(spinner);
spinner.style.display = 'none';
function showSpinner() { spinner.style.display = 'flex'; }
function hideSpinner()  { spinner.style.display = 'none'; }
const style = document.createElement('style');
style.textContent = `
.loading-spinner{position:fixed;inset:0;background:rgba(255,255,255,.7);z-index:9999;display:flex;align-items:center;justify-content:center}
.spinner{width:40px;height:40px;border:4px solid #ccc;border-top-color:#007bff;border-radius:50%;animation:spin 1s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.toast{position:fixed;left:50%;top:16px;transform:translateX(-50%);background:#333;color:#fff;padding:8px 12px;border-radius:8px;z-index:99999;opacity:0;transition:.2s}
`;
document.head.appendChild(style);

/********************
 *   SIDEBAR/UX     *
 ********************/
const sidebar   = document.querySelector('.sidebar');
const overlay   = document.getElementById('sidebarOverlay') || document.querySelector('.sidebar-overlay');
const sidebarLinks = document.querySelectorAll('.sidebar a');
function openSidebar(){sidebar.classList.add('visible');overlay?.classList.add('show');document.body.style.overflow='hidden';}
function closeSidebar(){sidebar.classList.remove('visible');overlay?.classList.remove('show');document.body.style.overflow='';}
function toggleSidebar(){sidebar.classList.contains('visible')?closeSidebar():openSidebar();}
window.toggleSidebar = toggleSidebar;
overlay?.addEventListener('click', closeSidebar);
document.addEventListener('click', (e)=>{const isMobile=window.matchMedia('(max-width:768px)').matches;if(!isMobile)return;if(sidebar.classList.contains('visible')&&!sidebar.contains(e.target)&&!e.target.closest('.sidebar-toggle-btn'))closeSidebar();});
document.addEventListener('keydown', e=>{if(e.key==='Escape'&&sidebar.classList.contains('visible'))closeSidebar();});
sidebarLinks.forEach(a=>a.addEventListener('click', closeSidebar));
document.addEventListener('DOMContentLoaded', function () {
  const title = document.querySelector('.dashboard-header h1')?.textContent?.toLowerCase() || "";
  const body = document.body;
  if (title.includes('trackmate')) body.setAttribute('data-page','trackmate');
  else if (title.includes('appsheet')) body.setAttribute('data-page','appsheet');
  else if (title.includes('serah')) body.setAttribute('data-page','serah');
  else if (title.includes('merge')) body.setAttribute('data-page','merge');
});

/********************
 *   UTILITIES      *
 ********************/
const stripLeadingColon = (s) => (s || '').replace(/^\s*:+\s*/, '');
function toNumDateDMY(s){const m=(s||'').match(/(\d{2})\/(\d{2})\/(\d{4})/); if(!m) return 0; const ts=Date.parse(`${m[3]}-${m[2]}-${m[1]}`); return Number.isNaN(ts)?0:ts;}
function formatTanggalSerahForPdf(val){ if(!val||!/^\d{4}-\d{2}-\d{2}$/.test(val)) return '-'; const [y,m,d]=val.split('-'); return `${d}/${m}/${y}`;}
// Ganti implementasi jadi:
function getPdfHistori(){
   try {
     const key = window.AccountNS?.nsKey ? window.AccountNS.nsKey('pdfHistori') : 'pdfHistori';
     return JSON.parse(localStorage.getItem(key) || '[]');
   } catch { return []; }
 }
 function setPdfHistori(arr){
   const key = window.AccountNS?.nsKey ? window.AccountNS.nsKey('pdfHistori') : 'pdfHistori';
   localStorage.setItem(key, JSON.stringify(arr || []));
   return arr;
 }
// preload cache scoped
document.addEventListener('DOMContentLoaded', ()=>{ try{ window.AccountStore?.loadHistori?.(); }catch{} });

/** Optional toast (dipakai di tempat lain), FST tidak menambah toast baru */
function showToast(message, duration = 2500) {
  const toast = document.createElement('div'); toast.className = 'toast'; toast.textContent = message;
  document.body.appendChild(toast); setTimeout(()=>toast.style.opacity='1',10);
  const rm=()=>{toast.style.opacity='0'; setTimeout(()=>toast.remove(),200);}; setTimeout(rm,duration); toast.addEventListener('click',rm);
}

function ensureLibsOrThrow(opts = { requireJsPDF: false, requirePDFLib: true, requirePdfjs: false }) {
  if (opts.requireJsPDF && !window.jspdf?.jsPDF) throw new Error("jsPDF belum dimuat.");
  if (opts.requirePDFLib && !window.PDFLib?.PDFDocument) throw new Error("pdf-lib belum dimuat.");
  if (opts.requirePdfjs && !window.pdfjsLib?.getDocument) throw new Error("pdf.js belum dimuat.");
}

/********************
 *   DROPDOWN SAVE  *
 ********************/
const KEY_NAMA='serah_ttd_nama';
function loadNama(){
  // jangan restore dari storage; selalu balik ke default
  if (selNama) { selNama.selectedIndex = 0; selNama.value = ''; }
  // bersihkan sisa lama kalau pernah tersimpan
  localStorage.removeItem(KEY_NAMA);
}

window.addEventListener('pageshow', (e) => {
  const nav = performance.getEntriesByType('navigation')[0];
  if (e.persisted || (nav && nav.type !== 'navigate')) {
    if (selNama) { selNama.selectedIndex = 0; selNama.value = ''; }
  }
});

/********************
 *   TABLE RENDER   *
 ********************/
// Perkuat agar tetap benar walau ada kolom checkbox "Pilih" di paling kiri
function collectRowsForPdf(){
  const rows=[];
  document.querySelectorAll('#historiBody tr').forEach((tr,i)=>{
    const cells = tr.querySelectorAll('td');
    if (cells.length < 6) return;

    // Deteksi keberadaan kolom "Pilih"
    const hasPickCol = !!tr.querySelector('input.pick') || (cells.length >= 7);

    const idxNo   = hasPickCol ? 1 : 0;
    const idxSer  = hasPickCol ? 2 : 1;
    const idxUker = hasPickCol ? 3 : 2;
    const idxPek  = hasPickCol ? 4 : 3;

    const noCell  = cells[idxNo];
    const serCell = tr.querySelector('.tgl-serah') || cells[idxSer];

    const no = (noCell?.textContent || `${i+1}`).trim();
    const raw = (serCell?.dataset?.iso || serCell?.textContent || '').trim();
    const tanggalSerah = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? formatTanggalSerahForPdf(raw) : (raw || '-');
    const namaUker = stripLeadingColon((cells[idxUker]?.textContent || '-').trim());
    const tanggalPekerjaan = (cells[idxPek]?.textContent || '-').trim();

    rows.push({ no, tanggalSerah, namaUker, tanggalPekerjaan });
  });
  return rows;
}

function syncPickAllState(){
  if (!pickAll) return;
  const cbs = Array.from(document.querySelectorAll('#historiBody input.pick'));
  if (!cbs.length){ pickAll.checked=false; pickAll.indeterminate=false; return; }
  const allChecked = cbs.every(cb => cb.checked);
  const anyChecked = cbs.some(cb => cb.checked);
  pickAll.checked = allChecked;
  pickAll.indeterminate = anyChecked && !allChecked;
}

function renderTabel(){
  if(!tbody) return;
  let data = getPdfHistori();

  if(!data.length){
    const headerHasPick = !!document.getElementById('pickAll');
    const colspan = headerHasPick ? 7 : 6;
    tbody.innerHTML = `<tr><td colspan="${colspan}" style="text-align:center;">Belum ada data histori. Unggah PDF di Trackmate atau AppSheet.</td></tr>`;
    // reset master checkbox state
    if (pickAll){ pickAll.checked=false; pickAll.indeterminate=false; }
    return;
  }

  data = data
    .map((it, i) => ({ ...it, _idx: i }))
    .sort((a, b) => {
      const ka = toNumDateDMY(a.tanggalPekerjaan) || Date.parse(a.uploadedAt || 0) || 0;
      const kb = toNumDateDMY(b.tanggalPekerjaan) || Date.parse(b.uploadedAt || 0) || 0;
      if (ka !== kb) return ka - kb;
      return a._idx - b._idx;
    })
    .map((it,i)=>({ ...it, _no: i+1, namaUker: stripLeadingColon(it.namaUker) }));

  // cek apakah header punya kolom Pilih (master checkbox)
  const headerHasPick = !!document.getElementById('pickAll');

  tbody.innerHTML = data.map((item, idx)=>{
    const iso = inputTanggalSerah?.value || '';
    const tglSerahText = iso ? formatTanggalSerahForPdf(iso) : '';
    const tglSerahData = iso ? `data-iso="${iso}"` : '';
    return `
    <tr data-i="${idx}" data-name="${(item.fileName||'').replace(/"/g,'&quot;')}" data-hash="${item.contentHash||''}">
      ${headerHasPick ? `<td style="text-align:center"><input type="checkbox" class="pick"></td>` : ``}
      <td>${item._no}</td>
      <td contenteditable="true" class="tgl-serah" ${tglSerahData}>${tglSerahText}</td>
      <td>${(item.namaUker || '-').replace(/\s+/g,' ').trim()}</td>
      <td>${item.tanggalPekerjaan || '-'}</td>
      <td>${item.fileName || '-'}</td>
      <td><button class="danger btn-del" data-i="${idx}" type="button">Hapus</button></td>
    </tr>`;
  }).join('');

  // sinkron master checkbox setelah render
  syncPickAllState();
}

  // sinkron state tombol berdasarkan tanggal & pilihan
  const iso = inputTanggalSerah?.value || '';
  if (btnGenerate)   btnGenerate.disabled   = !iso;
  if (btnGenCombo)   btnGenCombo.disabled   = !iso;
  if (btnGenCMOnly)  btnGenCMOnly.disabled  = !iso;
  if (btnGenFilesOnly){
    const anyChecked = !!document.querySelector('#historiBody input.pick:checked');
    btnGenFilesOnly.disabled = !iso || !anyChecked;
  }


/********************
 *   INDEXEDDB      *
 ********************/
function openDb(){
  return new Promise((res, rej) => {
    const req = indexedDB.open(currentDbName());
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('pdfs')) {
        db.createObjectStore('pdfs', { keyPath:'id', autoIncrement:true });
      }
      if (!db.objectStoreNames.contains('pdfBlobs')) {
        db.createObjectStore('pdfBlobs', { keyPath:'contentHash' });
      }
    };
    req.onsuccess = (e) => res(e.target.result);
    req.onerror   = () => rej('Gagal buka DB');
  });
}
function clearIndexedDB(){
  return new Promise((resolve,reject)=>{
    const request=indexedDB.deleteDatabase(currentDbName());
    request.onsuccess=()=>resolve(true);
    request.onerror =()=>reject("Gagal hapus database IndexedDB");
    request.onblocked=()=>reject("Hapus database diblokir oleh tab lain");
  });
}
async function getAllPdfBuffersFromIndexedDB(preferredOrderNames = []) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(currentDbName());
    req.onerror = () => reject('Gagal buka IndexedDB');
    req.onsuccess = async (event) => {
      try {
        const db = event.target.result;
        const items = [];

        // Helper ambil semua dari sebuah store jika ada
        const collectFromStore = (storeName) => new Promise((res2) => {
          if (!db.objectStoreNames.contains(storeName)) return res2(); // skip jika tidak ada
          const tx = db.transaction([storeName], 'readonly');
          const store = tx.objectStore(storeName);
          const getAllReq = store.getAll();
          getAllReq.onsuccess = async () => {
            const rows = getAllReq.result || [];
            for (const entry of rows) {
              const blob = entry?.blob || entry?.data; // <= IMPORTANT: pdfBlobs.blob || pdfs.data
              const name = entry?.name || '(tanpa-nama)';
              if (!(blob instanceof Blob) || blob.type !== 'application/pdf' || !blob.size) continue;
              const buffer = await blob.arrayBuffer();
              items.push({
                name,
                buffer,
                meta: entry?.meta || null,
                contentHash: entry?.contentHash || null
              });
            }
            res2();
          };
          getAllReq.onerror = () => res2();
        });

        // Kumpulkan dari keduanya bila ada
        await collectFromStore('pdfs');
        await collectFromStore('pdfBlobs');

        // Urutkan sesuai preferensi (opsional)
        if (Array.isArray(preferredOrderNames) && preferredOrderNames.length) {
          items.sort((a, b) => {
            const ia = preferredOrderNames.indexOf(a.name);
            const ib = preferredOrderNames.indexOf(b.name);
            return (ia === -1 ? 9e6 : ia) - (ib === -1 ? 9e6 : ib);
          });
        }
        resolve(items);
      } catch (e) { reject(e); }
    };
  });
}

/* Ambil buffer sesuai pilihan (hash → fallback nama), urut sesuai pilihan tabel */
async function fetchPdfBuffersBySelection(selected){
  const all = await getAllPdfBuffersFromIndexedDB([]);
  const byHash = new Map(), byName = new Map();
  for (const it of all){
    if (it.contentHash) byHash.set(it.contentHash, it);
    if (it.name)        byName.set(it.name, it);
  }
  const out = [];
  for (const s of selected){
    let hit=null;
    if (s.hash && byHash.has(s.hash)) hit = byHash.get(s.hash);
    else if (s.name && byName.has(s.name)) hit = byName.get(s.name);
    if (hit) out.push(hit);
  }
  return out;
}

 function currentDbName(){
   try { if (window.AccountNS?.currentDbName) return window.AccountNS.currentDbName('PdfStorage'); }
   catch {}
   return 'PdfStorage';
 }

/*****************************************
 *   AUTO-ANCHOR (fallback pakai PDF.js) *
 *****************************************/
async function findAnchorsDiselesaikan(buffer){
  if (!window.pdfjsLib) return [];
  const doc = await pdfjsLib.getDocument({ data: buffer }).promise;
  const anchors = [];
  for (let p = 1; p <= doc.numPages; p++){
    const page = await doc.getPage(p);
    const items = (await page.getTextContent()).items || [];

    // "Diselesaikan Oleh," (kolom tengah)
    let atas = items.find(it => /Diselesaikan\s*Oleh/i.test(it.str));
    if(!atas){
      for(let i=0;i<items.length-1;i++){
        if(/Diselesaikan/i.test(items[i].str) && /Oleh/i.test(items[i+1].str)){ atas = items[i]; break; }
      }
    }
    if (!atas){ anchors.push(null); continue; }

    const xA = atas.transform[4], yA = atas.transform[5];

    // "Nama & Tanda Tangan" di bawahnya (pilih yang sekolom tengah)
    const kandidat = items.filter(it =>
      /Nama\s*&?\s*Tanda\s*&?\s*Tangan/i.test(it.str) &&
      it.transform && it.transform[5] < yA
    );
    let bawah=null, best=Infinity;
    for(const it of kandidat){
      const x = it.transform[4], y = it.transform[5];
      const dx=Math.abs(x-xA), dy=Math.max(0,yA-y);
      const score = 1.6*dx + dy;
      if (dx <= 120 && score < best){ best = score; bawah = it; }
    }
    // titik dasar: sedikit di atas label kecil; x di pusat kolom tengah
    let x = xA + 95;
    let y = bawah ? (bawah.transform[5] + 12) : (yA - 32);

    anchors.push({ x, y });
  }
  try { doc.destroy && doc.destroy(); } catch {}
  return anchors;
}

/***************************************
 *   GENERATE & MERGE (main function)  *
 ***************************************/
async function generatePdfSerahTerima(){
  ensureLibsOrThrow({ requireJsPDF: true, requirePDFLib: true, requirePdfjs: false });
  const histori=getPdfHistori();
  if(!histori.length){ alert("Histori kosong. Tidak bisa generate PDF."); return; }

  // Ambil pilihan nama
  const namaTeknisi = (selNama?.value || '').trim();
  const namaDiselesaikan = namaTeknisi || '';

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF('p','mm','a4');
  const rows = collectRowsForPdf();
  if(rows.length===0){ alert('Tidak ada data untuk digenerate.'); return; }

  // --- REKAP ---
  const chunkSize=50, chunks=[];
  for(let i=0;i<rows.length;i+=chunkSize) chunks.push(rows.slice(i,i+chunkSize));

  let globalIndex=0;
  chunks.forEach((chunk,idx)=>{
    if(idx>0) doc.addPage();
    const pageWidth = doc.internal.pageSize.getWidth();
    doc.setFontSize(18); doc.setFont(undefined,'bold');
    doc.text('FORM TANDA TERIMA CM', pageWidth/2, 20, { align:'center' });

    doc.autoTable({
      head:[['NO.','TANGGAL SERAH TERIMA','NAMA UKER','TANGGAL PEKERJAAN']],
      body:chunk.map(r=>{globalIndex+=1; return [r.no||globalIndex, r.tanggalSerah||'-', r.namaUker||'-', r.tanggalPekerjaan||'-'];}),
      startY:28,
      styles:{ fontSize:5, minCellHeight:4, cellPadding:0.5, halign:'center', valign:'middle', lineColor:[0,0,0], lineWidth:.2, textColor:[0,0,0]},
      headStyles:{ fillColor:false, fontSize:7, fontStyle:'bold'},
      bodyStyles:{ fontSize:5, textColor:[0,0,0], lineColor:[0,0,0]},
      columnStyles:{ 0:{cellWidth:10}, 1:{cellWidth:40}, 2:{cellWidth:90}, 3:{cellWidth:40}},
      theme:'grid', margin:{left:15,right:15}
    });

    const yAfter = (doc.lastAutoTable?.finalY || 32) + 3;
    doc.autoTable({
      head:[['TTD TEKNISI','TTD LEADER','TTD CALL CENTER']],
      body:[['','','']],
      startY:yAfter,
      styles:{ fontSize:7, halign:'center', valign:'middle', lineColor:[0,0,0], lineWidth:.2, textColor:[0,0,0]},
      headStyles:{ fontStyle:'bold', fontSize:7, textColor:[0,0,0], fillColor:false, minCellHeight:5},
      bodyStyles:{minCellHeight:24},
      columnStyles:{ 0:{cellWidth:60}, 1:{cellWidth:60}, 2:{cellWidth:60}},
      theme:'grid', margin:{left:15,right:15},
      didDrawCell: (data) => {
        if (data.section !== 'body') return;
        const { cell, column } = data;
        if (column.index === 0) {
          const txt = (namaTeknisi || '').trim();
          if (!txt) return;
          doc.setFontSize(8);
          const yText = cell.y + cell.height - 3.5;
          doc.text(txt, cell.x + cell.width / 2, yText, { align: 'center' });
        }
      }
    });
  });

  // --- jsPDF -> buffer rekap ---
  const mainPdfBlob = doc.output('blob');
  const mainPdfBuffer = await mainPdfBlob.arrayBuffer();

  // --- Ambil file dari IndexedDB (buffer + meta) ---
  const prefer = [...document.querySelectorAll('#historiBody tr[data-name]')]
  .map(tr => (tr.getAttribute('data-name') || '').trim())
  .filter(Boolean);

  const uploadBuffers = await getAllPdfBuffersFromIndexedDB(prefer);

  // --- Merge & Stamping ---
  const mergedPdf = await PDFLib.PDFDocument.create();
  const mainDoc = await PDFLib.PDFDocument.load(mainPdfBuffer);
  const helv = await mergedPdf.embedFont(PDFLib.StandardFonts.Helvetica);
  const mainPages = await mergedPdf.copyPages(mainDoc, mainDoc.getPageIndices());
  mainPages.forEach(p=>mergedPdf.addPage(p));
  let offset = mainPages.length;

  for(const {name, buffer, meta} of uploadBuffers){
    try{
      const donor = await PDFLib.PDFDocument.load(buffer);
      const donorPages = await mergedPdf.copyPages(donor, donor.getPageIndices());

      // fallback: cari anchor otomatis (kalau meta tidak ada)
      let anchors = [];
      try{ anchors = await findAnchorsDiselesaikan(buffer); } catch(e){ anchors = []; }

      donorPages.forEach((pg,i)=>{
        mergedPdf.addPage(pg);
        const page = mergedPdf.getPage(offset + i);
        const sz = page.getSize();

        // baseline fallback
        let x = sz.width * 0.493;
        let y = sz.height * 0.207;

        // 1) Prioritas: META tersimpan saat upload
        if (meta && typeof meta.x==='number' && typeof meta.y==='number') {
          x = meta.x + (meta.dx||0);
          y = meta.y + (meta.dy||0);
        }
        // 2) Jika meta tidak ada, tapi anchor on-the-fly ada → pakai anchor
        else {
          const an = anchors[i];
          if (an && typeof an.x === 'number' && typeof an.y === 'number'){
            x = an.x; y = an.y;
          }
        }
        // Geser global
        const GLOBAL_X_BIAS_PT = -55;
        const GLOBAL_Y_BIAS_PT = 3;
        x += GLOBAL_X_BIAS_PT; y += GLOBAL_Y_BIAS_PT;

        // Debug marker/log
        if (DEBUG_SHOW_MARKER) {
          page.drawRectangle({ x:x-3, y:y-3, width:6, height:6, color: PDFLib.rgb(1,0.5,0) });
        }
        if (DEBUG_CONSOLE_LOG) {
          console.log('[STAMP]', { page: offset+i+1, file: name, meta, anchor: anchors[i], finalXY:{x,y} });
        }

        // Jika file menandai skipStamp (contoh: PDF dari AppSheet), jangan stamp ulang
       if (meta && meta.skipStamp === true) {
         return; // lewati penulisan nama untuk halaman ini
       }

        // Gambar nama (center)
        const size = 8;
        const text = (namaDiselesaikan || '').trim() || ' ';
        const w = helv.widthOfTextAtSize(text, size) || 0;
        page.drawText(text, {
          x: x - w/2,
          y: Math.max(30, Math.min(y, sz.height - 30)),
          size,
          font: helv,
          color: PDFLib.rgb(0,0,0)
        });
      });

      offset += donorPages.length;
    }catch(e){ console.warn(`❌ Gagal merge/stamp file "${name}"`, e); }
  }

  const mergedBytes = await mergedPdf.save();
  const mergedBlob  = new Blob([mergedBytes], { type:'application/pdf' });

  // download
  const url = URL.createObjectURL(mergedBlob);
  const a = document.createElement('a'); a.href = url; a.download = 'Form CM merged.pdf'; a.click();
  URL.revokeObjectURL(url);

  // === Silent upload ke Drive (root, nama asli) — kalau helper tersedia ===
  try {
    if (typeof window.saveGeneratedPdfSilent === 'function') {
      await window.saveGeneratedPdfSilent(mergedBlob, 'Form CM merged');
    }
  } catch {}
}

/* ===== Tambahan: generator baru TANPA mengganggu yang lama ===== */

// Baca pilihan dari tabel: kalau tidak ada yg dicentang → anggap semua
function getSelectedFromTable(){
  const rows = Array.from(document.querySelectorAll('#historiBody tr[data-name], #historiBody tr[data-hash]'));
  const picked = rows.filter(r => r.querySelector('input.pick')?.checked);
  const base = (picked.length ? picked : rows);
  return base.map(r => ({
    hash: r.getAttribute('data-hash') || '',
    name: r.getAttribute('data-name') || ''
  }));
}

// jsPDF: bangun FORM CM saja
async function buildFormCMBlob(){
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF('p','mm','a4');
  if (typeof doc.autoTable !== 'function') {
    throw new Error('jspdf-autotable belum dimuat.');
  }

  const rows = collectRowsForPdf();
  if(rows.length===0) throw new Error('Tidak ada data untuk FORM CM');

  const pageWidth = doc.internal.pageSize.getWidth();
  doc.setFontSize(18); doc.setFont(undefined,'bold');
  doc.text('FORM TANDA TERIMA CM', pageWidth/2, 20, { align:'center' });

  const namaTeknisi = (selNama?.value || '').trim();

  // chunk 50 baris (mirip fungsi lama)
  let globalIndex=0;
  const chunkSize=50;
  for(let i=0;i<rows.length;i+=chunkSize){
    const chunk = rows.slice(i,i+chunkSize);
    if(i>0) doc.addPage();
    doc.autoTable({
      head:[['NO.','TANGGAL SERAH TERIMA','NAMA UKER','TANGGAL PEKERJAAN']],
      body:chunk.map(r=>{globalIndex+=1;return [r.no||globalIndex, r.tanggalSerah||'-', r.namaUker||'-', r.tanggalPekerjaan||'-'];}),
      startY:28,
      styles:{ fontSize:5, minCellHeight:4, cellPadding:0.5, halign:'center', valign:'middle', lineColor:[0,0,0], lineWidth:.2, textColor:[0,0,0]},
      headStyles:{ fillColor:false, fontSize:7, fontStyle:'bold'},
      bodyStyles:{ fontSize:5, textColor:[0,0,0], lineColor:[0,0,0]},
      columnStyles:{ 0:{cellWidth:10}, 1:{cellWidth:40}, 2:{cellWidth:90, halign:'center'}, 3:{cellWidth:40}},
      theme:'grid', margin:{left:15,right:15}
    });

    const yAfter = (doc.lastAutoTable?.finalY || 32) + 3;
    doc.autoTable({
      head:[['TTD TEKNISI','TTD LEADER','TTD CALL CENTER']],
      body:[['','','']],
      startY:yAfter,
      styles:{ fontSize:7, halign:'center', valign:'middle', lineColor:[0,0,0], lineWidth:.2, textColor:[0,0,0]},
      headStyles:{ fontStyle:'bold', fontSize:7, textColor:[0,0,0], fillColor:false, minCellHeight:5},
      bodyStyles:{minCellHeight:24},
      columnStyles:{ 0:{cellWidth:60}, 1:{cellWidth:60}, 2:{cellWidth:60}},
      theme:'grid', margin:{left:15,right:15},
      didDrawCell: (data) => {
        if (data.section !== 'body') return;
        const { cell, column } = data;
        if (column.index === 0 && namaTeknisi) {
          const yText = cell.y + cell.height - 3.5;
          doc.setFontSize(8);
          doc.text(namaTeknisi, cell.x + cell.width / 2, yText, { align: 'center' });
        }
      }
    });
  }

  return new Blob([doc.output('arraybuffer')], { type:'application/pdf' });
}

/* Merge helper (pdf-lib) */
async function mergePdfBuffers(buffers){ // ArrayBuffer[]
  const { PDFDocument } = window.PDFLib;
  const target = await PDFDocument.create();
  for (const buf of buffers){
    const src = await PDFDocument.load(buf);
    const pages = await target.copyPages(src, src.getPageIndices());
    pages.forEach(p => target.addPage(p));
  }
  const bytes = await target.save();
  return new Blob([bytes], { type:'application/pdf' });
}
async function downloadBlob(blob, filename){
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

/* Gabungan (FST + PDF TERPILIH) – tidak mengubah fungsi lama */
async function generateCombinedSelected(){
  ensureLibsOrThrow({ requireJsPDF: true, requirePDFLib: true, requirePdfjs: false });
  const cmBlob = await buildFormCMBlob();
  const selected = getSelectedFromTable();
  const originals = await fetchPdfBuffersBySelection(selected);

  const { PDFDocument, StandardFonts, rgb } = window.PDFLib;
  const target = await PDFDocument.create();

  const cmDoc = await PDFDocument.load(await cmBlob.arrayBuffer());
  const cmPages = await target.copyPages(cmDoc, cmDoc.getPageIndices());
  cmPages.forEach(p => target.addPage(p));
  let offset = cmPages.length;

  const helv = await target.embedFont(StandardFonts.Helvetica);
  const namaDiselesaikan = (selNama?.value || '').trim();

  for (const {name, buffer, meta} of originals){
    const donor = await PDFDocument.load(buffer);
    const donorPages = await target.copyPages(donor, donor.getPageIndices());
    let anchors = [];
    try{ anchors = await findAnchorsDiselesaikan(buffer); } catch { anchors = []; }

    donorPages.forEach((pg,i)=>{
      target.addPage(pg);
      const page = target.getPage(offset + i);
      const sz = page.getSize();

      let x = sz.width * 0.493, y = sz.height * 0.207;
      if (meta && typeof meta.x==='number' && typeof meta.y==='number'){ x = meta.x + (meta.dx||0); y = meta.y + (meta.dy||0); }
      else if (anchors[i]){ x = anchors[i].x; y = anchors[i].y; }

      x += -55; y += 3; // bias kecil
      if (DEBUG_SHOW_MARKER) page.drawRectangle({ x:x-3, y:y-3, width:6, height:6, color: rgb(1,0.5,0) });
      
      // Jika file menandai skipStamp (contoh: PDF dari AppSheet), jangan stamp ulang
       if (meta && meta.skipStamp === true) {
         return; // lewati penulisan nama untuk halaman ini
       }
      
      if (namaDiselesaikan){
        const size = 8, w = helv.widthOfTextAtSize(namaDiselesaikan, size) || 0;
        page.drawText(namaDiselesaikan, { x: x - w/2, y: Math.max(30, Math.min(y, sz.height - 30)), size, font: helv, color: rgb(0,0,0) });
      }
    });
    offset += donorPages.length;
  }

  const bytes = await target.save();
  const outBlob = new Blob([bytes], {type:'application/pdf'});
  await downloadBlob(outBlob, 'Form Serah Terima + PDF CM.pdf');

  // Silent upload ke Drive
  try {
    if (typeof window.saveGeneratedPdfSilent === 'function') {
      await window.saveGeneratedPdfSilent(outBlob, 'Form Serah Terima + PDF CM');
    }
  } catch {}
}

/* FORM CM saja */
async function generateCMOnly(){
  const blob = await buildFormCMBlob();
  await downloadBlob(blob, 'Form Tanda Terima CM.pdf');

  // Silent upload ke Drive
  try {
    if (typeof window.saveGeneratedPdfSilent === 'function') {
      await window.saveGeneratedPdfSilent(blob, 'Form Tanda Terima CM');
    }
  } catch {}
}

/* PDF asli terpilih saja — SEKARANG ikut stamping nama di kolom TTD */
async function generateOriginalsOnly(selected){
  ensureLibsOrThrow({ requireJsPDF: false, requirePDFLib: true, requirePdfjs: false });
  const originals = await fetchPdfBuffersBySelection(selected);
  if (!originals.length){ alert('Tidak ada file terpilih / ditemukan.'); return; }

  const { PDFDocument, StandardFonts, rgb } = window.PDFLib;
  const target = await PDFDocument.create();
  const helv = await target.embedFont(StandardFonts.Helvetica);
  const namaDiselesaikan = (selNama?.value || '').trim();

  let offset = 0;
  for (const {name, buffer, meta} of originals){
    const donor = await PDFDocument.load(buffer);
    const donorPages = await target.copyPages(donor, donor.getPageIndices());

    // cari anchor on-the-fly (fallback kalau meta tidak ada)
    let anchors = [];
    try{ anchors = await findAnchorsDiselesaikan(buffer); } catch { anchors = []; }

    donorPages.forEach((pg,i)=>{
      target.addPage(pg);
      const page = target.getPage(offset + i);
      const sz = page.getSize();

      // posisi default
      let x = sz.width * 0.493;
      let y = sz.height * 0.207;

      // prioritas pakai meta upload; kalau tidak ada pakai anchor
      if (meta && typeof meta.x==='number' && typeof meta.y==='number'){
        x = meta.x + (meta.dx||0);
        y = meta.y + (meta.dy||0);
      } else if (anchors[i] && typeof anchors[i].x==='number' && typeof anchors[i].y==='number'){
        x = anchors[i].x; y = anchors[i].y;
      }

      // bias global (sesuai fungsi lain)
      x += -55;
      y += 3;
      
      // Jika file menandai skipStamp (contoh: PDF dari AppSheet), jangan stamp ulang
       if (meta && meta.skipStamp === true) {
         return; // lewati penulisan nama untuk halaman ini
       }

      // gambar nama kalau ada
      if (namaDiselesaikan){
        const size = 8;
        const w = helv.widthOfTextAtSize(namaDiselesaikan, size) || 0;
        page.drawText(namaDiselesaikan, {
          x: x - w/2,
          y: Math.max(30, Math.min(y, sz.height - 30)),
          size,
          font: helv,
          color: rgb(0,0,0)
        });
      }
    });

    offset += donorPages.length;
  }

  const bytes = await target.save();
  const outBlob = new Blob([bytes], { type:'application/pdf' });
  await downloadBlob(outBlob, 'Gabungan PDF CM.pdf');

  // Silent upload ke Drive
  try {
    if (typeof window.saveGeneratedPdfSilent === 'function') {
      await window.saveGeneratedPdfSilent(outBlob, 'Gabungan PDF CM');
    }
  } catch {}
}


/********************
 *   CLOUD MIRROR   *
 *   (Histori lintas device via Drive JSON dgn "rev")
 ********************/
(function(){
  const HISTORY_FILE = 'FST-History.json';
  const KEY_REV = (window.AccountNS?.nsKey ? window.AccountNS.nsKey('pdfHistoriRev') : 'pdfHistoriRev');

  const getLocalRev = () => Number(localStorage.getItem(KEY_REV) || 0);
  const setLocalRev = (rev) => localStorage.setItem(KEY_REV, String(rev || 0));

  function normalize(x){
    return {
      id: x.id || (x.contentHash || '') + '|' + (x.createdAt || 0) + '|' + (x.fileName || ''),
      createdAt: x.createdAt || Date.now(),
      lokasi: x.lokasi || '',
      text: x.text || '',
      fileName: x.fileName || null,
      fileHash: x.fileHash || x.contentHash || null,
      tanggalPekerjaan: x.tanggalPekerjaan || null,
      namaUker: x.namaUker || ''
    };
  }

  function mergeById(baseArr, addArr){
    const map = new Map(baseArr.map(r => [normalize(r).id, normalize(r)]));
    for (const r of addArr) {
      const n = normalize(r);
      const exist = map.get(n.id);
      if (!exist || (n.createdAt > (exist.createdAt||0))) map.set(n.id, n);
    }
    return Array.from(map.values()).sort((a,b)=> (b.createdAt||0)-(a.createdAt||0));
  }

  // Debounce push biar hemat request
  let pushTimer = null;
  async function pushCloudDebounced(){
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(async () => {
      try {
        if (!(await (window.DriveSync?.tryResume?.() || Promise.resolve(false))) && !window.DriveSync?.isLogged?.()) return;
        const local = getPdfHistori();
        const rev = getLocalRev() || Date.now();
        await window.DriveSync.putJson(HISTORY_FILE, { rev, data: local });
        setLocalRev(rev);
      } catch {}
    }, 800);
  }

  // Push IMMEDIATE (untuk reset)
  async function pushCloudNow(data){
    try{
      if (!(await (window.DriveSync?.tryResume?.() || Promise.resolve(false))) && !window.DriveSync?.isLogged?.()) return;
      const rev = Date.now();
      setLocalRev(rev);
      await window.DriveSync.putJson(HISTORY_FILE, { rev, data });
    }catch{}
  }

  function getUidOrAnon(){
  try {
    return (window.DriveSync?.getUser?.()?.uid)
        || (window.Auth?.user?.uid)
        || (window.Auth?.currentUser?.()?.uid)
        || 'anon';
  } catch { return 'anon'; }
}
function manifestName(){ return `.bribox_histori__${getUidOrAnon()}.json`; }


  window.FSTSync = {
    async pullCloudToLocal(){
  try{
    const ok = await (window.DriveSync?.tryResume?.() || Promise.resolve(false));
    if (!ok && !window.DriveSync?.isLogged?.()) return;

    // A) Coba manifest per-akun (Trackmate) via getJson
    let manifestArr = null;
    try {
      const obj = await window.DriveSync?.getJson?.(manifestName());
      const arr = obj?.data;
        if (Array.isArray(arr)) manifestArr = arr;
        } catch {}

    if (manifestArr) {
      // langsung pakai data manifest Trackmate
      setPdfHistori(manifestArr);
      renderTabel();
      return;
    }

    // B) Fallback: file lama FST-History.json (pakai rev)
    const cloudObj = await window.DriveSync.getJson('FST-History.json');
  if (!cloudObj) return;
  const cloud = cloudObj.data || {};
  const cloudRev = Number(cloud.rev || 0);
    const localRev = Number(localStorage.getItem(window.AccountStore?.nsKey
                        ? window.AccountStore.nsKey('pdfHistoriRev') : 'pdfHistoriRev') || 0);

    if (cloudRev && cloudRev >= localRev){
    const arr = Array.isArray(cloud.data) ? cloud.data : [];
      setPdfHistori(arr);
      if (window.AccountStore?.setRev) window.AccountStore.setRev(cloudRev);
      else localStorage.setItem('pdfHistoriRev', String(cloudRev));
      renderTabel();
    } else if (Array.isArray(cloud.data)) {
      // local lebih baru → heal cloud lama
      try {
        const data = getPdfHistori();
        const rev = Date.now();
        localStorage.setItem(KEY_REV, String(rev));
        await window.DriveSync.putJson('FST-History.json', { rev, data });
      } catch {}
    }
  }catch{}
},

    async queuePush(){ await pushCloudDebounced(); },
    async clearCloudNow(){ await pushCloudNow([]); }
  };
})();


/********************
 *   EVENTS + STATE *
 ********************/

function updateButtonsState() {
  const iso = inputTanggalSerah?.value || '';
  if (btnGenerate)   btnGenerate.disabled   = !iso;
  if (btnGenCombo)   btnGenCombo.disabled   = !iso;
  if (btnGenCMOnly)  btnGenCMOnly.disabled  = !iso;

  if (btnGenFilesOnly) {
    const anyChecked = !!document.querySelector('#historiBody input.pick:checked');
    btnGenFilesOnly.disabled = !iso || !anyChecked;
  }
}

inputTanggalSerah?.addEventListener('change', () => {
  const iso = inputTanggalSerah.value || '';
  document.querySelectorAll('.tgl-serah').forEach(td => {
    td.dataset.iso = iso;
    td.textContent = iso ? formatTanggalSerahForPdf(iso) : '';
  });
  updateButtonsState(); // <- cukup panggil helper
});

tbody?.addEventListener('change', (e) => {
  if (e.target.matches('input.pick')) {
    syncPickAllState();
    updateButtonsState(); // <- cukup panggil helper
  }
});

tbody?.addEventListener('click', async (e) => {
  const btn = e.target.closest('.btn-del');
  if (!btn) return;
  if (!confirm('Hapus entri ini dari histori?')) return;

  const isoNow = inputTanggalSerah?.value || '';
  if (isoNow) {
    document.querySelectorAll('.tgl-serah').forEach(td => {
      td.dataset.iso = isoNow;
      td.textContent = formatTanggalSerahForPdf(isoNow);
    });
  }

  const tr = btn.closest('tr');
  const nameFromRow = tr?.dataset?.name || '';
  const hashFromRow = tr?.dataset?.hash || '';

  const arr = getPdfHistori();
  const filtered = arr.filter(r => hashFromRow ? r.contentHash !== hashFromRow : r.fileName !== nameFromRow);
  setPdfHistori(filtered);

  const db = await openDb();

  // Hapus di store lama (pdfs)
  await new Promise((resolve) => {
    const tx = db.transaction(['pdfs'], 'readwrite');
    const store = tx.objectStore('pdfs');
    const cur = store.openCursor();
    cur.onsuccess = (ev) => {
      const cursor = ev.target.result;
      if (!cursor) return resolve();
      const v = cursor.value || {};
      const match = hashFromRow ? (v.contentHash === hashFromRow) : (v.name === nameFromRow);
      if (match) { cursor.delete(); return resolve(); }
      cursor.continue();
    };
    cur.onerror = () => resolve();
  });

  // Hapus di store baru (pdfBlobs) kalau ada hash
  await new Promise((resolve) => {
    if (!db.objectStoreNames.contains('pdfBlobs') || !hashFromRow) return resolve();
    const tx2 = db.transaction(['pdfBlobs'], 'readwrite');
    const st2 = tx2.objectStore('pdfBlobs');
    const del = st2.delete(hashFromRow);
    del.onsuccess = () => resolve();
    del.onerror = () => resolve();
  });

  renderTabel();
  updateButtonsState(); // jaga-jaga kalau renderTabel belum manggil helper

  // Push mirror ke cloud (debounced)
  try { await window.FSTSync?.queuePush?.(); } catch {}
});

pickAll?.addEventListener('change', () => {
  document.querySelectorAll('#historiBody input.pick').forEach(cb => cb.checked = pickAll.checked);
  syncPickAllState();
  updateButtonsState(); // master checkbox juga pengaruh tombol "PDF Terpilih"
});

// Auto-refresh saat tab kembali fokus (pull cloud + hydrate -> render)
document.addEventListener('visibilitychange', async () => {
  if (document.hidden) return;
  try { await window.FSTSync?.pullCloudToLocal?.(); } catch {}
  // renderTabel() dipanggil di dalam pullCloudToLocal override-mu;
  // panggil helper lagi agar tombol pasti sinkron.
  updateButtonsState();
});

// ========== TOMBOL LAMA: generate gabungan (semua) ==========
btnGenerate?.addEventListener('click', async ()=>{
  const tanggalInput = inputTanggalSerah.value;
  if(!tanggalInput){ alert('⚠️ Silakan isi tanggal serah terima terlebih dahulu.'); return; }
  try{ showSpinner(); await generatePdfSerahTerima(); }
  catch(err){ console.error(err); alert('Gagal generate PDF. Pastikan jsPDF, AutoTable, PDF-lib & PDF.js sudah dimuat.'); }
  finally{ hideSpinner(); }
});

// ========== TOMBOL BARU (jika ada di HTML) ==========
btnGenCombo?.addEventListener('click', async ()=>{
  const tanggalInput = inputTanggalSerah?.value || '';
  if(!tanggalInput){ alert('Isi Tanggal Serah Terima dulu.'); return; }
  try{ showSpinner(); await generateCombinedSelected(); }
  catch(err){ console.error(err); alert('Gagal membuat PDF gabungan.'); }
  finally{ hideSpinner(); }
});

btnGenCMOnly?.addEventListener('click', async ()=>{
  const tanggalInput = inputTanggalSerah?.value || '';
  if(!tanggalInput){ alert('Isi Tanggal Serah Terima dulu.'); return; }
  try{ showSpinner(); const b = await buildFormCMBlob(); await downloadBlob(b,'Form Tanda Terima CM.pdf');
       try{ if (typeof window.saveGeneratedPdfSilent === 'function') await window.saveGeneratedPdfSilent(b,'Form Tanda Terima CM'); }catch{} }
  catch(err){ console.error(err); alert('Gagal membuat FORM CM.'); }
  finally{ hideSpinner(); }
});

btnGenFilesOnly?.addEventListener('click', async ()=>{
  // ambil baris yang tercentang SAJA
  const selected = Array.from(document.querySelectorAll('#historiBody tr[data-name], #historiBody tr[data-hash]'))
    .filter(tr => tr.querySelector('input.pick')?.checked)
    .map(tr => ({ hash: tr.getAttribute('data-hash') || '', name: tr.getAttribute('data-name') || '' }));

  if (selected.length === 0) {
    alert('Pilih minimal satu file dulu (ceklist di kolom paling kiri).');
    return;
  }

  try{ showSpinner(); await generateOriginalsOnly(selected); }
  catch(err){ console.error(err); alert('Gagal menggabungkan PDF asli.'); }
  finally{ hideSpinner(); }
});

document.addEventListener('DOMContentLoaded', async ()=>{
  renderTabel();
  loadNama();
  updateButtonsState();
  // Pull histori dari cloud ke lokal (merge) saat halaman dibuka
  try { await window.FSTSync?.pullCloudToLocal?.(); } catch {}
});

// ===== Reset Histori (lokal + cloud) =====
btnReset?.addEventListener('click', async () => {
  if (!confirm('Yakin reset semua histori (pdfHistori + IndexedDB)?')) return;

  // 1) kosongkan histori lokal (pakai helper supaya respect namespace)
  setPdfHistori([]);

  // 2) bersihkan DB lokal
  try { await clearIndexedDB(); } catch {}

  // 3) bersihkan pilihan nama TTD
  try { localStorage.removeItem(KEY_NAMA || 'serah_ttd_nama'); } catch {}
  if (selNama) { selNama.selectedIndex = 0; selNama.value = ''; }

  // 4) bersihkan katalog per-akun (mapping sha256 -> fileId)
  try {
    const uid = (window.Auth?.getUid?.() || 'anon');
    localStorage.removeItem(`PdfCatalog__${uid}`);
  } catch {}

  // 5) push kosong ke cloud (dua jalur: manifest per-akun & FST-History.json)
try {
  const ok = await (window.DriveSync?.tryResume?.() || Promise.resolve(false));
  if (ok || window.DriveSync?.isLogged?.()) {
    const uid = (window.DriveSync?.getUser?.()?.uid) ||
                (window.Auth?.user?.uid) ||
                (window.Auth?.currentUser?.()?.uid) || 'anon';
    const manifest = `.bribox_histori__${uid}.json`;
    const revNow = Date.now();

    await window.DriveSync?.putJson?.(manifest, []); 
    await window.DriveSync?.putJson?.('FST-History.json', { rev: revNow, data: [] });

    // sinkronkan rev lokal
    const KEY_REV = (window.AccountNS?.nsKey ? window.AccountNS.nsKey('pdfHistoriRev') : 'pdfHistoriRev');
    localStorage.setItem(KEY_REV, String(revNow));
  }
} catch (e) { console.warn('push reset cloud gagal:', e); }


  // 6) render ulang & tutup banner hydrator
  renderTabel();
  try { document.getElementById('hydrateBanner')?.remove(); } catch {}
});

/* ===========================
 *  AUTO-HYDRATE FROM DRIVE + PROGRESS UI
 * =========================== */
(function(){
  const STORE_BLOBS = 'pdfBlobs';

  // --- UI kecil di atas tabel ---
  function ensureHydrateBanner(){
    let el = document.getElementById('hydrateBanner');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'hydrateBanner';
    el.setAttribute('role','status');
    el.setAttribute('aria-live','polite');
    el.innerHTML = `
      <div class="hb-wrap">
        <div class="hb-spinner" aria-hidden="true"></div>
        <div class="hb-text">
          <b>Menyelaraskan file dari Drive…</b>
          <div class="hb-sub"><span id="hbCount">0</span>/<span id="hbTotal">0</span> file</div>
        </div>
        <div class="hb-bar"><div id="hbBar" class="hb-bar-fill" style="width:0%"></div></div>
        <button id="hbClose" type="button" title="Sembunyikan" aria-label="Sembunyikan">✕</button>
      </div>
    `;
    document.querySelector('.main')?.prepend(el);
    document.getElementById('hbClose')?.addEventListener('click', ()=> el.remove());
    return el;
  }
  function updateHydrateBanner(done, total){
    const el = ensureHydrateBanner();
    el.style.display = 'block';
    el.classList.remove('hb-done');
    const nDone = Math.max(0, Math.min(done, total||0));
    el.querySelector('#hbCount').textContent = String(nDone);
    el.querySelector('#hbTotal').textContent = String(total||0);
    const pct = total ? Math.round((nDone/total)*100) : 0;
    el.querySelector('#hbBar').style.width = pct + '%';
    el.querySelector('.hb-sub').textContent = `${nDone}/${total} file`;
  }
  function finishHydrateBanner(){
    const el = document.getElementById('hydrateBanner');
    if (!el) return;
    el.classList.add('hb-done');
    el.querySelector('.hb-text b').textContent = 'Sinkronisasi selesai';
    setTimeout(()=>{ el.remove(); }, 1200);
  }

  // CSS ringan untuk banner
  (function injectHbCss(){
    if (document.getElementById('hydrateBannerCSS')) return;
    const s = document.createElement('style');
    s.id = 'hydrateBannerCSS';
    s.textContent = `
      #hydrateBanner{margin-bottom:12px}
      #hydrateBanner .hb-wrap{
        display:flex; gap:10px; align-items:center;
        border:1px solid var(--border,#dcdcdc); background:var(--bg,#fff);
        padding:10px; border-radius:12px; box-shadow:0 2px 8px rgba(0,0,0,.05)
      }
      .dark-mode #hydrateBanner .hb-wrap{ background:#1e1f22; border-color:#2e2f34; }
      #hydrateBanner .hb-spinner{
        width:18px;height:18px;border:3px solid #ccc;border-top-color:#1976d2;border-radius:50%;
        animation:hbspin 1s linear infinite; flex:0 0 auto;
      }
      #hydrateBanner.hb-done .hb-spinner{ border-top-color:#4caf50; animation:none; }
      @keyframes hbspin{to{transform:rotate(360deg)}}
      #hydrateBanner .hb-text{flex:1 1 auto; min-width:120px}
      #hydrateBanner .hb-text b{display:block; font-size:14px; line-height:1.2}
      #hydrateBanner .hb-sub{font-size:12px; opacity:.8}
      #hydrateBanner .hb-bar{
        flex:1 1 200px; height:6px; background:rgba(0,0,0,.08); border-radius:999px; overflow:hidden;
      }
      .dark-mode #hydrateBanner .hb-bar{ background:rgba(255,255,255,.12); }
      #hydrateBanner .hb-bar-fill{
        height:100%; width:0%; background:#1976d2; transition:width .25s ease;
      }
      #hydrateBanner.hb-done .hb-bar-fill{ background:#4caf50; width:100% }
      #hydrateBanner #hbClose{
        border:none; background:transparent; cursor:pointer; font-size:14px; opacity:.7;
      }
      #hydrateBanner #hbClose:hover{ opacity:1 }
    `;
    document.head.appendChild(s);
  })();

  async function getToken(){
    try {
      if (typeof DriveSync?.getAccessToken === 'function') return await DriveSync.getAccessToken();
      if (DriveSync?.token?.access_token) return DriveSync.token.access_token;
    } catch {}
    return null;
  }
  async function ensureDriveReady(){
    try { await (DriveSync?.tryResume?.() || Promise.resolve(false)); } catch {}
    return (DriveSync?.isLogged?.() || false);
  }
  async function saveBlobToIndexedDB(hash, name, blob, meta=null){
    const db = await openDb();
    return new Promise((resolve) => {
      if (!db.objectStoreNames.contains(STORE_BLOBS)) {
        // kalau store belum ada (mustinya sudah ada dari onupgradeneeded)
        try { const tx0 = db.transaction([], 'readonly'); tx0.oncomplete = ()=>{}; } catch {}
      }
      const tx = db.transaction([STORE_BLOBS], 'readwrite');
      const store = tx.objectStore(STORE_BLOBS);
      const rec = { contentHash: hash || null, name: name || '(tanpa-nama)', blob, type: 'application/pdf', size: blob.size, meta, savedAt: Date.now() };
      store.put(rec);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    });
  }
  async function haveBlobMap(){
    const all = await getAllPdfBuffersFromIndexedDB([]);
    const m = { byHash:new Set(), byName:new Set() };
    for (const it of all){
      if (it.contentHash) m.byHash.add(it.contentHash);
      if (it.name) m.byName.add(it.name);
    }
    return m;
  }
  function esc(str=''){ return String(str).replace(/(['\\])/g,'\\$1'); }
  async function driveSearch(q){
    const ok = await ensureDriveReady();
    if (!ok) return [];
    const token = await getToken(); if (!token) return [];
    const url = new URL('https://www.googleapis.com/drive/v3/files');
    url.searchParams.set('q', q);
    url.searchParams.set('fields', 'files(id,name,mimeType,modifiedTime,size,appProperties)');
    url.searchParams.set('spaces','drive');
    url.searchParams.set('pageSize','10');
    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return [];
    const json = await res.json().catch(()=>({files:[]}));
    return json.files || [];
  }
  async function driveFindByHash(hash){
  if (!hash) return [];
  // cari berdasarkan NAMA FILE hash.pdf  (idempoten kita)
  const q = `mimeType='application/pdf' and trashed=false and name='${esc(hash)}.pdf'`;
  return await driveSearch(q);
}

async function driveFindByName(name) {
  if (!name) return [];
  // fallback cari berdasarkan nama asli file
  const q = `mimeType='application/pdf' and trashed=false and name='${esc(name)}'`;
  return await driveSearch(q);
}

  async function driveDownloadBlob(fileId){
    const token = await getToken(); if (!token) return null;
    const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    return new Blob([buf], { type:'application/pdf' });
  }

  // --- Fallback downloader: pakai DriveSync.fetchPdfBlob kalau ada; kalau tidak, jatuh ke fetch alt=media
async function downloadViaDriveSyncOrFetch(fileId){
  try {
    if (typeof window.DriveSync?.fetchPdfBlob === 'function') {
      const b = await window.DriveSync.fetchPdfBlob(fileId);
      if (b) return b;
    }
  } catch {}
  return await driveDownloadBlob(fileId);
}

  async function hydrateMissingBlobsFromDrive(){
  const list = getPdfHistori();
  // coba pakai katalog per-akun dulu → langsung tau fileId
let catMap = {};
try {
  const uid = (window.Auth?.getUid?.() || 'anon');
  catMap = JSON.parse(localStorage.getItem(`PdfCatalog__${uid}`) || '{}'); // { sha256: {fileId,...} }
} catch {}

  if (!Array.isArray(list) || !list.length) return;

  // ⛔ kalau Drive belum siap, jangan tampilkan progres yang menyesatkan
  try {
    const ok = await (window.DriveSync?.tryResume?.() || Promise.resolve(false));
    if (!ok && !window.DriveSync?.isLogged?.()) {
      // tidak login → jangan tampilkan banner progres
      const banner = document.getElementById('hydrateBanner');
      if (banner) banner.remove();
      return;
    }
  } catch {}

  const have = await haveBlobMap();
  const targets = [];
  for (const it of list){
    const hash = it.contentHash || it.fileHash || null;
    const name = it.fileName || null;
    if (hash ? have.byHash.has(hash) : (name && have.byName.has(name))) continue;
    targets.push({ hash, name });
  }
  if (!targets.length) return;

  updateHydrateBanner(0, targets.length);

  const CONCURRENCY = 3;
  let idx = 0, done = 0;

  async function withTimeout(p, ms){
    return await Promise.race([ p, new Promise(res => setTimeout(()=>res(null), ms||15000)) ]);
  }

  async function worker(){
  while (idx < targets.length){
    const my = targets[idx++];

    try{
      // 1) Katalog per-akun (paling cepat)
      if (my.hash && catMap[my.hash]?.fileId) {
        const blob = await withTimeout(downloadViaDriveSyncOrFetch(catMap[my.hash].fileId), 15000);
        if (blob){
          await saveBlobToIndexedDB(my.hash, `${my.hash}.pdf`, blob, null);
          have.byHash.add(my.hash);
          if (my.name) have.byName.add(my.name);
          continue;
        }
      }

      // 2) Idempoten API (hash -> fileId) kalau tersedia
      let fileId = null;
      if (my.hash && typeof window.DriveSync?.getFileIdByHash === 'function') {
        fileId = await withTimeout(window.DriveSync.getFileIdByHash(my.hash), 8000);
      }

      // 3) Fallback query langsung (hash.pdf) jika belum ketemu
      if (!fileId && my.hash) {
        const hits = await withTimeout(driveFindByHash(my.hash), 8000);
        if (hits && hits[0]?.id) fileId = hits[0].id;
      }

      // 4) Fallback terakhir: cari berdasarkan nama asli (kalau ada)
      if (!fileId && my.name) {
        const hits = await withTimeout(driveFindByName(my.name), 8000);
        if (hits && hits[0]?.id) fileId = hits[0].id;
      }

      if (fileId) {
        const blob = await withTimeout(downloadViaDriveSyncOrFetch(fileId), 15000);
        if (blob){
          await saveBlobToIndexedDB(my.hash || null, my.hash ? `${my.hash}.pdf` : (my.name || '(tanpa-nama)'), blob, null);
          if (my.hash) have.byHash.add(my.hash);
          if (my.name) have.byName.add(my.name);
        }
      }
    } catch {
      // noop
    } finally {
      done += 1;
      updateHydrateBanner(done, targets.length);
    }
  }
}


  // ⚠️ FIX: panggil worker(), bukan pass referensi fungsi
  const workers = Array.from(
    { length: Math.min(CONCURRENCY, targets.length) },
    () => worker()
  );
  await Promise.all(workers);
  finishHydrateBanner();
}


  // Hook: setelah render/pull cloud, coba hydrate diam-diam + progres
  document.addEventListener('DOMContentLoaded', async ()=>{
    try { await hydrateMissingBlobsFromDrive(); } catch {}
  });

  const _pull = window.FSTSync?.pullCloudToLocal;
  if (typeof _pull === 'function') {
    window.FSTSync.pullCloudToLocal = async function(){
      const r = await _pull.apply(this, arguments);
      try { await hydrateMissingBlobsFromDrive(); } catch {}
      return r;
    };
  }
})();

/********************
 *   DEBUG HELPER   *
 ********************/
async function debugListPDF(){
  const db = await openDb();
  const tx = db.transaction(['pdfs'],'readonly');
  const store = tx.objectStore('pdfs');
  const req = store.getAll();
  req.onsuccess = ()=>{ console.log('📂 File di IndexedDB:', req.result.map(x=>({
    name:x.name, hash:x.contentHash, meta:x.meta
  }))); };
}
window.debugListPDF = debugListPDF;
