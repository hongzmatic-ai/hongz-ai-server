/*
==================================================
HONGZ AI SERVER — HYBRID C+ ELITE
FINAL v2.1 — ELITE STABLE (ONE FILE)
deps: express, body-parser, twilio, openai (^4)
==================================================
*/

const express = require("express");
const bodyParser = require("body-parser");
const twilio = require("twilio");
const OpenAI = require("openai");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// ================= ENV =================
const {
  // Twilio
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_WHATSAPP_FROM, // e.g. "whatsapp:+14155238886" or "whatsapp:+1xxx"
  ADMIN_WHATSAPP_TO,    // e.g. "whatsapp:+62813xxxx"
  MONITOR_WHATSAPP_TO,  // e.g. "whatsapp:+62812xxxx" (radar)

  // Branding
  BIZ_NAME = "Hongz Bengkel – Spesialis Transmisi Matic",
  BIZ_HOURS = "Senin–Sabtu 09.00–17.00",
  MAPS_LINK = "https://maps.app.goo.gl/CvFZ9FLNJRog7K4t9",
  WHATSAPP_ADMIN = "https://wa.me/6281375430728",
  WHATSAPP_CS = "https://wa.me/6285752965167",

  // Storage
  DATA_DIR = "./data",

  // OpenAI
  OPENAI_API_KEY,
  OPENAI_MODEL = "gpt-4o-mini",
  OPENAI_MAX_OUTPUT_TOKENS = "220",
  OPENAI_TEMPERATURE = "0.3",
  OPENAI_TIMEOUT_MS = "9000",

  // Controls
  RADAR_ENABLED = "true",
  ADMIN_NOTIFY_ENABLED = "true",
  ADMIN_NOTIFY_MIN_SCORE = "5",
  ADMIN_NOTIFY_COOLDOWN_SEC = "60",
  RADAR_COOLDOWN_SEC = "15",

  PORT = "3000",
  DEBUG = "false",
} = process.env;

const IS_DEBUG = String(DEBUG).toLowerCase() === "true";
const RADAR_ON = String(RADAR_ENABLED).toLowerCase() === "true";
const ADMIN_NOTIFY_ON = String(ADMIN_NOTIFY_ENABLED).toLowerCase() === "true";

const ADMIN_MIN_SCORE = Number(ADMIN_NOTIFY_MIN_SCORE || 5);
const ADMIN_CD_MS = Number(ADMIN_NOTIFY_COOLDOWN_SEC || 60) * 1000;
const RADAR_CD_MS = Number(RADAR_COOLDOWN_SEC || 15) * 1000;

const OAI_MAXTOK = Number(OPENAI_MAX_OUTPUT_TOKENS || 220);
const OAI_TEMP = Number(OPENAI_TEMPERATURE || 0.3);
const OAI_TIMEOUT = Number(OPENAI_TIMEOUT_MS || 9000);

// ================= APP =================
const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// ================= TWILIO CLIENT =================
const twilioClient = (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN)
  ? twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
  : null;

// ================= STORAGE =================
function ensureDir(dir) {
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
}
ensureDir(DATA_DIR);

const DB_FILE = path.join(DATA_DIR, "hongz_db.json");

function loadDBFile() {
  try {
    const raw = fs.readFileSync(DB_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object"
      ? parsed
      : { customers: {}, tickets: {}, events: [], meta: {} };
  } catch (_) {
    return { customers: {}, tickets: {}, events: [], meta: {} };
  }
}

function saveDBFile(db) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), "utf8");
  } catch (e) {
    console.error("DB save failed:", e?.message || e);
  }
}

function nowISO() { return new Date().toISOString(); }
function nowMs() { return Date.now(); }

function sha16(s) {
  return crypto.createHash("sha256").update(String(s)).digest("hex").slice(0, 16);
}

function dlog(...args) {
  if (IS_DEBUG) console.log("[DLOG]", ...args);
}

// ================= BASIC HELPERS =================
function normText(s) { return String(s || "").replace(/\u200b/g, "").trim(); }
function upper(s) { return normText(s).toUpperCase(); }

function cleanMsisdn(from) {
  return String(from || "").replace(/^whatsapp:\+?/i, "").replace(/[^\d]/g, "");
}
function toWaMe(from) {
  const n = cleanMsisdn(from);
  return n ? `https://wa.me/${n}` : "-";
}

function replyTwiML(res, message) {
  const twiml = new twilio.twiml.MessagingResponse();
  twiml.message(message || "Halo Bang 🙏");
  res.type("text/xml");
  return res.status(200).send(twiml.toString());
}

function isCommand(body, cmd) {
  const t = upper(body);
  const c = String(cmd || "").toUpperCase();
  return t === c || t.startsWith(c + " ") || t.includes("\n" + c) || t.includes(" " + c + " ");
}

function confidenceLine(style = "neutral") {
  if (style === "casual") return "✅ Tenang ya Bang, kita bantu sampai jelas langkahnya 🙂";
  return "✅ Tenang ya Bang, kami bantu sampai jelas langkahnya.";
}

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

function signatureTowing() {
  return [
    `— ${BIZ_NAME}`,
    `📲 Admin prioritas: ${WHATSAPP_ADMIN}`,
    `⚡ Darurat? Klik Admin untuk *voice call* (lebih cepat).`,
  ].join("\n");
}

// ================= DETECTORS =================
function detectStyle(body) {
  const raw = String(body || "");
  const t = raw.toLowerCase();
  if (/darurat|tolong|cepat|mogok|bahaya|stuck/i.test(t)) return "urgent";
  const hasEmoji = /[\u{1F300}-\u{1FAFF}]/u.test(raw);
  if (t.length < 20 || hasEmoji) return "casual";
  return "neutral";
}

function detectAC(body) {
  const t = String(body || "").toLowerCase();
  return /\bac\b|freon|kompresor|blower|evaporator|kondensor|tidak dingin|dingin sebentar|panas lagi|extra fan|kipas/i.test(t);
}
function detectNoStart(body) {
  const t = String(body || "").toLowerCase();
  return /tidak bisa hidup|gak bisa hidup|ga bisa hidup|tidak bisa starter|gak bisa starter|ga bisa starter|starter|aki|accu|lampu redup/i.test(t);
}
function detectCantDrive(body) {
  const t = String(body || "").toLowerCase();
  return /tidak bisa jalan|ga bisa jalan|gak bisa jalan|tidak bisa bergerak|stuck|macet total|rpm naik tapi tidak jalan|d masuk tapi tidak jalan|r masuk tapi tidak jalan|towing|evakuasi/i.test(t);
}
function detectPriceOnly(body) {
  const t = String(body || "").toLowerCase();
  return /berapa|biaya|harga|kisaran|range|murah|diskon|nego|budget|ongkos/i.test(t);
}
function detectBuyingSignal(body) {
  const t = String(body || "").toLowerCase();
  return /jadwal|booking|bisa masuk|hari ini|besok bisa|jam berapa|mau datang|fix datang|oke saya ke sana|alamat|lokasi|maps/i.test(t);
}
function hasVehicleInfo(body) {
  const t = String(body || "").toLowerCase();
  const hasYear = /\b(19\d{2}|20\d{2})\b/.test(t);
  const hasBrand = /toyota|honda|nissan|mitsubishi|suzuki|daihatsu|mazda|hyundai|kia|wuling|bmw|mercedes|audi|lexus/i.test(t);
  return hasYear || hasBrand;
}

// ================= LOCATION PARSER =================
function extractMapsLink(reqBody) {
  const body = String(reqBody?.Body ?? "").trim();
  if (!body) return null;
  const m = body.match(/(https?:\/\/(?:maps\.app\.goo\.gl|www\.google\.com\/maps|goo\.gl\/maps)[^\s]+)/i);
  if (!m) return null;
  return { type: "link", mapsUrl: m[1], raw: body };
}
function extractLocation(reqBody) {
  const lat = reqBody?.Latitude || reqBody?.latitude;
  const lng = reqBody?.Longitude || reqBody?.longitude;
  if (lat && lng) {
    return {
      type: "coords",
      lat: String(lat),
      lng: String(lng),
      mapsUrl: `https://www.google.com/maps?q=${encodeURIComponent(lat)},${encodeURIComponent(lng)}`
    };
  }
  const link = extractMapsLink(reqBody);
  if (link) return link;
  return null;
}

// ================= TICKET SYSTEM =================
function getOrCreateTicket(db, customerId, from) {
  if (!db.tickets) db.tickets = {};
  let ticket = Object.values(db.tickets).find(t => t.customerId === customerId && t.status !== "CLOSED");
  if (ticket) return ticket;

  const id = "T-" + Math.floor(10000 + Math.random() * 90000);
  ticket = {
    id,
    customerId,
    from,
    status: "OPEN",
    type: "GENERAL",     // GENERAL | AC | NO_START | TOWING | JADWAL
    stage: 0,            // stage flow (khusus AC)
    score: 0,
    createdAt: nowISO(),
    updatedAt: nowISO(),
    lastInboundAtMs: 0,
    lastBody: "",
    locationUrl: "",
  };
  db.tickets[id] = ticket;
  return ticket;
}

function updateTicket(ticket, patch) {
  Object.assign(ticket, patch || {});
  ticket.updatedAt = nowISO();
}

// ================= LEAD SCORE =================
function leadScore({ body, hasLoc, cantDrive, isJadwal, isTowing }) {
  let score = 0;
  if (cantDrive || isTowing || hasLoc) score += 5;
  if (isJadwal || detectBuyingSignal(body)) score += 4;
  if (detectPriceOnly(body) && String(body || "").length < 35) score -= 2;
  return Math.max(0, Math.min(10, score));
}

// ================= RADAR & ADMIN NOTIFY =================
function canSendCooldown(db, key, cooldownMs) {
  if (!db.meta) db.meta = {};
  if (!db.meta.cooldowns) db.meta.cooldowns = {};
  const last = Number(db.meta.cooldowns[key] || 0);
  const now = nowMs();
  if (now - last < cooldownMs) return false;
  db.meta.cooldowns[key] = now;
  return true;
}

async function safeSendWhatsApp(to, text) {
  if (!twilioClient) return false;
  if (!TWILIO_WHATSAPP_FROM) return false;
  if (!to) return false;

  try {
    await twilioClient.messages.create({
      from: TWILIO_WHATSAPP_FROM,
      to,
      body: String(text || "").slice(0, 1500),
    });
    return true;
  } catch (e) {
    console.error("Twilio send failed:", e?.message || e);
    return false;
  }
}

async function radarPing(db, payload) {
  if (!RADAR_ON) return;
  if (!MONITOR_WHATSAPP_TO) return;

  const key = `radar:${payload.ticketId}`;
  if (!canSendCooldown(db, key, RADAR_CD_MS)) return;

  const msg = [
    "📡 RADAR HONGZ",
    `Ticket: ${payload.ticketId}`,
    `From: ${payload.from}`,
    `wa.me: ${payload.waMe}`,
    `Type: ${payload.type} | Stage:${payload.stage} | Score:${payload.score}`,
    payload.locationUrl ? `📍 Lokasi: ${payload.locationUrl}` : "📍 Lokasi: -",
    `Msg: ${payload.snippet}`,
  ].join("\n");

  await safeSendWhatsApp(MONITOR_WHATSAPP_TO, msg);
}

async function adminNotify(db, payload) {
  if (!ADMIN_NOTIFY_ON) return;
  if (!ADMIN_WHATSAPP_TO) return;
  if (payload.score < ADMIN_MIN_SCORE) return;

  const key = `admin:${payload.ticketId}`;
  if (!canSendCooldown(db, key, ADMIN_CD_MS)) return;

  const msg = [
    "🧑‍💼 ADMIN ALERT — HONGZ",
    `Ticket: ${payload.ticketId}`,
    `Tag: ${payload.score >= 8 ? "🔴 PRIORITY" : payload.score >= 5 ? "🟡 POTENTIAL" : "🔵 NORMAL"}`,
    `From: ${payload.from}`,
    `wa.me: ${payload.waMe}`,
    `Type: ${payload.type} | Stage:${payload.stage} | Score:${payload.score}`,
    payload.locationUrl ? `📍 Lokasi: ${payload.locationUrl}` : "📍 Lokasi: -",
    `Msg: ${payload.snippet}`,
  ].join("\n");

  await safeSendWhatsApp(ADMIN_WHATSAPP_TO, msg);
}

// ================= OPENAI (SAFE) =================
function withTimeout(promise, ms, label = "TIMEOUT") {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(label)), ms)),
  ]);
}

function mustMapsOnly(aiText, userText) {
  const low = String(aiText || "").toLowerCase();
  const u = String(userText || "").toLowerCase();
  const userAskingLocation = /(alamat|lokasi|maps|map|di mana|dimana)/i.test(u);
  const looksLikeAddress = /(jl\.|jalan\s+\w|no\.|nomor\s+\d|kecamatan|kelurahan|kode pos)/i.test(low);

  if (userAskingLocation && looksLikeAddress) return `Untuk lokasi, silakan buka: ${MAPS_LINK}`;
  const aiClearlyInventing = /(jl\.|jalan\s+\w).*(no\.|nomor\s+\d)/i.test(low);
  if (aiClearlyInventing) return `Untuk lokasi, silakan buka: ${MAPS_LINK}`;
  return aiText;
}

// ✅ Natural opener randomizer (micro)
function naturalOpener(style = "neutral") {
  const elite = [
    "Baik Bang, saya pahami kondisinya.",
    "Oke Bang, saya mengerti gejalanya.",
    "Saya paham arah masalahnya Bang.",
    "Baik Bang, dari cerita abang saya sudah dapat gambaran awalnya."
  ];

  const casual = [
    "Oke Bang, saya lihat dulu ya arahnya.",
    "Siap Bang, saya sudah dapat bayangannya.",
    "Baik Bang, pelan-pelan kita cek arahnya."
  ];

  const formal = [
    "Baik Pak, saya pahami kondisinya.",
    "Saya mengerti gejala yang Bapak maksud."
  ];

  let pool = elite;
  if (style === "casual") pool = casual.concat(elite);
  if (style === "formal") pool = formal.concat(elite);

  return pool[Math.floor(Math.random() * pool.length)];
}

// helper kecil biar gak dobel opener kalau AI sudah buka dengan kalimat serupa
function startsLikeOpener(text) {
  const t = String(text || "").trim().toLowerCase();
  return /^(baik|oke|ok|siap)\s+(bang|pak)\b/.test(t) || /^saya\s+paham\b/.test(t);
}

async function aiReply(userText, context) {
  if (!OPENAI_API_KEY) return null;

  try {
    const client = new OpenAI({ apiKey: OPENAI_API_KEY });

    // style dari context kalau ada (urgent/formal/casual/neutral)
    const style = String(context?.style || "neutral");

    // 🧠 Natural Elite prompt (GPT yang atur, tapi kita kasih “bahasa” biar gak kelihatan sistem)
    const sys = [
      `Anda adalah Kepala Bengkel ${BIZ_NAME} di Medan.`,
      "Karakter: mekanik senior, manusiawi, hangat-profesional. Jangan terdengar seperti bot.",
      "Gaya jawaban: ringkas, tajam, relevan, tidak bertele-tele.",
      "",
      "ATURAN WAJIB:",
      "1) Jangan beri angka harga pasti.",
      `2) Jika user tanya lokasi/alamat → jawab hanya link maps: ${MAPS_LINK}`,
      "3) Maksimal 2 pertanyaan dalam 1 balasan.",
      `4) Jika darurat/tidak bisa jalan → sarankan jangan dipaksakan + minta share lokasi + arahkan voice call admin (${WHATSAPP_ADMIN}).`,
      "5) Hindari kata yang terasa sistem/robotik seperti: 'saya tangkap', 'input diterima', 'ticket', 'stage'.",
      "6) Jika lawan bicara ragu/sekadar tanya-tanya (3T/3M), jawab halus tapi tetap memandu ke info minimum (mobil+tahun+gejala).",
      context?.laneRule ? `7) ${context.laneRule}` : "",
    ].filter(Boolean).join("\n");

    const resp = await withTimeout(
      client.chat.completions.create({
        model: OPENAI_MODEL,
        temperature: OAI_TEMP,
        max_tokens: OAI_MAXTOK,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: String(userText || "") },
        ],
      }),
      OAI_TIMEOUT,
      "OPENAI_TIMEOUT"
    );

    let text = resp?.choices?.[0]?.message?.content?.trim();
    if (!text) return null;

    text = mustMapsOnly(text, userText);

    // ✅ Tambah opener micro (tanpa kelihatan sistem), tapi jangan dobel
    if (!startsLikeOpener(text)) {
      const opener = naturalOpener(style);
      text = `${opener}\n\n${text}`;
    }

    if (text.length > 900) text = text.slice(0, 900).trim() + "…";
    return text;
  } catch (e) {
    console.error("OpenAI failed:", e?.message || e);
    return null;
  }
}

// ================= NATURAL ELITE — STEP 2 HELPERS =================
function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

function detectSoftLowIntent(body) {
  // 3T/3M versi halus (tanpa frontal)
  const t = String(body || "").toLowerCase();

  const manyAsksFewFacts =
    (t.match(/\?/g) || []).length >= 2 && !hasVehicleInfo(body);

  const priceProbe =
    /berapa|biaya|harga|kisaran|range|murah|diskon|nego|budget|ongkos/i.test(t) &&
    String(body || "").trim().length < 45;

  const timeWasterVibes =
    /cuma tanya|sekedar tanya|iseng|penasaran|nanya doang|lihat-lihat|compare|banding/i.test(t);

  const wantCheapFastPerfect =
    /murah|termurah|diskon besar|paling murah|langsung beres|cepat banget|garansi paling lama|tanpa bongkar/i.test(t);

  return !!(manyAsksFewFacts || priceProbe || timeWasterVibes || wantCheapFastPerfect);
}

function authorityLevel({ score, isUrgent, hasLoc, hasVehicle, buyingSignal }) {
  // makin serius → makin tegas (tanpa terlihat sistem)
  let lvl = 1;
  if (hasVehicle) lvl++;
  if (buyingSignal) lvl++;
  if (score >= 5) lvl++;
  if (isUrgent || hasLoc) lvl += 2;
  return clamp(lvl, 1, 5);
}

function softClose({ lvl, lane, style }) {
  // closing psikologi halus (tanpa kata "closing")
  // lvl 1-5
  const isCasual = style === "casual";
  const isFormal = style === "formal";

  if (lvl >= 4) {
    return isFormal
      ? "Kalau Bapak berkenan, kirim hari & jam rencana datang. Biar kami siapkan slot cek cepat."
      : "Kalau mau cepat beres, kirim hari & jam datang ya Bang. Biar admin siapin slot cek singkat.";
  }

  if (lvl === 3) {
    if (lane === "AC") return isCasual
      ? "Biar gak muter-muter, kalau sempat masuk bentar kita cek 15–30 menit ya Bang."
      : "Biar tidak muter-muter, saran saya cek singkat 15–30 menit ya Bang.";
    return isFormal
      ? "Supaya arahnya tepat, lebih aman kita cek singkat di bengkel terlebih dulu."
      : "Supaya arahnya tepat, paling aman kita cek singkat dulu ya Bang.";
  }

  // lvl 1-2: minta info minimum dulu, tetap hangat
  return isFormal
    ? "Boleh info mobil & tahunnya dulu, lalu keluhan yang paling terasa?"
    : "Boleh info mobil & tahun dulu ya Bang, sama keluhan yang paling terasa?";
}


// ================= MAIN WEBHOOK =================
async function webhookHandler(req, res) {
  const db = loadDBFile();
  if (!db.customers) db.customers = {};
  if (!db.tickets) db.tickets = {};
  if (!Array.isArray(db.events)) db.events = [];
  if (!db.meta) db.meta = { cooldowns: {} };

  const from = normText(req.body?.From || "");
  const to = normText(req.body?.To || "");
  const body = normText(req.body?.Body || "");

  if (body.length > 900) {
    saveDBFile(db);
    return replyTwiML(res, "Pesan terlalu panjang Bang 🙏 Mohon kirim ringkas ya.");
  }
  if (!body) {
    saveDBFile(db);
    return replyTwiML(res, "Silakan tulis keluhan mobilnya ya Bang 🙏");
  }

  const style = detectStyle(body);
  const location = extractLocation(req.body || {});
  const hasLoc = !!location;
  const customerId = sha16(from || "unknown");

  // ensure customer
  if (!db.customers[customerId]) {
    db.customers[customerId] = {
      from,
      firstSeen: nowISO(),
      lastSeen: nowISO(),
      phone: cleanMsisdn(from),
    };
  } else {
    db.customers[customerId].lastSeen = nowISO();
  }

  // ticket
  const ticket = getOrCreateTicket(db, customerId, from);
  if (location?.mapsUrl) ticket.locationUrl = location.mapsUrl;

  // detections
  const cmdTowing = isCommand(body, "TOWING");
  const cmdJadwal = isCommand(body, "JADWAL");
  const acMode = detectAC(body);
  const noStart = detectNoStart(body);
  const cantDrive = detectCantDrive(body);
  const priceOnly = detectPriceOnly(body);
  const buying = detectBuyingSignal(body);

  // type sticky
  if (cmdTowing || cantDrive || hasLoc) ticket.type = "TOWING";
  else if (cmdJadwal || buying) ticket.type = "JADWAL";
  else if (acMode) ticket.type = "AC";
  else if (noStart) ticket.type = "NO_START";
  else ticket.type = ticket.type || "GENERAL";

  const score = leadScore({
    body,
    hasLoc,
    cantDrive,
    isJadwal: (ticket.type === "JADWAL"),
    isTowing: (ticket.type === "TOWING"),
  });

  updateTicket(ticket, {
    score,
    lastBody: body,
    lastInboundAtMs: nowMs(),
  });

  const waMe = toWaMe(from);
  const snippet = body.replace(/\s+/g, " ").slice(0, 80);

  // events
  db.events.push({
    t: nowISO(),
    from,
    to,
    body,
    ticketId: ticket.id,
    type: ticket.type,
    stage: ticket.stage,
    score,
    locationUrl: ticket.locationUrl || "",
  });
  if (db.events.length > 4000) db.events = db.events.slice(-2000);

  // radar + admin notify (non-blocking but awaited safely)
  await radarPing(db, {
    ticketId: ticket.id,
    from,
    waMe,
    type: ticket.type,
    stage: ticket.stage,
    score,
    locationUrl: ticket.locationUrl || "",
    snippet,
  });
  await adminNotify(db, {
    ticketId: ticket.id,
    from,
    waMe,
    type: ticket.type,
    stage: ticket.stage,
    score,
    locationUrl: ticket.locationUrl || "",
    snippet,
  });

  // ================= RULES PRIORITY (ONE BIG BLOCK) =================

  // 1) Lokasi diminta -> jawaban maps saja
  if (/alamat|lokasi|maps|map|di mana|dimana/i.test(body)) {
    saveDBFile(db);
    return replyTwiML(res, `Untuk lokasi, silakan buka: ${MAPS_LINK}`);
  }

  // 2) Lokasi diterima (coords/maps link)
  if (hasLoc) {
    ticket.type = "TOWING";
    saveDBFile(db);
    return replyTwiML(
      res,
      [
        "Baik Bang, lokasi sudah kami terima ✅",
        "Admin akan follow up untuk langkah berikutnya (termasuk evakuasi/towing bila diperlukan).",
        "",
        confidenceLine(style),
        "",
        signatureTowing(),
      ].join("\n")
    );
  }

  // 3) Towing / tidak bisa jalan (urgent)
  if (ticket.type === "TOWING") {
    saveDBFile(db);
    return replyTwiML(
      res,
      [
        "Baik Bang.",
        "Kalau unit sudah *tidak bisa jalan/bergerak*, jangan dipaksakan dulu — bisa memperparah kerusakan.",
        "",
        "Silakan kirim *share lokasi sekarang*.",
        `⚡ Untuk respons tercepat, langsung *voice call Admin*: ${WHATSAPP_ADMIN}`,
        "",
        confidenceLine(style),
        "",
        signatureTowing(),
      ].join("\n")
    );
  }

  // 4) JADWAL / booking
  if (ticket.type === "JADWAL") {
    saveDBFile(db);
    return replyTwiML(
      res,
      [
        "Siap Bang ✅ Untuk booking, kirim data singkat ya:",
        "1) Nama",
        "2) Mobil & tahun",
        "3) Keluhan utama (singkat)",
        "4) Mau datang hari & jam berapa",
        "",
        `⚡ Butuh cepat? Voice call Admin: ${WHATSAPP_ADMIN}`,
        "",
        confidenceLine(style),
        "",
        signatureShort(),
      ].join("\n")
    );
  }

  // 5) AC FLOW (STEP 1–2–3) — stabil & tidak muter
  if (ticket.type === "AC") {
    const t = String(body || "").toLowerCase();

    // STEP 1
    if (Number(ticket.stage || 0) < 1) {
      ticket.stage = 1;
      saveDBFile(db);
      return replyTwiML(
        res,
        [
          "Siap Bang, saya fokus *AC* dulu ya (bukan matic).",
          "",
          "1) AC-nya *tidak dingin sama sekali* atau *dingin sebentar lalu panas*?",
          "2) Blower angin *kencang* atau *lemah*?",
          "",
          "Biar cepat: kirim *tipe mobil + tahun*.",
          "",
          confidenceLine(style),
          "",
          signatureShort(),
        ].join("\n")
      );
    }

    // STEP 2
    const hasBasicACInfo =
      hasVehicleInfo(body) ||
      /\b(19\d{2}|20\d{2})\b/.test(t) ||
      /tidak dingin|dingin sebentar|panas|blower|kompresor|freon|extra fan|kipas|servis|service|kasar/i.test(t);

    if (Number(ticket.stage || 0) === 1 && hasBasicACInfo) {
      ticket.stage = 2;
      saveDBFile(db);
      return replyTwiML(
        res,
        [
          "Baik Bang, saya tangkap ya.",
          "Gejala *dingin sebentar lalu panas + kompresor kasar* paling sering terkait:",
          "• tekanan freon drop / ada kebocoran ringan",
          "• extra fan lemah (kondensor panas)",
          "• kompresor mulai berat / magnetic clutch bermasalah",
          "",
          "Biar tidak merembet, paling aman kita cek langsung (singkat) di bengkel.",
          "",
          "Ketik *JADWAL* untuk booking ya Bang.",
          "",
          confidenceLine(style),
          "",
          signatureShort(),
        ].join("\n")
      );
    }

    // STEP 3
    if (Number(ticket.stage || 0) >= 2) {
      saveDBFile(db);
      return replyTwiML(
        res,
        [
          "Siap Bang ✅",
          "Kalau mau langsung beres tanpa coba-coba, kirim *hari & jam datang* ya.",
          "Admin siapkan slot.",
          "",
          confidenceLine(style),
          "",
          signatureShort(),
        ].join("\n")
      );
    }
  }

  // 6) NO START
  if (ticket.type === "NO_START") {
    saveDBFile(db);
    return replyTwiML(
      res,
      [
        "Tenang Bang, kita cek cepat ya.",
        "Saat distarter: *cekrek/lemot* atau *muter normal tapi tidak nyala*?",
        "Lampu dashboard: *terang* atau *redup/mati*?",
        "",
        "Biar cepat: kirim video saat distarter + tipe mobil & tahun.",
        "",
        confidenceLine(style),
        "",
        signatureShort(),
      ].join("\n")
    );
  }


  // 7) DEFAULT: AI / fallback — NATURAL ELITE v2

  const hasVehicle = hasVehicleInfo(body);
  const lowIntent = detectSoftLowIntent(body);
  const isUrgent = (ticket.type === "TOWING") || cantDrive || hasLoc;
  const lane = String(ticket.type || "GENERAL");

  const lvl = authorityLevel({
    score: Number(ticket.score || score || 0),
    isUrgent,
    hasLoc: !!hasLoc,
    hasVehicle,
    buyingSignal: !!buying,
  });

  // ===== Micro smalltalk (tidak muncul kalau urgent) =====
  function microSmalltalk(style) {
    if (isUrgent) return "";

    const warm = [
      "Semoga mobilnya masih aman ya Bang.",
      "Tenang dulu ya Bang, kita pelan-pelan arahkan.",
      "Yang penting kita pastikan dulu langkah paling aman."
    ];

    const pro = [
      "Baik, kita pastikan arahnya tepat dulu.",
      "Supaya tidak salah langkah, kita cek arahnya dulu.",
    ];

    const senior = [
      "Kasus seperti ini sering terjadi, tapi masih bisa kita arahkan.",
      "Biasanya ada pola tertentu, nanti kita cocokkan dulu."
    ];

    let pool = pro;
    if (style === "warm") pool = warm.concat(pro);
    if (style === "senior") pool = senior.concat(pro);

    return pool[Math.floor(Math.random() * pool.length)];
  }

  const smalltalk = microSmalltalk(style);

  const laneRule =
    priceOnly
      ? "Jika user hanya tanya harga tanpa info → minta mobil+tahun+gejala singkat, lalu arahkan ke diagnosa singkat."
      : lowIntent
        ? "Jika user masih lihat-lihat atau banyak tanya tanpa info → jawab hangat tapi arahkan minta mobil+tahun+gejala."
        : "";

  const aiCore = await aiReply(body, {
    laneRule,
    style
  });

  const closeLine = softClose({ lvl, lane, style });

  // ===== Jika AI berhasil =====
  if (aiCore) {

    const out = [
      smalltalk ? smalltalk : "",
      aiCore,
      "",
      closeLine,
      "",
      confidenceLine(style),
      "",
      signatureShort(),
    ].filter(Boolean).join("\n");

    saveDBFile(db);
    return replyTwiML(res, out);
  }

  // ===== Fallback (kalau AI gagal) =====
  const fallback = [
    smalltalk ? smalltalk : "",
    "Saya bantu arahkan dulu ya.",
    hasVehicle
      ? (style === "pro"
          ? "Keluhan yang paling terasa apa ya Pak?"
          : "Keluhan yang paling terasa apa ya Bang?")
      : (style === "pro"
          ? "Boleh info mobil & tahunnya dulu ya Pak?"
          : "Boleh info mobil & tahun dulu ya Bang?"),
    "",
    closeLine,
    "",
    confidenceLine(style),
    "",
    signatureShort(),
  ].filter(Boolean).join("\n");

  saveDBFile(db);
  return replyTwiML(res, fallback);}


// ================= ROUTES =================
app.post("/twilio/webhook", async (req, res) => {
  try {
    console.log("[TWILIO HIT] /twilio/webhook", {
      from: req.body?.From,
      body: req.body?.Body,
      ct: req.headers["content-type"],
    });
    return await webhookHandler(req, res);
  } catch (e) {
    console.error("webhook error:", e?.message || e);
    return replyTwiML(res, "Maaf Bang, sistem lagi padat 🙏 Silakan ulangi sebentar lagi.");
  }
});

app.get("/", (_req, res) => {
  const ok = [
    "HONGZ AI SERVER v2.1 — OK",
    `TwilioClient: ${twilioClient ? "READY" : "MISSING_SID_OR_TOKEN"}`,
    `TWILIO_WHATSAPP_FROM: ${TWILIO_WHATSAPP_FROM ? "SET" : "NOT_SET"}`,
    `ADMIN_WHATSAPP_TO: ${ADMIN_WHATSAPP_TO ? "SET" : "NOT_SET"}`,
    `MONITOR_WHATSAPP_TO: ${MONITOR_WHATSAPP_TO ? "SET" : "NOT_SET"}`,
    `OpenAI: ${OPENAI_API_KEY ? "SET" : "NOT_SET"}`,
    `DB: ${DB_FILE}`,
  ].join("\n");
  return res.status(200).send(ok);
});

// ================= START =================
app.listen(Number(PORT || 3000), () => {
  console.log("HONGZ AI SERVER v2.1 — START");
  console.log("PORT:", PORT);
  console.log("POST /twilio/webhook");
});