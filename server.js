// server.js
const express = require("express");
const bodyParser = require("body-parser");
const twilio = require("twilio");
require("dotenv").config();

const { generateReply } = require("./service");

const app = express();

// Twilio sends x-www-form-urlencoded
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

app.get("/", (req, res) => {
  res.send("Hongz AI WhatsApp Server is running ✅");
});

app.post("/whatsapp/incoming", async (req, res) => {
  const twiml = new twilio.twiml.MessagingResponse();

  try {
    const incomingMsg = (req.body.Body || "").trim();

    if (!incomingMsg) {
      twiml.message(
        "Halo! Ketik keluhan singkat ya. Contoh: 'panas gak bisa jalan' / 'jedug pindah gigi' / 'rpm tinggi baru masuk'."
      );
      return res.type("text/xml").send(twiml.toString());
    }

    const reply = await generateReply(incomingMsg); // ✅ NOW ASYNC
    twiml.message(reply);

    return res.type("text/xml").send(twiml.toString());
  } catch (err) {
    console.error("Webhook error:", err);
    twiml.message(
      "Maaf, sistem lagi sibuk. Ketik ulang pesan Anda atau ketik *JADWAL* untuk booking / *TOWING* untuk evakuasi."
    );
    return res.type("text/xml").send(twiml.toString());
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
