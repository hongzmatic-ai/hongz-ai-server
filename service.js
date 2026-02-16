// service.js
// Hongz AI Engine v5.3 - Calm Authority Mode
// Elegant, Professional, No Aggression, No Fake Address

const OpenAI = require("openai");

const OFFICIAL = {
  name: "Hongz Bengkel Spesialis Transmisi Matic",
  address: "Jl. M. Yakub No.10b, Medan Perjuangan",
  maps: "https://maps.app.goo.gl/CvFZ9FLNJRog7K4t9",
  hours: "Senin–Sabtu 09.00–17.00"
};

function workshopCTA() {
  return `
📍 ${OFFICIAL.name}
${OFFICIAL.address}
🧭 ${OFFICIAL.maps}
⏱ ${OFFICIAL.hours}
Ketik *JADWAL* untuk booking / *TOWING* bila unit tidak bisa jalan.`;
}

function towingCTA() {
  return `
Jika unit tidak bisa berjalan atau terasa berisiko,
sebaiknya tidak dipaksakan.

Ketik *TOWING* dan kirim share lokasi Anda,
kami bantu arahkan proses evakuasi.`;
}

function professionalStatement() {
  return `
Kami bekerja berbasis diagnosa, bukan asumsi.

Pada sistem transmisi modern, estimasi tanpa pemeriksaan 
berisiko menyesatkan.

Untuk menjaga akurasi dan tanggung jawab teknis,
unit perlu kami cek langsung terlebih dahulu.`;
}

function norm(text="") {
  return String(text).toLowerCase().trim();
}

function detectUrgent(text) {
  const t = norm(text);
  return (
    t.includes("tidak bisa jalan") ||
    t.includes("gak bisa jalan") ||
    t.includes("mogok") ||
    t.includes("panas tidak bisa jalan") ||
    t.includes("overheat")
  );
}

function sanitizeOutput(text="") {
  const banned = ["jl.", "jalan", "[maps link]", "alamat:", "no.123", "raya transmisi"];
  let lines = text.split("\n").map(l => l.trim()).filter(Boolean);

  lines = lines.filter(line => {
    const low = line.toLowerCase();
    return !banned.some(b => low.includes(b));
  });

  let result = lines.join("\n").trim();

  // max 2 questions
  const qm = (result.match(/\?/g) || []).length;
  if (qm > 2) {
    let count = 0;
    let out = "";
    for (const ch of result) {
      out += ch;
      if (ch === "?") {
        count++;
        if (count === 2) break;
      }
    }
    result = out.trim();
  }

  if (result.length > 900) {
    result = result.slice(0, 900).trim();
  }

  return result;
}

async function aiReply(userText) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return professionalStatement() + "\n\n" + workshopCTA();
  }

  const client = new OpenAI({ apiKey });

  const resp = await client.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.3,
    messages: [
      {
        role: "system",
        content: `
Anda adalah CS profesional Hongz Bengkel Spesialis Transmisi Matic Medan.

Aturan:
- Jangan menulis alamat.
- Jangan memberi harga fix.
- Maksimal 2 pertanyaan.
- Gaya elegan, tenang, profesional.
- Arahkan ke workshop atau towing bila perlu.
`
      },
      {
        role: "user",
        content: userText
      }
    ]
  });

  let text = resp.choices?.[0]?.message?.content?.trim() || "";
  text = sanitizeOutput(text);

  if (!text) {
    return professionalStatement() + "\n\n" + workshopCTA();
  }

  return text + "\n\n" + professionalStatement() + "\n\n" + workshopCTA();
}

async function generateReply(userText) {
  const text = norm(userText);

  if (text === "jadwal") {
    return `
Silakan kirim format berikut:
NAMA / MOBIL / TAHUN / GEJALA / JAM DATANG

${workshopCTA()}`;
  }

  if (text.includes("towing") || text.includes("derek")) {
    return towingCTA() + "\n\n" + workshopCTA();
  }

  if (detectUrgent(text)) {
    return `
Gejala tersebut berisiko jika dipaksakan.

${towingCTA()}

${professionalStatement()}

${workshopCTA()}`;
  }

  return await aiReply(userText);
}

module.exports = { generateReply };
