/* drive-sync.js — Pure OAuth + Fetch (tanpa gapi) */
(() => {
  if (window.__DRIVESYNC_LOADED__) return;
  window.__DRIVESYNC_LOADED__ = true;

  // siapkan namespace global
  window.DriveSync = window.DriveSync || {};
  const DS = window.DriveSync; // alias lokal

  // ========= CONFIG =========
  const CLIENT_ID = window.__CONFIG?.GOOGLE_CLIENT_ID || '';
  if (!CLIENT_ID) console.warn('[DriveSync] GOOGLE_CLIENT_ID kosong di window.__CONFIG');

  const OAUTH_SCOPE = [
    'https://www.googleapis.com/auth/drive.file', // akses file yang dibuat via app ini
    'openid', 'email', 'profile'
  ].join(' ');

  // oauth-return.html harus kirim postMessage { type:'GDRV_TOKEN', access_token, expires_in }
  const OAUTH_REDIRECT = new URL('oauth-return.html', location.href).href;
  const ROOT_FOLDER_NAME = 'Bribox Kanpus';

  // ========= STATE =========
  let ACCESS_TOKEN  = null;
  let rootFolderId  = null;
  let cachedProfile = null;

  // ========= Token per-tab =========
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

  // ========= Cross-page sync =========
  const bc = ('BroadcastChannel' in window) ? new BroadcastChannel('bribox-drive') : null;
  const broadcast = (status) => { try { bc?.postMessage({ type:'drive-auth', status }); } catch {} };

  // ========= UI helper (opsional) =========
  const $ = (s) => document.querySelector(s);
  function setAuthUI(logged, profile) {
    const bar  = $('#driveConnectBar');
    const btn  = $('#btnConnectDrive');
    const who  = $('#whoami');
    if (bar) bar.style.display = logged ? 'none' : '';
    if (btn) btn.disabled = false;
    if (who) who.textContent = logged ? (profile?.email || profile?.name || 'Logged in') : '';
  }

  // ========= Auth state listeners =========
  const _authListeners = new Set();
  function _notifyAuth() { for (const f of _authListeners) try { f(!!ACCESS_TOKEN); } catch {} }

  // ========= OAUTH (Implicit) =========
  function buildAuthUrl(stateUrl) {
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

  function openCenteredPopup(url, title, w = 520, h = 620) {
    const dualLeft = (window.screenLeft ?? window.screenX);
    theTop  = (window.screenTop  ?? window.screenY);
    const width  = window.innerWidth  || document.documentElement.clientWidth  || screen.width;
    const height = window.innerHeight || document.documentElement.clientHeight || screen.height;
    const left = ((width - w) / 2) + dualLeft;
    const top  = ((height - h) / 2) + theTop;
    return window.open(url, title, `scrollbars=yes,resizable=yes,width=${w},height=${h},top=${top},left=${left}`);
  }

  async function afterLogin() {
    try { cachedProfile = await httpJSON('https://openidconnect.googleapis.com/v1/userinfo'); }
    catch (e) { console.warn('[DriveSync] userinfo error:', e); cachedProfile = null; }
    setAuthUI(true, cachedProfile);
    await ensureRootFolder();
  }

  async function signIn() {
    // jika oauth-return sudah menitip token di sessionStorage
    const fromReturn = sessionStorage.getItem(STORE_KEY);
    if (fromReturn) {
      sessionStorage.removeItem(STORE_KEY);
      ACCESS_TOKEN = fromReturn;
      await afterLogin();
      broadcast('in'); _notifyAuth();
      return;
    }

    // popup
    return new Promise((resolve, reject) => {
      const url = buildAuthUrl(location.href);
      const pop = openCenteredPopup(url, 'Google Login');
      if (!pop) { location.assign(url); return reject(new Error('Popup diblok; redirect.')); }

      const timer = setInterval(() => {
        if (pop.closed) { clearInterval(timer); reject(new Error('Popup ditutup sebelum login.')); }
      }, 400);

      function onMsg(ev) {
        try {
          if (typeof ev.data !== 'object' || ev.data?.type !== 'GDRV_TOKEN') return;
          window.removeEventListener('message', onMsg);
          clearInterval(timer);
          pop.close();

          ACCESS_TOKEN = ev.data.access_token || null;
          if (!ACCESS_TOKEN) return reject(new Error('No access_token from OAuth.'));
          saveToken(ACCESS_TOKEN, Number(ev.data.expires_in || 3600));

          afterLogin()
            .then(() => { broadcast('in'); _notifyAuth(); resolve(); })
            .catch(reject);
        } catch (e) { clearInterval(timer); reject(e); }
      }
      window.addEventListener('message', onMsg);
    });
  }

  async function signOut() {
    try {
      if (ACCESS_TOKEN) {
        await fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(ACCESS_TOKEN), {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        }).catch(() => {});
      }
    } finally {
      ACCESS_TOKEN = null; cachedProfile = null; rootFolderId = null;
      try { sessionStorage.removeItem(STORE_KEY); sessionStorage.removeItem(STORE_EXP); } catch {}
      setAuthUI(false); broadcast('out'); _notifyAuth();
    }
  }

  async function tryResume() {
    const t = loadTokenIfValid();
    if (!t) return false;
    ACCESS_TOKEN = t;
    try { await afterLogin(); broadcast('in'); _notifyAuth(); return true; }
    catch { ACCESS_TOKEN = null; return false; }
  }

  // ========= Fetch helpers =========
  const authHeaders = (extra) => {
    if (!ACCESS_TOKEN) throw new Error('Belum login Google Drive.');
    return Object.assign({ 'Authorization': 'Bearer ' + ACCESS_TOKEN }, extra || {});
  };
  async function httpJSON(url, opts) {
    const res = await fetch(url, Object.assign({ headers: authHeaders({ 'Accept': 'application/json' }) }, opts));
    if (!res.ok) {
      const txt = await res.text().catch(() => res.statusText);
      throw new Error(`HTTP ${res.status}: ${txt}`);
    }
    return res.json();
  }

  // ========= Drive ops (list/query/folder) =========
  async function queryDrive(q, fields) {
    const p = new URLSearchParams({
      q, spaces: 'drive', pageSize: '1000',
      fields: 'files(' + (fields || 'id,name,mimeType,parents,createdTime,modifiedTime,size,appProperties') + ')'
    });
    const url = 'https://www.googleapis.com/drive/v3/files?' + p.toString();
    const res = await fetch(url, { headers: authHeaders() });
    if (!res.ok) throw new Error('Drive list failed: ' + res.status);
    return (await res.json()).files || [];
  }

  async function ensureRootFolder() {
    if (rootFolderId) return rootFolderId;
    const esc = ROOT_FOLDER_NAME.replace(/'/g, "\\'");
    const list = await queryDrive(`name='${esc}' and mimeType='application/vnd.google-apps.folder' and trashed=false`, 'id,name');
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

  // ========= JSON helpers (mirror lintas device) =========
  async function findFileInRootByName(name) {
    const parent = await ensureRootFolder();
    const esc = String(name).replace(/'/g, "\\'");
    const list = await queryDrive(`'${parent}' in parents and trashed=false and name='${esc}'`, 'id,name');
    return list[0] || null;
  }
  async function downloadFileText(fileId) {
    const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
    const res = await fetch(url, { headers: authHeaders() });
    if (!res.ok) throw new Error('Download failed: ' + res.status);
    return await res.text();
  }
  async function createJsonInRoot(name, text) {
    const parent = await ensureRootFolder();
    const boundary = '-------314159265358979323846';
    const delimiter = '\r\n--' + boundary + '\r\n';
    const close = '\r\n--' + boundary + '--';
    const metaPart = delimiter + 'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify({ name, mimeType: 'application/json', parents: [parent] });
    const dataPart = delimiter + 'Content-Type: application/json\r\n\r\n' + (text ?? '{}');
    const body = metaPart + dataPart + close;

    const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'multipart/related; boundary=' + boundary }),
      body
    });
    if (!res.ok) throw new Error('Create JSON failed: ' + res.status);
    return (await res.json()).id;
  }
  async function updateFileText(fileId, text, mime = 'application/json') {
    const res = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
      method: 'PATCH',
      headers: authHeaders({ 'Content-Type': mime }),
      body: text ?? ''
    });
    if (!res.ok) throw new Error('Update JSON failed: ' + res.status);
    return true;
  }
  async function getJson(name) {
    const f = await findFileInRootByName(name);
    if (!f) return null;
    const txt = await downloadFileText(f.id).catch(() => 'null');
    let data = null; try { data = JSON.parse(txt); } catch {}
    return { id: f.id, data };
  }
  async function putJson(name, obj) {
    const txt = JSON.stringify(obj ?? {}, null, 0);
    const f = await findFileInRootByName(name);
    if (f) { await updateFileText(f.id, txt); return { id: f.id }; }
    const id = await createJsonInRoot(name, txt);
    return { id };
  }

  // ========= Subfolder & file utils (idempoten PDF by sha256) =========
  const __subCache = new Map();
  async function ensureSub(subName) {
    if (__subCache.has(subName)) return __subCache.get(subName);
    const parent = await ensureRootFolder();
    const esc = String(subName).replace(/'/g, "\\'");
    const list = await queryDrive(
      `'${parent}' in parents and trashed=false and mimeType='application/vnd.google-apps.folder' and name='${esc}'`,
      'id,name'
    );
    if (list.length) { __subCache.set(subName, list[0].id); return list[0].id; }
    const res = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ name: subName, mimeType: 'application/vnd.google-apps.folder', parents: [parent] })
    });
    if (!res.ok) throw new Error('Create subfolder failed: ' + res.status);
    const id = (await res.json()).id;
    __subCache.set(subName, id);
    return id;
  }

  async function findFileByName(name, parentId) {
    const esc = String(name).replace(/'/g, "\\'");
    const list = await queryDrive(`'${parentId}' in parents and trashed=false and name='${esc}'`, 'id,name,mimeType,md5Checksum,size,appProperties');
    return list[0] || null;
  }

  // ==== Resumable upload (2-step) untuk PDF ====
  async function driveResumableUpload(file, metadata, accessToken) {
    // 1) init session
    const init = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': file.type || 'application/pdf'
        },
        body: JSON.stringify(metadata)
      }
    );
    if (!init.ok) {
      const msg = await init.text().catch(() => init.statusText);
      throw new Error(`Init resumable failed: ${init.status} ${msg}`);
    }
    const uploadUrl = init.headers.get('location');
    if (!uploadUrl) throw new Error('No resumable Location header');

    // 2) upload body
    const up = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': file.type || 'application/pdf'
      },
      body: file
    });
    if (!up.ok) {
      const msg = await up.text().catch(() => up.statusText);
      throw new Error(`Upload failed: ${up.status} ${msg}`);
    }
    return up.json();
  }

  // multipart uploader (tetap dipakai untuk JSON/keperluan lain)
  async function uploadFileMultipart(name, file, parentId, mime = 'application/pdf', metaExtra) {
    const meta = Object.assign({ name, parents: [parentId], mimeType: mime }, metaExtra || {});
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
    const body = new Blob([pre, file, post], { type: 'multipart/related; boundary=' + boundary });

    const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      headers: authHeaders(),
      body
    });
    if (!r.ok) throw new Error('Drive upload failed');
    return r.json();
  }

  async function fetchPdfBlob(fileId) {
    const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
      headers: authHeaders()
    });
    if (!r.ok) throw new Error('Drive download failed');
    return r.blob();
  }

  /** Simpan PDF idempoten: /Bribox Kanpus/pdfs/<sha256>.pdf */
  async function savePdfByHash(file, sha256) {
    const folderId = await ensureSub('pdfs');
    const fname = `${sha256}.pdf`;
    const exist = await findFileByName(fname, folderId);
    const uid = (window.Auth?.getUid?.() || 'anon');

    if (exist) {
      // update katalog lokal per-akun
      try {
        const k = `PdfCatalog__${uid}`;
        const cat = JSON.parse(localStorage.getItem(k) || '{}');
        cat[sha256] = { id: exist.id, name: fname };
        localStorage.setItem(k, JSON.stringify(cat));
      } catch {}
      return { fileId: exist.id, name: fname, folderId, deduped: true };
    }

    // === Upload pakai Resumable ===
    const token = DS._getAccessToken?.() || DS.getAccessToken?.();
    if (!token) throw new Error('Belum login Google Drive.');

    const up = await driveResumableUpload(
      file,
      {
        name: fname,
        parents: [folderId],
        description: 'Bribox Kanpus - original',
        appProperties: { contentHash: sha256, module: 'trackmate', uid }
      },
      token
    );

    // simpan katalog lokal per-akun
    try {
      const k = `PdfCatalog__${uid}`;
      const cat = JSON.parse(localStorage.getItem(k) || '{}');
      cat[sha256] = { id: up.id, name: fname };
      localStorage.setItem(k, JSON.stringify(cat));
    } catch {}

    // debug
    console.log('[Drive] savePdfByHash OK (resumable):', { fileId: up.id, deduped: false, hash: sha256 });

    return { fileId: up.id, name: fname, folderId, deduped: false };
  }

  /** Resolve Drive fileId dari hash:
   *  1) cek katalog lokal per-akun
   *  2) cek di /pdfs by exact name "<hash>.pdf"
   *  3) fallback: query appProperties (kalau ada)
   */
  async function getFileIdByHash(sha256) {
    const uid = (window.Auth?.getUid?.() || 'anon');
    // 1) lokal
    try {
      const k = `PdfCatalog__${uid}`;
      const cat = JSON.parse(localStorage.getItem(k) || '{}');
      if (cat[sha256]?.id) return cat[sha256].id;
    } catch {}

    // 2) /pdfs by name
    try {
      const folderId = await ensureSub('pdfs');
      const fname = `${sha256}.pdf`;
      const exist = await findFileByName(fname, folderId);
      if (exist?.id) return exist.id;
    } catch {}

    // 3) appProperties
    try {
      const q = `appProperties has { key='contentHash' and value='${sha256}' } and trashed=false`;
      const hit = (await queryDrive(q, 'id,name,appProperties'))[0];
      if (hit?.id) return hit.id;
    } catch {}

    return null;
  }

  // ======== PUBLIC API ========
  window.DriveSync = Object.assign(window.DriveSync || {}, {
    signIn, signOut, tryResume,
    isLogged: () => !!ACCESS_TOKEN,

    // helper akses token (compat lama)
    getAccessToken: () => ACCESS_TOKEN,
    _getAccessToken: () => ACCESS_TOKEN,

    onAuthStateChanged: (cb) => { if (typeof cb === 'function') _authListeners.add(cb); },

    // profil
    getProfile: async () => {
      if (!ACCESS_TOKEN) throw new Error('Belum login');
      if (cachedProfile) return cachedProfile;
      cachedProfile = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
        headers: { Authorization: 'Bearer ' + ACCESS_TOKEN }
      }).then(r => r.json());
      return cachedProfile;
    },

    // folders & files
    ensureFolder: ensureRootFolder,
    ensureSub, findFileByName,
    savePdfByHash, getFileIdByHash, fetchPdfBlob, uploadFileMultipart,

    // JSON mirror
    getJson, putJson,
  });

  // ========= Optional: wiring tombol connect =========
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
