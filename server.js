// server.js
// =====================================================
// HONGZ AI SERVER - FULL REPLACE (Memory + Follow-up v6)
// - Twilio inbound webhook: /whatsapp/incoming
// - Cron follow-up: /cron/followup?key=CRON_KEY
// - Persistent JSON DB on Render Disk (/var/data)
// =====================================================

const express = require("express");
const bodyParser = require("body-parser");
const twilio = require("twilio");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const { generateReply } = require("./service");
console.log("✅ Hongz AI Engine loaded: service.js");

// =====================
// APP
// =====================
const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// =====================
// SIMPLE JSON DB (Persistent Disk)
// =====================
const DATA_DIR = process.env.DATA_DIR || "/var/data";
const DB_PATH = path.join(DATA_DIR, "hongz_followup_db.json");

function ensureDB() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_PATH)) fs.writeFileSync(DB_PATH, JSON.stringify({ customers: {} }, null, 2));
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
  } catch (e) {
    console.log("DB save error:", e?.message || e);
  }
}

// =====================
// WA helper for auto-fill (follow-up v6)
// =====================
function cleanMsisdn(msisdn) {
  return String(msisdn || "").replace(/[^\d]/g, "");
}

function waLink(msisdn, text = "") {
  const n = cleanMsisdn(msisdn);
  if (!n) return "";
  if (!text) return `https://wa.me/${n}`;
  return `https://wa.me/${n}?text=${encodeURIComponent(text)}`;
}

function templateAdminFollowup(cust) {
  const p = cust.profile || {};
  const meta = cust.meta || {};
  const unit = (p.model && p.year) ? `${p.model} ${p.year}` : (p.model || "");
  const tagStr = Array.isArray(p.symptoms) && p.symptoms.length ? p.symptoms.join(", ") : "-";
  const last = String(cust.lastMsg || "").replace(/\s+/g, " ").trim().slice(0, 240);

  return [
    "Halo Admin Hongz, saya follow-up pesan sebelumnya.",
    unit ? `Unit: ${String(unit).toUpperCase()}` : "Unit: -",
    `Keluhan terakhir: ${last || "-"}`,
    `Tag sistem: ${tagStr}`,
    meta.urgency ? "Kondisi: URGENT (berisiko jika dipaksakan)" : "Kondisi: -",
    "",
    "Saya siap kirim detail:",
    "- Nama:",
    "- Lokasi sekarang (share lokasi):",
    "- Unit bisa jalan atau perlu towing:",
  ].join("\n");
}

// =====================
// PROFILE EXTRACTOR (Memory v2+)
// =====================
function extractProfileFromText(msg = "") {
  const t = String(msg || "").toLowerCase();

  // model keywords (lightweight, extend as needed)
  // NOTE: keep it simple to avoid false positives
  let model = "";
  const models = [
    "innova", "avanza", "xenia", "rush", "fortuner", "pajero", "alphard", "vellfire",
    "land cruiser", "landcruiser", "prado", "camry", "corolla", "yaris",
    "x-trail", "xtrail", "crv", "hrv", "brv", "civic",
    "mazda", "cx-5", "cx5",
    "bmw", "mercedes", "benz", "audi", "lexus", "porsche"
  ];

  for (const m of models) {
    if (t.includes(m)) { model = m.toUpperCase(); break; }
  }

  // year 4-digit
  const yearMatch = t.match(/\b(19|20)\d{2}\b/);
  const year4 = yearMatch ? yearMatch[0] : "";

  // year 2-digit (08, 09, 19)
  let year2 = "";
  const yy = t.match(/\b\d{2}\b/);
  if (!year4 && yy) {
    const n = Number(yy[0]);
    if (n >= 0 && n <= 25) year2 = `20${String(n).padStart(2, "0")}`;
    else if (n >= 80 && n <= 99) year2 = `19${yy[0]}`;
  }
  const year = year4 || year2;

  // symptom tags
  const symptoms = [];
  const add = (tag) => { if (!symptoms.includes(tag)) symptoms.push(tag); };

  if (/rpm tinggi|rpm naik/.test(t)) add("RPM_TINGGI");
  if (/telat masuk|baru masuk|delay/.test(t)) add("DELAY_GEAR");
  if (/jedug|hentak|sentak/.test(t)) add("JEDUG");
  if (/selip|ngelos|tarikan hilang/.test(t)) add("SELIP");
  if (/tidak bisa jalan|gak bisa jalan|mogok|tidak bergerak/.test(t)) add("NO_MOVE");
  if (/panas.*(gak bisa jalan|tidak bisa jalan)|overheat/.test(t)) add("HOT_NO_GO");
  if (/dengung|gaung|berisik|suara aneh|ngorok/.test(t)) add("NOISE");
  if (/lampu|indikator|warning|at oil|check engine/.test(t)) add("WARNING_LAMP");

  // canDrive hint
  let canDrive = null;
  if (/bisa jalan|masih bisa jalan/.test(t)) canDrive = true;
  if (/tidak bisa jalan|gak bisa jalan|mogok/.test(t)) canDrive = false;

  return { model, year, symptoms, canDrive };
}

function mergeProfiles(oldP = {}, newP = {}) {
  const mergedModel = newP.model || oldP.model || "";
  const mergedYear = newP.year || oldP.year || "";
  const mergedSymptoms = Array.from(new Set([...(oldP.symptoms || []), ...(newP.symptoms || [])]));
  const mergedCanDrive =
    (typeof newP.canDrive === "boolean") ? newP.canDrive :
    (typeof oldP.canDrive === "boolean") ? oldP.canDrive : null;

  return { model: mergedModel, year: mergedYear, symptoms: mergedSymptoms, canDrive: mergedCanDrive };
}

// =====================
// CUSTOMER UPSERT
// =====================
function upsertCustomer({ from, lastMsg, meta }) {
  const db = loadDB();
  const now = Date.now();

  const c = db.customers[from] || {
    followupCount: 0,
    optOut: false,
    profile: { model: "", year: "", symptoms: [], canDrive: null },
    meta: {},
  };

  const extracted = extractProfileFromText(lastMsg);
  const mergedProfile = mergeProfiles(c.profile || {}, extracted);

  db.customers[from] = {
    ...c,
    from,
    lastMsg,
    meta: meta || c.meta || {},
    profile: mergedProfile,
    lastInboundAt: now,
    waitingSince: now,
  };

  saveDB(db);
}

function markOptOut(from, optOut = true) {
  const db = loadDB();
  if (!db.customers[from]) db.customers[from] = { from, followupCount: 0, profile: {}, meta: {} };
  db.customers[from].optOut = optOut;
  saveDB(db);
}

function markFollowupSent(from) {
  const db = loadDB();
  const now = Date.now();
  const c = db.customers[from] || { followupCount: 0, profile: {}, meta: {} };

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
// FOLLOW-UP v6 (Escalation + Symptom + Admin auto-fill)
// =====================
function followupText(cust) {
  const meta = cust.meta || {};
  const profile = cust.profile || {};

  const tier = meta.tier || "STANDARD";
  const urgency = !!meta.urgency;
  const priceFocus = !!meta.priceFocus;

  const MAPS = process.env.MAPS_LINK || "https://maps.app.goo.gl/CvFZ9FLNJRog7K4t9";

  const n = Math.min((cust.followupCount || 0) + 1, 3);

  let unitName = "";
  if (profile.model && profile.year) unitName = `${profile.model} ${profile.year}`;
  else if (profile.model) unitName = profile.model;

  const unitLine = unitName ? `untuk unit ${String(unitName).toUpperCase()} Anda` : "untuk unit Anda";
  const stopLine = "Ketik STOP jika tidak ingin follow-up lagi.";
  const mapsLine = `📍 Lokasi: ${MAPS}`;

  const WA_ADMIN = cleanMsisdn(process.env.WA_ADMIN || "6281375430728");
  const adminFilled = waLink(WA_ADMIN, templateAdminFollowup(cust));
  const adminLine = adminFilled ? `📲 WhatsApp Admin (klik, pesan sudah terisi): ${adminFilled}` : "";

  const tags = Array.isArray(profile.symptoms) ? profile.symptoms : [];
  const has = (tag) => tags.includes(tag);

  function symptomLine() {
    if (has("HOT_NO_GO")) return "Catatan: pola *panas lalu hilang gerak* sering terkait kestabilan tekanan kerja saat suhu naik—lebih aman ditangani cepat.";
    if (has("NO_MOVE")) return "Catatan: kondisi *tidak bisa jalan* sebaiknya tidak dipaksakan karena berisiko memperluas kerusakan internal.";
    if (has("SELIP")) return "Catatan: *selip / rpm naik tapi tarikan hilang* umumnya mengarah ke ketidakstabilan tekanan kerja atau slip internal—lebih efisien bila dicek lebih awal.";
    if (has("RPM_TINGGI") || has("DELAY_GEAR")) return "Catatan: *rpm tinggi / telat masuk gigi* sering terkait delay tekanan/valve body/ATF—lebih terkendali bila diagnosa berbasis data dilakukan lebih awal.";
    if (has("JEDUG")) return "Catatan: *jedug/hentak* biasanya muncul saat kontrol perpindahan tidak presisi—lebih aman dicek agar tidak berkembang.";
    if (has("NOISE")) return "Catatan: *gaung/dengung* perlu dipastikan sumbernya (drivetrain/torque converter/bearing)—lebih cepat ketemu jika dicek langsung.";
    if (has("WARNING_LAMP")) return "Catatan: jika ada *indikator/warning lamp*, pemeriksaan scan data sebaiknya diprioritaskan agar arah penanganan tepat.";
    return "Catatan: gejala yang berulang biasanya lebih mudah dikendalikan bila ditangani sebelum berkembang.";
  }

  const stageIntro = {
    1: `Kami follow-up ya ${unitLine}.`,
    2: `Kami follow-up lagi ${unitLine} agar arah penanganan tetap efisien.`,
    3: `Kami follow-up terakhir ${unitLine} supaya tidak terlambat ditangani.`,
  };

  const stageCTA = {
    1: "Jika memungkinkan, ketik *JADWAL* untuk pemeriksaan.",
    2: "Agar cepat terkendali, ketik *JADWAL* untuk amankan slot pemeriksaan.",
    3: "Jika Anda siap, ketik *JADWAL* sekarang untuk prioritas pemeriksaan.",
  };

  const stageTow = {
    1: "Jika unit tidak memungkinkan berjalan, ketik *TOWING* lalu kirim share lokasi.",
    2: "Jika unit berat / ragu dipakai jalan, ketik *TOWING* dan kirim share lokasi — kami arahkan evakuasi.",
    3: "Jika unit tidak bisa jalan, ketik *TOWING* sekarang agar evakuasi bisa diatur lebih cepat.",
  };

  // urgent path
  if (urgency || has("NO_MOVE") || has("HOT_NO_GO")) {
    const byStage = {
      1: [stageIntro[n], symptomLine(), "Jika masih berisiko / tidak bisa berjalan, sebaiknya jangan dipaksakan.", "", stageTow[n], adminLine, mapsLine, stopLine],
      2: [stageIntro[n], symptomLine(), "Untuk menjaga kerusakan tidak melebar, langkah paling aman adalah evakuasi dan pemeriksaan berbasis data.", "", stageTow[n], adminLine, mapsLine, stopLine],
      3: [stageIntro[n], symptomLine(), "Agar tetap efisien dan terkendali, sebaiknya tindakan dilakukan segera (towing/masuk workshop).", "", stageTow[n], adminLine, mapsLine, stopLine],
    };
    return byStage[n].filter(Boolean).join("\n");
  }

  // price path
  if (priceFocus) {
    const byStage = {
      1: [stageIntro[n], symptomLine(), "Estimasi tanpa pemeriksaan sering tidak akurat dan berisiko salah arah biaya.", "Agar tepat & efisien, unit perlu dicek berbasis data.", "", stageCTA[n], adminLine, mapsLine, stopLine],
      2: [stageIntro[n], symptomLine(), "Pendekatan lebih awal biasanya lebih terkendali dibanding koreksi setelah pola berkembang.", "", stageCTA[n], adminLine, mapsLine, stopLine],
      3: [stageIntro[n], symptomLine(), "Jika Anda ingin jalur respon prioritas, klik WhatsApp Admin di bawah.", "", stageCTA[n], adminLine, mapsLine, stopLine],
    };
    return byStage[n].filter(Boolean).join("\n");
  }

  // premium path
  if (tier === "PREMIUM" || tier === "MID_PREMIUM") {
    const byStage = {
      1: [stageIntro[n], symptomLine(), "Untuk unit dengan kontrol transmisi modern, penanganan presisi penting agar tidak trial-error.", "", stageCTA[n], stageTow[n], adminLine, mapsLine, stopLine],
      2: [stageIntro[n], symptomLine(), "Kami bisa prioritaskan slot pemeriksaan agar diagnosa cepat dan akurat.", "", stageCTA[n], stageTow[n], adminLine, mapsLine, stopLine],
      3: [stageIntro[n], symptomLine(), "Jika Anda ingin pemeriksaan diprioritaskan, klik WhatsApp Admin agar diarahkan jalur prioritas.", "", stageCTA[n], stageTow[n], adminLine, mapsLine, stopLine],
    };
    return byStage[n].filter(Boolean).join("\n");
  }

  // standard path
  const byStage = {
    1: [stageIntro[n], symptomLine(), "Agar tetap efisien, unit sebaiknya diperiksa dalam waktu dekat.", "", stageCTA[n], stageTow[n], adminLine, mapsLine, stopLine],
    2: [stageIntro[n], symptomLine(), "Pemeriksaan berbasis data membantu memastikan tindakan yang tepat sejak awal.", "", stageCTA[n], stageTow[n], adminLine, mapsLine, stopLine],
    3: [stageIntro[n], symptomLine(), "Jika Anda siap, ketik *JADWAL* sekarang atau klik WhatsApp Admin untuk jalur prioritas.", "", stageCTA[n], stageTow[n], adminLine, mapsLine, stopLine],
  };

  return byStage[n].filter(Boolean).join("\n");
}

// =====================
// META GUESS (lightweight) for follow-up targeting
// =====================
function guessMetaFromText(msg) {
  const text = String(msg || "").toLowerCase();

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

    if (!incomingMsg) {
      twiml.message("Halo! Ketik keluhan singkat Anda ya. Contoh: 'rpm tinggi' atau 'jedug pindah gigi'.");
      return res.type("text/xml").send(twiml.toString());
    }

    const low = incomingMsg.toLowerCase();

    // opt-out controls
    if (low === "stop" || low === "unsubscribe") {
      markOptOut(from, true);
      twiml.message("Baik. Follow-up dinonaktifkan. Jika ingin aktif lagi, ketik START.");
      return res.type("text/xml").send(twiml.toString());
    }
    if (low === "start" || low === "subscribe") {
      markOptOut(from, false);
      twiml.message("Siap. Follow-up diaktifkan kembali. Silakan ketik keluhan Anda.");
      return res.type("text/xml").send(twiml.toString());
    }

    // store to DB (for follow-up)
    const meta = guessMetaFromText(incomingMsg);
    if (from) upsertCustomer({ from, lastMsg: incomingMsg, meta });

    // reply (service.js)
    const reply = await generateReply(incomingMsg);
    twiml.message(reply);

    return res.type("text/xml").send(twiml.toString());
  } catch (err) {
    console.error("Webhook error:", err);
    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message("Maaf, sistem sedang sibuk. Silakan ketik ulang pesan Anda atau ketik *JADWAL* / *TOWING*.");
    return res.type("text/xml").send(twiml.toString());
  }
});

// CRON FOLLOW-UP (POST)
app.post("/cron/followup", async (req, res) => {
  try {
    if (req.query.key !== process.env.CRON_KEY) return res.status(403).send("Forbidden");
    if (process.env.FOLLOWUP_ENABLED !== "true") return res.send("Follow-up disabled");

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromBot = process.env.TWILIO_WHATSAPP_FROM; // "whatsapp:+..."

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

    return res.send(`Follow-up sent: ${sent}`);
  } catch (e) {
    console.error("cron/followup error:", e);
    return res.status(500).send("Error");
  }
});

// =====================
// START
// =====================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
