/**
 * HONGZ AI SERVER — LEVEL 2 (AUTO TICKET + WORKER) — ONE FILE
 * A) Dual webhook routes: /twilio/webhook AND /whatsapp/incoming
 * B) Admin gets: customer number + wa.me link + location link + ticket id + tags
 * C) Anti-hallucination address: AI forbidden to invent address; only MAPS_LINK allowed
 * D) Level 2: Auto-ticket + worker follow-ups + admin commands (LIST/CLAIM/CLOSE/NOTE)
 */

const express = require("express");
const bodyParser = require("body-parser");
const twilio = require("twilio");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// OpenAI optional
let OpenAI;
try { OpenAI = require("openai"); } catch (_) { OpenAI = null; }

// -------------------- ENV --------------------
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

  DATA_DIR = "/var/data",
  DEBUG = "false",

  // Level 2
  WORKER_ENABLED = "true",
  WORKER_INTERVAL_SEC = "30",
  TOWING_REMIND_MIN = "5",
  JADWAL_REMIND_MIN = "10",
  MAX_AUTO_REMIND = "3",
  ADMIN_COMMANDS_ENABLED = "true",
} = process.env;

const IS_DEBUG = String(DEBUG).toLowerCase() === "true";
function dlog(...args) { if (IS_DEBUG) console.log("[HONGZ]", ...args); }

if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_WHATSAPP_FROM || !ADMIN_WHATSAPP_TO) {
  console.error("Missing required ENV: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM, ADMIN_WHATSAPP_TO");
}

const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

// -------------------- APP --------------------
const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// -------------------- STORAGE --------------------
function ensureDir(dir) { try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {} }
ensureDir(DATA_DIR);

const DB_FILE = path.join(DATA_DIR, "hongz_db.json");

function loadDB() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, "utf8")); }
  catch (_) { return { customers: {}, events: [], tickets: {} }; }
}
function saveDB(db) {
  try { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), "utf8"); }
  catch (e) { console.error("DB save failed:", e.message); }
}
function nowISO() { return new Date().toISOString(); }
function ms(iso) { try { return new Date(iso).getTime(); } catch { return 0; } }

function hashPhone(phone) {
  return crypto.createHash("sha256").update(String(phone)).digest("hex").slice(0, 16);
}
function newTicketId(prefix = "T") {
  // Example: T-240217-193012-AB12
  const d = new Date();
  const y = String(d.getFullYear()).slice(2);
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const rand = crypto.randomBytes(2).toString("hex").toUpperCase();
  return `${prefix}-${y}${mo}${da}-${hh}${mm}${ss}-${rand}`;
}

// -------------------- HELPERS --------------------
function escapeXml(unsafe) {
  return String(unsafe)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
function normText(s) {
  return String(s || "").replace(/\u200b/g, "").trim();
}
function isCommand(body, cmd) {
  const t = normText(body).toUpperCase();
  const c = String(cmd).toUpperCase();
  return t === c || t.startsWith(c + " ") || t.includes("\n" + c) || t.includes(" " + c + " ");
}
function cleanMsisdn(from) {
  return String(from || "").replace("whatsapp:+", "").replace(/[^\d]/g, "");
}
function toWaMe(from) {
  const n = cleanMsisdn(from);
  return n ? `https://wa.me/${n}` : "-";
}
async function sendWhatsApp(to, text) {
  await twilioClient.messages.create({
    from: TWILIO_WHATSAPP_FROM,
    to,
    body: text,
  });
}
function isAdmin(from) {
  // ADMIN_WHATSAPP_TO is like "whatsapp:+62813..."
  return String(from || "").trim() === String(ADMIN_WHATSAPP_TO || "").trim();
}

// -------------------- LOCATION PARSER --------------------
function extractLocation(reqBody) {
  const lat = reqBody.Latitude || reqBody.latitude;
  const lng = reqBody.Longitude || reqBody.longitude;
  const label = reqBody.Label || reqBody.label;
  const address = reqBody.Address || reqBody.address;

  if (lat && lng) {
    return {
      type: "coords",
      lat: String(lat),
      lng: String(lng),
      label: label ? String(label) : "",
      address: address ? String(address) : "",
      mapsUrl: `https://www.google.com/maps?q=${encodeURIComponent(lat)},${encodeURIComponent(lng)}`
    };
  }

  const body = String(reqBody.Body || "").trim();
  const mapsLinkMatch = body.match(/https?:\/\/(maps\.app\.goo\.gl|www\.google\.com\/maps|goo\.gl\/maps)[^\s]+/i);
  if (mapsLinkMatch) {
    return { type: "link", mapsUrl: mapsLinkMatch[0], raw: body };
  }
  return null;
}

// -------------------- BRANDING --------------------
function businessSignature() {
  return [
    `📍 ${BIZ_NAME}`,
    `${BIZ_ADDRESS}`,
    `🧭 ${MAPS_LINK}`,
    `⏱ ${BIZ_HOURS}`,
    ``,
    `📲 WhatsApp Admin:`,
    `${WHATSAPP_ADMIN}`,
    ``,
    `💬 WhatsApp CS:`,
    `${WHATSAPP_CS}`,
    ``,
    `Ketik:`,
    `*JADWAL* untuk booking pemeriksaan`,
    `*TOWING* bila unit tidak bisa berjalan`,
  ].join("\n");
}
function confidenceLine() {
  return `✅ Tenang ya, kami bantu sampai jelas langkahnya.`;
}

// -------------------- ENTERPRISE TEMPLATES --------------------
function towingAskLocation() {
  return [
    `🚨 *PRIORITY TOWING – HONGZ*`,
    ``,
    `Siap Pak/Bu, kami bantu atur towing secepatnya.`,
    `Mohon kirim *share lokasi posisi mobil sekarang* agar tim bisa cek jarak & estimasi waktu tempuh real-time.`,
    ``,
    `Jika unit tidak aman dijalankan / tidak bisa bergerak, sebaiknya jangan dipaksakan.`,
    `Setelah lokasi kami terima, admin langsung follow up dan konfirmasi estimasi.`,
    confidenceLine(),
    ``,
    businessSignature(),
  ].join("\n");
}

function towingEta15() {
  return [
    `Kami usahakan secepatnya Pak/Bu.`,
    `Untuk estimasi yang akurat (mis. 15 menit), mohon kirim *share lokasi* agar kami cek jarak & kondisi lalu lintas saat ini.`,
    ``,
    `Setelah lokasi masuk, admin langsung konfirmasi estimasi waktu tempuh.`,
    `🚨 Penanganan towing kami prioritaskan.`,
    confidenceLine(),
    ``,
    businessSignature(),
  ].join("\n");
}

function towingLocationReceived(locUrl) {
  return [
    `📍 Lokasi sudah kami terima ✅`,
    `Tim sedang cek jarak & kondisi lalu lintas.`,
    `Admin akan segera follow up untuk konfirmasi estimasi towing.`,
    ``,
    locUrl ? `🔗 Link lokasi: ${locUrl}` : ``,
    confidenceLine(),
    ``,
    businessSignature(),
  ].filter(Boolean).join("\n");
}

function towingReminder() {
  return [
    `Mohon bantu kirim *share lokasi posisi mobil sekarang* agar tim bisa segera bergerak.`,
    `Tanpa lokasi, kami belum bisa menghitung estimasi waktu tempuh.`,
    `🚨 Semakin cepat lokasi dikirim, semakin cepat tim berangkat.`,
    confidenceLine(),
  ].join("\n");
}

function jadwalPrompt() {
  return [
    `Siap, untuk *booking pemeriksaan*, mohon kirim data singkat:`,
    `1) Nama`,
    `2) Mobil & tahun`,
    `3) Keluhan utama (contoh: "rpm tinggi", "jedug pindah gigi", "selip")`,
    `4) Rencana datang (hari & jam)`,
    ``,
    confidenceLine(),
    ``,
    businessSignature(),
  ].join("\n");
}

function jadwalReminder() {
  return [
    `Boleh dibantu ya Pak/Bu, untuk booking mohon kirim format:`,
    `Nama / Mobil & tahun / Keluhan / Hari & jam rencana datang.`,
    confidenceLine(),
  ].join("\n");
}

// -------------------- DETECTION --------------------
function detectPriority(body) {
  const t = String(body || "").toLowerCase();
  const towingSignals = [
    "towing", "tow", "derek", "evakuasi", "mogok", "tidak bisa jalan", "gak bisa jalan",
    "ga bisa jalan", "rpm naik tapi tidak jalan", "masuk d tapi tidak jalan", "masuk r tapi tidak jalan",
    "selip parah", "macet total", "darurat", "berisiko", "banjir", "asap", "bau gosong"
  ];
  return towingSignals.some(k => t.includes(k));
}
function detectEtaQuestion(body) {
  const t = String(body || "").toLowerCase();
  return /\b(\d{1,3})\s*(menit|mnt)\b/.test(t) || t.includes("estimasi") || t.includes("bisa sampai") || t.includes("bisa cepat");
}
function asksAddress(body) {
  return /alamat|lokasi|maps|map|di mana|dimana/i.test(String(body || ""));
}

// -------------------- TICKETS --------------------
function ensureTickets(db) {
  if (!db.tickets) db.tickets = {};
}
function createOrGetOpenTicket(db, kind, from, initialMsg) {
  ensureTickets(db);

  // find open ticket for this customer+kind
  const existing = Object.values(db.tickets).find(t =>
    t.kind === kind && t.customerFrom === from && (t.status === "OPEN" || t.status === "PENDING")
  );
  if (existing) return existing;

  const id = newTicketId(kind === "TOWING" ? "T" : "J");
  const ticket = {
    id,
    kind, // "TOWING" | "JADWAL"
    status: "OPEN", // OPEN -> PENDING -> CLAIMED -> CLOSED
    customerFrom: from,
    customerWa: toWaMe(from),
    createdAt: nowISO(),
    updatedAt: nowISO(),
    claimedBy: null,
    locationUrl: null,
    lastCustomerMsg: initialMsg || "",
    remindCount: 0,
    notes: [],
  };
  db.tickets[id] = ticket;
  return ticket;
}
function updateTicket(db, id, patch = {}) {
  ensureTickets(db);
  const t = db.tickets[id];
  if (!t) return null;
  Object.assign(t, patch);
  t.updatedAt = nowISO();
  return t;
}
function listRecentTickets(db, limit = 8) {
  ensureTickets(db);
  return Object.values(db.tickets)
    .sort((a, b) => ms(b.updatedAt) - ms(a.updatedAt))
    .slice(0, limit);
}

// -------------------- ADMIN NOTIFY --------------------
async function notifyAdmin({ title, ticket, from, body, locationUrl, tags = [] }) {
  const customerLink = toWaMe(from);
  const tid = ticket?.id ? `Ticket: ${ticket.id}` : null;
  const kind = ticket?.kind ? `Type: ${ticket.kind}` : null;
  const status = ticket?.status ? `Status: ${ticket.status}` : null;

  const msg = [
    title,
    tid,
    kind,
    status,
    `Customer: ${from}`,
    `Chat customer: ${customerLink}`,
    tags.length ? `Tags: ${tags.join(", ")}` : null,
    locationUrl ? `Lokasi: ${locationUrl}` : `Lokasi: (belum ada)`,
    body ? `Pesan: ${body}` : null,
    ``,
    `Commands: LIST | CLAIM ${ticket?.id || ""} | CLOSE ${ticket?.id || ""} | NOTE ${ticket?.id || ""} ...`,
  ].filter(Boolean).join("\n");

  try {
    await sendWhatsApp(ADMIN_WHATSAPP_TO, msg);
  } catch (e) {
    console.error("Admin notify failed:", e.message);
  }
}

// -------------------- AI REPLY (OPTIONAL) --------------------
async function aiReply(userText) {
  if (!OPENAI_API_KEY || !OpenAI) return null;

  const client = new OpenAI({ apiKey: OPENAI_API_KEY });
  const timeoutMs = Number(OPENAI_TIMEOUT_MS) || 9000;

  const system = `
Anda adalah Customer Service bengkel transmisi matic: ${BIZ_NAME} (Medan).
Bahasa: Indonesia sopan, ringkas, membantu.

ATURAN KERAS:
- DILARANG membuat/mengarang alamat apa pun (jangan menulis "Jl", "Jalan", "No", "Nomor", atau alamat selain yang diberikan sistem).
- Jika pelanggan tanya alamat/lokasi: jawab hanya dengan link ini: ${MAPS_LINK}
- Jika pelanggan menyebut mobil tidak bisa jalan / mogok / rpm naik tapi tidak jalan / berisiko: arahkan TOWING (jangan dipaksakan).
- Maksimal 2 pertanyaan.
- Jangan menyebut token / internal / sistem.
`.trim();

  try {
    const resp = await Promise.race([
      client.chat.completions.create({
        model: OPENAI_MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: userText },
        ],
        temperature: 0.35,
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("OPENAI_TIMEOUT")), timeoutMs)),
    ]);

    const text = resp?.choices?.[0]?.message?.content?.trim();
    if (!text) return null;

    const low = text.toLowerCase();
    if (low.includes("jl") || low.includes("jalan") || low.includes("no.") || low.includes("nomor") || low.includes("alamat")) {
      return `Untuk lokasi, silakan buka: ${MAPS_LINK}`;
    }
    return text;
  } catch (e) {
    console.error("OpenAI failed:", e.message);
    return null;
  }
}

// -------------------- ADMIN COMMAND HANDLER --------------------
async function handleAdminCommand(body) {
  const cmd = normText(body);
  const up = cmd.toUpperCase();
  const db = loadDB();

  if (up === "LIST") {
    const items = listRecentTickets(db, 8);
    if (!items.length) return "Tidak ada ticket.";
    const lines = items.map(t =>
      `• ${t.id} | ${t.kind} | ${t.status} | remind:${t.remindCount} | ${t.customerFrom.replace("whatsapp:+","+")}`
    );
    return `📌 Ticket terbaru:\n${lines.join("\n")}`;
  }

  if (up.startsWith("CLAIM ")) {
    const id = cmd.split(/\s+/)[1];
    const t = updateTicket(db, id, { status: "CLAIMED", claimedBy: "ADMIN" });
    saveDB(db);
    return t ? `✅ Ticket ${id} sudah di-CLAIM.` : `❌ Ticket ${id} tidak ditemukan.`;
  }

  if (up.startsWith("CLOSE ")) {
    const id = cmd.split(/\s+/)[1];
    const t = updateTicket(db, id, { status: "CLOSED" });
    saveDB(db);
    return t ? `✅ Ticket ${id} sudah CLOSED.` : `❌ Ticket ${id} tidak ditemukan.`;
  }

  if (up.startsWith("NOTE ")) {
    const parts = cmd.split(/\s+/);
    const id = parts[1];
    const note = cmd.slice(cmd.indexOf(id) + id.length).trim();
    const t = db.tickets?.[id];
    if (!t) return `❌ Ticket ${id} tidak ditemukan.`;
    t.notes = t.notes || [];
    t.notes.push({ at: nowISO(), text: note || "(empty)" });
    t.updatedAt = nowISO();
    saveDB(db);
    return `📝 Note masuk ke ticket ${id}.`;
  }

  return `Perintah tidak dikenal. Gunakan: LIST | CLAIM <ID> | CLOSE <ID> | NOTE <ID> <pesan>`;
}

// -------------------- MAIN WEBHOOK HANDLER --------------------
async function webhookHandler(req, res) {
  const db = loadDB();
  ensureTickets(db);

  const from = req.body.From || "";
  const to = req.body.To || "";
  const body = normText(req.body.Body || "");
  const location = extractLocation(req.body);
  const locationUrl = location?.mapsUrl || null;

  dlog("Incoming", { from, to, body, hasLocation: !!location });

  // Admin commands (only from ADMIN number)
  if (String(ADMIN_COMMANDS_ENABLED).toLowerCase() === "true" && isAdmin(from)) {
    // Admin might receive forwards from customer too; only treat as command if starts with LIST/CLAIM/CLOSE/NOTE
    const up = body.toUpperCase();
    if (up === "LIST" || up.startsWith("CLAIM ") || up.startsWith("CLOSE ") || up.startsWith("NOTE ")) {
      const out = await handleAdminCommand(body);
      res.type("text/xml");
      return res.send(`<Response><Message>${escapeXml(out)}</Message></Response>`);
    }
  }

  // customers table
  const customerId = hashPhone(from);
  if (!db.customers[customerId]) {
    db.customers[customerId] = {
      from,
      firstSeen: nowISO(),
      lastSeen: nowISO(),
      lastKind: null,
      lastTicketId: null,
    };
  } else {
    db.customers[customerId].lastSeen = nowISO();
  }

  // Log event
  db.events.push({ t: nowISO(), from, to, body, hasLocation: !!location, location });
  if (db.events.length > 5000) db.events = db.events.slice(-2000);

  const cmdTowing = isCommand(body, "TOWING");
  const cmdJadwal = isCommand(body, "JADWAL");

  const priority = detectPriority(body) || cmdTowing || !!location;
  const etaQ = detectEtaQuestion(body);
  const askAddr = asksAddress(body);

  // -------------------- 1) LOCATION RECEIVED --------------------
  if (location) {
    const ticket = createOrGetOpenTicket(db, "TOWING", from, body);
    updateTicket(db, ticket.id, { status: "PENDING", locationUrl, lastCustomerMsg: body });

    db.customers[customerId].lastKind = "TOWING";
    db.customers[customerId].lastTicketId = ticket.id;
    saveDB(db);

    await notifyAdmin({
      title: `✅ *LOCATION RECEIVED*`,
      ticket,
      from,
      body,
      locationUrl,
      tags: ["LOCATION", "PRIORITY_TOWING"],
    });

    const reply = towingLocationReceived(locationUrl);
    res.type("text/xml");
    return res.send(`<Response><Message>${escapeXml(reply)}</Message></Response>`);
  }

  // -------------------- 2) PRIORITY TOWING WITHOUT LOCATION --------------------
  if (priority) {
    const ticket = createOrGetOpenTicket(db, "TOWING", from, body);
    updateTicket(db, ticket.id, {
      status: "PENDING",
      lastCustomerMsg: body,
      // location still null
    });

    db.customers[customerId].lastKind = "TOWING";
    db.customers[customerId].lastTicketId = ticket.id;
    saveDB(db);

    await notifyAdmin({
      title: `🚨 *PRIORITY TOWING (AUTO)*`,
      ticket,
      from,
      body,
      locationUrl: null,
      tags: ["PRIORITY_TOWING", "NEED_LOCATION"],
    });

    const reply = etaQ ? towingEta15() : towingAskLocation();
    res.type("text/xml");
    return res.send(`<Response><Message>${escapeXml(reply)}</Message></Response>`);
  }

  // -------------------- 3) JADWAL FLOW + ticket + admin notif --------------------
  if (cmdJadwal) {
    const ticket = createOrGetOpenTicket(db, "JADWAL", from, body);
    updateTicket(db, ticket.id, { status: "PENDING", lastCustomerMsg: body });

    db.customers[customerId].lastKind = "JADWAL";
    db.customers[customerId].lastTicketId = ticket.id;
    saveDB(db);

    await notifyAdmin({
      title: `📅 *BOOKING REQUEST (JADWAL)*`,
      ticket,
      from,
      body,
      locationUrl: null,
      tags: ["JADWAL", "BOOKING"],
    });

    const reply = jadwalPrompt();
    res.type("text/xml");
    return res.send(`<Response><Message>${escapeXml(reply)}</Message></Response>`);
  }

  // -------------------- 4) DEFAULT --------------------
  // If customer previously had open ticket, update last msg for context
  const lastTid = db.customers[customerId]?.lastTicketId;
  if (lastTid && db.tickets?.[lastTid] && db.tickets[lastTid].status !== "CLOSED") {
    db.tickets[lastTid].lastCustomerMsg = body;
    db.tickets[lastTid].updatedAt = nowISO();
    saveDB(db);
  }

  let replyText = null;

  if (askAddr) {
    replyText = `Untuk lokasi, silakan buka: ${MAPS_LINK}`;
  } else {
    const ai = await aiReply(body);
    if (ai) replyText = ai;
  }

  if (!replyText) {
    replyText = [
      `Halo! Boleh info singkat ya:`,
      `1) Mobil & tahun`,
      `2) Keluhan utama (contoh: rpm tinggi / jedug / selip / telat masuk gigi)`,
      `3) Muncul saat dingin atau saat panas/macet?`,
    ].join("\n");
  }

  const reply = [
    replyText,
    ``,
    `Jika unit tidak bisa berjalan / terasa berisiko, sebaiknya jangan dipaksakan.`,
    `Ketik *TOWING* lalu kirim *share lokasi* bila perlu.`,
    confidenceLine(),
    ``,
    businessSignature(),
  ].join("\n");

  res.type("text/xml");
  return res.send(`<Response><Message>${escapeXml(reply)}</Message></Response>`);
}

// -------------------- ROUTES (A) --------------------
app.post(["/twilio/webhook", "/whatsapp/incoming"], (req, res) => {
  webhookHandler(req, res).catch((e) => {
    console.error("Webhook fatal:", e.message);
    res.type("text/xml");
    return res.send(`<Response><Message>${escapeXml("Maaf, sistem sedang padat. Silakan ketik TOWING untuk darurat atau JADWAL untuk booking.")}</Message></Response>`);
  });
});
app.get("/", (_req, res) => res.status(200).send("HONGZ AI SERVER — OK (Level 2)"));

// -------------------- WORKER (D) --------------------
function minutesAgo(iso) {
  const t = ms(iso);
  if (!t) return 999999;
  return (Date.now() - t) / 60000;
}

async function workerTick() {
  try {
    const db = loadDB();
    ensureTickets(db);

    const towingMin = Number(TOWING_REMIND_MIN) || 5;
    const jadwalMin = Number(JADWAL_REMIND_MIN) || 10;
    const maxRem = Number(MAX_AUTO_REMIND) || 3;

    const tickets = Object.values(db.tickets || {});
    if (!tickets.length) return;

    for (const t of tickets) {
      if (t.status === "CLOSED") continue;

      // --- TOWING pending location follow-up ---
      if (t.kind === "TOWING") {
        const noLoc = !t.locationUrl;
        const stale = minutesAgo(t.updatedAt) >= towingMin;

        if (noLoc && stale && (t.remindCount || 0) < maxRem) {
          // remind customer
          await sendWhatsApp(t.customerFrom, towingReminder());

          // notify admin
          await notifyAdmin({
            title: `⏳ *AUTO FOLLOW UP (TOWING)*`,
            ticket: t,
            from: t.customerFrom,
            body: "Customer belum kirim lokasi. Auto reminder dikirim.",
            locationUrl: null,
            tags: ["TOWING_PENDING", "NO_LOCATION", `REMIND_${(t.remindCount || 0) + 1}`],
          });

          t.remindCount = (t.remindCount || 0) + 1;
          t.updatedAt = nowISO();
          db.tickets[t.id] = t;
          saveDB(db);
        }
      }

      // --- JADWAL follow-up if customer hasn't sent booking format ---
      if (t.kind === "JADWAL") {
        const stale = minutesAgo(t.updatedAt) >= jadwalMin;

        if (stale && (t.remindCount || 0) < maxRem) {
          await sendWhatsApp(t.customerFrom, jadwalReminder());

          await notifyAdmin({
            title: `📌 *AUTO FOLLOW UP (JADWAL)*`,
            ticket: t,
            from: t.customerFrom,
            body: "Customer belum kirim format booking. Auto reminder dikirim.",
            locationUrl: null,
            tags: ["JADWAL_PENDING", `REMIND_${(t.remindCount || 0) + 1}`],
          });

          t.remindCount = (t.remindCount || 0) + 1;
          t.updatedAt = nowISO();
          db.tickets[t.id] = t;
          saveDB(db);
        }
      }
    }
  } catch (e) {
    console.error("Worker tick error:", e.message);
  }
}

function startWorker() {
  const enabled = String(WORKER_ENABLED).toLowerCase() === "true";
  if (!enabled) return;
  const sec = Math.max(10, Number(WORKER_INTERVAL_SEC) || 30);
  console.log(`[WORKER] enabled — interval ${sec}s`);
  setInterval(workerTick, sec * 1000);
}

// -------------------- START --------------------
const port = process.env.PORT || 10000;
app.listen(port, () => {
  console.log("HONGZ AI SERVER — LEVEL 2 (AUTO TICKET + WORKER) — START");
  console.log("Listening on port:", port);
  console.log("Webhook routes: /twilio/webhook and /whatsapp/incoming");
  startWorker();
});
