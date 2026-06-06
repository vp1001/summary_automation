/**
 * MongoDB Waitlist Monitor — Email Trigger (Resend API version)
 * -----------------------------------------
 * Polls your Gmail inbox every 30 seconds via IMAP.
 * When it finds an unread email with "GET_COUNT" in the subject,
 * it replies with the current MongoDB waitlist document count via Resend API.
 *
 * SETUP:
 *   npm install imapflow mongodb resend
 *
 * RESEND DOMAIN SETUP (one time):
 *   1. Go to https://resend.com/domains
 *   2. Click "Add Domain" → enter: elvnelvnparfums.com
 *   3. Add the DNS records they show you (in your domain registrar/cPanel)
 *   4. Click "Verify" — takes 1-5 minutes
 *   5. Then you can send from system@elvnelvnparfums.com freely
 *
 * RUN:
 *   node waitlist_monitor_resend.js
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
    from: "Waitlist Monitor <no-reply@elvnelvnparfums.com>",
  },
  mongo: {
    uri: "mongodb+srv://vedantp28_db_user:12349876@clusterelvn.f3spvav.mongodb.net/?appName=ClusterELVN",
    database: "test",
    collection: "waitlists",
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
// Resend API — send reply
// ---------------------------------------------------------------------------

async function sendReply({ to, subject, messageId, count }) {
  const now = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
  const replySubject = subject.startsWith("Re:") ? subject : `Re: ${subject}`;

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Waitlist Report · ELVN ELVN</title>
</head>
<body style="margin:0;padding:0;background:#0e0c0a;font-family:Georgia,serif;">
  <table width="100%" style="background:#0e0c0a;padding:32px 12px;">
    <tr><td align="center">
      <table width="560" style="background:#141210;border-radius:4px;overflow:hidden;border:1px solid #2a2118;">

        <!-- Top gold line -->
        <tr><td style="height:2px;background:linear-gradient(90deg,#8c7451 0%,#c4a882 50%,#8c7451 100%);padding:0;"></td></tr>

        <!-- Header -->
        <tr><td style="padding:36px 44px 28px;">
          <div style="font-size:9px;letter-spacing:6px;color:#8c7451;text-transform:uppercase;margin-bottom:10px;">Elvn Elvn Parfums</div>
          <div style="font-size:20px;color:#faf9f7;font-weight:400;letter-spacing:1px;">Waitlist Report</div>
        </td></tr>

        <!-- Divider -->
        <tr><td style="padding:0 44px;"><div style="height:1px;background:#2a2118;"></div></td></tr>

        <!-- Big count -->
        <tr><td style="padding:40px 44px 32px;text-align:center;">
          <div style="font-size:11px;letter-spacing:4px;color:#8c7451;text-transform:uppercase;margin-bottom:16px;">Total Signups</div>
          <div style="font-size:72px;color:#c4a882;font-weight:300;letter-spacing:-2px;line-height:1;">${count.toLocaleString()}</div>
          <div style="font-size:11px;letter-spacing:3px;color:#4a4035;text-transform:uppercase;margin-top:12px;">people waiting</div>
        </td></tr>

        <!-- Divider -->
        <tr><td style="padding:0 44px;"><div style="height:1px;background:#2a2118;"></div></td></tr>

        <!-- Meta row -->
        <tr><td style="padding:24px 44px 32px;">
          <table width="100%" style="border-collapse:collapse;">
            <tr>
              <td style="padding:10px 0;border-bottom:1px solid #1e1a14;">
                <span style="font-size:10px;letter-spacing:3px;color:#4a4035;text-transform:uppercase;">Checked at</span>
              </td>
              <td style="padding:10px 0;border-bottom:1px solid #1e1a14;text-align:right;">
                <span style="font-size:12px;color:#8c7a65;">${now} IST</span>
              </td>
            </tr>
            <tr>
              <td style="padding:10px 0;">
                <span style="font-size:10px;letter-spacing:3px;color:#4a4035;text-transform:uppercase;">Collection</span>
              </td>
              <td style="padding:10px 0;text-align:right;">
                <span style="font-size:12px;color:#8c7a65;">${CONFIG.mongo.collection}</span>
              </td>
            </tr>
          </table>
        </td></tr>

        <!-- Bottom gold line -->
        <tr><td style="height:2px;background:linear-gradient(90deg,#8c7451 0%,#c4a882 50%,#8c7451 100%);padding:0;"></td></tr>

        <!-- Footer -->
        <tr><td style="padding:18px 44px;text-align:center;">
          <div style="font-size:10px;letter-spacing:3px;color:#2e2920;text-transform:uppercase;">
            © ${new Date().getFullYear()} ELVN ELVN Parfums · Internal Report
          </div>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = [
    `ELVN ELVN PARFUMS — Waitlist Report`,
    `------------------------------------`,
    `Total Signups : ${count.toLocaleString()}`,
    `Collection    : ${CONFIG.mongo.collection}`,
    `Checked at    : ${now} IST`,
  ].join("\n");

  const { error } = await resend.emails.send({
    from: CONFIG.resend.from,
    to,
    subject: replySubject,
    html,
    text,
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

    try {
      const lock = await client.getMailboxLock("INBOX");
      try {
        const uids = await client.search(
          { unseen: true, subject: CONFIG.trigger.keyword },
          { uid: true }
        );

        if (uids.length === 0) {
          console.log(`[${timestamp()}] No trigger emails found.`);
        } else {
          console.log(`[${timestamp()}] 🎯 Found ${uids.length} trigger email(s)!`);

          for (const uid of uids) {
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
        }

      } finally {
        lock.release();
      }

    } finally {
      // Always logout cleanly — prevents "Command failed" on stale connections
      await client.logout();
    }

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
