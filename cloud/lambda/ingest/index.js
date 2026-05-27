'use strict';

const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const { InfluxDB, Point } = require('@influxdata/influxdb-client');

const REGION     = process.env.AWS_REGION || 'us-east-1';
const INFLUX_URL = `http://${process.env.INFLUX_PRIVATE_IP}:8086`;
const INFLUX_ORG = process.env.INFLUX_ORG    || 'ecofleet';
const BUCKET     = process.env.INFLUX_BUCKET || 'telemetry';

const sm = new SecretsManagerClient({ region: REGION });

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
  // Required fields from gobi-agent build_telemetry_json():
  //   unit, ts (epoch ms), dc_v, dc_a, batt_v, batt_soc, batt_t,
  //   apu_state, runtime_hrs, watts, rpm, oil_psi, coolant_t, fault
  const msg = event;

  if (!msg.unit || !msg.ts) {
    console.error('Dropping malformed telemetry — missing unit or ts:', JSON.stringify(msg));
    return;
  }

  const token  = await getInfluxToken();
  const client = new InfluxDB({ url: INFLUX_URL, token });
  const writeApi = client.getWriteApi(INFLUX_ORG, BUCKET, 'ms');

  const point = new Point('telemetry')
    .tag('unit',          msg.unit)
    .floatField('dc_v',       msg.dc_v        ?? 0)
    .floatField('dc_a',       msg.dc_a        ?? 0)
    .floatField('batt_v',     msg.batt_v      ?? 0)
    .floatField('batt_soc',   msg.batt_soc    ?? 0)
    .floatField('batt_t',     msg.batt_t      ?? 0)
    .stringField('apu_state', msg.apu_state   || 'unknown')
    .intField('runtime_hrs',  msg.runtime_hrs ?? 0)
    .intField('watts',        msg.watts       ?? 0)
    .intField('rpm',          msg.rpm         ?? 0)
    .floatField('oil_psi',    msg.oil_psi     ?? 0)
    .floatField('coolant_t',  msg.coolant_t   ?? 0)
    .stringField('fault',     msg.fault       || '0x0000')
    .timestamp(msg.ts);

  writeApi.writePoint(point);

  try {
    await writeApi.close();
    console.log(`Ingested telemetry: unit=${msg.unit} ts=${msg.ts} apu_state=${msg.apu_state}`);
  } catch (err) {
    console.error('InfluxDB write failed:', err.message);
    throw err;  // let Lambda retry / DLQ handle it
  }
};
