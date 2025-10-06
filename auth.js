/**
 * Auth (App session 10 jam) + Google Sign-In (accounts.id)
 * - Simpan sesi app di localStorage (tanpa backend)
 * - Guard semua halaman fitur -> redirect ke login
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

  function normalizeNext(next) {
    if (!next) return 'trackmate.html';
    const n = next.replace(/^\//, '').trim();
    return (n === '' || n.toLowerCase() === 'index.html') ? 'trackmate.html' : n;
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
      const json = decodeURIComponent(atob(b).split('').map(c => '%'+('00'+c.charCodeAt(0).toString(16)).slice(-2)).join(''));
      return JSON.parse(json);
    } catch { return null; }
  }

  function emitAuthChange() {
    const a = Auth.get();
    window.dispatchEvent(new CustomEvent('auth:change', { detail: { loggedIn: !!a, profile: a } }));
  }

  // ====== Auth API ======
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
      localStorage.setItem(LS_KEY, JSON.stringify({ ...profile, exp }));

      // auto-logout saat kadaluarsa
      const ms = Math.max(0, exp - Date.now());
      setTimeout(() => { try { this.clear(); emitAuthChange(); goLogin('trackmate.html'); } catch {} }, ms);

      emitAuthChange();
      return profile;
    },
    clear() { try { localStorage.removeItem(LS_KEY); } catch {} },

    enforce() {
      if (!this.get()) {
        const f = fileNow() || 'trackmate.html';
        goLogin(f);
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
        name: p.name || p.email,
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

  function waitGIS() {
    return new Promise((res) => {
      if (window.google?.accounts?.id) return res();
      const id = setInterval(() => {
        if (window.google?.accounts?.id) { clearInterval(id); res(); }
      }, 40);
    });
  }

  Auth.mountGoogleButton = async function (selector = '#googleLoginBtn') {
    const CLIENT_ID = window.__CONFIG?.GOOGLE_CLIENT_ID || this.GOOGLE_CLIENT_ID || '';
    if (!CLIENT_ID) {
      console.error('[Auth] GOOGLE_CLIENT_ID kosong. Pastikan config.local.js ter-load lebih dulu.');
      alert('Konfigurasi Google belum terpasang. Hubungi admin.');
      return;
    }
    await waitGIS();
    const el = document.querySelector(selector);
    if (!el) return;

    google.accounts.id.initialize({
      client_id: CLIENT_ID,
      ux_mode: 'popup',
      auto_select: false,
      callback: (response) => {
        try { Auth.handleGoogleCredential(response.credential); }
        catch (e) { alert('Login gagal: ' + (e?.message || e)); }
      }
    });

    google.accounts.id.renderButton(el, { theme: 'filled_blue', size: 'large', type: 'standard', shape: 'pill' });
    google.accounts.id.prompt();
  };

  // expose + getters
  Auth.getUid = () => (Auth.get()?.uid) || 'anon';
  Auth.currentUser = () => {
    const a = Auth.get();
    return a ? { uid: a.uid, email: a.email, name: a.name, picture: a.picture } : null;
  };
  window.Auth = Auth;

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
