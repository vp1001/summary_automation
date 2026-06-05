/**
 * MongoDB Waitlist Monitor — Email Trigger
 * -----------------------------------------
 * Polls your Gmail inbox every 30 seconds.
 * When it finds an unread email with "GET_COUNT" in the subject,
 * it replies with the current MongoDB waitlist document count.
 *
 * SETUP:
 *   npm install imapflow nodemailer mongodb dotenv
 *
 * RUN:
 *   node waitlist_monitor.js
 *
 * TRIGGER:
 *   Send any email to vedantp28@gmail.com with subject containing "GET_COUNT"
 */

const { ImapFlow } = require("imapflow");
const nodemailer = require("nodemailer");
const { MongoClient } = require("mongodb");

// ---------------------------------------------------------------------------
// CONFIG
// ---------------------------------------------------------------------------

const CONFIG = {
  gmail: {
    user: "vedantp28@gmail.com",
    appPassword: "urxu dinj ztoo zewb",
  },
  mongo: {
    uri: "mongodb+srv://vedantp28_db_user:12349876@clusterelvn.f3spvav.mongodb.net/?appName=ClusterELVN",
    database: "test",
    collection: "waitlist",
  },
  trigger: {
    keyword: "GET_COUNT",      // keyword to look for in email subject
    pollIntervalMs: 30_000,    // how often to check inbox (30 seconds)
  },
};

// ---------------------------------------------------------------------------
// MongoDB — count documents
// ---------------------------------------------------------------------------

async function getWaitlistCount() {
  const client = new MongoClient(CONFIG.mongo.uri);
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
// Gmail SMTP — send reply
// ---------------------------------------------------------------------------

async function sendReply({ to, subject, messageId, count }) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: CONFIG.gmail.user,
      pass: CONFIG.gmail.appPassword,
    },
  });

  const now = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
  const replySubject = subject.startsWith("Re:") ? subject : `Re: ${subject}`;

  const text = [
    `📋 Waitlist Report`,
    `------------------`,
    `Database   : ${CONFIG.mongo.database}`,
    `Collection : ${CONFIG.mongo.collection}`,
    `Count      : ${count.toLocaleString()}`,
    `Checked at : ${now} IST`,
  ].join("\n");

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

  await transporter.sendMail({
    from: CONFIG.gmail.user,
    to,
    subject: replySubject,
    text,
    html,
    inReplyTo: messageId,
    references: messageId,
  });
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
    logger: false, // set to true for verbose IMAP logs
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");

    try {
      // Search for unread emails with the trigger keyword in subject
      const uids = await client.search({
        unseen: true,
        subject: CONFIG.trigger.keyword,
      });

      if (uids.length === 0) {
        console.log(`[${timestamp()}] No trigger emails found.`);
        return;
      }

      console.log(`[${timestamp()}] 🎯 Found ${uids.length} trigger email(s)!`);

      for (const uid of uids) {
        try {
          // Fetch email details
          const msg = await client.fetchOne(uid, {
            envelope: true,
            source: false,
          });

          const from      = msg.envelope.from?.[0];
          const replyTo   = from?.address;
          const subject   = msg.envelope.subject || "GET_COUNT";
          const messageId = msg.envelope.messageId;

          console.log(`[${timestamp()}] 📨 Triggered by: ${replyTo} — "${subject}"`);

          // Get MongoDB count
          console.log(`[${timestamp()}] 🔌 Fetching document count...`);
          const count = await getWaitlistCount();
          console.log(`[${timestamp()}] ✅ Count: ${count}`);

          // Send reply
          await sendReply({ to: replyTo, subject, messageId, count });
          console.log(`[${timestamp()}] 📧 Reply sent to ${replyTo}`);

          // Mark as read so it doesn't trigger again
          await client.messageFlagsAdd(uid, ["\\Seen"]);
          console.log(`[${timestamp()}] ✔️  Marked as read.`);

        } catch (err) {
          console.error(`[${timestamp()}] ❌ Error processing email:`, err.message);
        }
      }

    } finally {
      lock.release();
    }

    await client.logout();

  } catch (err) {
    console.error(`[${timestamp()}] ❌ IMAP error:`, err.message);
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

  // Run immediately on start, then on interval
  await pollInbox();
  setInterval(pollInbox, CONFIG.trigger.pollIntervalMs);
}

main().catch(console.error);
