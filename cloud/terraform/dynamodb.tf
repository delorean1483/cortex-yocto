# ── DynamoDB: maintenance records ─────────────────────────────────────────────
resource "aws_dynamodb_table" "maintenance" {
  name         = "${var.project}-${var.env}-maintenance"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "unit"
  range_key    = "ts"

  attribute {
    name = "unit"
    type = "S"
  }

  attribute {
    name = "ts"
    type = "N"
  }

  tags = { Project = var.project }
}

# ── DynamoDB: user roles ───────────────────────────────────────────────────────
# Stores role (admin/fm/maint/eu) for each Cognito user.
# Kept separate from Cognito so roles can be updated without schema constraints.
resource "aws_dynamodb_table" "users" {
  name         = "${var.project}-${var.env}-users"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "email"

  attribute {
    name = "email"
    type = "S"
  }

  tags = { Project = var.project }
}

# ── IAM: Lambda DynamoDB + Cognito admin access ───────────────────────────────
resource "aws_iam_role_policy" "lambda_dynamodb" {
  name = "${var.project}-${var.env}-lambda-dynamodb"
  role = aws_iam_role.lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "DynamoDBMaintenance"
        Effect = "Allow"
        Action = [
          "dynamodb:PutItem",
          "dynamodb:Query",
          "dynamodb:DeleteItem",
        ]
        Resource = aws_dynamodb_table.maintenance.arn
      },
      {
        Sid    = "DynamoDBUsers"
        Effect = "Allow"
        Action = [
          "dynamodb:PutItem",
          "dynamodb:GetItem",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem",
          "dynamodb:Scan",
        ]
        Resource = aws_dynamodb_table.users.arn
      },
      {
        Sid    = "CognitoAdmin"
        Effect = "Allow"
        Action = [
          "cognito-idp:AdminCreateUser",
          "cognito-idp:AdminDeleteUser",
          "cognito-idp:AdminSetUserPassword",
          "cognito-idp:ListUsers",
        ]
        Resource = aws_cognito_user_pool.main.arn
      }
    ]
  })
}
