/* drive-sync.js — Bribox Kanpus (2025-10-05)
 * Perbaikan:
 * - Anti double-load (guard)
 * - Scope lengkap (drive.file openid email profile)
 * - Token GIS disuntik ke gapi.client
 * - getProfile pakai OIDC userinfo
 * - Silent connect + fallback, error handling lebih jelas
 * - Console log ringkas (aktifkan via ?debug=1)
 */
;(() => {
  if (window.__DRIVESYNC_LOADED__) return;           // ⛔ cegah duplikat
  window.__DRIVESYNC_LOADED__ = true;

  const DEBUG = /[?&]debug=1\b/.test(location.search);
  const log = (...a) => { if (DEBUG) console.log('[DriveSync]', ...a); };

  // ====== CONFIG ======
  const CLIENT_ID = window.__CONFIG?.GOOGLE_CLIENT_ID || '';
  const API_KEY   = window.__CONFIG?.GOOGLE_API_KEY   || '';

  if (!CLIENT_ID || !API_KEY) {
    console.warn('[DriveSync] CLIENT_ID/API_KEY belum diisi. Pastikan config.local.js ada.');
  }

  // ====== CONSTANTS ======
  const ROOT_FOLDER_NAME = 'Bribox Kanpus';
  const SCOPES = [
    'https://www.googleapis.com/auth/drive.file',
    'openid', 'email', 'profile'
  ].join(' ');
  const DISCOVERY_DOCS = ['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest'];

  // ====== STATE ======
  let tokenClient = null;
  let accessToken = null;
  let rootFolderId = null;
  const subfolders = new Map();
  let cachedProfile = null;

  // ====== UTILS ======
  const $ = (s) => document.querySelector(s);

  function setAuthUI(logged, profile){
    const bar  = $('#driveConnectBar');
    const btnC = $('#btnConnectDrive');
    const who  = $('#whoami');
    if (bar)  bar.style.display = logged ? 'none' : '';
    if (btnC) btnC.disabled = false;
    if (who)  who.textContent = logged ? (profile?.email || profile?.name || 'Logged in') : '';
  }

  function ensureScriptsReady() {
    return new Promise((resolve, reject) => {
      let doneGapi = !!(window.gapi && gapi.load);
      let doneGIS  = !!(window.google?.accounts?.oauth2);
      const t = setInterval(() => {
        doneGapi = doneGapi || !!(window.gapi && gapi.load);
        doneGIS  = doneGIS  || !!(window.google?.accounts?.oauth2);
        if (doneGapi && doneGIS) { clearInterval(t); resolve(); }
      }, 30);
      setTimeout(() => { clearInterval(t); if (!doneGapi) return reject(new Error('gapi tidak siap')); if (!doneGIS) return reject(new Error('GIS tidak siap')); }, 8000);
    });
  }

  function initGapiClient(){
    return new Promise((resolve, reject) => {
      gapi.load('client', () => {
        gapi.client.init({ apiKey: API_KEY, discoveryDocs: DISCOVERY_DOCS })
          .then(resolve, reject);
      });
    });
  }

  function ensureTokenClient(){
    if (tokenClient) return tokenClient;
    if (!window.google?.accounts?.oauth2) throw new Error('GIS belum siap');
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPES,
      callback: () => {} // diisi untuk tiap request
    });
    return tokenClient;
  }

  function ensureInit(){
    if (!CLIENT_ID) throw new Error('Missing GOOGLE_CLIENT_ID');
    if (!API_KEY)   throw new Error('Missing GOOGLE_API_KEY');
    return ensureScriptsReady().then(initGapiClient).then(ensureTokenClient);
  }

  function afterToken(resp){
    if (!resp || resp.error || !resp.access_token) {
      const msg = resp?.error_description || resp?.error || 'Gagal mendapatkan access_token';
      throw new Error(msg);
    }
    accessToken = resp.access_token;
    gapi.client.setToken({ access_token: accessToken });   // 🔑 penting
    log('Token set ke gapi.client');
    return getProfile().catch(() => null).then(p => {
      cachedProfile = p || cachedProfile;
      setAuthUI(true, cachedProfile);
      return ensureRootFolder();
    });
  }

  async function signIn(){
    await ensureInit();
    return new Promise((resolve, reject) => {
      try {
        tokenClient.callback = (resp) => {
          afterToken(resp).then(() => resolve(resp)).catch(reject);
        };
        tokenClient.requestAccessToken({ prompt: 'consent' });
      } catch (e) { reject(e); }
    });
  }

  async function signInSilent(){
    await ensureInit();
    return new Promise((resolve, reject) => {
      try {
        tokenClient.callback = (resp) => {
          afterToken(resp).then(() => resolve(resp)).catch(reject);
        };
        tokenClient.requestAccessToken({ prompt: 'none' });
      } catch (e) { reject(e); }
    });
  }

  function signOut(){
    try { if (accessToken) google.accounts.oauth2.revoke(accessToken); } catch(e){}
    accessToken = null;
    cachedProfile = null;
    gapi.client.setToken(null);
    rootFolderId = null;
    subfolders.clear();
    setAuthUI(false);
  }

  function assertLogged(){
    if (!accessToken) throw new Error('Belum login Google Drive.');
  }

  // Pakai OIDC userinfo (bukan oauth2/v1)
  async function getProfile(){
    assertLogged();
    if (cachedProfile) return cachedProfile;
    const res = await gapi.client.request({ path: 'https://openidconnect.googleapis.com/v1/userinfo' });
    cachedProfile = res.result || null;
    return cachedProfile;
  }

  // ====== DRIVE HELPERS ======
  async function queryDrive(q, fields){
    assertLogged();
    const f = fields || 'files(id,name,mimeType,parents,createdTime,modifiedTime,size)';
    const res = await gapi.client.drive.files.list({
      q, spaces: 'drive', pageSize: 1000, fields: 'files(' + f + ')'
    });
    return res.result.files || [];
  }

  async function ensureRootFolder(){
    if (rootFolderId) return rootFolderId;
    const esc = ROOT_FOLDER_NAME.replace(/'/g, "\\'");
    const list = await queryDrive(`name='${esc}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
    if (list.length) { rootFolderId = list[0].id; return rootFolderId; }
    const res = await gapi.client.drive.files.create({
      resource: { name: ROOT_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' },
      fields: 'id'
    });
    rootFolderId = res.result.id;
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
    const res = await gapi.client.drive.files.create({
      resource: { name: mod, parents: [parent], mimeType: 'application/vnd.google-apps.folder' },
      fields: 'id'
    });
    subfolders.set(mod, res.result.id);
    return res.result.id;
  }

  async function uploadPdf(file, contentHash, moduleName){
    assertLogged();
    if (!file || file.type !== 'application/pdf') throw new Error('Bukan PDF');
    const parent = await ensureSubfolder(moduleName);
    const safeName = (contentHash || Date.now()) + '__' + file.name.replace(/[^\w.\- ()]/g, '_');

    const metadata = { name: safeName, mimeType: 'application/pdf', parents: [parent] };
    const boundary = '-------314159265358979323846';
    const delimiter  = '\r\n--' + boundary + '\r\n';
    const closeDelim = '\r\n--' + boundary + '--';
    const metaPart = delimiter + 'Content-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(metadata);

    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = ''; const chunk = 0x8000;
    for (let i=0;i<bytes.length;i+=chunk){ binary += String.fromCharCode.apply(null, bytes.subarray(i, i+chunk)); }
    const base64Data = btoa(binary);
    const filePart = delimiter + 'Content-Type: application/pdf\r\nContent-Transfer-Encoding: base64\r\n\r\n' + base64Data;
    const body = metaPart + filePart + closeDelim;

    const res = await gapi.client.request({
      path: '/upload/drive/v3/files',
      method: 'POST',
      params: { uploadType: 'multipart' },
      headers: { 'Content-Type': 'multipart/related; boundary=' + boundary },
      body
    });
    return { id: res.result.id, name: safeName };
  }

  async function findByHashPrefix(hash, moduleName){
    assertLogged();
    const parent = await ensureSubfolder(moduleName);
    const esc = String(hash || '').replace(/'/g, "\\'");
    const files = await queryDrive(`'${parent}' in parents and trashed=false and name contains '${esc}'`);
    const prefix = String(hash || '') + '__';
    return files.find(f => (f.name || '').indexOf(prefix) === 0) || null;
  }

  // ====== PUBLIC API ======
  window.DriveSync = {
    signIn, signInSilent, signOut,
    isLogged: () => !!accessToken,
    getProfile,
    ensureFolder: ensureRootFolder,
    uploadPdf,
    findByHashPrefix
  };

  // Auto-wire tombol + silent connect
  document.addEventListener('DOMContentLoaded', async () => {
    setAuthUI(false);
    const btn = $('#btnConnectDrive');
    if (btn) {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try { await signIn(); }
        catch (e){ alert('Gagal connect Drive.\n' + (e?.message || e)); }
        finally { btn.disabled = false; }
      });
    }
    try { await signInSilent(); } catch { /* biarkan bar tampil */ }
  });
})();
