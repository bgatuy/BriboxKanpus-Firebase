/**
 * AccountStore — storage per-akun + sync ke Google Drive (root folder "Bribox Kanpus")
 * Tidak mengganggu kode lama: cukup panggil AccountStore.loadHistori()/saveHistori()
 * atau biarkan shim global (readHistoriSafe/writeHistori/getPdfHistori/setPdfHistori) yang kami pasang.
 */
(function(){
  const LS_PREFIX = 'bribox:';

  function who(){
    try { return (window.Auth?.get?.() || null); } catch { return null; }
  }
  function nsKey(base){
    const u = who();
    const email = (u?.email || u?.sub || 'anon');
    return `${LS_PREFIX}${base}:${email}`;
  }

  // ===== Drive JSON helpers (pakai DriveSync yang sudah ada) =====
  async function driveReady(){
    try { return !!(await (window.DriveSync?.tryResume?.() || Promise.resolve(false))); } catch { return false; }
  }
  async function pullJsonFromDrive(fname){
    try{
      if(!(await driveReady())) return null;
      const f = await DriveSync.findFileInRootByName(fname);
      if(!f) return null;
      const txt = await DriveSync.downloadFileText(f.id);
      return txt || null;
    }catch{ return null; }
  }
  async function pushJsonToDrive(fname, text){
    try{
      if(!(await driveReady())) return false;
      const f = await DriveSync.findFileInRootByName(fname);
      if (f) { await DriveSync.updateFileText(f.id, text ?? '[]'); }
      else   { await DriveSync.createJsonInRoot(fname, text ?? '[]'); }
      return true;
    }catch{ return false; }
  }

  // ====== PUBLIC: histori PDF per akun ======
  async function loadHistori(){
    const keyScoped = nsKey('pdfHistori');          // kunci per-akun
    // 1) coba tarik dari Drive
    const fname = keyScoped + '.json';              // nama file Drive per-akun
    const cloud = await pullJsonFromDrive(fname);
    if (cloud){
      try { const arr = JSON.parse(cloud); localStorage.setItem(keyScoped, JSON.stringify(arr||[])); return Array.isArray(arr)?arr:[]; }
      catch { /* fallthrough */ }
    }
    // 2) kalau belum ada: migrasi sekali dari kunci lama (global)
    const scoped = localStorage.getItem(keyScoped);
    if (scoped) { try { const arr = JSON.parse(scoped); return Array.isArray(arr)?arr:[]; } catch { return []; } }

    const legacy = localStorage.getItem('pdfHistori'); // kompat lama
    if (legacy){
      localStorage.setItem(keyScoped, legacy);
      try { const arr = JSON.parse(legacy); return Array.isArray(arr)?arr:[]; } catch { return []; }
    }
    return [];
  }

  async function saveHistori(arr){
    const keyScoped = nsKey('pdfHistori');
    const data = JSON.stringify(Array.isArray(arr)?arr:[]);
    // simpan lokal (per-akun)
    localStorage.setItem(keyScoped, data);
    // mirror ke Drive (best effort)
    try { await pushJsonToDrive(keyScoped + '.json', data); } catch {}
    // broadcast internal
    try { window.dispatchEvent(new CustomEvent('histori:change', { detail:{ items: arr||[] } })); } catch {}
    return arr;
  }

  // ====== Expose ======
  window.AccountStore = { nsKey, loadHistori, saveHistori };

  // ====== SHIMS (opsional): supaya kode lama otomatis “per-akun + sync” ======
  // Trackmate/AppSheet:
  window.readHistoriSafe = async function(){
    try { return await AccountStore.loadHistori(); } catch { return []; }
  };
  window.writeHistori = function(arr){
    try { return AccountStore.saveHistori(arr); } catch { localStorage.setItem('pdfHistori', JSON.stringify(arr||[])); return arr; }
  };
  // Form Serah Terima:
  window.getPdfHistori = function(){
    try { const key = AccountStore.nsKey('pdfHistori'); const raw = localStorage.getItem(key) || '[]'; return JSON.parse(raw); }
    catch { try{ return JSON.parse(localStorage.getItem('pdfHistori')||'[]'); }catch{ return []; } }
  };
  window.setPdfHistori = function(arr){
    try { return AccountStore.saveHistori(arr); }
    catch { localStorage.setItem('pdfHistori', JSON.stringify(arr||[])); return arr; }
  };

  // Auto-refresh ketika user pindah akun
  window.addEventListener('auth:change', async ()=>{ try { await loadHistori(); } catch {} });
})();

