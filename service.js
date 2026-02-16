// service.js
// Hongz AI Engine v4.2 - SHORT REPLY MODE (WhatsApp Focus)
// Goal: singkat, tegas, high-authority, cepat closing ke workshop/towing

function norm(s = "") {
  return String(s).toLowerCase().replace(/\s+/g, " ").trim();
}
function containsAny(text, arr) {
  return arr.some((k) => text.includes(k));
}

// ====== POLICY / CTA ======
const MAPS_LINK = "https://maps.app.goo.gl/CvFZ9FLNJRog7K4t9";

function workshopCTA() {
  return [
    "📍 Hongz Bengkel (Jl. M. Yakub No.10b, Medan Perjuangan)",
    `🧭 Maps: ${MAPS_LINK}`,
    "⏱ Senin–Sabtu 09.00–17.00",
    "Ketik *JADWAL* / *TOWING*",
  ].join("\n");
}

function towingShort() {
  return [
    "🚚 *TOWING Mode:* jangan dipaksa jalan.",
    "Ketik *TOWING* + kirim *share lokasi* Anda.",
  ].join("\n");
}

function antiPriceShort(tier = "REGULAR") {
  if (tier === "PREMIUM" || tier === "MID_PREMIUM") {
    return "🛡 Unit premium: *tidak ada harga fix via chat*. Wajib diagnosa (scan + pressure + suhu oli).";
  }
  return "🛡 *Harga tidak dikunci via chat* tanpa diagnosa. Kita cek dulu biar akurat.";
}

// ====== EMOTIONAL READING (ringkas) ======
function emotionalReading(userText) {
  const t = norm(userText);
  const serius = [
    "hari ini","sekarang","darurat","mogok","tidak bisa jalan","gak bisa jalan",
    "panas","overheat","di jalan","di tol","urgent","tolong","booking","jadwal",
    "alamat","lokasi","share lokasi","rute","datang","towing","derek"
  ];
  const iseng = ["murah","nego","diskon","termurah","paling murah","cuma tanya","iseng","test"];

  const s = serius.filter(k => t.includes(k)).length;
  const p = iseng.filter(k => t.includes(k)).length;

  if (p >= 2 && p >= s) return "PRICE_HUNTER";
  if (s >= 2 && s > p) return "SERIOUS";
  return "NETRAL";
}

// ====== TIER DETECTION ======
function detectTier(userText) {
  const t = norm(userText);
  const premium = [
    "land cruiser","landcruiser","lc200","lc300","alphard","vellfire","lexus",
    "bmw","mercedes","benz","audi","porsche","range rover","land rover","prado"
  ];
  const mid = [
    "x-trail t32","xtrail t32","x trail t32",
    "crv turbo","cx-5","cx5","harrier","forester","outlander"
  ];
  if (containsAny(t, premium)) return "PREMIUM";
  if (containsAny(t, mid)) return "MID_PREMIUM";
  return "REGULAR";
}

// ====== VEHICLE + YEAR EXTRACTION ======
function extractVehicleYear(userText) {
  const t = norm(userText);
  const yearMatch = t.match(/\b(19[9]\d|20[0-2]\d|203[0-5])\b/);
  const year = yearMatch ? yearMatch[0] : null;

  const vehicles = [
    "innova","avanza","xenia","rush","terios","fortuner","pajero","land cruiser","alphard",
    "civic","crv","brv","hrv","camry","yaris","brio","x-trail","xtrail","jazz","freed",
    "ertiga","xl7","apv","grand vitara","outlander","harrier","hilux","prado"
  ];
  const vehicle = vehicles.find(v => t.includes(v)) || null;
  return { vehicle, year };
}

// ====== SYMPTOMS ======
function detectSymptoms(userText) {
  const t = norm(userText);

  const hotNoGo = containsAny(t, [
    "panas gak bisa jalan","panas tidak bisa jalan","kalau panas gak jalan",
    "setelah panas tidak jalan","overheat","habis panas"
  ]);

  const noMove = containsAny(t, [
    "tidak bisa jalan","gak bisa jalan","mogok","tidak bergerak",
    "masuk d tapi tidak jalan","masuk r tapi tidak jalan","d tapi tidak jalan","r tapi tidak jalan"
  ]);

  const shiftFlare = containsAny(t, [
    "rpm tinggi baru masuk","rpm tinggi dulu baru masuk","gaung rpm tinggi baru masuk",
    "gear 2 rpm tinggi baru masuk","gigi 2 rpm tinggi baru masuk","pindah gigi 2 rpm tinggi",
    "flare","slip saat pindah gigi"
  ]);

  const slip = containsAny(t, ["selip","ngelos","rpm naik","tarikan hilang"]);
  const jerk = containsAny(t, ["jedug","hentak","sentak","ngentak"]);
  const lamp = containsAny(t, ["lampu","check","indikator","at oil","engine","warning"]);
  const noise = containsAny(t, ["dengung","berisik","suara aneh","ngorok","gaung"]);

  return { hotNoGo, noMove, shiftFlare, slip, jerk, lamp, noise };
}

// ====== SHORT REPLY BUILDERS ======
function replyPriceHunter(tier) {
  return [
    antiPriceShort(tier),
    "Kalau serius mau akurat: *datang / towing* untuk cek.",
    workshopCTA(),
  ].join("\n");
}

function replyPremiumHotNoGo(tier) {
  return [
    "⚠️ *Panas lalu tidak bisa jalan* = *case berat*, jangan dipaksa.",
    antiPriceShort(tier),
    towingShort(),
    "Jawab 2 hal: (1) D/R masuk tapi tidak gerak? (YA/TIDAK) (2) Lampu warning? (YA/TIDAK)",
    workshopCTA(),
  ].join("\n");
}

function replyNoMove(tier) {
  return [
    "🚫 *Tidak bisa jalan* = prioritas evakuasi/cek cepat.",
    antiPriceShort(tier),
    towingShort(),
    workshopCTA(),
  ].join("\n");
}

function replyShiftFlare({ vehicle, year, tier }) {
  const head = vehicle && year ? `✅ ${vehicle.toUpperCase()} ${year} terdeteksi.` : "✅ Gejala terdeteksi.";
  return [
    head,
    "Gejala *RPM tinggi baru masuk gigi* = indikasi *shift flare / slip perpindahan* (pressure/valve body/solenoid/clutch).",
    "🛑 Jangan tunggu sampai ‘hilang jalan’.",
    "Jawab 2 hal: (1) muncul saat dingin atau panas/macet? (2) pernah ganti oli transmisi kapan?",
    antiPriceShort(tier),
    workshopCTA(),
  ].join("\n");
}

function replyCoreInfo({ vehicle, year, tier, symptoms }) {
  const head = vehicle && year ? `✅ ${vehicle.toUpperCase()} ${year} terdeteksi.` : "✅ Oke, saya tangkap.";
  // pilih 1 kalimat gejala utama
  let main = "Gejala perlu dikunci lewat diagnosa.";
  if (symptoms.jerk) main = "Gejala *jedug/hentak* biasanya terkait kontrol tekanan/solenoid/valve body.";
  if (symptoms.slip) main = "Gejala *selip/rpm naik* biasanya terkait pressure/oli/clutch.";
  if (symptoms.noise) main = "Gejala *bunyi/dengung* perlu cek bearing/torque converter/pressure line.";
  if (symptoms.lamp) main = "Ada indikasi *lampu warning* → wajib scan data untuk kunci sumber.";

  return [
    head,
    `🔎 ${main}`,
    antiPriceShort(tier),
    "Jawab 2 hal: (1) muncul saat dingin atau panas/macet? (2) ada lampu indikator? (YA/TIDAK)",
    workshopCTA(),
  ].join("\n");
}

function replyIntakeShort() {
  return [
    "Baik. Jawab singkat 2 hal dulu ya:",
    "1) Mobil + tahun?",
    "2) Gejala utama (jedug/selip/panas/no move/rpm tinggi)?",
    workshopCTA(),
  ].join("\n");
}

// ====== ROUTER ======
function generateReply(userText) {
  const t = norm(userText);
  const tier = detectTier(t);
  const emotion = emotionalReading(t);
  const symptoms = detectSymptoms(t);
  const { vehicle, year } = extractVehicleYear(t);

  // Commands
  if (t === "jadwal") {
    return [
      "✅ *BOOKING CEPAT*",
      "Kirim: *NAMA / MOBIL / TAHUN / GEJALA / JAM DATANG*",
      workshopCTA(),
    ].join("\n");
  }

  if (t.includes("towing") || t.includes("derek")) {
    return [
      "🚚 *TOWING ACTIVE*",
      "Kirim *share lokasi* Anda + tulis: *TUJUAN: Hongz Bengkel*",
      workshopCTA(),
    ].join("\n");
  }

  if (t.includes("share lokasi")) {
    return [
      `🧭 Lokasi Hongz: ${MAPS_LINK}`,
      "Kalau unit tidak bisa jalan, ketik *TOWING* lalu kirim share lokasi Anda.",
    ].join("\n");
  }

  // Price hunters
  if (emotion === "PRICE_HUNTER") {
    return replyPriceHunter(tier);
  }

  // Urgent cases
  if ((tier === "PREMIUM" || tier === "MID_PREMIUM") && symptoms.hotNoGo) {
    return replyPremiumHotNoGo(tier);
  }

  if (symptoms.noMove) {
    return replyNoMove(tier);
  }

  if (symptoms.shiftFlare) {
    return replyShiftFlare({ vehicle, year, tier });
  }

  // If user already gave vehicle+year AND at least one symptom -> short direct
  const hasCoreInfo =
    Boolean(vehicle && year) &&
    (symptoms.slip || symptoms.jerk || symptoms.lamp || symptoms.noise || symptoms.hotNoGo || symptoms.noMove);

  if (hasCoreInfo) {
    return replyCoreInfo({ vehicle, year, tier, symptoms });
  }

  // Default intake
  return replyIntakeShort();
}

module.exports = { generateReply };
