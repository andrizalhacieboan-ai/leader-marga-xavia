# Reviactyl Snippet Share

Website share code snippet bertema **Reviactyl** dengan frontend HTML/CSS/JavaScript dan backend Node.js memakai database Turso/libSQL SQLite.

## Fitur

- Login dan registrasi user.
- Upload kode dengan judul, deskripsi, bahasa pemrograman, dan isi kode.
- Daftar snippet publik dengan jumlah view dan jumlah salin kode.
- Tombol **Salin** untuk menyalin kode sekaligus menambah statistik salin.
- Menu **Admin Panel** dengan kredensial default:
  - Username: `andriyt`
  - Password: `andri2002`
- Admin dapat melihat total user, snippet, view, salin, dan menghapus snippet.

## Menjalankan lokal

```bash
npm install
npm start
```

Buka `http://localhost:3000`.

## Konfigurasi Turso

Aplikasi sekarang memakai **Turso SQL over HTTP** saat `TURSO_AUTH_TOKEN` tersedia, sehingga tidak membuka file SQLite di folder deployment yang read-only. URL database default sudah diarahkan ke:

```bash
libsql://reviactyl-andri.aws-ap-south-1.turso.io
```

Set token database melalui environment variable production:

```bash
export TURSO_DATABASE_URL="libsql://reviactyl-andri.aws-ap-south-1.turso.io"
export TURSO_AUTH_TOKEN="token-turso-anda"
npm start
```

> Jangan commit token Turso ke repository. Simpan token di environment variable platform hosting Anda.


## Deploy ke Vercel

Repository ini sudah menyertakan `vercel.json` untuk menjalankan `server.js` sebagai Vercel Node Function dan mengarahkan semua route ke aplikasi. File `public/**` ikut disertakan ke function agar frontend tetap bisa disajikan dari server.

Environment production yang **wajib** ditambahkan di Vercel adalah token Turso:

```bash
vercel env add TURSO_AUTH_TOKEN production
```

Environment production lain sudah diberi default di `vercel.json`, tetapi tetap bisa dioverride lewat dashboard Vercel jika diperlukan:

```bash
vercel env add TURSO_DATABASE_URL production
vercel env add ADMIN_USERNAME production
vercel env add ADMIN_PASSWORD production
```

Setelah environment production selesai, deploy dengan:

```bash
vercel --prod
```

> Jangan masukkan token Turso langsung ke `vercel.json`; gunakan menu Environment Variables Vercel atau perintah `vercel env add`.

## Fallback SQLite lokal

Jika `TURSO_AUTH_TOKEN` belum diset, server akan memakai SQLite lokal. Di serverless/read-only runtime, file fallback otomatis dipindahkan ke `/tmp/reviactyl.db` agar tidak memunculkan error `unable to open database file`.

Jalur file database lokal bisa diganti:

```bash
export SQLITE_PATH="./data/reviactyl.db"
npm start
```

Kredensial admin juga bisa diganti melalui environment variable:

```bash
export ADMIN_USERNAME="admin"
export ADMIN_PASSWORD="password-kuat"
```
