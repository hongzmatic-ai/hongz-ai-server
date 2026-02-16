// service.js — Hongz Hybrid Engine v4.2 (No OpenAI; fast & controlled)

const MAPS = process.env.MAPS_LINK || "https://maps.app.goo.gl/CvFZ9FLNJRog7K4t9";
const BIZ_NAME = process.env.BIZ_NAME || "Hongz Bengkel Spesialis Transmisi Matic";
const BIZ_ADDRESS = process.env.BIZ_ADDRESS || "Jl. M. Yakub No.10b, Medan Perjuangan";
const BIZ_HOURS = process.env.BIZ_HOURS || "Senin–Sabtu 09.00–17.00";

function norm(s = "") {
  return String(s).toLowerCase().replace(/\s+/g, " ").trim();
}
function hasAny(t, arr) {
  return arr.some(w => t.includes(w));
}

function detectTier(t) {
  const premium = [
    "land cruiser","landcruiser","lc200","lc300","alphard","vellfire","lexus",
    "bmw","mercedes","mercy","benz","audi","porsche","range rover","land rover","prado","jaguar"
  ];
  const complex = [
    "x-trail","xtrail","t32","cr-v","crv","cx-5","cx5","harrier","forester","outlander",
    "turbo","hybrid","cvt","dsg","dct"
  ];
  if (hasAny(t, premium)) return "PREMIUM";
  if (hasAny(t, complex)) return "COMPLEX";
  return "STANDARD";
}

function detectSymptoms(t) {
  const hotNoGo = hasAny(t, ["panas gak bisa jalan","panas tidak bisa jalan","kalau panas gak jalan","setelah panas tidak jalan","overheat"]);
  const noMove = hasAny(t, ["tidak bisa jalan","gak bisa jalan","nggak bisa jalan","mogok","tidak bergerak","d tapi tidak jalan","r tapi tidak jalan","tidak mau masuk d","tidak mau masuk r"]);
  const slip = hasAny(t, ["selip","ngelos","rpm naik","tarikan hilang"]);
  const jerk = hasAny(t, ["jedug","hentak","sentak","nyentak"]);
  const warning = hasAny(t, ["warning","check","indikator","at oil","engine","transmission fault","limp mode"]);
  return { hotNoGo, noMove, slip, jerk, warning };
}

function detectNegotiation(t) {
  return hasAny(t, ["diskon","nego","murahin","kurangin","harga teman","kemahalan","paling murah","bengkel lain cuma","promo"]);
}

function detectLocationIntent(t) {
  return hasAny(t, ["lokasi","alamat","maps","peta","rute","arah","share lokasi"]);
}

function detectBookingIntent(t) {
  return hasAny(t, ["jadwal","booking","boking","reservasi","schedule","slot","datang jam","kapan bisa"]);
}

function detectUrgent(t, sym) {
  let u = 1;
  if (hasAny(t, ["hari ini","sekarang","urgent","darurat","segera","di jalan","di tol"])) u += 2;
  if (sym.noMove) u += 5;
  if (sym.hotNoGo) u += 3;
  if (hasAny(t, ["bau gosong","asap"])) u += 2;
  return Math.max(1, Math.min(10, u));
}

function emotionalReading(t) {
  let s = 50;
  if (t.length < 8) s -= 15;
  if (detectNegotiation(t)) s -= 10;
  if (hasAny(t, ["tahun","tipe","km","odo","gejala","scan","error","kode","tcm","ecu","aki","alternator"])) s += 15;
  return Math.max(0, Math.min(100, s));
}

function leadTier(vehicleTier, urgency, seriousScore) {
  let s = 0;
  if (vehicleTier === "PREMIUM") s += 40;
  else if (vehicleTier === "COMPLEX") s += 20;
  else s += 10;

  if (urgency >= 8) s += 25;
  else if (urgency >= 5) s += 15;

  if (seriousScore >= 70) s += 15;
  else if (seriousScore >= 45) s += 8;

  if (s >= 70) return "A";
  if (s >= 45) return "B";
  return "C";
}

function workshopBlock() {
  return `📍 ${BIZ_NAME}\n${BIZ_ADDRESS}\n⏰ ${BIZ_HOURS}\n🗺️ ${MAPS}`;
}

function towingBlock() {
  return `🚚 *AUTO TOWING MODE*\nKalau unit tidak bisa jalan / panas lalu mati jalan → *jangan dipaksakan*.\nKetik *TOWING* + kirim *share lokasi* Anda.`;
}

function premiumEmergencyReply(sym) {
  // Premium + hotNoGo/noMove => Full authority
  return [
    "✅ *PROTOKOL PREMIUM DARURAT AKTIF.*",
    "Gejala *panas lalu tidak bisa jalan* / *no move* pada unit premium = indikasi serius.",
    "⚠️ Ini sering terkait *overheat/pressure drop/kontrol TCM/ECU* dan bisa dipicu *kelistrikan (aki/alternator)* + sistem pendinginan.",
    "🛑 Jangan dipaksakan jalan. Risiko kerusakan melebar (valve body/torque converter/clutch).",
    "🛡 Kami *tidak mengunci angka via chat* untuk unit premium. Estimasi valid setelah *scan + test pressure + cek suhu oli + cek kelistrikan*.",
    towingBlock(),
    workshopBlock(),
    "Jawab cepat (YA/TIDAK): 1) D/R masuk tapi tidak gerak? 2) Warning menyala?"
  ].join("\n\n");
}

function antiNegoReply() {
  return [
    "🛡 *ANTI-NEGO MODE*",
    "Kami fokus *hasil & ketahanan*, bukan perang harga.",
    "Estimasi final hanya setelah diagnosa agar akurat dan adil.",
    workshopBlock(),
    "Ketik *JADWAL* untuk booking atau *TOWING* jika tidak bisa jalan."
  ].join("\n\n");
}

function locationReply() {
  return [
    "Ini lokasi bengkel Hongz:",
    workshopBlock(),
    "Balas: *OTW* kalau langsung datang / *TOWING* kalau unit tidak bisa jalan."
  ].join("\n");
}

function bookingReply() {
  return [
    "✅ *BOOKING CEPAT*",
    "Kirim format: *NAMA / MOBIL / TAHUN / GEJALA / JAM DATANG*",
    workshopBlock()
  ].join("\n");
}

function defaultTriageReply(vehicleTier) {
  const tierLine = vehicleTier === "PREMIUM"
    ? "Unit Anda *PREMIUM* → kami sarankan inspeksi lebih cepat & prioritas."
    : vehicleTier === "COMPLEX"
      ? "Unit Anda *sistem kompleks* → perlu diagnosa detail (sensor/modul/kelistrikan)."
      : "Unit standar → kami arahkan diagnosa cepat & tepat.";

  return [
    tierLine,
    "Jawab singkat ya:",
    "1) Mobil + tahun?",
    "2) Gejala utama (jedug/selip/panas/no move)?",
    "3) Kapan mulai terasa (dingin/panas/macet)?",
    workshopBlock(),
    "Ketik *JADWAL* untuk booking / *TOWING* bila unit tidak bisa jalan."
  ].join("\n");
}

// HYBRID: determine takeover to admin
function shouldHandoff(meta) {
  // Handoff rule: Tier A OR Premium + urgency>=6 OR towing/nomove OR customer asks human
  if (meta.userAskedHuman) return true;
  if (meta.leadTier === "A") return true;
  if (meta.vehicleTier === "PREMIUM" && meta.urgency >= 6) return true;
  if (meta.symptoms.noMove || meta.symptoms.hotNoGo) return true;
  return false;
}

function summarizeForAdmin(originalText, meta) {
  return [
    "🔥 *LEAD HANDOFF (PRIORITY)*",
    `From: ${meta.from}`,
    `Tier: ${meta.vehicleTier} | Lead: ${meta.leadTier} | Urgency: ${meta.urgency}/10`,
    `Symptoms: hotNoGo=${meta.symptoms.hotNoGo} noMove=${meta.symptoms.noMove} slip=${meta.symptoms.slip} jerk=${meta.symptoms.jerk} warn=${meta.symptoms.warning}`,
    `Text: ${originalText}`,
    `Maps bengkel: ${MAPS}`,
    "Saran: follow-up cepat → tawarkan slot + towing jika perlu."
  ].join("\n");
}

// MAIN
function generateReplyWithMeta(userText, from = "") {
  const t = norm(userText);

  const vehicleTier = detectTier(t);
  const symptoms = detectSymptoms(t);
  const urgency = detectUrgent(t, symptoms);
  const seriousScore = emotionalReading(t);
  const lead = leadTier(vehicleTier, urgency, seriousScore);

  const userAskedHuman = hasAny(t, ["admin", "papa", "cs", "manusia", "owner", "operator"]);

  const meta = {
    from,
    vehicleTier,
    symptoms,
    urgency,
    seriousScore,
    leadTier: lead,
    userAskedHuman
  };

  // Commands
  if (t === "jadwal" || (detectBookingIntent(t) && t.length <= 20)) {
    return { reply: bookingReply(), meta, handoff: false };
  }

  if (t.includes("towing") || t.includes("derek")) {
    return { reply: `${towingBlock()}\n\n${workshopBlock()}\n\nKirim *share lokasi* Anda sekarang ya.`, meta, handoff: true };
  }

  if (detectLocationIntent(t)) {
    return { reply: locationReply(), meta, handoff: false };
  }

  // Anti nego
  if (detectNegotiation(t) && !symptoms.noMove && !symptoms.hotNoGo) {
    return { reply: antiNegoReply(), meta, handoff: false };
  }

  // Premium emergency protocol
  if (vehicleTier === "PREMIUM" && (symptoms.hotNoGo || symptoms.noMove)) {
    return { reply: premiumEmergencyReply(symptoms), meta, handoff: true };
  }

  // Complex + severe
  if (vehicleTier === "COMPLEX" && (symptoms.hotNoGo || symptoms.noMove) && urgency >= 6) {
    const reply = [
      "⚠️ *Kasus serius pada sistem kompleks.* Jangan dipaksakan jalan.",
      "Bisa terkait CVT/pressure/overheat + modul kontrol & kelistrikan.",
      towingBlock(),
      workshopBlock(),
      "Jawab cepat: Mobil+tahun dan posisi Anda (area/kecamatan)?"
    ].join("\n\n");
    return { reply, meta, handoff: true };
  }

  // Default triage
  return { reply: defaultTriageReply(vehicleTier), meta, handoff: shouldHandoff(meta) };
}

module.exports = { generateReplyWithMeta, summarizeForAdmin };
