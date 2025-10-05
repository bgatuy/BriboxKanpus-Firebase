/* drive-sync.js — Pure OAuth + Fetch (tanpa gapi) */
;(() => {
  if (window.__DRIVESYNC_LOADED__) return;
  window.__DRIVESYNC_LOADED__ = true;

  // ===== CONFIG =====
  const CLIENT_ID = window.__CONFIG?.GOOGLE_CLIENT_ID || '';
  if (!CLIENT_ID) console.warn('[DriveSync] GOOGLE_CLIENT_ID kosong di window.__CONFIG');

  const OAUTH_SCOPE = [
    'https://www.googleapis.com/auth/drive.file',
    'openid', 'email', 'profile'
  ].join(' ');
  const OAUTH_REDIRECT = location.origin + '/oauth-return.html';
  const ROOT_FOLDER_NAME = 'Bribox Kanpus';

  // ===== STATE =====
  let ACCESS_TOKEN = null;
  let rootFolderId = null;
  const subfolders = new Map();
  let cachedProfile = null;

  // ===== Persist token per-tab =====
  const STORE_KEY = 'GDRV_AT';
  const STORE_EXP = 'GDRV_EXP';

  function saveToken(token, expiresInSec) {
    try {
      const expAt = Date.now() + ((expiresInSec || 3600) * 1000);
      sessionStorage.setItem(STORE_KEY, token);
      sessionStorage.setItem(STORE_EXP, String(expAt));
    } catch (_) {}
  }
  function loadTokenIfValid() {
    try {
      const t = sessionStorage.getItem(STORE_KEY);
      const exp = parseInt(sessionStorage.getItem(STORE_EXP) || '0', 10);
      if (!t || !exp || Date.now() > exp) return null;
      return t;
    } catch(_) { return null; }
  }
  async function tryResume() {
    const t = loadTokenIfValid();
    if (!t) return false;
    ACCESS_TOKEN = t;
    try { await afterLogin(); return true; }
    catch { ACCESS_TOKEN = null; return false; }
  }

  // ===== UI helpers =====
  const $ = s => document.querySelector(s);
  function setAuthUI(logged, profile){
    const bar  = $('#driveConnectBar');
    const btn  = $('#btnConnectDrive');
    const who  = $('#whoami');
    if (bar)  bar.style.display = logged ? 'none' : '';
    if (btn)  btn.disabled = false;
    if (who)  who.textContent = logged ? (profile?.email || profile?.name || 'Logged in') : '';
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
    const dualScreenLeft = window.screenLeft !== undefined ? window.screenLeft : window.screenX;
    const dualScreenTop  = window.screenTop  !== undefined ? window.screenTop  : window.screenY;
    const width  = window.innerWidth  || document.documentElement.clientWidth  || screen.width;
    const height = window.innerHeight || document.documentElement.clientHeight || screen.height;
    const left = ((width - w) / 2) + dualScreenLeft;
    const top  = ((height - h) / 2) + dualScreenTop;
    const features = `scrollbars=yes,resizable=yes,width=${w},height=${h},top=${top},left=${left}`;
    return window.open(url, title, features);
  }

  async function signIn(){
    // 1) Flow "redirect penuh" — oauth-return sudah menyimpan GDRV_AT & GDRV_EXP.
    const pending = sessionStorage.getItem('GDRV_AT');
    if (pending) {
      sessionStorage.removeItem('GDRV_AT');
      ACCESS_TOKEN = pending;
      await afterLogin();
      return;
    }
    // 2) Popup flow
    return new Promise((resolve, reject) => {
      const url = buildAuthUrl(location.href);
      const pop = openCenteredPopup(url, 'Google Login');
      if (!pop) { // popup diblok → pakai redirect penuh
        location.assign(url);
        reject(new Error('Popup diblok; melakukan redirect.'));
        return;
      }
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
          if (!ACCESS_TOKEN) { reject(new Error('No access_token from OAuth.')); return; }
          // simpan token + expiry untuk auto-resume halaman lain
          saveToken(ACCESS_TOKEN, Number(ev.data.expires_in || 3600));
          afterLogin().then(resolve).catch(reject);
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
      ACCESS_TOKEN = null; cachedProfile = null;
      rootFolderId = null; subfolders.clear();
      try {
        sessionStorage.removeItem(STORE_KEY);
        sessionStorage.removeItem(STORE_EXP);
      } catch(_) {}
      setAuthUI(false);
    }
  }

  // ===== Fetch helpers =====
  function authHeaders(extra){
    if (!ACCESS_TOKEN) throw new Error('Belum login Google Drive.');
    return Object.assign({ 'Authorization': 'Bearer ' + ACCESS_TOKEN }, extra || {});
  }
  async function httpJSON(url, opts){
    const res = await fetch(url, Object.assign({ headers: authHeaders({ 'Accept': 'application/json' }) }, opts));
    if (!res.ok) {
      const txt = await res.text().catch(()=>res.statusText);
      throw new Error(`HTTP ${res.status}: ${txt}`);
    }
    return res.json();
  }

  // ===== Setelah login: ambil profile & pastikan root folder =====
  async function afterLogin(){
    try {
      const prof = await httpJSON('https://openidconnect.googleapis.com/v1/userinfo');
      cachedProfile = prof;
    } catch(e){
      console.warn('userinfo error:', e);
      cachedProfile = null;
    }
    setAuthUI(true, cachedProfile);
    await ensureRootFolder();
  }

  // ===== Drive ops (REST) =====
  async function queryDrive(q, fields){
    const p = new URLSearchParams({
      q, spaces: 'drive', pageSize: '1000',
      fields: 'files(' + (fields || 'id,name,mimeType,parents,createdTime,modifiedTime,size') + ')'
    });
    const url = 'https://www.googleapis.com/drive/v3/files?' + p.toString();
    const res = await fetch(url, { headers: authHeaders() });
    if (!res.ok) throw new Error('Drive list failed: ' + res.status);
    const data = await res.json();
    return data.files || [];
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
    const data = await res.json();
    rootFolderId = data.id;
    return rootFolderId;
  }

  async function ensureSubfolder(mod){
    mod = String(mod || '').trim();
    if (!mod) return ensureRootFolder();
    if (subfolders.has(mod)) return subfolders.get(mod);
    const parent = await ensureRootFolder();
    const esc = mod.replace(/'/g, "\\'");
    const list = await queryDrive(`'${parent}' in parents and trashed=false and mimeType='application/vnd.google-apps.folder' and name='${esc}'`);
    if (list.length){ subfolders.set(mod, list[0].id); return list[0].id; }
    const res = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ name: mod, parents: [parent], mimeType: 'application/vnd.google-apps.folder' })
    });
    if (!res.ok) throw new Error('Create subfolder failed: ' + res.status);
    const data = await res.json();
    subfolders.set(mod, data.id);
    return data.id;
  }

  async function uploadPdf(file, contentHash, moduleName){
    if (!file || file.type !== 'application/pdf') throw new Error('Bukan PDF');
    const parent = await ensureSubfolder(moduleName);
    const safeName = (contentHash || Date.now()) + '__' + file.name.replace(/[^\w.\- ()]/g, '_');
    const metadata = { name: safeName, mimeType: 'application/pdf', parents: [parent] };

    const boundary = '-------314159265358979323846';
    const delimiter = '\r\n--' + boundary + '\r\n';
    const closeDelim = '\r\n--' + boundary + '--';
    const metaPart = delimiter + 'Content-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(metadata);

    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let bin=''; const chunk=0x8000;
    for (let i=0;i<bytes.length;i+=chunk){ bin += String.fromCharCode.apply(null, bytes.subarray(i,i+chunk)); }
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

  async function findByHashPrefix(hash, moduleName){
    const parent = await ensureSubfolder(moduleName);
    const esc = String(hash || '').replace(/'/g, "\\'");
    const files = await queryDrive(`'${parent}' in parents and trashed=false and name contains '${esc}'`);
    const prefix = String(hash || '') + '__';
    return files.find(f => (f.name || '').startsWith(prefix)) || null;
  }

  // ===== PUBLIC API (sertakan tryResume agar tidak ter-overwrite) =====
  window.DriveSync = Object.assign({}, window.DriveSync, {
    signIn, signOut, tryResume,
    isLogged: () => !!ACCESS_TOKEN,
    getProfile: async () => {
      if (!ACCESS_TOKEN) throw new Error('Belum login');
      if (cachedProfile) return cachedProfile;
      const prof = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: authHeaders() }).then(r=>r.json());
      cachedProfile = prof; return prof;
    },
    ensureFolder: ensureRootFolder,
    uploadPdf, findByHashPrefix
  });

  // ===== Wire tombol Connect (lib ini tidak urus banner UI) =====
  document.addEventListener('DOMContentLoaded', () => {
    setAuthUI(false);
    const btn = $('#btnConnectDrive');
    if (btn) {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try { await signIn(); }
        catch (e) { alert('Gagal connect Drive.\n' + (e?.message || e)); }
        finally { btn.disabled = false; }
      });
    }
    // Auto-resume cukup dipanggil dari halaman (DriveSync.tryResume())
    // Tidak perlu cek GDRV_AT lagi di sini.
  });
})();
