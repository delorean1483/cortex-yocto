# InfluxDB server: Ubuntu 22.04 → 24.04 in place

**Why:** AWS Health notice of 2026-11-24. Ubuntu 22.04 standard support ends
**2027-05-31**; after that the box gets no security fixes. 24.04 is supported
to May 2029. The same steps work for 24.04 → 26.04 later.

**Status: done 2026-11-24, 18:45–19:06 UTC.**
- Ubuntu 22.04.5 → **24.04.5 LTS**, kernel 7.0.0-1018-aws. InfluxDB 2.7.6 untouched.
- Counts matched before and after: 165,681 telemetry points for 2026-11-23, 28 fault records. New data arrived right after the reboot.
- The release upgrade took 13 minutes. No `ERROR` lines in its log, `dpkg --audit` clean, no failed units, `apt-get update` clean.
- `ingest` Lambda: 3 errors in total (the two reboots). No alarm changed state.
- Pre-upgrade snapshot `snap-0e37af53baa49ae0a`: delete after 2026-12-08.
- EC2 still lists the original 22.04 AMI for the instance; that's normal after an in-place upgrade.

**How:** everything runs from the Mac through `aws ssm send-command` (no
interactive session, no SSH). Plan about 1 hour. InfluxDB is down only for
the two reboots (about 1–2 minutes each) and about 10 seconds for the
snapshot; it keeps running during the release upgrade itself.

**Fallback if it can't be done in time:** attach Ubuntu Pro in place with AWS
License Manager (security fixes for 10 years from release, small hourly
charge).

## The box (checked 2026-11-24)

| | |
|---|---|
| Instance | `i-0e96966315664b85f`, Name `ecofleet-prod-influxdb`, t3.micro (914 MB RAM, no swap), us-east-1a |
| Access | private subnet, no public IP: SSM only (agent is a snap) |
| Disk | root volume `vol-0bcb6dda416faa06f`, gp3 100 GB, encrypted, ~4 GB used |
| InfluxDB | **installed by hand, not from apt**: `/usr/local/bin/influxd` 2.7.6 and `/usr/local/bin/influx`, unit file `/etc/systemd/system/influxdb.service`, data in `/var/lib/influxdb` (~20 MB). apt doesn't manage it, so OS upgrades don't touch it |
| apt | the InfluxData source (`influxdata.list`) was unused and its key `influxdata-archive_compat.key` expired 2026-01-17; it was moved to `/root/apt-disabled/` |
| Backups | DLM snapshot daily at 03:00 UTC, 14 kept |
| Terraform | `prevent_destroy`, `ignore_changes = [ami, user_data, root_block_device]`: an in-place upgrade causes no drift. A rebuild would install the `influxdb2` apt package instead (user_data) |
| Writers | Lambdas `ingest`, `fault_handler`, `api` → `http://<private ip>:8086` |

## What people notice

- Telemetry sent while InfluxDB is down is mostly lost (the `ingest` Lambda
  throws, Lambda retries twice over ~3 minutes, then drops the event): short
  gaps in the charts around each reboot.
- The `ecofleet-prod-*-errors` alarms may email and then clear on their own.

## Helper

```bash
export AWS_PROFILE=ecofleet AWS_REGION=us-east-1 AWS_PAGER=""
IID=$(aws ec2 describe-instances \
  --filters Name=tag:Name,Values=ecofleet-prod-influxdb Name=instance-state-name,Values=running \
  --query 'Reservations[].Instances[].InstanceId' --output text)
VOL=$(aws ec2 describe-instances --instance-ids "$IID" \
  --query 'Reservations[].Instances[].BlockDeviceMappings[?DeviceName==`/dev/sda1`].Ebs.VolumeId' \
  --output text)

# ssm <<'EOF' ... EOF : run a script as root on the box, print status + output
ssm() {
  local p id
  p=$(jq -n --arg c "export HOME=/root
$(cat)" '{commands:[$c], executionTimeout:["3000"]}')
  id=$(aws ssm send-command --instance-ids "$IID" --document-name AWS-RunShellScript \
       --parameters "$p" --query Command.CommandId --output text) || return 1
  until aws ssm wait command-executed --command-id "$id" --instance-id "$IID" 2>/dev/null; do
    case $(aws ssm get-command-invocation --command-id "$id" --instance-id "$IID" \
           --query Status --output text) in Failed|Cancelled|TimedOut) break;; esac
  done
  aws ssm get-command-invocation --command-id "$id" --instance-id "$IID" \
    --query '[Status,StandardOutputContent,StandardErrorContent]' --output text
}
```

`HOME=/root` matters: the `influx` CLI finds its token in
`/root/.influxdbv2/configs`.

## 1. Baseline

Note the numbers; step 6 compares against them.

```bash
ssm <<'EOF'
lsb_release -ds; df -h / | tail -1; free -m | sed -n 2,3p
curl -s localhost:8086/health; echo
influx query 'from(bucket:"telemetry") |> range(start: 2026-11-23T00:00:00Z, stop: 2026-11-24T00:00:00Z) |> group() |> count()' | tail -1
influx query 'from(bucket:"faults") |> range(start: 0) |> group() |> count()' | tail -1
EOF
```

(Use a recent full day for the telemetry window; it must still be inside the
90-day retention when you compare.)

## 2. Patch the current release and reboot

`do-release-upgrade` refuses to start while a reboot is pending.

```bash
ssm <<'EOF'
export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=l
apt-get update 2>&1 | tail -3
apt-get -y -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold full-upgrade > /root/apt-full-upgrade.log 2>&1
grep -E "^[0-9]+ upgraded" /root/apt-full-upgrade.log; ls /var/run/reboot-required
EOF
ssm <<'EOF'
systemd-run --on-active=3 /bin/systemctl reboot
EOF
```

The timer can fire up to a minute late, so check `/proc/uptime` before
trusting a "after the reboot" check:

```bash
ssm <<'EOF'
cut -d. -f1 /proc/uptime; uname -r
systemctl is-active influxdb; curl -s localhost:8086/health; echo
EOF
```

## 3. Swap, then snapshot

914 MB RAM is tight for a release upgrade: add 2 GB of swap (not in
`/etc/fstab`, so it's gone after the next reboot). Stop InfluxDB only for the
moment the snapshot starts; an EBS snapshot is point-in-time at the API call.

```bash
ssm <<'EOF'
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
systemctl stop influxdb; sync
EOF
SNAP=$(aws ec2 create-snapshot --volume-id "$VOL" \
  --description "influxdb before release upgrade $(date +%F)" \
  --tag-specifications 'ResourceType=snapshot,Tags=[{Key=Name,Value=ecofleet-prod-influxdb-pre-upgrade},{Key=Project,Value=ecofleet}]' \
  --query SnapshotId --output text); echo "$SNAP"
ssm <<'EOF'
systemctl start influxdb; sleep 5; curl -s localhost:8086/health
EOF
aws ec2 wait snapshot-completed --snapshot-ids "$SNAP"   # re-run if the waiter times out
```

**Write down `$SNAP`.** DLM doesn't manage it: delete it by hand (step 7).

## 4. Release upgrade

Run it as its own systemd unit, so it doesn't depend on the SSM agent's
command staying alive. The non-interactive frontend keeps local config files
and does not reboot by itself.

```bash
ssm <<'EOF'
fuser /var/lib/dpkg/lock-frontend && { echo "dpkg busy, try again later"; exit 1; }
do-release-upgrade -c | tail -2
systemd-run --unit=ecofleet-release-upgrade --setenv=DEBIAN_FRONTEND=noninteractive \
  /bin/bash -c 'do-release-upgrade -f DistUpgradeViewNonInteractive > /root/release-upgrade.log 2>&1; echo "EXIT=$?" >> /root/release-upgrade.log'
EOF
```

Check every few minutes until the unit is no longer active:

```bash
ssm <<'EOF'
systemctl is-active ecofleet-release-upgrade; free -m | sed -n 2,3p
tail -2 /var/log/dist-upgrade/apt-term.log; grep EXIT= /root/release-upgrade.log
EOF
```

Then look at the end of `/root/release-upgrade.log` and
`/var/log/dist-upgrade/main.log` for errors.

## 5. Remove the swap and reboot

```bash
ssm <<'EOF'
swapoff /swapfile && rm -f /swapfile
systemd-run --on-active=2 --timer-property=AccuracySec=1s /bin/systemctl reboot
EOF
```

Again, the reboot can start up to about a minute later; check `/proc/uptime`
in step 6.

## 6. Check

```bash
ssm <<'EOF'
cut -d. -f1 /proc/uptime; lsb_release -ds; uname -r
snap services amazon-ssm-agent
systemctl is-active influxdb; curl -s localhost:8086/health; echo
influx query 'from(bucket:"telemetry") |> range(start: 2026-11-23T00:00:00Z, stop: 2026-11-24T00:00:00Z) |> group() |> count()' | tail -1
influx query 'from(bucket:"faults") |> range(start: 0) |> group() |> count()' | tail -1
influx query 'from(bucket:"telemetry") |> range(start: -5m) |> group() |> count()' | tail -1
apt-get update 2>&1 | grep -E "^(W|E):" || echo "apt clean"
EOF
aws cloudwatch describe-alarms --alarm-name-prefix ecofleet-prod --state-value ALARM \
  --query 'MetricAlarms[].AlarmName'
```

Expect: the new release, InfluxDB `pass`, the same baseline counts, new
points in the last 5 minutes (if a unit is online), and no alarm left in
ALARM after a few minutes.

## 7. Clean up

After about two weeks: `aws ec2 delete-snapshot --snapshot-id <SNAP>`.

## Rollback

If the box doesn't come back, or InfluxDB is broken and not quickly fixable,
put the step-3 snapshot back as the root volume. Same instance, same private
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

Keep the old volume until the restored box passes step 6, then delete it.
The volume comes back encrypted with the snapshot's key. Terraform ignores
`root_block_device`, so the swap causes no drift.
