(function () {
  /* ================= CORE STORAGE (per akun) ================= */
  const STORAGE_PRIMARY = 'monthlyData';         // konsisten dgn mirror keys
  const STORAGE_LEGACY  = 'monthlyReports';      // dibaca utk migrasi

  const LS = {
    getItem(k){ return (window.AccountNS?.getItem?.(k)) ?? localStorage.getItem(k); },
    setItem(k,v){
      if (window.AccountNS?.setItem) window.AccountNS.setItem(k, v);
      else localStorage.setItem(k, v);
    }
  };

  // UID helper aman
  function getUidOrAnon(){
    try {
      return (window.DriveSync?.getUser?.()?.uid)
          || (window.Auth?.getUid?.())
          || (window.Auth?.user?.uid)
          || (window.Auth?.currentUser?.()?.uid)
          || 'anon';
    } catch { return 'anon'; }
  }

  function parseJSON(s, def){ try { return JSON.parse(s); } catch { return def; } }

  function loadLocalMerged() {
    // baca primary + legacy, merge unik by id (last-write-wins by updatedAt/createdAt)
    const a = parseJSON(LS.getItem(STORAGE_PRIMARY) || '[]', []);
    const b = parseJSON(LS.getItem(STORAGE_LEGACY)  || '[]', []);
    const map = new Map();
    const norm = (x) => {
      const id = x.id || [x.month, x.date, x.teknisi, x.createdAt].filter(Boolean).join('|');
      return { id, ...x };
    };
    [...a, ...b].forEach(r => {
      const n = norm(r);
      const ex = map.get(n.id);
      if (!ex) map.set(n.id, n);
      else {
        const tNew = new Date(n.updatedAt || n.createdAt || 0).getTime();
        const tOld = new Date(ex.updatedAt || ex.createdAt || 0).getTime();
        if (tNew >= tOld) map.set(n.id, n);
      }
    });
    return Array.from(map.values());
  }

  function saveLocal(arr) {
    const safe = JSON.stringify(Array.isArray(arr) ? arr : []);
    // tulis ke primary; legacy disinkronkan agar tetap backward-compat
    LS.setItem(STORAGE_PRIMARY, safe);
    LS.setItem(STORAGE_LEGACY,  safe);
    // dorong ke Drive (debounced) supaya device lain kebagian
    try { window.MonthlySync?.queuePush?.(monthlyGetLocal); } catch {}
  }

  /* ================== ELEMENT REFS ================== */
  const $id = (id) => document.getElementById(id);
  const bulan = $id('bulan');
  const tanggal = $id('tanggal');
  const teknisi = $id('teknisi');
  const jenis = $id('jenis');
  const lokasiDari = $id('lokasiDari');
  const lokasiKe = $id('lokasiKe');
  const detail = $id('detail');
  const status = $id('status');
  const jamBerangkat = $id('jamBerangkat');
  const jamMasuk = $id('jamMasuk');
  const jamTiba = $id('jamTiba');
  const jamMulai = $id('jamMulai');
  const jamSelesai = $id('jamSelesai');
  const durasiPenyelesaian = $id('durasiPenyelesaian');
  const jarak = $id('jarak');
  const waktuTempuh = $id('waktuTempuh');
  const keterangan = $id('keterangan');
  const form = $id('formReport');
  const linkData = document.getElementById('linkData');
  const countBulan = document.getElementById('countBulan');
  const toast = document.getElementById('toast');

  /* ================== UTIL ================== */
  const pad = (n) => String(n).padStart(2, '0');
  const todayISO = () => {
    const d=new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  };
  const thisMonth = () => {
    const d=new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}`;
  };
  const toHHMM = (m) => {
    m = Math.max(0, Math.round(m || 0));
    const h = Math.floor(m / 60); const mm = m % 60; return `${h}:${pad(mm)}`;
  };
  const parseTimeToMin = (t) => {
    if (!t || !/^\d{1,2}:\d{2}$/.test(t)) return null;
    const [h, m] = t.split(':').map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return null;
    return h * 60 + m;
  };
  const diffWrap = (a, b) => { // b - a, wrap 24h
    const A = parseTimeToMin(a), B = parseTimeToMin(b);
    if (A==null || B==null) return null;
    let d = B - A; if (d < 0) d += 1440; return d;
  };
  function showToast(msg) {
    if (!toast) return;
    toast.textContent = msg; toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 1600);
  }
  function setLinkTargets(month) {
    const href = `monthly-data.html?month=${encodeURIComponent(month)}`;
    if (linkData) linkData.href = href;
  }
  function refreshCountForMonth(month) {
    if (!countBulan) return;
    try {
      const all = loadLocalMerged();
      countBulan.textContent = all.filter(x => (x.month||'').trim() === month).length;
    } catch { countBulan.textContent = '0'; }
  }

  /* ================== TEKNISI (statik) ================== */
  function populateTeknisi() {
    if (!teknisi) return;
    const list = [
      'Mochammad Fathur Rachman',
      'Muhammad Farhan Baihaqi',
      'Halviansyah Wildana',
      'Dafa Farabi',
      'Azriel Raja Simamora',
      'Dimas Pujianto'
    ];
    if (!teknisi.options.length || teknisi.firstElementChild?.value === '') {
      teknisi.innerHTML = ['<option value="">-- Pilih Nama --</option>']
        .concat(list.map(n => `<option value="${n}">${n}</option>`)).join('');
    }
  }

  /* ================== AUTO FIELDS ================== */
  function computeAutoFields() {
    // jamMasuk otomatis = jamBerangkat - 5 menit (wrap 24h)
    const berangkat = parseTimeToMin(jamBerangkat.value);
    if (berangkat != null) {
      const masuk = (berangkat - 5 + 1440) % 1440;
      const hh = Math.floor(masuk / 60), mm = masuk % 60;
      jamMasuk.value = `${pad(hh)}:${pad(mm)}`;
    } else {
      jamMasuk.value = '';
    }

    // waktu tempuh
    const tempuh = diffWrap(jamBerangkat.value, jamTiba.value);
    waktuTempuh.value = tempuh==null ? '0:00' : toHHMM(tempuh);

    // durasi pekerjaan
    const dur = diffWrap(jamMulai.value, jamSelesai.value);
    durasiPenyelesaian.value = dur==null ? '0:00' : toHHMM(dur);
  }

  /* ================== CLOUD MIRROR ADAPTERS ================== */
  async function monthlyGetLocal() { return loadLocalMerged(); }
  async function monthlySetLocal(arr) { saveLocal(arr || []); }

  // Siapkan MonthlySync bila belum ada — gunakan envelope { data: [...] }
  (function ensureMonthlySync(){
    if (window.MonthlySync && window.MonthlySync.pull && window.MonthlySync.queuePush) return;

    const fileName = () => `.monthly_data__${getUidOrAnon()}.json`;
    const pull = async (getLocal, setLocal, onAfter) => {
      try {
        const ok = await (window.DriveSync?.tryResume?.() || Promise.resolve(false));
        if (!ok && !window.DriveSync?.isLogged?.()) return;
        const cloud = await window.DriveSync?.getJson?.(fileName());
        // dukung dua bentuk: {data:[...]} atau langsung array
        const incoming = Array.isArray(cloud?.data) ? cloud.data : (Array.isArray(cloud) ? cloud : []);
        if (!incoming.length) { onAfter && onAfter(); return; }

        // merge last-write-wins
        const base = await getLocal();
        const map = new Map();
        const norm = (x) => {
          const id = x.id || [x.month, x.date, x.teknisi, x.createdAt].filter(Boolean).join('|');
          return { id, ...x };
        };
        [...base, ...incoming].forEach((r) => {
          const n = norm(r);
          const ex = map.get(n.id);
          if (!ex) map.set(n.id, n);
          else {
            const tNew = new Date(n.updatedAt || n.createdAt || 0).getTime();
            const tOld = new Date(ex.updatedAt || ex.createdAt || 0).getTime();
            if (tNew >= tOld) map.set(n.id, n);
          }
        });
        await setLocal(Array.from(map.values()));
        onAfter && onAfter();
      } catch (e) {
        console.warn('[MonthlySync.fallback.pull] gagal:', e);
        onAfter && onAfter();
      }
    };

    let t=null;
    const queuePush = function (getLocal) {
      clearTimeout(t);
      t = setTimeout(async () => {
        try {
          const uid = getUidOrAnon();
          if (!uid || uid === 'anon') return;
          const ok = await (window.DriveSync?.tryResume?.() || Promise.resolve(false));
          if (!ok && !window.DriveSync?.isLogged?.()) return;
          const rows = await getLocal();
          if (!Array.isArray(rows)) return;
          await window.DriveSync?.putJson?.(fileName(), { data: rows });
        } catch (e) {
          console.warn('[MonthlySync.fallback.queuePush] gagal:', e);
        }
      }, 800);
    };

    window.MonthlySync = { fileName, pull, queuePush };
  })();

  /* ================== INIT ================== */
  (function init(){
    if (bulan)   bulan.value = thisMonth();
    if (tanggal) tanggal.value = todayISO();
    setLinkTargets(bulan?.value || thisMonth());
    refreshCountForMonth(bulan?.value || thisMonth());
    populateTeknisi();

    [jamBerangkat, jamTiba, jamMulai, jamSelesai].forEach(inp => {
      ['input', 'change'].forEach(ev => inp?.addEventListener(ev, computeAutoFields));
    });
    computeAutoFields();

    bulan?.addEventListener('change', () => {
      setLinkTargets(bulan.value);
      refreshCountForMonth(bulan.value);
    });

    // tarik data cloud → merge ke lokal → refresh counter (lintas device)
    (async () => {
      try {
        await window.MonthlySync?.pull?.(monthlyGetLocal, monthlySetLocal, () => {
          refreshCountForMonth(bulan?.value || thisMonth());
        });
      } catch { /* silent */ }
    })();
  })();

  /* ================== SUBMIT ================== */
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const month = (bulan?.value || '').trim();
    const dateStr = (tanggal?.value || '').trim();
    const tech = (teknisi?.value || '').trim();
    if (!month || !dateStr || !tech) { showToast('Bulan, Tanggal, dan Teknisi wajib diisi.'); return; }

    // pakai auto fields (jamMasuk = jamBerangkat - 5)
    computeAutoFields();

    const tempuhMin  = diffWrap(jamBerangkat.value, jamTiba.value) ?? 0;
    const durPenyMin = diffWrap(jamMulai.value, jamSelesai.value) ?? 0;

    const rec = {
      id: (crypto.randomUUID ? crypto.randomUUID() : (String(Date.now()) + Math.random().toString(16).slice(2))),
      month,
      date: dateStr,
      teknisi: tech,
      lokasiDari: (lokasiDari?.value || '').trim(),
      lokasiKe: (lokasiKe?.value || '').trim(),
      jenis: jenis?.value || '',
      detail: (detail?.value || '').trim(),
      status: status?.value || 'Done',

      jamMasuk: jamMasuk?.value || '',
      jamBerangkat: jamBerangkat?.value || '',
      jamTiba: jamTiba?.value || '',
      jamMulai: jamMulai?.value || '',
      jamSelesai: jamSelesai?.value || '',

      // simpan dua bentuk untuk kompatibilitas halaman Data
      durasiPenyelesaianMin: durPenyMin,
      durasiPenyelesaianStr: toHHMM(durPenyMin),
      durasiPenyelesaian: toHHMM(durPenyMin),

      jarak: parseFloat(jarak?.value || '0') || 0,
      waktuTempuhMin: tempuhMin,
      waktuTempuhStr: toHHMM(tempuhMin),
      waktuTempuh: toHHMM(tempuhMin),

      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      source: 'monthly-form@clean'
    };

    const all = loadLocalMerged();
    all.push(rec);
    saveLocal(all);

    showToast('✅ Data tersimpan.');
    form.reset();
    // pertahankan konteks bulan + tanggal default; jamMasuk biarkan auto via jamBerangkat (tidak di-set now)
    if (bulan)   bulan.value = month;
    if (tanggal) tanggal.value = todayISO();
    setLinkTargets(month);
    refreshCountForMonth(month);
    computeAutoFields();
  });
})();
