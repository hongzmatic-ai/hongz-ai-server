"use strict";

const express = require("express");
const twilio = require("twilio");
const { twiml } = require("twilio");
const OpenAI = require("openai");
const { google } = require("googleapis");

const app = express();
app.use(express.urlencoded({ extended: false }));

// ============ ENV ============
const PORT = process.env.PORT || 10000;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

// Business
const BIZ_NAME = process.env.BIZ_NAME || "Hongz Bengkel Spesialis Transmisi Matic";
const BIZ_ADDRESS =
  process.env.BIZ_ADDRESS ||
  "Jl. M. Yakub No.10b, Sei Kera Hilir I, Kec. Medan Perjuangan, Kota Medan, Sumatera Utara 20233";
const BIZ_HOURS = process.env.BIZ_HOURS || "Senin–Sabtu 09.00–17.00";
const MAPS_LINK = process.env.MAPS_LINK || "https://hongzmatic.com/maps";

// Booking to Google Sheets
const SHEET_ID = process.env.SHEET_ID; // required for booking
const SHEET_TAB = process.env.SHEET_TAB || "Bookings"; // default tab name
// Store service account JSON in env as BASE64 to avoid formatting issues
const GOOGLE_SA_JSON_B64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_B64;

// Optional admin WA for handoff (NOT required for sheet)
const ADMIN_WA = process.env.ADMIN_WA || ""; // +62...

if (!OPENAI_API_KEY) console.warn("⚠️ Missing OPENAI_API_KEY");
if (!SHEET_ID) console.warn("⚠️ Missing SHEET_ID (Google Sheets booking won't work)");
if (!GOOGLE_SA_JSON_B64) console.warn("⚠️ Missing GOOGLE_SERVICE_ACCOUNT_JSON_B64 (Google Sheets booking won't work)");

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// ============ Google Sheets Client ============
function getServiceAccount() {
  if (!GOOGLE_SA_JSON_B64) return null;
  try {
    const jsonStr = Buffer.from(GOOGLE_SA_JSON_B64, "base64").toString("utf8");
    return JSON.parse(jsonStr);
  } catch (e) {
    console.error("❌ Service account JSON decode error:", e?.message || e);
    return null;
  }
}

async function appendBookingRow(rowValues) {
  if (!SHEET_ID) throw new Error("SHEET_ID missing");
  const sa = getServiceAccount();
  if (!sa) throw new Error("Service account missing/invalid");

  const auth = new google.auth.JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const sheets = google.sheets({ version: "v4", auth });

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_TAB}!A:Z`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [rowValues] },
  });
}

// ============ Utility ============
function norm(s = "") {
  return String(s).trim();
}
function low(s = "") {
  return norm(s).toLowerCase();
}
function hasAny(text, arr) {
  const t = low(text);
  return arr.some((w) => t.includes(w));
}

function nowISO() {
  return new Date().toISOString();
}

// ============ Detection: Vehicle Level ============
function getVehicleLevel(text) {
  const t = low(text);

  // 🔴 PREMIUM / LUXURY
  if (
    /(land cruiser|lc\s?200|lc\s?300|alphard|vellfire|lexus|bmw|mercedes|mercy|benz|audi|porsche|range rover|land rover|jaguar|maserati|bentley|rolls|volvo xc|mini cooper)/.test(
      t
    )
  ) {
    return "PREMIUM";
  }

  // 🟡 COMPLEX (modern CVT, turbo, SUV modern, etc.)
  if (
    /(x-trail|xtrail|t32|cr-v|crv|pajero|fortuner|cx-5|cx5|turbo|hybrid|phev|ev|cvt|dsg|dct|amt|ags|camry|harrier|teana|outlander)/.test(
      t
    )
  ) {
    return "COMPLEX";
  }

  return "STANDARD";
}

function detectTransmissionType(text) {
  const t = low(text);
  if (/(dsg|dct|dual clutch|dual-clutch)/.test(t)) return "DCT/DSG";
  if (/(amt|ags)/.test(t)) return "AMT/AGS";
  if (/(cvt)/.test(t)) return "CVT";
  if (/(at|a\/t|torque converter)/.test(t)) return "AT";
  return "UNKNOWN";
}

function extractYear(text) {
  const m = low(text).match(/\b(19\d{2}|20\d{2})\b/);
  return m ? m[1] : "";
}

function extractOdometerKm(text) {
  const t = low(text).replaceAll(".", "").replaceAll(",", "");
  let m = t.match(/(\d{2,3})\s*(rb|ribu)\b/);
  if (m) return parseInt(m[1], 10) * 1000;

  m = t.match(/(\d{2,3})\s*k\b/);
  if (m) return parseInt(m[1], 10) * 1000;

  m = t.match(/\b(\d{5,6})\b/);
  if (m) return parseInt(m[1], 10);

  return null;
}

function detectNegotiation(text) {
  return /(diskon|nego|murahin|kurangin|harga teman|kemahalan|paling murah|bengkel lain cuma|katanya cuma)/i.test(
    text
  );
}

function detectPriceTrap(text) {
  return /(fix berapa|pasti berapa|max|maksimal|paling mahal|garansi harga|janji segini)/i.test(text);
}

function detectBookingIntent(text) {
  return /(booking|boking|jadwal|reservasi|daftar|antri|antrian|datang jam|kapan bisa|slot|schedule)/i.test(text);
}

function detectLocationIntent(text) {
  return /(lokasi|alamat|maps|peta|rute|arah|share lokasi)/i.test(text);
}

// Heavy / towing triggers
function detectHeavy(text) {
  const t = low(text);
  return hasAny(t, [
    "tidak bisa jalan",
    "gak bisa jalan",
    "nggak bisa jalan",
    "mogok",
    "mati total",
    "rpm naik tapi tidak jalan",
    "rpm naik tidak gerak",
    "tidak bergerak",
    "tidak mau masuk d",
    "tidak mau masuk r",
    "d tidak jalan",
    "r tidak jalan",
    "selip parah",
    "overheat",
    "panas lalu mati",
    "berhenti mendadak",
    "limp mode",
    "transmission fault",
  ]);
}

// Emotional Reading: serious vs iseng
function emotionalReading(text) {
  const t = low(text);
  let score = 50;

  if (t.length < 8) score -= 15;
  if (detectNegotiation(text)) score -= 15;
  if (detectHeavy(text)) score += 20;
  if (detectBookingIntent(text)) score += 10;

  if (/(tahun|tipe|km|odo|gejala|indikator|scan|error|kode|tcm|ecu|aki|alternator)/.test(t)) score += 15;

  score = Math.max(0, Math.min(100, score));

  return {
    seriousnessScore: score,
    seriousnessLabel: score >= 70 ? "SERIOUS" : score >= 45 ? "NEUTRAL" : "CASUAL",
  };
}

// Urgency score 1–10
function urgencyScore(text) {
  const t = low(text);
  let u = 1;

  if (/(hari ini|sekarang|urgent|darurat|cepat|segera)/.test(t)) u += 2;
  if (detectHeavy(text)) u += 5;
  if (/(overheat|panas|bau gosong|asap|indikator menyala|check engine)/.test(t)) u += 2;

  // cap 10
  u = Math.max(1, Math.min(10, u));
  return u;
}

// Lead Tier A/B/C (prioritas)
function leadTier({ vehicleLevel, urgent, seriousScore }) {
  let s = 0;
  if (vehicleLevel === "PREMIUM") s += 40;
  else if (vehicleLevel === "COMPLEX") s += 20;
  else s += 10;

  if (urgent >= 8) s += 25;
  else if (urgent >= 5) s += 15;

  if (seriousScore >= 70) s += 15;
  else if (seriousScore >= 45) s += 8;

  if (s >= 70) return "A";
  if (s >= 45) return "B";
  return "C";
}

// Controlled slot suggestion (psychological closing)
function proposeSlots(urgent) {
  // simple deterministic slots
  if (urgent >= 8) return "Kami siapkan slot prioritas: *10.00* atau *14.00* hari ini. Pilih salah satu ya.";
  if (urgent >= 5) return "Slot inspeksi tersedia: *11.00* atau *15.00*. Pilih yang cocok ya.";
  return "Boleh info rencana datang hari & jam berapa?";
}

// ============ Booking Extraction ============
function extractName(text) {
  const t = norm(text);
  // very lightweight: if user says "nama saya X"
  const m = t.match(/nama\s*(saya)?\s*[:\-]?\s*([A-Za-zÀ-ÖØ-öø-ÿ\s]{2,40})/i);
  return m ? m[2].trim() : "";
}

function extractCarModel(text) {
  // We keep it simple: ask user if not present
  // If user includes common model words, capture line
  const t = norm(text);
  const m = t.match(/(toyota|honda|nissan|mitsubishi|suzuki|daihatsu|bmw|mercedes|audi|lexus|kia|hyundai|wuling|mazda)\s+([A-Za-z0-9\- ]{2,30})/i);
  if (!m) return "";
  return `${m[1]} ${m[2]}`.replace(/\s+/g, " ").trim();
}

function extractArea(text) {
  const t = norm(text);
  // if user writes "di medan", "di amplas", etc. keep it as free text
  const m = t.match(/\b(di|area|lokasi)\s+([A-Za-z0-9\- ]{3,40})/i);
  return m ? m[2].trim() : "";
}

function needsBookingFields(b) {
  // minimal fields to append booking row
  const missing = [];
  if (!b.name) missing.push("Nama");
  if (!b.car) missing.push("Mobil + Tahun");
  if (!b.complaint) missing.push("Keluhan");
  if (!b.when) missing.push("Rencana datang (hari/jam)");
  return missing;
}

// ============ Prompt ============
function buildSystemPrompt(meta) {
  return `
Kamu adalah Hongz AI v4.0 untuk ${BIZ_NAME}.
Gaya: HIGH AUTHORITY, premium, elegan, tegas, ringkas (maks 5 kalimat + CTA).
Aturan:
- Jangan pernah memberi batas harga maksimal. Hindari angka murah yang bisa menjebak.
- Jelaskan kausalitas: transmisi matic terkait kelistrikan/ECU/TCM/BCM/sensor/alternator/aki/engine.
- Jika URGENT tinggi atau kendaraan tidak bisa jalan: aktifkan TOWING/EVAKUASI, minta lokasi, arahkan ke workshop.
- Jika pelanggan menawar: aktifkan anti-negosiasi (fokus hasil & diagnosa).
- Tujuan akhir: booking inspeksi / datang ke workshop / towing.
Meta:
${JSON.stringify(meta)}
`.trim();
}

async function replyWithAI(userText, meta, guardrailDraft) {
  // AI only polishes + adds questions; guardrailDraft is the controlled stance.
  try {
    const resp = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      temperature: 0.35,
      max_tokens: 260,
      messages: [
        { role: "system", content: buildSystemPrompt(meta) },
        {
          role: "user",
          content:
            `Pesan pelanggan: "${userText}"\n\n` +
            `Draft jawaban (jangan ubah makna, rapikan jadi tajam & singkat):\n${guardrailDraft}`,
        },
      ],
    });

    const out = resp.choices?.[0]?.message?.content?.trim();
    return out || guardrailDraft;
  } catch (e) {
    return guardrailDraft;
  }
}

// ============ Templates (Controlled) ============
function tplLocation() {
  return `📍 ${BIZ_NAME}\n${BIZ_ADDRESS}\n⏰ ${BIZ_HOURS}\n🗺️ Rute: ${MAPS_LINK}\n\nBalas: *OTW* jika langsung datang, atau ketik *towing* jika butuh evakuasi.`;
}

function tplAntiNego() {
  return `Kami paham soal biaya.\nNamun untuk transmisi matic, fokus kami *hasil yang tepat & tahan lama*, bukan perang harga.\nEstimasi final hanya setelah diagnosa agar akurat dan adil.\n\nMau kami jadwalkan inspeksi? ${MAPS_LINK}`;
}

function tplTowing(meta) {
  return `⚠️ Kondisi ini termasuk serius dan *jangan dipaksakan jalan*.\nPada unit modern/premium, gangguan bisa terkait transmisi + kelistrikan/ECU/TCM/sensor/charging.\n\n📍 Arahkan unit ke workshop:\n${MAPS_LINK}\n\n${proposeSlots(meta.urgency)}\nJika tidak bisa jalan, kami bisa bantu koordinasi towing. Kirim lokasi Anda (share lokasi/area).`;
}

function tplRevenueStance(meta) {
  // no ceiling numbers; allow "belasan–puluhan juta" only for heavy/premium
  if (meta.heavy || meta.urgency >= 8 || meta.vehicleLevel === "PREMIUM") {
    return `Untuk kendaraan ${meta.vehicleLevel === "PREMIUM" ? "premium" : "dengan gejala berat"}, kami tidak mengunci angka di chat.\nKarena pada sistem matic modern, penyebab bisa melibatkan modul kontrol/kelistrikan hingga internal transmisi.\nPada kasus berat, biayanya bisa *belasan hingga puluhan juta* tergantung temuan & sparepart.\n\nSaran kami: diagnosa menyeluruh dulu agar solusi *tuntas*, bukan setengah-setengah.`;
  }
  return `Estimasi yang akurat baru bisa keluar setelah diagnosa (scan, cek kelistrikan, evaluasi sistem transmisi).\nKalau Anda kirim detail mobil & gejala, kami arahkan langkah yang tepat dan rencana inspeksi.`;
}

function tplPremiumPriority(meta) {
  if (meta.leadTier === "A") {
    return `✅ Unit prioritas tinggi. ${proposeSlots(meta.urgency)}\nUntuk menjaga nilai unit, kami sarankan inspeksi langsung di workshop.`;
  }
  if (meta.vehicleLevel === "PREMIUM") {
    return `Untuk unit premium, kami sarankan inspeksi langsung agar keputusan perbaikan tepat dan menjaga nilai kendaraan.\n${proposeSlots(meta.urgency)}`;
  }
  return proposeSlots(meta.urgency);
}

// ============ Main Webhook ============
app.get("/", (req, res) => res.status(200).send("Hongz AI Engine v4.0 running 🚀"));

app.post("/webhook", async (req, res) => {
  const resp = new twiml.MessagingResponse();

  const from = req.body.From || "";
  const msg = norm(req.body.Body || "");

  if (!msg) {
    resp.message(`Halo 👋 Tulis keluhan mobilnya ya.\nContoh: "X-Trail T32 CVT nyentak saat panas"`);
    return res.type("text/xml").send(resp.toString());
  }

  // Fast location template
  if (detectLocationIntent(msg)) {
    resp.message(tplLocation());
    return res.type("text/xml").send(resp.toString());
  }

  const emo = emotionalReading(msg);
  const urg = urgencyScore(msg);

  const vehicleLevel = getVehicleLevel(msg);
  const transType = detectTransmissionType(msg);
  const year = extractYear(msg);
  const km = extractOdometerKm(msg);

  const heavy = detectHeavy(msg);
  const nego = detectNegotiation(msg);
  const trap = detectPriceTrap(msg);
  const bookingIntent = detectBookingIntent(msg);

  const tier = leadTier({ vehicleLevel, urgent: urg, seriousScore: emo.seriousnessScore });

  const meta = {
    from,
    vehicleLevel,
    transmissionType: transType,
    year: year || "unknown",
    odometerKm: km ?? "unknown",
    heavy,
    urgency: urg,
    seriousness: emo,
    leadTier: tier,
  };

  // Anti-negotiation hard template
  if (nego && !heavy) {
    resp.message(tplAntiNego());
    return res.type("text/xml").send(resp.toString());
  }

  // Auto towing for heavy/urgent
  if (heavy || urg >= 8) {
    resp.message(tplTowing(meta));
    return res.type("text/xml").send(resp.toString());
  }

  // Booking flow (to Google Sheet)
  // If user is trying to book, ask for format, or append if complete.
  if (bookingIntent) {
    // Try extract minimal fields from the message (light)
    const b = {
      name: extractName(msg),
      car: extractCarModel(msg) || (vehicleLevel ? `${vehicleLevel} unit` : ""),
      complaint: msg, // keep original as complaint text
      when: "", // ask if not present
      area: extractArea(msg),
      phone: from,
    };

    // If user already wrote "besok jam 10" etc.
    const whenMatch = msg.match(/(hari ini|besok|lusa|senin|selasa|rabu|kamis|jumat|sabtu|minggu)\s*(jam\s*\d{1,2}(\.\d{2})?)?/i);
    if (whenMatch) b.when = whenMatch[0];

    const missing = needsBookingFields(b);

    if (missing.length) {
      resp.message(
        `Baik. Untuk booking, mohon kirim format ini:\n` +
          `Nama:\nMobil+Tahun:\nKeluhan:\nRencana datang (hari/jam):\n\n` +
          `📍 Lokasi bengkel: ${MAPS_LINK}`
      );
      return res.type("text/xml").send(resp.toString());
    }

    // Append to Sheet
    try {
      const row = [
        nowISO(),
        from,
        b.name,
        b.car,
        year || "",
        transType,
        km ?? "",
        vehicleLevel,
        `Urgency:${urg} Tier:${tier}`,
        b.area || "",
        b.when,
        b.complaint,
        ADMIN_WA ? "Admin WA set" : "",
      ];

      await appendBookingRow(row);

      resp.message(
        `✅ Booking tercatat.\n` +
          `${tier === "A" ? "Kami siapkan slot prioritas. " : ""}` +
          `${proposeSlots(urg)}\n\n` +
          `📍 ${BIZ_NAME}\n🗺️ ${MAPS_LINK}`
      );
      return res.type("text/xml").send(resp.toString());
    } catch (e) {
      console.error("Sheet append error:", e?.message || e);
      resp.message(
        `Booking belum bisa disimpan otomatis (sistem sheet). Tapi tidak masalah—silakan kirim:\n` +
          `Nama, Mobil+Tahun, Keluhan, Rencana datang (hari/jam).\n\n` +
          `📍 Lokasi: ${MAPS_LINK}`
      );
      return res.type("text/xml").send(resp.toString());
    }
  }

  // General AI response with guardrails + auto closing
  const guardrailDraft =
    `${tplRevenueStance(meta)}\n\n` +
    `${tplPremiumPriority(meta)}\n\n` +
    `📍 ${BIZ_NAME}\n🗺️ ${MAPS_LINK}\n⏰ ${BIZ_HOURS}\n\n` +
    `Balas singkat ya:\n1) Mobil & tahun\n2) Gejala utama\n3) Kapan mulai terasa (saat panas/dingin)?`;

  const finalReply = await replyWithAI(msg, meta, guardrailDraft);
  resp.message(finalReply);

  return res.type("text/xml").send(resp.toString());
});

app.listen(PORT, () => console.log(`Hongz AI Engine v4.0 listening on ${PORT}`));
