# Deploy ke Firebase Hosting (Gratis / Spark)

## Prasyarat
- `npm i -g firebase-tools`
- `firebase login`

## Langkah
1. Inisialisasi (sekali):
   ```bash
   firebase init hosting
   # Public directory: .
   # Single-page app: No
   ```

2. Deploy:
   ```bash
   firebase deploy --only hosting
   ```

3. Custom Domain (opsional) via Firebase Console → Hosting → Add Custom Domain.

## OAuth & API Key
Tambahkan origins:
- https://<project-id>.web.app
- https://<project-id>.firebaseapp.com
- (opsional) https://app.domainkamu.com

Batasi API Key:
- Application restrictions: HTTP referrers (web sites)
- Tambahkan referrers di atas
- API restrictions: Restrict key → Google Drive API

## Konfigurasi Rahasia
Buat `config.local.js` (JANGAN commit):
```html
<script>
window.__CONFIG = { GOOGLE_CLIENT_ID: "...", GOOGLE_API_KEY: "..." };
</script>
```
`config.sample.js` adalah contoh yang boleh di-commit.
