# ── Latest Ubuntu 22.04 LTS AMI ───────────────────────────────────────────────
data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # Canonical

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

# ── EC2 key pair ──────────────────────────────────────────────────────────────
resource "aws_key_pair" "deploy" {
  key_name   = var.ec2_key_name
  public_key = var.ec2_public_key

  tags = {
    Project = var.project
  }
}

# ── IAM role for SSM access (no bastion needed) ───────────────────────────────
resource "aws_iam_role" "influxdb_ssm" {
  name = "${var.project}-${var.env}-influxdb-ssm-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
    }]
  })

  tags = { Project = var.project }
}

resource "aws_iam_role_policy_attachment" "influxdb_ssm" {
  role       = aws_iam_role.influxdb_ssm.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "influxdb" {
  name = "${var.project}-${var.env}-influxdb-profile"
  role = aws_iam_role.influxdb_ssm.name
}

# ── InfluxDB EC2 instance ─────────────────────────────────────────────────────
resource "aws_instance" "influxdb" {
  ami                    = data.aws_ami.ubuntu.id
  instance_type          = var.influxdb_instance_type
  subnet_id              = aws_subnet.private_a.id
  vpc_security_group_ids = [aws_security_group.influxdb.id]
  key_name               = aws_key_pair.deploy.key_name
  iam_instance_profile   = aws_iam_instance_profile.influxdb.name

  root_block_device {
    volume_type           = "gp3"
    volume_size           = var.influxdb_volume_size
    encrypted             = true
    delete_on_termination = false
  }

  user_data = <<-USERDATA
    #!/bin/bash
    set -e

    # Install InfluxDB 2.x
    curl -s https://repos.influxdata.com/influxdata-archive_compat.key \
      | gpg --dearmor > /etc/apt/trusted.gpg.d/influxdata-archive_compat.gpg

    echo "deb [signed-by=/etc/apt/trusted.gpg.d/influxdata-archive_compat.gpg] \
      https://repos.influxdata.com/debian stable main" \
      > /etc/apt/sources.list.d/influxdata.list

    apt-get update && apt-get install -y influxdb2 influxdb2-cli

    systemctl enable influxdb
    systemctl start influxdb

    # Wait for influxd to accept connections.
    for i in $(seq 1 60); do
      curl -sf http://localhost:8086/health && break
      sleep 2
    done

    # Idempotent first-run setup so a fresh instance is fully usable without
    # manual steps: org=ecofleet, bucket=telemetry (90d), faults (365d), and the
    # admin token the Lambdas read from Secrets Manager. The admin UI password is
    # throwaway (only the token is used programmatically). `influx org list`
    # succeeds only once configured, so this block runs at most once.
    if ! influx org list >/dev/null 2>&1; then
      influx setup --force \
        --org ecofleet \
        --bucket telemetry \
        --retention 2160h \
        --username admin \
        --password "$(openssl rand -base64 24)" \
        --token "${var.influx_token}"
      influx bucket create --name faults --org ecofleet --retention 8760h \
        --token "${var.influx_token}" || true
    fi

    # Install SSM agent
    snap install amazon-ssm-agent --classic
    systemctl enable snap.amazon-ssm-agent.amazon-ssm-agent
    systemctl start snap.amazon-ssm-agent.amazon-ssm-agent
  USERDATA

  tags = {
    Name    = "${var.project}-${var.env}-influxdb"
    Project = var.project
  }

  # InfluxDB is a stateful pet: its data lives on this instance's root volume.
  # - prevent_destroy: terraform must never destroy/replace it (a replace wipes
  #   telemetry; recover from the DLM EBS snapshots if the box is ever lost).
  # - ignore_changes: the AMI is `most_recent` (drifts as Canonical publishes new
  #   images) and would otherwise force replacement; user_data/root_block_device
  #   are ignored so config edits and out-of-band volume restores don't trigger
  #   a replace. To intentionally rebuild, remove prevent_destroy deliberately.
  lifecycle {
    prevent_destroy = true
    ignore_changes  = [ami, user_data, root_block_device]
  }
}

# ── EBS snapshot lifecycle policy (daily, 14-day retention) ──────────────────
resource "aws_iam_role" "dlm" {
  name = "${var.project}-${var.env}-dlm-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "dlm.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "dlm" {
  role       = aws_iam_role.dlm.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSDataLifecycleManagerServiceRole"
}

resource "aws_dlm_lifecycle_policy" "influxdb" {
  description        = "${var.project}-${var.env} InfluxDB EBS snapshots"
  execution_role_arn = aws_iam_role.dlm.arn
  state              = "ENABLED"

  policy_details {
    resource_types = ["INSTANCE"]

    schedule {
      name = "Daily snapshots - 14 day retention"

      create_rule {
        interval      = 24
        interval_unit = "HOURS"
        times         = ["03:00"]
      }

      retain_rule {
        count = 14
      }

      tags_to_add = {
        SnapshotCreator = "DLM"
        Project         = var.project
      }

      copy_tags = true
    }

    target_tags = {
      Name = "${var.project}-${var.env}-influxdb"
    }
  }

  tags = { Project = var.project }
}
