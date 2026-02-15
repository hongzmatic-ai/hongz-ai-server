const express = require("express");
const OpenAI = require("openai");
const twilio = require("twilio");

const app = express();

// WAJIB: Twilio kirim data sebagai x-www-form-urlencoded
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.post("/webhook", async (req, res) => {
  console.log("Incoming body:", req.body);

  const incomingMsg = req.body.Body || req.body.body || "";

  if (!incomingMsg) {
    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message("Maaf Papa, pesan kamu belum terbaca. Coba kirim ulang ya 🙏");
    res.type("text/xml");
    return res.send(twiml.toString());
  }

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "Kamu adalah CS Hongz Bengkel Spesialis Transmisi Matic di Medan. Jawab sopan, jelas, profesional. Jika ditanya harga, jelaskan range & minta detail kendaraan/keluhan.",
        },
        { role: "user", content: incomingMsg },
      ],
    });

    const reply = completion.choices[0].message.content;

    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message(reply);

    res.type("text/xml");
    res.send(twiml.toString());
  } catch (err) {
    console.error("OpenAI error:", err);
    res.sendStatus(500);
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log("Server running on port", PORT));
