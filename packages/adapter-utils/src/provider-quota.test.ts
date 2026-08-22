import { describe, expect, it } from "vitest";

import { classifyProviderFailure, extractProviderResetTime } from "./provider-quota.js";

const NOW = new Date("2026-08-17T19:00:00.000Z");

describe("classifyProviderFailure", () => {
  it("classifies a subscription usage limit with an absolute reset as provider_quota", () => {
    const result = classifyProviderFailure(
      "FailoverError: You've reached your Codex subscription usage limit. Next reset in 3 days, Aug 20 at 5:28 AM GMT",
      NOW,
    );
    expect(result).toEqual({
      errorFamily: "provider_quota",
      retryNotBefore: "2026-08-20T05:28:00.000Z",
    });
  });

  it("classifies a provider cooldown lane suspension as transient_upstream", () => {
    const result = classifyProviderFailure(
      "FallbackSummaryError: All models failed (1): openai/gpt-5.4: Provider openai is in cooldown (suspending lanes) (rate_limit)",
      NOW,
    );
    expect(result).toEqual({ errorFamily: "transient_upstream", retryNotBefore: null });
  });

  it("prefers provider_quota when quota and cooldown vocabulary both appear", () => {
    const result = classifyProviderFailure(
      "Provider openai is in cooldown (rate_limit): you've reached your usage limit",
      NOW,
    );
    expect(result.errorFamily).toBe("provider_quota");
  });

  it("classifies generic rate limiting as transient_upstream", () => {
    expect(classifyProviderFailure("HTTP 429: Too many requests, try again later", NOW).errorFamily).toBe(
      "transient_upstream",
    );
  });

  it("does not treat a generic capacity limit as a provider failure", () => {
    expect(classifyProviderFailure("Workspace storage capacity limit reached.", NOW)).toEqual({
      errorFamily: null,
      retryNotBefore: null,
    });
  });

  it("returns null family for empty or unrelated text", () => {
    expect(classifyProviderFailure(null, NOW).errorFamily).toBeNull();
    expect(classifyProviderFailure("", NOW).errorFamily).toBeNull();
    expect(classifyProviderFailure("Some unrelated adapter crash", NOW).errorFamily).toBeNull();
  });
});

describe("extractProviderResetTime", () => {
  it("parses 'Next reset in N days, <Month> <day> at <clock> GMT' as UTC", () => {
    expect(
      extractProviderResetTime("Next reset in 3 days, Aug 20 at 5:28 AM GMT", NOW)?.toISOString(),
    ).toBe("2026-08-20T05:28:00.000Z");
  });

  it("treats a zone-less absolute reset as UTC", () => {
    expect(extractProviderResetTime("Next reset Aug 20 at 17:28", NOW)?.toISOString()).toBe(
      "2026-08-20T17:28:00.000Z",
    );
  });

  it("rolls the year over for December→January resets", () => {
    const december = new Date("2026-12-30T22:00:00.000Z");
    expect(
      extractProviderResetTime("Next reset in 3 days, Jan 2 at 1:00 AM GMT", december)?.toISOString(),
    ).toBe("2027-01-02T01:00:00.000Z");
  });

  it("drops a stale month-day deadline instead of deferring nearly a year", () => {
    expect(extractProviderResetTime("Next reset Aug 10 at 5:28 AM GMT", NOW)).toBeNull();
  });

  it("drops deadlines in timezones it cannot compute", () => {
    expect(extractProviderResetTime("Next reset Aug 20 at 5:28 AM PST", NOW)).toBeNull();
  });

  it("parses relative resets", () => {
    expect(extractProviderResetTime("Next reset in 2 hours", NOW)?.toISOString()).toBe(
      "2026-08-17T21:00:00.000Z",
    );
    expect(extractProviderResetTime("next reset in 45 minutes", NOW)?.toISOString()).toBe(
      "2026-08-17T19:45:00.000Z",
    );
  });

  it("returns null when no reset hint is present", () => {
    expect(extractProviderResetTime("Provider openai is in cooldown (rate_limit)", NOW)).toBeNull();
  });
});
