# ── SES: alert emails from the EcoFleet domain ───────────────────────────────
# Easy DKIM. The identity verifies once the CNAMEs in `ses_dkim_records` exist
# in the domain's DNS. Alert emails switch from the SNS topic to SES only when
# var.alert_from is set (after verification and SES production access).
resource "aws_sesv2_email_identity" "alerts" {
  email_identity = var.alert_domain
  tags           = { Project = var.project }
}
