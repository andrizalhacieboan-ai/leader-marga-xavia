# Reviactyl Snippet Share by andri store

Website share code snippet bertema **Reviactyl** dengan frontend HTML/CSS/JavaScript dan backend Node.js memakai database SQLite yang cocok untuk alur Turso/libSQL.

## Fitur

- Login dan registrasi user.
- Upload kode dengan judul, deskripsi, bahasa pemrograman, dan isi kode.
- Daftar snippet publik dengan jumlah view dan jumlah salin kode.
- Tombol **Salin** untuk menyalin kode sekaligus menambah statistik salin.
- Menu **Admin Panel** dengan kredensial default:
  - Username: `*******`
  - Password: `*******`
- Admin dapat melihat total user, snippet, view, salin, dan menghapus snippet.

## Menjalankan lokal

Aplikasi tidak membutuhkan dependency npm eksternal karena memakai modul bawaan Node.js 24 (`node:http`, `node:sqlite`, dan `node:crypto`).

```bash
npm start
```

Buka `http://localhost:3000`.

## Konfigurasi database

Secara default aplikasi menggunakan database lokal `reviactyl.db`. Jalur file database bisa diganti melalui environment variable:

```bash
export SQLITE_PATH="./data/reviactyl.db"
npm start
```

Untuk deployment Turso/libSQL, schema SQLite di `server.js` sudah kompatibel dengan Turso. Hubungkan file SQLite ini ke workflow Turso/libSQL yang Anda gunakan, atau tambahkan client Turso resmi saat kredensial production tersedia.

Kredensial admin juga bisa diganti melalui environment variable:

```bash
export ADMIN_USERNAME="admin"
export ADMIN_PASSWORD="password-kuat"
```
`ⓒpowered by andri store`
