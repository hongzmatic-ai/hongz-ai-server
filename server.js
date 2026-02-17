/**
 * HONGZ AI SERVER — ENTERPRISE C+ (ONE FILE) — FINAL++ (WA-Optimized)
 * Fokus:
 * - Jawaban pendek (WA-friendly), terasa "kepala bengkel", bukan CS jual tiket
 * - A/B/C style + 1/2/3 stage (triage -> authority proof -> soft close)
 * - Anti-mengemis: instruksi tegas tapi sopan ("Kirim share lokasi", bukan "Boleh...")
 * - Signature adaptif: none/mini/full (tidak muncul terus)
 * - TOWING / JADWAL / lokasi / admin notif / tiket / follow-up CRON tetap ada
 *
 * REQUIRED ENV:
 *   TWILIO_ACCOUNT_SID
 *   TWILIO_AUTH_TOKEN
 *   TWILIO_WHATSAPP_FROM      e.g. "whatsapp:+6285xxxx"
 *   ADMIN_WHATSAPP_TO         e.g. "whatsapp:+62813xxxx"
 *
 * OPTIONAL (AI):
 *   OPENAI_API_KEY
 *   OPENAI_MODEL="gpt-4o-mini"   (boleh ganti)
 *   OPENAI_TIMEOUT_MS="9000"
 *
 * BRANDING:
 *   BIZ_NAME, BIZ_ADDRESS, BIZ_HOURS, MAPS_LINK
 *   WHATSAPP_ADMIN, WHATSAPP_CS (public wa.me)
 *   AUTHORITY_LINE (1 kalimat bukti bengkel kuat)
 *
 * FOLLOWUP:
 *   FOLLOWUP_ENABLED="true"
 *   FOLLOWUP_STAGE1_HOURS="18"
 *   FOLLOWUP_STAGE2_HOURS="48"
 *   FOLLOWUP_COOLDOWN_HOURS="24"
 *   FOLLOWUP_MAX_PER_CUSTOMER="2"
 *   CRON_KEY="hongzCron_xxx"
 *
 * STORAGE:
 *   DATA_DIR="/var/data"
 *
 * NOTE DEPENDENCY:
 *   "express", "body-parser", "twilio", "openai"
 *   Untuk OpenAI: "openai": "^4.0.0"
 */

const express = require("express");
const bodyParser = require("body-parser");
const twilio = require("twilio");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// OpenAI (optional) — robust for commonjs export variations
let OpenAIModule = null;
try { OpenAIModule = require("openai"); } catch (_) { OpenAIModule = null; }
const OpenAIClientClass = OpenAIModule ? (OpenAIModule.default || OpenAIModule.OpenAI || OpenAIModule) : null;

// ---------- ENV ----------
const {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_WHATSAPP_FROM,
  ADMIN_WHATSAPP_TO,

  OPENAI_API_KEY,
  OPENAI_MODEL = "gpt-4o-mini",
  OPENAI_TIMEOUT_MS = "9000",

  BIZ_NAME = "Hongz Bengkel – Spesialis Transmisi Matic",
  BIZ_ADDRESS = "Jl. M. Yakub No.10b, Medan Perjuangan",
  BIZ_HOURS = "Senin–Sabtu 09.00–17.00",
  MAPS_LINK = "https://maps.app.goo.gl/CvFZ9FLNJRog7K4t9",
  WHATSAPP_ADMIN = "https://wa.me/6281375430728",
  WHATSAPP_CS = "https://wa.me/6285752965167",

  // 1 kalimat saja. Ini yang bikin terasa "kepala bengkel", bukan CS jual tiket.
  AUTHORITY_LINE = "Di Hongz kami pakai scanner, uji tekanan, dan peralatan torque converter (bubut/press/las) standar spesialis.",

  FOLLOWUP_ENABLED = "true",
  FOLLOWUP_STAGE1_HOURS = "18",
  FOLLOWUP_STAGE2_HOURS = "48",
  FOLLOWUP_COOLDOWN_HOURS = "24",
  FOLLOWUP_MAX_PER_CUSTOMER = "2",

  DATA_DIR = "/var/data",
  CRON_KEY = "",
  DEBUG = "false",
} = process.env;

const IS_DEBUG = String(DEBUG).toLowerCase() === "true";
function dlog(...args) { if (IS_DEBUG) console.log("[HONGZ]", ...args); }

if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_WHATSAPP_FROM || !ADMIN_WHATSAPP_TO) {
  console.error("❌ Missing ENV: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM, ADMIN_WHATSAPP_TO");
}

const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

// ---------- APP ----------
const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// ---------- STORAGE ----------
function ensureDir(dir) { try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {} }
ensureDir(DATA_DIR);
const DB_FILE = path.join(DATA_DIR, "hongz_enterprise_db.json");

function loadDB() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, "utf8")); }
  catch (_) { return { customers: {}, tickets: {}, events: [] }; }
}
function saveDB(db) {
  try { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), "utf8"); }
  catch (e) { console.error("DB save failed:", e.message); }
}

function nowISO() { return new Date().toISOString(); }
function nowMs() { return Date.now(); }

function sha16(s) {
  return crypto.createHash("sha256").update(String(s)).digest("hex").slice(0, 16);
}

function escapeXml(unsafe) {
  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function normText(s) { return String(s || "").replace(/\u200b/g, "").trim(); }
function upper(s) { return normText(s).toUpperCase(); }

function isCommand(body, cmd) {
  const t = upper(body);
  const c = String(cmd).toUpperCase();
  return t === c || t.startsWith(c + " ") || t.includes("\n" + c) || t.includes(" " + c + " ");
}

function normalizeFrom(from) { return String(from || "").trim(); }

// "whatsapp:+62813..." -> "62813..."
function cleanMsisdn(from) {
  return String(from || "").replace(/^whatsapp:\+?/i, "").replace(/[^\d]/g, "");
}
function toWaMe(from) {
  const n = cleanMsisdn(from);
  return n ? `https://wa.me/${n}` : "-";
}

function isAdmin(from) {
  const a = normalizeFrom(ADMIN_WHATSAPP_TO).toLowerCase();
  const f = normalizeFrom(from).toLowerCase();
  return a && f && a === f;
}

// ---------- LOCATION PARSER ----------
function extractLocation(reqBody) {
  const lat = reqBody.Latitude || reqBody.latitude;
  const lng = reqBody.Longitude || reqBody.longitude;

  if (lat && lng) {
    return {
      type: "coords",
      lat: String(lat),
      lng: String(lng),
      mapsUrl: `https://www.google.com/maps?q=${encodeURIComponent(lat)},${encodeURIComponent(lng)}`
    };
  }

  const body = String(reqBody.Body || "").trim();
  const mapsLinkMatch = body.match(/https?:\/\/(maps\.app\.goo\.gl|www\.google\.com\/maps|goo\.gl\/maps)[^\s]+/i);
  if (mapsLinkMatch) return { type: "link", mapsUrl: mapsLinkMatch[0], raw: body };

  return null;
}

// ---------- SIGNATURE (ADAPTIF) ----------
function signatureMini() {
  return [
    `🧭 ${MAPS_LINK}`,
    `⏱ ${BIZ_HOURS}`,
  ].join("\n");
}
function signatureFull() {
  return [
    `— ${BIZ_NAME}`,
    `📍 ${BIZ_ADDRESS}`,
    `🧭 Maps: ${MAPS_LINK}`,
    `⏱ ${BIZ_HOURS}`,
    `📲 Admin: ${WHATSAPP_ADMIN}`,
    `💬 CS: ${WHATSAPP_CS}`,
    `Ketik *JADWAL* (booking) / *TOWING* (darurat)`,
  ].join("\n");
}

function confidenceLine(style = "neutral") {
  if (style === "casual") return `✅ Tenang ya, kita bantu sampai jelas langkahnya 🙂`;
  if (style === "urgent") return `✅ Tenang ya, kita arahkan langkah paling aman.`;
  return `✅ Tenang ya, kami bantu sampai jelas langkahnya.`;
}

// ---------- BASIC DETECT ----------
function detectPremium(body) {
  return /land cruiser|alphard|vellfire|lexus|bmw|mercedes|benz|audi|porsche|range rover|land rover|prado|lc200|lc300/i.test(body);
}
function detectCantDrive(body) {
  return /tidak bisa jalan|ga bisa jalan|gak bisa jalan|mogok|stuck|macet total|selip parah|rpm naik tapi tidak jalan|masuk d.*tidak jalan|masuk r.*tidak jalan|darurat|bahaya/i.test(body);
}
function detectPriceOnly(body) {
  return /berapa|biaya|harga|kisaran|range|murah|diskon|nego|budget/i.test(body);
}
function askedForSchedule(body) {
  return /kapan bisa masuk|jadwal|booking|bisa hari|bisa jam|kapan bisa datang|bisa hari ini/i.test(String(body || "").toLowerCase());
}
function askedLocation(body) {
  return /(alamat|lokasi|maps|map|di mana|dimana)/i.test(String(body || "").toLowerCase());
}

// ---------- A/B/C STYLE ----------
function detectStyle(body) {
  const t = String(body || "");
  const low = t.toLowerCase();

  const panic = /darurat|tolong|cepat|mogok|tidak bisa|gak bisa|ga bisa|stuck|bahaya/i.test(low);
  const formal = /mohon|berkenan|apabila|dengan hormat|terima kasih|pak|bu|bapak|ibu/i.test(low);
  const hasEmoji = /[\u{1F300}-\u{1FAFF}]/u.test(t);
  const short = low.length <= 18;

  if (panic) return "urgent";
  if (formal) return "formal";
  if (hasEmoji || short) return "casual";
  return "neutral";
}

// Mode A/B/C otomatis:
// - A: tegas/kuat kalau user ngetes/meremehkan/nyolot/penipu vibes
// - B: premium/expert kalau mobil premium atau user minta bukti kemampuan
// - C: adaptif human (default)
function detectModeABC(body) {
  const low = String(body || "").toLowerCase();
  const testy = /bohong|penipu|bisa gak sih|jangan bohong|bengkel lain bilang|mahal kali|diskon|murahin|gak yakin|serius|bukti/i.test(low);
  const premium = detectPremium(low);
  if (premium) return "B";
  if (testy) return "A";
  return "C";
}

// ---------- STAGE 1/2/3 ----------
function hasVehicleInfo(body) {
  const t = String(body || "").toLowerCase();
  const hasYear = /\b(19[8-9]\d|20[0-3]\d)\b/.test(t);
  const hasBrand = /toyota|honda|nissan|mitsubishi|suzuki|daihatsu|mazda|hyundai|kia|wuling|dfsk|bmw|mercedes|audi|lexus/i.test(t);
  const hasModelCue = /innova|avanza|rush|fortuner|alphard|vellfire|x-trail|crv|hrv|pajero|xpander|ertiga|brio|jazz|civic|camry|yaris|carens/i.test(t);
  return hasYear || hasBrand || hasModelCue;
}
function hasSymptomInfo(body) {
  const t = String(body || "").toLowerCase();
  return /rpm|selip|jedug|hentak|telat|ngelos|overheat|bau|getar|gigi|d|r|n|p|nyentak|delay|slip|noise|bunyi|bocor|tidak bisa jalan/i.test(t);
}

// ---------- TICKET ----------
function genTicketId() {
  const n = Math.floor(10000 + Math.random() * 89999);
  return `T-${n}`;
}
function getOrCreateTicket(db, customerId, from) {
  const cust = db.customers[customerId];
  const currentTicketId = cust?.activeTicketId;

  if (currentTicketId && db.tickets[currentTicketId] && db.tickets[currentTicketId].status !== "CLOSED") {
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
    status: "OPEN",
    createdAt: nowISO(),
    updatedAt: nowISO(),
    score: 0,
    tag: "🔵 NORMAL",
    lastBody: "",
    locationUrl: "",
    notes: [],
    type: "GENERAL", // GENERAL | TOWING | JADWAL
    stage: 0,        // 0 baru, 1 ada info, 2 siap diarahkan (soft close)
    followupCount: 0,
    lastFollowupAtMs: 0,
    lastInboundAtMs: nowMs(),
    lastBotAtMs: 0,
  };

  db.tickets[tid] = ticket;
  db.customers[customerId].activeTicketId = tid;
  return ticket;
}
function updateTicket(ticket, patch = {}) {
  Object.assign(ticket, patch);
  ticket.updatedAt = nowISO();
}

// ---------- ADMIN NOTIFY ----------
async function notifyAdmin({ title, ticket, reason, body, locationUrl }) {
  const msg = [
    title,
    `Ticket: ${ticket.id} (${ticket.tag} | stage:${ticket.stage})`,
    `Customer: ${ticket.from}`,
    `Nomor: ${ticket.msisdn}`,
    `Chat: ${ticket.waMe}`,
    reason ? `Alasan: ${reason}` : null,
    locationUrl ? `Lokasi: ${locationUrl}` : null,
    body ? `Pesan: ${body}` : null,
    ``,
    `Commands: HELP | LIST | STATS | CLAIM ${ticket.id} | CLOSE ${ticket.id} | NOTE ${ticket.id} ...`,
  ].filter(Boolean).join("\n");

  try {
    await twilioClient.messages.create({
      from: TWILIO_WHATSAPP_FROM,
      to: ADMIN_WHATSAPP_TO,
      body: msg,
    });
  } catch (e) {
    console.error("Admin notify failed:", e.message);
  }
}

// ---------- CUSTOMER REPLIES ----------
function replyTwiML(res, text) {
  res.type("text/xml");
  return res.send(`<Response><Message>${escapeXml(text)}</Message></Response>`);
}

// Signature policy: kapan muncul?
function buildFooter({ stage, type, userText }) {
  // Jangan tampilkan footer panjang di awal percakapan
  if (type === "TOWING") return "\n\n" + signatureMini();
  if (askedLocation(userText)) return "\n\n" + signatureFull();
  if (askedForSchedule(userText) || stage >= 2) return "\n\n" + signatureFull();
  return ""; // stage 0-1: NO footer
}

// Authority proof policy: kapan 1 kalimat bukti bengkel kuat muncul?
function maybeAuthorityLine({ modeABC, stage, priceOnly }) {
  // tampilkan hanya saat perlu: premium / user ngetes / price-only (biar trust naik)
  if (modeABC === "B") return AUTHORITY_LINE;
  if (modeABC === "A") return AUTHORITY_LINE;
  if (priceOnly && stage >= 1) return AUTHORITY_LINE;
  return "";
}

// TOWING message: tegas, pendek, tidak mengemis
function towingInstruction(ticket, style) {
  return [
    "Baik. Kalau unit *tidak bisa jalan*, jangan dipaksakan dulu biar tidak tambah rusak.",
    "Kirim *share lokasi* ya — admin langsung arahkan evakuasi/towing yang aman.",
    ticket?.locationUrl ? `📍 Lokasi terdeteksi: ${ticket.locationUrl}` : "",
    confidenceLine(style),
    signatureMini(),
  ].filter(Boolean).join("\n");
}

// JADWAL message: jelas, ringkas
function jadwalInstruction(ticket, style) {
  return [
    "Siap. Untuk booking pemeriksaan, kirim data singkat:",
    "1) Nama  2) Mobil & tahun  3) Keluhan utama  4) Hari & jam rencana datang",
    confidenceLine(style),
    signatureFull(),
  ].join("\n");
}

// ---------- AI HELPERS ----------
function withTimeout(promise, ms, label = "TIMEOUT") {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(label)), ms)),
  ]);
}

// Jangan paksa Maps kalau kata "jalan" (drive) muncul.
function mustMapsOnly(text, userText) {
  const low = String(text || "").toLowerCase();
  const u = String(userText || "").toLowerCase();

  const userAskingLocation = /(alamat|lokasi|maps|map|di mana|dimana)/i.test(u);
  const looksLikeAddress = /(jl\.|jalan\s+\w|no\.|nomor\s+\d|kecamatan|kelurahan|kode pos)/i.test(low);

  if (userAskingLocation && looksLikeAddress) return `Untuk lokasi, silakan buka: ${MAPS_LINK}`;

  const aiClearlyInventing = /(jl\.|jalan\s+\w).*(no\.|nomor\s+\d)/i.test(low);
  if (aiClearlyInventing) return `Untuk lokasi, silakan buka: ${MAPS_LINK}`;

  return text;
}

// Hard limiter WA: max karakter
function clampWhatsApp(text, maxChars = 420) {
  let t = String(text || "").trim();
  t = t.replace(/\n{3,}/g, "\n\n");
  if (t.length > maxChars) t = t.slice(0, maxChars).trim() + "…";
  return t;
}

// Closing policy
function closingPolicy(stage, type, userText) {
  if (type === "TOWING") return "TOWING: fokus safety + lokasi. jangan bahas booking.";
  if (askedForSchedule(userText)) return "User sudah minta jadwal: boleh arahkan booking dengan sopan.";
  if (stage <= 0) return "Stage 0: jangan ajak booking. cukup triage 1 pertanyaan saja.";
  if (stage === 1) return "Stage 1: boleh 1 kalimat soft CTA kalau ada peluang.";
  return "Stage 2: boleh soft close lebih jelas, tetap tidak memaksa.";
}

function buildSystemPrompt({ style, stage, type, userText, modeABC, priceOnly }) {
  const tone =
    style === "urgent" ? "tegas, menenangkan, cepat inti" :
    style === "formal" ? "sopan, profesional, padat" :
    style === "casual" ? "ramah, santai, seperti mekanik ngobrol" :
    "ramah-profesional, padat, enak dibaca";

  const abc =
    modeABC === "A" ? "A (tegas/berwibawa, jangan banyak basa-basi)" :
    modeABC === "B" ? "B (premium expert, 1 kalimat bukti kompetensi saja)" :
    "C (adaptif human, hangat tapi tetap profesional)";

  const policy = closingPolicy(stage, type, userText);

  return `
Anda adalah kepala bengkel/teknisi konsultan ${BIZ_NAME} (Medan), spesialis transmisi matic.
Nada: ${tone}. Mode: ${abc}.

WAJIB:
- Jawaban pendek untuk WhatsApp. Maks 4–6 baris.
- Maks 1 pertanyaan di stage 0, maks 2 pertanyaan di stage 1-2.
- Jangan mengarang alamat. Jika ditanya lokasi, jawab HANYA link: ${MAPS_LINK}
- Jangan “mengemis closing”. Ikuti policy.
- Jika user tanya harga: jangan angka fix. Jelaskan singkat: perlu diagnosa, biaya tergantung penyebab.
- Hindari kalimat generik “kami sarankan untuk...”. Pakai gaya mekanik: jelas, to-the-point.

POLICY:
- ${policy}

Output:
- 1–3 kalimat analisa singkat.
- lalu pertanyaan triase (sesuai batas).
- jangan tulis signature/footer (server yang tambah).
`.trim();
}

async function aiReply({ userText, style, stage, type, modeABC, priceOnly }) {
  if (!OPENAI_API_KEY || !OpenAIClientClass) return null;

  let client;
  try { client = new OpenAIClientClass({ apiKey: OPENAI_API_KEY }); }
  catch (e) { console.error("OpenAI init failed:", e.message); return null; }

  const timeoutMs = Number(OPENAI_TIMEOUT_MS) || 9000;

  try {
    const resp = await withTimeout(
      client.chat.completions.create({
        model: OPENAI_MODEL,
        temperature: 0.35,
        messages: [
          { role: "system", content: buildSystemPrompt({ style, stage, type, userText, modeABC, priceOnly }) },
          { role: "user", content: userText },
        ],
      }),
      timeoutMs,
      "OPENAI_TIMEOUT"
    );

    let text = resp?.choices?.[0]?.message?.content?.trim();
    if (!text) return null;

    text = mustMapsOnly(text, userText);
    text = clampWhatsApp(text, 420);

    return text;
  } catch (e) {
    console.error("OpenAI failed:", e.message);
    return null;
  }
}

// ---------- ADMIN COMMANDS (sama seperti sebelumnya, dipertahankan) ----------
function adminHelp() {
  return [
    `✅ Admin Panel Hongz`,
    ``,
    `Commands:`,
    `HELP / MENU`,
    `LIST`,
    `STATS`,
    `CLAIM T-12345`,
    `CLOSE T-12345`,
    `NOTE T-12345 isi...`,
  ].join("\n");
}

function listTickets(db) {
  const all = Object.values(db.tickets || {});
  const active = all
    .filter(t => t.status !== "CLOSED")
    .sort((a, b) => (b.lastInboundAtMs || 0) - (a.lastInboundAtMs || 0))
    .slice(0, 12);

  if (!active.length) return "Tidak ada tiket aktif saat ini.";

  const lines = ["📋 Tiket Aktif (Top 12):"];
  for (const t of active) {
    const shortMsg = (t.lastBody || "").replace(/\s+/g, " ").slice(0, 28);
    lines.push(`${t.id} | ${t.tag} | ${t.status} | ${t.msisdn} | ${t.type} | stage:${t.stage} | ${t.locationUrl ? "📍" : "-"} | ${shortMsg}`);
  }
  lines.push("");
  lines.push("Ketik: CLAIM T-xxxxx / CLOSE T-xxxxx / NOTE T-xxxxx ...");
  return lines.join("\n");
}

function statsTickets(db) {
  const all = Object.values(db.tickets || {});
  const active = all.filter(t => t.status !== "CLOSED");
  const priority = active.filter(t => (t.tag || "").includes("PRIORITY")).length;
  const potential = active.filter(t => (t.tag || "").includes("POTENTIAL")).length;
  const normal = active.length - priority - potential;
  const towing = active.filter(t => t.type === "TOWING").length;
  const jadwal = active.filter(t => t.type === "JADWAL").length;

  return [
    `📊 HONGZ SUMMARY`,
    `Aktif: ${active.length}`,
    `🔴 PRIORITY: ${priority}`,
    `🟡 POTENTIAL: ${potential}`,
    `🔵 NORMAL: ${normal}`,
    ``,
    `TOWING aktif: ${towing}`,
    `JADWAL aktif: ${jadwal}`,
  ].join("\n");
}

function findTicket(db, ticketId) {
  const id = String(ticketId || "").trim().toUpperCase();
  return db.tickets?.[id] || null;
}

function handleAdminCommand(db, body) {
  const t = upper(body);

  if (t === "HELP" || t === "MENU") return adminHelp();
  if (t === "LIST") return listTickets(db);
  if (t === "STATS") return statsTickets(db);

  if (t.startsWith("CLAIM ")) {
    const id = t.split(/\s+/)[1];
    const ticket = findTicket(db, id);
    if (!ticket) return `Ticket ${id} tidak ditemukan.`;
    ticket.status = "CLAIMED";
    ticket.updatedAt = nowISO();
    return `✅ ${ticket.id} di-CLAIM.\nCustomer: ${ticket.from}\nNomor: ${ticket.msisdn}\nwa.me: ${ticket.waMe}\nLokasi: ${ticket.locationUrl || "(belum ada)"}`;
  }

  if (t.startsWith("CLOSE ")) {
    const id = t.split(/\s+/)[1];
    const ticket = findTicket(db, id);
    if (!ticket) return `Ticket ${id} tidak ditemukan.`;
    ticket.status = "CLOSED";
    ticket.updatedAt = nowISO();
    const cust = db.customers?.[ticket.customerId];
    if (cust && cust.activeTicketId === ticket.id) cust.activeTicketId = "";
    return `✅ ${ticket.id} di-CLOSE.`;
  }

  if (t.startsWith("NOTE ")) {
    const parts = body.split(" ");
    const id = (parts[1] || "").toUpperCase();
    const note = body.split(" ").slice(2).join(" ").trim();
    const ticket = findTicket(db, id);
    if (!ticket) return `Ticket ${id} tidak ditemukan.`;
    if (!note) return `Format: NOTE ${id} isi catatan...`;
    ticket.notes = ticket.notes || [];
    ticket.notes.push({ at: nowISO(), note });
    ticket.updatedAt = nowISO();
    return `📝 Note tersimpan untuk ${ticket.id}.`;
  }

  return `Perintah tidak dikenal. Ketik HELP.`;
}

// ---------- FOLLOW-UP (tetap ada, tapi lebih pendek) ----------
function isDueForFollowup(ticket) {
  if (String(FOLLOWUP_ENABLED).toLowerCase() !== "true") return false;
  if (!ticket || ticket.status === "CLOSED") return false;

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
  const line1 = ticket.type === "TOWING"
    ? "Kami follow-up ya. Kalau unit masih tidak aman dijalankan:"
    : "Kami follow-up ya—kalau masih sempat, kita lanjut sedikit infonya.";

  const ask = ticket.stage <= 0
    ? "Mobil & tahunnya apa, dan gejala paling terasa apa?"
    : "Sekarang gejalanya masih sama atau berubah?";

  const action = ticket.type === "TOWING"
    ? "Kirim *share lokasi* supaya admin arahkan towing."
    : (ticket.stage >= 2 ? "Kalau sudah siap, ketik *JADWAL* biar kami atur waktu." : "Kalau Anda jawab 1 info itu, saya arahin langkah paling aman.");

  return clampWhatsApp([
    line1,
    ask,
    action,
    "Jika tidak ingin follow-up lagi, ketik STOP.",
  ].join("\n"), 480);
}

async function followupAI(ticket) {
  // optional: boleh dibiarkan fallback saja agar stabil
  return null;
}

// ---------- MAIN WEBHOOK HANDLER ----------
async function webhookHandler(req, res) {
  const db = loadDB();

  const from = normalizeFrom(req.body.From || "");
  const to = normalizeFrom(req.body.To || "");
  const body = normText(req.body.Body || "");
  const location = extractLocation(req.body);

  dlog("IN", { from, to, body, hasLocation: !!location });

  // ADMIN
  if (isAdmin(from)) {
    const reply = handleAdminCommand(db, body);
    saveDB(db);
    return replyTwiML(res, reply);
  }

  // customer identity
  const customerId = sha16(from);
  if (!db.customers[customerId]) {
    db.customers[customerId] = {
      from,
      firstSeen: nowISO(),
      lastSeen: nowISO(),
      activeTicketId: "",
      optOut: false,
    };
  } else {
    db.customers[customerId].lastSeen = nowISO();
  }

  // STOP/START
  if (upper(body) === "STOP" || upper(body) === "UNSUBSCRIBE") {
    db.customers[customerId].optOut = true;
    saveDB(db);
    return replyTwiML(res, "Baik. Follow-up dimatikan. Kalau mau aktif lagi, ketik START.");
  }
  if (upper(body) === "START" || upper(body) === "SUBSCRIBE") {
    db.customers[customerId].optOut = false;
    saveDB(db);
    return replyTwiML(res, "Siap. Follow-up aktif. Silakan tulis keluhan Anda.");
  }

  const ticket = getOrCreateTicket(db, customerId, from);

  const cmdTowing = isCommand(body, "TOWING");
  const cmdJadwal = isCommand(body, "JADWAL");
  const cantDrive = detectCantDrive(body);
  const hasLoc = !!location;
  const priceOnly = detectPriceOnly(body);

  const style = detectStyle(body);
  const modeABC = detectModeABC(body);

  // stage update
  let stage = Number(ticket.stage || 0);
  const vInfo = hasVehicleInfo(body);
  const sInfo = hasSymptomInfo(body);

  if (cmdJadwal || askedForSchedule(body)) stage = Math.max(stage, 2);
  else if (vInfo || sInfo) stage = Math.max(stage, 1);
  if (vInfo && sInfo) stage = Math.max(stage, 2);

  const type = cmdJadwal ? "JADWAL" : (cmdTowing || cantDrive || hasLoc ? "TOWING" : "GENERAL");

  updateTicket(ticket, {
    lastBody: body,
    lastInboundAtMs: nowMs(),
    waMe: toWaMe(from),
    msisdn: cleanMsisdn(from),
    type,
    stage,
  });

  if (location?.mapsUrl) ticket.locationUrl = location.mapsUrl;

  db.events.push({
    t: nowISO(),
    from,
    to,
    body,
    ticketId: ticket.id,
    locationUrl: ticket.locationUrl || "",
  });
  if (db.events.length > 5000) db.events = db.events.slice(-2000);

  // RULE: location received
  if (hasLoc) {
    await notifyAdmin({
      title: "📍 *LOCATION RECEIVED (AUTO)*",
      ticket,
      reason: "Customer shared location",
      body,
      locationUrl: ticket.locationUrl,
    });

    saveDB(db);
    const reply = clampWhatsApp([
      "Baik, lokasi sudah kami terima ✅",
      "Admin akan follow up untuk langkah berikutnya.",
      confidenceLine(style),
    ].join("\n"), 360) + "\n\n" + signatureMini();

    return replyTwiML(res, reply);
  }

  // RULE: towing / can't drive
  if (cmdTowing || cantDrive) {
    await notifyAdmin({
      title: "🚨 *PRIORITY TOWING (AUTO)*",
      ticket,
      reason: cmdTowing ? "Customer typed TOWING" : "Customer mentions can't drive / risk",
      body,
      locationUrl: ticket.locationUrl || "",
    });

    saveDB(db);
    return replyTwiML(res, towingInstruction(ticket, style));
  }

  // RULE: jadwal
  if (cmdJadwal) {
    await notifyAdmin({
      title: "📅 *BOOKING REQUEST (AUTO)*",
      ticket,
      reason: "Customer typed JADWAL",
      body,
      locationUrl: ticket.locationUrl || "",
    });

    saveDB(db);
    return replyTwiML(res, jadwalInstruction(ticket, style));
  }

  // RULE: location asked
  if (askedLocation(body)) {
    saveDB(db);
    const reply = [
      `Untuk lokasi, silakan buka: ${MAPS_LINK}`,
      confidenceLine(style),
      "",
      signatureFull(),
    ].join("\n");
    return replyTwiML(res, reply);
  }

  // DEFAULT: AI reply (pendek)
  const ai = await aiReply({ userText: body, style, stage, type, modeABC, priceOnly });

  let replyText;
  if (ai) {
    const authority = maybeAuthorityLine({ modeABC, stage, priceOnly });
    const footer = buildFooter({ stage, type, userText: body });

    replyText = clampWhatsApp(
      [
        ai,
        authority ? `\n${authority}` : "",
        `\n${confidenceLine(style)}`,
      ].join("\n").trim(),
      520
    ) + footer;
  } else {
    // fallback (lebih mekanik, pendek)
    const q =
      stage <= 0
        ? "Mobil & tahun berapa, dan gejala paling terasa apa?"
        : "Gejalanya muncul saat dingin atau setelah panas/macet?";

    const authority = maybeAuthorityLine({ modeABC, stage, priceOnly });
    const footer = buildFooter({ stage, type, userText: body });

    replyText = clampWhatsApp(
      [
        "Oke, saya tangkap ya. Biar tidak salah arah, saya pastikan 1 hal dulu.",
        q,
        priceOnly ? "Soal biaya, kita tentukan setelah diagnosa—biar akurat sesuai penyebab." : "",
        authority ? authority : "",
        confidenceLine(style),
      ].filter(Boolean).join("\n"),
      520
    ) + footer;
  }

  ticket.lastBotAtMs = nowMs();
  saveDB(db);
  return replyTwiML(res, replyText);
}

// ---------- ROUTES ----------
app.post(["/twilio/webhook", "/whatsapp/incoming"], (req, res) => {
  webhookHandler(req, res).catch((e) => {
    console.error("Webhook fatal:", e.message);
    return replyTwiML(res, "Maaf, sistem lagi padat. Coba ulangi sebentar ya 🙏");
  });
});

// ---------- CRON FOLLOW-UP ----------
app.get("/cron/followup", async (req, res) => {
  try {
    const key = String(req.query.key || "");
    if (!CRON_KEY || key !== CRON_KEY) return res.status(403).send("Forbidden");
    if (String(FOLLOWUP_ENABLED).toLowerCase() !== "true") return res.status(200).send("Follow-up disabled");

    const db = loadDB();
    const tickets = Object.values(db.tickets || {});
    let sent = 0;

    for (const t of tickets) {
      const cust = db.customers?.[t.customerId];
      if (cust?.optOut) continue;
      if (t.status === "CLOSED") continue;

      if (isDueForFollowup(t)) {
        let msg = await followupAI(t);
        if (!msg) msg = followupFallback(t);

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
    console.error("cron/followup error:", e.message);
    return res.status(500).send("Error");
  }
});

// ---------- HEALTH ----------
app.get("/", (_req, res) => res.status(200).send("HONGZ AI SERVER — FINAL++ — OK"));

// ---------- START ----------
const port = process.env.PORT || 10000;
app.listen(port, () => {
  console.log("HONGZ AI SERVER — FINAL++ — START");
  console.log("Listening on port:", port);
  console.log("Webhook routes: /twilio/webhook and /whatsapp/incoming");
});