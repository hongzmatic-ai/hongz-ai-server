// server.js (v5.2)
// Twilio inbound webhook -> service.generateReply() -> TwiML reply

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
  try {
    const incomingMsg = (req.body.Body || "").trim();
    const twiml = new twilio.twiml.MessagingResponse();

    if (!incomingMsg) {
      twiml.message(
        "Ketik gejala inti saja. Contoh:\n- panas lalu tidak bisa jalan\n- jedug pindah gigi\n- rpm naik tapi selip"
      );
      return res.type("text/xml").send(twiml.toString());
    }

    // IMPORTANT: await (because AI call is async)
    const reply = await generateReply(incomingMsg);

    twiml.message(reply);
    return res.type("text/xml").send(twiml.toString());
  } catch (err) {
    console.error("Webhook error:", err);
    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message(
      "Sistem sedang sibuk. Ketik ulang.\nKetik *JADWAL* untuk booking / *TOWING* untuk evakuasi."
    );
    return res.type("text/xml").send(twiml.toString());
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
