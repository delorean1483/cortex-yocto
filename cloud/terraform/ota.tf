# ── OTA firmware distribution ────────────────────────────────────────────────
# S3 bucket hosting signed SWUpdate (.swu) bundles that devices pull during OTA.
# The firmware downloads a static URL with a plain `curl` (no auth header), so
# objects under releases/* are public-read. Authenticity is guaranteed by RSA
# signature verification on-device (swupdate-keys/sign.crt), NOT by access
# control — the bundle is meant to be world-readable but only-installable when
# signed by the matching private key held in the CI secret SWUPDATE_SIGN_KEY.
#
# Matches the firmware's compiled-in OTA_BUNDLE_BASE_URL default:
#   https://ecofleet-ota.s3.amazonaws.com/releases

resource "aws_s3_bucket" "ota" {
  bucket = "ecofleet-ota"

  tags = {
    Project = "ecofleet"
    Purpose = "OTA firmware bundle distribution"
  }
}

# Keep ACLs off (we use a bucket policy, not ACLs) but allow a public bucket
# policy so releases/* can be read anonymously by devices.
resource "aws_s3_bucket_public_access_block" "ota" {
  bucket = aws_s3_bucket.ota.id

  block_public_acls       = true
  ignore_public_acls      = true
  block_public_policy     = false
  restrict_public_buckets = false
}

resource "aws_s3_bucket_policy" "ota_public_read" {
  bucket     = aws_s3_bucket.ota.id
  depends_on = [aws_s3_bucket_public_access_block.ota]

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "PublicReadReleases"
      Effect    = "Allow"
      Principal = "*"
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.ota.arn}/releases/*"
    }]
  })
}

# ── CI publisher ─────────────────────────────────────────────────────────────
# Least-privilege IAM user whose ONLY permission is to write bundles under
# releases/*. Its access key is stored as GitHub Actions secrets
# (OTA_AWS_ACCESS_KEY_ID / OTA_AWS_SECRET_ACCESS_KEY) and used by build.yml.
resource "aws_iam_user" "ota_ci" {
  name = "ecofleet-ci-ota"

  tags = {
    Project = "ecofleet"
    Purpose = "CI publishes OTA bundles"
  }
}

resource "aws_iam_user_policy" "ota_ci_put" {
  name = "ota-put-releases"
  user = aws_iam_user.ota_ci.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["s3:PutObject"]
      Resource = "${aws_s3_bucket.ota.arn}/releases/*"
    }]
  })
}

resource "aws_iam_access_key" "ota_ci" {
  user = aws_iam_user.ota_ci.name
}

# ── Outputs (sensitive — piped straight into GitHub secrets, never printed) ──
output "ota_ci_access_key_id" {
  value     = aws_iam_access_key.ota_ci.id
  sensitive = true
}

output "ota_ci_secret_access_key" {
  value     = aws_iam_access_key.ota_ci.secret
  sensitive = true
}

output "ota_bucket_base_url" {
  description = "Must match firmware OTA_BUNDLE_BASE_URL"
  value       = "https://${aws_s3_bucket.ota.bucket}.s3.amazonaws.com/releases"
}
