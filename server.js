/**
 * HONGZ AI — HYBRID ELITE C+ FINAL
 * Leader Mode 65%
 * Authority Mode 35% (auto trigger jika 3T / 3M / meremehkan)
 * Radar Monitor + Admin Stabil Aktif
 */

const express = require("express");
const bodyParser = require("body-parser");
const twilio = require("twilio");
const fs = require("fs");
const path = require("path");

let OpenAI = null;
try {
  const mod = require("openai");
  OpenAI = mod?.default || mod;
} catch (_) {}

const {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_WHATSAPP_FROM,
  ADMIN_WHATSAPP_TO,

  MONITOR_WHATSAPP_TO = "",
  OPENAI_API_KEY,
  OPENAI_MODEL = "gpt-4o-mini",
  OPENAI_MODEL_PREMIUM = "gpt-4o",

  AI_MODE = "HYBRID",

} = process.env;

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

// ===============================
// FILTER 3T + 3M
// ===============================

function detectJebakan(text) {
  const t = text.toLowerCase();

  const tukangTanya =
    /berapa|kisaran|range|budget|murah|diskon|harga doang/i.test(t) &&
    t.length < 35;

  const 3M =
    /murah|meriah|mantap|paling murah|bisa kurang|nego/i.test(t);

  const meremehkan =
    /yakin bisa|bengkel lain bilang|masa sih|ah cuma gitu/i.test(t);

  return tukangTanya || 3M || meremehkan;
}

// ===============================
// MODE OTAK HYBRID
// ===============================

function buildPrompt(userText, mode) {

  const leaderTone = `
Gaya: Kepala bengkel tegas tapi disukai.
Jangan jualan.
Jangan memaksa booking.
Tajam, presisi, tidak bertele-tele.
`;

  const authorityTone = `
Gaya: Dominan profesional.
Jika user meremehkan / jebakan harga,
jawab dengan wibawa & arahkan kembali ke diagnosa.
`;

  return `
Anda adalah Kepala Bengkel Spesialis Transmisi Matic.
${mode === "AUTHORITY" ? authorityTone : leaderTone}

Aturan:
- Jangan beri angka harga pasti.
- Jangan menakut-nakuti.
- Maks 2 pertanyaan.
- Jika butuh cek langsung, arahkan soft ke pemeriksaan.
User:
${userText}
`;
}

async function aiReply(userText, score) {

  if (!OpenAI || !OPENAI_API_KEY) return null;

  const isPriority = score >= 8;

  let mode = "LEADER";
  if (detectJebakan(userText)) mode = "AUTHORITY";

  const model =
    AI_MODE === "HYBRID" && isPriority
      ? OPENAI_MODEL_PREMIUM
      : OPENAI_MODEL;

  const client = new OpenAI({ apiKey: OPENAI_API_KEY });

  const resp = await client.chat.completions.create({
    model,
    temperature: 0.35,
    messages: [
      { role: "system", content: buildPrompt(userText, mode) },
      { role: "user", content: userText }
    ]
  });

  return resp.choices[0].message.content.trim();
}// ===============================
// DATABASE SIMPLE (FILE JSON)
// ===============================
const DATA_DIR = process.env.DATA_DIR || "/var/data";
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = path.join(DATA_DIR, "hongz_db.json");

function loadDB() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, "utf8")); }
  catch (_) { return { tickets: {}, events: [] }; }
}
function saveDB(db) {
  try { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), "utf8"); }
  catch (_) {}
}

function nowMs() { return Date.now(); }
function nowISO() { return new Date().toISOString(); }

function escapeXml(unsafe) {
  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
function replyTwiML(res, text) {
  res.type("text/xml");
  return res.send(`<Response><Message>${escapeXml(text)}</Message></Response>`);
}

function normalizeFrom(from) { return String(from || "").trim(); }
function cleanMsisdn(from) {
  return String(from || "").replace(/^whatsapp:\+?/i, "").replace(/[^\d]/g, "");
}
function toWaMe(from) {
  const n = cleanMsisdn(from);
  return n ? `https://wa.me/${n}` : "-";
}

// ===============================
// BRANDING (BENGKEL SAJA)
// ===============================
const BIZ_NAME = process.env.BIZ_NAME || "Hongz Bengkel – Spesialis Transmisi Matic";
const BIZ_HOURS = process.env.BIZ_HOURS || "Senin–Sabtu 09.00–17.00";
const MAPS_LINK = process.env.MAPS_LINK || "https://maps.app.goo.gl/CvFZ9FLNJRog7K4t9";
const WHATSAPP_ADMIN = process.env.WHATSAPP_ADMIN || "https://wa.me/6281375430728";
const WHATSAPP_CS = process.env.WHATSAPP_CS || "https://wa.me/6285752965167";

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

// ===============================
// SCORING LEAD (SIMPLE & KETAT)
// ===============================
function detectCantDrive(body) {
  return /tidak bisa jalan|ga bisa jalan|gak bisa jalan|mogok|stuck|selip parah|rpm naik tapi tidak jalan|masuk d tidak jalan|masuk r tidak jalan/i.test(body.toLowerCase());
}
function detectBuyingSignal(body) {
  return /kapan bisa|besok bisa|hari ini bisa|bisa masuk|jam berapa|alamat|lokasi|maps|jadwal|booking/i.test(body.toLowerCase());
}
function detectPriceOnly(body) {
  return /berapa|harga|biaya|kisaran|range|budget|murah|diskon|nego/i.test(body.toLowerCase());
}
function leadScore(body) {
  let s = 0;
  if (detectCantDrive(body)) s += 6;
  if (detectBuyingSignal(body)) s += 3;
  if (detectPriceOnly(body) && body.length < 35) s -= 2;
  if (s < 0) s = 0;
  if (s > 10) s = 10;
  return s;
}
function leadTag(score) {
  if (score >= 8) return "🔴 PRIORITY";
  if (score >= 5) return "🟡 POTENTIAL";
  return "🔵 NORMAL";
}

// ===============================
// ADMIN STABIL + RADAR
// ===============================
const MONITOR_COOLDOWN_SEC = Number(process.env.MONITOR_COOLDOWN_SEC || 20);
const ADMIN_NOTIFY_COOLDOWN_SEC = Number(process.env.ADMIN_NOTIFY_COOLDOWN_SEC || 60);

function shouldCooldown(lastMs, cooldownSec) {
  if (!lastMs) return true;
  return (nowMs() - lastMs) >= (cooldownSec * 1000);
}

async function sendWA(to, text) {
  try {
    await twilioClient.messages.create({
      from: TWILIO_WHATSAPP_FROM,
      to,
      body: text
    });
  } catch (e) {
    console.error("sendWA failed:", e.message);
  }
}

async function notifyAdmin(ticket, title, reason) {
  if (!ADMIN_WHATSAPP_TO) return;

  const msg = [
    title,
    `Ticket: ${ticket.id} (${ticket.tag} | score:${ticket.score}/10)`,
    `From: ${ticket.msisdn}`,
    `wa.me: ${ticket.waMe}`,
    reason ? `Alasan: ${reason}` : null,
    `Msg: ${(ticket.lastBody || "").slice(0, 220)}`,
    ``,
    `Commands: HELP | LIST | STATS | CLAIM ${ticket.id} | CLOSE ${ticket.id}`,
  ].filter(Boolean).join("\n");

  await sendWA(ADMIN_WHATSAPP_TO, msg);
}

async function notifyRadar(ticket) {
  const to = normalizeFrom(MONITOR_WHATSAPP_TO);
  if (!to) return;

  const msg = [
    "🛰️ RADAR IN",
    `Ticket: ${ticket.id} | ${ticket.tag} | score:${ticket.score}/10`,
    `From: ${ticket.msisdn}`,
    `wa.me: ${ticket.waMe}`,
    `Msg: ${(ticket.lastBody || "").slice(0, 180)}`
  ].join("\n");

  await sendWA(to, msg);
}

// ===============================
// ADMIN COMMANDS (BASIC)
// ===============================
function upper(s){ return String(s||"").trim().toUpperCase(); }

function adminHelp() {
  return [
    "✅ Admin Panel Hongz",
    "HELP / MENU",
    "LIST",
    "STATS",
    "CLAIM T-12345",
    "CLOSE T-12345",
  ].join("\n");
}

function listTickets(db) {
  const all = Object.values(db.tickets || {});
  const active = all.filter(t => t.status !== "CLOSED")
    .sort((a,b)=> (b.updatedAtMs||0)-(a.updatedAtMs||0))
    .slice(0, 12);

  if (!active.length) return "Tidak ada tiket aktif.";

  const lines = ["📋 Tiket Aktif:"];
  for (const t of active) {
    lines.push(`${t.id} | ${t.tag} | ${t.status} | ${t.msisdn} | ${(t.lastBody||"").slice(0,30)}`);
  }
  return lines.join("\n");
}

function statsTickets(db) {
  const all = Object.values(db.tickets || {});
  const active = all.filter(t => t.status !== "CLOSED");
  const pri = active.filter(t => t.tag.includes("PRIORITY")).length;
  const pot = active.filter(t => t.tag.includes("POTENTIAL")).length;
  const nor = active.length - pri - pot;

  return [
    "📊 HONGZ SUMMARY",
    `Aktif: ${active.length}`,
    `🔴 PRIORITY: ${pri}`,
    `🟡 POTENTIAL: ${pot}`,
    `🔵 NORMAL: ${nor}`,
  ].join("\n");
}

function handleAdminCommand(db, body) {
  const t = upper(body);
  if (t === "HELP" || t === "MENU") return adminHelp();
  if (t === "LIST") return listTickets(db);
  if (t === "STATS") return statsTickets(db);

  if (t.startsWith("CLAIM ")) {
    const id = t.split(/\s+/)[1];
    const tk = db.tickets[id];
    if (!tk) return `Ticket ${id} tidak ditemukan.`;
    tk.status = "CLAIMED";
    tk.updatedAtMs = nowMs();
    saveDB(db);
    return `✅ ${id} di-CLAIM.`;
  }

  if (t.startsWith("CLOSE ")) {
    const id = t.split(/\s+/)[1];
    const tk = db.tickets[id];
    if (!tk) return `Ticket ${id} tidak ditemukan.`;
    tk.status = "CLOSED";
    tk.updatedAtMs = nowMs();
    saveDB(db);
    return `✅ ${id} di-CLOSE.`;
  }

  return "Perintah tidak dikenal. Ketik HELP.";
}

// ===============================
// MAIN WEBHOOK
// ===============================
function genTicketId() {
  const n = Math.floor(10000 + Math.random() * 89999);
  return `T-${n}`;
}

function getTicket(db, from) {
  const key = cleanMsisdn(from);
  if (!db.tickets[key] || db.tickets[key].status === "CLOSED") {
    db.tickets[key] = {
      id: genTicketId(),
      status: "OPEN",
      msisdn: key,
      waMe: toWaMe(from),
      tag: "🔵 NORMAL",
      score: 0,
      lastBody: "",
      lastAdminAtMs: 0,
      lastRadarAtMs: 0,
      updatedAtMs: nowMs(),
      createdAt: nowISO(),
    };
  }
  return db.tickets[key];
}

app.post(["/twilio/webhook", "/whatsapp/incoming"], async (req, res) => {
  const db = loadDB();

  const from = normalizeFrom(req.body.From || "");
  const body = String(req.body.Body || "").trim();

  // ADMIN path
  if (normalizeFrom(from).toLowerCase() === normalizeFrom(ADMIN_WHATSAPP_TO).toLowerCase()) {
    const reply = handleAdminCommand(db, body);
    return replyTwiML(res, reply);
  }

  const ticket = getTicket(db, from);

  ticket.lastBody = body;
  ticket.updatedAtMs = nowMs();
  ticket.score = leadScore(body);
  ticket.tag = leadTag(ticket.score);

  // SAVE event log
  db.events.push({ t: nowISO(), from, body, ticket: ticket.id, score: ticket.score, tag: ticket.tag });
  if (db.events.length > 4000) db.events = db.events.slice(-2000);

  // RADAR notif (all)
  if (MONITOR_WHATSAPP_TO && shouldCooldown(ticket.lastRadarAtMs, MONITOR_COOLDOWN_SEC)) {
    ticket.lastRadarAtMs = nowMs();
    await notifyRadar(ticket);
  }

  // ADMIN notif (ketat: hanya priority/potential atau jebakan)
  const needAdmin =
    ticket.score >= 5 || detectJebakan(body) || detectCantDrive(body);

  if (needAdmin && shouldCooldown(ticket.lastAdminAtMs, ADMIN_NOTIFY_COOLDOWN_SEC)) {
    ticket.lastAdminAtMs = nowMs();
    await notifyAdmin(ticket, "📣 ADMIN ALERT", "Prospek / urgent / jebakan harga");
  }

  saveDB(db);

  // RULE: lokasi/alamat -> maps only
  if (/alamat|lokasi|maps|map|di mana|dimana/i.test(body.toLowerCase())) {
    return replyTwiML(res, `Untuk lokasi, silakan buka: ${MAPS_LINK}\n\n${signatureShort()}`);
  }

  // RULE: towing / tidak bisa jalan -> minta share lokasi
  if (/towing|evakuasi|dorong/i.test(body.toLowerCase()) || detectCantDrive(body)) {
    const msg = [
      "Baik Bang, kalau unit sudah *tidak bisa jalan*, jangan dipaksakan dulu ya.",
      "Yang paling aman: kirim *share lokasi sekarang* agar admin bisa koordinasi evakuasi yang tepat.",
      "",
      "⚡ Untuk respons tercepat, langsung voice call Admin:",
      WHATSAPP_ADMIN,
      "",
      "✅ Tenang ya, kami bantu sampai jelas langkahnya.",
    ].join("\n");
    return replyTwiML(res, msg);
  }

  // RULE: jadwal
  if (/jadwal|booking|bisa masuk|kapan bisa/i.test(body.toLowerCase())) {
    const msg = [
      "Siap Bang, untuk booking bisa kirim data singkat:",
      "1) Nama",
      "2) Mobil & tahun",
      "3) Keluhan utama",
      "4) Rencana datang (hari & jam)",
      "",
      "Admin akan konfirmasi slot yang paling pas.",
      "",
      signatureShort()
    ].join("\n");
    return replyTwiML(res, msg);
  }

  // DEFAULT: AI reply hybrid
  let aiText = null;
  try { aiText = await aiReply(body, ticket.score); } catch (e) {}

  if (!aiText) {
    aiText = [
      "Siap Bang, saya bantu arahkan dulu ya.",
      "Boleh info mobil & tahunnya + gejala yang paling terasa (rpm naik / jedug / telat masuk gigi)?",
    ].join("\n");
  }

  return replyTwiML(res, `${aiText}\n\n${signatureShort()}`);
});

// HEALTH
app.get("/", (_req, res) => res.status(200).send("HONGZ AI — HYBRID ELITE C+ — OK"));

const port = process.env.PORT || 10000;
app.listen(port, () => console.log("HONGZ AI — START on", port));