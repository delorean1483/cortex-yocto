# cloud/terraform/lambda_shadow_iam.tf
#
# Adds GetThingShadow + UpdateThingShadow permissions to the API Lambda's
# execution role so it can read and write Device Shadows.
#
# If your existing lambda_api_role policy is defined inline (aws_iam_role_policy),
# merge these statements in. If it's a managed policy attachment, use this
# separate aws_iam_role_policy resource instead.


resource "aws_iam_role_policy" "api_lambda_shadow" {
  name = "ecofleet-prod-api-shadow-access"
  role = aws_iam_role.lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowShadowReadWrite"
        Effect = "Allow"
        Action = [
          "iot:GetThingShadow",
          "iot:UpdateThingShadow",
          # ListNamedShadowsForThing is needed only if you add named shadows later
          # "iot:ListNamedShadowsForThing",
        ]
        Resource = "arn:aws:iot:${var.aws_region}:${data.aws_caller_identity.current.account_id}:thing/gobi-apu-*"
      }
    ]
  })
}
