/* drive-sync.js — Pure OAuth + Fetch (tanpa gapi) */
;(() => {
  if (window.__DRIVESYNC_LOADED__) return;
  window.__DRIVESYNC_LOADED__ = true;

  // ===== CONFIG =====
  const CLIENT_ID = window.__CONFIG?.GOOGLE_CLIENT_ID || '';
  if (!CLIENT_ID) console.warn('[DriveSync] GOOGLE_CLIENT_ID kosong di window.__CONFIG');

  const OAUTH_SCOPE = [
    'https://www.googleapis.com/auth/drive.file',
    'openid','email','profile'
  ].join(' ');
  // Jika pakai redirect page sendiri, pastikan file oauth-return.html mengirim postMessage {type:'GDRV_TOKEN', access_token, expires_in}
  const OAUTH_REDIRECT   = location.origin + '/oauth-return.html';
  const ROOT_FOLDER_NAME = 'Bribox Kanpus';

  // ===== STATE =====
  let ACCESS_TOKEN  = null;
  let rootFolderId  = null;
  let cachedProfile = null;

  // ===== Persist token per-tab =====
  const STORE_KEY = 'GDRV_AT';
  const STORE_EXP = 'GDRV_EXP';
  function saveToken(token, expiresInSec) {
    try {
      const expAt = Date.now() + ((expiresInSec || 3600) * 1000);
      sessionStorage.setItem(STORE_KEY, token);
      sessionStorage.setItem(STORE_EXP, String(expAt));
    } catch {}
  }
  function loadTokenIfValid() {
    try {
      const t = sessionStorage.getItem(STORE_KEY);
      const exp = parseInt(sessionStorage.getItem(STORE_EXP) || '0', 10);
      if (!t || !exp || Date.now() > exp) return null;
      return t;
    } catch { return null; }
  }

  // ===== Cross-page sync =====
  const bc = ('BroadcastChannel' in window) ? new BroadcastChannel('bribox-drive') : null;
  const broadcast = (status) => { try { bc?.postMessage({ type:'drive-auth', status }); } catch {} };

  // ===== UI helpers (opsional) =====
  const $ = s => document.querySelector(s);
  function setAuthUI(logged, profile){
    const bar  = $('#driveConnectBar');
    const btn  = $('#btnConnectDrive');
    const who  = $('#whoami');
    if (bar) bar.style.display = logged ? 'none' : '';
    if (btn) btn.disabled = false;
    if (who) who.textContent = logged ? (profile?.email || profile?.name || 'Logged in') : '';
  }

  // ===== OAUTH (Implicit Flow manual) =====
  function buildAuthUrl(stateUrl){
    const p = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: OAUTH_REDIRECT,
      response_type: 'token',
      scope: OAUTH_SCOPE,
      include_granted_scopes: 'true',
      prompt: 'consent',
      state: stateUrl || location.href
    });
    return 'https://accounts.google.com/o/oauth2/v2/auth?' + p.toString();
  }
  function openCenteredPopup(url, title, w=520, h=620){
    const dualScreenLeft = (window.screenLeft ?? window.screenX);
    const dualScreenTop  = (window.screenTop  ?? window.screenY);
    const width  = window.innerWidth  || document.documentElement.clientWidth  || screen.width;
    const height = window.innerHeight || document.documentElement.clientHeight || screen.height;
    const left = ((width - w) / 2) + dualScreenLeft;
    const top  = ((height - h) / 2) + dualScreenTop;
    return window.open(url, title, `scrollbars=yes,resizable=yes,width=${w},height=${h},top=${top},left=${left}`);
  }

  async function signIn(){
    // Kalau oauth-return sudah menyimpan token (STORE_KEY) → ambil
    const pending = sessionStorage.getItem(STORE_KEY);
    if (pending) {
      sessionStorage.removeItem(STORE_KEY);
      ACCESS_TOKEN = pending;
      await afterLogin();
      broadcast('in');
      return;
    }
    // Popup flow
    return new Promise((resolve, reject) => {
      const url = buildAuthUrl(location.href);
      const pop = openCenteredPopup(url, 'Google Login');
      if (!pop) { location.assign(url); return reject(new Error('Popup diblok; redirect.')); }
      const timer = setInterval(() => {
        if (pop.closed) { clearInterval(timer); reject(new Error('Popup ditutup sebelum login.')); }
      }, 400);
      function onMsg(ev){
        try {
          if (typeof ev.data !== 'object' || ev.data?.type !== 'GDRV_TOKEN') return;
          window.removeEventListener('message', onMsg);
          clearInterval(timer);
          pop.close();
          ACCESS_TOKEN = ev.data.access_token || null;
          if (!ACCESS_TOKEN) return reject(new Error('No access_token from OAuth.'));
          saveToken(ACCESS_TOKEN, Number(ev.data.expires_in || 3600));
          afterLogin().then(() => { broadcast('in'); resolve(); }).catch(reject);
        } catch(e){ clearInterval(timer); reject(e); }
      }
      window.addEventListener('message', onMsg);
    });
  }

  async function signOut(){
    try {
      if (ACCESS_TOKEN) {
        await fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(ACCESS_TOKEN), {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        }).catch(()=>{});
      }
    } finally {
      ACCESS_TOKEN = null; cachedProfile = null; rootFolderId = null;
      try { sessionStorage.removeItem(STORE_KEY); sessionStorage.removeItem(STORE_EXP); } catch {}
      setAuthUI(false); broadcast('out');
    }
  }

  // ===== Auto-resume =====
  async function tryResume() {
    const t = loadTokenIfValid();
    if (!t) return false;
    ACCESS_TOKEN = t;
    try { await afterLogin(); broadcast('in'); return true; }
    catch { ACCESS_TOKEN = null; return false; }
  }

  DriveSync._notifyAuth && DriveSync._notifyAuth();

  // ===== Fetch helpers =====
  const authHeaders = (extra) => {
    if (!ACCESS_TOKEN) throw new Error('Belum login Google Drive.');
    return Object.assign({ 'Authorization': 'Bearer ' + ACCESS_TOKEN }, extra || {});
  };
  async function httpJSON(url, opts){
    const res = await fetch(url, Object.assign({ headers: authHeaders({ 'Accept': 'application/json' }) }, opts));
    if (!res.ok) {
      const txt = await res.text().catch(()=>res.statusText);
      throw new Error(`HTTP ${res.status}: ${txt}`);
    }
    return res.json();
  }

  // ===== Setelah login =====
  async function afterLogin(){
    try { cachedProfile = await httpJSON('https://openidconnect.googleapis.com/v1/userinfo'); }
    catch(e){ console.warn('userinfo error:', e); cachedProfile = null; }
    setAuthUI(true, cachedProfile);
    await ensureRootFolder();
  }

  // ===== Drive ops =====
  async function queryDrive(q, fields){
    const p = new URLSearchParams({
      q, spaces:'drive', pageSize:'1000',
      fields:'files(' + (fields || 'id,name,mimeType,parents,createdTime,modifiedTime,size') + ')'
    });
    const url = 'https://www.googleapis.com/drive/v3/files?' + p.toString();
    const res = await fetch(url, { headers: authHeaders() });
    if (!res.ok) throw new Error('Drive list failed: ' + res.status);
    return (await res.json()).files || [];
  }

  async function ensureRootFolder(){
    if (rootFolderId) return rootFolderId;
    const esc = ROOT_FOLDER_NAME.replace(/'/g, "\\'");
    const list = await queryDrive(`name='${esc}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
    if (list.length) { rootFolderId = list[0].id; return rootFolderId; }
    const res = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ name: ROOT_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' })
    });
    if (!res.ok) throw new Error('Create folder failed: ' + res.status);
    rootFolderId = (await res.json()).id;
    return rootFolderId;
  }

  // ===== Upload PDF (SELALU ke root, NAMA ASLI) =====
  /**
   * @param {File} file
   * @param {string|null} _contentHash (diabaikan)
   * @param {string|null} _moduleName  (diabaikan)
   * @param {object} opts { simpleName?:boolean } -> default true
   * @returns {Promise<{id:string,name:string}>}
   */
  async function uploadPdf(file, _contentHash, _moduleName, opts = {}) {
    if (!file || file.type !== 'application/pdf') throw new Error('Bukan PDF');

    await ensureRootFolder();                 // pastikan root ada
    const parent = rootFolderId;              // TANPA sub-folder
    const simpleName = (opts.simpleName !== false); // default TRUE (nama asli)

    // nama aman: buang karakter ilegal & batasi panjang
    let safeName = (file.name || 'document.pdf')
      .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, '_')
      .slice(0, 250);

    if (!simpleName) safeName = safeName; // no-op; tetap nama asli

    const metadata = { name: safeName, mimeType:'application/pdf', parents:[parent] };

    // multipart/related
    const boundary  = '-------314159265358979323846';
    const delimiter = '\r\n--' + boundary + '\r\n';
    const closeDelim= '\r\n--' + boundary + '--';
    const metaPart  = delimiter + 'Content-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(metadata);

    const bytes = new Uint8Array(await file.arrayBuffer());
    // btoa aman via chunking
    let bin = ''; const CH = 0x8000;
    for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    const base64 = btoa(bin);

    const filePart = delimiter + 'Content-Type: application/pdf\r\nContent-Transfer-Encoding: base64\r\n\r\n' + base64;
    const body = metaPart + filePart + closeDelim;

    const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'multipart/related; boundary=' + boundary }),
      body
    });
    if (!res.ok) throw new Error('Upload failed: ' + res.status);
    const data = await res.json();
    return { id: data.id, name: safeName };
  }

  // ===== JSON helpers (mirror lintas device) =====
  async function findFileInRootByName(name){
    const parent = await ensureRootFolder();
    const esc = String(name).replace(/'/g, "\\'");
    const list = await queryDrive(`'${parent}' in parents and trashed=false and name='${esc}'`, 'id,name');
    return list[0] || null;
  }
  async function downloadFileText(fileId){
    const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
    const res = await fetch(url, { headers: authHeaders() });
    if (!res.ok) throw new Error('Download failed: ' + res.status);
    return await res.text();
  }
  async function createJsonInRoot(name, text){
    const parent = await ensureRootFolder();
    const boundary  = '-------314159265358979323846';
    const delimiter = '\r\n--' + boundary + '\r\n';
    const close     = '\r\n--' + boundary + '--';
    const metaPart  = delimiter + 'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
                      JSON.stringify({ name, mimeType: 'application/json', parents: [parent] });
    const dataPart  = delimiter + 'Content-Type: application/json\r\n\r\n' + (text ?? '{}');
    const body      = metaPart + dataPart + close;

    const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'multipart/related; boundary=' + boundary }),
      body
    });
    if (!res.ok) throw new Error('Create JSON failed: ' + res.status);
    return (await res.json()).id;
  }
  async function updateFileText(fileId, text, mime='application/json'){
    const res = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
      method: 'PATCH',
      headers: authHeaders({ 'Content-Type': mime }),
      body: text ?? ''
    });
    if (!res.ok) throw new Error('Update JSON failed: ' + res.status);
    return true;
  }
  /** Dapatkan JSON by name (root). Return: {id, data} atau null kalau belum ada */
  async function getJson(name){
    const f = await findFileInRootByName(name);
    if (!f) return null;
    const txt = await downloadFileText(f.id).catch(()=>'null');
    let data = null; try { data = JSON.parse(txt); } catch {}
    return { id: f.id, data };
  }
  /** Simpan (create/update) JSON di root. Return: {id} */
  async function putJson(name, obj){
    const txt = JSON.stringify(obj ?? {}, null, 0);
    const f = await findFileInRootByName(name);
    if (f) { await updateFileText(f.id, txt); return { id: f.id }; }
    const id = await createJsonInRoot(name, txt);
    return { id };
  }

  // kompatibilitas lama (tidak dipakai lagi krn tdk ada prefix/hash & subfolder)
  async function findByHashPrefix(){ return null; }

  // ==== Drive polyfills & idempotent helpers (append) ====
(function(){
  if (!window.DriveSync) window.DriveSync = {};
  // akses token (sesuaikan dengan variabel di file kamu — ini dua kemungkinan)
  const _getToken = () => (window.DriveSync._getAccessToken?.() || window.DriveSync.accessToken || window.accessToken);

  // ---- auth change broadcasting (optional) ----
  const _authListeners = new Set();
  if (!DriveSync.onAuthStateChanged) {
    DriveSync.onAuthStateChanged = (cb) => { if (typeof cb==='function'){ _authListeners.add(cb); try{ cb(!!_getToken()); }catch{} } };
  }
  function _notifyAuth(){ for(const f of _authListeners) try{ f(!!_getToken()); }catch{} }
  // panggil _notifyAuth() di tempat login/logout yang kamu punya (kalau belum)

  // ---- identity bridge untuk user-scope ----
  if (!DriveSync.getUser) {
    DriveSync.getUser = () => {
      const a = (window.Auth && (Auth.currentUser ? Auth.currentUser() : null));
      return (a && a.uid) ? { uid:String(a.uid), email:a.email||'' } : null;
    };
  }

  // ---- HTTP helpers ----
  async function _gget(url){
    const token = _getToken(); if (!token) throw new Error('No Drive token');
    const r = await fetch(url, { headers:{ Authorization:`Bearer ${token}` }});
    if (!r.ok) throw new Error('Drive GET failed'); return r.json();
  }
  async function _gpost(url, body){
    const token = _getToken(); if (!token) throw new Error('No Drive token');
    const r = await fetch(url, { method:'POST', headers:{ Authorization:`Bearer ${token}`, 'Content-Type':'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error('Drive POST failed'); return r.json();
  }

  // ---- folder utils ----
  if (!DriveSync.createFolder) DriveSync.createFolder = async (name, parentId=null) => {
    return _gpost('https://www.googleapis.com/drive/v3/files', {
      name, mimeType:'application/vnd.google-apps.folder', parents: parentId ? [parentId] : undefined
    });
  };
  if (!DriveSync.findFolderByName) DriveSync.findFolderByName = async (name, parentId=null) => {
    const q = [
      "mimeType='application/vnd.google-apps.folder'",
      "trashed=false",
      `name='${name.replace(/'/g,"\\'")}'`,
      parentId ? `'${parentId}' in parents` : "'root' in parents"
    ].join(' and ');
    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=1`;
    const j = await _gget(url);
    return j.files?.[0] || null;
  };
  if (!DriveSync.ensureRoot) DriveSync.ensureRoot = async () => {
    const name = 'Bribox Kanpus';
    const f = await DriveSync.findFolderByName(name);
    return f?.id || (await DriveSync.createFolder(name)).id;
  };
  if (!DriveSync.ensureSub) DriveSync.ensureSub = async (name) => {
    const parent = await DriveSync.ensureRoot();
    const f = await DriveSync.findFolderByName(name, parent);
    return f?.id || (await DriveSync.createFolder(name, parent)).id;
  };

  // ---- file utils ----
  if (!DriveSync.findFileByName) DriveSync.findFileByName = async (name, parentId) => {
    const q = [
      "trashed=false",
      `name='${name.replace(/'/g,"\\'")}'`,
      `'${parentId}' in parents`
    ].join(' and ');
    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType,md5Checksum,size)&pageSize=1`;
    const j = await _gget(url);
    return j.files?.[0] || null;
  };

  if (!DriveSync.uploadFileMultipart) DriveSync.uploadFileMultipart = async (name, file, parentId, mime='application/pdf') => {
    const token = _getToken(); if (!token) throw new Error('No Drive token');
    const meta = { name, parents:[parentId], mimeType: mime };
    const boundary = 'END_OF_PART_7d29c1';

    const pre = [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify(meta),
      `--${boundary}`,
      `Content-Type: ${mime}`,
      '',
    ].join('\r\n');

    const post = `\r\n--${boundary}--`;
    const body = new Blob([pre, file, post], { type: 'multipart/related; boundary='+boundary });

    const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method:'POST', headers:{ Authorization:`Bearer ${token}` }, body
    });
    if (!r.ok) throw new Error('Drive upload failed');
    return r.json();
  };

  if (!DriveSync.fetchPdfBlob) DriveSync.fetchPdfBlob = async (fileId) => {
    const token = _getToken(); if (!token) throw new Error('No Drive token');
    const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
      headers:{ Authorization:`Bearer ${token}` }
    });
    if (!r.ok) throw new Error('Drive download failed');
    return r.blob();
  };

  // ---- IDEMPOTENT by sha256 ----
  if (!DriveSync.savePdfByHash) DriveSync.savePdfByHash = async (file, sha256) => {
    const folderId = await DriveSync.ensureSub('pdfs');
    const fname = `${sha256}.pdf`;
    const exist = await DriveSync.findFileByName(fname, folderId);
    if (exist) return { fileId: exist.id, name: fname, folderId, deduped:true };
    const up = await DriveSync.uploadFileMultipart(fname, file, folderId, file.type || 'application/pdf');
    return { fileId: up.id, name: fname, folderId, deduped:false };
  };

  // export helpers (in case not present)
  Object.assign(DriveSync, { _notifyAuth: _notifyAuth });
})();

  // ===== PUBLIC API =====
  window.DriveSync = Object.assign({}, window.DriveSync, {
    signIn, signOut, tryResume,
    isLogged: () => !!ACCESS_TOKEN,
    getProfile: async () => {
      if (!ACCESS_TOKEN) throw new Error('Belum login');
      if (cachedProfile) return cachedProfile;
      cachedProfile = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: authHeaders() }).then(r=>r.json());
      return cachedProfile;
    },
    ensureFolder: ensureRootFolder,
    uploadPdf,
    // JSON mirror:
    getJson, putJson,
    // Legacy:
    findByHashPrefix
  });

  // ===== Optional: wiring tombol connect kalau ada =====
  document.addEventListener('DOMContentLoaded', () => {
    setAuthUI(false);
    const btn = $('#btnConnectDrive');
    btn?.addEventListener('click', async () => {
      btn.disabled = true;
      try { await signIn(); }
      catch (e) { alert('Gagal connect Drive.\n' + (e?.message || e)); }
      finally { btn.disabled = false; }
    });
  });
})();
