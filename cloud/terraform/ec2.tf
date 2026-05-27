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

    # Install SSM agent
    snap install amazon-ssm-agent --classic
    systemctl enable snap.amazon-ssm-agent.amazon-ssm-agent
    systemctl start snap.amazon-ssm-agent.amazon-ssm-agent
  USERDATA

  tags = {
    Name    = "${var.project}-${var.env}-influxdb"
    Project = var.project
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
