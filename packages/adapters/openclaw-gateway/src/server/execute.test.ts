import { describe, expect, it } from "vitest";
import { buildAgentParams, classifyGatewayFailureFields, resolveSessionKey } from "./execute.js";

describe("resolveSessionKey", () => {
  it("prefixes run-scoped session keys with the configured agent", () => {
    expect(
      resolveSessionKey({
        strategy: "run",
        configuredSessionKey: null,
        agentId: "meridian",
        runId: "run-123",
        issueId: null,
      }),
    ).toBe("agent:meridian:paperclip:run:run-123");
  });

  it("prefixes issue-scoped session keys with the configured agent", () => {
    expect(
      resolveSessionKey({
        strategy: "issue",
        configuredSessionKey: null,
        agentId: "meridian",
        runId: "run-123",
        issueId: "issue-456",
      }),
    ).toBe("agent:meridian:paperclip:issue:issue-456");
  });

  it("prefixes fixed session keys with the configured agent", () => {
    expect(
      resolveSessionKey({
        strategy: "fixed",
        configuredSessionKey: "paperclip",
        agentId: "meridian",
        runId: "run-123",
        issueId: null,
      }),
    ).toBe("agent:meridian:paperclip");
  });

  it("does not double-prefix an already-routed session key", () => {
    expect(
      resolveSessionKey({
        strategy: "fixed",
        configuredSessionKey: "agent:meridian:paperclip",
        agentId: "meridian",
        runId: "run-123",
        issueId: null,
      }),
    ).toBe("agent:meridian:paperclip");
  });
});

describe("buildAgentParams", () => {
  it("strips root-level paperclip fields from gateway agent params", () => {
    expect(
      buildAgentParams({
        payloadTemplate: {
          text: "old text",
          paperclip: { stale: true },
          keep: "value",
        },
        message: "wake text",
        sessionKey: "agent:meridian:paperclip:issue:issue-456",
        runId: "run-123",
        configuredAgentId: "meridian",
        waitTimeoutMs: 30_000,
      }),
    ).toEqual({
      keep: "value",
      message: "wake text",
      sessionKey: "agent:meridian:paperclip:issue:issue-456",
      idempotencyKey: "run-123",
      agentId: "meridian",
      timeout: 30_000,
    });
  });

  it("preserves an explicit agentId and timeout from the payload template", () => {
    expect(
      buildAgentParams({
        payloadTemplate: {
          agentId: "template-agent",
          timeout: 5_000,
        },
        message: "wake text",
        sessionKey: "paperclip",
        runId: "run-123",
        configuredAgentId: "configured-agent",
        waitTimeoutMs: 30_000,
      }),
    ).toEqual({
      agentId: "template-agent",
      timeout: 5_000,
      message: "wake text",
      sessionKey: "paperclip",
      idempotencyKey: "run-123",
    });
  });
});

describe("classifyGatewayFailureFields", () => {
  const NOW = new Date("2026-08-17T19:00:00.000Z");

  it("marks relayed subscription-limit failures as provider_quota with the reset deadline", () => {
    expect(
      classifyGatewayFailureFields(
        "FailoverError: You've reached your Codex subscription usage limit. Next reset in 3 days, Aug 20 at 5:28 AM GMT",
        NOW,
      ),
    ).toEqual({
      errorFamily: "provider_quota",
      retryNotBefore: "2026-08-20T05:28:00.000Z",
    });
  });

  it("marks relayed provider cooldowns as transient_upstream without a deadline", () => {
    expect(
      classifyGatewayFailureFields(
        "FallbackSummaryError: All models failed (1): openai/gpt-5.4: Provider openai is in cooldown (suspending lanes) (rate_limit)",
        NOW,
      ),
    ).toEqual({ errorFamily: "transient_upstream" });
  });

  it("adds no fields for unclassified gateway failures", () => {
    expect(classifyGatewayFailureFields("OpenClaw gateway run failed", NOW)).toEqual({});
    expect(classifyGatewayFailureFields(null, NOW)).toEqual({});
  });
});
