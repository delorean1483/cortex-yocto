variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "env" {
  description = "Environment name"
  type        = string
  default     = "prod"
}

variable "project" {
  description = "Project name"
  type        = string
  default     = "ecofleet"
}

variable "influx_token" {
  description = "InfluxDB admin token"
  type        = string
  sensitive   = true
}

variable "jwt_secret" {
  description = "JWT signing secret for API auth"
  type        = string
  sensitive   = true
}

variable "alert_email" {
  description = "Email address for CloudWatch/SNS alerts"
  type        = string
}

variable "ec2_key_name" {
  description = "Name of the EC2 key pair for InfluxDB instance"
  type        = string
  default     = "ecofleet-deploy"
}

variable "ec2_public_key" {
  description = "Public key material for the EC2 key pair"
  type        = string
}

variable "influxdb_instance_type" {
  description = "EC2 instance type for InfluxDB"
  type        = string
  default     = "t2.micro"
}

variable "influxdb_volume_size" {
  description = "EBS volume size in GB for InfluxDB"
  type        = number
  default     = 100
}
