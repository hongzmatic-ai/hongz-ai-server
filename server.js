/**
 * HONGZ AI SERVER ...
 */

/**
 * HONGZ AI SERVER — HYBRID C+ ELITE (ONE FILE) — RAJA MEDAN FINAL (STABLE)
 * deps: express, body-parser, twilio, openai (^4)
 */

const express = require('express');
const bodyParser = require('body-parser');
const twilio = require('twilio');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const OpenAI = require("openai");
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function buildClosingSystemPrompt() {
  return `
Anda adalah Senior Technical Advisor + CS Profesional untuk "Hongz Bengkel Spesialis Transmisi Matic" di Medan.

IDENTITAS:
- Spesialis transmisi matic, CVT, torque converter, valve body
- Fokus solusi, bukan coba-coba
- Profesional, transparan, bergaransi

GAYA KOMUNIKASI:
- Ramah tapi tegas
- Profesional (bukan gaya anak magang)
- Bahasa WhatsApp natural
- Tidak bertele-tele
- Maksimal 8–12 baris (kecuali benar-benar perlu)

ATURAN DIAGNOSA:
- Jawab dengan struktur A-B-C-D (WAJIB)
- Tanyakan maksimal 2–4 pertanyaan kunci (jangan kebanyakan)
- Jangan mengada-ngada
- Jika info kurang → minta detail spesifik
- Jangan mengulang pertanyaan yang sudah dijawab pelanggan
- Jangan bahas AC kalau pelanggan sedang tanya matic (kecuali pelanggan memang tanya AC)

FORMAT JAWABAN (A-B-C-D):
A) Analisa kemungkinan penyebab (maks 3 poin, paling mungkin dulu)
B) Pertanyaan klarifikasi (2–4 pertanyaan kunci)
C) Langkah aman yang bisa dilakukan sekarang (opsional, singkat)
D) Arahkan tindakan: booking / datang cek / kirim video / towing jika darurat

JIKA PELANGGAN TANYA HARGA:
- Jelaskan value: diagnosa akurat, transparan, garansi
- Ajak cek langsung agar pasti (hindari janji harga sebelum diagnosa)

SELALU tutup dengan CTA singkat:
Balas: JADWAL / MAPS / TOWING

CATATAN:
- Jika pelanggan hanya kirim “halo/tes/123”, balas singkat & arahkan ke keluhan utama.
- Jangan terlalu “sales”, tetap dominan teknisi/diagnosa center.
`.trim();
}
async function gptReply({ customerText, memoryText = "", lane = "GENERAL" }) {
  const model = process.env.AI_MODEL || "gpt-4.1-mini";
  const maxTokens = Number(process.env.MAX_OUT_TOKENS || 260);
  const temperature = Number(process.env.TEMPERATURE || 0.4);

  const messages = [
    { role: "system", content: buildClosingSystemPrompt() },
    ...(memoryText ? [{ role: "system", content: `MEMORY PELANGGAN:\n${memoryText}` }] : []),
    { role: "user", content: `LANE: ${lane}\nPESAN PELANGGAN:\n${customerText}` },
  ];

  const resp = await openai.chat.completions.create({
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
  });

  return resp.choices?.[0]?.message?.content?.trim() || "";
}

// ===== Build AI Context dari Memory =====
function buildAIContext(db, customerId, body) {
  const customer = db.customers[customerId];
  if (!customer) return body;

  const profile = customer.profile || {};
  const history = customer.history || [];

  const historyText = history
    .slice(-5)
    .map((h, i) => `${i + 1}. ${h.issue || ""}`)
    .join("\n");

  return `
DATA PELANGGAN:
Nama: ${profile.name || "-"}
Mobil: ${profile.car || "-"}
Kota: ${profile.city || "-"}
Keluhan Terakhir: ${profile.lastIssue || "-"}

RIWAYAT SINGKAT:
${historyText || "-"}

PESAN TERBARU:
${body}

Jawab sebagai asisten bengkel profesional Hongz Bengkel Matic.
Fokus solusi, jelas, dan jangan ulang pertanyaan yang sudah dijawab.
`;
}


// ---------------- ENV ----------------
const PORT = process.env.PORT || 10000;

const {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_WHATSAPP_FROM, // e.g. whatsapp:+14155238886
  ADMIN_WHATSAPP_TO,    // e.g. whatsapp:+62813xxxx

  // (Optional)
  TWILIO_WEBHOOK_URL = '',

  // RADAR MONITOR
  MONITOR_WHATSAPP_TO = '',
  MONITOR_LEVEL = 'ALL',              // ALL | POTENTIAL | PRIORITY
  MONITOR_COOLDOWN_SEC = '20',

  // ADMIN NOTIFY
  ADMIN_NOTIFY_ENABLED = 'true',
  ADMIN_NOTIFY_KEYWORDS = '',
  ADMIN_NOTIFY_MIN_SCORE = '5',
  ADMIN_NOTIFY_COOLDOWN_SEC = '60',

  // ANTI JEBEH 3T+3M
  ANTI_JEBEH_ENABLED = 'true',
  ANTI_JEBEH_STRICT = 'true',
  ANTI_JEBEH_STRIKES_LOCK = '2',
  ANTI_JEBEH_MIN_INFO_REQUIRED = 'true',

  // AI
  OPENAI_API_KEY,
  OPENAI_MODEL_PRIMARY = process.env.OPENAI_MODEL_PRIMARY || 'gpt-4o',
  OPENAI_MODEL_FALLBACK = process.env.OPENAI_MODEL_FALLBACK || 'gpt-4o-mini',
  OPENAI_TIMEOUT_MS = '9000',
  OPENAI_MAX_OUTPUT_TOKENS = '260',
  OPENAI_TEMPERATURE = '0.30',

  // ARENA CONTROL
  ARENA_CONTROL_ENABLED = 'true',
  PRIORITY_ROUTING = '1,2,3,4',       // 1 URGENT | 2 BOOKING | 3 TECH | 4 PRICE
  ARENA_MAX_QUESTIONS = '2',

  // towing style: 1 ideal | 2 super singkat | 3 premium
  TOWING_STYLE = '3',

  // Branding
  BIZ_NAME = 'Hongz Bengkel – Spesialis Transmisi Matic',
  BIZ_ADDRESS = 'Jl. M. Yakub No.10b, Medan Perjuangan',
  BIZ_HOURS = 'Senin–Sabtu 09.00–17.00',
  MAPS_LINK = 'https://maps.app.goo.gl/CvFZ9FLNJRog7K4t9',
  WHATSAPP_ADMIN = 'https://wa.me/6281375430728',
  WHATSAPP_CS = 'https://wa.me/6285752965167',

  // Follow-up
  FOLLOWUP_ENABLED = 'true',
  FOLLOWUP_STAGE1_HOURS = '18',
  FOLLOWUP_STAGE2_HOURS = '48',
  FOLLOWUP_COOLDOWN_HOURS = '24',
  FOLLOWUP_MAX_PER_CUSTOMER = '2',

  // Storage / cron / debug
  DATA_DIR = process.env.DATA_DIR || '/tmp',
  CRON_KEY = '',
  DEBUG = 'false',
} = process.env;

const IS_DEBUG = String(DEBUG).toLowerCase() === 'true';
const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

function dlog(...args) {
  if (IS_DEBUG) console.log('[HONGZ]', ...args);
}

function envBool(v, def = false) {
  if (v === undefined || v === null || v === '') return def;
  return String(v).toLowerCase() === 'true';
}

if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_WHATSAPP_FROM || !ADMIN_WHATSAPP_TO) {
  console.error('❌ Missing ENV: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM, ADMIN_WHATSAPP_TO');
}

// ---------------- APP ----------------
const app = express();
app.use(bodyParser.urlencoded({ extended: false })); // Twilio form-urlencoded
app.use(bodyParser.json());

// ---------------- STORAGE ----------------
function ensureDir(dir) {
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
}
ensureDir(DATA_DIR);

const DB_FILE = path.join(DATA_DIR, 'hongz_enterprise_db.json');

function loadDB() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch (_) { return { customers: {}, tickets: {}, events: [] }; }
}
function saveDB(db) {
  try { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8'); }
  catch (e) { console.error('DB save failed:', e.message); }
}

function nowISO() { return new Date().toISOString(); }
function nowMs() { return Date.now(); }

function sha16(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 16);
}

function escapeXml(unsafe) {
  return String(unsafe ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function replyTwiML(res, text) {
  res.type('text/xml');
  return res.status(200).send(`<Response><Message>${escapeXml(text)}</Message></Response>`);
}

function normText(s) { return String(s || '').replace(/\u200b/g, '').trim(); }
function upper(s) { return normText(s).toUpperCase(); }

function isCommand(body, cmd) {
  const t = upper(body);
  const c = String(cmd).toUpperCase();
  return t === c || t.startsWith(c + ' ') || t.includes('\n' + c) || t.includes(' ' + c + ' ');
}

function normalizeFrom(v) { return String(v || '').trim(); }

// "whatsapp:+62813..." -> "62813..."
function cleanMsisdn(from) {
  return String(from || '').replace(/^whatsapp:\+?/i, '').replace(/[^\d]/g, '');
}
function toWaMe(from) {
  const n = cleanMsisdn(from);
  return n ? `https://wa.me/${n}` : '-';
}

function isAdmin(from) {
  const a = normalizeFrom(ADMIN_WHATSAPP_TO).toLowerCase();
  const f = normalizeFrom(from).toLowerCase();
  return a && f && a === f;
}
function isMonitor(from) {
  const m = normalizeFrom(MONITOR_WHATSAPP_TO).toLowerCase();
  const f = normalizeFrom(from).toLowerCase();
  return !!(m && f && m === f);
}

// ---------------- LOCATION PARSER ----------------
function extractLocation(reqBody) {
  const lat = reqBody?.Latitude || reqBody?.latitude;
  const lng = reqBody?.Longitude || reqBody?.longitude;

  if (lat && lng) {
    return {
      type: 'coords',
      lat: String(lat),
      lng: String(lng),
      mapsUrl: `https://www.google.com/maps?q=${encodeURIComponent(lat)},${encodeURIComponent(lng)}`
    };
  }

  const body = String(reqBody?.Body || '').trim();
  const m = body.match(/https?:\/\/(maps\.app\.goo\.gl|www\.google\.com\/maps|goo\.gl\/maps)[^\s]+/i);
  if (m) return { type: 'link', mapsUrl: m[0], raw: body };

  return null;
}

// ---------------- SIGNATURES ----------------
function confidenceLine(style = 'neutral') {
  if (style === 'casual') return '✅ Tenang ya, kita bantu sampai jelas langkahnya 🙂';
  return '✅ Tenang ya, kami bantu sampai jelas langkahnya.';
}

function signatureShort() {
  return [
    `— ${BIZ_NAME}`,
    `🧭 Maps: ${MAPS_LINK}`,
    `⏱ ${BIZ_HOURS}`,
    `📲 Admin: ${WHATSAPP_ADMIN}`,
    `💬 CS: ${WHATSAPP_CS}`,
    `Ketik *JADWAL* (booking) / *TOWING* (darurat)`,
  ].join('\n');
}

function signatureTowing(style = '3') {
  const s = String(style || '3');
  if (s === '2') {
    return [
      `— ${BIZ_NAME}`,
      `📲 Admin cepat: ${WHATSAPP_ADMIN}`,
      `Ketik *TOWING* + kirim *share lokasi*`,
    ].join('\n');
  }
  if (s === '1') {
    return [
      `— ${BIZ_NAME}`,
      `⏱ ${BIZ_HOURS}`,
      `📲 Admin: ${WHATSAPP_ADMIN}`,
      `Jika perlu cepat: klik Admin lalu bisa *telepon/voice call*.`,
    ].join('\n');
  }
  return [
    `— ${BIZ_NAME} (Precision Transmission Center)`,
    `📲 Admin prioritas: ${WHATSAPP_ADMIN}`,
    `⚡ Darurat? Klik Admin untuk *voice call* (lebih cepat koordinasi).`,
  ].join('\n');
}

// ---------------- DETECTORS (anti nyasar) ----------------
function detectNoStart(body) {
  const t = String(body || '').toLowerCase();
  return /tidak bisa hidup|gak bisa hidup|ga bisa hidup|tidak bisa starter|gak bisa starter|ga bisa starter|distarter|starter bunyi|cekrek|ngorok|aki tekor|accu tekor|lampu redup/i.test(t);
}

function detectCantDrive(body) {
  const t = String(body || '').toLowerCase();
  return /tidak bisa jalan|ga bisa jalan|gak bisa jalan|tidak bisa bergerak|ga bisa bergerak|gak bisa bergerak|stuck|macet total|selip parah|rpm naik tapi tidak jalan|masuk d.*tidak jalan|masuk r.*tidak jalan|d masuk tapi tidak jalan|r masuk tapi tidak jalan|dorong|tarik|angkut|towing|evakuasi/i.test(t);
}

function detectAC(body) {
  const t = String(body || '').toLowerCase();
  return /(^|\b)ac(\b|$)|freon|kompresor|blower|evaporator|kondensor|kipas ac|ac tidak dingin|ga dingin|gak dingin|dingin sebentar|panas lagi/i.test(t);
}

function detectPriceOnly(body) {
  return /berapa|biaya|harga|kisaran|range|murah|diskon|nego|budget/i.test(String(body || '').toLowerCase());
}

function detectPremium(body) {
  return /land cruiser|alphard|vellfire|lexus|bmw|mercedes|benz|audi|porsche|range rover|land rover|prado|lc200|lc300|rx350|mini cooper/i.test(String(body || '').toLowerCase());
}

function detectBuyingSignal(body) {
  return /kapan bisa|besok bisa|hari ini bisa|bisa masuk|siap datang|jam berapa|jam buka|alamat dimana|lokasi dimana|maps|alamat|lokasi|antri|slot|jadwal|booking/i.test(String(body || '').toLowerCase());
}

function hasVehicleInfo(body) {
  const t = String(body || '').toLowerCase();
  const hasYear = /\b(19[8-9]\d|20[0-3]\d)\b/.test(t);
  const hasBrand = /toyota|honda|nissan|mitsubishi|suzuki|daihatsu|mazda|hyundai|kia|wuling|bmw|mercedes|audi|lexus|isuzu/i.test(t);
  const hasModelCue = /innova|avanza|rush|fortuner|alphard|vellfire|freed|odyssey|mobilio|x-trail|ertiga|brio|civic|camry|yaris|calya|agya|ayla|sigra|rocky|raize|almaz|livina|xpander|pajero|lc200|lc300|rx350|minicooper/i.test(t);
  return hasYear || hasBrand || hasModelCue;
}

function hasSymptomInfo(body) {
  const t = String(body || '').toLowerCase();
  // gejala transmisi khusus
  return /rpm naik tapi tidak jalan|selip|jedug|hentak|telat masuk|telat gigi|ngelos|overheat transmisi|bau gosong|gigi d|gigi r|valve body|torque converter|atf|oli transmisi/i.test(t);
}

function askedForSchedule(body) {
  return /kapan bisa masuk|jadwal|booking|bisa hari|bisa jam|kapan bisa datang|antri|slot/i.test(String(body || '').toLowerCase());
}

// ---------------- STYLE ----------------
function detectStyle(body) {
  const t = String(body || '');
  const low = t.toLowerCase();

  const panic = /darurat|tolong|cepat|mogok|tidak bisa|gak bisa|ga bisa|stuck|bahaya/i.test(low);
  const formal = /mohon|berkenan|apabila|dengan hormat|terima kasih|pak|bu|bapak|ibu/i.test(low);
  const hasEmoji = /[\u{1F300}-\u{1FAFF}]/u.test(t);
  const short = low.length <= 18;

  if (panic) return 'urgent';
  if (formal) return 'formal';
  if (hasEmoji || short) return 'casual';
  return 'neutral';
}

function composeTone(style) {
  if (style === 'urgent') return 'tenang, sigap, menenangkan';
  if (style === 'formal') return 'sopan, profesional, rapi';
  if (style === 'casual') return 'ramah, santai, natural';
  return 'ramah-profesional, natural, enak dibaca';
}

// ---------------- 3T + 3M ----------------
function detect3T3M(body) {
  const t = String(body || '').toLowerCase();
  const murah = /(murah|termurah|diskon|promo|nego|tawar|budget|harga aja|biaya aja)/i.test(t);
  const meriah = /(paket|bonus|murah meriah|harga paket)/i.test(t);
  const mantap = /(pokoknya harus beres|harus jadi|yang penting jadi|langsung beres|pasti sembuh|jamin pasti)/i.test(t);

  const tanya2 = /(berapa|biaya|harga|kisaran|range|estimasi)/i.test(t) && t.length < 80;
  const tes2 = /(yakin bisa|bisa gak sih|bengkel lain|coba jelasin|jangan bohong|kok mahal)/i.test(t);
  const tawar2 = /(nego|tawar|diskon|kurangin|murahin)/i.test(t);

  const hit = (murah || meriah || mantap || tanya2 || tes2 || tawar2);
  return { murah, meriah, mantap, tanya2, tes2, tawar2, hit };
}

// ---------------- ADMIN KEYWORDS ----------------
const DEFAULT_ADMIN_KEYWORDS =
  'tidak bisa jalan,gak bisa jalan,ga bisa jalan,stuck,selip,rpm naik tapi tidak jalan,towing,evakuasi,dorong,tarik,angkut,jadwal,booking,bisa masuk,hari ini bisa,besok bisa,jam berapa,kapan bisa,alamat,lokasi,maps,jedug,hentak,overheat,diagnosa,tidak bisa hidup,gak bisa hidup,ga bisa hidup,ac tidak dingin';

function parseKeywords(csv) {
  return String(csv || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
}
const ADMIN_KWS = parseKeywords(ADMIN_NOTIFY_KEYWORDS || DEFAULT_ADMIN_KEYWORDS);

function matchAdminKeyword(text) {
  const t = String(text || '').toLowerCase();
  if (!t) return null;
  for (const kw of ADMIN_KWS) {
    if (kw && t.includes(kw)) return kw;
  }
  return null;
}

// ---------------- ARENA ----------------
function parsePriorityRouting(csv) {
  const arr = String(csv || '1,2,3,4').split(',').map(s => s.trim()).filter(Boolean);
  const valid = new Set(['1','2','3','4']);
  return arr.filter(x => valid.has(x));
}

function isLowEnergy(body) {
  const t = String(body || '').trim().toLowerCase();
  if (!t) return true;
  if (t.length <= 2) return true;
  return /^(p|halo|hai|test|tes|cek|cek\stest|\?)$/.test(t);
}

function arenaClassify({ body, hasLoc, cantDrive, cmdTowing, cmdJadwal, buyingSignal, scheduleAsk, priceOnly, vInfo, sInfo, suspicious }) {
  if (detectAC(body)) return { lane: 'AC', reason: 'AC_MODE' };
  if (detectNoStart(body)) return { lane: 'NO_START', reason: 'ENGINE_NO_START' };

  if (hasLoc || cantDrive || cmdTowing) return { lane: 'URGENT', reason: hasLoc ? 'HAS_LOCATION' : (cantDrive ? 'CANT_DRIVE' : 'TOWING_CMD') };
  if (cmdJadwal || scheduleAsk || buyingSignal) return { lane: 'BOOKING', reason: cmdJadwal ? 'JADWAL_CMD' : 'ASK_SCHEDULE' };
  if (priceOnly || suspicious) return { lane: 'PRICE_TEST', reason: priceOnly ? 'PRICE_ONLY' : 'SUSPICIOUS' };
  if (vInfo || sInfo) return { lane: 'TECHNICAL', reason: (vInfo && sInfo) ? 'VEHICLE+SYMPTOM' : (vInfo ? 'VEHICLE_INFO' : 'SYMPTOM_INFO') };
  if (isLowEnergy(body)) return { lane: 'LOW_ENERGY', reason: 'LOW_SIGNAL' };
  return { lane: 'GENERAL', reason: 'DEFAULT' };
}

// quick replies
function arenaReplyLowEnergy(style) {
  return [
    'Siap Bang. Biar saya arahkan cepat—mobilnya apa & tahun berapa?',
    'Keluhannya singkat saja (contoh: **tidak bisa hidup / AC tidak dingin / tidak bisa jalan**).',
    '',
    confidenceLine(style),
    '',
    signatureShort(),
  ].join('\n');
}

function arenaReplyPriceSoft(style) {
  return [
    'Untuk biaya, tergantung penyebabnya—kami hindari tebak-tebakan.',
    'Boleh info *mobil & tahun* + *keluhan utama* (1 kalimat) biar saya arahkan langkah paling tepat?',
    '',
    confidenceLine(style),
    '',
    signatureShort(),
  ].join('\n');
}

function arenaReplyPriceLock(style) {
  return [
    'Untuk harga yang akurat, kami tidak bisa tebak-tebakan tanpa diagnosa.',
    'Mohon kirim *Mobil + Tahun + Keluhan utama* (1 kalimat saja).',
    'Kalau sudah siap datang, ketik *JADWAL* biar kami bantu atur jadwal cek.',
    '',
    confidenceLine(style),
    '',
    signatureShort(),
  ].join('\n');
}

function arenaReplyBookingFast(style) {
  return [
    'Siap. Untuk booking pemeriksaan, kirim data singkat ya:',
    '1) Nama  2) Mobil & tahun  3) Keluhan utama  4) Rencana datang (hari & jam)',
    '',
    'Setelah data masuk, admin konfirmasi antrian & estimasi waktu pengecekan.',
    '',
    confidenceLine(style),
    '',
    signatureShort(),
  ].join('\n');
}

// ---------------- SUN TZU (Bunglon/Buaya/Elang/Pemancing) ----------------
function sunTzuScan(body) {
  const t = String(body || '').toLowerCase().trim();

  const vInfo = hasVehicleInfo(t);
  const sInfo = hasSymptomInfo(t);
  const cantDrive = detectCantDrive(t);
  const noStart = detectNoStart(t);
  const acScan = detectAC(t);

  const priceOnlyShort = detectPriceOnly(t) && t.length < 35;
  const egoTest = /(bengkel lain|katanya|emang bisa|yakin|kok mahal|jangan bohong|coba jelasin)/i.test(t);
  const hesitant = /(lihat dulu|nanti dulu|sekadar tanya|cuma tanya|belum tentu|masih mikir)/i.test(t);
  const urgency = /(darurat|tolong|cepat|bahaya|stuck)/i.test(t);
  const buyingSignal = detectBuyingSignal(t);
  const scheduleAsk = askedForSchedule(t);

  let score = 0;
  if (vInfo) score += 2;
  if (sInfo) score += 2;
  if (buyingSignal || scheduleAsk) score += 3;
  if (cantDrive) score += 4;
  if (noStart) score += 4;
  if (acMode) score += 2;
  if (urgency) score += 2;

  if (priceOnlyShort) score -= 2;
  if (hesitant) score -= 1;

  score = Math.max(0, Math.min(10, score));

  let intent = 'GENERAL';
  if (acMode) intent = 'AC';
  else if (noStart) intent = 'NO_START';
  else if (cantDrive || urgency) intent = 'URGENT';
  else if (buyingSignal || scheduleAsk) intent = 'BOOKING';
  else if (priceOnlyShort || egoTest) intent = 'PRICE_TEST';
  else if (vInfo || sInfo) intent = 'TECHNICAL';

  let commander = 'BUNGLON';
  if (intent === 'URGENT') commander = 'ELANG';
  else if (intent === 'PRICE_TEST' || egoTest) commander = 'BUAYA';
  else if (intent === 'BOOKING') commander = 'PEMANCING';

  let pressure = 'SOFT';
  if (score >= 7 && (intent === 'BOOKING' || intent === 'URGENT')) pressure = 'FIRM';

  return { score, intent, commander, pressure, flags: { vInfo, sInfo, cantDrive, noStart, acMode } };
}

// ---------------- TICKET MODEL ----------------
function genTicketId() {
  const n = Math.floor(10000 + Math.random() * 89999);
  return `T-${n}`;
}

function getOrCreateTicket(db, customerId, from) {
  const cust = db.customers[customerId];
  const currentTicketId = cust?.activeTicketId;

  if (currentTicketId && db.tickets[currentTicketId] && db.tickets[currentTicketId].status !== 'CLOSED') {
    return db.tickets[currentTicketId];
  }

  let tid = genTicketId();
  while (db.tickets[tid]) tid = genTicketId();

  const ticket = {
    id: tid,
    customerId,
    from,
    msisdn: cleanMsisdn(from),
    waMe: toWaMe(from),
    status: 'OPEN', // OPEN | CLAIMED | CLOSED
    createdAt: nowISO(),
    updatedAt: nowISO(),
    score: 0,
    tag: '🔵 NORMAL',
    lastBody: '',
    locationUrl: '',
    notes: [],
    type: 'GENERAL', // GENERAL | TOWING | JADWAL | AC | NO_START
    stage: 0,
    followupCount: 0,
    lastFollowupAtMs: 0,
    lastInboundAtMs: nowMs(),
    lastBotAtMs: 0,
    lastRadarAtMs: 0,
    lastAdminNotifyAtMs: 0,
    priceStrike: 0,
    lockMode: false,
    arena: { lane: 'UNKNOWN', reason: '' },
  };

  db.tickets[tid] = ticket;
  db.customers[customerId].activeTicketId = tid;
  return ticket;
}

function updateTicket(ticket, patch = {}) {
  Object.assign(ticket, patch);
  ticket.updatedAt = nowISO();
}

// ---------------- LEAD SCORE ----------------
function leadScore({ body, hasLocation, isTowingCmd, isJadwalCmd, cantDrive }) {
  let score = 0;
  if (cantDrive) score += 5;
  if (hasLocation) score += 5;
  if (isTowingCmd) score += 5;
  if (detectPremium(body)) score += 3;
  if (isJadwalCmd) score += 4;
  if (detectPriceOnly(body) && String(body || '').length < 35) score -= 2;
  score = Math.max(0, Math.min(10, score));
  return score;
}

function leadTag(score) {
  if (score >= 8) return '🔴 PRIORITY';
  if (score >= 5) return '🟡 POTENTIAL';
  return '🔵 NORMAL';
}

// ---------------- NOTIFY (Admin & Monitor) ----------------
async function notifyAdmin({ title, ticket, reason, body, locationUrl }) {
  const msg = [
    title,
    `Ticket: ${ticket.id} (${ticket.tag} | Score ${ticket.score}/10 | stage:${ticket.stage} | ${ticket.type})`,
    `Lane: ${ticket?.arena?.lane || '-'} ${ticket?.arena?.reason ? `(${ticket.arena.reason})` : ''}`,
    `Customer: ${ticket.from}`,
    `Nomor: ${ticket.msisdn}`,
    `wa.me: ${ticket.waMe}`,
    reason ? `Alasan: ${reason}` : null,
    locationUrl ? `Lokasi: ${locationUrl}` : null,
    body ? `Pesan: ${String(body).slice(0, 500)}` : null,
    '',
    `Commands: HELP | LIST | STATS | CLAIM ${ticket.id} | CLOSE ${ticket.id} | NOTE ${ticket.id} ...`,
  ].filter(Boolean).join('\n');

  await twilioClient.messages.create({
    from: TWILIO_WHATSAPP_FROM,
    to: ADMIN_WHATSAPP_TO,
    body: msg,
  });
}

function monitorAllowedByLevel(score) {
  const lvl = String(MONITOR_LEVEL || 'ALL').toUpperCase();
  if (lvl === 'PRIORITY') return score >= 8;
  if (lvl === 'POTENTIAL') return score >= 5;
  return true;
}

async function notifyMonitor({ title, ticket, body }) {
  const to = normalizeFrom(MONITOR_WHATSAPP_TO);
  if (!to) return;
  if (normalizeFrom(ADMIN_WHATSAPP_TO).toLowerCase() === to.toLowerCase()) return;

  const cd = Math.max(0, Number(MONITOR_COOLDOWN_SEC || 20)) * 1000;
  const now = nowMs();
  if (cd > 0 && ticket.lastRadarAtMs && (now - ticket.lastRadarAtMs) < cd) return;
  ticket.lastRadarAtMs = now;

  const shortMsg = (body || '').replace(/\s+/g, ' ').slice(0, 140);

  const msg = [
    title,
    `Ticket: ${ticket.id} | ${ticket.tag} | score:${ticket.score}/10 | stage:${ticket.stage} | ${ticket.type}`,
    `Lane: ${ticket?.arena?.lane || '-'} ${ticket?.arena?.reason ? `(${ticket.arena.reason})` : ''}`,
    `From: ${ticket.msisdn}`,
    `wa.me: ${ticket.waMe}`,
    ticket.locationUrl ? `Lokasi: ${ticket.locationUrl}` : null,
    `Msg: ${shortMsg}${(body || '').length > 140 ? '…' : ''}`,
  ].filter(Boolean).join('\n');

  await twilioClient.messages.create({
    from: TWILIO_WHATSAPP_FROM,
    to,
    body: msg,
  });
}

// ---------------- INSTRUCTIONS ----------------
function towingInstruction(ticket, humanStyle) {
  const style = String(TOWING_STYLE || '3');
  const lines = [];

  const premiumDiagnosis =
    'Biasanya kondisi seperti ini bisa terkait tekanan oli transmisi drop, clutch aus, valve body bermasalah, atau torque converter.';
  const suggestionTow =
    'Jika unit sudah tidak bisa bergerak sama sekali, lebih aman dievakuasi (towing) daripada dipaksakan karena bisa menambah kerusakan.';

  if (style === '1') {
    lines.push('Baik Bang, kalau unit sudah *tidak bisa jalan/bergerak*, jangan dipaksakan dulu ya.');
    lines.push(premiumDiagnosis);
    lines.push('Untuk memastikan arah kerusakan, unit perlu dicek langsung oleh teknisi.');
    lines.push(suggestionTow);
    lines.push('');
    lines.push('Kirim *share lokasi* ya — admin bantu arahkan langkah paling aman.');
    lines.push('⚡ Jika perlu cepat, bisa langsung *voice call Admin*:');
    lines.push(WHATSAPP_ADMIN);
  } else if (style === '2') {
    lines.push('Kalau unit sudah tidak bisa jalan/bergerak, jangan dipaksakan.');
    lines.push('Lebih aman evakuasi daripada tambah rusak.');
    lines.push('');
    lines.push('Kirim *share lokasi* — admin koordinasi towing aman.');
    lines.push('⚡ Perlu cepat? Voice call Admin:');
    lines.push(WHATSAPP_ADMIN);
  } else {
    lines.push('Baik Bang.');
    lines.push('Kalau unit sudah *tidak bisa jalan/bergerak*, jangan dipaksakan dulu — bisa memperparah kerusakan.');
    lines.push('');
    lines.push(premiumDiagnosis);
    lines.push('');
    lines.push('Unit seperti ini perlu pemeriksaan presisi secara langsung.');
    lines.push(suggestionTow);
    lines.push('');
    lines.push('Silakan kirim *share lokasi sekarang* — kami prioritaskan koordinasi evakuasi yang aman.');
    lines.push('⚡ Untuk respons tercepat, langsung *voice call Admin*:');
    lines.push(WHATSAPP_ADMIN);
  }

  lines.push('');
  lines.push(confidenceLine(humanStyle));
  lines.push('');
  lines.push(signatureTowing(style));
  return lines.join('\n');
}

function jadwalInstruction(_ticket, humanStyle) {
  const lines = [];
  lines.push('Siap, untuk booking pemeriksaan bisa kirim data singkat ya:');
  lines.push('');
  lines.push('1️⃣ Nama');
  lines.push('2️⃣ Mobil & tahun');
  lines.push('3️⃣ Keluhan utama (singkat)');
  lines.push('4️⃣ Rencana datang (hari & jam)');
  lines.push('');
  lines.push('Setelah data masuk, admin konfirmasi antrian & estimasi waktu pengecekan.');
  lines.push('');
  lines.push('⚡ Jika butuh respons cepat, bisa langsung voice call Admin:');
  lines.push(WHATSAPP_ADMIN);
  lines.push('');
  lines.push(confidenceLine(humanStyle));
  lines.push('');
  lines.push(signatureShort());
  return lines.join('\n');
}

function acInstruction(_ticket, style) {
  return [
    'Siap Bang, saya fokus **AC** dulu ya (bukan matic).',
    'AC-nya: **tidak dingin sama sekali** atau **dingin sebentar lalu panas**?',
    'Blower angin **kencang** atau **lemah**? Ada bunyi kompresor/kipas?',
    'Biar cepat: kirim **tipe mobil + tahun** + video singkat panel AC (kalau bisa).',
    '',
    confidenceLine(style),
    '',
    signatureShort(),
  ].join('\n');
}

function noStartInstruction(_ticket, style) {
  return [
    'Tenang Bang, kita cek cepat ya.',
    'Saat distarter: **cekrek/lemot** atau **muter normal tapi tidak nyala**?',
    'Lampu dashboard: **terang** atau **redup/mati**?',
    'Biar cepat: kirim **video saat distarter** + **tipe mobil & tahun**.',
    '',
    confidenceLine(style),
    '',
    signatureShort(),
  ].join('\n');
}

// ---------------- AI ----------------
function withTimeout(promise, ms, label = 'TIMEOUT') {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(label)), ms)),
  ]);
}

function mustMapsOnly(text, userText) {
  const low = String(text || '').toLowerCase();
  const u = String(userText || '').toLowerCase();
  const userAskingLocation = /(alamat|lokasi|maps|map|di mana|dimana)/i.test(u);
  const looksLikeAddress = /(jl\.|jalan\s+\w|no\.|nomor\s+\d|kecamatan|kelurahan|kode pos)/i.test(low);

  if (userAskingLocation && looksLikeAddress) return `Untuk lokasi, silakan buka: ${MAPS_LINK}`;
  const aiClearlyInventing = /(jl\.|jalan\s+\w).*(no\.|nomor\s+\d)/i.test(low);
  if (aiClearlyInventing) return `Untuk lokasi, silakan buka: ${MAPS_LINK}`;
  return text;
}

function buildSystemPrompt({ style, stage, ticket, userText, cantDrive, priceOnly }) {
  const tone = composeTone(style);
  const maxQ = Math.max(1, Number(ARENA_MAX_QUESTIONS || 2));
  const lane = String(ticket?.arena?.lane || 'GENERAL');

  const laneRule =
    lane === 'AC'
      ? 'KONTEKS LANE=AC: Fokus AC. DILARANG membahas transmisi/gearbox kecuali user menyebut transmisi.'
      : (lane === 'NO_START'
          ? 'KONTEKS LANE=NO_START: Fokus mesin tidak hidup (aki/starter/bbm/ignition). DILARANG membahas transmisi.'
          : 'KONTEKS LANE=GENERAL/TECH: Bahas transmisi hanya jika user menyebut gejala transmisi.');

  return `
Anda adalah Kepala Bengkel ${BIZ_NAME} di Medan.
Gaya bahasa: ${tone}. Terasa mekanik senior/kepala bengkel, bukan CS.

ATURAN WAJIB:
1) Jangan beri angka harga pasti.
2) Jika user hanya tanya harga tanpa info → arahkan ke diagnosa.
3) Maksimal ${maxQ} pertanyaan dalam 1 balasan.
4) Jangan mengarang alamat. Jika ditanya lokasi, jawab hanya link: ${MAPS_LINK}
5) Jika unit tidak bisa jalan/berisiko → sarankan jangan dipaksakan + minta share lokasi.
6) Jawaban ringkas, tajam, relevan. Hindari cerewet.
7) ${laneRule}

KONTEKS:
- Type: ${ticket.type}
- Stage: ${stage}
- cantDrive: ${cantDrive}
- priceOnly: ${priceOnly}
- Lane: ${lane}
`.trim();
}

async function aiTryModel(client, model, userText, sysPrompt, timeoutMs) {
  const resp = await withTimeout(
    client.chat.completions.create({
      model,
      temperature: Number(OPENAI_TEMPERATURE || 0.30),
      max_tokens: Number(OPENAI_MAX_OUTPUT_TOKENS || 260),
      messages: [
        { role: 'system', content: sysPrompt },
        { role: 'user', content: userText },
      ],
    }),
    timeoutMs,
    `OPENAI_TIMEOUT_${model}`
  );

  let text = resp?.choices?.[0]?.message?.content?.trim();
  if (!text) return null;
  return text;
}

async function aiReply({ userText, ticket, style, stage, cantDrive, priceOnly }) {
  if (!OPENAI_API_KEY || !OpenAI) return null;

  let client;
  try { client = new OpenAI({ apiKey: OPENAI_API_KEY }); }
  catch (e) { console.error('OpenAI init failed:', e.message); return null; }

  const timeoutMs = Number(OPENAI_TIMEOUT_MS) || 9000;
  const sys = buildSystemPrompt({ style, stage, ticket, userText, cantDrive, priceOnly });

  try {
    let text = await aiTryModel(client, OPENAI_MODEL_PRIMARY, userText, sys, timeoutMs);
    if (!text && OPENAI_MODEL_FALLBACK && OPENAI_MODEL_FALLBACK !== OPENAI_MODEL_PRIMARY) {
      text = await aiTryModel(client, OPENAI_MODEL_FALLBACK, userText, sys, timeoutMs);
    }
    if (!text) return null;

    text = mustMapsOnly(text, userText);
    if (text.length > 900) text = text.slice(0, 900).trim() + '…';
    return text;
  } catch (e) {
    console.error('OpenAI failed:', e.message);
    return null;
  }
}

// ---------------- ADMIN COMMANDS ----------------
function adminHelp() {
  return [
    '✅ Admin Panel Hongz',
    '',
    'Commands:',
    'HELP / MENU',
    'LIST',
    'STATS',
    'CLAIM T-12345',
    'CLOSE T-12345',
    'NOTE T-12345 isi...',
  ].join('\n');
}

function listTickets(db) {
  const all = Object.values(db.tickets || {});
  const active = all
    .filter(t => t.status !== 'CLOSED')
    .sort((a, b) => (b.lastInboundAtMs || 0) - (a.lastInboundAtMs || 0))
    .slice(0, 12);

  if (!active.length) return 'Tidak ada tiket aktif saat ini.';

  const lines = ['📋 Tiket Aktif (Top 12):'];
  for (const t of active) {
    const shortMsg = (t.lastBody || '').replace(/\s+/g, ' ').slice(0, 28);
    const lane = t?.arena?.lane ? ` | lane:${t.arena.lane}` : '';
    lines.push(`${t.id} | ${t.tag} | ${t.status} | ${t.msisdn} | ${t.type} | stage:${t.stage}${lane} | ${t.locationUrl ? '📍' : '-'} | ${shortMsg}`);
  }
  lines.push('');
  lines.push('Ketik: CLAIM T-xxxxx / CLOSE T-xxxxx / NOTE T-xxxxx ...');
  return lines.join('\n');
}

function statsTickets(db) {
  const all = Object.values(db.tickets || {});
  const active = all.filter(t => t.status !== 'CLOSED');
  const priority = active.filter(t => t.tag.includes('PRIORITY')).length;
  const potential = active.filter(t => t.tag.includes('POTENTIAL')).length;
  const normal = active.length - priority - potential;

  const types = active.reduce((acc, t) => {
    const k = t.type || 'GENERAL';
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});
  const typeLines = Object.keys(types).sort().map(k => `- ${k}: ${types[k]}`);

  const lanes = active.reduce((acc, t) => {
    const k = t?.arena?.lane || 'UNKNOWN';
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});
  const laneLines = Object.keys(lanes).sort().map(k => `- ${k}: ${lanes[k]}`);

  return [
    '📊 HONGZ SUMMARY',
    `Aktif: ${active.length}`,
    `🔴 PRIORITY: ${priority}`,
    `🟡 POTENTIAL: ${potential}`,
    `🔵 NORMAL: ${normal}`,
    '',
    'Types:',
    ...typeLines,
    '',
    'Arena Lanes:',
    ...laneLines,
  ].join('\n');
}

function findTicket(db, ticketId) {
  const id = String(ticketId || '').trim().toUpperCase();
  return db.tickets?.[id] || null;
}

function handleAdminCommand(db, body) {
  const t = upper(body);

  if (t === 'HELP' || t === 'MENU') return adminHelp();
  if (t === 'LIST') return listTickets(db);
  if (t === 'STATS') return statsTickets(db);

  if (t.startsWith('CLAIM ')) {
    const id = t.split(/\s+/)[1];
    const ticket = findTicket(db, id);
    if (!ticket) return `Ticket ${id} tidak ditemukan.`;
    ticket.status = 'CLAIMED';
    ticket.updatedAt = nowISO();
    return `✅ ${ticket.id} di-CLAIM.\nCustomer: ${ticket.from}\nNomor: ${ticket.msisdn}\nwa.me: ${ticket.waMe}\nLokasi: ${ticket.locationUrl || '(belum ada)'}\nLane: ${ticket?.arena?.lane || '-'}`;
  }

  if (t.startsWith('CLOSE ')) {
    const id = t.split(/\s+/)[1];
    const ticket = findTicket(db, id);
    if (!ticket) return `Ticket ${id} tidak ditemukan.`;
    ticket.status = 'CLOSED';
    ticket.updatedAt = nowISO();
    const cust = db.customers?.[ticket.customerId];
    if (cust && cust.activeTicketId === ticket.id) cust.activeTicketId = '';
    return `✅ ${ticket.id} di-CLOSE.`;
  }

  if (t.startsWith('NOTE ')) {
    const parts = body.split(' ');
    const id = (parts[1] || '').toUpperCase();
    const note = body.split(' ').slice(2).join(' ').trim();
    const ticket = findTicket(db, id);
    if (!ticket) return `Ticket ${id} tidak ditemukan.`;
    if (!note) return `Format: NOTE ${id} isi catatan...`;
    ticket.notes = ticket.notes || [];
    ticket.notes.push({ at: nowISO(), note });
    ticket.updatedAt = nowISO();
    return `📝 Note tersimpan untuk ${ticket.id}.`;
  }

  return 'Perintah tidak dikenal. Ketik HELP.';
}

// ---------------- FOLLOW-UP ----------------
function isDueForFollowup(ticket) {
  if (String(FOLLOWUP_ENABLED).toLowerCase() !== 'true') return false;
  if (!ticket || ticket.status === 'CLOSED') return false;

  const maxPer = Number(FOLLOWUP_MAX_PER_CUSTOMER || 2);
  const cooldownH = Number(FOLLOWUP_COOLDOWN_HOURS || 24);
  const stage1H = Number(FOLLOWUP_STAGE1_HOURS || 18);
  const stage2H = Number(FOLLOWUP_STAGE2_HOURS || 48);

  const now = nowMs();
  const lastIn = ticket.lastInboundAtMs || 0;
  const lastFu = ticket.lastFollowupAtMs || 0;
  const count = ticket.followupCount || 0;

  if (count >= maxPer) return false;
  if (lastFu && (now - lastFu) < cooldownH * 3600 * 1000) return false;

  const ageH = (now - lastIn) / (3600 * 1000);
  if (count === 0 && ageH >= stage1H) return true;
  if (count === 1 && ageH >= stage2H) return true;
  return false;
}

function followupFallback(ticket) {
  const lane = String(ticket?.arena?.lane || '');
  const base = ticket.tag.includes('PRIORITY')
    ? 'Kami follow-up sebentar ya, supaya kondisinya tidak melebar.'
    : 'Kami follow-up ya—kalau masih sempat, boleh lanjut sedikit infonya.';

  const ask =
    lane === 'AC'
      ? 'AC-nya sekarang dingin/tidak? Ada bunyi kompresor?'
      : (lane === 'NO_START'
          ? 'Saat distarter sekarang cekrek/lemot atau muter normal?'
          : (ticket.stage <= 0 ? 'Boleh info mobil & tahunnya, plus keluhan yang paling terasa?' : 'Kondisinya masih sama atau ada perubahan?'));

  return [base, ask, 'Jika tidak ingin follow-up lagi, ketik STOP.'].join('\n');
}

// ====== CUSTOMER MEMORY HELPERS ======
function safeStr(x) {
  return (x || "").toString().trim();
}

// ===== Detect AC keywords =====
function detectAC(text) {
  const t = String(text || "").toUpperCase();

  const keywords = [
    "AC",
    "TIDAK DINGIN",
    "DINGIN SEBENTAR",
    "PANAS",
    "KOMPRESOR",
    "FREON",
    "BLOWER",
    "KIPAS",
    "KONDENSOR",
    "EVAPORATOR"
  ];

  return keywords.some(k => t.includes(k));
}

function getCust(db, customerId) {
  if (!db.customers) db.customers = {};
  if (!db.customers[customerId]) return null;
  return db.customers[customerId];
}

// Update profile sederhana dari teks pelanggan
function updateProfileFromText(db, customerId, text) {
  const cust = getCust(db, customerId);
  if (!cust) return;

  if (!cust.profile) cust.profile = {};
  cust.profile.lastSeenAt = nowISO();

  const t = safeStr(text);

  // Deteksi "Mobil: Innova 2012" / "mobil innova 2012"
  const carMatch =
    t.match(/mobil\s*[:\-]?\s*([A-Za-z0-9 \-]{3,30})/i) ||
    t.match(/tipe\s*mobil\s*[:\-]?\s*([A-Za-z0-9 \-]{3,30})/i);

  if (carMatch && carMatch[1]) {
    cust.profile.car = safeStr(carMatch[1]).slice(0, 40);
  }

  // Deteksi "Nama: Budi"
  const nameMatch = t.match(/nama\s*[:\-]?\s*([A-Za-z ]{2,30})/i);
  if (nameMatch && nameMatch[1]) {
    cust.profile.name = safeStr(nameMatch[1]).slice(0, 30);
  }

  // Deteksi "Kota: Medan"
  const cityMatch = t.match(/kota\s*[:\-]?\s*([A-Za-z ]{2,30})/i);
  if (cityMatch && cityMatch[1]) {
    cust.profile.city = safeStr(cityMatch[1]).slice(0, 30);
  }
}

// Simpan ringkasan ticket ke history (max 10)
function pushHistory(db, ticket) {
  if (!ticket) return;
  const customerId = ticket.customerId;
  if (!customerId) return;

  const cust = getCust(db, customerId);
  if (!cust) return;

  if (!Array.isArray(cust.history)) cust.history = [];

  const item = {
    id: ticket.id || "",
    at: nowISO(),
    lane: ticket.lane || "",
    issue: ticket.issue || ticket.summary || "",
    status: ticket.status || "",
  };

  cust.history.unshift(item);
  cust.history = cust.history.slice(0, 10);

  // cache juga di profile biar gampang dipakai prompt
  if (!cust.profile) cust.profile = {};
  cust.profile.lastIssue = item.issue || cust.profile.lastIssue || "";
  cust.profile.lastLane = item.lane || cust.profile.lastLane || "";
  cust.lastSeen = nowISO();
}


// =============================
// ROUTING CEPAT (TANPA GPT)
// =============================
function routeCustomerText(text) {
  if (!text) return null;

  const t = text.toLowerCase();

  // BOOKING
  if (t.includes("jadwal") || t.includes("booking")) {
    return "Siap Bang 🙏 Untuk booking, kirim *tipe mobil + tahun* ya.";
  }

  // TOWING
  if (t.includes("towing") || t.includes("dere k")) {
    return "Siap darurat 🚗 Kirim *lokasi live* sekarang ya Bang.";
  }

  // ALAMAT
  if (t.includes("alamat") || t.includes("lokasi")) {
    return "📍 Hongz Bengkel Matic\nJl. Mohammad Yakub No.10B Medan\nBuka Senin–Sabtu 09.00–17.00";
  }

  // AC
  if (t.includes("ac")) {
    return "AC dingin sebentar lalu panas biasanya:\n1️⃣ Freon kurang\n2️⃣ Magnetic clutch slip\n3️⃣ Extra fan lemah\n\nKirim tipe mobil + tahun ya Bang.";
  }

  // TRANSMISI
  if (t.includes("matic") || t.includes("transmisi")) {
    return "Keluhan matic apa Bang?\n• Nendang?\n• Slip?\n• Delay masuk D?\n\nKirim tipe mobil + tahun ya.";
  }

  return null; // kalau tidak cocok, lanjut ke GPT
}


// =============================
// MENU CLOSING A,B,C,D (FAST)
// =============================
function routeABCD(text) {
  if (!text) return null;
  const t = text.trim().toLowerCase();

  // kalau user ketik hanya A/B/C/D
  if (t === "a" || t === "a.") {
    return "✅ *A. Booking Service*\nKirim:\n1) *Tipe mobil + tahun*\n2) Keluhan singkat\n3) Mau datang jam berapa (09.00–17.00)\n\nContoh: *Avanza 2015, matic nendang, jam 10.*";
  }

  if (t === "b" || t === "b.") {
    return "✅ *B. Konsultasi Cepat*\nKirim:\n1) *Tipe mobil + tahun*\n2) Gejala (nendang/slip/delay/jedug/bunyi)\n3) Sudah ganti oli matic kapan?\n\nBiar kami arahkan langkah paling cepat.";
  }

  if (t === "c" || t === "c.") {
    return "✅ *C. Alamat & Jam Buka*\n📍 Hongz Bengkel Matic\nJl. Mohammad Yakub No.10B Medan\n🕘 Senin–Sabtu 09.00–17.00\n\nKalau mau, ketik *A* untuk booking.";
  }

  if (t === "d" || t === "d.") {
    return "✅ *D. Darurat / Towing*\nKirim *lokasi live* + patokan (dekat apa) sekarang ya Bang.\nKalau mobil masih bisa jalan pelan, sebutkan *bisa jalan atau tidak*.";
  }

  return null;
}

// Pesan menu utama (dipakai untuk balasan pertama / keyword "menu")
function mainMenuText() {
  return (
`Siap Bang 🙏 *Hongz Bengkel Matic*\n` +
`Pilih 1:\n` +
`*A.* Booking Service (langsung jadwal)\n` +
`*B.* Konsultasi Cepat (langsung solusi)\n` +
`*C.* Alamat & Jam Buka\n` +
`*D.* Darurat / Towing\n\n` +
`Balas cukup: *A / B / C / D*`
  );
}


// ---------------- MAIN WEBHOOK ----------------
async function webhookHandler(req, res) {
  const db = loadDB();

  const from = normalizeFrom(req.body?.From || '');
  const to = normalizeFrom(req.body?.To || '');
  const body = normText(req.body?.Body || '');
const customerText = body;

// 1) ROUTING cepat (tanpa GPT) — biar gak jadi “anak magang”
const routed = routeCustomerText(customerText);
if (routed) {
  return replyTwiml(res, routed);
}
  const location = extractLocation(req.body || {});
  const style = detectStyle(body);

  dlog('IN', { from, to, body, hasLocation: !!location });

  // ---- ADMIN ----
  if (isAdmin(from)) {
    const reply = handleAdminCommand(db, body);
    saveDB(db);
   return reply; // (res, reply);
  }

  // ---- MONITOR ----
if (isMonitor(from)) {
  saveDB(db);
  return '✅ Monitor aktif.';
}

  // ---- Customer Identity ----
const customerId = sha16(from);

if (!db.customers[customerId]) {
  db.customers[customerId] = {
    from,
    firstSeen: nowISO(),
    lastSeen: nowISO(),
    activeTicketId: "",
    optOut: false,
    stage: "NEW",

    // ✅ Memory Pelanggan
    profile: {
      name: "",
      phone: cleanMsisdn(from),
      car: "",
      city: "",
      notes: "",
      lastIssue: "",
      lastLane: "",
      lastSeenAt: nowISO(),
    },

    history: [], // simpan max 10 tiket terakhir
  };
} else {
  db.customers[customerId].lastSeen = nowISO();
}

// ✅ Update memory dari teks pelanggan
updateProfileFromText(db, customerId, body);
saveDB(db);

// ---- STOP/START follow-up ----
if (upper(body) === "STOP" || upper(body) === "UNSUBSCRIBE") {
  db.customers[customerId].optOut = true;
  saveDB(db);
  return replyTwiml(
    res,
    "Baik. Follow-up dinonaktifkan. Jika ingin aktif lagi, ketik START."
  );
}

if (upper(body) === "START" || upper(body) === "SUBSCRIBE") {
  db.customers[customerId].optOut = false;
  saveDB(db);
  return replyTwiml(
    res,
    "Siap. Follow-up diaktifkan kembali. Silakan tulis keluhan Anda."
  );
}

  const ticket = getOrCreateTicket(db, customerId, from);
const acMode = detectAC(body);

// ===============================
// Anti-ulang fallback (hanya 1x)
// ===============================
ticket.stage = Number(ticket.stage || 0);
ticket.askedFallback = !!ticket.askedFallback;

if (ticket.lane && ticket.stage === 0 && !ticket.askedFallback) {
  const msg = followupFallback(ticket);

  ticket.askedFallback = true;
  ticket.stage = 1;

  pushHistory(db, ticket);
  saveDB(db);

  return replyTwiml(res, msg);
}

  const cmdTowing = isCommand(body, 'TOWING');
  const cmdJadwal = isCommand(body, 'JADWAL');

  const noStart = detectNoStart(body);
  const cantDrive = detectCantDrive(body);
  const hasLoc = !!location;
  const priceOnly = detectPriceOnly(body);
  const buyingSignal = detectBuyingSignal(body);
  const scheduleAsk = askedForSchedule(body);

  const vInfo = hasVehicleInfo(body);
  const sInfo = hasSymptomInfo(body);
  const suspicious = (priceOnly && String(body).length < 35);

  const score = leadScore({
    body,
    hasLocation: hasLoc,
    isTowingCmd: cmdTowing,
    isJadwalCmd: cmdJadwal,
    cantDrive,
  });
  const tag = leadTag(score);

  // stage
  let stage = Number(ticket.stage || 0);
  if (cmdJadwal || scheduleAsk || buyingSignal) stage = Math.max(stage, 2);
  else if (vInfo || sInfo || acMode || noStart) stage = Math.max(stage, 1);
  if ((vInfo && sInfo) || cmdJadwal) stage = Math.max(stage, 2);

  // type
  let type = 'GENERAL';
  if (cmdJadwal) type = 'JADWAL';
  else if (acMode) type = 'AC';
  else if (noStart) type = 'NO_START';
  else if (cmdTowing || cantDrive || hasLoc) type = 'TOWING';

  // arena
  const arenaOn = envBool(ARENA_CONTROL_ENABLED, true);
  const arena = arenaOn
    ? arenaClassify({ body, hasLoc, cantDrive, cmdTowing, cmdJadwal, buyingSignal, scheduleAsk, priceOnly, vInfo, sInfo, suspicious })
    : { lane: 'OFF', reason: 'DISABLED' };

  if (location?.mapsUrl) ticket.locationUrl = location.mapsUrl;

  updateTicket(ticket, {
    lastBody: body,
    lastInboundAtMs: nowMs(),
    score,
    tag,
    waMe: toWaMe(from),
    msisdn: cleanMsisdn(from),
    type,
    stage,
    arena,
  });

  db.events.push({
    t: nowISO(),
    from,
    to,
    body,
    ticketId: ticket.id,
    score,
    tag,
    locationUrl: ticket.locationUrl || '',
    lane: arena.lane,
    laneReason: arena.reason,
  });
  if (db.events.length > 5000) db.events = db.events.slice(-2000);

  // ---- RADAR ----
  try {
    if (MONITOR_WHATSAPP_TO && monitorAllowedByLevel(score)) {
      await notifyMonitor({ title: '🛠 RADAR IN', ticket, body });
    }
  } catch (e) {
    console.error('notifyMonitor error:', e?.message || e);
  }

  // ---- ADMIN NOTIFY ----
  try {
    const adminNotifyOn = String(ADMIN_NOTIFY_ENABLED).toLowerCase() === 'true';
    if (adminNotifyOn) {
      const hit = matchAdminKeyword(body);
      const minScore = Number(ADMIN_NOTIFY_MIN_SCORE || 5);
      const cdMs = Math.max(0, Number(ADMIN_NOTIFY_COOLDOWN_SEC || 60)) * 1000;
      const now = nowMs();
      const cooldownOk = !ticket.lastAdminNotifyAtMs || (now - ticket.lastAdminNotifyAtMs) >= cdMs;

      const adminEqMon =
        normalizeFrom(ADMIN_WHATSAPP_TO).toLowerCase() === normalizeFrom(MONITOR_WHATSAPP_TO).toLowerCase();

      const shouldNotifyAdmin =
        (score >= minScore) ||
        !!hit ||
        cantDrive ||
        cmdTowing ||
        cmdJadwal ||
        acMode ||
        noStart ||
        !!ticket.locationUrl ||
        (arena.lane === 'URGENT') ||
        (arena.lane === 'BOOKING');

      if (!adminEqMon && shouldNotifyAdmin && cooldownOk) {
        ticket.lastAdminNotifyAtMs = now;
        await notifyAdmin({
          title: '🔔 ADMIN ALERT',
          ticket,
          reason: hit ? `keyword hit: ${hit}` : (cantDrive ? 'Cant drive / urgent' : `score >= ${minScore}`),
          body,
          locationUrl: ticket.locationUrl || '',
        });
      }
    }
  } catch (e) {
    console.error('notifyAdmin error:', e?.message || e);
  }

  // ---- RULES PRIORITY (lane-aware) ----
  // RULE: maps
  if (/alamat|lokasi|maps|map|di mana|dimana/i.test(body)) {
    saveDB(db);
    return replyTwiML(res, `Untuk lokasi, silakan buka: ${MAPS_LINK}`);
  }

  // RULE: location received
  if (hasLoc) {
    saveDB(db);
    return replyTwiML(res, [
      'Baik, lokasi sudah kami terima ✅',
      'Admin akan follow up untuk langkah berikutnya (termasuk evakuasi/towing bila diperlukan).',
      '',
      confidenceLine(style),
      '',
      signatureTowing(TOWING_STYLE),
    ].join('\n'));
  }

  // RULE: AC
  if (acMode || arena.lane === 'AC') {
    saveDB(db);
    return replyTwiML(res, acInstruction(ticket, style));
  }

  // RULE: NO_START
  if (noStart || arena.lane === 'NO_START') {
    saveDB(db);
    return replyTwiML(res, noStartInstruction(ticket, style));
  }

  // RULE: towing/cant drive
  if (cmdTowing || cantDrive || arena.lane === 'URGENT') {
    saveDB(db);
    return replyTwiML(res, towingInstruction(ticket, style));
  }

  // RULE: jadwal
  if (cmdJadwal || arena.lane === 'BOOKING') {
    saveDB(db);
    return replyTwiML(res, jadwalInstruction(ticket, style));
  }

  // ARENA routing (1,2,3,4)
  const routing = parsePriorityRouting(PRIORITY_ROUTING);
  if (arenaOn && routing.length) {
    if (arena.lane === 'LOW_ENERGY') {
      saveDB(db);
      return replyTwiML(res, arenaReplyLowEnergy(style));
    }
  }

  // ---- ANTI JEBEH 3T/3M ----
  const antiOn = envBool(ANTI_JEBEH_ENABLED, true);
  const strictOn = envBool(ANTI_JEBEH_STRICT, true);
  const minInfoRequired = envBool(ANTI_JEBEH_MIN_INFO_REQUIRED, true);
  const strikesLock = Math.max(1, Number(ANTI_JEBEH_STRIKES_LOCK || 2));

  const det = detect3T3M(body);
  const hasMinInfo =
    hasVehicleInfo(body) ||
    hasSymptomInfo(body) ||
    cmdJadwal ||
    buyingSignal ||
    hasLoc ||
    acMode ||
    noStart;

  if (hasMinInfo) {
    ticket.priceStrike = 0;
    ticket.lockMode = false;
  }

  if (antiOn && det.hit && (!minInfoRequired || !hasMinInfo)) {
    ticket.priceStrike = (ticket.priceStrike || 0) + 1;
    if (ticket.priceStrike >= strikesLock) ticket.lockMode = true;

    saveDB(db);
    return replyTwiML(res, (strictOn && ticket.lockMode) ? arenaReplyPriceLock(style) : arenaReplyPriceSoft(style));
  }

  // ---- DEFAULT: AI reply ----
  const ai = await aiReply({ userText: body, ticket, style, stage, cantDrive, priceOnly });

  let replyText;
  if (ai) {
    replyText = [
      ai,
      '',
      confidenceLine(style),
      '',
      signatureShort(),
    ].join('\n');
  } else {
    const triageQ =
      (arena.lane === 'TECHNICAL')
        ? 'Boleh info mobil & tahunnya + gejala transmisi yang paling terasa (singkat)?'
        : 'Boleh info mobil & tahun + keluhan utama (singkat) biar saya arahkan langkahnya?';

    replyText = [
      'Oke Bang, saya bantu arahkan dulu ya.',
      triageQ,
      (priceOnly ? 'Untuk biaya tergantung penyebabnya—biar akurat, kita pastikan diagnosanya dulu.' : ''),
      confidenceLine(style),
      '',
      signatureShort(),
    ].filter(Boolean).join('\n');
  }

  ticket.lastBotAtMs = nowMs();
  saveDB(db);
  return replyTwiML(res, replyText);
}

// ---------------- ROUTES ----------------

// Pastikan helper ini ADA di file (kalau belum ada, taruh di atas ROUTES)
function replyTwiml(res, message) {
  const twilio = require("twilio");
  const twiml = new twilio.twiml.MessagingResponse();
  twiml.message(message || "Halo! Ada yang bisa kami bantu?");
  res.type("text/xml");
  return res.send(twiml.toString());
}

app.post("/twilio/webhook", async (req, res) => {
  try {
    console.log("[TWILIO HIT] /twilio/webhook", {
      method: req.method,
      contentType: req.headers["content-type"],
      keys: Object.keys(req.body || {}),
      from: req.body?.From,
      body: req.body?.Body,
    });

    const result = await webhookHandler(req, res);
    console.log("[WEBHOOK RESULT]", result);
    return result;
  } catch (e) {
    console.error("webhook error", e?.message || e);
    return replyTwiml(res, "Maaf ya, sistem lagi padat. Silakan ulangi pesan Anda sebentar lagi 🙏");
  }
});

app.post("/whatsapp/incoming", async (req, res) => {
  return res.sendStatus(200);
});


// CRON FOLLOW-UP
app.get('/cron/followup', async (req, res) => {
  try {
    const key = String(req.query.key || '');
    if (!CRON_KEY || key !== CRON_KEY) return res.status(403).send('Forbidden');
    if (String(FOLLOWUP_ENABLED).toLowerCase() !== 'true') return res.status(200).send('Follow-up disabled');

    const db = loadDB();
    const tickets = Object.values(db.tickets || {});
    let sent = 0;

    for (const t of tickets) {
      const cust = db.customers?.[t.customerId];
      if (cust?.optOut) continue;
      if (t.status === 'CLOSED') continue;

      if (isDueForFollowup(t)) {
        const msg = followupFallback(t);

        await twilioClient.messages.create({
          from: TWILIO_WHATSAPP_FROM,
          to: t.from,
          body: msg,
        });

        t.followupCount = (t.followupCount || 0) + 1;
        t.lastFollowupAtMs = nowMs();
        t.updatedAt = nowISO();
        sent++;
      }
    }

    saveDB(db);
    return res.status(200).send(`Follow-up sent: ${sent}`);
  } catch (e) {
    console.error('cron/followup error:', e?.message || e);
    return res.status(500).send('Error');
  }
});

// HEALTH
app.get('/', (_req, res) => {
  try {
    const arenaOn = String(ARENA_CONTROL_ENABLED).toLowerCase() === 'true';
    const routingArr = parsePriorityRouting(PRIORITY_ROUTING);
    const routingText = Array.isArray(routingArr) ? routingArr.join(',') : '-';

    const text =
`HONGZ AI SERVER — HYBRID C+ ELITE — OK

ArenaControl: ${arenaOn ? 'ON' : 'OFF'}
PriorityRouting: ${routingText}
WebhookHint: ${TWILIO_WEBHOOK_URL || '(set TWILIO_WEBHOOK_URL in Render ENV)'}

Routes:
- POST /twilio/webhook
- POST /whatsapp/incoming
- GET  /cron/followup?key=...`;

    return res.status(200).send(text);
  } catch (e) {
    console.error('health error:', e?.message || e);
    return res.status(500).send('Health error');
  }
});

// START
app.listen(PORT, () => {
  console.log('HONGZ AI SERVER — START');
  console.log('Listening on port:', PORT);
  console.log('Webhook routes: /twilio/webhook and /whatsapp/incoming');
});