# ── InfluxDB token ────────────────────────────────────────────────────────────
resource "aws_secretsmanager_secret" "influx_token" {
  name                    = "${var.project}-${var.env}/influx-token"
  description             = "InfluxDB 2.x admin token for Lambda write access"
  recovery_window_in_days = 7

  tags = { Project = var.project }
}

resource "aws_secretsmanager_secret_version" "influx_token" {
  secret_id     = aws_secretsmanager_secret.influx_token.id
  secret_string = var.influx_token
}

# ── JWT signing secret ────────────────────────────────────────────────────────
resource "aws_secretsmanager_secret" "jwt_secret" {
  name                    = "${var.project}-${var.env}/jwt-secret"
  description             = "JWT signing secret for API Gateway auth"
  recovery_window_in_days = 7

  tags = { Project = var.project }
}

resource "aws_secretsmanager_secret_version" "jwt_secret" {
  secret_id     = aws_secretsmanager_secret.jwt_secret.id
  secret_string = var.jwt_secret
}
