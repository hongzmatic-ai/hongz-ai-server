// service.js
// =====================================================
// HONGZ AI ENGINE v5.7-MATURE (NO %%% LINKS)
// - Anti-bisu: semua jalur selalu return pesan
// - OpenAI timeout + fallback otomatis
// - Input normalization anti copy-paste "1." dst
// - Footer brand mature (WA link polos tanpa ?text=... jadi tidak ada %20/%0A)
// =====================================================

const OpenAI = require("openai");

// =====================
// OFFICIAL (LOCKED)
// =====================
const OFFICIAL = {
  name: "Hongz Bengkel – Spesialis Transmisi Matic",
  address: "Jl. M. Yakub No.10b, Medan Perjuangan",
  maps: "https://maps.app.goo.gl/CvFZ9FLNJRog7K4t9",
  hours: "Senin–Sabtu 09.00–17.00",

  waAdmin: process.env.WA_ADMIN || "6281375430728",   // Papa (utama)
  waCS: process.env.WA_CS || "6285752965167",         // CS (opsional)
  waTowing: process.env.WA_TOWING || "6281375430728", // towing line
};

// =====================
// ENV / TUNING
// =====================
const DEBUG = (process.env.DEBUG || "false").toLowerCase() === "true";
const OPENAI_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS || 9000); // 9s
const MAX_USER_FOR_AI = Number(process.env.MAX_USER_FOR_AI || 700);
const MAX_RETURN_CHARS = 900;

function dlog(...args) {
  if (DEBUG) console.log("[HONGZ v5.7-MATURE]", ...args);
}

function cleanMsisdn(msisdn) {
  return String(msisdn || "").replace(/[^\d]/g, "");
}

function waBaseLink(msisdn) {
  const n = cleanMsisdn(msisdn);
  return n ? `https://wa.me/${n}` : "";
}

// =====================
// INPUT NORMALIZATION
// =====================
function norm(s = "") {
  return String(s).toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizeUserText(raw = "") {
  let t = String(raw || "").replace(/\r/g, "").trim();

  // buang numbering awal dari copy paste chat: "1. xxx" / "1 xxx"
  t = t.replace(/^\s*\d+\s*[\.\)]\s*/g, "");
  t = t.replace(/^\s*\d+\s+/g, "");

  t = t.replace(/\s+/g, " ").trim();
  return t;
}

function truncateForAI(text) {
  const t = String(text || "");
  if (t.length <= MAX_USER_FOR_AI) return t;
  return t.slice(0, MAX_USER_FOR_AI).trim() + "…";
}

// =====================
// FOOTER (BRAND MATURE) - NO AUTOFILL
// =====================
function footerCTA() {
  const admin = waBaseLink(OFFICIAL.waAdmin);
  const cs = waBaseLink(OFFICIAL.waCS);
  const tow = waBaseLink(OFFICIAL.waTowing);

  const lines = [
    `📍 ${OFFICIAL.name}`,
    OFFICIAL.address,
    `🧭 ${OFFICIAL.maps}`,
    `⏱ ${OFFICIAL.hours}`,
    "",
  ];

  if (admin) lines.push(`📲 Admin: ${admin}`);
  if (cs && cleanMsisdn(OFFICIAL.waCS) !== cleanMsisdn(OFFICIAL.waAdmin)) lines.push(`💬 CS: ${cs}`);
  if (tow && cleanMsisdn(OFFICIAL.waTowing) !== cleanMsisdn(OFFICIAL.waAdmin)) lines.push(`🚚 Towing: ${tow}`);

  return lines.join("\n");
}

// =====================
// BLOCKS
// =====================
function professionalPriceStatement() {
  return [
    "Kami bekerja berbasis diagnosa, bukan asumsi.",
    "Estimasi tanpa pemeriksaan berisiko tidak akurat.",
    "Agar tepat & aman, unit perlu kami cek dulu (scan/tes jalan/cek tekanan/cek kebocoran).",
  ].join("\n");
}

function towingBlock() {
  return [
    "Jika unit tidak bisa berjalan / terasa berisiko, sebaiknya jangan dipaksakan.",
    "Jika perlu, gunakan towing untuk mencegah kerusakan melebar.",
  ].join("\n");
}

// =====================
// DETECTION
// =====================
function containsAny(text, arr) {
  const t = norm(text);
  return arr.some((k) => t.includes(k));
}

function detectUrgency(text) {
  const urgent = [
    "tidak bisa jalan", "gak bisa jalan", "mogok", "tidak bergerak",
    "overheat", "masuk d tapi tidak jalan", "masuk r tapi tidak jalan",
    "selip parah", "rpm naik tapi tidak jalan"
  ];
  return containsAny(text, urgent);
}

function isPriceFocus(text) {
  const bait = ["berapa", "biaya", "harga", "range", "kisaran", "termurah", "murah", "nego", "diskon", "patokan", "budget"];
  return containsAny(text, bait);
}

function detectTopic(text) {
  const trans = [
    "matic", "transmisi", "cvt", "at", "gear", "gigi", "pindah gigi", "selip", "jedug",
    "rpm tinggi", "gaung", "dengung", "torque converter", "valve body", "solenoid"
  ];
  const ac = ["ac", "aircond", "air conditioner", "tidak dingin", "kurang dingin", "freon", "kompresor", "evaporator"];
  if (containsAny(text, ac)) return "AC";
  if (containsAny(text, trans)) return "TRANSMISSION";
  return "GENERAL";
}

// =====================
// SANITIZE AI OUTPUT
// =====================
function sanitizeAI(text = "") {
  let t = String(text || "").replace(/\r/g, "").trim();
  if (!t) return "";

  // batasi panjang
  if (t.length > MAX_RETURN_CHARS) t = t.slice(0, MAX_RETURN_CHARS).trim();

  // max 2 tanda tanya
  const qCount = (t.match(/\?/g) || []).length;
  if (qCount > 2) {
    let count = 0;
    let out = "";
    for (const ch of t) {
      out += ch;
      if (ch === "?") {
        count++;
        if (count === 2) break;
      }
    }
    t = out.trim();
  }

  return t;
}

// =====================
// SYSTEM PROMPT
// =====================
function buildSystemPrompt({ urgency, priceFocus, topic }) {
  const priority = urgency
    ? "Prioritas keselamatan: sarankan jangan dipaksakan + opsi towing."
    : "Arahkan langkah cek paling efisien.";

  const priceRule = priceFocus
    ? "Jika ditanya biaya/harga: jangan beri angka fix. Tekankan diagnosa dulu secara profesional."
    : "Jangan membuka angka tanpa pemeriksaan.";

  const topicRule =
    topic === "AC"
      ? "Topik AC: sebut kemungkinan penyebab umum singkat, arahkan cek tekanan/kompresor/kebocoran, ajak datang."
      : topic === "TRANSMISSION"
      ? "Topik transmisi: sebut kemungkinan penyebab umum singkat (slip/tekanan oli/solenoid/ATF), ajak datang."
      : "Topik umum: jawab ringkas, ajak inspeksi.";

  return `
Anda adalah CS WhatsApp profesional untuk Hongz Bengkel di Medan.
Gaya: tenang, jelas, profesional. Tidak menakutkan.

ATURAN WAJIB:
- Maksimal 2 pertanyaan.
- Jangan beri angka harga fix.
- ${priceRule}
- ${priority}
- ${topicRule}

OUTPUT:
- 1 pesan WhatsApp ringkas (<=900 karakter).
- Jika perlu: maks 2 pertanyaan triase.
`.trim();
}

// =====================
// TIMEOUT HELPER
// =====================
function withTimeout(promise, ms, label = "timeout") {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(label)), ms)),
  ]);
}

// =====================
// AI REPLY (ANTI BISU)
// =====================
async function aiReply(userTextOriginal, meta) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const userTextForAI = truncateForAI(userTextOriginal);

  try {
    if (!apiKey) throw new Error("No API Key");

    const client = new OpenAI({ apiKey });

    dlog("OpenAI call", { model, timeout: OPENAI_TIMEOUT_MS, meta });

    const resp = await withTimeout(
      client.chat.completions.create({
        model,
        temperature: 0.35,
        messages: [
          { role: "system", content: buildSystemPrompt(meta) },
          { role: "user", content: `Pelanggan: "${userTextForAI}"` },
        ],
      }),
      OPENAI_TIMEOUT_MS,
      "OPENAI_TIMEOUT"
    );

    let text = resp.choices?.[0]?.message?.content?.trim() || "";
    text = sanitizeAI(text);

    if (!text) {
      text = "Baik. Agar cepat tepat, mohon info 2 hal: gejala muncul saat dingin atau saat panas? ada jedug/selip?";
      text = sanitizeAI(text);
    }

    const tail = [];
    if (meta.urgency) tail.push(towingBlock());
    if (meta.priceFocus) tail.push(professionalPriceStatement());
    tail.push(footerCTA());

    return [text, ...tail].join("\n\n");
  } catch (err) {
    console.log("[HONGZ v5.7-MATURE] OPENAI ERROR:", err?.message || err);

    const fallback = [];

    if (meta.topic === "AC") {
      fallback.push(
        "Baik. AC tidak dingin biasanya karena freon kurang/kebocoran, kompresor melemah, kipas kondensor, atau evaporator kotor. Agar akurat, perlu cek tekanan & inspeksi kebocoran."
      );
    } else if (meta.topic === "TRANSMISSION") {
      fallback.push(
        "Baik. Gejala rpm tinggi/baru masuk gigi bisa terkait slip, tekanan oli transmisi, solenoid/valve body, atau kondisi ATF. Agar tidak salah arah, perlu pengecekan langsung."
      );
    } else {
      fallback.push("Baik. Untuk memastikan penyebabnya, unit perlu kami cek langsung.");
    }

    if (meta.urgency) fallback.push("\n" + towingBlock());
    if (meta.priceFocus) fallback.push("\n" + professionalPriceStatement());
    fallback.push("\n" + footerCTA());

    return fallback.join("\n");
  }
}

// =====================
// MAIN ENTRY (SAFETY WRAPPER)
// =====================
async function generateReply(userTextRaw) {
  const userText = normalizeUserText(userTextRaw);
  const t = norm(userText);

  try {
    // Commands (simple)
    if (t === "jadwal") {
      return [
        "Silakan kirim format:",
        "NAMA / MOBIL / TAHUN / GEJALA / JAM DATANG",
        "",
        footerCTA(),
      ].join("\n");
    }

    if (t === "admin") {
      return [
        "Siap. Silakan hubungi Admin di link ini:",
        waBaseLink(OFFICIAL.waAdmin),
        "",
        footerCTA(),
      ].join("\n");
    }

    if (t === "cs") {
      return [
        "Siap. Silakan hubungi CS di link ini:",
        waBaseLink(OFFICIAL.waCS),
        "",
        footerCTA(),
      ].join("\n");
    }

    if (t.includes("towing") || t.includes("derek")) {
      return [
        towingBlock(),
        "",
        "Towing line:",
        waBaseLink(OFFICIAL.waTowing),
        "",
        footerCTA(),
      ].join("\n");
    }

    if (t.includes("lokasi") || t.includes("share lokasi")) {
      return [
        "Lokasi workshop Hongz:",
        OFFICIAL.maps,
        "",
        footerCTA(),
      ].join("\n");
    }

    // Meta detection
    const urgency = detectUrgency(userText);
    const priceFocus = isPriceFocus(userText);
    const topic = detectTopic(userText);

    const meta = { urgency, priceFocus, topic };

    // Price-focus quick lane (fast)
    if (priceFocus) {
      return [
        professionalPriceStatement(),
        "",
        "Agar cepat tepat, sebaiknya unit kami cek langsung.",
        "Jika unit tidak memungkinkan berjalan, towing adalah opsi paling aman.",
        "",
        footerCTA(),
      ].join("\n");
    }

    // AI adaptive
    return await aiReply(userText, meta);
  } catch (err) {
    console.log("[HONGZ v5.7-MATURE] FATAL generateReply ERROR:", err?.message || err);

    // ultimate fallback (tidak boleh bisu)
    return [
      "Maaf, sistem sedang padat. Tapi kami tetap siap bantu.",
      "Silakan ketik *JADWAL* untuk booking, atau ketik *ADMIN* untuk hubungi Admin.",
      "",
      footerCTA(),
    ].join("\n");
  }
}

module.exports = { generateReply };
