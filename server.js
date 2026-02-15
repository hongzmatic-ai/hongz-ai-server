// service.js
// Hongz AI Engine v4.0 - Premium Authority Mode
// Focus: WhatsApp inbound -> classify -> respond -> push to workshop/towing

function norm(s = "") {
  return String(s).toLowerCase().replace(/\s+/g, " ").trim();
}

function containsAny(text, arr) {
  return arr.some(k => text.includes(k));
}

function moneyPolicyPremium() {
  // NO hard numbers (anti-jebakan harga). Use positioning + diagnostic gate.
  return [
    "Untuk kendaraan premium, kami *tidak memberikan angka fix via chat* karena risiko salah estimasi tinggi dan sering berbeda jauh di lapangan.",
    "Biaya final ditentukan setelah *scan data, uji tekanan, dan cek suhu oli transmisi* (sering terkait kelistrikan/TCM/ECU/charging system).",
  ].join(" ");
}

function workshopCTA({ includeMaps = true } = {}) {
  const lines = [];
  lines.push("📍 *Arahan terbaik:* bawa unit ke workshop untuk diagnosa premium.");
  if (includeMaps) {
    lines.push("🧭 Lokasi (Google Maps): https://maps.app.goo.gl/CvFZ9FLNJRog7K4t9");
  }
  lines.push("⏱ Jam buka: Senin–Sabtu 09.00–17.00");
  lines.push("Ketik: *JADWAL* untuk booking cepat / *TOWING* bila unit tidak bisa jalan.");
  return lines.join("\n");
}

function towingMode() {
  return [
    "🚚 *Mode TOWING aktif.*",
    "Kalau mobil *tidak bisa jalan* / takut makin parah, *jangan dipaksakan*.",
    "Ketik *TOWING* + kirim *share lokasi* Anda, nanti tim kami arahkan evakuasi ke workshop.",
  ].join("\n");
}

// Emotional Reading (serius vs iseng)
function emotionalReading(userText) {
  const t = norm(userText);

  const signalsSerius = [
    "hari ini", "sekarang", "darurat", "mogok", "tidak bisa jalan", "panas", "overheat",
    "tolong", "urgent", "di jalan", "di tol", "minta towing", "kapan bisa", "booking",
    "alamat", "lokasi", "share lokasi", "rute", "datang"
  ];

  const signalsIseng = [
    "berapa aja", "murahnya berapa", "diskon", "nego", "termurah", "paling murah",
    "cuma tanya", "sekedar nanya", "nggak jadi", "iseng", "test"
  ];

  const scoreSerius = signalsSerius.filter(k => t.includes(k)).length;
  const scoreIseng = signalsIseng.filter(k => t.includes(k)).length;

  let label = "NETRAL";
  if (scoreSerius >= 2 && scoreSerius > scoreIseng) label = "SERIOUS";
  if (scoreIseng >= 2 && scoreIseng >= scoreSerius) label = "PRICE_HUNTER";

  return { label, scoreSerius, scoreIseng };
}

// Vehicle tier detection
function detectTier(userText) {
  const t = norm(userText);

  const premiumModels = [
    "land cruiser", "landcruiser", "lc200", "lc300", "alphard", "vellfire", "lexus",
    "bmw", "mercedes", "benz", "audi", "porsche", "range rover", "land rover",
    "fortuner vrz", "pajero sport dakar", "hilux gr", "prado"
  ];

  const midPremium = [
    "x-trail t32", "xtrail t32", "x trail t32",
    "crv turbo", "cx-5", "cx5", "harrier", "forester", "outlander"
  ];

  if (containsAny(t, premiumModels)) return "PREMIUM";
  if (containsAny(t, midPremium)) return "MID_PREMIUM";
  return "REGULAR";
}

// Symptom detection
function detectSymptoms(userText) {
  const t = norm(userText);

  const hotNoGo = containsAny(t, ["panas gak bisa jalan", "panas tidak bisa jalan", "kalau panas gak jalan", "setelah panas tidak jalan", "overheat"]);
  const noMove = containsAny(t, ["tidak bisa jalan", "gak bisa jalan", "mogok", "tidak bergerak", "masuk d", "masuk r", "d tapi tidak jalan"]);
  const slip = containsAny(t, ["selip", "ngelos", "rpm naik", "tarikan hilang"]);
  const jerk = containsAny(t, ["jedug", "hentak", "sentak"]);
  const lamp = containsAny(t, ["lampu", "check", "indikator", "at oil", "engine", "warning"]);
  const noise = containsAny(t, ["dengung", "berisik", "suara aneh", "ngorok"]);

  return { hotNoGo, noMove, slip, jerk, lamp, noise };
}

function buildPremiumHotNoGoReply(userText) {
  // LAND CRUISER 2019 – HIGH AUTHORITY + DIRECT TO WORKSHOP + TOWING OPTION
  const opening = [
    "✅ *Land Cruiser (2019) = unit premium & heavy-duty.*",
    "Kalau *saat panas mobil tidak bisa jalan*, itu *bukan kasus ringan* dan *tidak aman* ditangani lewat chat.",
  ].join("\n");

  const diagnosisFrame = [
    "⚠️ Pola seperti ini sering terkait *proteksi suhu / pressure drop / kontrol modul (TCM/ECU)*.",
    "Dan pada mobil premium, masalah transmisi *sering punya kausalitas* dengan:",
    "• kelistrikan/alternator/battery drop",
    "• ECU/TCM/solenoid/sensor suhu",
    "• sistem pendinginan oli transmisi",
    "• engine load & data temperatur",
  ].join("\n");

  const hardRule = [
    "🛑 *Aturan kami:* Jangan dipaksakan jalan saat kondisi panas seperti ini.",
    "Karena kalau dipaksa, kerusakan bisa menjalar (clutch pack/torque converter/valve body) dan biaya bisa melebar.",
  ].join("\n");

  const antiNego = [
    "🛡 *Mode Anti-Negosiasi Harga:* Kami tidak mengunci angka via chat untuk unit premium.",
    moneyPolicyPremium(),
  ].join("\n");

  const fastTriage = [
    "Jawab cepat 2 hal ini (cukup angka):",
    "1) Saat panas, posisi *D/R* masih masuk tapi *tidak bergerak*? (YA/TIDAK)",
    "2) Ada *lampu warning* menyala? (YA/TIDAK)",
  ].join("\n");

  const close = [
    "🎯 *Langkah paling benar:* unit masuk workshop untuk diagnosa premium (scan + test pressure + cek suhu oli).",
    towingMode(),
    workshopCTA({ includeMaps: true }),
  ].join("\n\n");

  return [opening, diagnosisFrame, hardRule, antiNego, fastTriage, close].join("\n\n");
}

function buildPriceHunterReply() {
  // Tegas, singkat, tetap mengarahkan
  return [
    "Untuk transmisi matic *kami tidak kunci harga dari chat* karena harus diagnosa dulu.",
    "Kalau ingin estimasi akurat, *datang atau towing* ke workshop untuk pengecekan.",
    workshopCTA({ includeMaps: true }),
  ].join("\n\n");
}

function buildRegularReply(userText) {
  // Default: tetap ringkas, arahkan ke detail penting + closing
  return [
    "Baik, kami bantu cek ya. Agar cepat tepat, mohon jawab singkat:",
    "1) Mobil apa + tahun berapa?",
    "2) Gejala utama: jedug/selip/ndut/overheat/tidak bisa jalan?",
    "3) Pernah servis transmisi sebelumnya? kapan?",
    "",
    "Setelah itu kami arahkan langkah terbaik (diagnosa / jadwal / towing).",
    workshopCTA({ includeMaps: true }),
  ].join("\n");
}

// Upsell Overhaul mode (dipakai saat gejala parah / premium)
function addUpsellOverhaul(baseText) {
  const upsell = [
    "💰 *Mode Upselling Overhaul:* Jika setelah diagnosa terbukti kerusakan internal (clutch/valve body/torque converter),",
    "kami rekomendasikan *overhaul standar Hongz* agar hasil awet, bukan tambal-jalan.",
    "Unit premium = kami prioritaskan *quality & warranty mindset* (bukan sekadar murah).",
  ].join("\n");
  return `${baseText}\n\n${upsell}`;
}

// Auto closing by urgency
function autoClosingByUrgency({ tier, symptoms, emotion }) {
  if (symptoms.noMove || symptoms.hotNoGo) {
    return "📌 *Urgent:* Kalau unit tidak bisa jalan / panas lalu mati jalan, pilihan terbaik adalah *towing ke workshop hari ini* agar tidak melebar.";
  }
  if (tier !== "REGULAR" && emotion.label === "SERIOUS") {
    return "📌 Untuk unit premium, kami bisa *prioritaskan slot pemeriksaan* supaya cepat ketemu akar masalah.";
  }
  return "📌 Jika Anda siap, ketik *JADWAL* untuk booking, atau *TOWING* bila unit tidak bisa jalan.";
}

function generateReply(userText) {
  const t = norm(userText);
  const tier = detectTier(t);
  const emotion = emotionalReading(t);
  const symptoms = detectSymptoms(t);

  // Commands
  if (t === "jadwal") {
    return [
      "✅ *Booking cepat:*",
      "Kirim format: *NAMA / MOBIL / TAHUN / GEJALA / JAM DATANG*",
      workshopCTA({ includeMaps: true }),
    ].join("\n");
  }

  if (t.includes("towing") || t.includes("derek")) {
    return [
      towingMode(),
      "Kirim *share lokasi* Anda + tulis: *ALAMAT TUJUAN: Hongz Bengkel*",
      "Kami arahkan prosesnya.",
      workshopCTA({ includeMaps: true }),
    ].join("\n\n");
  }

  if (t.includes("share lokasi")) {
    return [
      "Siap. Ini link lokasi workshop Hongz:",
      "https://maps.app.goo.gl/CvFZ9FLNJRog7K4t9",
      "Jika Anda ingin kami arahkan towing, ketik *TOWING* lalu kirim share lokasi Anda.",
    ].join("\n");
  }

  // Price hunters
  if (emotion.label === "PRICE_HUNTER") {
    return buildPriceHunterReply();
  }

  // Premium hot-no-go special (Land Cruiser type)
  if ((tier === "PREMIUM" || tier === "MID_PREMIUM") && symptoms.hotNoGo) {
    const base = buildPremiumHotNoGoReply(userText);
    const withUpsell = addUpsellOverhaul(base);
    const closing = autoClosingByUrgency({ tier, symptoms, emotion });
    return `${withUpsell}\n\n${closing}`;
  }

  // Premium no-move (even if not hot keyword)
  if ((tier === "PREMIUM" || tier === "MID_PREMIUM") && symptoms.noMove) {
    const base = [
      "✅ Unit Anda kategori *premium*.",
      "Jika *tidak bisa jalan*, kami aktifkan *Mode TOWING* + diagnosa premium.",
      towingMode(),
      moneyPolicyPremium(),
      workshopCTA({ includeMaps: true }),
      autoClosingByUrgency({ tier, symptoms, emotion }),
    ].join("\n\n");
    return addUpsellOverhaul(base);
  }

  // Default
  return `${buildRegularReply(userText)}\n\n${autoClosingByUrgency({ tier, symptoms, emotion })}`;
}

module.exports = { generateReply };
