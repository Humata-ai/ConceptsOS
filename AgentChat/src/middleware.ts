// The pod serves a single Next.js origin. Layout:
//
//   /             → DesktopUI (Prozilla-OS-derived static build baked into
//                   public/ at Docker build time). Rewritten here to
//                   /index.html so Next's static file handler serves it.
//   /chat         → AgentChat (this Next app's own UI, src/app/chat/page.tsx).
//   /api/*        → AgentChat API (session mgmt, chat SSE, abort).
//   /static/*     → DesktopUI JS/CSS chunks (CRA output, from public/).
//   everything else (favicon, manifest, images, …) → public/ passthrough.
//
// The `matcher: "/"` scoping keeps this middleware cheap — it only runs on
// the root URL, not on every asset request.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  return NextResponse.rewrite(new URL("/index.html", req.url));
}

export const config = {
  matcher: "/",
};
