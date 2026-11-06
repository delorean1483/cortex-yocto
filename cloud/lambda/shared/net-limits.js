'use strict';
// Time limits for the AWS SDK calls the ingest and fault Lambdas make, spread
// into every client constructor. Both Lambdas run under a 30 s timeout
// (terraform/lambda.tf), and AWS SDK v3 by default waits on a stalled
// connection indefinitely: Lambda then kills the invocation mid-call, and a
// stalled alert email is never logged as failed (no ALERT EMAIL FAILED line,
// so the email-failure alarm stays quiet). With these a stall is an ordinary
// error after at most 2 attempts x (2 s connect + 4 s waiting for a reply).
// (The InfluxDB client already has its own 10 s request timeout.)
// throwOnRequestTimeout: @smithy/node-http-handler 4.x only logs a warning when
// requestTimeout passes unless this is set (net-limits.test.js checks it).
const AWS_CLIENT_OPTS = {
  maxAttempts: 2,
  requestHandler: { connectionTimeout: 2000, requestTimeout: 4000, throwOnRequestTimeout: true },
};

module.exports = { AWS_CLIENT_OPTS };
