(function(){
  const STORAGE_KEY = 'monthlyReports';

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

  // ===== elem refs
  const el = (id) => document.getElementById(id);
  const bulan = el('bulan');
  const tanggal = el('tanggal');
  const teknisi = el('teknisi');
  const jenis = el('jenis');
  const lokasiDari = el('lokasiDari');
  const lokasiKe = el('lokasiKe');
  const detail = el('detail');
  const status = el('status');
  const jamBerangkat = el('jamBerangkat');
  const jamMasuk = el('jamMasuk');
  const jamTiba = el('jamTiba');
  const jamMulai = el('jamMulai');
  const jamSelesai = el('jamSelesai');
  const durasiPenyelesaian = el('durasiPenyelesaian');
  const jarak = el('jarak');
  const waktuTempuh = el('waktuTempuh');
  const keterangan = el('keterangan');
  const form = el('formReport');
  const linkData = document.getElementById('linkData');
  const btnLihatBulan = document.getElementById('btnLihatBulan');
  const countBulan = document.getElementById('countBulan');
  const toast = document.getElementById('toast');

  // ===== utils
  const today = new Date();
  const pad = (n)=> String(n).padStart(2,'0');
  const toHHMM = (m)=>{
    m = Math.max(0, Math.round(m||0));
    const h = Math.floor(m/60); const mm = m%60; return `${h}:${pad(mm)}`;
  };
  const parseTimeToMin = (t)=>{
    if(!t) return null;
    const [h,m] = t.split(':').map(Number);
    if(Number.isNaN(h)||Number.isNaN(m)) return null;
    return h*60+m;
  };
  const minToTimeStr = (m)=> `${pad(Math.floor((m%1440)/60))}:${pad(Math.floor(m%60))}`;
  const defaultMonth = () => `${today.getFullYear()}-${pad(today.getMonth()+1)}`;
  const defaultDate  = () => `${today.getFullYear()}-${pad(today.getMonth()+1)}-${pad(today.getDate())}`;

  function loadReports(){ try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; } catch { return []; } }
  function saveReports(arr){ localStorage.setItem(STORAGE_KEY, JSON.stringify(arr)); }

  function refreshCountForMonth(month){ if (countBulan) countBulan.textContent = loadReports().filter(x=>x.month===month).length; }
  function setLinkTargets(month){
    const href = `monthly-data.html?month=${encodeURIComponent(month)}`;
    if (linkData) linkData.href = href;
    if (btnLihatBulan) btnLihatBulan.href = href;
  }
  function showToast(msg){
    if(!toast) return;
    toast.textContent = msg; toast.classList.add('show'); setTimeout(()=> toast.classList.remove('show'), 1600);
  }

  // ===== Dropdown teknisi (STATIS)
  function populateTeknisi(){
    if (!teknisi) return;
    const list = [
      "Mochammad Fathur Rachman",
      "Muhammad Farhan Baihaqi",
      "Halviansyah Wildana",
      "Dafa Farabi",
      "Azriel Raja Simamora",
      "Dimas Pujianto"
    ];
    if (!teknisi.options.length || teknisi.firstElementChild?.value === "") {
      teknisi.innerHTML = ['<option value="">-- Pilih Nama --</option>']
        .concat(list.map(n=>`<option value="${n}">${n}</option>`)).join('');
    }
  }

  // ===== auto fields
  function computeAutoFields(){
    const berangkat = parseTimeToMin(jamBerangkat.value);
    if(berangkat!=null){
      const masuk = (berangkat - 5 + 1440) % 1440; // -5 menit, wrap 24h
      jamMasuk.value = minToTimeStr(masuk);
    } else { jamMasuk.value = ''; }

    const tiba = parseTimeToMin(jamTiba.value);
    if(berangkat!=null && tiba!=null){
      const tempuh = (tiba - berangkat + 1440) % 1440;
      waktuTempuh.value = toHHMM(tempuh);
    } else { waktuTempuh.value = '0:00'; }

    const mulai = parseTimeToMin(jamMulai.value);
    const selesai = parseTimeToMin(jamSelesai.value);
    if(mulai!=null && selesai!=null){
      const dur = (selesai - mulai + 1440) % 1440;
      durasiPenyelesaian.value = toHHMM(dur);
    } else { durasiPenyelesaian.value = '0:00'; }
  }

  // ===== Cloud mirror adapters (Drive JSON)
  async function monthlyGetLocal(){
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
    catch { return []; }
  }
  async function monthlySetLocal(arr){
    localStorage.setItem(STORAGE_KEY, JSON.stringify(arr || []));
  }

  // ===== init
  bulan.value = defaultMonth();
  tanggal.value = defaultDate();
  setLinkTargets(bulan.value);
  refreshCountForMonth(bulan.value);
  populateTeknisi();

  [jamBerangkat,jamTiba,jamMulai,jamSelesai].forEach(inp=>{
    ['input','change'].forEach(ev => inp.addEventListener(ev, computeAutoFields));
  });
  computeAutoFields();

  bulan.addEventListener('change', ()=>{
    setLinkTargets(bulan.value);
    refreshCountForMonth(bulan.value);
  });

  // Tarik data cloud → merge ke lokal → refresh counter (biar lintas device konsisten)
  (async () => {
    try {
      if (window.MonthlySync?.pull) {
        await window.MonthlySync.pull(monthlyGetLocal, monthlySetLocal, () => {
          refreshCountForMonth(bulan.value);
        });
      }
    } catch {}
  })();

  // ===== helper
  function formatTanggalLong(dateStr){
    try { return new Date(dateStr+'T00:00:00').toLocaleDateString('id-ID',{weekday:'long', day:'2-digit', month:'long', year:'numeric'}); }
    catch { return dateStr; }
  }

  // ===== submit
  form.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const month = (bulan.value || '').trim();
    const dateStr = (tanggal.value || '').trim();
    const tech = (teknisi.value || '').trim();
    if(!month || !dateStr || !tech){ showToast('Bulan, Tanggal, dan Teknisi wajib diisi.'); return; }

    computeAutoFields(); // ensure latest

    const berangkat = parseTimeToMin(jamBerangkat.value) ?? 0;
    const tiba = parseTimeToMin(jamTiba.value) ?? 0;
    const mulai = parseTimeToMin(jamMulai.value) ?? 0;
    const selesai = parseTimeToMin(jamSelesai.value) ?? 0;
    const durPenyMin = Math.max(0, (selesai - mulai + 1440) % 1440);
    const tempuhMin = Math.max(0, (tiba - berangkat + 1440) % 1440);

    const rec = {
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2),
      month,
      date: dateStr,
      tanggalLabel: formatTanggalLong(dateStr),
      teknisi: tech,
      lokasiDari: (lokasiDari.value||'').trim(),
      lokasiKe: (lokasiKe.value||'').trim(),
      jenis: jenis.value,
      detail: (detail.value||'').trim(),
      status: status.value,
      jamMasuk: jamMasuk.value || '',
      jamBerangkat: jamBerangkat.value || '',
      jamTiba: jamTiba.value || '',
      jamMulai: jamMulai.value || '',
      jamSelesai: jamSelesai.value || '',
      durasiPenyelesaianMin: durPenyMin,
      durasiPenyelesaianStr: toHHMM(durPenyMin),
      jarakKm: parseFloat(jarak.value || '0') || 0,
      waktuTempuhMin: tempuhMin,
      waktuTempuhStr: toHHMM(tempuhMin),
      keterangan: (keterangan.value||'').trim(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Simpan lokal
    const all = loadReports(); all.push(rec); saveReports(all);

    // Mirror ke Drive (debounced, silent)
    try {
      if (window.MonthlySync?.queuePush) {
        await window.MonthlySync.queuePush(monthlyGetLocal);
      }
    } catch {}

    showToast('Data tersimpan.');
    form.reset(); bulan.value = month; tanggal.value = defaultDate();
    setLinkTargets(month); refreshCountForMonth(month); computeAutoFields();
  });
})();
