# ── IAM role for all Lambda functions ────────────────────────────────────────
resource "aws_iam_role" "lambda" {
  name = "${var.project}-${var.env}-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })

  tags = { Project = var.project }
}

resource "aws_iam_role_policy_attachment" "lambda_vpc" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

resource "aws_iam_role_policy" "lambda" {
  name = "${var.project}-${var.env}-lambda-policy"
  role = aws_iam_role.lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "SecretsManager"
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue",
          "secretsmanager:DescribeSecret"
        ]
        Resource = [
          aws_secretsmanager_secret.influx_token.arn,
          aws_secretsmanager_secret.jwt_secret.arn
        ]
      },
      {
        Sid    = "SNSPublish"
        Effect = "Allow"
        Action = "sns:Publish"
        Resource = aws_sns_topic.alerts.arn
      },
      {
        Sid    = "CloudWatchLogs"
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "arn:aws:logs:*:*:*"
      },
      {
        Sid    = "CognitoVerify"
        Effect = "Allow"
        Action = [
          "cognito-idp:GetUser",
          "cognito-idp:AdminGetUser",
          "cognito-idp:InitiateAuth"
        ]
        Resource = aws_cognito_user_pool.main.arn
      }
    ]
  })
}

# ── Lambda placeholder zips (real code deployed via CI/CD) ───────────────────
data "archive_file" "ingest_placeholder" {
  type        = "zip"
  output_path = "${path.module}/dist/ingest.zip"

  source {
    content  = "exports.handler = async () => ({ statusCode: 200 });"
    filename = "index.js"
  }
}

data "archive_file" "fault_placeholder" {
  type        = "zip"
  output_path = "${path.module}/dist/fault.zip"

  source {
    content  = "exports.handler = async () => ({ statusCode: 200 });"
    filename = "faults.js"
  }
}

data "archive_file" "api_placeholder" {
  type        = "zip"
  output_path = "${path.module}/dist/api.zip"

  source {
    content  = "exports.handler = async () => ({ statusCode: 200 });"
    filename = "api.js"
  }
}

# ── Lambda: telemetry ingest ──────────────────────────────────────────────────
resource "aws_lambda_function" "ingest" {
  function_name    = "${var.project}-${var.env}-ingest"
  role             = aws_iam_role.lambda.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  filename         = data.archive_file.ingest_placeholder.output_path
  source_code_hash = data.archive_file.ingest_placeholder.output_base64sha256
  timeout          = 30
  memory_size      = 256

  vpc_config {
    subnet_ids         = [aws_subnet.private_a.id, aws_subnet.private_b.id]
    security_group_ids = [aws_security_group.lambda.id]
  }

  environment {
    variables = {
      INFLUX_SECRET_ARN  = aws_secretsmanager_secret.influx_token.arn
      INFLUX_PRIVATE_IP  = aws_instance.influxdb.private_ip
      INFLUX_ORG         = "ecofleet"
      INFLUX_BUCKET      = "telemetry"
    }
  }

  tags = { Project = var.project }
}

# ── Lambda: fault handler ─────────────────────────────────────────────────────
resource "aws_lambda_function" "fault_handler" {
  function_name    = "${var.project}-${var.env}-fault-handler"
  role             = aws_iam_role.lambda.arn
  handler          = "faults.handler"
  runtime          = "nodejs20.x"
  filename         = data.archive_file.fault_placeholder.output_path
  source_code_hash = data.archive_file.fault_placeholder.output_base64sha256
  timeout          = 30
  memory_size      = 256

  vpc_config {
    subnet_ids         = [aws_subnet.private_a.id, aws_subnet.private_b.id]
    security_group_ids = [aws_security_group.lambda.id]
  }

  environment {
    variables = {
      INFLUX_SECRET_ARN  = aws_secretsmanager_secret.influx_token.arn
      INFLUX_PRIVATE_IP  = aws_instance.influxdb.private_ip
      INFLUX_ORG         = "ecofleet"
      INFLUX_BUCKET      = "faults"
      SNS_TOPIC_ARN      = aws_sns_topic.alerts.arn
    }
  }

  tags = { Project = var.project }
}

# ── Lambda: REST API ──────────────────────────────────────────────────────────
resource "aws_lambda_function" "api" {
  function_name    = "${var.project}-${var.env}-api"
  role             = aws_iam_role.lambda.arn
  handler          = "api.handler"
  runtime          = "nodejs20.x"
  filename         = data.archive_file.api_placeholder.output_path
  source_code_hash = data.archive_file.api_placeholder.output_base64sha256
  timeout          = 30
  memory_size      = 256

  vpc_config {
    subnet_ids         = [aws_subnet.private_a.id, aws_subnet.private_b.id]
    security_group_ids = [aws_security_group.lambda.id]
  }

  environment {
    variables = {
      INFLUX_SECRET_ARN   = aws_secretsmanager_secret.influx_token.arn
      JWT_SECRET_ARN      = aws_secretsmanager_secret.jwt_secret.arn
      INFLUX_PRIVATE_IP   = aws_instance.influxdb.private_ip
      INFLUX_ORG          = "ecofleet"
      COGNITO_USER_POOL_ID = aws_cognito_user_pool.main.id
      COGNITO_CLIENT_ID   = aws_cognito_user_pool_client.dashboard.id
    }
  }

  tags = { Project = var.project }
}

# ── CloudWatch log groups ─────────────────────────────────────────────────────
resource "aws_cloudwatch_log_group" "ingest" {
  name              = "/aws/lambda/${aws_lambda_function.ingest.function_name}"
  retention_in_days = 30
  tags              = { Project = var.project }
}

resource "aws_cloudwatch_log_group" "fault_handler" {
  name              = "/aws/lambda/${aws_lambda_function.fault_handler.function_name}"
  retention_in_days = 30
  tags              = { Project = var.project }
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/lambda/${aws_lambda_function.api.function_name}"
  retention_in_days = 30
  tags              = { Project = var.project }
}
