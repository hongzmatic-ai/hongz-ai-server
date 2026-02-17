/**
 * HONGZ AI SERVER — ENTERPRISE C+ (ONE FILE) — FULL REPLACE (CTA TAG + Closing Soft + Scarcity)
 * - Dual webhook: /twilio/webhook & /whatsapp/incoming
 * - Auto ticket + lead scoring + priority tags
 * - Admin notif: towing + share lokasi + jadwal + customer wa.me link + customer number
 * - Admin commands (ONLY ADMIN): HELP, LIST, STATS, CLAIM T-xxxxx, CLOSE T-xxxxx, NOTE T-xxxxx ...
 * - Follow-up cron (2 tahap): 18h & 48h -> /cron/followup?key=CRON_KEY
 * - SCARCITY_MODE: soft|hard (Papa pilih soft)
 *
 * REQUIRED ENV:
 *   TWILIO_ACCOUNT_SID
 *   TWILIO_AUTH_TOKEN
 *   TWILIO_WHATSAPP_FROM      e.g. "whatsapp:+6285729651657" (Twilio sender)
 *   ADMIN_WHATSAPP_TO         e.g. "whatsapp:+6281375430728" (Papa/admin)
 *
 * RECOMMENDED ENV (Branding):
 *   BIZ_NAME, BIZ_ADDRESS, BIZ_HOURS, MAPS_LINK
 *   WHATSAPP_ADMIN, WHATSAPP_CS (public https://wa.me/ links)
 *
 * FOLLOW-UP:
 *   FOLLOWUP_ENABLED="true"
 *   FOLLOWUP_STAGE1_HOURS="18"
 *   FOLLOWUP_STAGE2_HOURS="48"
 *   FOLLOWUP_COOLDOWN_HOURS="24"
 *   FOLLOWUP_MAX_PER_CUSTOMER="2"
 *   CRON_KEY="hongzCron_xxx"
 *
 * SCARCITY:
 *   SCARCITY_MODE="soft"  (soft|hard)
 *   SCARCITY_SLOTS="2"    (dipakai jika hard)
 *
 * STORAGE:
 *   DATA_DIR="/var/data"  (Render persistent disk)
 *
 * DEBUG:
 *   DEBUG="true"
 */

const express = require("express");
const bodyParser = require("body-parser");
const twilio = require("twilio");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// ---------- ENV ----------
const {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_WHATSAPP_FROM,
  ADMIN_WHATSAPP_TO,

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

function normText(s) {
  return String(s || "").replace(/\u200b/g, "").trim();
}
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
  if (mapsLinkMatch) return { type: "link", mapsUrl: mapsLinkMatch[0], raw: body };

  return null;
}

// ---------- BRAND SIGNATURE ----------
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

// ---------- SCARCITY (soft/hard + tag boost) ----------
function scarcityLine(ticket) {
  const mode = String(SCARCITY_MODE || "soft").toLowerCase();
  const slots = Number(SCARCITY_SLOTS || 2);
  const tag = String(ticket?.tag || "");

  if (mode === "hard") {
    const s = isFinite(slots) ? slots : 2;
    // sedikit boost untuk priority
    if (tag.includes("PRIORITY")) return `⏳ Slot diagnosa hari ini tinggal ${s}. Jika berkenan, kami amankan lebih dulu.`;
    return `⏳ Slot pemeriksaan hari ini tinggal ${s}.`;
  }

  // soft
  if (tag.includes("PRIORITY")) return "⏳ Slot diagnosa hari ini terbatas agar penanganan tetap fokus & presisi.";
  if (tag.includes("POTENTIAL")) return "⏳ Slot pemeriksaan terbatas—lebih cepat dicek, lebih aman.";
  return "⏳ Jika memungkinkan, sebaiknya dicek lebih awal.";
}

// ---------- CTA berdasarkan TAG + TYPE (closing soft naik) ----------
function ctaLine(ticket) {
  const tag = String(ticket?.tag || "");
  const type = String(ticket?.type || "GENERAL");

  const isPriority = tag.includes("PRIORITY");
  const isPotential = tag.includes("POTENTIAL");

  if (type === "TOWING") {
    if (isPriority) {
      return [
        "🚨 Agar cepat ditangani, silakan kirim *share lokasi sekarang* ya.",
        "Begitu lokasi masuk, admin langsung follow up untuk arahkan evakuasi."
      ].join("\n");
    }
    if (isPotential) {
      return [
        "Jika unit terasa berisiko, silakan kirim *share lokasi* ya.",
        "Admin follow up untuk bantu langkah aman."
      ].join("\n");
    }
    return "Jika unit tidak aman dijalankan, silakan kirim *share lokasi*—admin akan follow up.";
  }

  if (type === "JADWAL") {
    if (isPriority) {
      return [
        "📅 Kami bisa siapkan slot prioritas untuk diagnosa presisi.",
        "Silakan ketik: *JADWAL* + jam perkiraan (contoh: JADWAL jam 3 sore)."
      ].join("\n");
    }
    if (isPotential) {
      return [
        "📅 Jika Anda siap, ketik *JADWAL* + jam perkiraan datang.",
        "Admin bantu pilihkan waktu yang paling pas."
      ].join("\n");
    }
    return "Jika berkenan, ketik *JADWAL* untuk booking pemeriksaan.";
  }

  // GENERAL
  if (isPriority) {
    return [
      "✅ Agar tidak melebar, kami sarankan booking lebih cepat.",
      "Ketik *JADWAL* (atau kirim *share lokasi* bila unit tidak aman)."
    ].join("\n");
  }
  if (isPotential) {
    return [
      "Jika ingin kami siapkan waktu terbaik, ketik *JADWAL*.",
      "Jika unit terasa berisiko, kirim *share lokasi* ya."
    ].join("\n");
  }
  return "Ketik *JADWAL* untuk booking, atau kirim *share lokasi* bila unit tidak aman.";
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
    followupCount: 0,
    lastFollowupAtMs: 0,
    lastInboundAtMs: nowMs(),
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
    `Ticket: ${ticket.id} (${ticket.tag} | Score ${ticket.score}/10)`,
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

function towingInstruction(ticket) {
  const parts = [];
  parts.push(`Jika unit tidak bisa berjalan / terasa berisiko, sebaiknya jangan dipaksakan untuk mencegah kerusakan melebar.`);
  parts.push(`Silakan kirim *share lokasi* Anda — setelah kami terima, admin langsung follow up dan arahkan proses evakuasi.`);
  if (ticket?.locationUrl) parts.push(`📍 Lokasi terdeteksi: ${ticket.locationUrl}`);
  parts.push(ctaLine(ticket));
  parts.push(scarcityLine(ticket));
  parts.push(confidenceLine());
  parts.push("");
  parts.push(businessSignature());
  return parts.join("\n");
}

function jadwalInstruction(ticket) {
  return [
    `Siap, untuk *booking pemeriksaan*, mohon kirim data singkat:`,
    `1) Nama`,
    `2) Mobil & tahun`,
    `3) Keluhan utama (contoh: "rpm tinggi", "jedug pindah gigi", "selip")`,
    `4) Rencana datang (hari & jam)`,
    ``,
    ctaLine(ticket),
    scarcityLine(ticket),
    confidenceLine(),
    ``,
    businessSignature(),
  ].join("\n");
}

function generalTemplate(ticket) {
  return [
    `Halo! Kami siap bantu.`,
    `Boleh info singkat ya:`,
    `1) Mobil & tahun`,
    `2) Keluhan utama (rpm tinggi / jedug / selip / telat masuk gigi)`,
    `3) Muncul saat dingin atau saat panas/macet?`,
    ``,
    ctaLine(ticket),
    scarcityLine(ticket),
    confidenceLine(),
    ``,
    businessSignature(),
  ].join("\n");
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
    lines.push(`${t.id} | ${t.tag} | ${t.status} | ${t.msisdn} | ${t.type} | ${t.locationUrl ? "📍loc" : "-"} | ${shortMsg}`);
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

// ---------- FOLLOW-UP (2 STAGES) ----------
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

function followupText(ticket) {
  const tag = String(ticket.tag || "");
  const isPriority = tag.includes("PRIORITY");

  const opener = isPriority
    ? "Kami follow-up ya. Untuk gejala seperti ini, penanganan cepat biasanya mencegah masalah melebar."
    : "Kami follow-up ya. Agar tidak berkembang, sebaiknya unit ditangani dalam waktu dekat.";

  // soft closing boost (tanpa lebay)
  const action =
    ticket.type === "TOWING"
      ? "Jika unit masih tidak aman untuk dijalankan, silakan kirim *share lokasi*—admin langsung follow up untuk evakuasi."
      : "Jika Anda siap, ketik *JADWAL*—kami siapkan waktu terbaik untuk Anda.";

  return [
    opener,
    action,
    scarcityLine(ticket),
    confidenceLine(),
    "",
    businessSignature(),
    "",
    "Jika tidak ingin follow-up lagi, ketik STOP.",
  ].join("\n");
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

  const score = leadScore({
    body,
    hasLocation: hasLoc,
    isTowingCmd: cmdTowing,
    isJadwalCmd: cmdJadwal,
  });
  const tag = leadTag(score);

  updateTicket(ticket, {
    lastBody: body,
    lastInboundAtMs: nowMs(),
    score,
    tag,
    waMe: toWaMe(from),
    msisdn: cleanMsisdn(from),
    type: cmdJadwal ? "JADWAL" : (cmdTowing || cantDrive || hasLoc ? "TOWING" : "GENERAL"),
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
      ctaLine(ticket),
      scarcityLine(ticket),
      confidenceLine(),
      "",
      businessSignature(),
    ].join("\n");

    return replyTwiML(res, reply);
  }

  // RULE 2: towing command or can't drive -> notify admin + ask location
  if (cmdTowing || cantDrive) {
    await notifyAdmin({
      title: "🚨 *PRIORITY TOWING (AUTO)*",
      ticket,
      reason: cmdTowing ? "Customer typed TOWING" : "Customer mentions can't drive / risk",
      body,
      locationUrl: ticket.locationUrl || "",
    });

    saveDB(db);
    return replyTwiML(res, towingInstruction(ticket));
  }

  // RULE 3: jadwal -> notify admin + send booking template
  if (cmdJadwal) {
    await notifyAdmin({
      title: "📅 *BOOKING REQUEST (AUTO)*",
      ticket,
      reason: "Customer typed JADWAL",
      body,
      locationUrl: ticket.locationUrl || "",
    });

    saveDB(db);
    return replyTwiML(res, jadwalInstruction(ticket));
  }

  // RULE 4: address question -> only MAPS_LINK (anti ngawur)
  if (/alamat|lokasi|maps|map|di mana|dimana/i.test(body)) {
    saveDB(db);
    const reply = [
      `Untuk lokasi, silakan buka: ${MAPS_LINK}`,
      scarcityLine(ticket),
      confidenceLine(),
      "",
      businessSignature(),
    ].join("\n");
    return replyTwiML(res, reply);
  }

  // default
  saveDB(db);
  return replyTwiML(res, generalTemplate(ticket));
}

// ---------- DUAL ROUTES ----------
app.post(["/twilio/webhook", "/whatsapp/incoming"], (req, res) => {
  webhookHandler(req, res).catch((e) => {
    console.error("Webhook fatal:", e.message);
    return replyTwiML(res, "Maaf, sistem sedang padat. Ketik *TOWING* untuk darurat atau *JADWAL* untuk booking.");
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

      if (isDueForFollowup(t)) {
        const msg = followupText(t);

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
app.get("/", (_req, res) => res.status(200).send("HONGZ AI SERVER — ENTERPRISE C+ — OK"));

// ---------- START ----------
const port = process.env.PORT || 10000;
app.listen(port, () => {
  console.log("HONGZ AI SERVER — ENTERPRISE C+ — START");
  console.log("Listening on port:", port);
  console.log("Webhook routes: /twilio/webhook and /whatsapp/incoming");
});