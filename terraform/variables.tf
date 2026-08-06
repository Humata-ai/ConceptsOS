variable "project_id" {
  description = "GCP project ID (must be globally unique, lowercase)"
  type        = string
  default     = "conceptsos-prd"
}

variable "project_name" {
  description = "Human-readable project name"
  type        = string
  default     = "ConceptsOS-prd"
}

variable "org_id" {
  description = "GCP organization ID (no default — set in terraform.tfvars or via TF_VAR_org_id)"
  type        = string
}

variable "billing_account" {
  description = "Billing account ID (no default — set in terraform.tfvars or via TF_VAR_billing_account)"
  type        = string
  sensitive   = true
}

variable "region" {
  type    = string
  default = "us-central1"
}

variable "zone" {
  type    = string
  default = "us-central1-a"
}
