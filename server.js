// service.js
// =====================================================
// HONGZ AI ENGINE - FULL REPLACE (v5.7 stable)
// - Zero silent failure (fallback selalu ada)
// - OpenAI timeout (default 9s) + sanitize anti alamat palsu
// - Brand mature footer (rapi)
// =====================================================

const OpenAI = require("openai");

// OFFICIAL (LOCKED)
const OFFICIAL = {
  name: "Hongz Bengkel – Spesialis Transmisi Matic",
  address: "Jl. M. Yakub No.10b, Medan Perjuangan",
  maps: "https://maps.app.goo.gl/CvFZ9FLNJRog7K4t9",
  hours: "Senin–Sabtu 09.00–17.00",
  waAdmin: process.env.WA_ADMIN || "6281375430728",
  waCS: process.env.WA_CS || "6285752965167",
};

// TUNING
const DEBUG = (process.env.DEBUG || "false").toLowerCase() === "true";
const OPENAI_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS || 9000);
const MAX_USER_FOR_AI = Number(process.env.MAX_USER_FOR_AI || 700);
const MAX_RETURN_CHARS = 900;

function dlog(...args) { if (DEBUG) console.log("[HONGZ]", ...args); }

function cleanMsisdn(msisdn) { return String(msisdn || "").replace(/[^\d]/g, ""); }

function waLink(msisdn) {
  const n = cleanMsisdn(msisdn);
  return n ? `https://wa.me/${n}` : "";
}

function footerCTA() {
  const lines = [
    `📍 ${OFFICIAL.name}`,
    OFFICIAL.address,
    `🧭 ${OFFICIAL.maps}`,
    `⏱ ${OFFICIAL.hours}`,
    "",
    "📲 WhatsApp Admin:",
    waLink(OFFICIAL.waAdmin),
    "",
    "💬 WhatsApp CS:",
    waLink(OFFICIAL.waCS),
    "",
    "Ketik:",
    "*JADWAL* untuk booking pemeriksaan",
    "*TOWING* bila unit tidak bisa berjalan",
  ];
  return lines.filter(Boolean).join("\n");
}

function professionalPriceStatement() {
  return [
    "Kami bekerja berbasis diagnosa, bukan asumsi.",
    "Pada sistem kendaraan modern, estimasi tanpa pemeriksaan berisiko menyesatkan.",
    "Agar akurat & aman, unit perlu kami cek dulu (scan/tes jalan/cek tekanan/cek kebocoran).",
  ].join("\n");
}

function towingBlock() {
  return [
    "Jika unit tidak bisa berjalan / terasa berisiko, sebaiknya jangan dipaksakan.",
    "Ketik *TOWING* dan kirim share lokasi Anda — kami bantu arahkan evakuasi ke workshop.",
  ].join("\n");
}

function norm(s = "") { return String(s).toLowerCase().replace(/\s+/g, " ").trim(); }

function normalizeUserText(raw = "") {
  let t = String(raw || "").replace(/\r/g, "").trim();
  t = t.replace(/^\s*\d+\s*[\.\)]\s*/g, "");
  t = t.replace(/^\s*\d+\s+/g, "");
  t = t.replace(/\s+/g, " ").trim();
  return t;
}

function truncateForAI(text) {
  const t = String(text || "");
  return t.length <= MAX_USER_FOR_AI ? t : (t.slice(0, MAX_USER_FOR_AI).trim() + "…");
}

function containsAny(text, arr) {
  const t = norm(text);
  return arr.some((k) => t.includes(k));
}

function detectTier(text) {
  const t = norm(text);
  const premium = ["land cruiser","landcruiser","lc200","lc300","alphard","vellfire","lexus","bmw","mercedes","benz","audi","porsche","range rover","land rover","prado"];
  const mid = ["x-trail t32","xtrail t32","x trail t32","crv turbo","cx-5","cx5","harrier","forester","outlander"];
  if (containsAny(t, premium)) return "PREMIUM";
  if (containsAny(t, mid)) return "MID_PREMIUM";
  return "STANDARD";
}

function detectUrgency(text) {
  const urgent = [
    "tidak bisa jalan","gak bisa jalan","mogok","tidak bergerak",
    "panas gak bisa jalan","panas tidak bisa jalan","overheat",
    "masuk d tapi tidak jalan","masuk r tapi tidak jalan",
    "selip parah","rpm naik tapi tidak jalan"
  ];
  return containsAny(text, urgent);
}

function isPriceFocus(text) {
  const bait = ["berapa","biaya","harga","range","kisaran","termurah","murah","nego","diskon","patokan","budget"];
  return containsAny(text, bait);
}

function sanitizeAI(text = "") {
  let t = String(text || "").replace(/\r/g, "").trim();
  if (!t) return "";

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

  // max 2 question marks
  const qCount = (t.match(/\?/g) || []).length;
  if (qCount > 2) {
    let count = 0, out = "";
    for (const ch of t) {
      out += ch;
      if (ch === "?") {
        count++;
        if (count === 2) break;
      }
    }
    t = out.trim();
  }

  if (t.length > MAX_RETURN_CHARS) t = t.slice(0, MAX_RETURN_CHARS).trim();
  return t;
}

function buildSystemPrompt(meta) {
  const tone =
    meta.tier === "PREMIUM" || meta.tier === "MID_PREMIUM"
      ? "tegas, elegan, premium specialist (singkat, tidak menakutkan)"
      : "tenang, jelas, bersahabat-profesional (singkat, tidak menakutkan)";

  const priority = meta.urgency
    ? "Prioritas keselamatan: sarankan jangan dipaksakan + opsi towing."
    : "Arahkan langkah cek paling efisien.";

  const priceRule = meta.priceFocus
    ? "Jika ditanya biaya/harga: jangan beri angka fix. Tekankan diagnosa dulu secara profesional."
    : "Jangan membuka angka tanpa pemeriksaan.";

  return `
Anda adalah CS WhatsApp profesional untuk ${OFFICIAL.name} (Medan).
Gaya: ${tone}. Tidak kaku. Tidak agresif. Tidak memancing konflik.

ATURAN WAJIB:
- Jangan menulis alamat apa pun (jangan menulis "Jl/Jalan/No/Alamat") di jawaban.
- Jangan pakai placeholder seperti [maps link].
- Maksimal 2 pertanyaan (<=2 tanda "?").
- Jangan berdebat.
- ${priceRule}
- ${priority}

OUTPUT:
- 1 paragraf analisa high-level (tidak menakutkan).
- Jika perlu: ajukan maks 2 pertanyaan triase.
`.trim();
}

function withTimeout(promise, ms, label = "timeout") {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(label)), ms)),
  ]);
}

async function aiReply(userTextOriginal, meta) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const userForAI = truncateForAI(userTextOriginal);

  try {
    if (!apiKey) throw new Error("NO_API_KEY");

    const client = new OpenAI({ apiKey });

    dlog("OpenAI call", { model, timeout: OPENAI_TIMEOUT_MS, meta });

    const resp = await withTimeout(
      client.chat.completions.create({
        model,
        temperature: 0.35,
        messages: [
          { role: "system", content: buildSystemPrompt(meta) },
          { role: "user", content: `Pelanggan: "${userForAI}"` },
        ],
      }),
      OPENAI_TIMEOUT_MS,
      "OPENAI_TIMEOUT"
    );

    let text = resp.choices?.[0]?.message?.content?.trim() || "";
    text = sanitizeAI(text);

    if (!text) text = "Baik. Untuk memastikan sumber masalahnya secara akurat, unit perlu kami cek langsung. Gejala muncul saat dingin atau saat panas/macet?";

    const tail = [];
    if (meta.urgency) tail.push(towingBlock());
    if (meta.priceFocus) tail.push(professionalPriceStatement());
    tail.push(footerCTA());

    return [text, ...tail].join("\n\n");
  } catch (err) {
    console.log("[HONGZ] OPENAI ERROR:", err?.message || err);

    const parts = [];
    parts.push("Baik. Untuk memastikan penyebabnya secara akurat, unit perlu kami cek langsung.");
    if (meta.urgency) parts.push("\n" + towingBlock());
    if (meta.priceFocus) parts.push("\n" + professionalPriceStatement());
    parts.push("\n" + footerCTA());
    return parts.join("\n");
  }
}

async function generateReply(userTextRaw) {
  const userText = normalizeUserText(userTextRaw);
  const t = norm(userText);

  try {
    if (t === "jadwal") {
      return [
        "Silakan kirim format:",
        "NAMA / MOBIL / TAHUN / GEJALA / JAM DATANG",
        "",
        footerCTA(),
      ].join("\n");
    }

    if (t.includes("towing") || t.includes("derek")) {
      return [towingBlock(), "", footerCTA()].join("\n");
    }

    if (t === "halo" || t === "hai" || t === "test") {
      return [
        "Halo! Kami siap bantu.",
        "Silakan tulis: mobil + tahun + gejala singkat (contoh: 'Innova 2008 rpm tinggi telat masuk gigi').",
        "",
        footerCTA(),
      ].join("\n");
    }

    const tier = detectTier(userText);
    const urgency = detectUrgency(userText);
    const priceFocus = isPriceFocus(userText);
    const meta = { tier, urgency, priceFocus };

    // fast lane price-focus (calm)
    if (priceFocus && userText.length < 25) {
      return [
        professionalPriceStatement(),
        "",
        "Untuk estimasi yang bertanggung jawab, unit perlu kami cek dulu.",
        "",
        footerCTA(),
      ].join("\n");
    }

    return await aiReply(userText, meta);
  } catch (e) {
    console.log("[HONGZ] FATAL generateReply:", e?.message || e);
    return [
      "Maaf, sistem sedang padat. Tapi kami tetap siap bantu.",
      "Silakan ketik *JADWAL* untuk booking pemeriksaan atau *TOWING* bila unit tidak bisa berjalan.",
      "",
      footerCTA(),
    ].join("\n");
  }
}

module.exports = { generateReply };
