output "api_endpoint" {
  description = "API Gateway endpoint URL — use as VITE_API_URL in dashboard"
  value       = aws_apigatewayv2_api.main.api_endpoint
}

output "cognito_user_pool_id" {
  description = "Cognito User Pool ID"
  value       = aws_cognito_user_pool.main.id
}

output "cognito_client_id" {
  description = "Cognito App Client ID — use as VITE_COGNITO_CLIENT_ID in dashboard"
  value       = aws_cognito_user_pool_client.dashboard.id
}

output "influx_private_ip" {
  description = "InfluxDB EC2 private IP — for SSM session and Lambda config"
  value       = aws_instance.influxdb.private_ip
}

output "iot_policy_name" {
  description = "IoT Core policy name — attach to device certificates"
  value       = aws_iot_policy.apu.name
}

output "iot_dlq_url" {
  description = "SQS DLQ URL for IoT rule errors"
  value       = aws_sqs_queue.iot_dlq.url
}

output "sns_alerts_arn" {
  description = "SNS topic ARN for alerts"
  value       = aws_sns_topic.alerts.arn
}

output "influx_secret_arn" {
  description = "Secrets Manager ARN for InfluxDB token"
  value       = aws_secretsmanager_secret.influx_token.arn
}

output "jwt_secret_arn" {
  description = "Secrets Manager ARN for JWT secret"
  value       = aws_secretsmanager_secret.jwt_secret.arn
}

output "iot_endpoint_cmd" {
  description = "AWS CLI command to get the IoT Core ATS endpoint"
  value       = "aws iot describe-endpoint --endpoint-type iot:Data-ATS --query endpointAddress --output text"
}
