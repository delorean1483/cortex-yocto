# ── SNS topic for alerts ──────────────────────────────────────────────────────
resource "aws_sns_topic" "alerts" {
  name = "${var.project}-${var.env}-alerts"
  tags = { Project = var.project }
}

resource "aws_sns_topic_subscription" "email" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

# ── CloudWatch alarm: SQS DLQ not empty ──────────────────────────────────────
resource "aws_cloudwatch_metric_alarm" "dlq_nonempty" {
  alarm_name          = "${var.project}-${var.env}-iot-dlq-nonempty"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 60
  statistic           = "Sum"
  threshold           = 0
  alarm_description   = "IoT rule error DLQ has messages"
  treat_missing_data  = "notBreaching"

  dimensions = {
    QueueName = aws_sqs_queue.iot_dlq.name
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = { Project = var.project }
}

# ── CloudWatch alarms: Lambda errors ─────────────────────────────────────────
locals {
  lambda_functions = {
    ingest        = aws_lambda_function.ingest.function_name
    fault_handler = aws_lambda_function.fault_handler.function_name
    api           = aws_lambda_function.api.function_name
  }
}

resource "aws_cloudwatch_metric_alarm" "lambda_errors" {
  for_each = local.lambda_functions

  alarm_name          = "${var.project}-${var.env}-${each.key}-errors"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "Errors"
  namespace           = "AWS/Lambda"
  period              = 60
  statistic           = "Sum"
  threshold           = 0
  alarm_description   = "Lambda ${each.key} is throwing errors"
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = each.value
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = { Project = var.project }
}

# ── CloudWatch alarms: alert emails ──────────────────────────────────────────
# Both alert Lambdas start every log line about an alert email that may not
# have gone out with this tag (ALERT_FAILED in lambda/shared/alert-mail.js;
# alert-mail.test.js checks that the two match).
locals {
  alert_failed_marker = "ALERT EMAIL FAILED"
  alert_log_groups = {
    ingest        = aws_cloudwatch_log_group.ingest.name
    fault_handler = aws_cloudwatch_log_group.fault_handler.name
  }
}

resource "aws_cloudwatch_log_metric_filter" "alert_email_failed" {
  for_each = local.alert_log_groups

  name           = "${var.project}-${var.env}-${each.key}-alert-email-failed"
  log_group_name = each.value
  pattern        = "\"${local.alert_failed_marker}\""

  metric_transformation {
    name      = "AlertEmailFailures"
    namespace = "${var.project}-${var.env}"
    value     = "1"
  }
}

resource "aws_cloudwatch_metric_alarm" "alert_email_failed" {
  alarm_name          = "${var.project}-${var.env}-alert-email-failed"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "AlertEmailFailures"
  namespace           = "${var.project}-${var.env}"
  period              = 300
  statistic           = "Sum"
  threshold           = 0
  alarm_description   = "A low-battery or APU fault email may not have gone out. Search the ingest and fault-handler logs for \"${local.alert_failed_marker}\"."
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = { Project = var.project }
}

# SES's own account-wide counts. After a bounce or a spam complaint the
# account's suppression list blocks that address, so its owner silently stops
# getting alerts until the address is removed from the list.
resource "aws_cloudwatch_metric_alarm" "alert_email_bounced" {
  alarm_name          = "${var.project}-${var.env}-alert-email-bounced"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  threshold           = 0
  alarm_description   = "An email from SES bounced or was marked as spam, and SES now blocks that address. See SES > Suppression list."
  treat_missing_data  = "notBreaching"

  metric_query {
    id          = "bounced"
    expression  = "FILL(bounce, 0) + FILL(complaint, 0)"
    label       = "Bounces and spam complaints"
    return_data = true
  }

  metric_query {
    id = "bounce"
    metric {
      namespace   = "AWS/SES"
      metric_name = "Bounce"
      period      = 300
      stat        = "Sum"
    }
  }

  metric_query {
    id = "complaint"
    metric {
      namespace   = "AWS/SES"
      metric_name = "Complaint"
      period      = 300
      stat        = "Sum"
    }
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = { Project = var.project }
}
