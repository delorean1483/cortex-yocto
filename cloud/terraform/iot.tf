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

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      # ── Connect ──────────────────────────────────────────────────────────────
      {
        Sid      = "AllowConnect"
        Effect   = "Allow"
        Action   = "iot:Connect"
        Resource = "arn:aws:iot:${var.aws_region}:${data.aws_caller_identity.current.account_id}:client/gobi-apu-*"
      },

      # ── Telemetry + fault publish ─────────────────────────────────────────────
      {
        Sid    = "AllowPublish"
        Effect = "Allow"
        Action = "iot:Publish"
        Resource = [
          "arn:aws:iot:${var.aws_region}:${data.aws_caller_identity.current.account_id}:topic/ecofleet/*/telemetry",
          "arn:aws:iot:${var.aws_region}:${data.aws_caller_identity.current.account_id}:topic/ecofleet/*/faults",
          # Shadow: device requests current state on connect
          "arn:aws:iot:${var.aws_region}:${data.aws_caller_identity.current.account_id}:topic/$aws/things/gobi-apu-*/shadow/get",
          # Shadow: device publishes reported state each telemetry cycle
          "arn:aws:iot:${var.aws_region}:${data.aws_caller_identity.current.account_id}:topic/$aws/things/gobi-apu-*/shadow/update",
        ]
      },

      # ── Subscribe ─────────────────────────────────────────────────────────────
      {
        Sid    = "AllowSubscribe"
        Effect = "Allow"
        Action = "iot:Subscribe"
        Resource = [
          "arn:aws:iot:${var.aws_region}:${data.aws_caller_identity.current.account_id}:topicfilter/ecofleet/*/telemetry",
          "arn:aws:iot:${var.aws_region}:${data.aws_caller_identity.current.account_id}:topicfilter/ecofleet/*/faults",
          # Shadow: response to get request
          "arn:aws:iot:${var.aws_region}:${data.aws_caller_identity.current.account_id}:topicfilter/$aws/things/gobi-apu-*/shadow/get/accepted",
          "arn:aws:iot:${var.aws_region}:${data.aws_caller_identity.current.account_id}:topicfilter/$aws/things/gobi-apu-*/shadow/get/rejected",
          # Shadow: delta pushed when desired != reported (queued while offline)
          "arn:aws:iot:${var.aws_region}:${data.aws_caller_identity.current.account_id}:topicfilter/$aws/things/gobi-apu-*/shadow/update/delta",
          # Shadow: ACK/NACK for reported updates
          "arn:aws:iot:${var.aws_region}:${data.aws_caller_identity.current.account_id}:topicfilter/$aws/things/gobi-apu-*/shadow/update/accepted",
          "arn:aws:iot:${var.aws_region}:${data.aws_caller_identity.current.account_id}:topicfilter/$aws/things/gobi-apu-*/shadow/update/rejected",
        ]
      },

      # ── Receive ───────────────────────────────────────────────────────────────
      {
        Sid    = "AllowReceive"
        Effect = "Allow"
        Action = "iot:Receive"
        Resource = [
          "arn:aws:iot:${var.aws_region}:${data.aws_caller_identity.current.account_id}:topic/ecofleet/*/telemetry",
          "arn:aws:iot:${var.aws_region}:${data.aws_caller_identity.current.account_id}:topic/ecofleet/*/faults",
          # Shadow receive mirrors subscribe list
          "arn:aws:iot:${var.aws_region}:${data.aws_caller_identity.current.account_id}:topic/$aws/things/gobi-apu-*/shadow/get/accepted",
          "arn:aws:iot:${var.aws_region}:${data.aws_caller_identity.current.account_id}:topic/$aws/things/gobi-apu-*/shadow/get/rejected",
          "arn:aws:iot:${var.aws_region}:${data.aws_caller_identity.current.account_id}:topic/$aws/things/gobi-apu-*/shadow/update/delta",
          "arn:aws:iot:${var.aws_region}:${data.aws_caller_identity.current.account_id}:topic/$aws/things/gobi-apu-*/shadow/update/accepted",
          "arn:aws:iot:${var.aws_region}:${data.aws_caller_identity.current.account_id}:topic/$aws/things/gobi-apu-*/shadow/update/rejected",
        ]
      },

      # ── Explicitly deny shadow delete ─────────────────────────────────────────
      # Devices must not be able to wipe their own shadow document.
      {
        Sid    = "DenyShadowDelete"
        Effect = "Deny"
        Action = ["iot:Publish", "iot:Subscribe", "iot:Receive"]
        Resource = [
          "arn:aws:iot:${var.aws_region}:${data.aws_caller_identity.current.account_id}:topic/$aws/things/gobi-apu-*/shadow/delete",
          "arn:aws:iot:${var.aws_region}:${data.aws_caller_identity.current.account_id}:topicfilter/$aws/things/gobi-apu-*/shadow/delete/*",
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
