/**
 * MongoDB Waitlist Monitor — Email Trigger
 * -----------------------------------------
 * Polls your Gmail inbox every 30 seconds via IMAP.
 * When it finds an unread email with "GET_COUNT" in the subject,
 * it replies with the current MongoDB waitlist document count via Resend.
 *
 * SETUP:
 *   npm install imapflow mongodb resend
 *
 * RUN:
 *   node waitlist_monitor.js
 */

const { ImapFlow } = require("imapflow");
const { MongoClient } = require("mongodb");
const { Resend } = require("resend");

// ---------------------------------------------------------------------------
// CONFIG
// ---------------------------------------------------------------------------

const CONFIG = {
  gmail: {
    user: "vedantp28@gmail.com",
    appPassword: "urxu dinj ztoo zewb",
  },
  resend: {
    apiKey: "re_PL6XuvXe_3dWuEBmrHd12HnnfRwBqwYRo",
    from: "Waitlist Monitor <onboarding@resend.dev>", // free Resend sender
  },
  mongo: {
    uri: "mongodb+srv://vedantp28_db_user:12349876@clusterelvn.f3spvav.mongodb.net/?appName=ClusterELVN",
    database: "test",
    collection: "waitlist",
  },
  trigger: {
    keyword: "GET_COUNT",
    pollIntervalMs: 30_000,
  },
};

const resend = new Resend(CONFIG.resend.apiKey);

// ---------------------------------------------------------------------------
// MongoDB — count documents
// ---------------------------------------------------------------------------

async function getWaitlistCount() {
  const client = new MongoClient(CONFIG.mongo.uri, {
    serverSelectionTimeoutMS: 10000,
    connectTimeoutMS: 10000,
  });
  try {
    await client.connect();
    const count = await client
      .db(CONFIG.mongo.database)
      .collection(CONFIG.mongo.collection)
      .countDocuments({});
    return count;
  } finally {
    await client.close();
  }
}

// ---------------------------------------------------------------------------
// Resend — send reply
// ---------------------------------------------------------------------------

async function sendReply({ to, subject, messageId, count }) {
  const now = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
  const replySubject = subject.startsWith("Re:") ? subject : `Re: ${subject}`;

  const html = `
    <h2 style="font-family:sans-serif;">📋 Waitlist Report</h2>
    <table style="font-family:sans-serif; border-collapse:collapse;">
      <tr>
        <td style="padding:6px 16px 6px 0;color:#555;">Database</td>
        <td><strong>${CONFIG.mongo.database}</strong></td>
      </tr>
      <tr>
        <td style="padding:6px 16px 6px 0;color:#555;">Collection</td>
        <td><strong>${CONFIG.mongo.collection}</strong></td>
      </tr>
      <tr>
        <td style="padding:6px 16px 6px 0;color:#555;">Document count</td>
        <td><strong style="font-size:1.4em;">${count.toLocaleString()}</strong></td>
      </tr>
      <tr>
        <td style="padding:6px 16px 6px 0;color:#555;">Checked at</td>
        <td>${now} IST</td>
      </tr>
    </table>
  `;

  const { error } = await resend.emails.send({
    from: CONFIG.resend.from,
    to,
    subject: replySubject,
    html,
    headers: {
      "In-Reply-To": messageId,
      "References": messageId,
    },
  });

  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// Gmail IMAP — poll inbox
// ---------------------------------------------------------------------------

async function pollInbox() {
  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: {
      user: CONFIG.gmail.user,
      pass: CONFIG.gmail.appPassword,
    },
    logger: false,
    socketTimeout: 20000,
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");

    try {
      const uids = await client.search(
        { unseen: true, subject: CONFIG.trigger.keyword },
        { uid: true }
      );

      if (uids.length === 0) {
        console.log(`[${timestamp()}] No trigger emails found.`);
        return;
      }

      console.log(`[${timestamp()}] 🎯 Found ${uids.length} trigger email(s)!`);

      for (const uid of uids) {
        // Mark as read FIRST — prevents re-triggering if later steps fail
        await client.messageFlagsAdd({ uid }, ["\\Seen"], { uid: true });
        console.log(`[${timestamp()}] ✔️  Marked UID ${uid} as read.`);

        try {
          const msg = await client.fetchOne(
            uid,
            { envelope: true },
            { uid: true }
          );

          const from      = msg.envelope.from?.[0];
          const replyTo   = from?.address;
          const subject   = msg.envelope.subject || "GET_COUNT";
          const messageId = msg.envelope.messageId;

          console.log(`[${timestamp()}] 📨 Triggered by: ${replyTo} — "${subject}"`);
          console.log(`[${timestamp()}] 🔌 Fetching document count...`);

          const count = await getWaitlistCount();
          console.log(`[${timestamp()}] ✅ Count: ${count}`);

          await sendReply({ to: replyTo, subject, messageId, count });
          console.log(`[${timestamp()}] 📧 Reply sent to ${replyTo}`);

        } catch (err) {
          console.error(`[${timestamp()}] ❌ Error processing email UID ${uid}:`, err.message);
        }
      }

    } finally {
      lock.release();
    }

    await client.logout();

  } catch (err) {
    console.error(`[${timestamp()}] ❌ IMAP error:`, err.message);
    try { await client.logout(); } catch (_) {}
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timestamp() {
  return new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

async function main() {
  console.log("🚀 Waitlist Monitor started!");
  console.log(`   Watching : ${CONFIG.gmail.user}`);
  console.log(`   Trigger  : Subject contains "${CONFIG.trigger.keyword}"`);
  console.log(`   Interval : every ${CONFIG.trigger.pollIntervalMs / 1000}s`);
  console.log("   Press Ctrl+C to stop.\n");

  await pollInbox();
  setInterval(pollInbox, CONFIG.trigger.pollIntervalMs);
}

main().catch(console.error);
