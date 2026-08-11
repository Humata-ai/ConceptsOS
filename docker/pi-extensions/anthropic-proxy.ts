/**
 * ConceptsOS pod: route pi's Anthropic provider through our reverse proxy.
 *
 * pi's built-in Anthropic provider hardcodes baseUrl = "https://api.anthropic.com"
 * and doesn't honor ANTHROPIC_BASE_URL. The docs (pi.dev/docs/latest/custom-provider)
 * point at pi.registerProvider("anthropic", { baseUrl }) as the supported override.
 *
 * In the pod we set:
 *   ANTHROPIC_BASE_URL = http://conceptsos-api.conceptsos-system.svc.cluster.local/api/llm
 *   ANTHROPIC_API_KEY  = proxied   (any non-empty value; the proxy strips it)
 *
 * The proxy at api/src/app/api/llm/v1/[...path]/route.ts injects the org key
 * server-side. See api/src/lib/k8s.ts for the env plumbing.
 */

// Types are intentionally not imported so this file loads even if the type
// package isn't reachable from the pod's runtime resolution root — pi's own
// loader supplies the ExtensionAPI at call time.
export default function (pi: any) {
	const baseUrl = process.env.ANTHROPIC_BASE_URL;
	if (!baseUrl) return;
	pi.registerProvider("anthropic", { baseUrl });
}
