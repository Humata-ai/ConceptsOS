/**
 * ConceptsOS pod: route pi's Anthropic provider through our reverse proxy.
 *
 * pi's built-in Anthropic provider hardcodes baseUrl = "https://api.anthropic.com"
 * and expects an ANTHROPIC_API_KEY. In the pod we have neither: the pod holds
 * no Anthropic credential, and the endpoint is the ConceptsOS proxy, which
 * authenticates the *pod* (not Anthropic) via `Authorization: Bearer <key>`
 * and injects the org Anthropic key server-side.
 *
 * See pi.dev/docs/latest/custom-provider for `pi.registerProvider(...)`.
 *
 * Env in the pod (projected by api/src/lib/k8s.ts):
 *   CONCEPTSOS_BASE_URL = http://conceptsos-api.conceptsos-system.svc.cluster.local/api/llm
 *   CONCEPTSOS_API_KEY  = <per-user key>
 *
 * The extension:
 *   - points the anthropic provider at CONCEPTSOS_BASE_URL,
 *   - forwards CONCEPTSOS_API_KEY as `Authorization: Bearer <key>`,
 *   - supplies a literal placeholder `apiKey` so pi's provider config is
 *     complete. Our proxy strips `x-api-key` (not in FORWARD_REQ_HEADERS)
 *     so the placeholder never reaches Anthropic.
 *
 * Related:
 *   - api/src/app/api/llm/v1/[...path]/route.ts   (proxy + authz + metering)
 *   - api/src/lib/apikey.ts                       (key mint + lookup)
 *   - api/src/lib/k8s.ts                          (env plumbing into the pod)
 */

// Types are intentionally not imported so this file loads even if the type
// package isn't reachable from the pod's runtime resolution root — pi's own
// loader supplies the ExtensionAPI at call time.
export default function (pi: any) {
	const baseUrl = process.env.CONCEPTSOS_BASE_URL;
	if (!baseUrl) return;
	pi.registerProvider("anthropic", {
		baseUrl,
		// Literal placeholder — real auth is the Authorization header below.
		// The proxy strips x-api-key before forwarding to Anthropic.
		apiKey: "unused",
		// $CONCEPTSOS_API_KEY is resolved per-request by pi (see custom-provider
		// docs: `$ENV_VAR` interpolation). If unset, the proxy will reject with 401.
		headers: {
			Authorization: "Bearer $CONCEPTSOS_API_KEY",
		},
	});
}
