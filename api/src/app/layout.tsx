// Root layout. This app is API-only; the layout exists solely to satisfy
// Next.js's App Router requirement for a root layout file.

export const metadata = {
  title: "ConceptsOS API",
  description: "Provisioning API for ConceptsOS.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
