// service.js
// Hongz AI Engine v4.5 - Premium Authority + Auto Admin Alert (Mode A)

function norm(s = "") {
  return String(s).toLowerCase().replace(/\s+/g, " ").trim();
}
function containsAny(text, arr) {
  return arr.some((k) => text.includes(k));
}

function moneyPolicyPremium() {
  return [
    "Untuk kendaraan premium, kami *tidak memberikan angka fix via chat* karena risiko salah estimasi tinggi.",
    "Biaya final ditentukan setelah *scan data + uji tekanan + cek suhu oli transmisi* (sering terkait kelistrikan/TCM/ECU/charging system).",
  ].join(" ");
}

function workshopCTA({ includeMaps = true } = {}) {
  const lines = [];
  lines.push("📍 *Arahan terbaik:* unit masuk workshop untuk diagnosa premium.");
  if (includeMaps) lines.push("🧭 Lokasi (Google Maps): https://maps.app.goo.gl/CvFZ9FLNJRog7K4t9");
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
    "hari ini","sekarang","darurat","mogok","tidak bisa jalan","gak bisa jalan","panas","overheat",
    "tolong","urgent","di jalan","di tol","minta towing","kapan bisa","booking",
    "alamat","lokasi","share lokasi","rute","datang"
  ];

  const signalsIseng = [
    "berapa aja","murahnya berapa","diskon","nego","termurah","paling murah",
    "cuma tanya","sekedar nanya","nggak jadi","iseng","test"
  ];

  const scoreSerius = signalsSerius.filter((k) => t.includes(k)).length;
  const scoreIseng = signalsIseng.filter((k) => t.includes(k)).length;

  let label = "NETRAL";
  if (scoreSerius >= 2 && scoreSerius > scoreIseng) label = "SERIOUS";
  if (scoreIseng >= 2 && scoreIseng >= scoreSerius) label = "PRICE_HUNTER";

  return { label, scoreSerius, scoreIseng };
}

// Vehicle tier detection
function detectTier(userText) {
  const t = norm(userText);

  const premiumModels = [
    "land cruiser","landcruiser","lc200","lc300","alphard","vellfire","lexus",
    "bmw","mercedes","benz","audi","porsche","range rover","land rover",
    "prado","g-class","gls","x7","cayenne"
  ];

  const midPremium = [
    "x-trail t32","xtrail t32","x trail t32",
    "crv turbo","cx-5","cx5","harrier","forester","outlander"
  ];

  if (containsAny(t, premiumModels)) return "PREMIUM";
  if (containsAny(t, midPremium)) return "MID_PREMIUM";
  return "REGULAR";
}

// Symptom detection
function detectSymptoms(userText) {
  const t = norm(userText);

  const hotNoGo = containsAny(t, [
    "panas gak bisa jalan","panas tidak bisa jalan","kalau panas gak jalan",
    "setelah panas tidak jalan","overheat","panas lalu tidak jalan"
  ]);

  const noMove = containsAny(t, [
    "tidak bisa jalan","gak bisa jalan","mogok","tidak bergerak",
    "masuk d","masuk r","d tapi tidak jalan","r tapi tidak jalan"
  ]);

  const slip = containsAny(t, ["selip","ngelos","rpm naik","tarikan hilang"]);
  const jerk = containsAny(t, ["jedug","hentak","sentak"]);
  const lamp = containsAny(t, ["lampu","check","indikator","at oil","engine","warning","mil"]);
  const noise = containsAny(t, ["dengung","berisik","suara aneh","ngorok"]);

  return { hotNoGo, noMove, slip, jerk, lamp, noise };
}

function symptomSummary(sym) {
  const arr = [];
  if (sym.hotNoGo) arr.push("panas lalu tidak jalan");
  if (sym.noMove) arr.push("tidak bisa jalan");
  if (sym.slip) arr.push("selip/rpm naik");
  if (sym.jerk) arr.push("jedug/hentak");
  if (sym.lamp) arr.push("lampu warning");
  if (sym.noise) arr.push("suara aneh");
  return arr.length ? arr.join(", ") : "belum jelas";
}

function calcUrgency({ tier, symptoms, emotion }) {
  // HIGH kalau: tidak bisa jalan / hot-no-go / towing keywords / premium serious
  if (symptoms.noMove || symptoms.hotNoGo) return "HIGH";
  if (tier !== "REGULAR" && emotion.label === "SERIOUS") return "HIGH";
  if (emotion.label === "PRICE_HUNTER") return "LOW";
  return "MEDIUM";
}

function buildPremiumHotNoGoReply() {
  const opening = [
    "✅ *Unit premium & heavy-duty.*",
    "Jika *saat panas mobil tidak bisa jalan*, ini *bukan kasus ringan* dan *tidak aman* diselesaikan via chat.",
  ].join("\n");

  const diagnosisFrame = [
    "⚠️ Pola seperti ini sering terkait *proteksi suhu / pressure drop / kontrol modul (TCM/ECU)*.",
    "Pada unit premium, masalah transmisi sering punya kausalitas dengan:",
    "• kelistrikan/alternator/battery drop",
    "• ECU/TCM/solenoid/sensor suhu",
    "• sistem pendinginan oli transmisi",
    "• engine load & data temperatur",
  ].join("\n");

  const hardRule = [
    "🛑 *Aturan kami:* jangan dipaksakan jalan saat kondisi panas seperti ini.",
    "Jika dipaksa, kerusakan bisa menjalar (clutch pack/torque converter/valve body) dan biaya bisa melebar.",
  ].join("\n");

  const antiNego = [
    "🛡 *Mode Anti-Negosiasi Harga:* kami tidak mengunci angka via chat untuk unit premium.",
    moneyPolicyPremium(),
  ].join("\n");

  const fastTriage = [
    "Jawab cepat 2 hal ini (cukup YA/TIDAK):",
    "1) Saat panas, posisi *D/R* masuk tapi *tidak bergerak*?",
    "2) Ada *lampu warning* menyala?",
  ].join("\n");

  const close = [
    "🎯 *Langkah paling benar:* unit masuk workshop untuk diagnosa premium (scan + test pressure + cek suhu oli).",
    towingMode(),
    workshopCTA({ includeMaps: true }),
  ].join("\n\n");

  return [opening, diagnosisFrame, hardRule, antiNego, fastTriage, close].join("\n\n");
}

function buildPriceHunterReply() {
  return [
    "Untuk transmisi matic *kami tidak kunci harga dari chat* karena harus diagnosa dulu.",
    "Jika Anda serius ingin beres, silakan *datang atau towing* ke workshop untuk pengecekan.",
    workshopCTA({ includeMaps: true }),
  ].join("\n\n");
}

function buildRegularReply() {
  return [
    "Baik, kami bantu cek ya. Agar cepat tepat, mohon jawab singkat:",
    "1) Mobil apa + tahun berapa?",
    "2) Gejala utama: jedug/selip/overheat/tidak bisa jalan?",
    "3) Pernah servis transmisi sebelumnya? kapan?",
    "",
    "Setelah itu kami arahkan langkah terbaik (diagnosa / jadwal / towing).",
    workshopCTA({ includeMaps: true }),
  ].join("\n");
}

function addUpsellOverhaul(baseText) {
  const upsell = [
    "💰 *Mode Upselling Overhaul:* jika setelah diagnosa terbukti kerusakan internal (clutch/valve body/torque converter),",
    "kami rekomendasikan *overhaul standar Hongz* agar hasil awet, bukan tambal-jalan.",
    "Unit premium = kami prioritaskan *quality & warranty mindset* (bukan sekadar murah).",
  ].join("\n");
  return `${baseText}\n\n${upsell}`;
}

function autoClosingByUrgency({ tier, symptoms, emotion }) {
  if (symptoms.noMove || symptoms.hotNoGo) {
    return "📌 *Urgent:* pilihan terbaik adalah *towing ke workshop hari ini* agar tidak melebar.";
  }
  if (tier !== "REGULAR" && emotion.label === "SERIOUS") {
    return "📌 Untuk unit premium, kami bisa *prioritaskan slot pemeriksaan* supaya cepat ketemu akar masalah.";
  }
  return "📌 Jika siap, ketik *JADWAL* untuk booking, atau *TOWING* bila unit tidak bisa jalan.";
}

function generateReply(userText, { fromCustomer } = {}) {
  const t = norm(userText);
  const tier = detectTier(t);
  const emotion = emotionalReading(t);
  const symptoms = detectSymptoms(t);

  // Commands
  if (t === "jadwal") {
    const reply = [
      "✅ *Booking cepat:*",
      "Kirim format: *NAMA / MOBIL / TAHUN / GEJALA / JAM DATANG*",
      workshopCTA({ includeMaps: true }),
    ].join("\n");

    return {
      reply,
      meta: {
        shouldAlertAdmin: true,
        tier,
        emotionLabel: emotion.label,
        urgency: "MEDIUM",
        symptomSummary: symptomSummary(symptoms),
        recommendation: "Customer minta booking. Follow-up untuk konfirmasi jadwal & slot.",
        fromCustomer,
      },
    };
  }

  if (t.includes("towing") || t.includes("derek")) {
    const reply = [
      towingMode(),
      "Kirim *share lokasi* Anda + tulis: *ALAMAT TUJUAN: Hongz Bengkel*",
      "Kami arahkan prosesnya.",
      workshopCTA({ includeMaps: true }),
    ].join("\n\n");

    return {
      reply,
      meta: {
        shouldAlertAdmin: true,
        tier,
        emotionLabel: emotion.label,
        urgency: "HIGH",
        symptomSummary: symptomSummary(symptoms),
        recommendation: "Customer minta towing. Ambil alih untuk koordinasi evakuasi & titik jemput.",
        fromCustomer,
      },
    };
  }

  if (t.includes("share lokasi")) {
    const reply = [
      "Siap. Ini link lokasi workshop Hongz:",
      "https://maps.app.goo.gl/CvFZ9FLNJRog7K4t9",
      "Jika Anda ingin kami arahkan towing, ketik *TOWING* lalu kirim share lokasi Anda.",
    ].join("\n");

    return {
      reply,
      meta: {
        shouldAlertAdmin: false,
        tier,
        emotionLabel: emotion.label,
        urgency: "MEDIUM",
        symptomSummary: symptomSummary(symptoms),
        recommendation: "Customer minta lokasi. Dorong datang / jadwal / towing.",
        fromCustomer,
      },
    };
  }

  // Price hunters
  if (emotion.label === "PRICE_HUNTER") {
    const reply = buildPriceHunterReply();
    return {
      reply,
      meta: {
        shouldAlertAdmin: false,
        tier,
        emotionLabel: emotion.label,
        urgency: "LOW",
        symptomSummary: symptomSummary(symptoms),
        recommendation: "Price hunter. Jangan buang waktu, tetap arahkan ke diagnosa.",
        fromCustomer,
      },
    };
  }

  // Premium & hot-no-go / no-move
  const urgency = calcUrgency({ tier, symptoms, emotion });

  if ((tier === "PREMIUM" || tier === "MID_PREMIUM") && symptoms.hotNoGo) {
    const base = buildPremiumHotNoGoReply();
    const withUpsell = addUpsellOverhaul(base);
    const closing = autoClosingByUrgency({ tier, symptoms, emotion });

    return {
      reply: `${withUpsell}\n\n${closing}`,
      meta: {
        shouldAlertAdmin: true, // penting
        tier,
        emotionLabel: emotion.label,
        urgency,
        symptomSummary: symptomSummary(symptoms),
        recommendation: "Premium hot-no-go. Sarankan towing + prioritas diagnosa premium.",
        fromCustomer,
      },
    };
  }

  if ((tier === "PREMIUM" || tier === "MID_PREMIUM") && symptoms.noMove) {
    const base = [
      "✅ Unit Anda kategori *premium*.",
      "Jika *tidak bisa jalan*, kami aktifkan *Mode TOWING* + diagnosa premium.",
      towingMode(),
      moneyPolicyPremium(),
      workshopCTA({ includeMaps: true }),
      autoClosingByUrgency({ tier, symptoms, emotion }),
    ].join("\n\n");

    return {
      reply: addUpsellOverhaul(base),
      meta: {
        shouldAlertAdmin: true,
        tier,
        emotionLabel: emotion.label,
        urgency: "HIGH",
        symptomSummary: symptomSummary(symptoms),
        recommendation: "Premium no-move. Dorong towing & ambil alih untuk koordinasi cepat.",
        fromCustomer,
      },
    };
  }

  // Default
  const reply = `${buildRegularReply()}\n\n${autoClosingByUrgency({ tier, symptoms, emotion })}`;

  // Alert admin kalau serius + medium/high urgency
  const shouldAlertAdmin = urgency !== "LOW" && emotion.label === "SERIOUS";

  return {
    reply,
    meta: {
      shouldAlertAdmin,
      tier,
      emotionLabel: emotion.label,
      urgency,
      symptomSummary: symptomSummary(symptoms),
      recommendation: shouldAlertAdmin
        ? "Lead serius terdeteksi. Follow-up cepat untuk booking & arahkan datang."
        : "Normal lead. Lanjutkan tanya detail lalu arahkan jadwal.",
      fromCustomer,
    },
  };
}

module.exports = { generateReply };
