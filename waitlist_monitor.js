/**
 * MongoDB Waitlist Monitor — Email Trigger (Resend API version)
 * -----------------------------------------
 * Polls your Gmail inbox every 30 seconds via IMAP.
 * When it finds an unread email with "GET_COUNT" in the subject,
 * it replies with the current MongoDB waitlist document count via Resend API,
 * AND attaches a properly-formatted Excel (.xlsx) export of every waitlist row.
 *
 * SETUP:
 *   npm install imapflow mongodb resend exceljs
 *
 * RESEND DOMAIN SETUP (one time):
 *   1. Go to https://resend.com/domains
 *   2. Click "Add Domain" → enter: elvnelvnparfums.com
 *   3. Add the DNS records they show you (in your domain registrar/cPanel)
 *   4. Click "Verify" — takes 1-5 minutes
 *   5. Then you can send from system@elvnelvnparfums.com freely
 *
 * RUN:
 *   node waitlist_monitor.js                    # start the inbox watcher
 *   node waitlist_monitor.js --test             # send one test report to the Gmail user
 *   node waitlist_monitor.js --test someone@x.com  # send one test report to any address
 */

const { ImapFlow } = require("imapflow");
const { MongoClient } = require("mongodb");
const { Resend } = require("resend");
const ExcelJS = require("exceljs");

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
// MongoDB — fetch count + all documents (one connection)
// ---------------------------------------------------------------------------

async function getWaitlistData() {
  const client = new MongoClient(CONFIG.mongo.uri, {
    serverSelectionTimeoutMS: 10000,
    connectTimeoutMS: 10000,
  });
  try {
    await client.connect();
    const collection = client
      .db(CONFIG.mongo.database)
      .collection(CONFIG.mongo.collection);

    const count = await collection.countDocuments({});
    const docs = await collection.find({}).sort({ createdAt: 1 }).toArray();

    return { count, docs };
  } finally {
    await client.close();
  }
}

// ---------------------------------------------------------------------------
// Excel — build a properly-formatted waitlist workbook
// ---------------------------------------------------------------------------

function str(v) {
  return v === undefined || v === null ? "" : String(v);
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (isNaN(date.getTime())) return String(value);
  // Readable IST date-time, e.g. "09 Jun 2026, 09:55 AM"
  return date
    .toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    })
    .replace(/ /g, " "); // normalise narrow no-break space some runtimes emit
}

function fileDateStamp() {
  // en-CA → YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function thinBorder() {
  const c = { style: "thin", color: { argb: "FFE2DBCE" } };
  return { top: c, left: c, bottom: c, right: c };
}

async function buildWaitlistXlsx(docs) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ELVN ELVN Waitlist Monitor";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Waitlist", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  sheet.columns = [
    { header: "#",             key: "sno",          width: 6  },
    { header: "Name",          key: "name",         width: 20 },
    { header: "Surname",       key: "surname",      width: 20 },
    { header: "Email",         key: "email",        width: 34 },
    { header: "Mobile Number", key: "mobileNumber", width: 18 },
    { header: "Created At",    key: "createdAt",    width: 24 },
    { header: "Updated At",    key: "updatedAt",    width: 24 },
    { header: "ID",            key: "_id",          width: 28 },
  ];

  // --- Header row styling (brand: dark + gold) ---
  const header = sheet.getRow(1);
  header.height = 26;
  header.eachCell((cell) => {
    cell.font = { name: "Calibri", bold: true, size: 11, color: { argb: "FFFAF9F7" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1A1410" } };
    cell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    cell.border = { bottom: { style: "medium", color: { argb: "FFC4A882" } } };
  });

  // --- Data rows ---
  docs.forEach((doc, i) => {
    const row = sheet.addRow({
      sno: i + 1,
      name: str(doc.name),
      surname: str(doc.surname),
      email: str(doc.email),
      // Phone as TEXT so it is never shown in scientific notation (no 9.02e12)
      mobileNumber: str(doc.mobileNumber),
      createdAt: formatDate(doc.createdAt),
      updatedAt: formatDate(doc.updatedAt),
      _id: str(doc._id),
    });

    row.height = 20;
    const zebra = i % 2 === 1;
    row.eachCell((cell, colNumber) => {
      cell.font = { name: "Calibri", size: 11, color: { argb: "FF2B2B2B" } };
      cell.alignment = {
        vertical: "middle",
        horizontal: colNumber === 1 || colNumber === 5 ? "center" : "left",
        indent: colNumber === 1 || colNumber === 5 ? 0 : 1,
      };
      cell.border = thinBorder();
      if (zebra) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF7F4EF" } };
      }
    });

    // Belt-and-suspenders: force the mobile cell to text format too
    row.getCell("mobileNumber").numFmt = "@";
  });

  // Whole mobile column → text format (full numbers, never scientific notation)
  sheet.getColumn("mobileNumber").numFmt = "@";

  // Filter dropdowns on the header
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: sheet.columnCount },
  };

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// ---------------------------------------------------------------------------
// Resend API — send report (count + Excel attachment)
// ---------------------------------------------------------------------------

async function sendReport({ to, subject, messageId, count, xlsxBuffer, recordCount }) {
  const now = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
  const attachmentName = `waitlist_${fileDateStamp()}.xlsx`;
  const replySubject = subject
    ? subject.startsWith("Re:")
      ? subject
      : `Re: ${subject}`
    : "Waitlist Report — ELVN ELVN";

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

        <!-- Attachment note -->
        <tr><td style="padding:28px 44px 8px;">
          <table width="100%" style="background:#0e0c0a;border:1px solid #2a2118;border-radius:4px;border-collapse:separate;">
            <tr><td style="padding:16px 20px;">
              <div style="font-size:13px;color:#c4a882;letter-spacing:1px;">&#128206;&nbsp; Full waitlist attached</div>
              <div style="font-size:11px;color:#8c7a65;margin-top:8px;line-height:1.5;">
                ${recordCount.toLocaleString()} record(s) &middot; Excel (.xlsx)<br/>
                <span style="color:#6a5d4c;">${attachmentName}</span>
              </div>
            </td></tr>
          </table>
        </td></tr>

        <!-- Meta row -->
        <tr><td style="padding:20px 44px 32px;">
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
            &copy; ${new Date().getFullYear()} ELVN ELVN Parfums &middot; Internal Report
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
    `Attachment    : ${attachmentName} (${recordCount.toLocaleString()} records)`,
  ].join("\n");

  const payload = {
    from: CONFIG.resend.from,
    to,
    subject: replySubject,
    html,
    text,
    attachments: [
      {
        filename: attachmentName,
        content: xlsxBuffer,
      },
    ],
  };

  // Only thread as a reply when we actually have a message to reply to
  if (messageId) {
    payload.headers = {
      "In-Reply-To": messageId,
      References: messageId,
    };
  }

  const { error } = await resend.emails.send(payload);
  if (error) throw new Error(error.message || JSON.stringify(error));
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
              const replyTo    = from?.address;
              const subject   = msg.envelope.subject || "GET_COUNT";
              const messageId = msg.envelope.messageId;

              console.log(`[${timestamp()}] 📨 Triggered by: ${replyTo} — "${subject}"`);
              console.log(`[${timestamp()}] 🔌 Fetching waitlist data...`);

              const { count, docs } = await getWaitlistData();
              console.log(`[${timestamp()}] ✅ Count: ${count} — building Excel...`);

              const xlsxBuffer = await buildWaitlistXlsx(docs);
              console.log(`[${timestamp()}] 📊 Excel built (${(xlsxBuffer.length / 1024).toFixed(1)} KB).`);

              await sendReport({
                to: replyTo,
                subject,
                messageId,
                count,
                xlsxBuffer,
                recordCount: docs.length,
              });
              console.log(`[${timestamp()}] 📧 Reply (with attachment) sent to ${replyTo}`);

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
// Test mode — send one report immediately (no inbox trigger needed)
// ---------------------------------------------------------------------------

async function sendTestReport(toEmail) {
  console.log(`[${timestamp()}] 🧪 TEST MODE — sending one report to ${toEmail}`);
  console.log(`[${timestamp()}] 🔌 Fetching waitlist data...`);

  const { count, docs } = await getWaitlistData();
  console.log(`[${timestamp()}] ✅ Count: ${count} — building Excel for ${docs.length} row(s)...`);

  const xlsxBuffer = await buildWaitlistXlsx(docs);
  console.log(`[${timestamp()}] 📊 Excel built (${(xlsxBuffer.length / 1024).toFixed(1)} KB).`);

  await sendReport({
    to: toEmail,
    subject: "Waitlist Report (Test) — ELVN ELVN",
    messageId: null,
    count,
    xlsxBuffer,
    recordCount: docs.length,
  });

  console.log(`[${timestamp()}] 📧 Test report (with .xlsx attachment) sent to ${toEmail}`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timestamp() {
  return new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);

  // --- Test mode: node waitlist_monitor.js --test [email] ---
  if (args.includes("--test")) {
    const idx = args.indexOf("--test");
    const toEmail = args[idx + 1] && !args[idx + 1].startsWith("--")
      ? args[idx + 1]
      : CONFIG.gmail.user;
    await sendTestReport(toEmail);
    process.exit(0);
    return;
  }

  // --- Normal mode: watch the inbox ---
  console.log("🚀 Waitlist Monitor started!");
  console.log(`   Watching : ${CONFIG.gmail.user}`);
  console.log(`   Trigger  : Subject contains "${CONFIG.trigger.keyword}"`);
  console.log(`   Interval : every ${CONFIG.trigger.pollIntervalMs / 1000}s`);
  console.log("   Press Ctrl+C to stop.\n");

  await pollInbox();
  setInterval(pollInbox, CONFIG.trigger.pollIntervalMs);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
