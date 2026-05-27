# ── IoT Thing Type ────────────────────────────────────────────────────────────
resource "aws_iot_thing_type" "apu" {
  name = "${var.project}-${var.env}-apu"

  properties {
    description = "EcoFleet Gobi APU unit"
    searchable_attributes = [
      "fleet_id",
      "unit_serial",
      "hw_rev"
    ]
  }

  tags = { Project = var.project }
}

# ── IoT Policy ────────────────────────────────────────────────────────────────
resource "aws_iot_policy" "apu" {
  name = "${var.project}-${var.env}-apu-policy"

  # Compacted to stay under the IoT Core 2048-byte policy document limit.
  # Wildcards (*) on region/account are safe here because Thing/client names
  # are still scoped to gobi-apu-* and ecofleet/* prefixes.
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = "iot:Connect"
        Resource = "arn:aws:iot:*:*:client/gobi-apu-*"
      },
      {
        Effect = "Allow"
        Action = ["iot:Publish", "iot:Receive"]
        Resource = [
          "arn:aws:iot:*:*:topic/ecofleet/*/telemetry",
          "arn:aws:iot:*:*:topic/ecofleet/*/faults",
          "arn:aws:iot:*:*:topic/$aws/things/gobi-apu-*/shadow/get",
          "arn:aws:iot:*:*:topic/$aws/things/gobi-apu-*/shadow/update",
          "arn:aws:iot:*:*:topic/$aws/things/gobi-apu-*/shadow/get/accepted",
          "arn:aws:iot:*:*:topic/$aws/things/gobi-apu-*/shadow/get/rejected",
          "arn:aws:iot:*:*:topic/$aws/things/gobi-apu-*/shadow/update/delta",
          "arn:aws:iot:*:*:topic/$aws/things/gobi-apu-*/shadow/update/accepted",
          "arn:aws:iot:*:*:topic/$aws/things/gobi-apu-*/shadow/update/rejected",
        ]
      },
      {
        Effect = "Allow"
        Action = "iot:Subscribe"
        Resource = [
          "arn:aws:iot:*:*:topicfilter/ecofleet/*/telemetry",
          "arn:aws:iot:*:*:topicfilter/ecofleet/*/faults",
          "arn:aws:iot:*:*:topicfilter/$aws/things/gobi-apu-*/shadow/get/accepted",
          "arn:aws:iot:*:*:topicfilter/$aws/things/gobi-apu-*/shadow/get/rejected",
          "arn:aws:iot:*:*:topicfilter/$aws/things/gobi-apu-*/shadow/update/delta",
          "arn:aws:iot:*:*:topicfilter/$aws/things/gobi-apu-*/shadow/update/accepted",
          "arn:aws:iot:*:*:topicfilter/$aws/things/gobi-apu-*/shadow/update/rejected",
        ]
      },
      {
        Effect = "Deny"
        Action = ["iot:Publish", "iot:Subscribe", "iot:Receive"]
        Resource = [
          "arn:aws:iot:*:*:topic/$aws/things/gobi-apu-*/shadow/delete",
          "arn:aws:iot:*:*:topicfilter/$aws/things/gobi-apu-*/shadow/delete/*",
        ]
      },
    ]
  })
}

# ── SQS DLQ for IoT rule errors ───────────────────────────────────────────────
resource "aws_sqs_queue" "iot_dlq" {
  name                      = "${var.project}-${var.env}-iot-dlq"
  message_retention_seconds = 1209600 # 14 days

  tags = { Project = var.project }
}

resource "aws_sqs_queue_policy" "iot_dlq" {
  queue_url = aws_sqs_queue.iot_dlq.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid    = "AllowIoTCore"
      Effect = "Allow"
      Principal = { Service = "iot.amazonaws.com" }
      Action   = "sqs:SendMessage"
      Resource = aws_sqs_queue.iot_dlq.arn
    }]
  })
}

# ── IAM role for IoT rules to invoke Lambda ───────────────────────────────────
resource "aws_iam_role" "iot_rule" {
  name = "${var.project}-${var.env}-iot-rule-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "iot.amazonaws.com" }
    }]
  })

  tags = { Project = var.project }
}

resource "aws_iam_role_policy" "iot_rule" {
  name = "${var.project}-${var.env}-iot-rule-policy"
  role = aws_iam_role.iot_rule.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = "lambda:InvokeFunction"
        Resource = [
          aws_lambda_function.ingest.arn,
          aws_lambda_function.fault_handler.arn
        ]
      },
      {
        Effect   = "Allow"
        Action   = "sqs:SendMessage"
        Resource = aws_sqs_queue.iot_dlq.arn
      }
    ]
  })
}

# ── IoT Topic Rule — telemetry ────────────────────────────────────────────────
resource "aws_iot_topic_rule" "telemetry" {
  name        = "${var.project}_${var.env}_telemetry"
  enabled     = true
  sql         = "SELECT * FROM 'ecofleet/+/telemetry'"
  sql_version = "2016-03-23"

  lambda {
    function_arn = aws_lambda_function.ingest.arn
  }

  error_action {
    sqs {
      queue_url  = aws_sqs_queue.iot_dlq.url
      role_arn   = aws_iam_role.iot_rule.arn
      use_base64 = false
    }
  }

  tags = { Project = var.project }
}

# ── IoT Topic Rule — faults ───────────────────────────────────────────────────
resource "aws_iot_topic_rule" "faults" {
  name        = "${var.project}_${var.env}_faults"
  enabled     = true
  sql         = "SELECT * FROM 'ecofleet/+/faults'"
  sql_version = "2016-03-23"

  lambda {
    function_arn = aws_lambda_function.fault_handler.arn
  }

  error_action {
    sqs {
      queue_url  = aws_sqs_queue.iot_dlq.url
      role_arn   = aws_iam_role.iot_rule.arn
      use_base64 = false
    }
  }

  tags = { Project = var.project }
}

# ── Lambda permissions for IoT to invoke ─────────────────────────────────────
resource "aws_lambda_permission" "iot_ingest" {
  statement_id  = "AllowIoTInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.ingest.function_name
  principal     = "iot.amazonaws.com"
  source_arn    = aws_iot_topic_rule.telemetry.arn
}

resource "aws_lambda_permission" "iot_fault" {
  statement_id  = "AllowIoTInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.fault_handler.function_name
  principal     = "iot.amazonaws.com"
  source_arn    = aws_iot_topic_rule.faults.arn
}
