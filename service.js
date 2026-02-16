// service.js
// Hongz AI Engine v4.1 HYBRID (Rule-based + AI)
// Goal: Natural response (not kaku), High Authority, Anti-Nego, Push to Workshop/Towing

const OpenAI = require("openai");

function norm(s = "") {
  return String(s).toLowerCase().replace(/\s+/g, " ").trim();
}
function containsAny(text, arr) {
  return arr.some((k) => text.includes(k));
}

function workshopCTA() {
  return [
    "📍 Hongz Bengkel Spesialis Transmisi Matic",
    "Jl. M. Yakub No.10b, Medan Perjuangan",
    "🧭 Maps: https://maps.app.goo.gl/CvFZ9FLNJRog7K4t9",
    "⏱ Senin–Sabtu 09.00–17.00",
    "Ketik: *JADWAL* untuk booking / *TOWING* bila unit tidak bisa jalan."
  ].join("\n");
}

function towingText() {
  return [
    "🚚 *Mode TOWING aktif.*",
    "Kalau mobil tidak bisa jalan / panas lalu mati jalan: *jangan dipaksakan*.",
    "Ketik *TOWING* + kirim *share lokasi* Anda, tim kami arahkan evakuasi."
  ].join("\n");
}

function moneyPolicyPremium() {
  return [
    "🛡 *Anti-Negosiasi:* Untuk transmisi matic, apalagi unit premium/kerusakan berat, kami *tidak mengunci angka via chat*.",
    "Estimasi akurat wajib lewat *scan data + cek tekanan + cek suhu oli + evaluasi kelistrikan/TCM/ECU*.",
    "Kalau ada yang pancing angka, kami tahan dulu—supaya hasilnya fair & tidak salah arah."
  ].join("\n");
}

function detectTier(t) {
  const premium = [
    "land cruiser","landcruiser","lc200","lc300","alphard","vellfire","lexus",
    "bmw","mercedes","benz","audi","porsche","range rover","land rover","prado"
  ];
  const mid = ["x-trail t32","xtrail t32","crv turbo","cx-5","cx5","harrier","forester","outlander"];
  if (containsAny(t, premium)) return "PREMIUM";
  if (containsAny(t, mid)) return "MID_PREMIUM";
  return "REGULAR";
}

function detectSymptoms(t) {
  const hotNoGo = containsAny(t, ["panas gak bisa jalan","kalau panas gak jalan","overheat","panas tidak bisa jalan"]);
  const noMove = containsAny(t, ["tidak bisa jalan","gak bisa jalan","mogok","d tapi tidak jalan","r tapi tidak jalan"]);
  const jerk = containsAny(t, ["jedug","hentak","sentak"]);
  const slip = containsAny(t, ["selip","ngelos","rpm naik","tarikan hilang","rpm tinggi baru masuk"]);
  const shiftDelay = containsAny(t, ["telat pindah gigi","rpm tinggi baru masuk","gigi 2 rpm tinggi"]);
  return { hotNoGo, noMove, jerk, slip, shiftDelay };
}

function isPriceHunter(t) {
  const bait = ["murah","termurah","nego","diskon","berapa aja","angka dulu","budget"];
  return containsAny(t, bait);
}

function commandReply(t) {
  if (t === "jadwal") {
    return [
      "✅ *Booking cepat* (copy format ini):",
      "*NAMA / MOBIL / TAHUN / GEJALA / JAM DATANG (hari ini/besok)*",
      workshopCTA()
    ].join("\n\n");
  }
  if (t.includes("towing") || t.includes("derek")) {
    return [
      towingText(),
      "Kirim *share lokasi* Anda + tulis: *NAMA / MOBIL / PLAT*",
      workshopCTA()
    ].join("\n\n");
  }
  if (t.includes("share lokasi")) {
    return [
      "Siap. Ini link lokasi workshop Hongz:",
      "https://maps.app.goo.gl/CvFZ9FLNJRog7K4t9",
      "Jika butuh evakuasi: ketik *TOWING* lalu kirim share lokasi Anda."
    ].join("\n");
  }
  return null;
}

// ---------- AI PART (makes it "hidup") ----------
function buildSystemPrompt({ tier }) {
  return `
Anda adalah CS WhatsApp "Hongz Bengkel Spesialis Transmisi Matic" Medan.
Gaya: singkat, tegas, high authority, profesional, tidak bertele-tele.
Tujuan bisnis: arahkan pelanggan datang ke bengkel / towing bila perlu.
Aturan wajib:
- Jangan kasih harga fix via chat. Boleh "estimasi hanya setelah diagnosa" + jelaskan kenapa (transmisi terkait kelistrikan/ECU/TCM/dll).
- Tanyakan MAX 2 pertanyaan kunci (biar tidak seperti kuesioner panjang).
- Jika gejala berat / tidak bisa jalan / panas lalu mati jalan → sarankan towing, jangan dipaksa.
- Akhiri dengan CTA: JADWAL / TOWING + alamat + maps.
Tier kendaraan saat ini: ${tier}.
Output: 1 pesan WhatsApp (maks 900 karakter), bahasa Indonesia.
`.trim();
}

async function aiReply(userText, { tier, symptoms }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    // Fallback kalau API key belum dipasang
    return [
      "Baik, kami pahami. Agar tidak salah arah, kami butuh diagnosa singkat di workshop.",
      "Jawab 2 hal ini: 1) muncul jedug/selip/atau rpm tinggi? 2) terjadi saat panas atau dingin?",
      workshopCTA()
    ].join("\n\n");
  }

  const client = new OpenAI({ apiKey });

  const hint = [];
  if (symptoms.hotNoGo || symptoms.noMove) hint.push("URGENCY: tinggi, arahkan towing.");
  if (symptoms.shiftDelay || symptoms.slip) hint.push("Possible: slip/pressure/solenoid/valve body, but don't diagnose definitively.");
  if (tier !== "REGULAR") hint.push("Premium handling: stronger authority, mention diagnostic gate + risk cost can expand.");

  const userPrompt = `
Pesan pelanggan: "${userText}"
Catatan internal: ${hint.join(" ")}
`.trim();

  const resp = await client.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.4,
    messages: [
      { role: "system", content: buildSystemPrompt({ tier }) },
      { role: "user", content: userPrompt }
    ]
  });

  return resp.choices?.[0]?.message?.content?.trim() || "Baik, kami bantu cek. " + workshopCTA();
}

// ---------- MAIN ROUTER ----------
async function generateReply(userText) {
  const t = norm(userText);

  // Commands
  const cmd = commandReply(t);
  if (cmd) return cmd;

  const tier = detectTier(t);
  const symptoms = detectSymptoms(t);

  // Price bait
  if (isPriceHunter(t)) {
    return [moneyPolicyPremium(), workshopCTA()].join("\n\n");
  }

  // Hard rule: urgent towing
  if (symptoms.hotNoGo || symptoms.noMove) {
    return [
      "⚠️ Ini gejala berat. *Jangan dipaksakan jalan* karena bisa melebar dan merusak internal transmisi/komponen lain.",
      towingText(),
      moneyPolicyPremium(),
      "Jawab cepat 2 hal: 1) Saat panas D/R masuk tapi tidak gerak? 2) Ada lampu warning?",
      workshopCTA()
    ].join("\n\n");
  }

  // Otherwise: AI makes it alive (handles Innova-like questions naturally)
  const answer = await aiReply(userText, { tier, symptoms });

  // Safety: ensure CTA always present
  if (!answer.includes("Maps:") && !answer.includes("maps.app.goo.gl")) {
    return `${answer}\n\n${workshopCTA()}`;
  }
  return answer;
}

module.exports = { generateReply };
