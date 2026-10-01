/**
 * Payload checks for the advanced-mode TranscripTonic webhook body, run
 * before any GitHub call (added in phase 2). Shape confirmed against the
 * extension's own source: exporters.js:postTranscriptToWebhook() builds
 * this object, and platforms.js's wantedPlatforms id for Meet is the
 * literal string "google_meet", not "Google Meet".
 */

export const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024; // 5 MB, per the plan's Worker spec

export function validatePayload(body, rawByteLength) {
  if (rawByteLength > MAX_PAYLOAD_BYTES) {
    return { ok: false, reason: `payload exceeds ${MAX_PAYLOAD_BYTES} bytes` };
  }
  if (!body || typeof body !== "object") {
    return { ok: false, reason: "body is not a JSON object" };
  }
  if (body.webhookBodyType !== "advanced") {
    return {
      ok: false,
      reason: `webhookBodyType must be "advanced", got ${JSON.stringify(body.webhookBodyType)}`,
    };
  }
  if (body.meetingSoftware !== "google_meet") {
    return {
      ok: false,
      reason: `meetingSoftware must be "google_meet", got ${JSON.stringify(body.meetingSoftware)}`,
    };
  }
  if (!Array.isArray(body.transcript) || body.transcript.length === 0) {
    return { ok: false, reason: "transcript must be a non-empty array" };
  }
  for (const entry of body.transcript) {
    if (
      typeof entry?.personName !== "string" ||
      typeof entry?.timestamp !== "string" ||
      typeof entry?.transcriptText !== "string"
    ) {
      return { ok: false, reason: "every transcript entry needs personName, timestamp and transcriptText" };
    }
  }
  if (typeof body.meetingStartTimestamp !== "string" || Number.isNaN(Date.parse(body.meetingStartTimestamp))) {
    return { ok: false, reason: "meetingStartTimestamp must be a parseable date string" };
  }
  return { ok: true };
}

// What phase 1 logs instead of the raw body - entry counts and metadata
// only, never transcriptText/chatMessageText content.
export function summarizeShape(body) {
  return {
    webhookBodyType: body.webhookBodyType,
    meetingSoftware: body.meetingSoftware,
    meetingTitle: body.meetingTitle,
    meetingStartTimestamp: body.meetingStartTimestamp,
    meetingEndTimestamp: body.meetingEndTimestamp,
    transcriptEntries: Array.isArray(body.transcript) ? body.transcript.length : 0,
    chatMessageEntries: Array.isArray(body.chatMessages) ? body.chatMessages.length : 0,
  };
}
