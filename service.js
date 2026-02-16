// service.js
// =====================================================
// HONGZ AI ENGINE v5.4 - SMART CALM AUTHORITY MODE
// - High level, not scary
// - Adaptive tone (premium/standard + serious/price-hunter)
// - Urgency -> towing
// - No "anti-negosiasi" wording
// - No fake address / no placeholder (sanitized)
// - Max 2 questions enforced
// =====================================================

const OpenAI = require("openai");

// ---- OFFICIAL (LOCKED) ----
const OFFICIAL = {
  name: "Hongz Bengkel Spesialis Transmisi Matic",
  address: "Jl. M. Yakub No.10b, Medan Perjuangan",
  maps: "https://maps.app.goo.gl/CvFZ9FLNJRog7K4t9",
  hours: "Senin–Sabtu 09.00–17.00",
};

function footerCTA() {
  return [
    `📍 ${OFFICIAL.name}`,
    OFFICIAL.address,
    `🧭 ${OFFICIAL.maps}`,
    `⏱ ${OFFICIAL.hours}`,
    "Ketik *JADWAL* untuk booking / *TOWING* bila unit tidak bisa jalan.",
  ].join("\n");
}

function professionalPriceStatement() {
  return [
    "Kami bekerja berbasis diagnosa, bukan asumsi.",
    "",
    "Pada sistem transmisi modern, estimasi tanpa pemeriksaan",
    "berisiko menyesatkan.",
    "",
    "Untuk menjaga akurasi dan tanggung jawab teknis,",
    "unit perlu kami cek langsung terlebih dahulu.",
  ].join("\n");
}

function towingBlock() {
  return [
    "Jika unit tidak bisa berjalan atau terasa berisiko,",
    "sebaiknya tidak dipaksakan.",
    "",
    "Ketik *TOWING* dan kirim share lokasi Anda,",
    "kami bantu arahkan proses evakuasi.",
  ].join("\n");
}

// ---- helpers ----
function norm(s = "") {
  return String(s).toLowerCase().replace(/\s+/g, " ").trim();
}
function containsAny(text, arr) {
  return arr.some((k) => text.includes(k));
}
function countMatches(text, arr) {
  const t = norm(text);
  return arr.filter((k) => t.includes(k)).length;
}

// ---- tier ----
function detectTier(text) {
  const t = norm(text);
  const premium = [
    "land cruiser","landcruiser","lc200","lc300","alphard","vellfire","lexus",
    "bmw","mercedes","benz","audi","porsche","range rover","land rover","prado"
  ];
  const midPremium = [
    "x-trail t32","xtrail t32","x trail t32",
    "crv turbo","cx-5","cx5","harrier","forester","outlander"
  ];
  if (containsAny(t, premium)) return "PREMIUM";
  if (containsAny(t, midPremium)) return "MID_PREMIUM";
  return "STANDARD";
}

// ---- urgency ----
function detectUrgency(text) {
  const t = norm(text);
  const urgent = [
    "tidak bisa jalan","gak bisa jalan","mogok","tidak bergerak",
    "panas gak bisa jalan","panas tidak bisa jalan","overheat",
    "masuk d tapi tidak jalan","masuk r tapi tidak jalan"
  ];
  return containsAny(t, urgent);
}

// ---- price hunter ----
function isPriceHunter(text) {
  const t = norm(text);
  const bait = ["berapa","biaya","harga","range","kisaran","termurah","murah","nego","diskon","patokan","budget"];
  return containsAny(t, bait);
}

// ---- emotional reading (serius vs iseng) ----
function emotionalLabel(text) {
  const t = norm(text);

  const seriousSignals = [
    "hari ini","sekarang","darurat","urgent","tolong","mogok","tidak bisa jalan",
    "di jalan","di tol","datang","alamat","lokasi","share lokasi","rute","jadwal","booking","towing","derek"
  ];
  const isengSignals = ["cuma tanya","sekedar tanya","iseng","test","coba","cek cek"];

  const s = countMatches(t, seriousSignals);
  const i = countMatches(t, isengSignals);
  const p = countMatches(t, ["murah","termurah","nego","diskon","harga"]);

  if (p >= 2 && p >= s) return "PRICE_HUNTER";
  if (s >= 2 && s > p) return "SERIOUS";
  if (i >= 1 && s === 0) return "CASUAL";
  return "NEUTRAL";
}

// ---- sanitize AI output (anti alamat palsu + max 2 question marks) ----
function sanitizeAI(text = "") {
  let t = String(text || "").replace(/\r/g, "").trim();
  if (!t) return "";

  const bannedLineFragments = [
    "[maps link]",
    "maps link",
    "alamat:",
    "jl.",
    "jalan ",
    "no.",
    "nomor",
    "raya transmisi",
    "medan no",
    "no 123",
    "jl medan",
  ];

  // Remove lines that look like made-up addresses or placeholders
  let lines = t.split("\n").map(l => l.trim()).filter(Boolean);
  lines = lines.filter(line => {
    const low = line.toLowerCase();
    if (bannedLineFragments.some(b => low.includes(b))) return false;
    if (low.includes("alamat bengkel")) return false;
    return true;
  });

  t = lines.join("\n").trim();

  // Enforce max 2 question marks
  const qm = (t.match(/\?/g) || []).length;
  if (qm > 2) {
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

  // Cap length
  if (t.length > 900) t = t.slice(0, 900).trim();

  return t;
}

// ---- build system prompt (adaptive) ----
function buildSystemPrompt({ tier, urgency, emotion, priceFocus }) {
  const tone =
    tier === "PREMIUM" || tier === "MID_PREMIUM"
      ? "lebih tegas & elegan (premium specialist)"
      : "tenang, jelas, tidak menakutkan (spesialis)";

  const priority =
    urgency ? "Prioritas keselamatan: sarankan tidak dipaksa + opsi towing." : "Boleh arahkan langkah cek paling efisien.";

  const priceRule =
    priceFocus
      ? "Jika ditanya biaya/harga: jangan beri angka fix. Pakai pernyataan profesional berbasis diagnosa."
      : "Jangan membuka angka tanpa pemeriksaan.";

  const emo =
    emotion === "PRICE_HUNTER"
      ? "Tipe pelanggan price-focused: jawab singkat, profesional, tidak berdebat, arahkan diagnosa."
      : emotion === "SERIOUS"
      ? "Tipe pelanggan serius: respons cepat, fokus solusi & ajakan datang."
      : "Tipe pelanggan netral: edukasi ringkas, ajakan datang.";

  return `
Anda adalah CS WhatsApp profesional untuk ${OFFICIAL.name} (Medan).

Gaya: ${tone}. Tidak agresif. Tidak kaku.

Aturan WAJIB:
- Jangan pernah menulis alamat apa pun, jangan menulis 'Jl/Jalan/No/Alamat'.
- Jangan pakai placeholder seperti [maps link].
- Maksimal 2 pertanyaan (<=2 tanda '?').
- Jangan berdebat, jangan memancing konflik.
- ${priceRule}
- ${priority}
- ${emo}

Output: 1 pesan WhatsApp ringkas (maks 900 karakter), Bahasa Indonesia.
`.trim();
}

// ---- AI reply ----
async function aiReply(userText, meta) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  // Fallback if key missing
  if (!apiKey) {
    const parts = [];
    parts.push("Baik. Untuk memastikan sumber masalahnya, unit perlu kami cek langsung.");
    if (meta.urgency) parts.push("\n" + towingBlock());
    parts.push("\n" + professionalPriceStatement());
    parts.push("\n" + footerCTA());
    return parts.join("\n");
  }

  const client = new OpenAI({ apiKey });

  const resp = await client.chat.completions.create({
    model,
    temperature: 0.35,
    messages: [
      { role: "system", content: buildSystemPrompt(meta) },
      {
        role: "user",
        content: `
Pelanggan: "${userText}"

Buat jawaban:
- 1 paragraf analisa high-level (tidak menakutkan).
- Jika perlu: ajukan maks 2 pertanyaan triase yang paling menentukan.
- Jangan tulis alamat atau maps (nanti sistem yang menambahkan).
`.trim()
      }
    ],
  });

  let text = resp.choices?.[0]?.message?.content?.trim() || "";
  text = sanitizeAI(text);

  // If sanitized becomes empty, safe fallback
  if (!text) {
    text = "Baik. Untuk memastikan sumber masalahnya, unit perlu kami cek langsung. Mohon jawab 2 hal: muncul saat dingin atau panas/macet? ada jedug atau selip?";
    text = sanitizeAI(text);
  }

  // Attach calm-professional statements (when price question appears)
  const tail = [];
  if (meta.urgency) tail.push(towingBlock());

  // If user asked price OR detected price focus -> attach professional statement
  if (meta.priceFocus) tail.push(professionalPriceStatement());

  tail.push(footerCTA());

  return [text, ...tail].join("\n\n");
}

// ---- main entry ----
async function generateReply(userText) {
  const t = norm(userText);

  // Commands (deterministic)
  if (t === "jadwal") {
    return [
      "Silakan kirim format berikut:",
      "NAMA / MOBIL / TAHUN / GEJALA / JAM DATANG",
      "",
      footerCTA(),
    ].join("\n");
  }

  if (t.includes("towing") || t.includes("derek")) {
    return [towingBlock(), "", footerCTA()].join("\n");
  }

  if (t.includes("share lokasi") || t === "lokasi") {
    return [
      "Ini link lokasi resmi workshop Hongz:",
      OFFICIAL.maps,
      "",
      "Jika butuh evakuasi, ketik *TOWING* lalu kirim share lokasi Anda.",
      "",
      footerCTA(),
    ].join("\n");
  }

  const tier = detectTier(userText);
  const urgency = detectUrgency(userText);
  const emotion = emotionalLabel(userText);
  const priceFocus = isPriceHunter(userText);

  // If pure price-hunter, answer very calm-professional, no long talk
  if (emotion === "PRICE_HUNTER") {
    const msg = [
      professionalPriceStatement(),
      "",
      "Jika unit masih bisa berjalan, silakan *JADWAL* untuk pemeriksaan.",
      "Jika tidak memungkinkan, kami bisa bantu arahkan *TOWING*.",
      "",
      footerCTA(),
    ].join("\n");
    return msg;
  }

  // Otherwise AI adaptive
  return await aiReply(userText, { tier, urgency, emotion, priceFocus });
}

module.exports = { generateReply };
