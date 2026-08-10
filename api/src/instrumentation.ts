// Next.js instrumentation hook. Runs once per server process, before any
// request is served. We use it to kick off the background reconcile loop
// that watches Supabase and reconciles k8s resources for each user.

export async function register() {
  // Only run in the Node.js server runtime (not the Edge runtime).
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Only run in the actual server process, not during `next build`.
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const { startReconcileLoop } = await import("./lib/reconcile");
  startReconcileLoop();
}
