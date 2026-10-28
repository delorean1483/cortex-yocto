'use strict';

const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const { SNSClient, PublishCommand }                   = require('@aws-sdk/client-sns');
const { SESv2Client, SendEmailCommand }               = require('@aws-sdk/client-sesv2');
const { DynamoDBClient }                              = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand }         = require('@aws-sdk/lib-dynamodb');
const { InfluxDB, Point, flux }                       = require('@influxdata/influxdb-client');
const { sendAlert, sesEmailInput }                    = require('./alert-mail');
const { handleFault }                                 = require('./fault-alert');

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
  sendEmail: (m) => ses.send(new SendEmailCommand(sesEmailInput(m))),
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

function influxClient(token) {
  return new InfluxDB({ url: INFLUX_URL, token });
}

// The unit's newest record at or before tsMs (stop is exclusive, hence +1), so
// a redelivered message finds its own earlier copy. Records from before error_n
// existed have no such field and are not found.
async function lastFault(unit, tsMs) {
  const queryApi = influxClient(await getInfluxToken()).getQueryApi(INFLUX_ORG);
  const rows = await queryApi.collectRows(flux`
    from(bucket: ${BUCKET})
      |> range(start: 1970-01-01T00:00:00Z, stop: ${new Date(tsMs + 1)})
      |> filter(fn: (r) => r._measurement == "faults" and r.unit == ${unit} and r._field == "error_n")
      |> last()
  `);
  if (!rows.length) return null;
  return { code: Number(rows[0]._value), tsMs: Date.parse(rows[0]._time) };
}

async function writeFault(unit, tsMs, f) {
  const writeApi = influxClient(await getInfluxToken()).getWriteApi(INFLUX_ORG, BUCKET, 'ms');
  writeApi.writePoint(new Point('faults')
    .tag('unit', unit)
    .stringField('fault', f.fault)
    .stringField('error', f.error)
    .intField('error_n', f.error_n)
    .stringField('description', f.description)
    .stringField('state', f.state)
    .stringField('status', f.status)
    .booleanField('active', f.active)
    .timestamp(tsMs));
  await writeApi.close();
}

// IoT rule `SELECT * FROM 'ecofleet/+/faults'` delivers the agent's message as
// the event. Email goes to the SNS topic until ALERT_FROM is set, then to
// everyone who turned email alerts on.
exports.handler = async (event) => {
  await handleFault(event, {
    lastFault,
    writeFault,
    sendAlert: async (m) => {
      const { via, sent, failed } = await sendAlert(m, mailIo, { alertFrom: ALERT_FROM, dashboardUrl: DASHBOARD_URL });
      console.log(`Fault email "${m.subject}" via=${via} sent=${sent} failed=${failed.length}`);
    },
  }, DASHBOARD_URL, Date.now());
};
