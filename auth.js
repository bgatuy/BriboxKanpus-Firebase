/**
 * Auth (App session 10 jam) + Google Sign-In (accounts.id)
 * - Simpan sesi app di localStorage (tanpa backend)
 * - Guard semua halaman fitur -> gunakan Auth.enforce() di masing-masing halaman
 * - Halaman login: render tombol Google otomatis (mountGoogleButton)
 * - Setelah login: redirect ke ?next=... (default trackmate.html)
 *
 * Prasyarat di HTML (urutan):
 *   <script src="config.local.js"></script>
 *   <script>if(!window.__CONFIG){document.write('<script src="config.sample.js"><\/script>')}</script>
 *   <script src="https://accounts.google.com/gsi/client" async defer></script>
 *   <script src="auth.js" defer></script>
 */
(function () {
  const LS_KEY = 'auth_v1';
  const TEN_HOURS = 10 * 60 * 60 * 1000;

  // ===== Helpers =====
  const basePath = () => location.pathname.replace(/[^/]*$/, ''); // "/app/" dari "/app/page.html"
  const fileNow  = () => (location.pathname.split('/').pop() || '').trim();
  const safeJSON = s => { try { return JSON.parse(s); } catch { return null; } };

  // Hindari redirect keluar folder app
  function normalizeNext(next) {
    if (!next) return 'trackmate.html';
    let n = String(next).trim();
    n = n.replace(/^\//, '');                // hapus leading slash
    if (/[#:]/.test(n) || n.includes('//')) n = 'trackmate.html'; // cegah proto/host
    if (n.includes('..')) n = 'trackmate.html';                    // cegah traversal
    n = n || 'trackmate.html';
    return (n.toLowerCase() === 'index.html') ? 'trackmate.html' : n;
  }

  function goLogin(next) {
    const n = normalizeNext(next);
    location.replace(basePath() + 'index.html?next=' + encodeURIComponent(n));
  }

  function afterLoginRedirect() {
    const params = new URLSearchParams(location.search);
    const n = normalizeNext(params.get('next'));
    location.replace(basePath() + n);
  }

  function parseJwt(token) {
    try {
      const b = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const json = decodeURIComponent(atob(b).split('').map(
        c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
      ).join(''));
      return JSON.parse(json);
    } catch { return null; }
  }

  function emitAuthChange() {
    const a = Auth.get();
    window.dispatchEvent(new CustomEvent('auth:change', { detail: { loggedIn: !!a, profile: a } }));
  }

  // ====== Auth API ======
  let autoLogoutTimer = null;

  const Auth = {
    GOOGLE_CLIENT_ID: '',

    get() {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return null;
      const data = safeJSON(raw);
      if (!data?.exp) return null;
      if (Date.now() > data.exp) { this.clear(); return null; }
      return data;
    },
    isLogged() { return !!this.get(); },

    set(profile) {
      const exp = Date.now() + TEN_HOURS;
      try { localStorage.setItem(LS_KEY, JSON.stringify({ ...profile, exp })); } catch {}

      // schedule auto-logout (reset bila ada timer lama)
      if (autoLogoutTimer) { try { clearTimeout(autoLogoutTimer); } catch {} autoLogoutTimer = null; }
      const ms = Math.max(0, exp - Date.now());
      autoLogoutTimer = setTimeout(() => {
        try { this.clear(); emitAuthChange(); goLogin('trackmate.html'); } catch {}
      }, ms);

      emitAuthChange();
      return profile;
    },
    clear() {
      try { localStorage.removeItem(LS_KEY); } catch {}
      if (autoLogoutTimer) { try { clearTimeout(autoLogoutTimer); } catch {} autoLogoutTimer = null; }
    },

    enforce() {
      if (!this.get()) {
        const f = fileNow() || 'trackmate.html';
        // jangan bikin loop di login
        if (f.toLowerCase() !== 'index.html' && f !== '') goLogin(f);
        else goLogin('trackmate.html');
        return null;
      }
      return this.get();
    },

    logout() {
      if (!confirm('Keluar dari sesi ini?')) return;
      this.clear();
      emitAuthChange();
      goLogin('trackmate.html');
    },

    async handleGoogleCredential(idToken) {
      const p = parseJwt(idToken);
      if (!p?.email) throw new Error('Token Google tidak valid.');
      // SIMPAN UID stabil (Google 'sub')
      this.set({
        uid: p.sub || p.user_id || p.email || 'anon',
        name: p.name || p.email || 'User',
        email: p.email,
        picture: p.picture || '',
        token: idToken
      });
      afterLoginRedirect();
    },

    async devLogin() {
      this.set({ uid: 'dev', name: 'Dev User', email: 'dev@example.com', picture: '' });
      afterLoginRedirect();
    }
  };

  // Tunggu GIS siap (maks 8 detik)
  function waitGIS() {
    return new Promise((res, rej) => {
      if (window.google?.accounts?.id) return res();
      let tries = 0;
      const id = setInterval(() => {
        tries++;
        if (window.google?.accounts?.id) { clearInterval(id); res(); }
        else if (tries > 80) { clearInterval(id); rej(new Error('Google Identity belum siap.')); }
      }, 100);
    });
  }

  Auth.mountGoogleButton = async function (selector = '#googleLoginBtn') {
    const CLIENT_ID = window.__CONFIG?.GOOGLE_CLIENT_ID || this.GOOGLE_CLIENT_ID || '';
    if (!CLIENT_ID) {
      console.error('[Auth] GOOGLE_CLIENT_ID kosong. Pastikan config.local.js ter-load lebih dulu.');
      alert('Konfigurasi Google belum terpasang. Hubungi admin.');
      return;
    }

    let el = document.querySelector(selector);
    if (!el) {
      // kalau selector belum ada, coba cari default container login
      el = document.querySelector('#gbtn') || document.body;
    }

    try {
      await waitGIS();
    } catch (e) {
      console.warn('[Auth] GIS timeout:', e);
      return alert('Layanan Google Sign-In belum siap. Muat ulang halaman.');
    }

    // Render tombol + callback
    google.accounts.id.initialize({
      client_id: CLIENT_ID,
      ux_mode: 'popup',
      auto_select: false,
      callback: (response) => {
        try { Auth.handleGoogleCredential(response.credential); }
        catch (e) { alert('Login gagal: ' + (e?.message || e)); }
      }
    });

    google.accounts.id.renderButton(el, {
      theme: 'filled_blue',
      size: 'large',
      type: 'standard',
      shape: 'pill',
      logo_alignment: 'left',
      text: 'signin_with'
    });

    // One-tap (opsional; aman diabaikan oleh browser yang tidak mendukung)
    try { google.accounts.id.prompt(); } catch {}
  };

  // expose + getters
  Auth.getUid = () => (Auth.get()?.uid) || 'anon';
  Auth.currentUser = () => {
    const a = Auth.get();
    return a ? { uid: a.uid, email: a.email, name: a.name, picture: a.picture } : null;
  };
  window.Auth = Auth;

  // ===== Cross-tab sync via storage =====
  window.addEventListener('storage', (ev) => {
    if (ev.key === LS_KEY) emitAuthChange();
  });

  // ===== Header helper (HANYA untuk halaman fitur) =====
  document.addEventListener('DOMContentLoaded', () => {
    const f = (fileNow() || '').toLowerCase();
    if (f === 'index.html' || f === '') return; // jangan utak-atik halaman login

    const btn = document.querySelector('#btnAuth'); // tombol di header
    if (!btn) return;

    const render = () => {
      const a = Auth.get();
      if (a) {
        const pic = a.picture
          ? `<img src="${a.picture}" alt="" style="width:22px;height:22px;border-radius:50%;object-fit:cover">`
          : '👤';
        btn.innerHTML = `${pic} <span style="margin-left:8px">${a.name || 'Akun'}</span>`;
        btn.title = a.email || 'Akun';
        btn.onclick = (e) => { e.preventDefault(); Auth.logout(); };
        btn.style.display = 'inline-flex';
        btn.style.alignItems = 'center';
        btn.style.gap = '6px';
      } else {
        btn.textContent = 'Login';
        btn.onclick = (e) => { e.preventDefault(); goLogin(f || 'trackmate.html'); };
      }
    };

    render();
    window.addEventListener('auth:change', render);
  });
})();
