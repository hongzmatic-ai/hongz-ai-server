// service.js (Hongz AI Engine v5.2 - High Authority / Galak)
// Goals:
// - No fake address / no placeholder ever (filtered)
// - Max 2 questions only (enforced)
// - Push to workshop / towing (closing)
// - Premium aware + anti negotiation

const OpenAI = require("openai");

// ====== FIXED OFFICIAL CTA (NEVER CHANGE) ======
const OFFICIAL = {
  name: "Hongz Bengkel Spesialis Transmisi Matic",
  address: "Jl. M. Yakub No.10b, Medan Perjuangan",
  maps: "https://maps.app.goo.gl/CvFZ9FLNJRog7K4t9",
  hours: "Senin–Sabtu 09.00–17.00",
};

function workshopCTA() {
  return [
    `📍 *${OFFICIAL.name}*`,
    `${OFFICIAL.address}`,
    `🧭 ${OFFICIAL.maps}`,
    `⏱ ${OFFICIAL.hours}`,
    `Ketik *JADWAL* untuk booking / *TOWING* bila unit tidak bisa jalan.`,
  ].join("\n");
}

function towingCTA() {
  return [
    "🚚 *MODE TOWING AKTIF*",
    "Kalau mobil *tidak bisa jalan / panas lalu mati jalan*, JANGAN dipaksa.",
    "Ketik: *TOWING* + kirim *share lokasi* Anda.",
  ].join("\n");
}

// ====== NORMALIZER ======
function norm(s = "") {
  return String(s).toLowerCase().replace(/\s+/g, " ").trim();
}

function containsAny(text, arr) {
  return arr.some((k) => text.includes(k));
}

// ====== TIER DETECTION ======
function detectTier(userText) {
  const t = norm(userText);

  const premium = [
    "land cruiser", "landcruiser", "lc200", "lc300", "lexus", "alphard", "vellfire",
    "bmw", "mercedes", "benz", "audi", "porsche", "range rover", "land rover",
    "prado",
  ];

  const midPremium = [
    "x-trail t32", "xtrail t32", "x trail t32",
    "crv turbo", "cx-5", "cx5", "harrier", "forester", "outlander",
  ];

  if (containsAny(t, premium)) return "PREMIUM";
  if (containsAny(t, midPremium)) return "MID_PREMIUM";
  return "REGULAR";
}

// ====== SYMPTOM DETECTION ======
function detectSymptoms(userText) {
  const t = norm(userText);

  const hotNoGo = containsAny(t, [
    "panas gak bisa jalan",
    "panas tidak bisa jalan",
    "kalau panas gak jalan",
    "setelah panas tidak jalan",
    "overheat",
  ]);

  const noMove = containsAny(t, [
    "tidak bisa jalan",
    "gak bisa jalan",
    "mogok",
    "tidak bergerak",
    "masuk d",
    "masuk r",
    "d tapi tidak jalan",
  ]);

  const slip = containsAny(t, ["selip", "ngelos", "rpm naik", "tarikan hilang"]);
  const jerk = containsAny(t, ["jedug", "hentak", "sentak"]);
  const warning = containsAny(t, ["lampu", "check", "indikator", "at oil", "engine", "warning"]);

  return { hotNoGo, noMove, slip, jerk, warning };
}

// ====== ANTI PRICE HUNTER ======
function isPriceHunter(userText) {
  const t = norm(userText);
  const signals = ["murah", "termurah", "nego", "diskon", "berapa aja", "harga fix", "patokan", "range harga"];
  return containsAny(t, signals);
}

function moneyPolicyHighAuthority(tier) {
  const line1 =
    tier === "PREMIUM" || tier === "MID_PREMIUM"
      ? "Untuk unit *premium*, kami *TIDAK kunci angka via chat*. Titik."
      : "Kami *tidak kunci harga via chat* tanpa diagnosa.";

  return [
    "🛡 *ANTI-NEGOSIASI:*",
    line1,
    "Alasan: transmisi matic itu *kausalitas* (bisa kelistrikan/ECU/TCM/charging/cooling), bukan tebak-tebakan angka.",
    "Estimasi valid hanya setelah *scan + test pressure + cek suhu oli + road test/bench test*.",
  ].join("\n");
}

// ====== HARD OUTPUT FILTER (ANTI HALUSINASI ALAMAT) ======
function sanitizeAI(text = "") {
  let t = String(text || "").trim();

  // remove common placeholders & fake address patterns
  const bannedFragments = [
    "[maps link]",
    "maps link",
    "alamat:",
    "di jl",
    "di jalan",
    "jl.",
    "jalan ",
    "no.",
    "nomor ",
    "raya transmisi",
    "medan no",
    "no 123",
    "jl medan",
  ];

  // remove any line containing banned fragments
  const lines = t.split("\n").map((l) => l.trim()).filter(Boolean);
  const cleaned = lines.filter((line) => {
    const low = line.toLowerCase();
    // if AI tries to type any address-like line -> drop it
    if (bannedFragments.some((b) => low.includes(b))) return false;
    // drop if AI mentions "alamat bengkel" etc
    if (low.includes("alamat bengkel")) return false;
    return true;
  });

  t = cleaned.join("\n").trim();

  // enforce max 2 question marks total
  const qmCount = (t.match(/\?/g) || []).length;
  if (qmCount > 2) {
    // cut after second question mark
    let count = 0;
    let out = "";
    for (const ch of t) {
      out += ch;
      if (ch === "?") {
        count += 1;
        if (count === 2) break;
      }
    }
    t = out.trim();
  }

  // keep it short-ish (WhatsApp)
  if (t.length > 850) t = t.slice(0, 850).trim();

  return t;
}

// ====== FALLBACK (NO AI) ======
function fallbackReply(userText) {
  const tier = detectTier(userText);
  const symptoms = detectSymptoms(userText);

  const header =
    tier === "PREMIUM" || tier === "MID_PREMIUM"
      ? "✅ *Unit Anda kategori PREMIUM.* Saya jawab tegas dan aman."
      : "✅ Siap. Saya arahkan langkah paling aman.";

  const urgent = (symptoms.noMove || symptoms.hotNoGo)
    ? ["🛑 Jangan dipaksa jalan. Risiko kerusakan melebar.", towingCTA()].join("\n\n")
    : "🛑 Jangan lanjut test berulang-ulang. Kita butuh diagnosa yang benar.";

  const q = [
    "Jawab singkat 2 hal saja:",
    "1) Saat masuk *D/R* ada respon/gerak? (YA/TIDAK)",
    "2) Ada lampu indikator menyala? (YA/TIDAK)",
  ].join("\n");

  return [header, urgent, moneyPolicyHighAuthority(tier), q, workshopCTA()].join("\n\n");
}

// ====== AI REPLY (HIGH AUTHORITY) ======
async function aiReply(userText) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  if (!apiKey) return fallbackReply(userText);

  const tier = detectTier(userText);
  const symptoms = detectSymptoms(userText);

  const styleTag =
    tier === "PREMIUM" || tier === "MID_PREMIUM"
      ? "HIGH AUTHORITY PREMIUM"
      : "HIGH AUTHORITY";

  const dangerTag =
    (symptoms.noMove || symptoms.hotNoGo) ? "URGENT TOWING" : "NON-URGENT";

  const client = new OpenAI({ apiKey });

  const systemPrompt = `
Anda adalah CS Hongz Bengkel Spesialis Transmisi Matic Medan.
Mode: ${styleTag} | ${dangerTag}

ATURAN WAJIB (keras):
1) DILARANG menulis alamat apa pun. Jangan tulis 'Jl', 'Jalan', 'No', 'Alamat', atau lokasi fiktif.
2) DILARANG menulis placeholder seperti [maps link].
3) DILARANG memberi harga fix / range angka via chat. Tolak dengan tegas.
4) Maksimal 2 pertanyaan saja (<=2 tanda tanya).
5) Jawaban singkat, tegas, profesional. Tidak bertele-tele.
6) Fokus: arahkan ke workshop/towing + safety warning bila perlu.
7) Jika pelanggan tanya harga: jawab anti-negosiasi + minta datang/diagnosa.

Tujuan bisnis:
- Tutup percakapan dengan ajakan datang / towing.
- Buat pelanggan patuh & percaya (authority).
`;

  const userPrompt = `
Pelanggan berkata: "${userText}"

Buat balasan WA sesuai aturan. 
- 1 paragraf tegas + (maks) 2 pertanyaan triase singkat bila perlu.
- Jika tidak bisa jalan/panas: sarankan towing.
- Jangan tulis alamat atau maps link. (Nanti sistem akan menambahkan.)
`;

  const resp = await client.chat.completions.create({
    model,
    temperature: 0.25,
    messages: [
      { role: "system", content: systemPrompt.trim() },
      { role: "user", content: userPrompt.trim() },
    ],
  });

  let text = resp.choices?.[0]?.message?.content?.trim() || "";
  text = sanitizeAI(text);

  // If AI output becomes empty after filtering, use fallback
  if (!text) return fallbackReply(userText);

  // Add enforced closing blocks (official only)
  const tail = [];
  if (symptoms.noMove || symptoms.hotNoGo) tail.push(towingCTA());
  tail.push(moneyPolicyHighAuthority(tier));
  tail.push(workshopCTA());

  return [text, ...tail].join("\n\n");
}

// ====== PUBLIC API ======
async function generateReply(userText) {
  const t = norm(userText);

  // Commands first (full deterministic, no AI needed)
  if (t === "jadwal") {
    return [
      "✅ *BOOKING CEPAT (Tegas):*",
      "Kirim format: *NAMA / MOBIL / TAHUN / GEJALA / JAM KEDATANGAN*",
      workshopCTA(),
    ].join("\n");
  }

  if (t.includes("towing") || t.includes("derek")) {
    return [
      towingCTA(),
      "Ketik: *TOWING* + kirim *share lokasi* Anda sekarang.",
      workshopCTA(),
    ].join("\n\n");
  }

  if (t.includes("share lokasi") || t.includes("share lokasi bengkel") || t === "lokasi") {
    return [
      "Ini lokasi resmi workshop Hongz (bukan teks alamat versi chat):",
      OFFICIAL.maps,
      "Jika butuh evakuasi, ketik *TOWING* lalu kirim share lokasi Anda.",
      workshopCTA(),
    ].join("\n");
  }

  // Price hunters -> hard gate
  if (isPriceHunter(userText)) {
    const tier = detectTier(userText);
    return [
      "🛑 Saya jawab tegas: *harga tidak dikunci via chat.*",
      moneyPolicyHighAuthority(tier),
      "Kalau Anda serius, pilih 1:",
      "1) *JADWAL* (datang untuk diagnosa)",
      "2) *TOWING* (kalau unit tidak bisa jalan)",
      workshopCTA(),
    ].join("\n\n");
  }

  // Normal path -> AI
  return aiReply(userText);
}

module.exports = { generateReply };
