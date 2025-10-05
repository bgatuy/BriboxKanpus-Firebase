// auth.js — sesi 10 jam + guard halaman + redirect aman
(function () {
  const LS_KEY = 'auth_v1';
  const TEN_HOURS = 10 * 60 * 60 * 1000;

  // ===== Helpers =====
  const basePath = () => location.pathname.replace(/[^/]*$/, ''); // "/app/" dari "/app/page.html"
  const fileNow  = () => (location.pathname.split('/').pop() || '').trim();
  const safeJSON = s => { try { return JSON.parse(s); } catch { return null; } };

  // Jangan biarkan next = index.html (login). Defaultkan ke trackmate.html
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
      const json = decodeURIComponent(atob(b).split('')
        .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
      return JSON.parse(json);
    } catch { return null; }
  }

  function emitAuthChange() {
    const a = Auth.get();
    window.dispatchEvent(new CustomEvent('auth:change', { detail: { loggedIn: !!a, profile: a } }));
  }

  // ====== Auth API ======
  const Auth = {
    // isi ini kalau nanti kamu pakai Google Identity
    GOOGLE_CLIENT_ID: '',

    // ---- session store ----
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

    // ---- guard: panggil di SEMUA halaman fitur ----
    enforce() {
      if (!this.get()) {
        // kalau user membuka halaman fitur tanpa login → lempar ke login, next = file sekarang
        const f = fileNow() || 'trackmate.html';
        goLogin(f);
        return null;
      }
      return this.get();
    },

    // ---- logout tombol ----
    logout() {
      if (!confirm('Keluar dari sesi ini?')) return;
      this.clear();
      emitAuthChange();
      // balik ke login dengan next default yang jelas
      goLogin('trackmate.html');
    },

    // ---- login handlers ----
    async handleGoogleCredential(idToken) {
      const p = parseJwt(idToken);
      if (!p?.email) throw new Error('Token Google tidak valid.');
      this.set({ name: p.name || p.email, email: p.email, picture: p.picture || '', token: idToken });
      afterLoginRedirect();
    },

    // Mode DEV (tanpa Google)
    async devLogin() {
      this.set({ name: 'Dev User', email: 'dev@example.com', picture: '' });
      afterLoginRedirect();
    }
  };

  // expose
  window.Auth = Auth;

  // ===== Header helper (HANYA untuk halaman fitur) =====
  document.addEventListener('DOMContentLoaded', () => {
    const f = fileNow().toLowerCase();
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
