# ── Cognito User Pool ─────────────────────────────────────────────────────────
resource "aws_cognito_user_pool" "main" {
  name = "${var.project}-${var.env}-user-pool"

  # Email is the username
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  # Password policy
  password_policy {
    minimum_length                   = 12
    require_uppercase                = true
    require_lowercase                = true
    require_numbers                  = true
    require_symbols                  = true
    temporary_password_validity_days = 7
  }

  # Custom attribute for fleet scoping
  schema {
    name                     = "fleet_id"
    attribute_data_type      = "String"
    mutable                  = true
    required                 = false

    string_attribute_constraints {
      min_length = 1
      max_length = 64
    }
  }

  # Account recovery
  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  tags = { Project = var.project }
}

# ── Cognito App Client ────────────────────────────────────────────────────────
resource "aws_cognito_user_pool_client" "dashboard" {
  name         = "${var.project}-${var.env}-dashboard-client"
  user_pool_id = aws_cognito_user_pool.main.id

  # No client secret — public client (dashboard + device UI)
  generate_secret = false

  # Auth flows
  explicit_auth_flows = [
    "ALLOW_USER_PASSWORD_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
    "ALLOW_USER_SRP_AUTH"
  ]

  # Token validity
  access_token_validity  = 1   # hours
  id_token_validity      = 1   # hours
  refresh_token_validity = 30  # days

  token_validity_units {
    access_token  = "hours"
    id_token      = "hours"
    refresh_token = "days"
  }

  prevent_user_existence_errors = "ENABLED"
}
