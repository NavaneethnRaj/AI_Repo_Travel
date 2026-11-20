import { describe, expect, it } from "vitest";
import { formatSseFrame, parseSseFrame, SseEvent, sseHeartbeat } from "@wayfarer/contracts";

describe("planning SSE frames", () => {
  it("round trips each event with its sequence and JSON payload", () => {
    const turnId = "a".repeat(22);
    const events: SseEvent[] = [
      { event: "accepted", data: { turnId, clientId: "63470db1-f54d-4b67-b71f-f309e876da63", baseRevision: 1 } },
      { event: "ui.delta", data: { text: 'root = Reply([card])\ncard = DestinationCard("lisbon")' } },
      { event: "ui.reset", data: { reason: "INVALID_OUTPUT" } },
      { event: "board.updated", data: { revision: 2, changedDays: [turnId], removedIds: [] } },
      { event: "done", data: { state: "committed", revision: 2, messageId: turnId } },
      { event: "error", data: { code: "RATE_LIMITED", retryable: true, retryAfterSeconds: 2 } },
    ];
    events.forEach((event, index) => {
      const seq = index + 1;
      const frame = formatSseFrame(seq, event);
      expect(frame).toBe(`id: ${seq}\nevent: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`);
      expect(parseSseFrame(frame)).toEqual({ seq, event });
    });
    expect(sseHeartbeat).toBe(": hb\n\n");
  });

  it("rejects unknown event names and extra keys at either level", () => {
    expect(() => parseSseFrame('id: 1\nevent: surprise\ndata: {}\n\n')).toThrow();
    expect(() => parseSseFrame('id: 1\nevent: ui.delta\ndata: {"text":"ok","extra":true}\n\n')).toThrow();
    expect(SseEvent.safeParse({ event: "ui.delta", data: { text: "ok" }, extra: true }).success).toBe(false);
  });

  it("accepts only the frozen reset reason and caps deltas at 64 KiB of UTF-8", () => {
    expect(SseEvent.safeParse({ event: "ui.reset", data: { reason: "OTHER" } }).success).toBe(false);
    const delta = (text: string) => SseEvent.safeParse({ event: "ui.delta", data: { text } });
    expect(delta("é".repeat(32768)).success).toBe(true);
    expect(delta("é".repeat(32768) + "a").success).toBe(false);
  });
});
