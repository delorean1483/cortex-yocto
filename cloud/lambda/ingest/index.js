'use strict';

const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const { InfluxDB, Point } = require('@influxdata/influxdb-client');
const { mapTelemetry } = require('./telemetry-map');

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
};
