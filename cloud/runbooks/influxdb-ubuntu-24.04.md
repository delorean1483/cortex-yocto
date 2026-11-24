# InfluxDB server: Ubuntu 22.04 → 24.04 in place

**Why:** AWS Health notice of 2026-11-24. Ubuntu 22.04 standard support ends
**2027-05-31**; after that the box gets no security fixes. 24.04 is supported
to May 2029. Do this before then.

**Who / how long:** you, from the Mac (`aws` profile `ecofleet`, plus the
Session Manager plugin, already in `/usr/local/bin`). Plan about 1 hour;
InfluxDB is down for about 30 minutes of it.

**Fallback if it can't be done in time:** attach Ubuntu Pro 22.04 in place
with AWS License Manager (security fixes to 2032, small hourly charge).

## The box (as of 2026-11-24)

| | |
|---|---|
| Instance | `i-0e96966315664b85f`, Name `ecofleet-prod-influxdb`, t3.micro (1 GB RAM), us-east-1a |
| Access | private subnet, no public IP: SSM Session Manager only |
| Disk | root volume `vol-0bcb6dda416faa06f`, gp3 100 GB, encrypted. InfluxDB data lives on it |
| Backups | DLM snapshot daily at 03:00 UTC, 14 kept |
| Terraform | `prevent_destroy`, `ignore_changes = [ami, user_data, root_block_device]`: an in-place upgrade causes no drift and no replacement |
| Writers | Lambdas `ingest`, `fault_handler`, `api` → `http://<private ip>:8086` |

IDs change after a volume restore, so look them up instead of trusting the
table:

```bash
export AWS_PROFILE=ecofleet AWS_REGION=us-east-1
IID=$(aws ec2 describe-instances \
  --filters Name=tag:Name,Values=ecofleet-prod-influxdb Name=instance-state-name,Values=running \
  --query 'Reservations[].Instances[].InstanceId' --output text)
VOL=$(aws ec2 describe-instances --instance-ids "$IID" \
  --query 'Reservations[].Instances[].BlockDeviceMappings[?DeviceName==`/dev/sda1`].Ebs.VolumeId' \
  --output text)
echo "$IID $VOL"
```

## What people will notice during the window

- Dashboard pages that read InfluxDB (charts, reports, history) fail or show
  gaps.
- Telemetry sent while InfluxDB is down is mostly **lost**: the `ingest`
  Lambda throws, Lambda retries the event twice over about 3 minutes, then
  drops it. Expect a gap in the charts about as long as the outage.
- Alarms `ecofleet-prod-ingest-errors`, `ecofleet-prod-fault_handler-errors`,
  `ecofleet-prod-api-errors` go to ALARM and email the alerts topic. They
  return to OK on their own.

Pick a quiet time.

## 1. Connect and look

```bash
aws ssm start-session --target "$IID"
sudo -i
```

```bash
lsb_release -ds                     # Ubuntu 22.04.x LTS
df -h /                             # want > 5 GB free
free -m; swapon --show
systemctl is-active influxdb && curl -s localhost:8086/health    # "status":"pass"
dpkg -l influxdb2 influxdb2-cli | tail -2
cat /etc/apt/sources.list.d/influxdata.list
influx bucket list                  # telemetry + faults
```

If `influx` asks for a token: `terraform output influx_secret_arn` (in
`cloud/terraform`), then
`aws secretsmanager get-secret-value --secret-id <arn> --query SecretString --output text`
on the Mac, and `export INFLUX_TOKEN=...` on the box.

Record a point count for a fixed window, to compare after the upgrade.
**Write down START and STOP**:

```bash
START=$(date -u -d 'yesterday 00:00' +%FT%TZ); STOP=$(date -u -d 'today 00:00' +%FT%TZ)
echo "$START $STOP"
influx query "from(bucket:\"telemetry\") |> range(start: $START, stop: $STOP) |> group() |> count()"
```

## 2. Replace the expired InfluxData apt key

The key the box was set up with (`influxdata-archive_compat.key`) **expired
2026-01-17**, so `apt-get update` has been rejecting the InfluxData repo since
then. Switch to `influxdata-archive.key` and check its published fingerprint:

```bash
curl -fsSL https://repos.influxdata.com/influxdata-archive.key -o /tmp/influxdata-archive.key
gpg --show-keys --with-fingerprint --with-colons /tmp/influxdata-archive.key 2>&1 \
  | grep -q '^fpr:\+24C975CBA61A024EE1B631787C3D57159FC2F927:$' && echo KEY OK
install -d -m 0755 /etc/apt/keyrings
gpg --dearmor < /tmp/influxdata-archive.key > /etc/apt/keyrings/influxdata-archive.gpg
echo 'deb [signed-by=/etc/apt/keyrings/influxdata-archive.gpg] https://repos.influxdata.com/debian stable main' \
  > /etc/apt/sources.list.d/influxdata.list
rm -f /etc/apt/trusted.gpg.d/influxdata-archive_compat.gpg
apt-get update                      # no EXPKEYSIG / NO_PUBKEY errors
```

Stop here if `KEY OK` is not printed.

## 3. Patch 22.04, keep InfluxDB at its current version

Hold the InfluxDB packages so the OS upgrade doesn't also change the database
version (that's step 7, separately):

```bash
apt-mark hold influxdb2 influxdb2-cli
apt-get -y full-upgrade
[ -f /var/run/reboot-required ] && reboot
```

If it rebooted, reconnect (step 1 commands) and check
`curl -s localhost:8086/health` again.

1 GB RAM is tight for a release upgrade. If `swapon --show` printed nothing,
add temporary swap (gone after the upgrade's reboot; delete the file in step 8):

```bash
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
```

## 4. Stop InfluxDB and snapshot the volume

On the box:

```bash
systemctl stop influxdb
```

On the Mac:

```bash
SNAP=$(aws ec2 create-snapshot --volume-id "$VOL" \
  --description "influxdb before 24.04 upgrade $(date +%F)" \
  --tag-specifications 'ResourceType=snapshot,Tags=[{Key=Name,Value=ecofleet-prod-influxdb-pre-2404},{Key=Project,Value=ecofleet}]' \
  --query SnapshotId --output text); echo "$SNAP"
aws ec2 wait snapshot-completed --snapshot-ids "$SNAP"   # re-run if the waiter times out
```

It is incremental on top of the daily snapshots, so usually a few minutes.
DLM does not manage it: delete it by hand (step 8). **Write down `$SNAP`.**

## 5. Release upgrade

Run it inside tmux: an idle SSM session drops after about 20 minutes, and
tmux keeps the upgrade running. Reattach with `tmux attach -t upg`.

```bash
tmux new -s upg
grep ^Prompt /etc/update-manager/release-upgrades     # must be Prompt=lts
do-release-upgrade
```

It offers 24.04 only (22.04 can't jump to 26.04). Answers:

- Third-party sources disabled (InfluxData): OK.
- Start the upgrade: `y`.
- Restart services without asking: yes.
- Modified configuration file: keep the locally installed version (the
  default).
- Remove obsolete packages: `y`.
- Restart now: `y`.

The SSM agent is a snap and survives the upgrade. Reconnect a few minutes
after the reboot.

## 6. Check

```bash
sudo -i
lsb_release -ds                     # Ubuntu 24.04.x LTS
snap services amazon-ssm-agent
cat /etc/apt/sources.list.d/influxdata.list   # the upgrader commented it out
echo 'deb [signed-by=/etc/apt/keyrings/influxdata-archive.gpg] https://repos.influxdata.com/debian stable main' \
  > /etc/apt/sources.list.d/influxdata.list
apt-get update                      # clean
systemctl is-active influxdb && curl -s localhost:8086/health    # "status":"pass"
influx bucket list
```

Same count as in step 1, using the START and STOP you wrote down:

```bash
influx query "from(bucket:\"telemetry\") |> range(start: <START>, stop: <STOP>) |> group() |> count()"
```

New data arriving (if any unit is online), within a few minutes:

```bash
influx query 'from(bucket:"telemetry") |> range(start: -10m) |> group() |> count()'
```

On the Mac: the dashboard charts load, and after about 5 minutes no alarm is
left in ALARM:

```bash
aws cloudwatch describe-alarms --alarm-name-prefix ecofleet-prod --state-value ALARM \
  --query 'MetricAlarms[].AlarmName'
```

## 7. InfluxDB package updates (separately, next day)

After the next daily snapshot (03:00 UTC), let InfluxDB update again:

```bash
apt-mark unhold influxdb2 influxdb2-cli
apt-get install --only-upgrade influxdb2 influxdb2-cli
systemctl is-active influxdb && curl -s localhost:8086/health
```

## 8. Clean up

- `rm -f /swapfile` (if you added it).
- After about two weeks: `aws ec2 delete-snapshot --snapshot-id <SNAP>`.

## Rollback

If the box doesn't come back, or InfluxDB is broken and not quickly fixable,
put the step-4 snapshot back as the root volume. Same instance, same private
IP, so the Lambdas need no change. Telemetry written after the snapshot is
lost.

```bash
aws ec2 stop-instances --instance-ids "$IID" && aws ec2 wait instance-stopped --instance-ids "$IID"
NEW=$(aws ec2 create-volume --snapshot-id "$SNAP" --availability-zone us-east-1a --volume-type gp3 \
  --tag-specifications 'ResourceType=volume,Tags=[{Key=Name,Value=ecofleet-prod-influxdb},{Key=Project,Value=ecofleet}]' \
  --query VolumeId --output text)
aws ec2 wait volume-available --volume-ids "$NEW"
aws ec2 detach-volume --volume-id "$VOL" && aws ec2 wait volume-available --volume-ids "$VOL"
aws ec2 attach-volume --volume-id "$NEW" --instance-id "$IID" --device /dev/sda1
aws ec2 start-instances --instance-ids "$IID"
```

Keep the old volume (`$VOL`) until the restored box is checked (step 6
commands), then delete it. The volume comes back encrypted with the
snapshot's key. Terraform ignores `root_block_device`, so the swap causes no
drift.
