// Placeholder root page. The iOS client never hits /; it uses /api/*.

export const dynamic = "force-static";

export default function Home() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", maxWidth: 640 }}>
      <h1>ConceptsOS API</h1>
      <p>
        This is the provisioning API for the ConceptsOS iOS app. There's nothing to
        see here — the interesting endpoints live under <code>/api/*</code>.
      </p>
    </main>
  );
}
