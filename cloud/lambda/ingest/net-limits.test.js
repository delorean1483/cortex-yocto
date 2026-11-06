'use strict';
// Run: node cloud/lambda/ingest/net-limits.test.js  (needs `npm ci` here)
// Real SDK clients, configured exactly as the Lambdas configure them, against
// a local server that accepts connections and never answers: each call must
// fail well inside the 30 s Lambda timeout instead of hanging.
const assert = require('node:assert');
const net = require('node:net');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { SESv2Client, SendEmailCommand } = require('@aws-sdk/client-sesv2');
const { AWS_CLIENT_OPTS } = require('./net-limits');

const BUDGET_MS = 15000;   // must fail before this; the Lambda timeout is 30 s

let failed = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  [PASS] ${name}`); }
  catch (e) { failed++; console.error(`  [FAIL] ${name}: ${e.message}`); }
};

// Resolves to the call's elapsed ms once it fails; throws if it succeeds or
// is still waiting after BUDGET_MS.
async function failsWithinBudget(call) {
  const t0 = Date.now();
  let timer;
  const hung = new Promise((resolve) => { timer = setTimeout(() => resolve('hung'), BUDGET_MS); });
  const outcome = await Promise.race([call().then(() => 'succeeded', () => 'failed'), hung]);
  clearTimeout(timer);
  if (outcome !== 'failed') throw new Error(`call ${outcome} (wanted a prompt failure)`);
  return Date.now() - t0;
}

(async () => {
  const sockets = new Set();
  const server = net.createServer((s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  const aws = { region: 'us-east-1', endpoint, credentials: { accessKeyId: 'x', secretAccessKey: 'x' }, ...AWS_CLIENT_OPTS };

  await check('DynamoDB call to a silent server fails within the budget', async () => {
    const ddb = DynamoDBDocumentClient.from(new DynamoDBClient(aws));
    const ms = await failsWithinBudget(() => ddb.send(new GetCommand({ TableName: 't', Key: { unit: 'u' } })));
    assert.ok(ms < BUDGET_MS);
  });

  await check('SES send to a silent server fails within the budget (logged as a failed alert)', async () => {
    const ses = new SESv2Client(aws);
    await failsWithinBudget(() => ses.send(new SendEmailCommand({
      FromEmailAddress: 'a@b.c', Destination: { ToAddresses: ['d@e.f'] },
      Content: { Simple: { Subject: { Data: 's' }, Body: { Text: { Data: 't' } } } },
    })));
  });

  for (const s of sockets) s.destroy();
  server.close();
  if (failed) { console.error(`net-limits.test.js: ${failed} failed`); process.exit(1); }
  console.log('net-limits.test.js: all checks passed');
  process.exit(0);
})();
