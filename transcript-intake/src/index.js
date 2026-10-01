/**
 * Cloudflare Worker: transcript intake (phase 1 - skeleton)
 * -----------------------------------------------------------
 * Webhook endpoint for the TranscripTonic Chrome extension (advanced body
 * mode). This phase only checks the secret and the payload shape, then
 * logs it and returns 200 — it does not write to archivist1 yet. Phase 2
 * adds naming.js (date/HHMM) and github.js (the branch-creation calls)
 * and plugs them in below, where noted.
 *
 * Route: POST /ingest/<WEBHOOK_SECRET>
 */

import { validatePayload, summarizeShape, MAX_PAYLOAD_BYTES } from "./validate.js";

// Constant-time string compare: pads both sides to equal length first so
// that a length mismatch doesn't short-circuit and leak the secret's
// length via response timing.
function timingSafeEqual(a, b) {
  const length = Math.max(a.length, b.length, 1);
  const bufA = new TextEncoder().encode(a.padEnd(length, "\0"));
  const bufB = new TextEncoder().encode(b.padEnd(length, "\0"));
  let diff = a.length ^ b.length;
  for (let i = 0; i < length; i++) diff |= bufA[i] ^ bufB[i];
  return diff === 0;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/ingest\/([^/]+)$/);

    if (!match || request.method !== "POST") {
      return new Response("Not found", { status: 404 });
    }

    if (!env.WEBHOOK_SECRET || !timingSafeEqual(match[1], env.WEBHOOK_SECRET)) {
      return new Response("Unauthorized", { status: 401 });
    }

    const raw = await request.text();
    if (raw.length > MAX_PAYLOAD_BYTES) {
      return new Response("Payload too large", { status: 400 });
    }

    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    const result = validatePayload(body, raw.length);
    if (!result.ok) {
      console.log("rejected:", result.reason);
      return new Response(result.reason, { status: 400 });
    }

    console.log("received:", JSON.stringify(summarizeShape(body)));

    // Phase 2 adds: naming.js for date/HHMM, github.js's duplicate check
    // and tree -> commit -> ref calls, returning 409 on a duplicate.
    return new Response("OK", { status: 200 });
  },
};
