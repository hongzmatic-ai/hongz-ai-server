// server.js
const express = require("express");
const bodyParser = require("body-parser");
const twilio = require("twilio");
require("dotenv").config();

const { generateReplyWithMeta, summarizeForAdmin } = require("./service");
const {
  rememberUser,
  listUsers,
  addMessage,
  getMeta,
  saveMeta,
  scheduleFollowUp,
  getFollowQueue,
  saveFollowQueue,
} = require("./memory");

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const FROM_WA = process.env.TWILIO_WHATSAPP_FROM; // format: whatsapp:+1415...
const ADMIN_WA = process.env.ADMIN_WA || ""; // format: whatsapp:+62...

const twilioClient = (ACCOUNT_SID && AUTH_TOKEN) ? twilio(ACCOUNT_SID, AUTH_TOKEN) : null;

app.get("/", (req, res) => res.send("Hongz AI Hybrid v4.2 running ✅"));

app.post("/whatsapp/incoming", async (req, res) => {
  const tw = new twilio.twiml.MessagingResponse();

  try {
    const incomingMsg = (req.body.Body || "").trim();
    const fromUser = (req.body.From || "").trim(); // whatsapp:+62...

    if (!incomingMsg) {
      tw.message("Halo! Ketik keluhan singkat ya. Contoh: *panas gak bisa jalan* / *jedug pindah gigi* / *selip rpm naik*.");
      return res.type("text/xml").send(tw.toString());
    }

    const userId = fromUser || "unknown";
    await rememberUser(userId);

    // memory store inbound
    await addMessage(userId, "user", incomingMsg);

    const { reply, meta, handoff } = generateReplyWithMeta(incomingMsg, userId);

    // memory store assistant
    await addMessage(userId, "assistant", reply);

    // update meta stage
    const oldMeta = await getMeta(userId);
    const newMeta = {
      ...oldMeta,
      stage: handoff ? "HANDOFF" : (oldMeta.stage || "ACTIVE"),
      lastSeenAt: Date.now(),
      lastLeadTier: meta.leadTier,
      lastUrgency: meta.urgency,
      lastVehicleTier: meta.vehicleTier,
    };
    await saveMeta(userId, newMeta);

    // schedule followups ONLY for serious leads / handoff / towing / booking
    const shouldFollow = handoff || meta.leadTier !== "C" || meta.urgency >= 6;
    if (shouldFollow) {
      const now = Date.now();
      await scheduleFollowUp(userId, now + 30 * 60 * 1000, "FU_30M");
      await scheduleFollowUp(userId, now + 24 * 60 * 60 * 1000, "FU_24H");
    }

    // HYBRID HANDOFF: notify admin
    if (handoff && ADMIN_WA && twilioClient && FROM_WA) {
      const adminMsg = summarizeForAdmin(incomingMsg, meta);
      // fire-and-forget (but awaited to reduce lost message)
      await twilioClient.messages.create({
        from: FROM_WA,
        to: ADMIN_WA,
        body: adminMsg.slice(0, 1500),
      });
    }

    tw.message(reply);
    return res.type("text/xml").send(tw.toString());
  } catch (err) {
    console.error("Webhook error:", err);
    tw.message("Maaf sistem sedang sibuk. Ketik ulang atau ketik *JADWAL* / *TOWING*.");
    return res.type("text/xml").send(tw.toString());
  }
});

// FULL AUTO FOLLOW-UP CRON (call every 5 minutes)
app.get("/cron/followup", async (req, res) => {
  try {
    if (process.env.CRON_KEY && req.query.key !== process.env.CRON_KEY) {
      return res.status(401).send("unauthorized");
    }

    if (!twilioClient || !FROM_WA) return res.status(500).send("Twilio env missing");

    const users = await listUsers();
    const now = Date.now();

    let sent = 0;

    for (const userId of users) {
      if (!userId || !userId.startsWith("whatsapp:")) continue;

      const q = await getFollowQueue(userId);
      if (!q?.length) continue;

      const meta = await getMeta(userId);
      const stage = meta?.stage || "ACTIVE";

      let changed = false;

      for (const item of q) {
        if (item.sent) continue;
        if (now < item.dueAt) continue;

        // stop followup for price hunters
        if (stage === "PRICE_HUNTER") {
          item.sent = true;
          changed = true;
          continue;
        }

        let body = "";
        if (item.kind === "FU_30M") {
          body =
`Halo, kami follow up ya.
Apakah unitnya jadi datang hari ini?

Ketik *JADWAL* untuk booking cepat atau *TOWING* bila mobil tidak bisa jalan.
📍 Maps: ${process.env.MAPS_LINK || "https://maps.app.goo.gl/CvFZ9FLNJRog7K4t9"}`;
        } else if (item.kind === "FU_24H") {
          body =
`Halo, kami follow up kembali.
Masih ada keluhan transmisi matic yang belum selesai?

Jika kasus panas/selip/no move, jangan dipaksakan.
Ketik *JADWAL* / *TOWING*.
📍 Maps: ${process.env.MAPS_LINK || "https://maps.app.goo.gl/CvFZ9FLNJRog7K4t9"}`;
        } else {
          item.sent = true;
          changed = true;
          continue;
        }

        await twilioClient.messages.create({
          from: FROM_WA,
          to: userId,
          body,
        });

        item.sent = true;
        changed = true;
        sent += 1;
      }

      if (changed) await saveFollowQueue(userId, q);
    }

    return res.send(`OK sent=${sent} users=${users.length}`);
  } catch (e) {
    console.error("cron/followup error:", e);
    return res.status(500).send("error");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
