# XenChat

**PHASE 1 — COMPLETE · PHASE 2 — COMPLETE · PHASE 3 — COMPLETE · PHASE 4 — COMPLETE (kode; lihat "Status pengujian")**

Platform messaging realtime dengan UI/branding orisinal. Dibangun bertahap; dokumen ini mencatat **Phase 1** (UI responsive + autentikasi) **Phase 2** (profil, chat pribadi, Socket.IO, presence), dan **Phase 3** (grup, story, saluran).

Stack: HTML5, CSS3, Vanilla JS (frontend) · Node.js, Express (CommonJS), MongoDB + Mongoose (backend). Socket.IO untuk realtime.

## Status phase

| Phase | Isi | Status |
|-------|-----|--------|
| 1 | UI responsive, register/login, Account ID 8 digit, shell navigasi, tema | Selesai (kode) |
| 2 | Profil, chat pribadi 1-on-1, Socket.IO, presence | Selesai (kode) |
| 3 | Grup (3A), Story (3B), Saluran (3C) | Selesai (kode) |
| 4 | Email, Owner, block/report, media chat, voice note, panggilan WebRTC, invite link, halaman terpisah | Selesai (kode) |
| 5 | XenChat AI, Web Push, privasi/notifikasi lanjutan, Bot Manager | - |

## Menjalankan

Butuh Node.js 18+ dan MongoDB (lokal atau Atlas).

```bash
npm install
cp .env.example .env
# isi JWT_SECRET (lihat perintah di .env.example) dan MONGODB_URI
npm run dev      # atau: npm start
```

Buka http://localhost:3000 . Server melayani folder `client/` sehingga frontend dan API same-origin (cookie `httpOnly`, tidak perlu CORS).

## Endpoint

| Method | Path | Keterangan |
|--------|------|------------|
| POST | /api/auth/register, /login, /logout | Phase 1 |
| GET | /api/auth/me | Phase 1 |
| GET / PATCH | /api/users/me | Profil sendiri. PATCH hanya name, username, bio, avatar |
| GET | /api/users/search?q=&limit= | Cari username / accountId / nama (maks. 20 hasil) |
| GET | /api/users/:username, /api/users/id/:accountId | Profil pengguna |
| GET | /api/users/avatar/:accountId | Foto profil (JPEG/PNG/WebP, di-cache) |
| GET | /api/conversations?limit=&before= | Daftar chat, urut lastMessageAt desc |
| POST | /api/conversations/private | `{userId}`: buka/buat chat 1-on-1 (tidak pernah ganda) |
| GET | /api/conversations/:id | Detail percakapan (hanya peserta) |
| GET | /api/conversations/:id/messages?limit=&before= | Pesan terbaru dulu, `before` = id pesan tertua yang sudah dimuat |
| PATCH / DELETE | /api/messages/:id | Edit / hapus (soft delete) pesan sendiri |

## Event Socket.IO

Autentikasi memakai cookie JWT yang sama; `userId` selalu dari token, tidak pernah dari client. Event dari client memakai ack `{ok, ...}` atau `{ok:false, error}`.

| Event | Arah | Payload |
|-------|------|---------|
| conversation:join / conversation:leave | client -> server | `{conversationId}` (join divalidasi keanggotaan) |
| message:send | client -> server | `{conversationId, content, replyTo?}` |
| message:new | server -> kedua peserta | `{message, conversation}` |
| message:edit / message:delete | dua arah | in: `{messageId, content?}` · out: `{message, isLast}` |
| message:reaction | dua arah | in: `{messageId, emoji}` · out: `{messageId, conversationId, reactions}` |
| message:read | dua arah | in: `{conversationId}` · out: `{conversationId, readerId, readAt}` |
| message:typing:start / :stop | dua arah | `{conversationId}` (hanya realtime, tidak ke database) |
| user:online / user:offline | server -> lawan bicara | `{userId}` / `{userId, lastSeen}` |

Room: `user:<id>` (otomatis saat connect) dan `conversation:<id>` (saat percakapan dibuka, hanya untuk typing).
Rate limit: kirim 30/menit, reaksi 60/menit, edit+hapus 30/menit, baca 120/menit, typing 40/10 detik.

## Phase 3

### Batas (server-side)
| Item | Batas |
|------|-------|
| Anggota grup | 500 (dicek atomik di query `$push`) |
| Pengikut saluran | 10.000 (dicek atomik di query `$inc`) |
| Story | gambar 10 MB, video 25 MB & maks. 60 detik, aktif 24 jam (jam server), maks. 30 story aktif / user |
| Foto grup/saluran | 60 KB (di-resize di browser) |
| Rate limit | buat grup 5/jam · buat saluran 3/jam · story 20/hari · undang anggota 60/jam · follow 100/jam · post saluran 60/jam · reaksi story & saluran 60/menit |

### Endpoint
- **Grup** `/api/groups`: `POST /`, `GET|PATCH|DELETE /:id`, `GET|POST /:id/members`, `DELETE /:id/members/:userId`, `POST|DELETE /:id/admins/:userId`, `POST /:id/transfer/:userId`, `POST /:id/leave`, `PUT /:id/mute`. Chat grup memakai Conversation/Message Phase 2 (`type: "group"`).
- **Story** `/api/stories`: `POST /` (badan biner mentah; `?caption=&privacy=`), `GET /`, `GET /user/:userId`, `GET|DELETE /:id`, `POST /:id/view`, `POST /:id/reaction`, `POST /:id/reply`, `GET /:id/viewers`.
- **Saluran** `/api/channels`: `POST /`, `GET /?scope=following|discover&q=&skip=&limit=`, `GET|PATCH|DELETE /:id`, `POST|DELETE /:id/follow`, `PUT /:id/mute`, `POST|DELETE /:id/admins/:userId`, `GET|POST /:id/posts` (`limit`, `before`), `POST /:id/pin/:postId`; `/api/channel-posts/:id`: `PATCH`, `DELETE`, `POST /reaction`, `POST /view`.
- **Media** `GET /api/media/:filename` (wajib login).

### Event Socket.IO baru (server -> client)
`group:create`, `group:update`, `group:member:add`, `group:member:remove`, `group:member:role`, `group:leave`, `group:delete`, `story:new`, `story:view`, `story:reaction`, `story:delete`, `channel:post:new`, `channel:post:edit`, `channel:post:delete`, `channel:post:pin`, `channel:post:reaction`, `channel:update`, `channel:delete`. Dari client: `channel:join`, `channel:leave` (room `channel:<id>`). Pesan grup memakai event `message:*` dan room `conversation:<id>` yang sama dengan Phase 2.

### Media
`services/mediaService.js` adalah lapisan abstraksi; driver saat ini **disk lokal** di `UPLOAD_DIR` (default `./uploads`, di luar folder `client/`). File diberi nama acak 128-bit, formatnya dideteksi dari isi file (magic bytes, bukan Content-Type), durasi video dibaca dari header MP4/WebM, dan file hanya disajikan lewat `/api/media/:filename` (login wajib, Range didukung). Untuk production ganti objek `driver` dengan object storage (S3/R2).

### Keputusan desain
- **Privasi story** per story: `contacts` (default; = pengguna yang sudah punya chat pribadi berisi pesan denganmu), `everyone`, atau `nobody`. Feed hanya berisi story kontak; difilter di server.
- **Story tanpa TTL index** pada koleksi Story: file media harus ikut dihapus, jadi dokumen kedaluwarsa dibersihkan oleh *sweeper* tiap 10 menit (dan selalu difilter `expiresAt > now` saat dibaca). `StoryView` memakai TTL index sebagai cadangan.
- **Role dibaca dari database**: pemilik/admin grup, pemilik/admin saluran. Admin grup boleh edit info dasar, tambah anggota, dan mengeluarkan anggota biasa; hanya pemilik yang mengatur admin, memindahkan kepemilikan, dan menghapus grup. Pemilik tidak bisa keluar sebelum memindahkan kepemilikan.
- **Reaksi saluran** disimpan di koleksi `ChannelReaction` (unique `postId+userId`) dengan penghitung di post, **view** di `ChannelPostView` (unique `postId+userId`).
- Saluran bersifat publik untuk dibaca; hanya pengikut yang bisa bereaksi, hanya pemilik/admin yang bisa memposting. `verified` tidak pernah dibaca dari input.
- Balasan story = pesan di chat pribadi Phase 2 (`storyRef` hanya diisi server).

## Phase 4

### Environment variable baru
| Variabel | Fungsi |
|----------|--------|
| `OWNER_NAME`, `OWNER_USERNAME`, `OWNER_EMAIL`, `OWNER_PASSWORD` | Akun Owner platform. Dibuat otomatis saat server start jika belum ada Owner (password min. 10 karakter, tidak ada di dalam kode). |
| `STUN_URLS` | Server STUN (default STUN publik Google). |
| `TURN_URLS`, `TURN_USERNAME`, `TURN_PASSWORD` | Opsional, dibutuhkan untuk jaringan dengan NAT ketat/seluler. |
| `UPLOAD_DIR` | Folder penyimpanan media (di luar `client/`). |

### Bootstrap Owner
Setelah MongoDB terhubung server mencari `role = owner`. Jika ada: dipakai. Jika tidak: dibuat dari `OWNER_*` (`role: owner`, `verified: true`). Restart tidak membuat Owner kedua: ada unique partial index `{role: 1}` untuk `role: "owner"`. Jika `OWNER_*` kosong atau bentrok dengan akun biasa, server hanya menulis peringatan. Owner tetap pengguna normal (chat, grup, saluran, story, panggilan) dan **tidak** otomatis menjadi admin grup/saluran mana pun, tidak bisa membaca chat pribadi, dan tidak bisa melihat password. Role dibaca dari database pada setiap request (`requireOwner`).

### Database baru / diubah
| Model | Isi | Index |
|-------|-----|-------|
| `User` (diubah) | `email` (lowercase), `role`, `banned`, `deleted`, `tokenVersion`, `settings` | `email` unique (partial), `role` unique (partial, hanya `owner`) |
| `Block` | `blockerId`, `blockedId` | `(blockerId, blockedId)` unique, `blockedId` |
| `Report` | pelapor, terlapor, kategori, status, catatan | `(status, createdAt)`, `(reporterId, targetId, status)` |
| `Call` | penelepon, penerima, tipe, status, durasi, `hiddenBy` | `(callerId, startedAt)`, `(calleeId, startedAt)` |
| `Message` (diubah) | `type` + `attachment` (image/video/audio/voice/file) | `attachment.url` (sparse) |
| `ChannelPost` (diubah) | `kind` + `attachment` | - |
| `Group` (diubah) | `inviteToken`, `mutes[{user, until}]` | `inviteToken` unique (partial) |

### Endpoint baru
- **Akun**: `POST /api/auth/register` (name, username, **email**, password, confirmPassword), `POST /api/auth/password`, `POST /api/auth/logout-all`, `DELETE /api/auth/account`, `PATCH /api/users/me/settings`, `PUT /api/users/me/email`. `GET /api/users/:username` kini mengembalikan `blocked`.
- **Block/Report**: `GET /api/blocks`, `POST|DELETE /api/blocks/:userId`, `POST /api/reports`.
- **Owner** (`/api/owner`, hanya role `owner`): `GET /stats`, `GET /users`, `POST /users/:id/ban|unban|verify|unverify`, `GET /reports`, `POST /reports/:id/resolve`, `GET /channels`, `POST /channels/:id/verify|unverify`.
- **Media chat**: `POST /api/conversations/:id/attachments?kind=&name=&caption=&duration=` (badan biner mentah). `GET /api/media/:filename` kini memeriksa keanggotaan percakapan untuk lampiran chat.
- **Panggilan**: `GET /api/calls`, `DELETE /api/calls/:id`, `DELETE /api/calls`, `GET /api/calls/ice`.
- **Grup**: `GET|POST|DELETE /api/groups/:id/invite`, `GET /api/groups/join/:token`, `POST /api/groups/join/:token`, `PUT /api/groups/:id/mute` (`duration`: `1h|8h|1w|always|off`).
- **Saluran**: `GET /api/channels/by-username/:username`, `POST /api/channels/:id/transfer/:userId`, `POST /api/channels/:id/posts/attachment`.

### Signaling WebRTC (Socket.IO)
Client -> server (dengan ack): `call:invite {calleeId, type}`, `call:ring`, `call:accept`, `call:reject`, `call:offer {sdp}`, `call:answer {sdp}`, `call:ice-candidate {candidate}`, `call:end`. Server -> client: `call:invite`, `call:ring`, `call:accept`, `call:handled` (tab lain berhenti berdering), `call:offer`, `call:answer`, `call:ice-candidate`, `call:end {reason, status, duration}`.
Server memvalidasi: autentikasi, peserta panggilan, socket yang terdaftar (offer/answer/ICE hanya diteruskan antar dua socket peserta), status block (dua arah, pesan sama), pengguna online/dibanned, bentuk dan ukuran SDP/ICE, rate limit, satu panggilan per pengguna, timeout dering 45 detik. Media tidak lewat server (peer-to-peer). Panggilan membutuhkan HTTPS (atau `localhost`).

### Batas media chat
Foto 10 MB (JPEG/PNG/WebP) · video 25 MB (MP4/WebM) · audio 15 MB (MP3/OGG/WebM) · pesan suara 5 MB dan 120 detik (MediaRecorder) · dokumen 20 MB (PDF, ZIP/DOCX/XLSX/PPTX, TXT). Format dideteksi dari signature file, nama file acak, dokumen disajikan sebagai unduhan, folder upload bukan folder static. Batas lain: grup 500 anggota, saluran 10.000 pengikut, story 10/25 MB dan 60 detik.

### Halaman (routing client, History API)
`/app`, `/stories`, `/channels`, `/channels/:id`, `/channel/:username`, `/calls`, `/chat/:id`, `/groups/:id`, `/profile`, `/profile/:username`, `/profile/id/:accountId`, `/settings`, `/settings/:bagian`, `/owner`, `/owner/users|reports|channels`, `/join/:token`. Server melayani `index.html` untuk path tersebut.

### Pengaturan yang sengaja ditampilkan
Hanya yang benar-benar bekerja: **Akun** (profil, email, Account ID, hapus akun), **Privasi** (tampilkan status online, privasi story bawaan, pengguna diblokir), **Obrolan** (Enter untuk kirim), **Panggilan** (pilih mikrofon/kamera/speaker, lokal), **Tampilan** (tema, ukuran teks), **Keamanan** (ubah password, keluar dari semua sesi), **Tentang**. Notifikasi, penyimpanan/data, latar chat, unduh otomatis, arsip/hapus chat, privasi foto/bio, dan daftar sesi aktif **tidak ditampilkan** karena belum ada backend/fitur nyatanya.

### Status pengujian (jujur)
Dijalankan di lingkungan pengembangan tanpa jaringan/MongoDB/browser: sintaks seluruh file, referensi antar-modul server dan client, id elemen HTML vs JS, validasi lampiran (PDF/ZIP/TXT/MP3/OGG/WebM/M4A/PNG/MP4 diterima; EXE, skrip, HTML berkedok audio, PDF sebagai gambar, dan file terlalu besar ditolak), validator email, dan simulasi alur signaling panggilan dengan model di-stub (invite, busy, accept, offer/answer/ICE, pemalsuan oleh pihak yang salah, block, offline, reject, cancel, end). **Belum diuji**: alur MongoDB sebenarnya, WebRTC antar perangkat, MediaRecorder, dan tata letak di browser. Ikuti daftar uji di bawah.

### Daftar uji manual
1. Register (duplikat username/email, email tidak valid, password beda) -> login/logout; Owner dibuat saat start, login sebagai Owner dan buka `/owner`.
2. Owner: verifikasi/cabut, ban/pulihkan (user yang diban langsung terputus), selesaikan laporan, verifikasi saluran.
3. Block: A blokir B -> B tidak bisa kirim pesan/menelepon; A buka blokir.
4. Chat: kirim foto, video, audio, dokumen, file tidak valid, file terlalu besar; progress/batal; pesan suara (tahan, lepas, geser kiri untuk batal), putar/jeda.
5. Panggilan: dua browser/perangkat (HTTPS), suara dan video; terima/tolak/akhiri, mute, kamera, ganti kamera, riwayat di `/calls`, telepon lagi, hapus.
6. Grup: link undangan (buat, salin, gabung dari akun lain, cabut, buat baru), mute 1 jam/8 jam/1 minggu, transfer kepemilikan, keluar, hapus.
7. Saluran: posting teks/foto/video/audio/dokumen, pin, reaksi, tautan `/channel/<username>`, transfer kepemilikan.
8. Responsif: 360, 390, 414, 600, 768, 1024, 1440 px tanpa scroll horizontal.

### Belum dikerjakan di Phase 4 (jujur)
Bagian Media/Shared Content/Groups di halaman profil, tab Media/Link di profil grup, waveform pesan suara (hanya progress bar), pratinjau tautan, sembunyikan status online dari orang yang memblokir, privasi foto/bio/read receipt, notifikasi, dan desain ulang UI total (yang ada: pembaruan token visual, tipografi, komponen baru). Panggilan grup tidak ada.

## Phase 4 — UI/UX Finalization

Hanya frontend (`client/`) yang diubah; backend, API, event Socket.IO, dan signaling WebRTC tidak disentuh.

### Struktur CSS
`style.css` (design system: token warna/bentuk/bayangan/gerak, mode terang & gelap, base, shell) → `components.css` → `responsive.css` → `ui.css` (lapisan visual premium, dimuat terakhir). Nama variabel lama dipertahankan sebagai alias (`--muted` = `--text-secondary`, dst.). Kontras token dihitung dengan rumus WCAG: semua teks utama/sekunder/status/tombol >= 4.5:1 di mode terang dan gelap; `--text-muted` hanya untuk elemen dekoratif.

### Yang diubah
- **Design system**: primary biru `#4260ea`, secondary violet, token `--surface-soft/--surface-elevated/--border-strong/--success-text/--danger-text`, skala radius, bayangan, durasi 160/220 ms. Dark mode berlapis (background, surface, elevated, border), bukan sekadar hitam.
- **App shell**: logo di header mobile, navigasi bawah dengan indikator aktif dan badge pesan belum dibaca (angka dari server), sidebar desktop ringkas dengan kartu profil + Pengaturan di bawah, menu ⋮ berikon (dropdown di layar lebar, bottom sheet di HP) dan Owner Panel hanya tampil untuk role owner.
- **Chat**: daftar chat dengan avatar 48 px, indikator online, badge verified, badge unread, hover/active halus; pencarian membulat dengan tombol hapus; ruang chat dengan latar titik halus, bubble baru (keluar bergradien tipis), pengelompokan pesan beruntun, pemisah tanggal, pemisah "Pesan belum dibaca", animasi pesan masuk, indikator mengetik (titik animasi + status di header), composer bergaya pill.
- **Media**: gambar membulat dan lazy, video dengan thumbnail + tombol putar + durasi (tanpa autoplay), audio dengan pemutar kustom, dokumen berupa kartu (ikon tipe, nama, tipe · ukuran, tombol unduh), pesan suara dengan pemutar kustom, pratinjau lampiran sebagai bottom sheet.
- **Profil**: banner gradien, avatar besar, verified badge, tombol Pesan/Suara/Video/Bagikan, baris Blokir/Laporkan bergaya daftar.
- **Pengaturan**: kartu profil di atas, daftar kategori berikon dengan chevron, bagian berkartu dengan baris + garis pemisah, switch, kontrol segmented.
- **Story**: cincin berwarna untuk belum dilihat dan cincin redup untuk sudah dilihat, penampil terpusat dengan backdrop di desktop dan layar penuh di HP.
- **Grup / Saluran**: header grup lebih besar, chip Pemilik/Admin/Online, tombol "Buka percakapan grup"; feed saluran bergaya sosial (avatar + nama + waktu per postingan, reaksi, view).
- **Panggilan**: latar gradien gelap, avatar besar dengan animasi berdering, tombol kontrol berlabel, kartu panggilan masuk; riwayat panggilan memakai ikon masuk/keluar/terlewat.
- **Umum**: skeleton berbentuk baris, empty state dengan tombol aksi yang berfungsi (Chat baru, Buat story, Jelajahi saluran), toast berikon (sukses/error/peringatan/info), dialog dengan animasi (bottom sheet di HP, kartu di layar lebar, ESC dan fokus bawaan `<dialog>`), transisi halaman, `prefers-reduced-motion` dihormati, halaman login/register dirapikan.

### Status verifikasi (jujur)
Dilakukan: sintaks seluruh JS, id elemen HTML vs JS, kelas yang dipakai vs aturan CSS, tombol ikon tanpa `aria-label`, pencarian lebar tetap berisiko, pemuatan semua modul client di sandbox dan cek pemanggilan lintas modul, serta perhitungan kontras warna.
**Belum dilakukan:** menjalankan aplikasi, melihat tampilan di browser, memeriksa console, dan uji ukuran layar 360-1920 px. Lingkungan pengembangan ini tidak punya browser maupun MongoDB, jadi kualitas visual dan responsivitas **belum terverifikasi secara visual**. Silakan buka tiap halaman di DevTools (mode HP + desktop, terang + gelap) dan laporkan hal yang janggal.

### Belum ada / tidak ditampilkan
Bagian Media/Shared/Groups di profil; tab Media/Link di profil grup; waveform pesan suara (yang ada: bar progres bersegmen, bukan amplitudo asli); indikator "dibisukan" dan "disematkan" di daftar chat (datanya belum ada di API); indikator mengetik di daftar chat (hanya di percakapan yang terbuka); jumlah anggota online di grup (hanya chip per anggota); tautan Terms/Privacy/Support; kolom pencarian global di header desktop (pencarian tetap di daftar Chat); gesture swipe; emoji picker; kumpulan komponen `BottomSheet/Dropdown` terpisah (dialog + CSS dipakai sebagai gantinya).

## Keamanan yang sudah ada

- Password di-hash bcryptjs (cost 12), tidak pernah dikirim ke frontend (`select: false` + `toPublic()`).
- Sesi: JWT 7 hari di cookie `httpOnly`, `sameSite=lax`, `secure` saat production.
- Validasi input di server (nama, username, password), username reserved, pesan login seragam + hash dummy (anti user enumeration).
- Rate limit: 20 percobaan/15 menit untuk login/register, 600 request/15 menit untuk seluruh `/api`.
- helmet + Content-Security-Policy ketat (tanpa inline script/style), body JSON dibatasi 10 KB.
- Error handler terpusat; stack trace hanya di log server.
- `verified` tidak pernah dibaca dari input user.
- Account ID: `crypto.randomInt`, unique index, `immutable` di schema.

## Phase 2: catatan desain

- Dependency baru hanya `socket.io`. Klien browser dilayani server di `/socket.io/socket.io.js` (same-origin, lolos CSP), jadi `socket.io-client` dari npm tidak diperlukan.
- `Conversation.participantKey` (id terurut, unique) menjamin satu percakapan per pasangan user, juga saat dua user membuka chat bersamaan.
- Unread count disimpan di `Conversation.unread[userId]` dan di-reset server saat `message:read`.
- Foto profil: di-crop dan di-resize 192px di browser, disimpan sebagai biner kecil (maks. 60 KB) dan disajikan lewat endpoint; tidak ada sistem upload umum (menyusul di fase media).
- Edit pesan dibatasi 15 menit (waktu server). Hapus = soft delete (`deleted: true`, `content: null`, reaksi dikosongkan).
- Satu reaksi per user per pesan: emoji sama = hapus, emoji lain = ganti.
- Presence: penghitung koneksi per user di memori server; offline hanya saat koneksi terakhir putus, `lastSeen` memakai jam server.

## Catatan responsive

- Mobile-first: gaya dasar untuk HP, `responsive.css` menambah breakpoint 360 / 600 / 768 / 1024 / 1440.
- `100dvh`, `viewport-fit=cover`, dan `env(safe-area-inset-*)` untuk notch dan keyboard.
- Input 16px (mencegah zoom otomatis iOS), touch target >= 44px, tanpa lebar tetap yang bisa overflow.
- Navigasi: bottom bar di HP, sidebar mulai 1024px. Dark mode: Terang / Gelap / Sistem.

## Catatan struktur

Folder `server/services` dan `server/sockets` belum dibuat karena belum dipakai; keduanya ditambahkan di Phase 2 dan 5 sesuai struktur yang diminta. File `ui.js`, `api.js`, dan `theme.js` ditambahkan di `client/js` sebagai helper bersama.
