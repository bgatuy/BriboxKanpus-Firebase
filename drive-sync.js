;(() => {
  // ====== CONFIG ======
  var CLIENT_ID = (window.__CONFIG && window.__CONFIG.GOOGLE_CLIENT_ID) || '';
  var API_KEY   = (window.__CONFIG && window.__CONFIG.GOOGLE_API_KEY)   || '';

  if (!CLIENT_ID || !API_KEY) {
    console.warn('[DriveSync] CLIENT_ID/API_KEY belum diisi. Pastikan config.local.js ada.');
  }

  var ROOT_FOLDER_NAME = 'Bribox Kanpus';
  var SCOPES = 'https://www.googleapis.com/auth/drive.file openid email profile';
  var DISCOVERY_DOCS = ['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest'];

  // ====== STATE ======
  var tokenClient = null;
  var accessToken = null;
  var rootFolderId = null;
  var subfolders = new Map();

  // ====== UTILS ======
  function $(sel){ return document.querySelector(sel); }
  function setAuthUI(logged, profile){
    var inBtn = $('#btnSignIn'), outBtn = $('#btnSignOut'), who = $('#whoami');
    if (inBtn)  inBtn.style.display  = logged ? 'none' : '';
    if (outBtn) outBtn.style.display = logged ? '' : 'none';
    if (who) who.textContent = logged ? (profile && (profile.email || profile.name) || 'Logged in') : '';
  }

  function waitGapi(){
    return new Promise(function(res, rej){
      if (window.gapi && gapi.load) return res();
      var t = setInterval(function(){
        if (window.gapi && gapi.load){ clearInterval(t); res(); }
      }, 50);
      setTimeout(function(){ clearInterval(t); rej(new Error('gapi tidak pernah siap')); }, 7000);
    });
  }
  function waitGIS(){
    return new Promise(function(res, rej){
      if (window.google && google.accounts && google.accounts.oauth2) return res();
      var t = setInterval(function(){
        if (window.google && google.accounts && google.accounts.oauth2){ clearInterval(t); res(); }
      }, 50);
      setTimeout(function(){ clearInterval(t); rej(new Error('GIS tidak pernah siap')); }, 7000);
    });
  }

  function gapiInit(){
    return waitGapi().then(function(){
      return new Promise(function(resolve, reject){
        gapi.load('client', function(){
          gapi.client.init({ apiKey: API_KEY, discoveryDocs: DISCOVERY_DOCS })
            .then(resolve, reject);
        });
      });
    });
  }

  function ensureTokenClient(){
    if (!(window.google && google.accounts && google.accounts.oauth2)){
      throw new Error('Google Identity Services belum siap.');
    }
    if (tokenClient) return tokenClient;
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPES,
      callback: function(){} // di-override per request
    });
    return tokenClient;
  }

  function ensureInit(){
    if (!CLIENT_ID) throw new Error('Missing GOOGLE_CLIENT_ID');
    if (!API_KEY) throw new Error('Missing GOOGLE_API_KEY');
    return gapiInit().then(function(){ ensureTokenClient(); });
  }

  // ====== AUTH ======
  function signIn(){
    return ensureInit().then(function(){
      return new Promise(function(resolve, reject){
        tokenClient.callback = function(resp){
          if (!resp || resp.error || !resp.access_token){ reject(resp || new Error('Token kosong')); return; }
          accessToken = resp.access_token;
          gapi.client.setToken({ access_token: accessToken }); // penting
          Promise.resolve()
            .then(getProfile).catch(function(){ return null; })
            .then(function(prof){
              setAuthUI(true, prof);
              return ensureRootFolder();
            })
            .then(function(){ resolve(resp); })
            .catch(reject);
        };
        try { tokenClient.requestAccessToken({ prompt: 'consent' }); }
        catch(e){ reject(e); }
      });
    });
  }

  function signInSilent(){
    return ensureInit().then(function(){
      return new Promise(function(resolve, reject){
        tokenClient.callback = function(resp){
          if (!resp || resp.error || !resp.access_token){ reject(new Error((resp && resp.error_description) || 'Silent token gagal')); return; }
          accessToken = resp.access_token;
          gapi.client.setToken({ access_token: accessToken }); // penting
          Promise.resolve()
            .then(getProfile).catch(function(){ return null; })
            .then(function(prof){
              setAuthUI(true, prof);
              return ensureRootFolder();
            })
            .then(function(){ resolve(resp); })
            .catch(reject);
        };
        try { tokenClient.requestAccessToken({ prompt: 'none' }); }
        catch(e){ reject(e); }
      });
    });
  }

  function signOut(){
    if (!accessToken) return;
    try { google.accounts.oauth2.revoke(accessToken); } catch(e){}
    accessToken = null;
    gapi.client.setToken(null);
    rootFolderId = null;
    subfolders.clear();
    setAuthUI(false);
  }

  function getProfile(){
    if (!accessToken) return Promise.reject(new Error('Belum login Drive.'));
    return gapi.client.request({
      path: 'https://www.googleapis.com/oauth2/v1/userinfo',
      params: { alt: 'json' }
    }).then(function(res){ return res.result; });
  }

  // ====== DRIVE HELPERS ======
  function queryDrive(q, fields){
    if (!accessToken) return Promise.reject(new Error('Belum login Drive.'));
    var f = fields || 'files(id,name,mimeType,parents,createdTime,modifiedTime,size)';
    return gapi.client.drive.files.list({
      q: q, spaces: 'drive', pageSize: 1000, fields: 'files(' + f + ')'
    }).then(function(res){ return res.result.files || []; });
  }

  function ensureRootFolder(){
    if (rootFolderId) return Promise.resolve(rootFolderId);
    var esc = ROOT_FOLDER_NAME.replace(/'/g, "\\'");
    return queryDrive("name='" + esc + "' and mimeType='application/vnd.google-apps.folder' and trashed=false")
      .then(function(list){
        if (list.length){
          rootFolderId = list[0].id;
          return rootFolderId;
        }
        return gapi.client.drive.files.create({
          resource: { name: ROOT_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' },
          fields: 'id'
        }).then(function(res){
          rootFolderId = res.result.id;
          return rootFolderId;
        });
      });
  }

  function ensureSubfolder(mod){
    mod = String(mod || '').trim();
    if (!mod) return Promise.resolve(null);
    if (subfolders.has(mod)) return Promise.resolve(subfolders.get(mod));
    return ensureRootFolder().then(function(parent){
      var esc = mod.replace(/'/g, "\\'");
      return queryDrive("'" + parent + "' in parents and trashed=false and mimeType='application/vnd.google-apps.folder' and name='" + esc + "'")
        .then(function(list){
          if (list.length){ subfolders.set(mod, list[0].id); return list[0].id; }
          return gapi.client.drive.files.create({
            resource: { name: mod, parents: [parent], mimeType: 'application/vnd.google-apps.folder' },
            fields: 'id'
          }).then(function(res){
            subfolders.set(mod, res.result.id);
            return res.result.id;
          });
        });
    });
  }

  function uploadPdf(file, contentHash, moduleName){
    if (!file || file.type !== 'application/pdf') return Promise.reject(new Error('Bukan PDF'));

    var parentPromise = moduleName ? ensureSubfolder(moduleName) : ensureRootFolder();

    return parentPromise.then(function(parent){
      var safeName = (contentHash || Date.now()) + '__' + file.name.replace(/[^\w.\- ()]/g,'_');
      var metadata = { name: safeName, mimeType: 'application/pdf', parents: [parent] };

      var boundary = '-------314159265358979323846';
      var delimiter  = '\r\n--' + boundary + '\r\n';
      var closeDelim = '\r\n--' + boundary + '--';

      var metaPart = delimiter + 'Content-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(metadata);

      return file.arrayBuffer().then(function(buf){
        // base64 encode
        var bytes = new Uint8Array(buf);
        var binary = '';
        var chunk = 0x8000;
        for (var i = 0; i < bytes.length; i += chunk) {
          binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
        }
        var base64Data = btoa(binary);

        var filePart = delimiter + 'Content-Type: application/pdf\r\nContent-Transfer-Encoding: base64\r\n\r\n' + base64Data;
        var body = metaPart + filePart + closeDelim;

        return gapi.client.request({
          path: '/upload/drive/v3/files',
          method: 'POST',
          params: { uploadType: 'multipart' },
          headers: { 'Content-Type': 'multipart/related; boundary=' + boundary },
          body: body
        }).then(function(res){
          return { id: res.result.id, name: safeName };
        });
      });
    });
  }

  function findByHashPrefix(hash, moduleName){
    var parentPromise = moduleName ? ensureSubfolder(moduleName) : ensureRootFolder();
    return parentPromise.then(function(parent){
      var esc = String(hash || '').replace(/'/g, "\\'");
      return queryDrive("'" + parent + "' in parents and trashed=false and name contains '" + esc + "'")
        .then(function(files){
          var prefix = String(hash || '') + '__';
          for (var i=0;i<files.length;i++){
            if ((files[i].name || '').indexOf(prefix) === 0) return files[i];
          }
          return null;
        });
    });
  }

  // ====== PUBLIC API ======
  window.DriveSync = {
    signIn: signIn,
    signInSilent: signInSilent,
    signOut: signOut,
    isLogged: function(){ return !!accessToken; },
    getProfile: getProfile,
    ensureFolder: ensureRootFolder,
    uploadPdf: uploadPdf,
    findByHashPrefix: findByHashPrefix
  };

  document.addEventListener('DOMContentLoaded', function(){ setAuthUI(false); });
})();
