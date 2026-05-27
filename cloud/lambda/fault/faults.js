'use strict';

const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const { SNSClient, PublishCommand }                   = require('@aws-sdk/client-sns');
const { InfluxDB, Point }                             = require('@influxdata/influxdb-client');

const REGION     = process.env.AWS_REGION || 'us-east-1';
const INFLUX_URL = `http://${process.env.INFLUX_PRIVATE_IP}:8086`;
const INFLUX_ORG = process.env.INFLUX_ORG    || 'ecofleet';
const BUCKET     = process.env.INFLUX_BUCKET || 'faults';

const sm  = new SecretsManagerClient({ region: REGION });
const sns = new SNSClient({ region: REGION });

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
  const active = Object.entries(FAULT_BITS)
    .filter(([bit]) => word & parseInt(bit, 16))
    .map(([, desc]) => desc);
  return active.length ? active.join(', ') : `Unknown fault (${faultHex})`;
}

exports.handler = async (event) => {
  // IoT rule delivers fault JSON directly as event:
  //   { unit, ts (epoch ms), fault (hex string e.g. "0x0004"), state }
  const { unit, ts, fault, state } = event;

  if (!unit || !fault) {
    console.error('Dropping malformed fault event — missing unit or fault:', JSON.stringify(event));
    return;
  }

  const tsMs = ts || Date.now();

  // 1. Write to InfluxDB faults bucket
  const token    = await getInfluxToken();
  const client   = new InfluxDB({ url: INFLUX_URL, token });
  const writeApi = client.getWriteApi(INFLUX_ORG, BUCKET, 'ms');

  const point = new Point('faults')
    .tag('unit',         unit)
    .stringField('fault', fault)
    .stringField('state', state || 'unknown')
    .stringField('description', describeFault(fault))
    .timestamp(tsMs);

  writeApi.writePoint(point);

  try {
    await writeApi.close();
  } catch (err) {
    console.error('InfluxDB write failed:', err.message);
    throw err;
  }

  // 2. SNS alert
  const description = describeFault(fault);
  const isoTime     = new Date(tsMs).toISOString();

  try {
    await sns.send(new PublishCommand({
      TopicArn: process.env.SNS_TOPIC_ARN,
      Subject:  `[EcoFleet] Fault — ${unit}: ${description}`,
      Message: [
        `Unit     : ${unit}`,
        `Fault    : ${fault}  (${description})`,
        `APU state: ${state || 'unknown'}`,
        `Time     : ${isoTime}`,
      ].join('\n'),
    }));
    console.log(`Fault recorded and alerted: unit=${unit} fault=${fault} (${description})`);
  } catch (err) {
    // Write succeeded — don't fail the Lambda over an SNS error
    console.error('SNS publish failed (fault already written to InfluxDB):', err.message);
  }
};
