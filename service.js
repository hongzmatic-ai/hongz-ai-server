// service.js
// =====================================================
// HONGZ AI ENGINE v5.7.1 – ZERO SILENT FAILURE (PATCH)
// - Anti-bisu: semua jalur wajib selalu return pesan (try/catch di AI + generateReply)
// - Timeout OpenAI (default 9 detik) + fallback otomatis
// - Input normalisasi: buang spam "1." / rapikan spasi / trim
// - Batasi prompt ke AI (agar tidak timeout)
// - PATCH 5.7.1:
//   1) Auto-fill wa.me?text= dipendekkan (hindari URL kepanjangan -> WhatsApp/Twilio gagal kirim)
//   2) Output total (AI + tail + footer) dibatasi (hindari payload terlalu panjang)
// - Max 2 pertanyaan, tone tenang-profesional, no alamat manual dari AI
// - Footer selalu ON + auto-fill wa.me
// =====================================================

const OpenAI = require("openai");

// =====================
// OFFICIAL (LOCKED)
// =====================
const OFFICIAL = {
  name: "Hongz Bengkel Spesialis Transmisi Matic",
  address: "Jl. M. Yakub No.10b, Medan Perjuangan",
  maps: "https://maps.app.goo.gl/CvFZ9FLNJRog7K4t9",
  hours: "Senin–Sabtu 09.00–17.00",

  // WA numbers via ENV (recommended)
  waAdmin: process.env.WA_ADMIN || "6281375430728",     // hongz (utama)
  waCS: process.env.WA_CS || "6285752965167",           // CS (opsional)
  waTowing: process.env.WA_TOWING || "6281375430728",   // towing line

  // Auto handoff thresholds
  handoffEnabled: (process.env.HANDOFF_ENABLED || "true").toLowerCase() === "true",
  handoffSerious: (process.env.HANDOFF_SERIOUS || "true").toLowerCase() === "true",
  handoffUrgent: (process.env.HANDOFF_URGENT || "true").toLowerCase() === "true",
  handoffPremium: (process.env.HANDOFF_PREMIUM || "true").toLowerCase() === "true",
};

// =====================
// ENV / TUNING
// =====================
const DEBUG = (process.env.DEBUG || "false").toLowerCase() === "true";
const OPENAI_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS || 9000); // 9s
const MAX_USER_FOR_AI = Number(process.env.MAX_USER_FOR_AI || 700);      // max chars sent to AI
const MAX_RETURN_CHARS = 900;                                            // sanitize cap for AI portion
const MAX_TOTAL_OUT_CHARS = Number(process.env.MAX_TOTAL_OUT_CHARS || 1500); // cap overall reply (AI+tail+footer)
const MAX_LINK_TEXT_CHARS = Number(process.env.MAX_LINK_TEXT_CHARS || 180);  // cap text embedded in wa.me links

function dlog(...args) {
  if (DEBUG) console.log("[HONGZ v5.7.1]", ...args);
}

function cleanMsisdn(msisdn) {
  return String(msisdn || "").replace(/[^\d]/g, "");
}

function waLink(msisdn, text = "") {
  const n = cleanMsisdn(msisdn);
  if (!n) return "";
  if (!text) return `https://wa.me/${n}`;
  const encoded = encodeURIComponent(text);
  return `https://wa.me/${n}?text=${encoded}`;
}

// =====================
// INPUT NORMALIZATION (v5.7)
// =====================
function norm(s = "") {
  return String(s).toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizeUserText(raw = "") {
  let t = String(raw || "").replace(/\r/g, "").trim();

  // buang numbering di awal yang sering dari copy-paste chat
  // contoh: "1. Innova 2008..." atau "1 Innova 2008..."
  t = t.replace(/^\s*\d+\s*[\.\)]\s*/g, "");
  t = t.replace(/^\s*\d+\s+/g, "");

  // rapikan spasi
  t = t.replace(/\s+/g, " ").trim();
  return t;
}

function truncateForAI(text) {
  const t = String(text || "");
  if (t.length <= MAX_USER_FOR_AI) return t;
  return t.slice(0, MAX_USER_FOR_AI).trim() + "…";
}

// =====================
// PATCH 5.7.1: SHORT TEXT FOR WA.ME LINKS (ANTI URL KEPANJANGAN)
// =====================
function shortForLink(text, max = MAX_LINK_TEXT_CHARS) {
  let t = String(text || "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return t.slice(0, max).trim() + "…";
}

// =====================
// AUTO-FILL TEMPLATES
// =====================
function templateAdmin(userText, meta) {
  const flags = [];
  if (meta?.tier) flags.push(`TIER:${meta.tier}`);
  if (meta?.urgency) flags.push("URGENT");
  if (meta?.emotion) flags.push(`EMO:${meta.emotion}`);
  if (meta?.priceFocus) flags.push("PRICE_Q");
  if (meta?.topic) flags.push(`TOPIC:${meta.topic}`);

  return [
    "Halo Admin Hongz, saya butuh bantuan.",
    `Keluhan: ${shortForLink(String(userText || "").trim(), MAX_LINK_TEXT_CHARS)}`,
    `Catatan sistem: ${flags.join(" | ") || "-"}`,
    "",
    "Saya siap kirim detail:",
    "- Nama:",
    "- Mobil/Tahun:",
    "- Lokasi sekarang (share lokasi):",
    "- Bisa jalan atau perlu towing:",
  ].join("\n");
}

function templateTowing(userText) {
  return [
    "Halo tim TOWING Hongz, saya butuh evakuasi.",
    `Keluhan: ${shortForLink(String(userText || "").trim(), MAX_LINK_TEXT_CHARS)}`,
    "",
    "Saya kirim share lokasi sekarang. Mohon arahkan proses towing ke Hongz.",
  ].join("\n");
}

function templateCS(userText) {
  return [
    "Halo CS Hongz, saya mau konsultasi & booking.",
    `Keluhan: ${shortForLink(String(userText || "").trim(), MAX_LINK_TEXT_CHARS)}`,
    "",
    "Saya kirim detail:",
    "- Nama:",
    "- Mobil/Tahun:",
    "- Gejala (dingin/panas/macet):",
    "- Waktu rencana datang:",
  ].join("\n");
}

// =====================
// FOOTER (ALWAYS ON) + AUTO-FILL LINKS
// =====================
function footerCTA(userText = "", meta = {}) {
// service.js
// =====================================================
// HONGZ AI ENGINE v5.7.1 – ZERO SILENT FAILURE (PATCH)
// - Anti-bisu: semua jalur wajib selalu return pesan (try/catch di AI + generateReply)
// - Timeout OpenAI (default 9 detik) + fallback otomatis
// - Input normalisasi: buang spam "1." / rapikan spasi / trim
// - Batasi prompt ke AI (agar tidak timeout)
// - PATCH 5.7.1:
//   1) Auto-fill wa.me?text= dipendekkan (hindari URL kepanjangan -> WhatsApp/Twilio gagal kirim)
//   2) Output total (AI + tail + footer) dibatasi (hindari payload terlalu panjang)
// - Max 2 pertanyaan, tone tenang-profesional, no alamat manual dari AI
// - Footer selalu ON + auto-fill wa.me
// =====================================================

const OpenAI = require("openai");

// =====================
// OFFICIAL (LOCKED)
// =====================
const OFFICIAL = {
  name: "Hongz Bengkel Spesialis Transmisi Matic",
  address: "Jl. M. Yakub No.10b, Medan Perjuangan",
  maps: "https://maps.app.goo.gl/CvFZ9FLNJRog7K4t9",
  hours: "Senin–Sabtu 09.00–17.00",

  // WA numbers via ENV (recommended)
  waAdmin: process.env.WA_ADMIN || "6281375430728",     // hongz (utama)
  waCS: process.env.WA_CS || "6285752965167",           // CS (opsional)
  waTowing: process.env.WA_TOWING || "6281375430728",   // towing line

  // Auto handoff thresholds
  handoffEnabled: (process.env.HANDOFF_ENABLED || "true").toLowerCase() === "true",
  handoffSerious: (process.env.HANDOFF_SERIOUS || "true").toLowerCase() === "true",
  handoffUrgent: (process.env.HANDOFF_URGENT || "true").toLowerCase() === "true",
  handoffPremium: (process.env.HANDOFF_PREMIUM || "true").toLowerCase() === "true",
};

// =====================
// ENV / TUNING
// =====================
const DEBUG = (process.env.DEBUG || "false").toLowerCase() === "true";
const OPENAI_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS || 9000); // 9s
const MAX_USER_FOR_AI = Number(process.env.MAX_USER_FOR_AI || 700);      // max chars sent to AI
const MAX_RETURN_CHARS = 900;                                            // sanitize cap for AI portion
const MAX_TOTAL_OUT_CHARS = Number(process.env.MAX_TOTAL_OUT_CHARS || 1500); // cap overall reply (AI+tail+footer)
const MAX_LINK_TEXT_CHARS = Number(process.env.MAX_LINK_TEXT_CHARS || 180);  // cap text embedded in wa.me links

function dlog(...args) {
  if (DEBUG) console.log("[HONGZ v5.7.1]", ...args);
}

function cleanMsisdn(msisdn) {
  return String(msisdn || "").replace(/[^\d]/g, "");
}

function waLink(msisdn, text = "") {
  const n = cleanMsisdn(msisdn);
  if (!n) return "";
  if (!text) return `https://wa.me/${n}`;
  const encoded = encodeURIComponent(text);
  return `https://wa.me/${n}?text=${encoded}`;
}

// =====================
// INPUT NORMALIZATION (v5.7)
// =====================
function norm(s = "") {
  return String(s).toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizeUserText(raw = "") {
  let t = String(raw || "").replace(/\r/g, "").trim();

  // buang numbering di awal yang sering dari copy-paste chat
  // contoh: "1. Innova 2008..." atau "1 Innova 2008..."
  t = t.replace(/^\s*\d+\s*[\.\)]\s*/g, "");
  t = t.replace(/^\s*\d+\s+/g, "");

  // rapikan spasi
  t = t.replace(/\s+/g, " ").trim();
  return t;
}

function truncateForAI(text) {
  const t = String(text || "");
  if (t.length <= MAX_USER_FOR_AI) return t;
  return t.slice(0, MAX_USER_FOR_AI).trim() + "…";
}

// =====================
// PATCH 5.7.1: SHORT TEXT FOR WA.ME LINKS (ANTI URL KEPANJANGAN)
// =====================
function shortForLink(text, max = MAX_LINK_TEXT_CHARS) {
  let t = String(text || "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return t.slice(0, max).trim() + "…";
}

// =====================
// AUTO-FILL TEMPLATES
// =====================
function templateAdmin(userText, meta) {
  const flags = [];
  if (meta?.tier) flags.push(`TIER:${meta.tier}`);
  if (meta?.urgency) flags.push("URGENT");
  if (meta?.emotion) flags.push(`EMO:${meta.emotion}`);
  if (meta?.priceFocus) flags.push("PRICE_Q");
  if (meta?.topic) flags.push(`TOPIC:${meta.topic}`);

  return [
    "Halo Admin Hongz, saya butuh bantuan.",
    `Keluhan: ${shortForLink(String(userText || "").trim(), MAX_LINK_TEXT_CHARS)}`,
    `Catatan sistem: ${flags.join(" | ") || "-"}`,
    "",
    "Saya siap kirim detail:",
    "- Nama:",
    "- Mobil/Tahun:",
    "- Lokasi sekarang (share lokasi):",
    "- Bisa jalan atau perlu towing:",
  ].join("\n");
}

function templateTowing(userText) {
  return [
    "Halo tim TOWING Hongz, saya butuh evakuasi.",
    `Keluhan: ${shortForLink(String(userText || "").trim(), MAX_LINK_TEXT_CHARS)}`,
    "",
    "Saya kirim share lokasi sekarang. Mohon arahkan proses towing ke Hongz.",
  ].join("\n");
}

function templateCS(userText) {
  return [
    "Halo CS Hongz, saya mau konsultasi & booking.",
    `Keluhan: ${shortForLink(String(userText || "").trim(), MAX_LINK_TEXT_CHARS)}`,
    "",
    "Saya kirim detail:",
    "- Nama:",
    "- Mobil/Tahun:",
    "- Gejala (dingin/panas/macet):",
    "- Waktu rencana datang:",
  ].join("\n");
}

// =====================
// FOOTER (ALWAYS ON) + AUTO-FILL LINKS
// =====================
function footerCTA(userText = "", meta = {}) {
  const adminFilled = waLink(OFFICIAL.waAdmin, templateAdmin(userText, meta));
  const csFilled = waLink(OFFICIAL.waCS, templateCS(userText));
  const towFilled = waLink(OFFICIAL.waTowing, templateTowing(userText));

  const lines = [
    `📍 ${OFFICIAL.name}`,
    OFFICIAL.address,
    `🧭 ${OFFICIAL.maps}`,
    `⏱ ${OFFICIAL.hours}`,
  ];

  if (adminFilled) lines.push(`📲 Admin (Papa) – klik & pesan otomatis: ${adminFilled}`);

  if (
    csFilled &&
    cleanMsisdn(OFFICIAL.waCS) &&
    cleanMsisdn(OFFICIAL.waCS) !== cleanMsisdn(OFFICIAL.waAdmin)
  ) {
    lines.push(`💬 CS Cepat – klik & pesan otomatis: ${csFilled}`);
  }

  if (
    towFilled &&
    cleanMsisdn(OFFICIAL.waTowing) &&
    cleanMsisdn(OFFICIAL.waTowing) !== cleanMsisdn(OFFICIAL.waAdmin)
  ) {
    lines.push(`🚚 Towing Line – klik & pesan otomatis: ${towFilled}`);
  }

  lines.push("Ketik: *JADWAL* (booking) / *TOWING* (evakuasi) / *ADMIN* (hubungi Papa).");
  return lines.join("\n");
}

// =====================
// PROFESSIONAL PRICE STATEMENT (CALM)
// =====================
function professionalPriceStatement() {
  return [
    "Kami bekerja berbasis diagnosa, bukan asumsi.",
    "Pada sistem kendaraan modern, estimasi tanpa pemeriksaan berisiko menyesatkan.",
    "Agar akurat & aman, unit perlu kami cek dulu (scan/tes jalan/cek tekanan/cek kebocoran).",
  ].join("\n");
}

// =====================
// TOWING BLOCK
// =====================
function towingBlock() {
  return [
    "Jika unit tidak bisa berjalan / terasa berisiko, sebaiknya jangan dipaksakan.",
    "Ketik *TOWING* dan kirim share lokasi Anda — kami bantu arahkan evakuasi ke workshop.",
  ].join("\n");
}

// =====================
// HELPERS
// =====================
function containsAny(text, arr) {
  const t = norm(text);
  return arr.some((k) => t.includes(k));
}
function countMatches(text, arr) {
  const t = norm(text);
  return arr.filter((k) => t.includes(k)).length;
}

// =====================
// VEHICLE TIER
// =====================
function detectTier(text) {
  const t = norm(text);

  const premium = [
    "land cruiser", "landcruiser", "lc200", "lc300", "alphard", "vellfire", "lexus",
    "bmw", "mercedes", "benz", "audi", "porsche", "range rover", "land rover", "prado"
  ];

  const midPremium = [
    "x-trail t32", "xtrail t32", "x trail t32",
    "crv turbo", "cx-5", "cx5", "harrier", "forester", "outlander"
  ];

  if (containsAny(t, premium)) return "PREMIUM";
  if (containsAny(t, midPremium)) return "MID_PREMIUM";
  return "STANDARD";
}

// =====================
// URGENCY DETECTION
// =====================
function detectUrgency(text) {
  const t = norm(text);
  const urgent = [
    "tidak bisa jalan", "gak bisa jalan", "mogok", "tidak bergerak",
    "panas gak bisa jalan", "panas tidak bisa jalan", "overheat",
    "masuk d tapi tidak jalan", "masuk r tapi tidak jalan",
    "selip parah", "rpm naik tapi tidak jalan"
  ];
  return containsAny(t, urgent);
}

// =====================
// PRICE FOCUS DETECTION
// =====================
function isPriceFocus(text) {
  const t = norm(text);
  const bait = ["berapa", "biaya", "harga", "range", "kisaran", "termurah", "murah", "nego", "diskon", "patokan", "budget"];
  return containsAny(t, bait);
}

// =====================
// TOPIC DETECTION (v5.7)
// =====================
function detectTopic(text) {
  const t = norm(text);

  const trans = [
    "matic", "transmisi", "cvt", "at", "gear", "gigi", "pindah gigi", "selip", "jedug",
    "rpm tinggi", "gaung", "dengung", "torque converter", "torsi", "tc", "valve body", "solenoid"
  ];

  const ac = ["ac", "aircond", "air conditioner", "tidak dingin", "kurang dingin", "freon", "kompresor", "evaporator"];

  if (containsAny(t, ac)) return "AC";
  if (containsAny(t, trans)) return "TRANSMISSION";
  return "GENERAL";
}

// =====================
// EMOTIONAL READING
// =====================
function emotionalLabel(text) {
  const t = norm(text);

  const seriousSignals = [
    "hari ini", "sekarang", "darurat", "urgent", "tolong",
    "mogok", "tidak bisa jalan", "di jalan", "di tol",
    "datang", "alamat", "lokasi", "share lokasi", "rute",
    "jadwal", "booking", "towing", "derek"
  ];

  const isengSignals = ["cuma tanya", "sekedar tanya", "iseng", "test", "coba", "cek cek"];
  const priceSignals = ["murah", "termurah", "nego", "diskon", "harga", "biaya"];

  const s = countMatches(t, seriousSignals);
  const i = countMatches(t, isengSignals);
  const p = countMatches(t, priceSignals);

  if (p >= 2 && p >= s) return "PRICE_FOCUS";
  if (s >= 2 && s > p) return "SERIOUS";
  if (i >= 1 && s === 0) return "CASUAL";
  return "NEUTRAL";
}

// =====================
// AUTO HANDOFF DECISION
// =====================
function shouldHandoff(meta) {
  if (!OFFICIAL.handoffEnabled) return false;

  const tierOk = OFFICIAL.handoffPremium && (meta.tier === "PREMIUM" || meta.tier === "MID_PREMIUM");
  const urgentOk = OFFICIAL.handoffUrgent && meta.urgency === true;
  const seriousOk = OFFICIAL.handoffSerious && meta.emotion === "SERIOUS";

  return tierOk || urgentOk || seriousOk;
}

function handoffLine(userText, meta) {
  const link = waLink(OFFICIAL.waAdmin, templateAdmin(userText, meta));
  if (!link) return "";
  return `✅ Untuk respon prioritas, klik Admin (pesan sudah terisi): ${link}`;
}

// =====================
// SANITIZE AI OUTPUT
// =====================
function sanitizeAI(text = "") {
  let t = String(text || "").replace(/\r/g, "").trim();
  if (!t) return "";

  // Hindari alamat manual dari AI (footer resmi tetap boleh)
  const bannedFragments = [
    "[maps link]", "maps link", "alamat:", "jl.", "jalan ", "no.", "nomor",
    "alamat bengkel", "alamat kami", "lokasi kami"
  ];

  let lines = t.split("\n").map(l => l.trim()).filter(Boolean);
  lines = lines.filter(line => {
    const low = line.toLowerCase();
    if (bannedFragments.some(b => low.includes(b))) return false;
    return true;
  });

  t = lines.join("\n").trim();

  // enforce max 2 question marks
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

  // cap AI portion length
  if (t.length > MAX_RETURN_CHARS) t = t.slice(0, MAX_RETURN_CHARS).trim();

  return t;
}

// =====================
// SYSTEM PROMPT (ADAPTIVE)
// =====================
function buildSystemPrompt({ tier, urgency, emotion, priceFocus, topic }) {
  const tone =
    tier === "PREMIUM" || tier === "MID_PREMIUM"
      ? "tegas, elegan, premium specialist (singkat, tidak menakutkan)"
      : "tenang, jelas, bersahabat-profesional (singkat, tidak menakutkan)";

  const priority =
    urgency
      ? "Prioritas keselamatan: sarankan jangan dipaksakan + opsi towing."
      : "Arahkan langkah cek paling efisien.";

  const priceRule =
    priceFocus
      ? "Jika ditanya biaya/harga: jangan beri angka fix. Tekankan diagnosa dulu secara profesional."
      : "Jangan membuka angka tanpa pemeriksaan.";

  const emo =
    emotion === "PRICE_FOCUS"
      ? "Tipe price-focused: jawab singkat, profesional, tidak berdebat, arahkan diagnosa."
      : emotion === "SERIOUS"
      ? "Tipe serius: respons cepat, fokus solusi & ajakan datang."
      : "Tipe netral: edukasi ringkas, ajakan datang.";

  const topicRule =
    topic === "AC"
      ? "Topik AC: jelaskan kemungkinan penyebab umum secara ringkas, sarankan cek tekanan/kompresor/kebocoran, ajak datang. Tetap jangan beri angka fix."
      : topic === "TRANSMISSION"
      ? "Topik transmisi: jelaskan kemungkinan penyebab umum secara ringkas, sarankan diagnosa transmisi, ajak datang. Aman & tidak menakutkan."
      : "Topik otomotif umum: jawab ringkas, ajak inspeksi.";

  return `
Anda adalah CS WhatsApp profesional untuk ${OFFICIAL.name} (Medan).
Gaya: ${tone}. Tidak kaku. Tidak agresif. Tidak memancing konflik.

ATURAN WAJIB:
- Jangan pernah menulis alamat apa pun (jangan menulis "Jl/Jalan/No/Alamat").
- Jangan pakai placeholder seperti [maps link].
- Maksimal 2 pertanyaan (<=2 tanda "?").
- Jangan berdebat.
- ${priceRule}
- ${priority}
- ${emo}
- ${topicRule}

OUTPUT:
- 1 pesan WhatsApp ringkas (maks 900 karakter), Bahasa Indonesia.
- 1 paragraf analisa high-level (tidak menakutkan).
- Jika perlu: ajukan maks 2 pertanyaan triase yang paling menentukan.
`.trim();
}

// =====================
// TIMEOUT HELPER (v5.7)
// =====================
function withTimeout(promise, ms, label = "timeout") {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(label)), ms)),
  ]);
}

// =====================
// OUTPUT CAP (PATCH 5.7.1)
// =====================
function capTotalOut(text) {
  let t = String(text || "");
  if (t.length <= MAX_TOTAL_OUT_CHARS) return t;
  return t.slice(0, MAX_TOTAL_OUT_CHARS).trim();
}

// =====================
// AI REPLY (v5.7.1 anti-bisu)
// =====================
async function aiReply(userTextOriginal, meta) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  // teks utk template harus original, utk AI dipotong agar cepat
  const userTextForAI = truncateForAI(userTextOriginal);

  try {
    if (!apiKey) throw new Error("No API Key");

    const client = new OpenAI({ apiKey });

    dlog("OpenAI call:", { model, timeout: OPENAI_TIMEOUT_MS, meta });

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
      text = "Baik. Agar cepat tepat, mohon jawab 2 hal: gejala muncul saat dingin atau saat panas? ada jedug/selip?";
      text = sanitizeAI(text);
    }

    const tail = [];
    if (meta.urgency) tail.push(towingBlock());
    if (meta.priceFocus) tail.push(professionalPriceStatement());
    if (shouldHandoff(meta)) tail.push(handoffLine(userTextOriginal, meta));
    tail.push(footerCTA(userTextOriginal, meta));

    const out = capTotalOut([text, ...tail].join("\n\n"));
    return out;

  } catch (err) {
    console.log("[HONGZ v5.7.1] OPENAI ERROR:", err?.message || err);

    const fallbackParts = [];

    if (meta.topic === "AC") {
      fallbackParts.push(
        "Baik. Untuk AC tidak dingin, penyebab umum biasanya: freon kurang/ada kebocoran, kompresor lemah, kipas kondensor, atau evaporator kotor. Agar akurat, perlu cek tekanan & inspeksi kebocoran."
      );
    } else if (meta.topic === "TRANSMISSION") {
      fallbackParts.push(
        "Baik. Gejala rpm tinggi/baru masuk gigi bisa terkait slip, tekanan oli transmisi, solenoid/valve body, atau kondisi ATF. Agar tidak salah diagnosa, perlu pengecekan langsung."
      );
    } else {
      fallbackParts.push("Baik. Untuk memastikan penyebabnya secara akurat, unit perlu kami cek langsung.");
    }

    if (meta.urgency) fallbackParts.push("\n" + towingBlock());
    if (meta.priceFocus) fallbackParts.push("\n" + professionalPriceStatement());
    if (shouldHandoff(meta)) fallbackParts.push("\n" + handoffLine(userTextOriginal, meta));

    fallbackParts.push("\n" + footerCTA(userTextOriginal, meta));

    const out = capTotalOut(fallbackParts.join("\n"));
    return out;
  }
}

// =====================
// MAIN ENTRY (v5.7.1 safety wrapper)
// =====================
async function generateReply(userTextRaw) {
  const userText = normalizeUserText(userTextRaw);
  const t = norm(userText);

  try {
    // Commands (deterministic)
    if (t === "jadwal") {
      return capTotalOut([
        "Silakan kirim format:",
        "NAMA / MOBIL / TAHUN / GEJALA / JAM DATANG",
        "",
        footerCTA(userText, { tier: "STANDARD", urgency: false, emotion: "NEUTRAL", priceFocus: false, topic: "GENERAL" }),
      ].join("\n"));
    }

    if (t === "admin") {
      const meta = { tier: "STANDARD", urgency: false, emotion: "SERIOUS", priceFocus: false, topic: "GENERAL" };
      return capTotalOut([
        "Siap. Klik Admin (pesan otomatis sudah terisi):",
        waLink(OFFICIAL.waAdmin, templateAdmin(userText, meta)),
        "",
        footerCTA(userText, meta),
      ].join("\n"));
    }

    if (t === "cs") {
      return capTotalOut([
        "Siap. Klik CS (pesan otomatis sudah terisi):",
        waLink(OFFICIAL.waCS, templateCS(userText)),
        "",
        footerCTA(userText, { tier: "STANDARD", urgency: false, emotion: "NEUTRAL", priceFocus: false, topic: "GENERAL" }),
      ].join("\n"));
    }

    if (t.includes("towing") || t.includes("derek")) {
      return capTotalOut([
        towingBlock(),
        "",
        "Klik Towing Line (pesan otomatis sudah terisi):",
        waLink(OFFICIAL.waTowing, templateTowing(userText)),
        "",
        footerCTA(userText, { tier: "STANDARD", urgency: true, emotion: "SERIOUS", priceFocus: false, topic: "GENERAL" }),
      ].join("\n"));
    }

    if (t.includes("share lokasi") || t === "lokasi") {
      const meta = { tier: "STANDARD", urgency: false, emotion: "SERIOUS", priceFocus: false, topic: "GENERAL" };
      return capTotalOut([
        "Ini link lokasi resmi workshop Hongz:",
        OFFICIAL.maps,
        "",
        "Jika butuh evakuasi, ketik *TOWING* lalu kirim share lokasi Anda.",
        "",
        handoffLine(userText, meta) || "",
        "",
        footerCTA(userText, meta),
      ].filter(Boolean).join("\n"));
    }

    // Meta detection
    const tier = detectTier(userText);
    const urgency = detectUrgency(userText);
    const emotion = emotionalLabel(userText);
    const priceFocus = isPriceFocus(userText);
    const topic = detectTopic(userText);

    const meta = { tier, urgency, emotion, priceFocus, topic };

    // Price-focus quick lane (fast, deterministic)
    if (emotion === "PRICE_FOCUS") {
      const msg = [
        professionalPriceStatement(),
        "",
        "Jika unit masih bisa berjalan, silakan ketik *JADWAL* untuk pemeriksaan.",
        "Jika tidak memungkinkan, kami bisa bantu arahkan *TOWING*.",
        "",
        (shouldHandoff(meta) ? handoffLine(userText, meta) : ""),
        "",
        footerCTA(userText, meta),
      ].filter(Boolean).join("\n");

      return capTotalOut(msg);
    }

    // AI adaptive (anti-bisu)
    return capTotalOut(await aiReply(userText, meta));

  } catch (err) {
    console.log("[HONGZ v5.7.1] FATAL generateReply ERROR:", err?.message || err);

    const meta = { tier: "STANDARD", urgency: false, emotion: "NEUTRAL", priceFocus: false, topic: "GENERAL" };
    return capTotalOut([
      "Maaf, sistem sedang padat. Tapi kami tetap siap bantu.",
      "Silakan ketik *JADWAL* untuk booking pemeriksaan, atau *ADMIN* untuk respon prioritas.",
      "",
      footerCTA(userText, meta),
    ].join("\n"));
  }
}

module.exports = { generateReply };

// =====================
// PROFESSIONAL PRICE STATEMENT (CALM)
// =====================
function professionalPriceStatement() {
  return [
    "Kami bekerja berbasis diagnosa, bukan asumsi.",
    "Pada sistem kendaraan modern, estimasi tanpa pemeriksaan berisiko menyesatkan.",
    "Agar akurat & aman, unit perlu kami cek dulu (scan/tes jalan/cek tekanan/cek kebocoran).",
  ].join("\n");
}

// =====================
// TOWING BLOCK
// =====================
function towingBlock() {
  return [
    "Jika unit tidak bisa berjalan / terasa berisiko, sebaiknya jangan dipaksakan.",
    "Ketik *TOWING* dan kirim share lokasi Anda — kami bantu arahkan evakuasi ke workshop.",
  ].join("\n");
}

// =====================
// HELPERS
// =====================
function containsAny(text, arr) {
  const t = norm(text);
  return arr.some((k) => t.includes(k));
}
function countMatches(text, arr) {
  const t = norm(text);
  return arr.filter((k) => t.includes(k)).length;
}

// =====================
// VEHICLE TIER
// =====================
function detectTier(text) {
  const t = norm(text);

  const premium = [
    "land cruiser", "landcruiser", "lc200", "lc300", "alphard", "vellfire", "lexus",
    "bmw", "mercedes", "benz", "audi", "porsche", "range rover", "land rover", "prado"
  ];

  const midPremium = [
    "x-trail t32", "xtrail t32", "x trail t32",
    "crv turbo", "cx-5", "cx5", "harrier", "forester", "outlander"
  ];

  if (containsAny(t, premium)) return "PREMIUM";
  if (containsAny(t, midPremium)) return "MID_PREMIUM";
  return "STANDARD";
}

// =====================
// URGENCY DETECTION
// =====================
function detectUrgency(text) {
  const t = norm(text);
  const urgent = [
    "tidak bisa jalan", "gak bisa jalan", "mogok", "tidak bergerak",
    "panas gak bisa jalan", "panas tidak bisa jalan", "overheat",
    "masuk d tapi tidak jalan", "masuk r tapi tidak jalan",
    "selip parah", "rpm naik tapi tidak jalan"
  ];
  return containsAny(t, urgent);
}

// =====================
// PRICE FOCUS DETECTION
// =====================
function isPriceFocus(text) {
  const t = norm(text);
  const bait = ["berapa", "biaya", "harga", "range", "kisaran", "termurah", "murah", "nego", "diskon", "patokan", "budget"];
  return containsAny(t, bait);
}

// =====================
// TOPIC DETECTION (v5.7)
// =====================
function detectTopic(text) {
  const t = norm(text);

  const trans = [
    "matic", "transmisi", "cvt", "at", "gear", "gigi", "pindah gigi", "selip", "jedug",
    "rpm tinggi", "gaung", "dengung", "torque converter", "torsi", "tc", "valve body", "solenoid"
  ];

  const ac = ["ac", "aircond", "air conditioner", "tidak dingin", "kurang dingin", "freon", "kompresor", "evaporator"];

  if (containsAny(t, ac)) return "AC";
  if (containsAny(t, trans)) return "TRANSMISSION";
  return "GENERAL";
}

// =====================
// EMOTIONAL READING
// =====================
function emotionalLabel(text) {
  const t = norm(text);

  const seriousSignals = [
    "hari ini", "sekarang", "darurat", "urgent", "tolong",
    "mogok", "tidak bisa jalan", "di jalan", "di tol",
    "datang", "alamat", "lokasi", "share lokasi", "rute",
    "jadwal", "booking", "towing", "derek"
  ];

  const isengSignals = ["cuma tanya", "sekedar tanya", "iseng", "test", "coba", "cek cek"];
  const priceSignals = ["murah", "termurah", "nego", "diskon", "harga", "biaya"];

  const s = countMatches(t, seriousSignals);
  const i = countMatches(t, isengSignals);
  const p = countMatches(t, priceSignals);

  if (p >= 2 && p >= s) return "PRICE_FOCUS";
  if (s >= 2 && s > p) return "SERIOUS";
  if (i >= 1 && s === 0) return "CASUAL";
  return "NEUTRAL";
}

// =====================
// AUTO HANDOFF DECISION
// =====================
function shouldHandoff(meta) {
  if (!OFFICIAL.handoffEnabled) return false;

  const tierOk = OFFICIAL.handoffPremium && (meta.tier === "PREMIUM" || meta.tier === "MID_PREMIUM");
  const urgentOk = OFFICIAL.handoffUrgent && meta.urgency === true;
  const seriousOk = OFFICIAL.handoffSerious && meta.emotion === "SERIOUS";

  return tierOk || urgentOk || seriousOk;
}

function handoffLine(userText, meta) {
  const link = waLink(OFFICIAL.waAdmin, templateAdmin(userText, meta));
  if (!link) return "";
  return `✅ Untuk respon prioritas, klik Admin (pesan sudah terisi): ${link}`;
}

// =====================
// SANITIZE AI OUTPUT
// =====================
function sanitizeAI(text = "") {
  let t = String(text || "").replace(/\r/g, "").trim();
  if (!t) return "";

  // Hindari alamat manual dari AI (footer resmi tetap boleh)
  const bannedFragments = [
    "[maps link]", "maps link", "alamat:", "jl.", "jalan ", "no.", "nomor",
    "alamat bengkel", "alamat kami", "lokasi kami"
  ];

  let lines = t.split("\n").map(l => l.trim()).filter(Boolean);
  lines = lines.filter(line => {
    const low = line.toLowerCase();
    if (bannedFragments.some(b => low.includes(b))) return false;
    return true;
  });

  t = lines.join("\n").trim();

  // enforce max 2 question marks
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

  // cap AI portion length
  if (t.length > MAX_RETURN_CHARS) t = t.slice(0, MAX_RETURN_CHARS).trim();

  return t;
}

// =====================
// SYSTEM PROMPT (ADAPTIVE)
// =====================
function buildSystemPrompt({ tier, urgency, emotion, priceFocus, topic }) {
  const tone =
    tier === "PREMIUM" || tier === "MID_PREMIUM"
      ? "tegas, elegan, premium specialist (singkat, tidak menakutkan)"
      : "tenang, jelas, bersahabat-profesional (singkat, tidak menakutkan)";

  const priority =
    urgency
      ? "Prioritas keselamatan: sarankan jangan dipaksakan + opsi towing."
      : "Arahkan langkah cek paling efisien.";

  const priceRule =
    priceFocus
      ? "Jika ditanya biaya/harga: jangan beri angka fix. Tekankan diagnosa dulu secara profesional."
      : "Jangan membuka angka tanpa pemeriksaan.";

  const emo =
    emotion === "PRICE_FOCUS"
      ? "Tipe price-focused: jawab singkat, profesional, tidak berdebat, arahkan diagnosa."
      : emotion === "SERIOUS"
      ? "Tipe serius: respons cepat, fokus solusi & ajakan datang."
      : "Tipe netral: edukasi ringkas, ajakan datang.";

  const topicRule =
    topic === "AC"
      ? "Topik AC: jelaskan kemungkinan penyebab umum secara ringkas, sarankan cek tekanan/kompresor/kebocoran, ajak datang. Tetap jangan beri angka fix."
      : topic === "TRANSMISSION"
      ? "Topik transmisi: jelaskan kemungkinan penyebab umum secara ringkas, sarankan diagnosa transmisi, ajak datang. Aman & tidak menakutkan."
      : "Topik otomotif umum: jawab ringkas, ajak inspeksi.";

  return `
Anda adalah CS WhatsApp profesional untuk ${OFFICIAL.name} (Medan).
Gaya: ${tone}. Tidak kaku. Tidak agresif. Tidak memancing konflik.

ATURAN WAJIB:
- Jangan pernah menulis alamat apa pun (jangan menulis "Jl/Jalan/No/Alamat").
- Jangan pakai placeholder seperti [maps link].
- Maksimal 2 pertanyaan (<=2 tanda "?").
- Jangan berdebat.
- ${priceRule}
- ${priority}
- ${emo}
- ${topicRule}

OUTPUT:
- 1 pesan WhatsApp ringkas (maks 900 karakter), Bahasa Indonesia.
- 1 paragraf analisa high-level (tidak menakutkan).
- Jika perlu: ajukan maks 2 pertanyaan triase yang paling menentukan.
`.trim();
}

// =====================
// TIMEOUT HELPER (v5.7)
// =====================
function withTimeout(promise, ms, label = "timeout") {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(label)), ms)),
  ]);
}

// =====================
// OUTPUT CAP (PATCH 5.7.1)
// =====================
function capTotalOut(text) {
  let t = String(text || "");
  if (t.length <= MAX_TOTAL_OUT_CHARS) return t;
  return t.slice(0, MAX_TOTAL_OUT_CHARS).trim();
}

// =====================
// AI REPLY (v5.7.1 anti-bisu)
// =====================
async function aiReply(userTextOriginal, meta) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  // teks utk template harus original, utk AI dipotong agar cepat
  const userTextForAI = truncateForAI(userTextOriginal);

  try {
    if (!apiKey) throw new Error("No API Key");

    const client = new OpenAI({ apiKey });

    dlog("OpenAI call:", { model, timeout: OPENAI_TIMEOUT_MS, meta });

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
      text = "Baik. Agar cepat tepat, mohon jawab 2 hal: gejala muncul saat dingin atau saat panas? ada jedug/selip?";
      text = sanitizeAI(text);
    }

    const tail = [];
    if (meta.urgency) tail.push(towingBlock());
    if (meta.priceFocus) tail.push(professionalPriceStatement());
    if (shouldHandoff(meta)) tail.push(handoffLine(userTextOriginal, meta));
    tail.push(footerCTA(userTextOriginal, meta));

    const out = capTotalOut([text, ...tail].join("\n\n"));
    return out;

  } catch (err) {
    console.log("[HONGZ v5.7.1] OPENAI ERROR:", err?.message || err);

    const fallbackParts = [];

    if (meta.topic === "AC") {
      fallbackParts.push(
        "Baik. Untuk AC tidak dingin, penyebab umum biasanya: freon kurang/ada kebocoran, kompresor lemah, kipas kondensor, atau evaporator kotor. Agar akurat, perlu cek tekanan & inspeksi kebocoran."
      );
    } else if (meta.topic === "TRANSMISSION") {
      fallbackParts.push(
        "Baik. Gejala rpm tinggi/baru masuk gigi bisa terkait slip, tekanan oli transmisi, solenoid/valve body, atau kondisi ATF. Agar tidak salah diagnosa, perlu pengecekan langsung."
      );
    } else {
      fallbackParts.push("Baik. Untuk memastikan penyebabnya secara akurat, unit perlu kami cek langsung.");
    }

    if (meta.urgency) fallbackParts.push("\n" + towingBlock());
    if (meta.priceFocus) fallbackParts.push("\n" + professionalPriceStatement());
    if (shouldHandoff(meta)) fallbackParts.push("\n" + handoffLine(userTextOriginal, meta));

    fallbackParts.push("\n" + footerCTA(userTextOriginal, meta));

    const out = capTotalOut(fallbackParts.join("\n"));
    return out;
  }
}

// =====================
// MAIN ENTRY (v5.7.1 safety wrapper)
// =====================
async function generateReply(userTextRaw) {
  const userText = normalizeUserText(userTextRaw);
  const t = norm(userText);

  try {
    // Commands (deterministic)
    if (t === "jadwal") {
      return capTotalOut([
        "Silakan kirim format:",
        "NAMA / MOBIL / TAHUN / GEJALA / JAM DATANG",
        "",
        footerCTA(userText, { tier: "STANDARD", urgency: false, emotion: "NEUTRAL", priceFocus: false, topic: "GENERAL" }),
      ].join("\n"));
    }

    if (t === "admin") {
      const meta = { tier: "STANDARD", urgency: false, emotion: "SERIOUS", priceFocus: false, topic: "GENERAL" };
      return capTotalOut([
        "Siap. Klik Admin (pesan otomatis sudah terisi):",
        waLink(OFFICIAL.waAdmin, templateAdmin(userText, meta)),
        "",
        footerCTA(userText, meta),
      ].join("\n"));
    }

    if (t === "cs") {
      return capTotalOut([
        "Siap. Klik CS (pesan otomatis sudah terisi):",
        waLink(OFFICIAL.waCS, templateCS(userText)),
        "",
        footerCTA(userText, { tier: "STANDARD", urgency: false, emotion: "NEUTRAL", priceFocus: false, topic: "GENERAL" }),
      ].join("\n"));
    }

    if (t.includes("towing") || t.includes("derek")) {
      return capTotalOut([
        towingBlock(),
        "",
        "Klik Towing Line (pesan otomatis sudah terisi):",
        waLink(OFFICIAL.waTowing, templateTowing(userText)),
        "",
        footerCTA(userText, { tier: "STANDARD", urgency: true, emotion: "SERIOUS", priceFocus: false, topic: "GENERAL" }),
      ].join("\n"));
    }

    if (t.includes("share lokasi") || t === "lokasi") {
      const meta = { tier: "STANDARD", urgency: false, emotion: "SERIOUS", priceFocus: false, topic: "GENERAL" };
      return capTotalOut([
        "Ini link lokasi resmi workshop Hongz:",
        OFFICIAL.maps,
        "",
        "Jika butuh evakuasi, ketik *TOWING* lalu kirim share lokasi Anda.",
        "",
        handoffLine(userText, meta) || "",
        "",
        footerCTA(userText, meta),
      ].filter(Boolean).join("\n"));
    }

    // Meta detection
    const tier = detectTier(userText);
    const urgency = detectUrgency(userText);
    const emotion = emotionalLabel(userText);
    const priceFocus = isPriceFocus(userText);
    const topic = detectTopic(userText);

    const meta = { tier, urgency, emotion, priceFocus, topic };

    // Price-focus quick lane (fast, deterministic)
    if (emotion === "PRICE_FOCUS") {
      const msg = [
        professionalPriceStatement(),
        "",
        "Jika unit masih bisa berjalan, silakan ketik *JADWAL* untuk pemeriksaan.",
        "Jika tidak memungkinkan, kami bisa bantu arahkan *TOWING*.",
        "",
        (shouldHandoff(meta) ? handoffLine(userText, meta) : ""),
        "",
        footerCTA(userText, meta),
      ].filter(Boolean).join("\n");

      return capTotalOut(msg);
    }

    // AI adaptive (anti-bisu)
    return capTotalOut(await aiReply(userText, meta));

  } catch (err) {
    console.log("[HONGZ v5.7.1] FATAL generateReply ERROR:", err?.message || err);

    const meta = { tier: "STANDARD", urgency: false, emotion: "NEUTRAL", priceFocus: false, topic: "GENERAL" };
    return capTotalOut([
      "Maaf, sistem sedang padat. Tapi kami tetap siap bantu.",
      "Silakan ketik *JADWAL* untuk booking pemeriksaan, atau *ADMIN* untuk respon prioritas.",
      "",
      footerCTA(userText, meta),
    ].join("\n"));
  }
}

module.exports = { generateReply };
