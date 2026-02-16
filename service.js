// service.js
// =====================================================
// HONGZ AI ENGINE v5.6 - AUTO HANDOFF + AUTO-FILL MESSAGE
// - Calm smart authority (tidak menakutkan)
// - AI reply (OpenAI) + sanitasi anti alamat palsu
// - Max 2 pertanyaan
// - Premium routing + urgency towing
// - Footer selalu berisi Maps + 3 jalur WA (wa.me) + auto-fill template
// - Auto handoff: SERIOUS / URGENT / PREMIUM => arahkan klik Admin (auto-fill)
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

  // WA numbers: isi lewat ENV (disarankan)
  waAdmin: process.env.WA_ADMIN || "6281375430728", // Papa (utama)
  waCS: process.env.WA_CS || "6285752965167",       // CS (opsional)
  waTowing: process.env.WA_TOWING || "6281375430728", // towing line (bisa sama Papa)

  // Auto handoff thresholds
  handoffEnabled: (process.env.HANDOFF_ENABLED || "true").toLowerCase() === "true",
  handoffSerious: (process.env.HANDOFF_SERIOUS || "true").toLowerCase() === "true",
  handoffUrgent: (process.env.HANDOFF_URGENT || "true").toLowerCase() === "true",
  handoffPremium: (process.env.HANDOFF_PREMIUM || "true").toLowerCase() === "true",
};

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
// AUTO-FILL TEMPLATES
// =====================
function templateAdmin(userText, meta) {
  const flags = [];
  if (meta?.tier) flags.push(`TIER:${meta.tier}`);
  if (meta?.urgency) flags.push("URGENT");
  if (meta?.emotion) flags.push(`EMO:${meta.emotion}`);
  if (meta?.priceFocus) flags.push("PRICE_Q");

  return [
    "Halo Admin Hongz, saya butuh bantuan.",
    `Keluhan: ${String(userText || "").trim()}`,
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
    `Keluhan: ${String(userText || "").trim()}`,
    "",
    "Saya kirim share lokasi sekarang. Mohon arahkan proses towing ke Hongz.",
  ].join("\n");
}

function templateCS(userText) {
  return [
    "Halo CS Hongz, saya mau konsultasi & booking.",
    `Keluhan: ${String(userText || "").trim()}`,
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
  if (csFilled && cleanMsisdn(OFFICIAL.waCS) && cleanMsisdn(OFFICIAL.waCS) !== cleanMsisdn(OFFICIAL.waAdmin)) {
    lines.push(`💬 CS Cepat – klik & pesan otomatis: ${csFilled}`);
  }
  if (towFilled && cleanMsisdn(OFFICIAL.waTowing) && cleanMsisdn(OFFICIAL.waTowing) !== cleanMsisdn(OFFICIAL.waAdmin)) {
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
    "Pada sistem transmisi modern, estimasi tanpa pemeriksaan berisiko menyesatkan.",
    "Untuk menjaga akurasi & tanggung jawab teknis, unit perlu kami cek langsung terlebih dahulu.",
  ].join("\n");
}

// =====================
// TOWING BLOCK
// =====================
function towingBlock() {
  return [
    "Jika unit tidak bisa berjalan / terasa berisiko, sebaiknya jangan dipaksakan.",
    "Ketik *TOWING* dan kirim share lokasi Anda — kami bantu arahkan proses evakuasi ke workshop.",
  ].join("\n");
}

// =====================
// HELPERS
// =====================
function norm(s = "") {
  return String(s).toLowerCase().replace(/\s+/g, " ").trim();
}
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

  // Handoff jika salah satu terpenuhi
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

  const bannedFragments = [
    "[maps link]", "maps link", "alamat:", "jl.", "jalan ", "no.", "nomor",
    "no 123", "medan no", "jl medan", "raya transmisi", "alamat bengkel"
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

  // cap length
  if (t.length > 900) t = t.slice(0, 900).trim();

  return t;
}

// =====================
// SYSTEM PROMPT (ADAPTIVE)
// =====================
function buildSystemPrompt({ tier, urgency, emotion, priceFocus }) {
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

OUTPUT:
- 1 pesan WhatsApp ringkas (maks 900 karakter), Bahasa Indonesia.
- 1 paragraf analisa high-level (tidak menakutkan).
- Jika perlu: ajukan maks 2 pertanyaan triase yang paling menentukan.
`.trim();
}

// =====================
// AI REPLY
// =====================
async function aiReply(userText, meta) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  if (!apiKey) {
    const parts = [];
    parts.push("Baik. Untuk memastikan sumber masalahnya, unit perlu kami cek langsung.");
    if (meta.urgency) parts.push("\n" + towingBlock());
    if (meta.priceFocus) parts.push("\n" + professionalPriceStatement());
    if (shouldHandoff(meta)) parts.push("\n" + handoffLine(userText, meta));
    parts.push("\n" + footerCTA(userText, meta));
    return parts.join("\n");
  }

  const client = new OpenAI({ apiKey });

  const resp = await client.chat.completions.create({
    model,
    temperature: 0.35,
    messages: [
      { role: "system", content: buildSystemPrompt(meta) },
      { role: "user", content: `Pelanggan: "${userText}"` },
    ],
  });

  let text = resp.choices?.[0]?.message?.content?.trim() || "";
  text = sanitizeAI(text);

  if (!text) {
    text = "Baik. Agar cepat tepat, mohon jawab 2 hal: gejala muncul saat dingin atau saat panas/macet? ada jedug atau selip?";
    text = sanitizeAI(text);
  }

  const tail = [];
  if (meta.urgency) tail.push(towingBlock());
  if (meta.priceFocus) tail.push(professionalPriceStatement());
  if (shouldHandoff(meta)) tail.push(handoffLine(userText, meta));
  tail.push(footerCTA(userText, meta));

  return [text, ...tail].join("\n\n");
}

// =====================
// MAIN ENTRY
// =====================
async function generateReply(userText) {
  const t = norm(userText);

  // Commands (deterministic)
  if (t === "jadwal") {
    return [
      "Silakan kirim format:",
      "NAMA / MOBIL / TAHUN / GEJALA / JAM DATANG",
      "",
      footerCTA(userText, { tier: "STANDARD", urgency: false, emotion: "NEUTRAL", priceFocus: false }),
    ].join("\n");
  }

  if (t === "admin") {
    const meta = { tier: "STANDARD", urgency: false, emotion: "SERIOUS", priceFocus: false };
    return [
      "Siap. Klik Admin (pesan otomatis sudah terisi):",
      waLink(OFFICIAL.waAdmin, templateAdmin(userText, meta)),
      "",
      footerCTA(userText, meta),
    ].join("\n");
  }

  if (t === "cs") {
    return [
      "Siap. Klik CS (pesan otomatis sudah terisi):",
      waLink(OFFICIAL.waCS, templateCS(userText)),
      "",
      footerCTA(userText, { tier: "STANDARD", urgency: false, emotion: "NEUTRAL", priceFocus: false }),
    ].join("\n");
  }

  if (t.includes("towing") || t.includes("derek")) {
    return [
      towingBlock(),
      "",
      "Klik Towing Line (pesan otomatis sudah terisi):",
      waLink(OFFICIAL.waTowing, templateTowing(userText)),
      "",
      footerCTA(userText, { tier: "STANDARD", urgency: true, emotion: "SERIOUS", priceFocus: false }),
    ].join("\n");
  }

  if (t.includes("share lokasi") || t === "lokasi") {
    const meta = { tier: "STANDARD", urgency: false, emotion: "SERIOUS", priceFocus: false };
    return [
      "Ini link lokasi resmi workshop Hongz:",
      OFFICIAL.maps,
      "",
      "Jika butuh evakuasi, ketik *TOWING* lalu kirim share lokasi Anda.",
      "",
      handoffLine(userText, meta) || "",
      "",
      footerCTA(userText, meta),
    ].filter(Boolean).join("\n");
  }

  // Meta detection
  const tier = detectTier(userText);
  const urgency = detectUrgency(userText);
  const emotion = emotionalLabel(userText);
  const priceFocus = isPriceFocus(userText);

  const meta = { tier, urgency, emotion, priceFocus };

  // Price-focus quick lane (no AI panjang)
  if (emotion === "PRICE_FOCUS") {
    const msg = [
      professionalPriceStatement(),
      "",
      "Jika unit masih bisa berjalan, silakan *JADWAL* untuk pemeriksaan.",
      "Jika tidak memungkinkan, kami bisa bantu arahkan *TOWING*.",
      "",
      (shouldHandoff(meta) ? handoffLine(userText, meta) : ""),
      "",
      footerCTA(userText, meta),
    ].filter(Boolean).join("\n");
    return msg;
  }

  // AI adaptive
  return await aiReply(userText, meta);
}

module.exports = { generateReply };
