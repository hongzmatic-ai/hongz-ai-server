'use strict';

const express = require('express');
const { twiml } = require('twilio');
const OpenAI = require('openai');
const twilio = require('twilio');

const app = express();

// Twilio kirim webhook sebagai x-www-form-urlencoded.
// Kita pakai parser bawaan express.
app.use(express.urlencoded({ extended: false }));

// ===== ENV =====
const PORT = process.env.PORT || 3000;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_NUMBER = process.env.TWILIO_NUMBER; // nomor Twilio / WA sender (untuk handoff)
const ADMIN_WA = process.env.ADMIN_WA; // nomor admin Hongz, format +62...
const MODEL = process.env.MODEL || 'gpt-4o-mini';
const VERIFY_TWILIO_SIGNATURE = (process.env.VERIFY_TWILIO_SIGNATURE || 'false').toLowerCase() === 'true';

if (!OPENAI_API_KEY) console.warn('⚠️ Missing OPENAI_API_KEY');
if (!TWILIO_ACCOUNT_SID) console.warn('⚠️ Missing TWILIO_ACCOUNT_SID');
if (!TWILIO_AUTH_TOKEN) console.warn('⚠️ Missing TWILIO_AUTH_TOKEN');
if (!TWILIO_NUMBER) console.warn('⚠️ Missing TWILIO_NUMBER');
if (!ADMIN_WA) console.warn('⚠️ Missing ADMIN_WA');

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// Optional client untuk handoff ke admin via Twilio send (kalau diperlukan)
const twilioClient =
  (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN)
    ? twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
    : null;

// ===== MEMORY (in-memory) =====
// Catatan: memory ini hilang kalau Render restart. Untuk level berikutnya kita pindah ke DB/Redis.
const sessions = new Map(); // key: fromNumber, value: { history: [], lastSeen, cooldownUntil }
const MAX_HISTORY = 10;

// ===== Helpers =====
function now() { return Date.now(); }

function getSession(from) {
  if (!sessions.has(from)) {
    sessions.set(from, { history: [], lastSeen: now(), cooldownUntil: 0 });
  }
  const s = sessions.get(from);
  s.lastSeen = now();
  return s;
}

function addHistory(session, role, content) {
  session.history.push({ role, content });
  if (session.history.length > MAX_HISTORY) session.history.shift();
}

function normalizeText(t = '') {
  return String(t).trim();
}

function detectIntent(textRaw) {
  const t = normalizeText(textRaw).toLowerCase();

  // greeting / empty
  if (!t || t === 'halo' || t === 'hai' || t === 'hi' || t === 'pagi' || t === 'siang' || t === 'malam') return 'GREETING';

  // booking/admin
  if (/(booking|boking|jadwal|reservasi|antri|antrian|daftar|pesan|appointment|admin|cs|operator)/.test(t)) return 'BOOKING';

  // lokasi/jam
  if (/(alamat|lokasi|maps|peta|rute|arah|di mana|dimana|jam buka|buka jam|tutup jam|operasional)/.test(t)) return 'LOCATION';

  // harga
  if (/(berapa|biaya|harga|tarif|ongkos|estimasi|kisaran)/.test(t)) return 'PRICE';

  // keluhan (triase)
  if (/(nyentak|selip|dengung|getar|jedug|hentak|brebet|delay|telat|overheat|panas|lampu|check|indikator|error|gigi|kickdown|slip|cvt|matic|transmisi)/.test(t)) return 'COMPLAINT';

  return 'GENERAL';
}

function quickMenu() {
  return (
`Halo 👋 Terima kasih sudah menghubungi *Hongz Bengkel Spesialis Transmisi Matic Medan*.

Biar cepat, pilih salah satu ya:
1) Tanya harga / estimasi
2) Keluhan matic (nyentak/selip/dengung/delay)
3) Booking jadwal
4) Lokasi & jam buka
5) Bicara dengan admin

Balas angka *1-5* 🙂`
  );
}

function mapNumberMenuIntent(textRaw) {
  const t = normalizeText(textRaw);
  if (t === '1') return 'PRICE';
  if (t === '2') return 'COMPLAINT';
  if (t === '3') return 'BOOKING';
  if (t === '4') return 'LOCATION';
  if (t === '5') return 'BOOKING';
  return null;
}

// SOP system prompt Hongz
function buildSystemPrompt(intent) {
  return (
`Kamu adalah "Hongz AI Customer Service" untuk bengkel transmisi matic di Medan.
Gaya bicara: ramah, profesional, singkat, jelas, membantu, tidak lebay.
Tujuan: bantu pelanggan memahami masalah, memberi estimasi wajar (range), mengajak cek/booking, dan kalau perlu handoff ke admin.

ATURAN WAJIB:
- Jangan klaim "pasti" tanpa pengecekan. Gunakan "biasanya/umumnya/tergantung kondisi".
- Untuk pertanyaan harga: beri range + jelaskan faktor yang mempengaruhi + minta detail (mobil, tahun, keluhan, sudah pernah servis, odo) + ajak booking inspeksi.
- Untuk keluhan: lakukan triase singkat (tanya gejala, kapan terjadi, kondisi, ada indikator lampu?) + beri langkah aman + sarankan diagnosa.
- Selalu tutup dengan 1 pertanyaan lanjutan yang jelas dan CTA (booking / kirim detail / share lokasi).
- Jangan minta data sensitif (OTP, password, dsb).

KONTEKS LAYANAN (boleh disebut):
- Diagnosa transmisi matic, ganti oli matic, flushing sesuai kebutuhan, perbaikan CVT/AT/DSG, valve body/solenoid, torque converter, overhaul.
- Estimasi akurat setelah pengecekan.

INTENT SAAT INI: ${intent}`
  );
}

function buildUserPrompt(intent, incoming) {
  // Kita arahkan format agar AI fokus
  if (intent === 'PRICE') {
    return (
`Pelanggan bertanya soal HARGA. Pertanyaan pelanggan: "${incoming}"
Tolong jawab dengan:
1) range estimasi (jika memungkinkan), 
2) faktor penentu harga,
3) 3-5 pertanyaan detail yang perlu ditanyakan,
4) ajak booking/cek.
Jawab dalam Bahasa Indonesia.`
    );
  }

  if (intent === 'LOCATION') {
    return (
`Pelanggan bertanya LOKASI/JAM BUKA. Pertanyaan: "${incoming}"
Jawab singkat. Jika tidak ada alamat pasti yang diberikan sistem, minta pelanggan ketik "share lokasi" atau minta admin kirim maps link.
Tutup dengan CTA.`
    );
  }

  if (intent === 'COMPLAINT') {
    return (
`Pelanggan menyampaikan KELUHAN transmisi matic. Pesan: "${incoming}"
Tolong:
- lakukan triase singkat (tanya 4-6 hal penting),
- beri saran aman (jangan memaksakan jalan jika parah),
- sarankan diagnosa/booking.
Tutup dengan pertanyaan lanjutan yang jelas.`
    );
  }

  if (intent === 'BOOKING') {
    return (
`Pelanggan ingin BOOKING / bicara admin. Pesan: "${incoming}"
Tolong minta format data booking:
Nama, Mobil+Tahun, Keluhan, Lokasi (Medan area?), dan rencana datang (hari/jam).
Tutup dengan konfirmasi bahwa admin bisa follow up.`
    );
  }

  return (
`Pesan pelanggan: "${incoming}"
Tolong jawab sesuai SOP Hongz: jelas, singkat, dan tutup dengan 1 pertanyaan + CTA.`
  );
}

async function askAI({ intent, session, incoming }) {
  const messages = [];

  // system
  messages.push({ role: 'system', content: buildSystemPrompt(intent) });

  // memory (history)
  for (const h of session.history) messages.push(h);

  // user prompt wrapper
  messages.push({ role: 'user', content: buildUserPrompt(intent, incoming) });

  const resp = await openai.chat.completions.create({
    model: MODEL,
    messages,
    temperature: 0.4
  });

  const text = resp.choices?.[0]?.message?.content?.trim();
  return text || 'Maaf, boleh ulangi pertanyaannya ya?';
}

async function notifyAdminIfNeeded({ from, incoming, intent }) {
  if (!twilioClient || !ADMIN_WA || !TWILIO_NUMBER) return;

  // Handoff rule: kalau booking/admin
  if (intent !== 'BOOKING') return;

  const msg =
`[LEAD WA - Hongz]
Dari: ${from}
Pesan: ${incoming}
Intent: ${intent}

Mohon follow up pelanggan ya.`;

  try {
    await twilioClient.messages.create({
      from: `whatsapp:${TWILIO_NUMBER}`,
      to: `whatsapp:${ADMIN_WA}`,
      body: msg
    });
  } catch (e) {
    console.error('Admin notify failed:', e?.message || e);
  }
}

function verifyTwilioSignature(req) {
  if (!VERIFY_TWILIO_SIGNATURE) return true;
  if (!TWILIO_AUTH_TOKEN) return false;

  const signature = req.headers['x-twilio-signature'];
  if (!signature) return false;

  // URL harus full URL yang Twilio hit ke webhook
  // Render umumnya pakai https, jadi kita bentuk dari host + path
  const fullUrl = `https://${req.headers.host}${req.originalUrl}`;
  return twilio.validateRequest(TWILIO_AUTH_TOKEN, signature, fullUrl, req.body);
}

// ===== Routes =====
app.get('/', (req, res) => {
  res.status(200).send('Hongz AI WhatsApp Server is running 🚀');
});

app.post('/webhook', async (req, res) => {
  const twimlResponse = new twiml.MessagingResponse();

  try {
    if (!verifyTwilioSignature(req)) {
      twimlResponse.message('Request tidak valid.');
      return res.type('text/xml').status(403).send(twimlResponse.toString());
    }

    const from = req.body.From; // contoh: whatsapp:+628xxxx
    const incomingRaw = req.body.Body;

    const incoming = normalizeText(incomingRaw);
    console.log('Incoming message:', { from, incoming });

    if (!from) {
      twimlResponse.message('Maaf, format pesan tidak terbaca.');
      return res.type('text/xml').send(twimlResponse.toString());
    }

    const session = getSession(from);

    // Simple cooldown anti spam (3 detik)
    if (session.cooldownUntil > now()) {
      twimlResponse.message('Sebentar ya 🙂');
      return res.type('text/xml').send(twimlResponse.toString());
    }
    session.cooldownUntil = now() + 3000;

    // Menu mapping angka 1-5
    const mapped = mapNumberMenuIntent(incoming);
    let intent = mapped || detectIntent(incoming);

    // Kalau greeting, kirim menu cepat tanpa panggil AI
    if (intent === 'GREETING') {
      twimlResponse.message(quickMenu());
      return res.type('text/xml').send(twimlResponse.toString());
    }

    // Simpan history user
    addHistory(session, 'user', incoming);

    // Panggil AI
    const aiReply = await askAI({ intent, session, incoming });

    // Simpan history assistant
    addHistory(session, 'assistant', aiReply);

    // Jika booking/admin, notify admin (opsional)
    notifyAdminIfNeeded({ from, incoming, intent }).catch(() => {});

    twimlResponse.message(aiReply);
    return res.type('text/xml').send(twimlResponse.toString());

  } catch (err) {
    console.error('Webhook error:', err?.message || err);
    twimlResponse.message('Maaf, sistem sedang sibuk. Boleh coba lagi sebentar ya 🙏');
    return res.type('text/xml').send(twimlResponse.toString());
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
