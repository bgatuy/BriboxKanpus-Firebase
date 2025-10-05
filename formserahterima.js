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
function getPdfHistori(){ const arr=JSON.parse(localStorage.getItem('pdfHistori')||'[]'); return Array.isArray(arr)?arr:[];}
function setPdfHistori(arr){ localStorage.setItem('pdfHistori', JSON.stringify(arr)); }
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

function renderTabel(){
  if(!tbody) return;
  let data = getPdfHistori();
  if(!data.length){
    // kalau kamu menambah kolom "Pilih", ubah colspan ke 7 (di HTML header)
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;">Belum ada data histori. Unggah PDF di Trackmate atau AppSheet.</td></tr>`;
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
      <td><button class="danger btn-del" data-i="${idx}">Hapus</button></td>
    </tr>`;
  }).join('');

  // sinkron master checkbox setelah render
  syncPickAllState();
}

/********************
 *   INDEXEDDB      *
 ********************/
function openDb(){
  return new Promise((res, rej) => {
    const req = indexedDB.open('PdfStorage'); // <— tanpa versi
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('pdfs')) {
        db.createObjectStore('pdfs', { keyPath:'id', autoIncrement:true });
      }
      // siapkan juga store baru bila suatu saat bump versi
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
    const request=indexedDB.deleteDatabase("PdfStorage");
    request.onsuccess=()=>resolve(true);
    request.onerror =()=>reject("Gagal hapus database IndexedDB");
    request.onblocked=()=>reject("Hapus database diblokir oleh tab lain");
  });
}
async function getAllPdfBuffersFromIndexedDB(preferredOrderNames = []) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('PdfStorage'); // <— tanpa versi
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
              const blob = entry?.data; // di pdfs: data=Blob; di pdfBlobs: data=Blob
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

// Sinkron master checkbox
function syncPickAllState(){
  if (!pickAll) return;
  const cbs = Array.from(document.querySelectorAll('#historiBody input.pick'));
  if (!cbs.length){ pickAll.checked=false; pickAll.indeterminate=false; return; }
  const allChecked = cbs.every(cb => cb.checked);
  const anyChecked = cbs.some(cb => cb.checked);
  pickAll.checked = allChecked;
  pickAll.indeterminate = anyChecked && !allChecked;
}
pickAll?.addEventListener('change', ()=> {
  document.querySelectorAll('#historiBody input.pick').forEach(cb => cb.checked = pickAll.checked);
});

// jsPDF: bangun FORM CM saja
async function buildFormCMBlob(){
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF('p','mm','a4');
    if (typeof doc.autoTable !== 'function') {
    throw new Error('jspdf-autotable belum dimuat.');}

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

      if (namaDiselesaikan){
        const size = 8, w = helv.widthOfTextAtSize(namaDiselesaikan, size) || 0;
        page.drawText(namaDiselesaikan, { x: x - w/2, y: Math.max(30, Math.min(y, sz.height - 30)), size, font: helv, color: rgb(0,0,0) });
      }
    });
    offset += donorPages.length;
  }

  const bytes = await target.save();
  await downloadBlob(new Blob([bytes], {type:'application/pdf'}), 'Form Serah Terima + PDF CM.pdf');
}

/* FORM CM saja */
async function generateCMOnly(){
  const blob = await buildFormCMBlob();
  await downloadBlob(blob, 'Form Tanda Terima CM.pdf');
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
  await downloadBlob(new Blob([bytes], { type:'application/pdf' }), 'Gabungan PDF CM.pdf');
}


/********************
 *   EVENTS         *
 ********************/
inputTanggalSerah?.addEventListener('change', ()=>{
  const iso = inputTanggalSerah.value || '';
  document.querySelectorAll('.tgl-serah').forEach(td=>{
    td.dataset.iso = iso;
    td.textContent = iso ? formatTanggalSerahForPdf(iso) : '';
  });
  if (btnGenerate) btnGenerate.disabled = !iso;              // tombol lama
  if (btnGenCombo) btnGenCombo.disabled = !iso;              // gabungan baru
  if (btnGenCMOnly) btnGenCMOnly.disabled = !iso;            // CM only baru
});

tbody?.addEventListener('change', (e)=>{
  if (e.target.matches('input.pick')) syncPickAllState();
});

tbody?.addEventListener('click', async (e) => {
  const btn = e.target.closest('.btn-del'); 
  if (!btn) return;
  if (!confirm('Hapus entri ini dari histori?')) return;

  const isoNow = inputTanggalSerah?.value || '';
  if (isoNow) document.querySelectorAll('.tgl-serah').forEach(td=>{
    td.dataset.iso = isoNow; td.textContent = formatTanggalSerahForPdf(isoNow);
  });

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
});


btnReset?.addEventListener('click', async ()=>{
  if(!confirm('Yakin reset semua histori (pdfHistori + IndexedDB)?')) return;
  localStorage.removeItem('pdfHistori');
  try{ await clearIndexedDB(); } catch{}
  if (selNama) { selNama.selectedIndex = 0; selNama.value = ''; }
  localStorage.removeItem(KEY_NAMA);
  renderTabel();
});

window.addEventListener('storage', (e)=>{ if(e.key==='pdfHistori') renderTabel(); });

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
  try{ showSpinner(); await generateCMOnly(); }
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
  return;}

  try{ showSpinner(); await generateOriginalsOnly(selected); }
  catch(err){ console.error(err); alert('Gagal menggabungkan PDF asli.'); }
  finally{ hideSpinner(); }
});

document.addEventListener('DOMContentLoaded', ()=>{ renderTabel(); loadNama(); });

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
