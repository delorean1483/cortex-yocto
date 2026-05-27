# ── Lambda security group ─────────────────────────────────────────────────────
resource "aws_security_group" "lambda" {
  name        = "${var.project}-${var.env}-lambda-sg"
  description = "Lambda functions - egress only"
  vpc_id      = aws_vpc.main.id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
    description = "Allow all egress (NAT Gateway routes to InfluxDB + AWS APIs)"
  }

  tags = {
    Name    = "${var.project}-${var.env}-lambda-sg"
    Project = var.project
  }
}

# ── InfluxDB EC2 security group ───────────────────────────────────────────────
resource "aws_security_group" "influxdb" {
  name        = "${var.project}-${var.env}-influxdb-sg"
  description = "InfluxDB EC2 - only reachable from Lambda SG"
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port       = 8086
    to_port         = 8086
    protocol        = "tcp"
    security_groups = [aws_security_group.lambda.id]
    description     = "InfluxDB HTTP from Lambda only"
  }

  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/16"]
    description = "SSH from VPC only (via SSM or bastion)"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
    description = "Allow all egress for updates"
  }

  tags = {
    Name    = "${var.project}-${var.env}-influxdb-sg"
    Project = var.project
  }
}
