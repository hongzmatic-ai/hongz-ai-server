// server.js
const express = require("express");
const bodyParser = require("body-parser");
const twilio = require("twilio");
require("dotenv").config();

const { generateReply } = require("./service");

const app = express();

// Twilio inbound biasanya x-www-form-urlencoded
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// Twilio REST client (untuk kirim alert ke admin)
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

app.get("/", (req, res) => {
  res.send("Hongz AI WhatsApp Server is running ✅");
});

function normalizeWa(wa) {
  if (!wa) return "";
  const s = String(wa).trim();
  return s.startsWith("whatsapp:") ? s : `whatsapp:${s}`;
}

// Kirim alert ke admin (Papa)
async function sendAdminAlert({ toAdmin, fromBot, alertText }) {
  if (!toAdmin || !fromBot || !alertText) return;
  try {
    await twilioClient.messages.create({
      from: fromBot,
      to: toAdmin,
      body: alertText,
    });
  } catch (e) {
    console.error("Admin alert send failed:", e?.message || e);
  }
}

app.post("/whatsapp/incoming", async (req, res) => {
  try {
    const incomingMsg = (req.body.Body || "").trim();
    const fromCustomer = req.body.From || ""; // contoh: "whatsapp:+62xxxx"
    const twiml = new twilio.twiml.MessagingResponse();

    // Safety: kalau kosong
    if (!incomingMsg) {
      twiml.message(
        "Halo! Ketik keluhan singkat ya.\nContoh: *panas gak bisa jalan* / *jedug pindah gigi* / *selip rpm naik*."
      );
      return res.type("text/xml").send(twiml.toString());
    }

    // generateReply bisa return:
    // 1) string
    // 2) object: { reply, meta }
    const out = generateReply(incomingMsg, { fromCustomer });

    const reply = typeof out === "string" ? out : out.reply;
    const meta = typeof out === "string" ? null : out.meta;

    twiml.message(reply);
    res.type("text/xml").send(twiml.toString());

    // ===== MODE A: Auto Alert ke Admin =====
    // Kirim alert async (tidak mengganggu reply ke customer)
    const ADMIN_WA = normalizeWa(process.env.ADMIN_WA); // whatsapp:+62813...
    const TWILIO_WHATSAPP_FROM = normalizeWa(process.env.TWILIO_WHATSAPP_FROM); // whatsapp:+62xxxx (Twilio sender)

    if (meta?.shouldAlertAdmin) {
      const alertText = [
        "🚨 *HONGZ AI ADMIN ALERT*",
        `Customer: ${fromCustomer || "-"}`,
        `Tier: ${meta.tier || "-"}`,
        `Emotion: ${meta.emotionLabel || "-"}`,
        `Urgency: ${meta.urgency || "-"}`,
        `Gejala: ${meta.symptomSummary || "-"}`,
        `Pesan: "${incomingMsg}"`,
        "",
        "📌 Saran AI:",
        meta.recommendation || "-",
        "",
        "✅ Aksi cepat: ketik *TOWING* / *JADWAL* lalu ambil alih bila perlu.",
      ].join("\n");

      sendAdminAlert({
        toAdmin: ADMIN_WA,
        fromBot: TWILIO_WHATSAPP_FROM,
        alertText,
      });
    }
  } catch (err) {
    console.error("Webhook error:", err);
    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message(
      "Maaf, sistem sedang sibuk. Ketik ulang pesan Anda.\nKetik *JADWAL* untuk booking / *TOWING* untuk evakuasi."
    );
    res.type("text/xml").send(twiml.toString());
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
