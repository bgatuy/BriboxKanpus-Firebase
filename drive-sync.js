/* drive-sync.js — Pure OAuth + Fetch (tanpa gapi) */
(() => {
  if (window.__DRIVESYNC_LOADED__) return;
  window.__DRIVESYNC_LOADED__ = true;

  // ===== Namespace =====
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

  // ========= IMPROVED TOKEN MANAGEMENT =========
  const STORE_KEY = 'GDRV_AT';
  const STORE_EXP = 'GDRV_EXP';
  const STORE_REFRESH = 'GDRV_RT'; // Untuk future refresh token support
  
  function saveToken(token, expiresInSec) {
    try {
      const expAt = Date.now() + ((expiresInSec || 3600) * 1000);
      sessionStorage.setItem(STORE_KEY, token);
      sessionStorage.setItem(STORE_EXP, String(expAt));
    } catch (e) {
      console.warn('[DriveSync] Gagal save token:', e);
    }
  }
  
  function loadTokenIfValid() {
    try {
      const t = sessionStorage.getItem(STORE_KEY);
      const exp = parseInt(sessionStorage.getItem(STORE_EXP) || '0', 10);
      
      // Beri buffer 5 menit sebelum expiry
      if (!t || !exp || Date.now() > (exp - 300000)) {
        // Token expired atau hampir expired, clear
        clearToken();
        return null;
      }
      return t;
    } catch (e) {
      console.warn('[DriveSync] Gagal load token:', e);
      return null;
    }
  }
  
  function clearToken() {
    try {
      sessionStorage.removeItem(STORE_KEY);
      sessionStorage.removeItem(STORE_EXP);
      sessionStorage.removeItem(STORE_REFRESH);
      ACCESS_TOKEN = null;
    } catch (e) {
      console.warn('[DriveSync] Gagal clear token:', e);
    }
  }

  // ========= IMPROVED ERROR HANDLING & RETRY =========
  async function withRetry(operation, maxRetries = 3, baseDelay = 1000) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        const isLastAttempt = attempt === maxRetries - 1;
        
        // Jangan retry untuk auth errors
        if (error?.message?.includes('401') || error?.message?.includes('login')) {
          throw error;
        }
        
        if (isLastAttempt) {
          console.warn(`[DriveSync] Operation failed after ${maxRetries} attempts:`, error);
          throw error;
        }
        
        // Exponential backoff dengan jitter
        const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
        console.warn(`[DriveSync] Attempt ${attempt + 1} failed, retrying in ${delay}ms:`, error);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  // ========= Cross-page sync =========
  const bc = ('BroadcastChannel' in window) ? new BroadcastChannel('bribox-drive') : null;
  const broadcast = (status) => { 
    try { 
      bc?.postMessage({ type:'drive-auth', status }); 
      console.log(`[DriveSync] Broadcast: ${status}`);
    } catch (e) {
      console.warn('[DriveSync] Gagal broadcast:', e);
    }
  };

  // ========= UI helper (opsional) =========
  const $ = (s) => document.querySelector(s);
  function setAuthUI(logged, profile) {
    const bar  = $('#driveConnectBar');
    const btn  = $('#btnConnectDrive');
    const who  = $('#whoami');
    if (bar) bar.style.display = logged ? 'none' : '';
    if (btn) {
      btn.disabled = false;
      btn.textContent = logged ? 'Connected' : 'Connect Google Drive';
    }
    if (who) who.textContent = logged ? (profile?.email || profile?.name || 'Logged in') : '';
  }

  // ========= Auth state listeners =========
  const _authListeners = new Set();
  function _notifyAuth() { 
    for (const f of _authListeners) {
      try { 
        f(!!ACCESS_TOKEN); 
      } catch (e) {
        console.warn('[DriveSync] Auth listener error:', e);
      }
    }
  }

  // ========= IMPROVED OAUTH (Implicit) =========
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
    const dualLeft = (window.screenLeft ?? window.screenX ?? 0);
    const dualTop  = (window.screenTop  ?? window.screenY ?? 0);
    const width  = window.innerWidth  || document.documentElement.clientWidth  || screen.width;
    const height = window.innerHeight || document.documentElement.clientHeight || screen.height;
    const left = ((width - w) / 2) + dualLeft;
    const top  = ((height - h) / 2) + dualTop;
    const feat = `scrollbars=yes,resizable=yes,width=${w},height=${h},top=${Math.max(0,top)},left=${Math.max(0,left)}`;
    
    const popup = window.open(url, title, feat);
    if (!popup) {
      throw new Error('Popup diblokir. Izinkan popup untuk website ini.');
    }
    return popup;
  }

  async function afterLogin() {
    try { 
      cachedProfile = await withRetry(() => 
        httpJSON('https://openidconnect.googleapis.com/v1/userinfo')
      );
    } catch (e) { 
      console.warn('[DriveSync] userinfo error:', e); 
      cachedProfile = null; 
    }
    setAuthUI(true, cachedProfile);
    
    try {
      await withRetry(() => ensureRootFolder());
    } catch (e) {
      console.warn('[DriveSync] Gagal ensure root folder:', e);
    }
  }

  async function signIn() {
    // Fallback same-tab (jika alur login tidak via popup)
    const resumed = loadTokenIfValid();
    if (resumed) {
      ACCESS_TOKEN = resumed;
      await afterLogin();
      broadcast('in'); 
      _notifyAuth();
      return;
    }

    // Popup + postMessage
    await new Promise((resolve, reject) => {
      const url = buildAuthUrl(location.href);
      const pop = openCenteredPopup(url, 'Google Login');
      if (!pop) { 
        location.assign(url); 
        return reject(new Error('Popup diblokir. Redirect ke Google.')); 
      }

      const timer = setInterval(() => {
        if (pop.closed) { 
          clearInterval(timer); 
          reject(new Error('Popup ditutup sebelum login.')); 
        }
      }, 400);

      function onMsg(ev) {
        try {
          if (typeof ev.data !== 'object' || ev.data?.type !== 'GDRV_TOKEN') return;
          window.removeEventListener('message', onMsg);
          clearInterval(timer);
          try { pop.close(); } catch {}

          const tok = ev.data.access_token || null;
          const exp = Number(ev.data.expires_in || 3600);
          if (!tok) return reject(new Error('No access_token from OAuth.'));
          ACCESS_TOKEN = tok;
          saveToken(tok, exp);

          afterLogin()
            .then(() => { broadcast('in'); _notifyAuth(); resolve(); })
            .catch(reject);
        } catch (e) { 
          clearInterval(timer); 
          reject(e); 
        }
      }
      window.addEventListener('message', onMsg);
    });
  }

  async function signOut() {
    try {
      if (ACCESS_TOKEN) {
        // Coba revoke token (non-blocking)
        fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(ACCESS_TOKEN), {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        }).catch(() => {});
      }
    } catch (e) {
      console.warn('[DriveSync] Gagal revoke token:', e);
    } finally {
      ACCESS_TOKEN = null; 
      cachedProfile = null; 
      rootFolderId = null;
      clearToken();
      setAuthUI(false); 
      broadcast('out'); 
      _notifyAuth();
    }
  }

  async function tryResume() {
    try {
      const t = loadTokenIfValid();
      if (!t) return false;
      
      ACCESS_TOKEN = t;
      
      // Timeout untuk prevent hanging
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Resume timeout')), 10000)
      );

      await Promise.race([afterLogin(), timeoutPromise]);
      broadcast('in'); 
      _notifyAuth(); 
      return true;
    } catch (error) {
      console.warn('[DriveSync] Resume failed:', error);
      ACCESS_TOKEN = null;
      clearToken();
      return false;
    }
  }

  // ========= IMPROVED Fetch helpers =========
  const authHeaders = (extra) => {
    if (!ACCESS_TOKEN) throw new Error('Belum login Google Drive.');
    return Object.assign({ 'Authorization': 'Bearer ' + ACCESS_TOKEN }, extra || {});
  };
  
  async function httpJSON(url, opts) {
    const response = await withRetry(async () => {
      const res = await fetch(url, Object.assign({ 
        headers: authHeaders({ 'Accept': 'application/json' }) 
      }, opts));
      
      if (!res.ok) {
        const txt = await res.text().catch(() => res.statusText);
        const error = new Error(`HTTP ${res.status}: ${txt}`);
        
        // Auto-signout untuk auth errors
        if (res.status === 401 || res.status === 403) {
          console.warn('[DriveSync] Auth error, signing out...');
          await signOut();
        }
        
        throw error;
      }
      return res;
    });
    
    return response.json();
  }

  // ========= IMPROVED Drive ops =========
  async function queryDrive(q, fields) {
    const p = new URLSearchParams({
      q, 
      spaces: 'drive', 
      pageSize: '1000',
      fields: 'files(' + (fields || 'id,name,mimeType,parents,createdTime,modifiedTime,size,appProperties') + ')'
    });
    const url = 'https://www.googleapis.com/drive/v3/files?' + p.toString();
    
    return await withRetry(async () => {
      const res = await fetch(url, { headers: authHeaders() });
      if (!res.ok) throw new Error('Drive list failed: ' + res.status);
      const data = await res.json();
      return data.files || [];
    });
  }

  async function ensureRootFolder() {
    if (rootFolderId) return rootFolderId;
    
    return await withRetry(async () => {
      const esc = ROOT_FOLDER_NAME.replace(/'/g, "\\'");
      const list = await queryDrive(`name='${esc}' and mimeType='application/vnd.google-apps.folder' and trashed=false`, 'id,name');
      if (list.length) { 
        rootFolderId = list[0].id; 
        return rootFolderId; 
      }
      
      const res = await fetch('https://www.googleapis.com/drive/v3/files', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ 
          name: ROOT_FOLDER_NAME, 
          mimeType: 'application/vnd.google-apps.folder' 
        })
      });
      
      if (!res.ok) throw new Error('Create folder failed: ' + res.status);
      const data = await res.json();
      rootFolderId = data.id;
      return rootFolderId;
    });
  }

  // ========= IMPROVED JSON helpers =========
  async function findFileInRootByName(name) {
    const parent = await ensureRootFolder();
    const esc = String(name).replace(/'/g, "\\'");
    const list = await queryDrive(`'${parent}' in parents and trashed=false and name='${esc}'`, 'id,name');
    return list[0] || null;
  }
  
  async function downloadFileText(fileId) {
    const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
    
    return await withRetry(async () => {
      const res = await fetch(url, { headers: authHeaders() });
      if (!res.ok) throw new Error('Download failed: ' + res.status);
      return await res.text();
    });
  }
  
  async function createTextInRoot(name, text, mime='application/json') {
    const parent = await ensureRootFolder();
    const boundary = '-------314159265358979323846';
    const delimiter = '\r\n--' + boundary + '\r\n';
    const close = '\r\n--' + boundary + '--';
    const metaPart = delimiter + 'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify({ name, mimeType: mime, parents: [parent] });
    const dataPart = delimiter + 'Content-Type: '+mime+'\r\n\r\n' + (text ?? (mime==='application/json' ? '{}' : ''));
    const body = metaPart + dataPart + close;

    return await withRetry(async () => {
      const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'multipart/related; boundary=' + boundary }),
        body
      });
      if (!res.ok) throw new Error('Create text failed: ' + res.status);
      const data = await res.json();
      return data.id;
    });
  }
  
  async function updateFileText(fileId, text, mime = 'application/json') {
    return await withRetry(async () => {
      const res = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
        method: 'PATCH',
        headers: authHeaders({ 'Content-Type': mime }),
        body: text ?? ''
      });
      if (!res.ok) throw new Error('Update text failed: ' + res.status);
      return true;
    });
  }
  
  async function getJson(name) {
    try {
      const f = await findFileInRootByName(name);
      if (!f) return null;
      const txt = await downloadFileText(f.id);
      let data = null; 
      try { data = JSON.parse(txt); } catch {}
      return { id: f.id, data };
    } catch (error) {
      console.warn(`[DriveSync] getJson failed for ${name}:`, error);
      return null;
    }
  }
  
  async function putJson(name, obj) {
    return await withRetry(async () => {
      const txt = JSON.stringify(obj ?? {}, null, 0);
      const f = await findFileInRootByName(name);
      
      if (f) { 
        await updateFileText(f.id, txt, 'application/json'); 
        return { id: f.id }; 
      }
      
      const id = await createTextInRoot(name, txt, 'application/json');
      return { id };
    }, 2, 2000); // 2 retries dengan base delay 2 detik
  }

  // ========= IMPROVED Subfolder & file utils =========
  const __subCache = new Map();
  async function ensureSub(subName) {
    if (__subCache.has(subName)) return __subCache.get(subName);
    
    return await withRetry(async () => {
      const parent = await ensureRootFolder();
      const esc = String(subName).replace(/'/g, "\\'");
      const list = await queryDrive(
        `'${parent}' in parents and trashed=false and mimeType='application/vnd.google-apps.folder' and name='${esc}'`,
        'id,name'
      );
      
      if (list.length) { 
        __subCache.set(subName, list[0].id); 
        return list[0].id; 
      }
      
      const res = await fetch('https://www.googleapis.com/drive/v3/files', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ 
          name: subName, 
          mimeType: 'application/vnd.google-apps.folder', 
          parents: [parent] 
        })
      });
      
      if (!res.ok) throw new Error('Create subfolder failed: ' + res.status);
      const data = await res.json();
      const id = data.id;
      __subCache.set(subName, id);
      return id;
    });
  }

  async function findFileByName(name, parentId) {
    const esc = String(name).replace(/'/g, "\\'");
    const list = await queryDrive(
      `'${parentId}' in parents and trashed=false and name='${esc}'`, 
      'id,name,mimeType,md5Checksum,size,appProperties'
    );
    return list[0] || null;
  }

  // Sanitasi nama file agar aman di Drive
  function safeName(name, fallback = 'file.pdf') {
    const n = String(name || '')
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
      .trim();
    return n ? n.slice(0, 200) : fallback;
  }

  // ==== IMPROVED Resumable upload ====
  async function driveResumableUpload(file, metadata, accessToken) {
    return await withRetry(async () => {
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
        headers: { 'Authorization': `Bearer ${accessToken}` },
        body: file
      });
      
      if (!up.ok) {
        const msg = await up.text().catch(() => up.statusText);
        throw new Error(`Upload failed: ${up.status} ${msg}`);
      }
      return up.json();
    }, 2, 3000); // 2 retries untuk upload
  }

  // multipart uploader
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
    const body = new Blob([pre, file, post]);

    return await withRetry(async () => {
      const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'multipart/related; boundary=' + boundary }),
        body
      });
      if (!r.ok) throw new Error('Drive upload failed: ' + r.status);
      return r.json();
    });
  }

  async function fetchPdfBlob(fileId) {
    return await withRetry(async () => {
      const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
        headers: authHeaders()
      });
      if (!r.ok) throw new Error('Drive download failed: ' + r.status);
      return r.blob();
    });
  }

  /** Simpan PDF idempoten dengan improved error handling */
  async function savePdfByHash(file, sha256) {
    if (!file)   throw new Error('File kosong');
    if (!sha256) throw new Error('Hash kosong');

    return await withRetry(async () => {
      const uid = (window.Auth?.getUid?.() || 'anon');
      const folderId = await ensureSub('pdfs');
      const cleanName = safeName(file.name || `${sha256}.pdf`);

      // 1) Cek dulu di folder /pdfs berdasarkan appProperties hash
      try {
        const q = [
          `'${folderId}' in parents`,
          `mimeType = 'application/pdf'`,
          `trashed = false`,
          `(appProperties has { key='contentHash' and value='${sha256}' } or appProperties has { key='sha256' and value='${sha256}' })`
        ].join(' and ');

        const hit = (await queryDrive(q, 'id,name,appProperties'))[0];
        if (hit?.id) {
          // Optional: rename ke nama upload terbaru
          const RENAME_TO_LATEST = false;
          if (RENAME_TO_LATEST && hit.name !== cleanName) {
            await fetch(`https://www.googleapis.com/drive/v3/files/${hit.id}`, {
              method: 'PATCH',
              headers: authHeaders({ 'Content-Type': 'application/json' }),
              body: JSON.stringify({ name: cleanName })
            }).catch(()=>{});
            hit.name = cleanName;
          }
          // catat katalog lokal per-akun
          try {
            const k = `PdfCatalog__${uid}`;
            const cat = JSON.parse(localStorage.getItem(k) || '{}');
            cat[sha256] = { id: hit.id, name: hit.name };
            localStorage.setItem(k, JSON.stringify(cat));
          } catch {}
          return { fileId: hit.id, name: hit.name, folderId, deduped: true };
        }
      } catch (e) {
        console.warn('[DriveSync] Hash search failed:', e);
      }

      // 2) Fallback global
      try {
        const q = [
          `mimeType = 'application/pdf'`,
          `trashed = false`,
          `(appProperties has { key='contentHash' and value='${sha256}' } or appProperties has { key='sha256' and value='${sha256}' })`
        ].join(' and ');
        const hit = (await queryDrive(q, 'id,name,appProperties,parents'))[0];
        if (hit?.id) {
          try {
            const k = `PdfCatalog__${uid}`;
            const cat = JSON.parse(localStorage.getItem(k) || '{}');
            cat[sha256] = { id: hit.id, name: hit.name };
            localStorage.setItem(k, JSON.stringify(cat));
          } catch {}
          return { fileId: hit.id, name: hit.name, folderId, deduped: true };
        }
      } catch (e) {
        console.warn('[DriveSync] Global search failed:', e);
      }

      // 3) Upload baru
      const token = DS._getAccessToken?.() || DS.getAccessToken?.();
      if (!token) throw new Error('Belum login Google Drive.');

      const created = await driveResumableUpload(
        file,
        {
          name: cleanName,
          parents: [folderId],
          description: 'Bribox Kanpus - original upload name preserved',
          mimeType: file.type || 'application/pdf',
          appProperties: {
            contentHash: sha256,
            sha256,
            originName: file.name || ''
          }
        },
        token
      );

      // simpan katalog lokal per-akun
      try {
        const k = `PdfCatalog__${uid}`;
        const cat = JSON.parse(localStorage.getItem(k) || '{}');
        cat[sha256] = { id: created.id, name: cleanName };
        localStorage.setItem(k, JSON.stringify(cat));
      } catch {}

      console.log('[Drive] savePdfByHash OK:', { fileId: created.id, name: cleanName, deduped: false, hash: sha256 });
      return { fileId: created.id, name: cleanName, folderId, deduped: false };
    }, 2, 2000);
  }

  /** Resolve Drive fileId dari hash dengan improved error handling */
  async function getFileIdByHash(sha256) {
    const uid = (window.Auth?.getUid?.() || 'anon');

    // 1) katalog lokal
    try {
      const k = `PdfCatalog__${uid}`;
      const cat = JSON.parse(localStorage.getItem(k) || '{}');
      const v = cat[sha256];
      if (v?.id)     return v.id;
      if (v?.fileId) return v.fileId;
    } catch (e) {
      console.warn('[DriveSync] Local catalog read failed:', e);
    }

    // 2) /pdfs by name
    try {
      const folderId = await ensureSub('pdfs');
      const fname = `${sha256}.pdf`;
      const exist = await findFileByName(fname, folderId);
      if (exist?.id) return exist.id;
    } catch (e) {
      console.warn('[DriveSync] PDFs search failed:', e);
    }

    // 3) appProperties global
    try {
      const q =
      `mimeType='application/pdf' and trashed=false and ` +
      `(appProperties has { key='sha256' and value='${sha256}' } ` +
      `or appProperties has { key='contentHash' and value='${sha256}' })`;
      const hit = (await queryDrive(q, 'id,name,appProperties'))[0];
      if (hit?.id) return hit.id;
    } catch (e) {
      console.warn('[DriveSync] Global properties search failed:', e);
    }

    return null;
  }

  // ======== IMPROVED PUBLIC API ========
  window.DriveSync = Object.assign(window.DriveSync || {}, {
    signIn, 
    signOut, 
    tryResume,
    isLogged: () => !!ACCESS_TOKEN,

    // helper akses token
    getAccessToken: () => ACCESS_TOKEN,
    _getAccessToken: () => ACCESS_TOKEN,

    onAuthStateChanged: (cb) => { 
      if (typeof cb === 'function') _authListeners.add(cb); 
    },

    // profil
    getProfile: async () => {
      if (!ACCESS_TOKEN) throw new Error('Belum login');
      if (cachedProfile) return cachedProfile;
      
      cachedProfile = await withRetry(async () => {
        const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
          headers: { Authorization: 'Bearer ' + ACCESS_TOKEN }
        });
        if (!response.ok) throw new Error('Profile fetch failed');
        return response.json();
      });
      
      return cachedProfile;
    },

    // folders & files
    ensureFolder: ensureRootFolder,
    ensureSub, 
    findFileByName,
    savePdfByHash, 
    getFileIdByHash, 
    fetchPdfBlob, 
    uploadFileMultipart,

    // JSON mirror dengan improved error handling
    getJson, 
    putJson,
    
    // util tambahan
    putTextFile: async (name, text, mime='text/plain') => {
      const f = await findFileInRootByName(name);
      if (f) { 
        await updateFileText(f.id, text ?? '', mime); 
        return { id: f.id }; 
      }
      const id = await createTextInRoot(name, text ?? '', mime);
      return { id };
    },
  });

  // ========= IMPROVED Auto resume & UI wiring =========
  document.addEventListener('DOMContentLoaded', () => {
    setAuthUI(false);
    
    // Coba resume dengan improved error handling
    setTimeout(async () => {
      try {
        await tryResume();
      } catch (error) {
        console.warn('[DriveSync] Auto-resume failed:', error);
      }
    }, 500);
    
    const btn = $('#btnConnectDrive');
    btn?.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'Connecting...';
      
      try { 
        await signIn(); 
        btn.textContent = 'Connected';
      } catch (e) { 
        console.error('[DriveSync] Sign-in failed:', e);
        alert('Gagal connect Drive.\n' + (e?.message || e)); 
        btn.textContent = 'Connect Google Drive';
        btn.disabled = false;
      }
    });
  });
})();