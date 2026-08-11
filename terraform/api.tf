# Additional infra for V1: static IP for the API Ingress, extra APIs,
# Secret Manager for build-time secrets, and a separate node pool for
# per-user pods so a runaway user can't OOM the control plane.

resource "google_project_service" "extra_services" {
  for_each = toset([
    "secretmanager.googleapis.com",
    "dns.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
  ])
  project            = google_project.conceptsos.project_id
  service            = each.value
  disable_on_destroy = false
}

# Global static IP used by the GCE Ingress for api.conceptsos.com.
# Matches the annotation on k8s/api/ingress.yaml (ingress.global-static-ip-name).
resource "google_compute_global_address" "api" {
  project = google_project.conceptsos.project_id
  name    = "conceptsos-api-ip"

  depends_on = [google_project_service.services]
}

# Regional static IP for the WireGuard UDP LoadBalancer
# (Service wg-gateway-public). This IP is baked into every user's WG
# client config at signup (via WG_ENDPOINT on the api pod), so it MUST
# stay stable across Service recreations and cluster rebuilds.
resource "google_compute_address" "wg_gateway" {
  project = google_project.conceptsos.project_id
  name    = "conceptsos-wg-gateway-ip"
  region  = var.region

  depends_on = [google_project_service.services]
}

# Separate node pool for user pods. Keeps a noisy user off the same node
# as the api/wg-gateway control plane.
resource "google_container_node_pool" "users" {
  name       = "users"
  project    = google_project.conceptsos.project_id
  location   = var.zone
  cluster    = google_container_cluster.primary.name
  node_count = 1

  autoscaling {
    min_node_count = 1
    max_node_count = 20 # V1 cap; raise as signups grow
  }

  node_config {
    machine_type = "e2-standard-2"
    disk_size_gb = 50
    disk_type    = "pd-standard"
    labels = {
      "conceptsos.io/pool" = "users"
    }
    # No taint in V1 — keeps the reconcile loop simple. If a runaway user
    # ever OOMs a shared node we'll add taints + tolerations then.
    oauth_scopes = [
      "https://www.googleapis.com/auth/cloud-platform",
    ]
  }

  management {
    auto_repair  = true
    auto_upgrade = true
  }
}

# Secret Manager: build/deploy-time secrets. Runtime secrets live as
# Kubernetes Secrets (created out-of-band; see k8s/README.md).
resource "google_secret_manager_secret" "supabase_service_role_key" {
  project   = google_project.conceptsos.project_id
  secret_id = "supabase-service-role-key"
  replication {
    auto {}
  }
  depends_on = [google_project_service.extra_services]
}

resource "google_secret_manager_secret" "anthropic_admin_key" {
  project   = google_project.conceptsos.project_id
  secret_id = "anthropic-admin-key"
  replication {
    auto {}
  }
  depends_on = [google_project_service.extra_services]
}

output "api_static_ip" {
  value       = google_compute_global_address.api.address
  description = "Point api.conceptsos.com DNS A record at this IP."
}

output "wg_gateway_static_ip" {
  value       = google_compute_address.wg_gateway.address
  description = "Public UDP:51820 endpoint for WireGuard. Baked into WG_ENDPOINT on the api deployment."
}
