// monthly-data.js — INDIVIDUAL BUILD (XLSX only, per-device Active Technician, fixed signatures)
(function () {
  const STORAGE_KEY = "monthlyReports";
  const ACTIVE_TECH_KEY = "activeTechnician";

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
    const clickInsideSidebar = sidebar?.contains(e.target);
    const clickOnToggle = e.target.closest?.('.sidebar-toggle-btn');
    if (sidebar?.classList.contains('visible') && !clickInsideSidebar && !clickOnToggle) closeSidebar();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sidebar?.classList.contains('visible')) closeSidebar(); });
  sidebarLinks.forEach(a => a.addEventListener('click', closeSidebar));

  document.addEventListener('DOMContentLoaded', function () {
    const title = document.querySelector('.dashboard-header h1')?.textContent?.toLowerCase() || "";
    const body = document.body;
    if (title.includes('trackmate'))      body.setAttribute('data-page', 'trackmate');
    else if (title.includes('appsheet'))  body.setAttribute('data-page', 'appsheet');
    else if (title.includes('serah'))     body.setAttribute('data-page', 'serah');
    else if (title.includes('merge'))     body.setAttribute('data-page', 'merge');
  });

  // ===== utils
  const $ = (id) => document.getElementById(id);
  const pad = (n) => String(n).padStart(2, "0");
  const norm = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/\s+/g, " ").trim();

  function getActiveTechnician(){ try{ return localStorage.getItem(ACTIVE_TECH_KEY) || ""; }catch{ return ""; } }
  function loadReports() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; } catch { return []; } }
  function saveReports(arr) { localStorage.setItem(STORAGE_KEY, JSON.stringify(arr)); }
  function showToast(msg) { const t = $("toast"); if(!t) return; t.textContent = msg; t.classList.add("show"); setTimeout(()=>t.classList.remove("show"), 1600); }

  // ===== pick month (URL -> latest in storage -> now)
  function pickActiveMonth() {
    const fromUrl = new URL(location.href).searchParams.get("month");
    if (fromUrl) return fromUrl;
    const all = loadReports();
    if (all.length) {
      const months = [...new Set(all.map(r=>r.month).filter(Boolean))];
      months.sort((a,b)=>b.localeCompare(a)); // desc YYYY-MM
      if (months[0]) return months[0];
    }
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}`;
  }
  const month = pickActiveMonth();

  // ===== elem refs
  const qInput = $("q");
  const tbody = $("tbody");
  const empty = $("empty");
  const badgeMonth = $("badgeMonth");
  const btnExportXlsx = $("btnExportXlsx");
  const btnReset = $("btnReset");

  // badge bulan
  (function setBadge(){
    const [yy,mm] = String(month).split("-").map(Number);
    let label = month || "—";
    if (!isNaN(yy) && !isNaN(mm)) label = new Date(yy,(mm||1)-1,1).toLocaleDateString("id-ID",{month:"long",year:"numeric"});
    if (badgeMonth) badgeMonth.textContent = label;
  })();

  // ===== filtering + render
  function applyFilters(){
    const q = norm(qInput?.value || "");
    const activeTech = getActiveTechnician();
    let rows = loadReports().filter(r=>r.month===month);

    // Lock per individu: hanya milik teknisi aktif
    if (activeTech) rows = rows.filter(r => (r.teknisi||"") === activeTech);

    // pencarian tambahan
    if(q){
      rows = rows.filter(r=>{
        const hay = [r.tanggalLabel,r.date,r.teknisi,r.lokasiDari,r.lokasiKe,r.jenis,r.detail,r.status,r.keterangan,r.jamMasuk,r.jamBerangkat,r.jamTiba,r.jamMulai,r.jamSelesai,r.durasiPenyelesaianStr,r.waktuTempuhStr].map(norm).join(" ");
        return hay.includes(q);
      });
    }
    // urut input ASC (tanggal, lalu createdAt)
    rows.sort((a,b)=>{ const ad=a.date||"", bd=b.date||""; if(ad!==bd) return ad.localeCompare(bd); return (a.createdAt||"").localeCompare(b.createdAt||""); });

    renderTable(rows);
    if (empty) empty.style.display = rows.length ? "none" : "block";
    if (typeof tblCap !== 'undefined' && tblCap) tblCap.textContent = `${rows.length} entri ditampilkan`;
  }

  const esc = (s)=> String(s).replace(/[&<>"']/g,(m)=>({"&":"&amp;","<":"&lt;","&gt;":"&gt;","\"":"&quot;","'":"&#39;"}[m]));

  // dekat fungsi esc, sebelum renderTable
  function fmtJam(v){
    if (v == null || v === "") return "";
    const m = String(v).match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return String(v);            // bukan "HH:MM", balikin apa adanya
    return `${parseInt(m[1], 10)}:${m[2]}`;  // 07:05 -> 7:05, 0:05 -> 0:05
  }

  function renderTable(rows){
    if(!tbody) return;
    tbody.innerHTML = rows.map(r=>`
      <tr data-id="${r.id}">
        <td>${esc(r.tanggalLabel||r.date)}</td>
        <td class="col-teknisi">${esc(r.teknisi||"-")}</td>
        <td>${esc(r.lokasiDari||"-")}</td>
        <td>${esc(r.lokasiKe||"-")}</td>
        <td>${esc(r.jenis||"-")}</td>
        <td>${esc(r.detail||"-")}</td>
        <td>${esc(r.status||"-")}</td>
        <td>${esc(fmtJam(r.jamMasuk))}</td>
        <td>${esc(fmtJam(r.jamBerangkat))}</td>
        <td>${esc(fmtJam(r.jamTiba))}</td>
        <td>${esc(fmtJam(r.jamMulai))}</td>
        <td>${esc(fmtJam(r.jamSelesai))}</td>
        <td>${esc(r.durasiPenyelesaianStr||"0:00")}</td>
        <td class="num">${r.jarakKm||0}</td>
        <td>${esc(r.waktuTempuhStr||"0:00")}</td>
        <td>${esc(r.keterangan||"")}</td>
        <td><button class="btn-del" data-id="${r.id}">Hapus</button></td>
      </tr>`).join("");

    // klik tombol hapus
    tbody.querySelectorAll(".btn-del").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const id = btn.getAttribute("data-id");
        if(!id) return;
        if(!confirm("Hapus entri ini?")) return;
        const kept = loadReports().filter(x=>x.id!==id);
        saveReports(kept);
        showToast("Entri dihapus.");
        applyFilters();
      });
    });

    // opsional: tetap dukung dbl-click baris
    tbody.querySelectorAll("tr").forEach(tr=>{
      tr.addEventListener("dblclick", () => {
        const id = tr.getAttribute("data-id");
        if (!id) return;
        if (!confirm("Hapus entri ini?")) return;
        const kept = loadReports().filter(x=>x.id!==id);
        saveReports(kept);
        showToast("Entri dihapus.");
        applyFilters();
      });
    });
  }

  /* =======================
     ExcelJS AUTO-FIT HELPER
     ======================= */
  function autoFitColumns(ws, { min=8, max=48, padding=2, wrapCols=[5,6,16] } = {}) {
    const colCount = ws.columnCount || ws.actualColumnCount || 16;

    const readText = (cell) => {
      const v = cell?.value;
      if (v == null) return '';
      if (typeof v === 'string') return v;
      if (typeof v === 'number') return String(v);
      if (v && typeof v === 'object') {
        if (v.text) return String(v.text);
        if (Array.isArray(v.richText)) return v.richText.map(r => r.text || '').join('');
        if (v.result != null) return String(v.result);
        if (v.formula) return String(v.formula);
        if (v.date) return String(v.date);
      }
      return String(v);
    };

    for (let c = 1; c <= colCount; c++) {
      let maxLen = 0;

      [3,4].forEach(rn => {
        const t = readText(ws.getRow(rn).getCell(c)) || '';
        maxLen = Math.max(maxLen, ...t.split('\n').map(s => s.length));
      });

      ws.eachRow({ includeEmpty: false }, (row) => {
        if (row.number < 5) return;
        const t = readText(row.getCell(c)) || '';
        maxLen = Math.max(maxLen, ...t.split('\n').map(s => s.length));
      });

      const width = Math.min(Math.max(Math.ceil(maxLen + padding), min), max);
      ws.getColumn(c).width = width;
    }
  }

  /* ============== NEW: Helpers “full calendar month” untuk EXPORT ============== */
  const HARI_ID = ["Minggu","Senin","Selasa","Rabu","Kamis","Jumat","Sabtu"];
  const BULAN_ID = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
  const daysInMonth = (y, m) => new Date(y, m, 0).getDate(); // m=1..12
  const pad2 = (n)=> String(n).padStart(2,'0');
  const keyDate = (y,m,d)=> `${y}-${pad2(m)}-${pad2(d)}`;
  function tanggalLabel(y,m,d){ const dt=new Date(y,m-1,d); return `${HARI_ID[dt.getDay()]}, ${pad2(d)} ${BULAN_ID[m-1]} ${y}`; }
  const hmToExcelTime = (hm)=> {
    if(!hm) return null;
    const m = String(hm).match(/^(\d{1,2}):(\d{2})$/);
    if(!m) return null;
    return (+m[1]*60 + +m[2]) / (24*60);
  };

  function groupReportsByDate(reports){
    const map = new Map();
    for(const r of reports){
      let k = r.date;
      if(!k && r.tanggalLabel){
        // fallback kasar: "Senin, 02 September 2025"
        const parts = String(r.tanggalLabel).split(' ');
        const d = parseInt(parts[1],10);
        const y = parseInt(parts[3],10);
        const m = BULAN_ID.indexOf(parts[2])+1;
        if(y && m>0 && d) k = keyDate(y,m,d);
      }
      if(!k) continue;
      if(!map.has(k)) map.set(k, []);
      map.get(k).push(r);
    }
    return map;
  }

  /**
   * Build rows 1 bulan penuh:
   * - Selalu ada minimal 1 baris per tanggal
   * - Jika ada multi-entry di hari yg sama: tanggal hanya di baris pertama, sisanya kosong (rapi)
   */
  function buildMonthRows(year, month, reports){
  // Ambil hanya data bulan yang dimaksud
  const onlyThisMonth = reports.filter(r=>{
    if(!r?.date) return false;
    const [y, m] = String(r.date).split('-').map(Number);
    return y === year && m === month;
  });

  const perDate   = groupReportsByDate(onlyThisMonth);
  const totalDays = daysInMonth(year, month); // m = 1..12
  const rows = [];

  for (let d = 1; d <= totalDays; d++) {
    const k    = keyDate(year, month, d);
    const list = perDate.get(k) || [];

    if (list.length === 0) {
      // BARIS KOSONG — default manual
      rows.push({
        tanggal: tanggalLabel(year, month, d),
        teknisi: "", lokasiDari: "", lokasiKe: "", jenis: "", detail: "", status: "",
        jamMasuk: "23:55",
        jamBerangkat: "",
        jamTiba: "",
        jamMulai: "",
        jamSelesai: "",
        waktuPenyelesaian: 0,   // 0 -> tampil 0:00 (numFmt [h]:mm)
        jarak: null,            // null -> sel nampak kosong
        waktuTempuh: 0,         // 0 -> tampil 0:00
        keterangan: ""
      });
      continue;
    }

    // Ada data di tanggal tsb
    list.forEach((r, idx)=>{
      rows.push({
        tanggal: idx === 0 ? tanggalLabel(year, month, d) : "", // tanggal cuma di baris pertama
        teknisi: r.teknisi || "",
        lokasiDari: r.lokasiDari || "",
        lokasiKe: r.lokasiKe || "",
        jenis: r.jenis || "",
        detail: r.detail || "",
        status: r.status || "",
        jamMasuk: r.jamMasuk || "",
        jamBerangkat: r.jamBerangkat || "",
        jamTiba: r.jamTiba || "",
        jamMulai: r.jamMulai || "",
        jamSelesai: r.jamSelesai || "",
        waktuPenyelesaian: hmToExcelTime(r.durasiPenyelesaianStr || r.waktuPenyelesaian || ""),
        jarak: (r.jarakKm === "" || r.jarakKm == null) ? null : Number(r.jarakKm || 0),
        waktuTempuh: hmToExcelTime(r.waktuTempuhStr || r.waktuTempuh || ""),
        keterangan: r.keterangan || ""
      });
    });
  }
  return rows;
}

  // ===== Export XLSX (FULL CALENDAR)
  const minutesToExcelTime = (mins)=> (mins||0)/(24*60);

  async function exportXLSX(){
    try{
      const rowsAll = loadReports().filter(r=>r.month===month);
      if(!rowsAll.length){ showToast('Data kosong untuk bulan ini.'); return; }
      if(!window.ExcelJS) { showToast('ExcelJS belum termuat.'); return; }

      // Ambil nama teknisi dari data bulan ini (tetap per-individu)
      const uniqTek = [...new Set(rowsAll.map(r => (r.teknisi||"").trim()).filter(Boolean))];
      if (uniqTek.length === 0) { showToast('Nama teknisi tidak ditemukan di data.'); return; }
      if (uniqTek.length > 1)   { showToast('Ditemukan >1 nama teknisi. Rapikan/filter dulu sebelum export.'); return; }
      const teknisiPembuat = uniqTek[0];

      const [yyStr, mmStr] = String(month||"").split("-");
      const yy=Number(yyStr||new Date().getFullYear());
      const mm=Number(mmStr||new Date().getMonth()+1);
      const monthName=new Date(yy,mm-1,1).toLocaleDateString('id-ID',{month:'long'});
      const title=`ABSENSI TEKNISI BULAN ${monthName.toUpperCase()} ${yy}`;
      const fileName=`SPJ ${monthName} ${yy} - ${teknisiPembuat}.xlsx`;

      // ==== BUILD DATA SEBULAN PENUH ====
      const dataRows = buildMonthRows(yy, mm, rowsAll);

      const wb=new ExcelJS.Workbook();
      const ws=wb.addWorksheet('Format SPJ');
      ws.properties.defaultRowHeight = 18;

      // Title
      ws.mergeCells('A1:P1');
      const cTitle=ws.getCell('A1'); cTitle.value=title; cTitle.alignment={horizontal:'center',vertical:'middle'}; cTitle.font={bold:true,size:18};

      // Header 2 baris
      ws.mergeCells('A3','A4'); ws.getCell('A3').value='Tanggal';
      ws.mergeCells('B3','B4'); ws.getCell('B3').value='Teknisi';
      ws.mergeCells('C3','D3'); ws.getCell('C3').value='Lokasi'; ws.getCell('C4').value='Dari'; ws.getCell('D4').value='Ke';
      ws.mergeCells('E3','E4'); ws.getCell('E3').value='Jenis Pekerjaan';
      ws.mergeCells('F3','F4'); ws.getCell('F3').value='Detail Pekerjaan';
      ws.mergeCells('G3','G4'); ws.getCell('G3').value='Status Pekerjaan';
      ws.mergeCells('H3','L3'); ws.getCell('H3').value='Waktu';
      ws.getCell('H4').value='Jam Masuk Laporan'; ws.getCell('I4').value='Jam Berangkat'; ws.getCell('J4').value='Jam Tiba'; ws.getCell('K4').value='Jam Mulai Pekerjaan'; ws.getCell('L4').value='Jam Selesai';
      ws.mergeCells('M3','M4'); ws.getCell('M3').value='Waktu Penyelesaian';
      ws.mergeCells('N3','N4'); ws.getCell('N3').value='Jarak Tempuh';
      ws.mergeCells('O3','O4'); ws.getCell('O3').value='Waktu Tempuh';
      ws.mergeCells('P3','P4'); ws.getCell('P3').value='Keterangan';

      // Header style
      for (const r of [3,4]){
        const row=ws.getRow(r);
        for(let c=1;c<=16;c++){
          const cell=row.getCell(c);
          cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFC5D9F1'}};
          cell.font={bold:true};
          cell.alignment={vertical:'middle',horizontal:'center',wrapText:[5,6,16].includes(c)};
          cell.border={top:{style:'thin'},left:{style:'thin'},bottom:{style:'thin'},right:{style:'thin'}};
        }
        row.commit&&row.commit();
      }

      // ===== Data rows (FULL CALENDAR) =====
      const startRow = 5; let rIdx = startRow;

      dataRows.forEach(dr => {
        const row = ws.getRow(rIdx++);
        row.values = [
          dr.tanggal,
          dr.teknisi,
          dr.lokasiDari,
          dr.lokasiKe,
          dr.jenis,
          dr.detail,
          dr.status,
          dr.jamMasuk ? hmToExcelTime(dr.jamMasuk)*1 : null,
          dr.jamBerangkat ? hmToExcelTime(dr.jamBerangkat)*1 : null,
          dr.jamTiba ? hmToExcelTime(dr.jamTiba)*1 : null,
          dr.jamMulai ? hmToExcelTime(dr.jamMulai)*1 : null,
          dr.jamSelesai ? hmToExcelTime(dr.jamSelesai)*1 : null,
          dr.waktuPenyelesaian,        // excel time or null
          dr.jarak,                    // number or null
          dr.waktuTempuh,              // excel time or null
          dr.keterangan
        ];

        // Format jam (H..L) & durasi (M,O)
        ['H','I','J','K','L'].forEach(col => { ws.getCell(col + row.number).numFmt = 'h:mm'; });
        ['M','O'].forEach(col => { ws.getCell(col + row.number).numFmt = '[h]:mm'; });

        for (let c = 1; c <= 16; c++) {
          const cell = row.getCell(c);
          cell.alignment = { vertical: 'middle', horizontal: (c===2?'left':'center'), wrapText: [5,6,16].includes(c) };
          cell.border = { top:{style:'thin'}, left:{style:'thin'}, bottom:{style:'thin'}, right:{style:'thin'} };
        }
        row.height = 18; row.commit && row.commit();
      });

      // ===== TOTAL row (A..P) =====
      const endRow = rIdx - 1;
      const totalRowIdx = rIdx;

      ws.mergeCells(`A${totalRowIdx}:L${totalRowIdx}`);
      const totalCell = ws.getCell(`A${totalRowIdx}`);
      totalCell.value = 'TOTAL';
      totalCell.font = { bold: true };
      totalCell.alignment = { vertical:'middle', horizontal:'center' };

      // Hitung total dari dataRows
      const sumWP = dataRows.reduce((a,r)=> a + ((r.waktuPenyelesaian ?? 0) * 24*60), 0); // menit
      const sumJT = dataRows.reduce((a,r)=> a + (Number(r.jarak)||0), 0);
      const sumWT = dataRows.reduce((a,r)=> a + ((r.waktuTempuh ?? 0) * 24*60), 0);

      ws.getCell(`M${totalRowIdx}`).value = { formula:`SUM(M${startRow}:M${endRow})`, result: minutesToExcelTime(sumWP) };
      ws.getCell(`N${totalRowIdx}`).value = { formula:`SUM(N${startRow}:N${endRow})`, result: sumJT };
      ws.getCell(`O${totalRowIdx}`).value = { formula:`SUM(O${startRow}:O${endRow})`, result: minutesToExcelTime(sumWT) };

      ws.getCell(`M${totalRowIdx}`).numFmt = '[h]:mm';
      ws.getCell(`O${totalRowIdx}`).numFmt = '[h]:mm';

      const totalRow = ws.getRow(totalRowIdx);
      for (let c=1; c<=16; c++){
        const cell = totalRow.getCell(c);
        cell.font = { bold:true };
        cell.alignment = { vertical:'middle', horizontal: c===2 ? 'left' : 'center' };
        cell.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:'FFC5D9F1' } };
        cell.border = { top:{style:'thin'}, left:{style:'thin'}, bottom:{style:'thin'}, right:{style:'thin'} };
      }
      totalRow.height = 18; totalRow.commit && totalRow.commit();
      rIdx++;

      // paksa Excel calc saat open
      if (wb.calcProperties) wb.calcProperties.fullCalcOnLoad = true;

      // ===== Footer tanda tangan =====
      const sigTop = totalRowIdx + 2;

      ws.getCell(`N${sigTop}`).value = `Jakarta, ${new Date().toLocaleDateString('id-ID',{day:'numeric',month:'long',year:'numeric'})}`;
      ws.getCell(`N${sigTop}`).alignment = { horizontal: 'center', vertical: 'middle' };
      ws.getCell(`N${sigTop}`).font = { bold: true };
      ws.getCell(`N${sigTop+1}`).value = "Dibuat oleh,";
      ws.getCell(`N${sigTop+1}`).font = { bold: true };
      ws.getCell(`N${sigTop+1}`).alignment = { horizontal: 'center', vertical: 'middle' };

      ws.getCell(`N${sigTop+5}`).value = teknisiPembuat;
      ws.getCell(`N${sigTop+5}`).font  = { bold: true, underline: true };
      ws.getCell(`N${sigTop+5}`).alignment = { horizontal: 'center', vertical: 'middle' };
      ws.getCell(`N${sigTop+6}`).value = "Teknisi";
      ws.getCell(`N${sigTop+6}`).font  = { bold: true };
      ws.getCell(`N${sigTop+6}`).alignment = { horizontal: 'center', vertical: 'middle' };

      ws.getCell(`D${sigTop}`).value = "Mengetahui,";
      ws.getCell(`D${sigTop}`).font = { bold: true };
      ws.getCell(`D${sigTop}`).alignment = { horizontal: 'center', vertical: 'middle' };

      ws.getCell(`C${sigTop+5}`).value = "Yonathan Christian";
      ws.getCell(`C${sigTop+5}`).font  = { bold: true, underline: true };
      ws.getCell(`C${sigTop+5}`).alignment = { horizontal: 'center', vertical: 'middle' };
      ws.getCell(`C${sigTop+6}`).value = "Assistant Vice President";
      ws.getCell(`C${sigTop+6}`).font  = { bold: true };
      ws.getCell(`C${sigTop+6}`).alignment = { horizontal: 'center', vertical: 'middle' };

      ws.getCell(`E${sigTop+5}`).value = "Fitrah Rahmanto";
      ws.getCell(`E${sigTop+5}`).font  = { bold: true, underline: true };
      ws.getCell(`E${sigTop+5}`).alignment = { horizontal: 'center', vertical: 'middle' };
      ws.getCell(`E${sigTop+6}`).value = "Project Controller";
      ws.getCell(`E${sigTop+6}`).font  = { bold: true };
      ws.getCell(`E${sigTop+6}`).alignment = { horizontal: 'center', vertical: 'middle' };

      // spacing tanda tangan
      for(let r=sigTop+2; r<=sigTop+4; r++){ ws.getRow(r).height = 18; }

      
    // === helper lebar kolom (seragam untuk kolom waktu) ===
    function applySmartWidths(ws, {
      wrapCols = [5,6,16],
      min = 8, max = 48, padding = 2,
      // min width dasar per kolom A..P (boleh ubah)
      minAtoP = [22,28,18,28,22,24,16,10,10,10,12,10,10,9,10,30],
      timeCols = [8,9,10,11,12],   // H..L
      durationCols = [13,15],      // M & O
      distanceCol = 14,            // N
      timeMinWidth = 11,
      durationMinWidth = 10,
      distMinWidth = 9
    } = {}) {
      // 1) Auto-fit biar teks panjang (lokasi/jenis/detail/keterangan) kebaca
      autoFitColumns(ws, { min, max, padding, wrapCols });

      // 2) Pastikan setiap kolom minimal senyaman ini
      minAtoP.forEach((w, i) => {
        const col = ws.getColumn(i + 1);
        col.width = Math.max(col.width || 0, w);
      });

      // 3) SERAGAMKAN:
      //    - Ambil width terbesar hasil auto-fit utk H..L, lalu samakan semua
      const maxTimeW = Math.max(timeMinWidth, ...timeCols.map(i => ws.getColumn(i).width || 0));
      timeCols.forEach(i => ws.getColumn(i).width = maxTimeW);

      //    - Ambil width terbesar utk M & O, samakan
      const maxDurW = Math.max(durationMinWidth, ...durationCols.map(i => ws.getColumn(i).width || 0));
      durationCols.forEach(i => ws.getColumn(i).width = maxDurW);

      //    - N (jarak) set minimal nyaman
      ws.getColumn(distanceCol).width = Math.max(distMinWidth, ws.getColumn(distanceCol).width || 0);
    }

      // Export
      // ... setelah tulis data, TOTAL, dan footer tanda tangan
      applySmartWidths(ws);

      // lalu:
      const buf = await wb.xlsx.writeBuffer();

      const blob=new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
      const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=fileName; a.click(); URL.revokeObjectURL(url);

    }catch(err){ console.error('Export XLSX error:',err); showToast('Gagal export XLSX. Cek console.'); }
  }

  // ===== Reset bulan
  function resetMonth(){
    const all=loadReports(); const n=all.filter(r=>r.month===month).length; if(!n) return showToast('Tidak ada data untuk direset.');
    if(!confirm(`Hapus ${n} entri untuk bulan ${month}?`)) return;
    saveReports(all.filter(r=>r.month!==month)); showToast('Data bulan ini sudah dihapus.'); applyFilters();
  }

  // ===== events (CSV & Print REMOVED)
  qInput && qInput.addEventListener('input', applyFilters);
  btnExportXlsx && btnExportXlsx.addEventListener('click', exportXLSX);
  btnReset && btnReset.addEventListener('click', resetMonth);

  // init
  applyFilters();
})();
