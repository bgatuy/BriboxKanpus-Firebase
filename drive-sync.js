;(() => {
  const CLIENT_ID = window.__CONFIG?.GOOGLE_CLIENT_ID || '';
  const API_KEY   = window.__CONFIG?.GOOGLE_API_KEY   || '';

  if (!CLIENT_ID || !API_KEY) {
    console.warn('[DriveSync] CLIENT_ID/API_KEY belum diisi. Pastikan config.local.js ada.');
  }

  const ROOT_FOLDER_NAME = 'Bribox Kanpus';
  const SCOPES = 'https://www.googleapis.com/auth/drive.file';
  const DISCOVERY_DOCS = ['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest'];

  let tokenClient = null;
  let accessToken = null;
  let rootFolderId = null;
  const subfolders = new Map();

  const $ = sel => document.querySelector(sel);
  function setAuthUI(logged, profile){
    const inBtn  = $('#btnSignIn'), outBtn = $('#btnSignOut'), who = $('#whoami');
    if (inBtn)  inBtn.style.display  = logged ? 'none' : '';
    if (outBtn) outBtn.style.display = logged ? '' : 'none';
    if (who) who.textContent = logged ? (profile?.email || 'Logged in') : '';
  }

  async function gapiInit(){
    return new Promise((resolve, reject) => {
      if (!window.gapi) { reject(new Error('gapi belum dimuat')); return; }
      gapi.load('client', async () => {
        try {
          await gapi.client.init({ apiKey: API_KEY, discoveryDocs: DISCOVERY_DOCS });
          resolve();
        } catch (e) { reject(e); }
      });
    });
  }

  async function ensureInit(){
    if (!tokenClient){
      await gapiInit();
      if (!window.google?.accounts?.oauth2) throw new Error('Google Identity Services belum siap.');
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: (resp) => { accessToken = resp?.access_token || null; }
      });
    }
  }

  async function signIn(){
    await ensureInit();
    return new Promise((resolve, reject) => {
      tokenClient.callback = async (resp) => {
        if (resp.error) { reject(resp); return; }
        accessToken = resp.access_token;
        try {
          const prof = await getProfile().catch(() => null);
          setAuthUI(true, prof);
          await ensureRootFolder();
          resolve(resp);
        } catch (e) { reject(e); }
      };
      tokenClient.requestAccessToken({ prompt: 'consent' });
    });
  }

  async function signInSilent(){
    await ensureInit();
    return new Promise((resolve, reject) => {
      tokenClient.callback = async (resp) => {
        if (resp?.error || !resp?.access_token) { reject(new Error('Silent token gagal')); return; }
        accessToken = resp.access_token;
        try {
          const prof = await getProfile().catch(() => null);
          setAuthUI(true, prof);
          await ensureRootFolder();
          resolve(resp);
        } catch (e) { reject(e); }
      };
      tokenClient.requestAccessToken({ prompt: 'none' });
    });
  }

  function signOut(){
    if (!accessToken) return;
    try { google.accounts.oauth2.revoke(accessToken); } catch {}
    accessToken = null;
    rootFolderId = null;
    subfolders.clear();
    setAuthUI(false);
  }

  async function getProfile(){
    if (!accessToken) throw new Error('Belum login Drive.');
    const res = await gapi.client.request({ path: 'https://www.googleapis.com/oauth2/v1/userinfo?alt=json' });
    return res.result;
  }

  async function queryDrive(q, fields='files(id,name,mimeType,parents,createdTime,modifiedTime,size)'){
    if (!accessToken) throw new Error('Belum login Drive.');
    const res = await gapi.client.drive.files.list({
      q, fields: `files(${fields})`, spaces:'drive', pageSize:1000
    });
    return res.result.files || [];
  }

  async function ensureRootFolder(){
    if (rootFolderId) return rootFolderId;
    const esc = ROOT_FOLDER_NAME.replace(/'/g, "\\'");
    const exist = await queryDrive(`name='${esc}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
    if (exist.length){ rootFolderId = exist[0].id; return rootFolderId; }
    const res = await gapi.client.drive.files.create({
      resource:{ name: ROOT_FOLDER_NAME, mimeType:'application/vnd.google-apps.folder' }, fields:'id'
    });
    rootFolderId = res.result.id;
    return rootFolderId;
  }

  async function ensureSubfolder(mod){
    mod = String(mod||'').trim();
    if (!mod) return null;
    if (subfolders.has(mod)) return subfolders.get(mod);
    const parent = await ensureRootFolder();
    const esc = mod.replace(/'/g, "\\'");
    const exist = await queryDrive(`'${parent}' in parents and trashed=false and mimeType='application/vnd.google-apps.folder' and name='${esc}'`);
    if (exist.length){ subfolders.set(mod, exist[0].id); return exist[0].id; }
    const res = await gapi.client.drive.files.create({
      resource:{ name: mod, parents:[parent], mimeType:'application/vnd.google-apps.folder' }, fields:'id'
    });
    subfolders.set(mod, res.result.id);
    return res.result.id;
  }

  async function uploadPdf(file, contentHash, moduleName){
    if (!file || file.type !== 'application/pdf') throw new Error('Bukan PDF');
    const parent = moduleName ? (await ensureSubfolder(moduleName)) : (await ensureRootFolder());

    const safeName = `${contentHash || Date.now()}__${file.name.replace(/[^\w.\- ()]/g,'_')}`;
    const metadata = { name: safeName, mimeType: 'application/pdf', parents: [parent] };

    const boundary = '-------314159265358979323846';
    const delimiter = `\\r\\n--${boundary}\\r\\n`;
    const closeDelim = `\\r\\n--${boundary}--`;

    const metaPart = `${delimiter}Content-Type: application/json; charset=UTF-8\\r\\n\\r\\n${JSON.stringify(metadata)}`;
    const buf = await file.arrayBuffer();
    const base64Data = btoa(String.fromCharCode(...new Uint8Array(buf)));
    const filePart = `${delimiter}Content-Type: application/pdf\\r\\nContent-Transfer-Encoding: base64\\r\\n\\r\\n${base64Data}`;
    const body = metaPart + filePart + closeDelim;

    const res = await gapi.client.request({
      path: '/upload/drive/v3/files',
      method: 'POST',
      params: { uploadType: 'multipart' },
      headers: { 'Content-Type': `multipart/related; boundary="${boundary}"` },
      body
    });
    return { id: res.result.id, name: safeName };
  }

  async function findByHashPrefix(hash, moduleName){
    const parent = moduleName ? (await ensureSubfolder(moduleName)) : (await ensureRootFolder());
    const files = await queryDrive(`'${parent}' in parents and trashed=false and name contains '${hash}'`);
    const prefix = `${hash}__`;
    return files.find(f => f.name.startsWith(prefix)) || null;
  }

  window.DriveSync = {
    signIn, signInSilent, signOut,
    isLogged: () => !!accessToken,
    getProfile,
    ensureFolder: ensureRootFolder,
    uploadPdf,
    findByHashPrefix
  };

  document.addEventListener('DOMContentLoaded', ()=> setAuthUI(false));
})();