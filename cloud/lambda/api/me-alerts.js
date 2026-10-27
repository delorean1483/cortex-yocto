'use strict';

// PUT /fleet/me/alerts body -> the caller's email-alerts preference. Only
// `email_alerts` is read: whose preference it is always comes from the JWT.
function parseAlertsBody(rawBody) {
  let body;
  try { body = JSON.parse(rawBody); } catch { return { error: 'Invalid JSON' }; }
  if (!body || typeof body.email_alerts !== 'boolean') {
    return { error: 'email_alerts must be true or false' };
  }
  return { email_alerts: body.email_alerts };
}

module.exports = { parseAlertsBody };
