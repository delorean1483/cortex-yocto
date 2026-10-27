'use strict';

// Alert delivery shared by the ingest and fault-handler Lambdas. Symlinked into
// each Lambda's directory (the deploy zip follows the link), so it has no
// requires of its own: every AWS call comes in through `io`.
//
//   io  = { scanUsers() -> users-table items,
//           sendEmail({ from, to, subject, text }),   // SES
//           publish({ subject, text }) }               // SNS alerts topic
//   cfg = { alertFrom, dashboardUrl }
//
// Until ALERT_FROM is set (goecofleet.com verified and the account out of the
// SES sandbox), alerts go to the SNS topic exactly as fault emails always have.
// Once it is set, each person who turned email alerts on gets their own copy.

function recipientsFrom(items) {
  const emails = (items || [])
    .filter((u) => u && u.email_alerts === true && typeof u.email === 'string' && u.email)
    .map((u) => u.email);
  return [...new Set(emails)].sort();
}

function withFooter(text, dashboardUrl) {
  return `${text}\n\n—\nYou get this because you turned on email alerts in EcoFleet.\nTurn them off: ${dashboardUrl}`;
}

async function sendAlert({ subject, text }, io, cfg) {
  if (!cfg.alertFrom) {
    await io.publish({ subject, text });
    return { via: 'sns', sent: 1, failed: [] };
  }
  const to = recipientsFrom(await io.scanUsers());
  const body = withFooter(text, cfg.dashboardUrl);
  const results = await Promise.allSettled(
    to.map((addr) => io.sendEmail({ from: cfg.alertFrom, to: addr, subject, text: body })),
  );
  const failed = [];
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      failed.push(to[i]);
      console.error(`Alert email to ${to[i]} failed:`, r.reason && r.reason.message);
    }
  });
  return { via: 'ses', sent: to.length - failed.length, failed };
}

// SESv2 SendEmail input for one alert. Subjects and footers contain "—", and
// SES assumes 7-bit ASCII unless told otherwise, so both parts are UTF-8.
function sesEmailInput({ from, to, subject, text }) {
  return {
    FromEmailAddress: from,
    Destination: { ToAddresses: [to] },
    Content: { Simple: {
      Subject: { Data: subject, Charset: 'UTF-8' },
      Body: { Text: { Data: text, Charset: 'UTF-8' } },
    } },
  };
}

module.exports = { recipientsFrom, withFooter, sendAlert, sesEmailInput };
