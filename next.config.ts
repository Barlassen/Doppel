import type { NextConfig } from "next";

const dev = process.env.NODE_ENV !== "production";

/**
 * Content Security Policy. Everything the app loads is same-origin (fonts are self-hosted by next/font, the OCR
 * worker, WASM core and language data sit under /tesseract), plus images the user picks (blob:, data:).
 *  - script-src: Next.js inlines its bootstrap and RSC payload, so 'unsafe-inline' stays until the app renders
 *    per-request nonces; 'wasm-unsafe-eval' compiles the Tesseract core; dev needs 'unsafe-eval' for React refresh.
 *  - worker-src: the Tesseract worker script is same-origin (workerBlobURL is off); blob: covers browsers that wrap it.
 *  - connect-src: only this origin. The model endpoint is called by the server route, never by the browser.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  `connect-src 'self' data: blob:${dev ? " ws: wss:" : ""}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // The camera (document capture, hand control) and the microphone (dictation) are used by this origin only.
  { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=(), payment=(), usb=()" },
  // Ignored on plain http (localhost); pins https once the app is served over it.
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
