provider "google" {
  region = var.region
  zone   = var.zone
}

# 1. Create the GCP project under the humata.ai org
resource "google_project" "conceptsos" {
  name            = var.project_name
  project_id      = var.project_id
  org_id          = var.org_id
  billing_account = var.billing_account
  deletion_policy = "DELETE"
}

# 2. Enable the APIs we need
resource "google_project_service" "services" {
  for_each = toset([
    "compute.googleapis.com",
    "container.googleapis.com",
    "artifactregistry.googleapis.com",
  ])

  project            = google_project.conceptsos.project_id
  service            = each.value
  disable_on_destroy = false
}

# 3. Artifact Registry repo to hold our Docker image
resource "google_artifact_registry_repository" "repo" {
  project       = google_project.conceptsos.project_id
  location      = var.region
  repository_id = "conceptsos"
  format        = "DOCKER"
  description   = "ConceptsOS container images"

  depends_on = [google_project_service.services]
}

# 4. GKE cluster with a single node
resource "google_container_cluster" "primary" {
  name     = "conceptsos-cluster"
  project  = google_project.conceptsos.project_id
  location = var.zone

  initial_node_count = 1

  node_config {
    machine_type = "e2-small"
    disk_size_gb = 30
    disk_type    = "pd-standard"

    oauth_scopes = [
      "https://www.googleapis.com/auth/cloud-platform",
    ]
  }

  deletion_protection = false

  depends_on = [google_project_service.services]
}
