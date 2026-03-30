import { describe, it, expect } from "vitest";
import {
  normalizeRevenueEntry,
  detectNormalizationDrift,
} from "../../../../src/services/revenue/normalize.js";
import type { NormalizedRevenue, NormalizationBaseline } from "../../../../src/services/revenue/normalize.js";

describe("revenue normalizer", () => {
  it("should produce the canonical shape", () => {
    const result = normalizeRevenueEntry({
      id: "txn_001",
      amount: 49.99,
      currency: "usd",
      date: "2025-11-15T10:30:00Z",
      source: "stripe",
    });

    expect(result).toEqual({
      id: "txn_001",
      amount: 49.99,
      currency: "USD",
      date: "2025-11-15T10:30:00.000Z",
      type: "payment",
      source: "stripe",
    });
  });

  it("should classify negative amounts as refund", () => {
    const result = normalizeRevenueEntry({
      id: "txn_002",
      amount: -20.0,
      currency: "EUR",
      date: "2025-12-01T00:00:00Z",
      source: "razorpay",
    });

    expect(result.type).toBe("refund");
    expect(result.amount).toBe(-20.0);
  });

  it("should classify positive amounts as payment", () => {
    const result = normalizeRevenueEntry({
      id: "txn_003",
      amount: 100,
      currency: "INR",
      date: "2025-06-01",
      source: "razorpay",
    });

    expect(result.type).toBe("payment");
  });

  it("should normalize currency to uppercase", () => {
    const result = normalizeRevenueEntry({
      id: "txn_004",
      amount: 10,
      currency: "gbp",
      date: "2025-01-01",
    });

    expect(result.currency).toBe("GBP");
  });

  it("should default currency to USD when missing", () => {
    const result = normalizeRevenueEntry({
      id: "txn_005",
      amount: 5,
      date: "2025-01-01",
    });

    expect(result.currency).toBe("USD");
  });

  it("should convert numeric date (Unix timestamp) to ISO string", () => {
    // 1700000000 = 2023-11-14T22:13:20.000Z
    const result = normalizeRevenueEntry({
      id: "txn_006",
      amount: 30,
      currency: "USD",
      date: 1700000000,
      source: "manual",
    });

    expect(result.date).toBe("2023-11-14T22:13:20.000Z");
  });

  it("should parse a string date into ISO format", () => {
    const result = normalizeRevenueEntry({
      id: "txn_007",
      amount: 15,
      currency: "USD",
      date: "2025-03-20",
      source: "stripe",
    });

    // Should be a valid ISO date string
    expect(result.date).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(new Date(result.date).toISOString()).toBe(result.date);
  });

  it("should default source to unknown when missing", () => {
    const result = normalizeRevenueEntry({
      id: "txn_008",
      amount: 25,
      date: "2025-01-01",
    });

    expect(result.source).toBe("unknown");
  });

  it("should handle zero amount as payment", () => {
    const result = normalizeRevenueEntry({
      id: "txn_009",
      amount: 0,
      currency: "USD",
      date: "2025-01-01",
      source: "test",
    });

    expect(result.type).toBe("payment");
    expect(result.amount).toBe(0);
  });
});

describe("detectNormalizationDrift", () => {
  const baseline: NormalizationBaseline = {
    refundRate: 0.1,
    unknownSourceRate: 0.05,
    usdRate: 0.8,
    meanAmount: 100,
  };

  function makeEntry(overrides: Partial<NormalizedRevenue> = {}): NormalizedRevenue {
    return {
      id: "txn_test",
      amount: 100,
      currency: "USD",
      date: "2025-01-01T00:00:00.000Z",
      type: "payment",
      source: "stripe",
      ...overrides,
    };
  }

  it("should return insufficient_data when entry count is below minimum", () => {
    const entries = [makeEntry(), makeEntry(), makeEntry()]; // 3 < default min 5
    const result = detectNormalizationDrift(entries, baseline);

    expect(result.hasDrift).toBe(false);
    expect(result.overallScore).toBe(0);
    expect(result.checks[0].flag).toBe("insufficient_data");
    expect(result.summary).toContain("Insufficient data");
  });

  it("should return insufficient_data for an empty array", () => {
    const result = detectNormalizationDrift([], baseline);

    expect(result.hasDrift).toBe(false);
    expect(result.checks[0].flag).toBe("insufficient_data");
  });

  it("should report no drift when entries exactly match the baseline", () => {
    // 10 entries: 1 refund (10%), 1 unknown source (10%), 8 USD (80%), avg amount 100
    const matchingBaseline: NormalizationBaseline = {
      refundRate: 0.1,
      unknownSourceRate: 0.1,
      usdRate: 0.8,
      meanAmount: 100,
    };
    const entries: NormalizedRevenue[] = [
      makeEntry({ type: "refund", amount: -100 }),
      makeEntry({ source: "unknown" }),
      makeEntry({ currency: "EUR" }),
      makeEntry({ currency: "EUR" }),
      ...Array.from({ length: 6 }, () => makeEntry()),
    ];

    const result = detectNormalizationDrift(entries, matchingBaseline);

    expect(result.hasDrift).toBe(false);
    expect(result.summary).toBe("No normalization drift detected.");
  });

  it("should flag refund_rate_drift when refund fraction deviates significantly", () => {
    // 3 refunds out of 5 = 60% vs baseline 10%
    const entries: NormalizedRevenue[] = [
      makeEntry({ type: "refund", amount: -100 }),
      makeEntry({ type: "refund", amount: -100 }),
      makeEntry({ type: "refund", amount: -100 }),
      makeEntry(),
      makeEntry(),
    ];

    const result = detectNormalizationDrift(entries, baseline);
    const refundCheck = result.checks.find((c) => c.metric === "refund_rate");

    expect(result.hasDrift).toBe(true);
    expect(refundCheck?.flag).toBe("refund_rate_drift");
  });

  it("should flag unknown_source_drift when unknown source fraction deviates", () => {
    // 4 unknown sources out of 5 = 80% vs baseline 5%
    const entries: NormalizedRevenue[] = [
      makeEntry({ source: "unknown" }),
      makeEntry({ source: "unknown" }),
      makeEntry({ source: "unknown" }),
      makeEntry({ source: "unknown" }),
      makeEntry(),
    ];

    const result = detectNormalizationDrift(entries, baseline);
    const sourceCheck = result.checks.find((c) => c.metric === "unknown_source_rate");

    expect(result.hasDrift).toBe(true);
    expect(sourceCheck?.flag).toBe("unknown_source_drift");
  });

  it("should flag usd_rate_drift when USD currency fraction deviates", () => {
    // 0 USD entries out of 5 = 0% vs baseline 80%
    const entries: NormalizedRevenue[] = Array.from({ length: 5 }, () =>
      makeEntry({ currency: "EUR" })
    );

    const result = detectNormalizationDrift(entries, baseline);
    const usdCheck = result.checks.find((c) => c.metric === "usd_rate");

    expect(result.hasDrift).toBe(true);
    expect(usdCheck?.flag).toBe("usd_rate_drift");
  });

  it("should flag amount_drift when mean amount deviates significantly", () => {
    // avg amount 10000 vs baseline 100 → 9900% relative deviation
    const entries: NormalizedRevenue[] = Array.from({ length: 5 }, () =>
      makeEntry({ amount: 10000 })
    );

    const result = detectNormalizationDrift(entries, baseline);
    const amountCheck = result.checks.find((c) => c.metric === "mean_amount");

    expect(result.hasDrift).toBe(true);
    expect(amountCheck?.flag).toBe("amount_drift");
  });

  it("should detect multiple drifting metrics simultaneously", () => {
    // High refund rate AND high unknown source rate; amounts kept at 100
    const entries: NormalizedRevenue[] = [
      makeEntry({ type: "refund", amount: -100, source: "unknown" }),
      makeEntry({ type: "refund", amount: -100, source: "unknown" }),
      makeEntry({ type: "refund", amount: -100, source: "unknown" }),
      makeEntry({ source: "unknown" }),
      makeEntry(),
    ];

    const result = detectNormalizationDrift(entries, baseline);
    const driftedFlags = result.checks
      .filter((c) => c.flag !== "ok")
      .map((c) => c.flag);

    expect(result.hasDrift).toBe(true);
    expect(driftedFlags).toContain("refund_rate_drift");
    expect(driftedFlags).toContain("unknown_source_drift");
  });

  it("should respect custom threshold and suppress drift below it", () => {
    // Refund rate: 2/10 = 20% vs baseline 10% → 100% relative deviation
    // With a 200% threshold no drift should be flagged
    const entries: NormalizedRevenue[] = [
      makeEntry({ type: "refund", amount: -100 }),
      makeEntry({ type: "refund", amount: -100 }),
      ...Array.from({ length: 8 }, () => makeEntry()),
    ];

    const result = detectNormalizationDrift(entries, baseline, { threshold: 2.0 });
    const refundCheck = result.checks.find((c) => c.metric === "refund_rate");

    expect(refundCheck?.flag).toBe("ok");
  });

  it("should respect custom minEntries option", () => {
    // 3 entries is below the default minimum of 5, but above minEntries: 2
    const entries: NormalizedRevenue[] = [makeEntry(), makeEntry(), makeEntry()];
    const result = detectNormalizationDrift(entries, baseline, { minEntries: 2 });

    expect(result.checks[0].flag).not.toBe("insufficient_data");
  });

  it("should set overallScore to the maximum score across all checks", () => {
    // Severe amount drift → score clamped to 1.0
    const entries: NormalizedRevenue[] = Array.from({ length: 5 }, () =>
      makeEntry({ amount: 10000 })
    );

    const result = detectNormalizationDrift(entries, baseline);
    const maxScore = Math.max(...result.checks.map((c) => c.score));

    expect(result.overallScore).toBe(maxScore);
    expect(result.overallScore).toBeGreaterThan(0);
  });

  it("should handle zero baseline rate with zero observed — no drift", () => {
    const zeroBaseline = { ...baseline, unknownSourceRate: 0 };
    const entries: NormalizedRevenue[] = Array.from({ length: 5 }, () => makeEntry());

    const result = detectNormalizationDrift(entries, zeroBaseline);
    const sourceCheck = result.checks.find((c) => c.metric === "unknown_source_rate");

    expect(sourceCheck?.flag).toBe("ok");
    expect(sourceCheck?.score).toBe(0);
  });

  it("should flag drift when baseline rate is zero but observed is non-zero", () => {
    const zeroBaseline = { ...baseline, unknownSourceRate: 0 };
    const entries: NormalizedRevenue[] = [
      makeEntry({ source: "unknown" }),
      makeEntry({ source: "unknown" }),
      makeEntry(),
      makeEntry(),
      makeEntry(),
    ];

    const result = detectNormalizationDrift(entries, zeroBaseline);
    const sourceCheck = result.checks.find((c) => c.metric === "unknown_source_rate");

    expect(sourceCheck?.flag).toBe("unknown_source_drift");
    expect(sourceCheck?.score).toBe(1); // clamped to maximum
  });
});
