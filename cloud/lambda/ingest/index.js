'use strict';

const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { SESv2Client, SendEmailCommand } = require('@aws-sdk/client-sesv2');
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
const { InfluxDB, Point } = require('@influxdata/influxdb-client');
const { mapTelemetry } = require('./telemetry-map');
const { checkBattery } = require('./battery-check');
const { sendAlert } = require('./alert-mail');

const REGION     = process.env.AWS_REGION || 'us-east-1';
const INFLUX_URL = `http://${process.env.INFLUX_PRIVATE_IP}:8086`;
const INFLUX_ORG = process.env.INFLUX_ORG    || 'ecofleet';
const BUCKET     = process.env.INFLUX_BUCKET || 'telemetry';

const BATTERY_ALERTS_TABLE = process.env.BATTERY_ALERTS_TABLE || 'ecofleet-prod-battery-alerts';
const USERS_TABLE          = process.env.USERS_TABLE          || 'ecofleet-prod-users';
const ALERT_FROM           = process.env.ALERT_FROM           || '';
const DASHBOARD_URL        = process.env.DASHBOARD_URL        || 'https://frontend-murex-xi-74.vercel.app';

const sm  = new SecretsManagerClient({ region: REGION });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
const ses = new SESv2Client({ region: REGION });
const sns = new SNSClient({ region: REGION });

// ── Low-battery alert I/O (rule + versioning live in battery-check.js) ───────
async function loadState(unit) {
  const { Item } = await ddb.send(new GetCommand({ TableName: BATTERY_ALERTS_TABLE, Key: { unit } }));
  if (!Item) return null;
  const { ver, alerting, lastV, lastSentMs, runKind, runSinceMs } = Item;
  return { ver, state: { alerting, lastV, lastSentMs, runKind, runSinceMs } };
}

async function saveState(unit, state, prevVer) {
  const first = prevVer == null;
  try {
    await ddb.send(new PutCommand({
      TableName: BATTERY_ALERTS_TABLE,
      Item: { unit, ver: (prevVer ?? 0) + 1, ...state },
      ConditionExpression: first ? 'attribute_not_exists(#k)' : '#k = :prev',
      ExpressionAttributeNames: { '#k': first ? 'unit' : 'ver' },
      ...(first ? {} : { ExpressionAttributeValues: { ':prev': prevVer } }),
    }));
    return true;
  } catch (e) {
    if (e.name === 'ConditionalCheckFailedException') return false;
    throw e;
  }
}

async function scanUsers() {
  const items = [];
  let ExclusiveStartKey;
  do {
    const page = await ddb.send(new ScanCommand({
      TableName: USERS_TABLE, ExclusiveStartKey,
      ProjectionExpression: '#e, #a', ExpressionAttributeNames: { '#e': 'email', '#a': 'email_alerts' },
    }));
    items.push(...(page.Items || []));
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

const mailIo = {
  scanUsers,
  sendEmail: ({ from, to, subject, text }) => ses.send(new SendEmailCommand({
    FromEmailAddress: from,
    Destination: { ToAddresses: [to] },
    Content: { Simple: { Subject: { Data: subject }, Body: { Text: { Data: text } } } },
  })),
  publish: ({ subject, text }) => sns.send(new PublishCommand({
    TopicArn: process.env.SNS_TOPIC_ARN, Subject: subject, Message: text,
  })),
};

const batteryIo = {
  loadState,
  saveState,
  sendAlert: (m) => sendAlert(m, mailIo, { alertFrom: ALERT_FROM, dashboardUrl: DASHBOARD_URL }),
};

// Cached across warm invocations
let _influxToken = null;

async function getInfluxToken() {
  if (_influxToken) return _influxToken;
  const res = await sm.send(new GetSecretValueCommand({ SecretId: process.env.INFLUX_SECRET_ARN }));
  _influxToken = res.SecretString;
  return _influxToken;
}

exports.handler = async (event) => {
  // IoT rule delivers the telemetry JSON directly as the event object.
  // The full field set (sensors, APU state enums, climate, component test,
  // and the VEVOR heater block) is documented in cloud/CONTRACT.md and
  // mapped by ./telemetry-map.js. `unit` and `ts` are the only required keys.
  const msg = event;

  if (!msg.unit || !msg.ts) {
    console.error('Dropping malformed telemetry — missing unit or ts:', JSON.stringify(msg));
    return;
  }

  const token  = await getInfluxToken();
  const client = new InfluxDB({ url: INFLUX_URL, token });
  const writeApi = client.getWriteApi(INFLUX_ORG, BUCKET, 'ms');

  const desc  = mapTelemetry(msg);
  const point = new Point(desc.measurement).timestamp(desc.timestamp);
  for (const [k, v] of Object.entries(desc.tags)) point.tag(k, v);
  for (const [k, f] of Object.entries(desc.fields)) {
    if (f.type === 'float')      point.floatField(k, f.value);
    else if (f.type === 'int')   point.intField(k, f.value);
    else if (f.type === 'bool')  point.booleanField(k, f.value);
    else                         point.stringField(k, String(f.value));
  }

  writeApi.writePoint(point);

  try {
    await writeApi.close();
    console.log(`Ingested telemetry: unit=${msg.unit} ts=${msg.ts} mode=${msg.mode}`);
  } catch (err) {
    console.error('InfluxDB write failed:', err.message);
    throw err;  // let Lambda retry / DLQ handle it
  }

  // After the write only, and never throwing: an alert problem must not make
  // IoT retry a reading that is already stored.
  const battery = await checkBattery(msg, Date.now(), batteryIo, DASHBOARD_URL);
  if (battery.error) console.error(battery.error);
  else if (battery.email) console.log(`Battery alert sent: unit=${msg.unit} kind=${battery.email}`);
};
