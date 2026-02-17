/**
 * HONGZ AI SERVER — ENTERPRISE C+ (ONE FILE) — FULL FINAL (Human AI + Anti-Todong + Stage CTA)
 * ✅ Versi FINAL + Battle Mode:
 * - Human AI natural (ngobrol manusia), tidak kaku, tidak “preman todong closing”
 * - Closing/CTA muncul bertahap (stage-based) + buying-signal detector
 * - MODE DIAM anti misnok (pengorek info) + MODE DOMINAN elegan kalau diremehkan
 * - TOWING footer tanpa MAPS_LINK + TOWING style #3 (Kepala Bengkel Premium)
 * - Ticket + scoring + tag + admin notif + follow-up CRON
 *
 * REQUIRED ENV:
 *   TWILIO_ACCOUNT_SID
 *   TWILIO_AUTH_TOKEN
 *   TWILIO_WHATSAPP_FROM      e.g. "whatsapp:+6285xxxx"
 *   ADMIN_WHATSAPP_TO         e.g. "whatsapp:+62813xxxx"  (Papa/admin)
 *
 * OPTIONAL (AI):
 *   OPENAI_API_KEY
 *   OPENAI_MODEL="gpt-4o-mini"          (boleh ganti)
 *   OPENAI_TIMEOUT_MS="9000"
 *
 * BRANDING:
 *   BIZ_NAME, BIZ_ADDRESS, BIZ_HOURS, MAPS_LINK
 *   WHATSAPP_ADMIN, WHATSAPP_CS   (public https://wa.me/ links)
 *
 * FOLLOWUP:
 *   FOLLOWUP_ENABLED="true"
 *   FOLLOWUP_STAGE1_HOURS="18"
 *   FOLLOWUP_STAGE2_HOURS="48"
 *   FOLLOWUP_COOLDOWN_HOURS="24"
 *   FOLLOWUP_MAX_PER_CUSTOMER="2"
 *   CRON_KEY="hongzCron_xxx"
 *
 * SCARCITY:
 *   SCARCITY_MODE="soft"  (soft|hard)
 *   SCARCITY_SLOTS="2"
 *
 * STORAGE:
 *   DATA_DIR="/var/data"
 *
 * DEBUG:
 *   DEBUG="true"
 *
 * NOTE DEPENDENCY (package.json):
 *   "express", "body-parser", "twilio", "openai"
 *   Untuk OpenAI: pakai "openai": "^4.0.0"
 */

const express = require("express");
const bodyParser = require("body-parser");
const twilio = require("twilio");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// OpenAI (optional) — support openai v4 exports
let OpenAI = null;
try {
  const mod = require("openai");
  OpenAI = mod?.default || mod;
} catch (_) {
  OpenAI = null;
}

// ---------- ENV ----------
const {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_WHATSAPP_FROM,
  ADMIN_WHATSAPP_TO,

  OPENAI_API_KEY,
  OPENAI_MODEL = "gpt-4o-mini",
  OPENAI_TIMEOUT_MS = "9000",

  // towing style: 1=ideal, 2=super singkat, 3=kepala bengkel premium
  TOWING_STYLE = "3",

  BIZ_NAME = "Hongz Bengkel – Spesialis Transmisi Matic",
  BIZ_ADDRESS = "Jl. M. Yakub No.10b, Medan Perjuangan",
  BIZ_HOURS = "Senin–Sabtu 09.00–17.00",
  MAPS_LINK = "https://maps.app.goo.gl/CvFZ9FLNJRog7K4t9",
  WHATSAPP_ADMIN = "https://wa.me/6281375430728",
  WHATSAPP_CS = "https://wa.me/6285752965167",

  FOLLOWUP_ENABLED = "true",
  FOLLOWUP_STAGE1_HOURS = "18",
  FOLLOWUP_STAGE2_HOURS = "48",
  FOLLOWUP_COOLDOWN_HOURS = "24",
  FOLLOWUP_MAX_PER_CUSTOMER = "2",

  SCARCITY_MODE = "soft", // soft | hard
  SCARCITY_SLOTS = "2",

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

// ---------- SIGNATURES ----------
function signatureShort() {
  return [
    `— ${BIZ_NAME}`,
    `🧭 Maps: ${MAPS_LINK}`,
    `⏱ ${BIZ_HOURS}`,
    `📲 Admin: ${WHATSAPP_ADMIN}`,
    `💬 CS: ${WHATSAPP_CS}`,
    `Ketik *JADWAL* (booking) / *TOWING* (darurat)`,
  ].join("\n");
}

// ✅ TOWING footer TANPA MAPS_LINK (no promo)
function signatureTowing(style = "3") {
  const s = String(style || "3");
  if (s === "2") {
    return [
      `— ${BIZ_NAME}`,
      `📲 Admin cepat: ${WHATSAPP_ADMIN}`,
      `Ketik *TOWING* + kirim *share lokasi*`,
    ].join("\n");
  }
  if (s === "1") {
    return [
      `— ${BIZ_NAME}`,
      `⏱ ${BIZ_HOURS}`,
      `📲 Admin: ${WHATSAPP_ADMIN}`,
      `Jika perlu cepat: klik Admin lalu bisa *telepon/voice call*.`,
    ].join("\n");
  }
  // style 3: kepala bengkel premium (elegan + tegas)
  return [
    `— ${BIZ_NAME} (Precision Transmission Center)`,
    `📲 Admin prioritas: ${WHATSAPP_ADMIN}`,
    `⚡ Jika darurat, klik Admin untuk *voice call* (lebih cepat koordinasi).`,
  ].join("\n");
}

function confidenceLine(style = "neutral") {
  if (style === "casual") return `✅ Tenang ya, kita bantu sampai jelas langkahnya 🙂`;
  return `✅ Tenang ya, kami bantu sampai jelas langkahnya.`;
}

// ---------- SCARCITY (halus & hanya saat stage cukup) ----------
function scarcityLine(ticket) {
  const mode = String(SCARCITY_MODE || "soft").toLowerCase();
  const slots = Number(SCARCITY_SLOTS || 2);
  const tag = String(ticket?.tag || "");

  if (mode === "hard") {
    const s = Number.isFinite(slots) ? slots : 2;
    if (tag.includes("PRIORITY")) return `⏳ Slot diagnosa hari ini tinggal ${s}. Kalau Anda siap, kami bisa amankan lebih dulu.`;
    return `⏳ Slot pemeriksaan hari ini tinggal ${s}.`;
  }

  if (tag.includes("PRIORITY")) return "⏳ Slot diagnosa hari ini terbatas agar penanganan tetap fokus & presisi.";
  return "⏳ Jika memungkinkan, lebih cepat dicek biasanya lebih aman.";
}

// ---------- LEAD SCORING ----------
function detectPremium(body) {
  return /land cruiser|alphard|vellfire|lexus|bmw|mercedes|benz|audi|porsche|range rover|land rover|prado|lc200|lc300/i.test(body);
}
function detectCantDrive(body) {
  return /tidak bisa jalan|ga bisa jalan|gak bisa jalan|mogok|stuck|macet total|selip parah|rpm naik tapi tidak jalan|masuk d.*tidak jalan|masuk r.*tidak jalan|berisiko|darurat/i.test(body);
}
function detectPriceOnly(body) {
  return /berapa|biaya|harga|kisaran|range|murah|diskon|nego|budget/i.test(body);
}
function leadScore({ body, hasLocation, isTowingCmd, isJadwalCmd }) {
  let score = 0;
  if (detectCantDrive(body)) score += 5;
  if (hasLocation) score += 5;
  if (isTowingCmd) score += 5;
  if (detectPremium(body)) score += 3;
  if (isJadwalCmd) score += 4;
  if (detectPriceOnly(body) && String(body || "").length < 35) score -= 2;
  if (score < 0) score = 0;
  if (score > 10) score = 10;
  return score;
}
function leadTag(score) {
  if (score >= 8) return "🔴 PRIORITY";
  if (score >= 5) return "🟡 POTENTIAL";
  return "🔵 NORMAL";
}

// ---------- HUMAN STYLE DETECTION ----------
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

function composeTone(style) {
  if (style === "urgent") return "tenang, sigap, menenangkan";
  if (style === "formal") return "sopan, profesional, rapi";
  if (style === "casual") return "ramah, santai, natural";
  return "ramah-profesional, natural, enak dibaca";
}

// ---------- BATTLE MODES ----------
function detectSuspicious(body) {
  const t = String(body || "").toLowerCase();
  const shortPrice = /berapa|harga|biaya/i.test(t) && t.length < 25;
  const testingTone = /bisa gak|yakin bisa|berapa lama sih|emang bisa|kok mahal/i.test(t);
  return !!(shortPrice || testingTone);
}

function detectChallengingTone(body) {
  const t = String(body || "").toLowerCase();
  return /yakin bisa|pernah ngerjain|ah masa|bisa gak sih|cuma gitu doang|bengkel lain bilang/i.test(t);
}

function detectBuyingSignal(body) {
  const t = String(body || "").toLowerCase();
  return /kapan bisa|besok bisa|hari ini bisa|bisa masuk|siap datang|jam berapa|alamat dimana|lokasi dimana|jam buka/i.test(t);
}

// ---------- STAGE ----------
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
function askedForSchedule(body) {
  return /kapan bisa masuk|jadwal|booking|bisa hari|bisa jam|kapan bisa datang/i.test(String(body || "").toLowerCase());
}

// ---------- TICKET MODEL ----------
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
    status: "OPEN", // OPEN | CLAIMED | CLOSED
    createdAt: nowISO(),
    updatedAt: nowISO(),
    score: 0,
    tag: "🔵 NORMAL",
    lastBody: "",
    locationUrl: "",
    notes: [],
    type: "GENERAL", // GENERAL | TOWING | JADWAL
    stage: 0, // 0=baru ngobrol, 1=mulai ada info, 2=siap diarahkan
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
    `Ticket: ${ticket.id} (${ticket.tag} | Score ${ticket.score}/10 | stage:${ticket.stage})`,
    `Customer: ${ticket.from}`,
    `Nomor: ${ticket.msisdn}`,
    `Chat customer: ${ticket.waMe}`,
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

// ✅ TOWING style #3 (kepala bengkel premium) + footer tanpa MAPS
function towingInstruction(ticket, style) {
  const towingStyle = String(TOWING_STYLE || "3");

  if (towingStyle === "2") {
    return [
      "Jangan dipaksakan ya.",
      "Kirim *share lokasi* — admin langsung koordinasi evakuasi/towing.",
      (ticket?.locationUrl ? `📍 Lokasi: ${ticket.locationUrl}` : ""),
      confidenceLine(style),
      "",
      signatureTowing("2"),
    ].filter(Boolean).join("\n");
  }

  if (towingStyle === "1") {
    return [
      "Baik, kalau unit tidak aman dijalankan sebaiknya *jangan dipaksakan* dulu.",
      "Boleh kirim *share lokasi*? Setelah lokasi masuk, admin langsung follow up untuk arahkan evakuasi/towing.",
      (ticket?.locationUrl ? `📍 Lokasi: ${ticket.locationUrl}` : ""),
      confidenceLine(style),
      "",
      signatureTowing("1"),
    ].filter(Boolean).join("\n");
  }

  // style 3: tegas elegan, tidak cerewet
  return [
    "Oke. Kalau gejalanya sudah *tidak aman*, jangan dipaksakan jalan dulu ya.",
    "Kirim *share lokasi* sekarang — admin prioritas langsung koordinasi evakuasi/towing.",
    (ticket?.locationUrl ? `📍 Lokasi: ${ticket.locationUrl}` : ""),
    "Kalau perlu cepat, klik Admin untuk *voice call* (lebih cepat koordinasi).",
    confidenceLine(style),
    "",
    signatureTowing("3"),
  ].filter(Boolean).join("\n");
}

function jadwalInstruction(ticket, style) {
  return [
    `Siap, untuk *booking pemeriksaan*, boleh kirim data singkat ya:`,
    `1) Nama`,
    `2) Mobil & tahun`,
    `3) Keluhan utama (contoh: rpm naik, jedug, telat masuk gigi)`,
    `4) Rencana datang (hari & jam)`,
    ``,
    (ticket.stage >= 2 ? scarcityLine(ticket) : ""),
    confidenceLine(style),
    ``,
    signatureShort(),
  ].filter(Boolean).join("\n");
}

// ---------- AI HELPERS ----------
function withTimeout(promise, ms, label = "TIMEOUT") {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(label)), ms)),
  ]);
}

// ✅ FIX: jangan salah potong kata “jalan”
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

function closingPolicy(stage, ticketType, userText) {
  if (ticketType === "TOWING") return "fokus towing + minta share lokasi. jangan bahas booking dulu.";
  if (askedForSchedule(userText)) return "user sudah tanya jadwal; boleh jawab jadwal/ajak JADWAL secara sopan.";
  if (stage <= 0) return "JANGAN mendorong booking. fokus tanya 1–2 pertanyaan triase.";
  if (stage === 1) return "boleh sisipkan ajakan booking 1 kalimat (soft), tidak memaksa.";
  return "boleh ajak booking lebih jelas tapi tetap soft (tanpa ancaman/menakut-nakuti).";
}

function buildSystemPrompt({ style, stage, ticket, userText, cantDrive, priceOnly }) {
  const tone = composeTone(style);
  const policy = closingPolicy(stage, ticket.type, userText);

  return `
Anda adalah konsultan teknis WhatsApp ${BIZ_NAME} (Medan), spesialis transmisi matic.
Gaya bahasa: ${tone}. Harus terasa seperti mekanik senior/kepala bengkel (bukan CS jual tiket).

ATURAN WAJIB:
- Jangan mengarang alamat. Jika ditanya lokasi/alamat, jawab HANYA dengan link: ${MAPS_LINK}
- Maksimal 2 pertanyaan dalam satu balasan.
- Jangan “todong closing”. Ikuti policy.
- Jika tidak bisa jalan/berisiko: sarankan jangan dipaksakan + minta share lokasi.
- Jika user tanya harga: jangan beri angka fix. Jelaskan bahwa perlu diagnosa dulu (singkat).
- Jawaban ringkas, tajam, relevan. Hindari cerewet.

KONTEKS:
- TicketTag: ${ticket.tag}
- TicketType: ${ticket.type}
- Stage: ${stage} (0=baru ngobrol, 1=mulai ada info, 2=siap diarahkan)
- cantDrive: ${cantDrive}
- priceOnly: ${priceOnly}

POLICY:
- ${policy}

OUTPUT:
- 1 paragraf analisa singkat yang meyakinkan & menenangkan (tanpa nakut-nakutin)
- lalu 1–2 pertanyaan triase (jika perlu)
- jangan tulis signature panjang (server yang tambah).
`.trim();
}

async function aiReply({ userText, ticket, style, stage, cantDrive, priceOnly }) {
  if (!OPENAI_API_KEY || !OpenAI) return null;

  let client;
  try { client = new OpenAI({ apiKey: OPENAI_API_KEY }); }
  catch (e) { console.error("OpenAI init failed:", e.message); return null; }

  const timeoutMs = Number(OPENAI_TIMEOUT_MS) || 9000;

  try {
    const resp = await withTimeout(
      client.chat.completions.create({
        model: OPENAI_MODEL,
        temperature: 0.35,
        messages: [
          { role: "system", content: buildSystemPrompt({ style, stage, ticket, userText, cantDrive, priceOnly }) },
          { role: "user", content: userText },
        ],
      }),
      timeoutMs,
      "OPENAI_TIMEOUT"
    );

    let text = resp?.choices?.[0]?.message?.content?.trim();
    if (!text) return null;

    text = mustMapsOnly(text, userText);
    if (text.length > 900) text = text.slice(0, 900).trim() + "…";
    return text;
  } catch (e) {
    console.error("OpenAI failed:", e.message);
    return null;
  }
}

// ---------- ADMIN COMMANDS ----------
function adminHelp() {
  return [
    `✅ Admin Panel Hongz`,
    ``,
    `Commands:`,
    `HELP / MENU          (panduan)`,
    `LIST                 (list tiket aktif)`,
    `STATS                (ringkasan)`,
    `CLAIM T-12345        (ambil tiket)`,
    `CLOSE T-12345        (tutup tiket)`,
    `NOTE T-12345 isi...  (catatan)`,
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
  const priority = active.filter(t => t.tag.includes("PRIORITY")).length;
  const potential = active.filter(t => t.tag.includes("POTENTIAL")).length;
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

// ---------- FOLLOW-UP ----------
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
  const line1 = ticket.tag.includes("PRIORITY")
    ? "Kami follow-up sebentar ya, supaya kondisinya tidak melebar."
    : "Kami follow-up ya—kalau masih sempat, boleh lanjut sedikit infonya.";

  const ask = ticket.stage <= 0
    ? "Boleh info mobil & tahunnya, plus gejala yang paling terasa?"
    : "Gejalanya sekarang masih sama atau ada perubahan?";

  const action =
    ticket.type === "TOWING"
      ? "Kalau unit tidak aman dijalankan, kirim *share lokasi* ya—admin prioritas akan bantu koordinasi."
      : (ticket.stage >= 2
          ? "Kalau Anda sudah siap, ketik *JADWAL*—nanti admin bantu pilih waktu yang pas."
          : "Kalau sudah oke, kita lanjutkan langkah paling aman untuk unitnya ya.");

  return [
    line1,
    ask,
    action,
    (ticket.stage >= 2 && ticket.type !== "TOWING" ? scarcityLine(ticket) : ""),
    confidenceLine("neutral"),
    "",
    signatureShort(),
    "",
    "Jika tidak ingin follow-up lagi, ketik STOP.",
  ].filter(Boolean).join("\n");
}

async function followupAI(ticket) {
  if (!OPENAI_API_KEY || !OpenAI) return null;

  let client;
  try { client = new OpenAI({ apiKey: OPENAI_API_KEY }); }
  catch (e) { console.error("OpenAI init failed:", e.message); return null; }

  const timeoutMs = Number(OPENAI_TIMEOUT_MS) || 9000;

  const sys = `
Anda menulis pesan follow-up WhatsApp untuk bengkel transmisi matic ${BIZ_NAME}.
Syarat:
- Nada ramah, manusiawi, tidak memaksa.
- Maks 2 kalimat inti + 1 pertanyaan ringan (opsional).
- Jangan menulis alamat. Jika perlu lokasi, hanya gunakan: ${MAPS_LINK}
- Jika type=TOWING: minta share lokasi (tanpa promosi).
- Jika GENERAL: ajak lanjut info dulu; booking hanya soft jika stage>=2.
- Jangan menyebut sistem internal.
`.trim();

  const user = `Konteks: tag=${ticket.tag}, type=${ticket.type}, stage=${ticket.stage}, lastMsg="${(ticket.lastBody || "").slice(0, 150)}"`;

  try {
    const resp = await withTimeout(
      client.chat.completions.create({
        model: OPENAI_MODEL,
        temperature: 0.35,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: user },
        ],
      }),
      timeoutMs,
      "OPENAI_TIMEOUT"
    );

    let text = resp?.choices?.[0]?.message?.content?.trim();
    if (!text) return null;

    text = mustMapsOnly(text, "");
    if (text.length > 500) text = text.slice(0, 500).trim() + "…";
    return text;
  } catch (e) {
    console.error("Followup AI failed:", e.message);
    return null;
  }
}

// ---------- MAIN WEBHOOK HANDLER ----------
async function webhookHandler(req, res) {
  const db = loadDB();

  const from = normalizeFrom(req.body.From || "");
  const to = normalizeFrom(req.body.To || "");
  const body = normText(req.body.Body || "");
  const location = extractLocation(req.body);

  dlog("IN", { from, to, body, hasLocation: !!location });

  // ADMIN path
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

  // STOP/START follow-up
  if (upper(body) === "STOP" || upper(body) === "UNSUBSCRIBE") {
    db.customers[customerId].optOut = true;
    saveDB(db);
    return replyTwiML(res, "Baik. Follow-up dinonaktifkan. Jika ingin aktif lagi, ketik START.");
  }
  if (upper(body) === "START" || upper(body) === "SUBSCRIBE") {
    db.customers[customerId].optOut = false;
    saveDB(db);
    return replyTwiML(res, "Siap. Follow-up diaktifkan kembali. Silakan tulis keluhan Anda.");
  }

  const ticket = getOrCreateTicket(db, customerId, from);

  const cmdTowing = isCommand(body, "TOWING");
  const cmdJadwal = isCommand(body, "JADWAL");
  const cantDrive = detectCantDrive(body);
  const hasLoc = !!location;
  const priceOnly = detectPriceOnly(body);

  const suspicious = detectSuspicious(body);
  const challenging = detectChallengingTone(body);
  const buyingSignal = detectBuyingSignal(body);

  const score = leadScore({
    body,
    hasLocation: hasLoc,
    isTowingCmd: cmdTowing,
    isJadwalCmd: cmdJadwal,
  });
  const tag = leadTag(score);

  // stage update
  let stage = Number(ticket.stage || 0);
  const vInfo = hasVehicleInfo(body);
  const sInfo = hasSymptomInfo(body);
  const scheduleAsk = askedForSchedule(body);

  if (cmdJadwal) stage = Math.max(stage, 2);
  else if (scheduleAsk || buyingSignal) stage = Math.max(stage, 2);
  else if (vInfo || sInfo) stage = Math.max(stage, 1);
  if (vInfo && sInfo) stage = Math.max(stage, 2);

  const type = cmdJadwal ? "JADWAL" : (cmdTowing || cantDrive || hasLoc ? "TOWING" : "GENERAL");

  updateTicket(ticket, {
    lastBody: body,
    lastInboundAtMs: nowMs(),
    score,
    tag,
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
    score,
    tag,
    locationUrl: ticket.locationUrl || "",
  });
  if (db.events.length > 5000) db.events = db.events.slice(-2000);

  const style = detectStyle(body);

  // RULE 1: location received -> notify admin
  if (hasLoc) {
    await notifyAdmin({
      title: "📍 *LOCATION RECEIVED (AUTO)*",
      ticket,
      reason: "Customer shared location",
      body,
      locationUrl: ticket.locationUrl,
    });

    saveDB(db);

    const reply = [
      "Baik, lokasi sudah kami terima ✅",
      "Admin akan follow up untuk langkah berikutnya (termasuk evakuasi/towing bila diperlukan).",
      "",
      confidenceLine(style),
      "",
      signatureTowing(TOWING_STYLE), // towing footer no maps
    ].join("\n");

    return replyTwiML(res, reply);
  }

  // RULE 2: towing / can't drive -> notify admin + ask location
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

  // RULE 3: jadwal -> notify admin + template
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

  // RULE 4: address question -> only MAPS_LINK (anti ngawur)
  if (/alamat|lokasi|maps|map|di mana|dimana/i.test(body)) {
    saveDB(db);
    const reply = [
      `Untuk lokasi, silakan buka: ${MAPS_LINK}`,
      confidenceLine(style),
      "",
      signatureShort(),
    ].join("\n");
    return replyTwiML(res, reply);
  }

  // ✅ MODE DIAM anti misnok (stage 0)
  if (suspicious && stage === 0) {
    const reply = [
      "Untuk biaya biasanya tergantung hasil diagnosa, karena tiap unit & penyebabnya bisa berbeda.",
      "Boleh info mobil & tahunnya dulu, plus gejala singkat yang paling terasa?",
      "",
      confidenceLine(style),
      "",
      signatureShort(),
    ].join("\n");

    saveDB(db);
    return replyTwiML(res, reply);
  }

  // ✅ MODE DOMINAN elegan kalau diremehkan
  if (challenging) {
    const reply = [
      "Untuk transmisi, yang menentukan hasil itu pembacaan data + pengukuran, bukan tebak-tebakan atau ganti part dulu.",
      "Kami biasa handle kasus seperti ini dengan alat ukur & prosedur diagnosa presisi.",
      "Boleh info mobil & tahun + gejala utama (1–2 poin) supaya saya arahkan langkah paling tepat?",
      "",
      confidenceLine(style),
      "",
      signatureShort(),
    ].join("\n");

    saveDB(db);
    return replyTwiML(res, reply);
  }

  // DEFAULT: Human AI reply (anti todong)
  const ai = await aiReply({ userText: body, ticket, style, stage, cantDrive, priceOnly });

  let replyText;
  if (ai) {
    const extra = [];

    // Scarcity hanya muncul kalau stage >=2 dan bukan towing
    if (stage >= 2 && type !== "TOWING") extra.push(scarcityLine(ticket));

    extra.push(confidenceLine(style));
    extra.push("");
    extra.push(signatureShort());

    replyText = [ai, ...extra].join("\n");
  } else {
    // fallback: ringkas + tajam, tidak cerewet
    const triageQ =
      stage <= 0
        ? "Boleh info mobil & tahunnya, plus gejala yang paling terasa (rpm naik / jedug / telat masuk gigi)?"
        : "Gejalanya lebih sering muncul saat dingin atau saat panas/macet?";

    const softAsk =
      stage >= 2
        ? "Kalau Anda berkenan, kita jadwalkan pemeriksaan biar diagnosanya presisi (ketik *JADWAL*)."
        : "";

    replyText = [
      "Oke, saya bantu arahkan dulu ya.",
      triageQ,
      (priceOnly ? "Untuk biaya tergantung penyebabnya—biar akurat, kita pastikan diagnosanya dulu." : ""),
      softAsk,
      (stage >= 2 && type !== "TOWING" ? scarcityLine(ticket) : ""),
      confidenceLine(style),
      "",
      signatureShort(),
    ].filter(Boolean).join("\n");
  }

  ticket.lastBotAtMs = nowMs();
  saveDB(db);
  return replyTwiML(res, replyText);
}

// ---------- DUAL ROUTES ----------
app.post(["/twilio/webhook", "/whatsapp/incoming"], (req, res) => {
  webhookHandler(req, res).catch((e) => {
    console.error("Webhook fatal:", e.message);
    return replyTwiML(res, "Maaf ya, sistem lagi padat. Silakan ulangi pesan Anda sebentar lagi 🙏");
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
app.get("/", (_req, res) => res.status(200).send("HONGZ AI SERVER — ENTERPRISE C+ (FULL FINAL) — OK"));

// ---------- START ----------
const port = process.env.PORT || 10000;
app.listen(port, () => {
  console.log("HONGZ AI SERVER — ENTERPRISE C+ (FULL FINAL) — START");
  console.log("Listening on port:", port);
  console.log("Webhook routes: /twilio/webhook and /whatsapp/incoming");
});