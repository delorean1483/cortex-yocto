'use strict';

const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const { SNSClient, PublishCommand }                   = require('@aws-sdk/client-sns');
const { SESv2Client, SendEmailCommand }               = require('@aws-sdk/client-sesv2');
const { DynamoDBClient }                              = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand }         = require('@aws-sdk/lib-dynamodb');
const { InfluxDB, Point }                             = require('@influxdata/influxdb-client');
const { sendAlert }                                   = require('./alert-mail');

const REGION     = process.env.AWS_REGION || 'us-east-1';
const INFLUX_URL = `http://${process.env.INFLUX_PRIVATE_IP}:8086`;
const INFLUX_ORG = process.env.INFLUX_ORG    || 'ecofleet';
const BUCKET     = process.env.INFLUX_BUCKET || 'faults';

const USERS_TABLE   = process.env.USERS_TABLE   || 'ecofleet-prod-users';
const ALERT_FROM    = process.env.ALERT_FROM    || '';
const DASHBOARD_URL = process.env.DASHBOARD_URL || 'https://frontend-murex-xi-74.vercel.app';

const sm  = new SecretsManagerClient({ region: REGION });
const sns = new SNSClient({ region: REGION });
const ses = new SESv2Client({ region: REGION });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

// Delivery for alert-mail.js: SNS topic until ALERT_FROM is set, then SES to
// every users-table item with email_alerts = true.
const mailIo = {
  scanUsers: async () => {
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
  },
  sendEmail: ({ from, to, subject, text }) => ses.send(new SendEmailCommand({
    FromEmailAddress: from,
    Destination: { ToAddresses: [to] },
    Content: { Simple: { Subject: { Data: subject }, Body: { Text: { Data: text } } } },
  })),
  publish: ({ subject, text }) => sns.send(new PublishCommand({
    TopicArn: process.env.SNS_TOPIC_ARN, Subject: subject, Message: text,
  })),
};

let _influxToken = null;

async function getInfluxToken() {
  if (_influxToken) return _influxToken;
  const res = await sm.send(new GetSecretValueCommand({ SecretId: process.env.INFLUX_SECRET_ARN }));
  _influxToken = res.SecretString;
  return _influxToken;
}

// Fault bitmask → human-readable description.
// Bit positions match the Gobi APU register REG_FAULT word.
const FAULT_BITS = {
  0x0001: 'Low oil pressure',
  0x0002: 'High coolant temperature',
  0x0004: 'Low battery voltage',
  0x0008: 'Modbus communication failure',
  0x0010: 'Overcurrent',
  0x0020: 'Low fuel',
  0x0040: 'Engine overspeed',
  0x0080: 'Starter failure',
};

function describeFault(faultHex) {
  const word = parseInt(faultHex, 16);
  if (!word) return 'No fault';
  // NB: FAULT_BITS keys are numbers, so Object.entries stringifies them to
  // DECIMAL (0x0010 -> "16"). Use Number(bit), not parseInt(bit, 16), or every
  // bit >= 0x10 is mis-masked (e.g. "16" as hex = 22) and faults mis-decode.
  const active = Object.entries(FAULT_BITS)
    .filter(([bit]) => word & Number(bit))
    .map(([, desc]) => desc);
  return active.length ? active.join(', ') : `Unknown fault (${faultHex})`;
}

// Alarm on a new/changed fault, recovery notice on a 0x0000 clear.
function faultEmail(unit, fault, state, tsMs) {
  const cleared     = (parseInt(fault, 16) || 0) === 0;
  const description = describeFault(fault);
  const isoTime     = new Date(tsMs).toISOString();

  const subject = cleared
    ? `[EcoFleet] Recovered — ${unit}: APU fault cleared`
    : `[EcoFleet] Fault — ${unit}: ${description}`;
  const text = cleared
    ? [
        `Unit     : ${unit}`,
        `Status   : fault cleared (${fault})`,
        `APU state: ${state || 'unknown'}`,
        `Time     : ${isoTime}`,
      ].join('\n')
    : [
        `Unit     : ${unit}`,
        `Fault    : ${fault}  (${description})`,
        `APU state: ${state || 'unknown'}`,
        `Time     : ${isoTime}`,
      ].join('\n');
  return { subject, text };
}

// Exported for unit tests (faults.test.js, excluded from the deploy zip).
// The Lambda entry point remains exports.handler below.
exports.describeFault = describeFault;
exports.faultEmail = faultEmail;

exports.handler = async (event) => {
  // IoT rule delivers fault JSON directly as event:
  //   { unit, ts (epoch ms), fault (hex string e.g. "0x0004"), state }
  const { unit, ts, fault, state } = event;

  if (!unit || !fault) {
    console.error('Dropping malformed fault event — missing unit or fault:', JSON.stringify(event));
    return;
  }

  const tsMs = ts || Date.now();

  // A fault word of 0 is a fault-cleared (recovery) event, not a new alarm.
  const word    = parseInt(fault, 16) || 0;
  const cleared = word === 0;

  // 1. Write to InfluxDB faults bucket
  const token    = await getInfluxToken();
  const client   = new InfluxDB({ url: INFLUX_URL, token });
  const writeApi = client.getWriteApi(INFLUX_ORG, BUCKET, 'ms');

  const point = new Point('faults')
    .tag('unit',         unit)
    .stringField('fault', fault)
    .stringField('state', state || 'unknown')
    .stringField('description', describeFault(fault))
    .booleanField('active', !cleared)   // false marks the fault-cleared event
    .timestamp(tsMs);

  writeApi.writePoint(point);

  try {
    await writeApi.close();
  } catch (err) {
    console.error('InfluxDB write failed:', err.message);
    throw err;
  }

  // 2. Email: the SNS topic until ALERT_FROM is set, then everyone opted in
  try {
    const { via, sent } = await sendAlert(faultEmail(unit, fault, state, tsMs), mailIo,
      { alertFrom: ALERT_FROM, dashboardUrl: DASHBOARD_URL });
    console.log(`Fault ${cleared ? 'cleared' : 'recorded and alerted'}: `
      + `unit=${unit} fault=${fault} (${describeFault(fault)}) via=${via} sent=${sent}`);
  } catch (err) {
    // Write succeeded — don't fail the Lambda over an email error
    console.error('Alert email failed (fault already written to InfluxDB):', err.message);
  }
};
