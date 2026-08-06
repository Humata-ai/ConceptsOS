output "project_id" {
  value = google_project.conceptsos.project_id
}

output "cluster_name" {
  value = google_container_cluster.primary.name
}

output "cluster_location" {
  value = google_container_cluster.primary.location
}

output "artifact_registry" {
  value = "${var.region}-docker.pkg.dev/${google_project.conceptsos.project_id}/conceptsos"
}

output "kubectl_config_command" {
  value = "gcloud container clusters get-credentials ${google_container_cluster.primary.name} --zone ${var.zone} --project ${google_project.conceptsos.project_id}"
}
