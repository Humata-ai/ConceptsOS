/**
 * ConceptsOS pod: route pi's Anthropic provider through our reverse proxy.
 *
 * pi's built-in Anthropic provider hardcodes baseUrl = "https://api.anthropic.com"
 * and doesn't honor ANTHROPIC_BASE_URL. The docs (pi.dev/docs/latest/custom-provider)
 * point at pi.registerProvider("anthropic", { baseUrl, headers }) as the supported
 * override.
 *
 * In the pod we set:
 *   ANTHROPIC_BASE_URL = http://conceptsos-api.conceptsos-system.svc.cluster.local/api/llm
 *   ANTHROPIC_API_KEY  = proxied            (any non-empty value; the proxy strips it)
 *   CONCEPTSOS_API_KEY = <per-user key>     (projected by the api reconcile loop)
 *
 * The extension forwards CONCEPTSOS_API_KEY as `Authorization: Bearer <key>`
 * to the proxy, which authenticates the request against public.api_keys and
 * injects the org Anthropic key server-side. See:
 *   - api/src/app/api/llm/v1/[...path]/route.ts   (proxy + authz + metering)
 *   - api/src/lib/apikey.ts                       (key mint + lookup)
 *   - api/src/lib/k8s.ts                          (env plumbing into the pod)
 */

// Types are intentionally not imported so this file loads even if the type
// package isn't reachable from the pod's runtime resolution root — pi's own
// loader supplies the ExtensionAPI at call time.
export default function (pi: any) {
	const baseUrl = process.env.ANTHROPIC_BASE_URL;
	if (!baseUrl) return;
	pi.registerProvider("anthropic", {
		baseUrl,
		// $CONCEPTSOS_API_KEY is resolved per-request by pi (see custom-provider
		// docs: `$ENV_VAR` interpolation). If unset, the proxy will reject with 401.
		headers: {
			Authorization: "Bearer $CONCEPTSOS_API_KEY",
		},
	});
}
