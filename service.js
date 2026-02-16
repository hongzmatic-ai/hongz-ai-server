const express = require("express");
const bodyParser = require("body-parser");
const twilio = require("twilio");
const fs = require("fs");
const path = require("path");

require("dotenv").config();

const { generateReply } = require("./service");
console.log("✅ Hongz AI Engine loaded: v5.6 + Follow-up Pack");

// =====================
// APP
// =====================
const app = express();

// Twilio sends x-www-form-urlencoded
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// =====================
// SIMPLE JSON DB (Persistent Disk)
// =====================
const DATA_DIR = process.env.DATA_DIR || "/var/data";
const DB_PATH = path.join(DATA_DIR, "hongz_followup_db.json");

function ensureDB() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify({ customers: {} }, null, 2));
  }
}

function loadDB() {
  try {
    ensureDB();
    return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  } catch {
    return { customers: {} };
  }
}

function saveDB(db) {
  try {
    ensureDB();
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
  } catch {}
}

function upsertCustomer({ from, lastMsg, meta }) {
  const db = loadDB();
  const now = Date.now();
  const c = db.customers[from] || { followupCount: 0, optOut: false };

  db.customers[from] = {
    ...c,
    from,
    lastMsg,
    meta: meta || c.meta || {},
    lastInboundAt: now,
    waitingSince: now, // reset waiting marker when customer speaks again
  };

  saveDB(db);
}

function markOptOut(from, optOut = true) {
  const db = loadDB();
  if (!db.customers[from]) db.customers[from] = { from, followupCount: 0 };
  db.customers[from].optOut = optOut;
  saveDB(db);
}

function markFollowupSent(from) {
  const db = loadDB();
  const now = Date.now();
  const c = db.customers[from] || { followupCount: 0 };

  db.customers[from] = {
    ...c,
    lastFollowupAt: now,
    followupCount: (c.followupCount || 0) + 1,
  };

  saveDB(db);
}

function isDueForFollowup(cust) {
  if (process.env.FOLLOWUP_ENABLED !== "true") return false;
  if (cust.optOut) return false;

  const hours = Number(process.env.FOLLOWUP_HOURS || 12);
  const cooldown = Number(process.env.FOLLOWUP_COOLDOWN_HOURS || 24);
  const maxPer = Number(process.env.FOLLOWUP_MAX_PER_CUSTOMER || 3);

  const now = Date.now();
  const lastInboundAt = cust.lastInboundAt || 0;
  const lastFollowupAt = cust.lastFollowupAt || 0;
  const followupCount = cust.followupCount || 0;

  if (followupCount >= maxPer) return false;

  const dueMs = hours * 3600 * 1000;
  const cooldownMs = cooldown * 3600 * 1000;

  if (now - lastInboundAt < dueMs) return false;
  if (lastFollowupAt && now - lastFollowupAt < cooldownMs) return false;

  return true;
}

// =====================
// FOLLOW-UP 50% AUTHORITY TEXT
// =====================
function followupText(cust) {
  const meta = cust.meta || {};
  const tier = meta.tier || "STANDARD";
  const urgency = !!meta.urgency;
  const priceFocus = !!meta.priceFocus;

  const MAPS = process.env.MAPS_LINK || "https://maps.app.goo.gl/CvFZ9FLNJRog7K4t9";

  if (urgency) {
    return [
      "Kami follow-up ya. Jika unit masih *tidak bisa jalan*, sebaiknya tidak dipaksakan.",
      "Untuk mencegah pelebaran kerusakan, opsi paling aman adalah evakuasi.",
      "Ketik *TOWING* dan kirim share lokasi Anda — kami arahkan prosesnya hari ini.",
      "",
      `📍 Lokasi Hongz: ${MAPS}`,
      "Ketik *ADMIN* bila ingin respon prioritas.",
      "Ketik STOP jika tidak ingin follow-up lagi.",
    ].join("\n");
  }

  if (priceFocus) {
    return [
      "Kami follow-up ya.",
      "Estimasi tanpa pemeriksaan sering tidak akurat dan berisiko salah arah biaya.",
      "Agar hasil tepat & efisien, unit perlu kami cek langsung.",
      "",
      "Slot pemeriksaan terbatas. Ketik *JADWAL* untuk amankan jadwal.",
      `📍 Lokasi: ${MAPS}`,
      "Ketik STOP jika tidak ingin follow-up lagi.",
    ].join("\n");
  }

  if (tier === "PREMIUM" || tier === "MID_PREMIUM") {
    return [
      "Kami follow-up ya.",
      "Untuk unit dengan kontrol transmisi modern, penanganan presisi penting agar tidak terjadi trial-error.",
      "Kami prioritaskan slot unit premium untuk pemeriksaan yang akurat.",
      "",
      "Datang hari ini atau perlu bantuan towing?",
      "Ketik *JADWAL* / *TOWING*.",
      `📍 Lokasi: ${MAPS}`,
      "Ketik STOP jika tidak ingin follow-up lagi.",
    ].join("\n");
  }

  return [
    "Kami follow-up ya.",
    "Gejala yang Anda sampaikan sebaiknya tidak dibiarkan karena berpotensi berkembang.",
    "Agar tidak melebar, unit sebaiknya diperiksa dalam waktu dekat.",
    "",
    "Slot hari ini terbatas. Ketik *JADWAL* untuk amankan jadwal,",
    "atau *TOWING* bila unit tidak memungkinkan berjalan.",
    `📍 Lokasi: ${MAPS}`,
    "Ketik STOP jika tidak ingin follow-up lagi.",
  ].join("\n");
}

// =====================
// META GUESS (lightweight)
// =====================
function guessMetaFromText(msg) {
  const text = (msg || "").toLowerCase();

  const premium = /land cruiser|alphard|vellfire|lexus|bmw|mercedes|benz|audi|porsche|range rover|land rover|prado/;
  const mid = /x-trail t32|xtrail t32|crv turbo|cx-5|cx5|harrier|forester|outlander/;
  const urgent = /tidak bisa jalan|gak bisa jalan|mogok|overheat|panas.*tidak bisa|masuk d.*tidak jalan|masuk r.*tidak jalan|selip parah|rpm naik tapi tidak jalan/;
  const price = /berapa|biaya|harga|kisaran|range|murah|diskon|nego|budget/;

  return {
    tier: premium.test(text) ? "PREMIUM" : mid.test(text) ? "MID_PREMIUM" : "STANDARD",
    urgency: urgent.test(text),
    priceFocus: price.test(text),
  };
}

// =====================
// ROUTES
// =====================
app.get("/", (req, res) => {
  res.send("Hongz AI WhatsApp Server is running ✅");
});

app.post("/whatsapp/incoming", async (req, res) => {
  try {
    const incomingMsg = (req.body.Body || "").trim();
    const from = req.body.From; // "whatsapp:+62..."

    const twiml = new twilio.twiml.MessagingResponse();

    // empty message
    if (!incomingMsg) {
      twiml.message("Halo! Ketik keluhan singkat Anda ya. Contoh: 'panas gak bisa jalan' atau 'jedug saat pindah gigi'.");
      res.type("text/xml").send(twiml.toString());
      return;
    }

    // opt-out controls
    const low = incomingMsg.toLowerCase();
    if (low === "stop" || low === "unsubscribe") {
      markOptOut(from, true);
      twiml.message("Baik. Follow-up dinonaktifkan. Jika ingin aktif lagi, ketik START.");
      res.type("text/xml").send(twiml.toString());
      return;
    }
    if (low === "start" || low === "subscribe") {
      markOptOut(from, false);
      twiml.message("Siap. Follow-up diaktifkan kembali. Silakan ketik keluhan Anda.");
      res.type("text/xml").send(twiml.toString());
      return;
    }

    // Track last inbound to DB
    const meta = guessMetaFromText(incomingMsg);
    if (from) upsertCustomer({ from, lastMsg: incomingMsg, meta });

    // Generate reply from service.js
    const reply = await generateReply(incomingMsg);
    twiml.message(reply);

    res.type("text/xml").send(twiml.toString());
  } catch (err) {
    console.error("Webhook error:", err);
    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message("Maaf, sistem sedang sibuk. Ketik ulang pesan Anda atau ketik *JADWAL* / *TOWING*.");
    res.type("text/xml").send(twiml.toString());
  }
});

// CRON FOLLOW-UP (POST)
app.post("/cron/followup", async (req, res) => {
  try {
    if (req.query.key !== process.env.CRON_KEY) return res.status(403).send("Forbidden");
    if (process.env.FOLLOWUP_ENABLED !== "true") return res.send("Follow-up disabled");

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromBot = process.env.TWILIO_WHATSAPP_FROM; // "whatsapp:+62..."

    if (!accountSid || !authToken || !fromBot) return res.status(500).send("Missing Twilio env");

    const client = require("twilio")(accountSid, authToken);

    const db = loadDB();
    const customers = Object.values(db.customers || {});
    const due = customers.filter(isDueForFollowup);

    let sent = 0;
    for (const cust of due) {
      const to = cust.from;
      const body = followupText(cust);
      await client.messages.create({ from: fromBot, to, body });
      markFollowupSent(to);
      sent++;
    }

    res.send(`Follow-up sent: ${sent}`);
  } catch (e) {
    console.error("cron/followup error:", e);
    res.status(500).send("Error");
  }
});

// =====================
// START
// =====================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
