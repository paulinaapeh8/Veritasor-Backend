import { describe, it, expect, vi } from "vitest";
import { normalizeRevenueEntry } from "../../../../src/services/revenue/normalize.js";
import {
  detectRevenueAnomaly,
  calibrateFromSeries,
} from "../../../../src/services/revenue/anomalyDetection.js";
import type { MonthlyRevenue } from "../../../../src/services/revenue/anomalyDetection.js";

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

describe("anomaly scoring calibration hooks", () => {
  const stable: MonthlyRevenue[] = [
    { period: "2026-01", amount: 10_000 },
    { period: "2026-02", amount: 10_200 },
    { period: "2026-03", amount: 9_800 },
  ];

  const withDrop: MonthlyRevenue[] = [
    { period: "2026-01", amount: 10_000 },
    { period: "2026-02", amount: 10_500 },
    { period: "2026-03", amount: 3_000 }, // ~71% drop
  ];

  const withSpike: MonthlyRevenue[] = [
    { period: "2026-01", amount: 1_000 },
    { period: "2026-02", amount: 1_100 },
    { period: "2026-03", amount: 5_000 }, // 354% rise
  ];


  it("should behave identically with no calibration argument", () => {
    const withArg = detectRevenueAnomaly(withDrop, {});
    const withoutArg = detectRevenueAnomaly(withDrop);

    expect(withArg).toEqual(withoutArg);
  });

  // --- minDataPoints ---

  it("should respect custom minDataPoints", () => {
    const result = detectRevenueAnomaly(
      [{ period: "2026-01", amount: 1_000 }],
      { minDataPoints: 1 }
    );

    expect(result.flag).not.toBe("insufficient_data");
    expect(result.flag).toBe("ok");
  });

  it("should return insufficient_data when series is shorter than minDataPoints", () => {
    const result = detectRevenueAnomaly(stable, { minDataPoints: 10 });

    expect(result.flag).toBe("insufficient_data");
    expect(result.score).toBe(0);
    expect(result.detail).toContain("10");
  });

  // --- dropThreshold ---

  it("should flag unusual_drop with default threshold when revenue falls ≥ 40%", () => {
    const result = detectRevenueAnomaly(withDrop);

    expect(result.flag).toBe("unusual_drop");
  });

  it("should NOT flag unusual_drop when custom dropThreshold is set above the actual drop", () => {
    // The drop in withDrop is ~71%; setting threshold to 0.8 (80%) should suppress it.
    const result = detectRevenueAnomaly(withDrop, { dropThreshold: 0.8 });

    expect(result.flag).toBe("ok");
    expect(result.score).toBe(0);
  });

  it("should flag unusual_drop at a tighter custom dropThreshold", () => {
    // stable series has a 3.9% drop; threshold 0.03 (3%) should flag it.
    const result = detectRevenueAnomaly(stable, { dropThreshold: 0.03 });

    expect(result.flag).toBe("unusual_drop");
  });

  // --- spikeThreshold ---

  it("should flag unusual_spike with default threshold when revenue rises ≥ 300%", () => {
    const result = detectRevenueAnomaly(withSpike);

    expect(result.flag).toBe("unusual_spike");
  });

  it("should NOT flag unusual_spike when custom spikeThreshold is set above the actual spike", () => {
    // Spike in withSpike is 354%; setting threshold to 5.0 (500%) suppresses it.
    const result = detectRevenueAnomaly(withSpike, { spikeThreshold: 5.0 });

    expect(result.flag).toBe("ok");
  });

  it("should flag unusual_spike at a tighter custom spikeThreshold", () => {
    // stable series has a 2% rise; threshold 0.01 (1%) should flag it.
    const result = detectRevenueAnomaly(stable, { spikeThreshold: 0.01 });

    expect(result.flag).toBe("unusual_spike");
  });

  // --- scoreHook ---

  it("should call scoreHook with correct prev, curr, and change arguments", () => {
    const hook = vi.fn().mockReturnValue(null); // null → fall back to built-in
    detectRevenueAnomaly(stable, { scoreHook: hook });

    // stable has 3 points → 2 consecutive pairs
    expect(hook).toHaveBeenCalledTimes(2);

    const [prev1, curr1, change1] = hook.mock.calls[0];
    expect(prev1.period).toBe("2026-01");
    expect(curr1.period).toBe("2026-02");
    expect(change1).toBeCloseTo(0.02, 5);
  });

  it("should use scoreHook result when hook returns non-null", () => {
    // Hook always flags unusual_spike with score 0.9, regardless of data.
    const hook = vi.fn().mockReturnValue({ score: 0.9, flag: "unusual_spike" });
    const result = detectRevenueAnomaly(stable, { scoreHook: hook });

    expect(result.flag).toBe("unusual_spike");
    expect(result.score).toBe(0.9);
    expect(result.detail).toContain("unusual_spike");
  });

  it("should fall back to built-in logic when scoreHook returns null", () => {
    // Hook returns null → built-in logic runs and detects the real drop.
    const hook = vi.fn().mockReturnValue(null);
    const result = detectRevenueAnomaly(withDrop, { scoreHook: hook });

    expect(result.flag).toBe("unusual_drop");
    expect(hook).toHaveBeenCalledTimes(2);
  });

  it("should track the worst score across all hook results", () => {
    // First pair returns score 0.3, second returns score 0.8 → worst wins.
    const hook = vi
      .fn()
      .mockReturnValueOnce({ score: 0.3, flag: "unusual_drop" })
      .mockReturnValueOnce({ score: 0.8, flag: "unusual_spike" });

    const result = detectRevenueAnomaly(stable, { scoreHook: hook });

    expect(result.score).toBe(0.8);
    expect(result.flag).toBe("unusual_spike");
  });

  // --- calibrateFromSeries ---

  it("should return module defaults when series has fewer than 2 points", () => {
    const result = calibrateFromSeries([{ period: "2026-01", amount: 1_000 }]);

    expect(result.dropThreshold).toBe(0.4);
    expect(result.spikeThreshold).toBe(3.0);
    expect(result.mean).toBe(0);
    expect(result.stdDev).toBe(0);
  });

  it("should return module defaults for an empty series", () => {
    const result = calibrateFromSeries([]);

    expect(result.dropThreshold).toBe(0.4);
    expect(result.spikeThreshold).toBe(3.0);
  });

  it("should derive non-default thresholds from a series with variance", () => {
    // Volatile series: big swings → stdDev > 0 → thresholds should differ from defaults.
    const volatile: MonthlyRevenue[] = [
      { period: "2026-01", amount: 1_000 },
      { period: "2026-02", amount: 3_000 }, // +200%
      { period: "2026-03", amount: 500 },   // -83%
      { period: "2026-04", amount: 4_000 }, // +700%
    ];

    const result = calibrateFromSeries(volatile);

    expect(result.stdDev).toBeGreaterThan(0);
    expect(result.mean).toBeDefined();
    // Thresholds should be positive numbers
    expect(result.dropThreshold).toBeGreaterThan(0);
    expect(result.spikeThreshold).toBeGreaterThan(0);
  });

  it("should respect a custom sigmaMultiplier", () => {
    const volatile: MonthlyRevenue[] = [
      { period: "2026-01", amount: 1_000 },
      { period: "2026-02", amount: 3_000 },
      { period: "2026-03", amount: 500 },
    ];

    const narrow = calibrateFromSeries(volatile, { sigmaMultiplier: 1 });
    const wide = calibrateFromSeries(volatile, { sigmaMultiplier: 3 });

    // Wider sigma → more extreme thresholds (higher spike, lower or same drop)
    expect(wide.spikeThreshold).toBeGreaterThanOrEqual(narrow.spikeThreshold);
  });

  it("should integrate calibrateFromSeries result into detectRevenueAnomaly", () => {
    // Calibrate on a stable series — thresholds should be tight.
    const history: MonthlyRevenue[] = Array.from({ length: 12 }, (_, i) => ({
      period: `2025-${String(i + 1).padStart(2, "0")}`,
      amount: 10_000 + (i % 3) * 100, // small oscillation
    }));

    const cal = calibrateFromSeries(history);

    // A series with a dramatic drop should still be caught.
    const result = detectRevenueAnomaly(
      [
        { period: "2026-01", amount: 10_000 },
        { period: "2026-02", amount: 1_000 }, // 90% drop
      ],
      cal
    );

    expect(result.flag).toBe("unusual_drop");
    expect(result.score).toBeGreaterThan(0);
  });
});
