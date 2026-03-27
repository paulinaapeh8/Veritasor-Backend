import { describe, it, expect } from "vitest";
import {
  normalizeRevenueEntry,
  type RawRevenueInput,
  type NormalizedRevenue,
} from "../../../../src/services/revenue/normalize.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal valid raw input, overriding only the specified fields. */
function raw(overrides: Partial<RawRevenueInput> & { id: string; amount: number }): RawRevenueInput {
  return { date: "2025-01-01", source: "test", ...overrides };
}

// ---------------------------------------------------------------------------
// Core behaviour (canonical)
// ---------------------------------------------------------------------------

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

  // -------------------------------------------------------------------------
  // Currency drift: consistent normalization across heterogeneous source data
  // -------------------------------------------------------------------------

  describe("currency drift — case normalization consistency", () => {
    const currencies = ["usd", "USD", "Usd", "uSD", "UsD"] as const;

    it("should produce the same currency code regardless of input casing", () => {
      const codes = currencies.map((c) =>
        normalizeRevenueEntry(raw({ id: "d1", amount: 1, currency: c })).currency
      );
      expect(new Set(codes).size).toBe(1);
      expect(codes[0]).toBe("USD");
    });

    it("should be idempotent — normalizing an already-normalized currency is a no-op", () => {
      const once = normalizeRevenueEntry(raw({ id: "d2", amount: 1, currency: "eur" }));
      const twice = normalizeRevenueEntry({ ...raw({ id: "d2", amount: 1 }), currency: once.currency });
      expect(twice.currency).toBe("EUR");
      expect(twice.currency).toBe(once.currency);
    });

    it("should normalize mixed-case three-letter codes", () => {
      const cases: Array<[string, string]> = [
        ["gbp", "GBP"],
        ["GbP", "GBP"],
        ["gBP", "GBP"],
        ["inr", "INR"],
        ["InR", "INR"],
        ["jPy", "JPY"],
      ];
      for (const [input, expected] of cases) {
        const result = normalizeRevenueEntry(raw({ id: "d3", amount: 5, currency: input }));
        expect(result.currency).toBe(expected);
      }
    });

    it("should preserve non-alphabetic currency codes (e.g. numeric ISO 4217) uppercased", () => {
      // "840" is the numeric ISO 4217 code for USD; toUpperCase() is a no-op on digits
      const result = normalizeRevenueEntry(raw({ id: "d4", amount: 10, currency: "840" }));
      expect(result.currency).toBe("840");
    });

    it("should uppercase currency codes that contain letters and digits", () => {
      const result = normalizeRevenueEntry(raw({ id: "d5", amount: 10, currency: "usdt" }));
      expect(result.currency).toBe("USDT");
    });

    it("should preserve whitespace in currency codes without trimming", () => {
      // The normalizer does not trim; callers must sanitize upstream.
      // This test documents the current behaviour to prevent silent drift.
      const result = normalizeRevenueEntry(raw({ id: "d6", amount: 10, currency: " usd " }));
      expect(result.currency).toBe(" USD ");
    });

    it("should treat empty-string currency as absent and default to USD", () => {
      // Empty string is falsy in JS, so the default branch applies.
      const result = normalizeRevenueEntry(raw({ id: "d7", amount: 10, currency: "" }));
      expect(result.currency).toBe("USD");
    });

    it("should produce consistent currency for a batch of same-source entries with different casing", () => {
      const inputs: RawRevenueInput[] = [
        raw({ id: "b1", amount: 100, currency: "eur" }),
        raw({ id: "b2", amount: 200, currency: "EUR" }),
        raw({ id: "b3", amount: 300, currency: "Eur" }),
        raw({ id: "b4", amount: 400, currency: "eUr" }),
      ];
      const currencies = inputs.map((e) => normalizeRevenueEntry(e).currency);
      const unique = new Set(currencies);
      expect(unique.size).toBe(1);
      expect([...unique][0]).toBe("EUR");
    });

    it("should not mutate the original raw input", () => {
      const input = raw({ id: "d8", amount: 50, currency: "jpy" });
      const before = { ...input };
      normalizeRevenueEntry(input);
      expect(input).toEqual(before);
    });
  });

  // -------------------------------------------------------------------------
  // Date normalization — full branch coverage
  // -------------------------------------------------------------------------

  describe("date normalization edge cases", () => {
    it("should fall back to current time for an invalid date string", () => {
      const before = Date.now();
      const result = normalizeRevenueEntry(raw({ id: "dt1", amount: 1, date: "not-a-date" }));
      const after = Date.now();

      const ts = new Date(result.date).getTime();
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(after);
    });

    it("should fall back to current time when date is undefined", () => {
      const before = Date.now();
      const result = normalizeRevenueEntry({ id: "dt2", amount: 1 });
      const after = Date.now();

      const ts = new Date(result.date).getTime();
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(after);
    });

    it("should fall back to current time when date is an empty string", () => {
      const before = Date.now();
      const result = normalizeRevenueEntry(raw({ id: "dt3", amount: 1, date: "" }));
      const after = Date.now();

      const ts = new Date(result.date).getTime();
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(after);
    });

    it("should handle Unix timestamp 0 (epoch) correctly", () => {
      const result = normalizeRevenueEntry(raw({ id: "dt4", amount: 1, date: 0 }));
      expect(result.date).toBe("1970-01-01T00:00:00.000Z");
    });

    it("should handle a large Unix timestamp (year 2100)", () => {
      // 4102444800 = 2100-01-01T00:00:00.000Z
      const result = normalizeRevenueEntry(raw({ id: "dt5", amount: 1, date: 4102444800 }));
      expect(result.date).toBe("2100-01-01T00:00:00.000Z");
    });

    it("should preserve full timestamp precision from ISO strings", () => {
      const result = normalizeRevenueEntry(
        raw({ id: "dt6", amount: 1, date: "2025-07-04T12:34:56.789Z" })
      );
      expect(result.date).toBe("2025-07-04T12:34:56.789Z");
    });

    it("should always produce a valid ISO 8601 date string regardless of input", () => {
      const inputs: Array<string | number | undefined> = [
        "2025-01-01",
        "2025-01-01T00:00:00Z",
        1700000000,
        0,
        "",
        undefined,
        "garbage",
      ];
      for (const date of inputs) {
        const result = normalizeRevenueEntry({ id: "dt7", amount: 1, date });
        expect(result.date).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Amount classification edge cases
  // -------------------------------------------------------------------------

  describe("amount classification edge cases", () => {
    it("should classify the smallest negative float as refund", () => {
      const result = normalizeRevenueEntry(raw({ id: "a1", amount: -0.01 }));
      expect(result.type).toBe("refund");
    });

    it("should classify the smallest positive float as payment", () => {
      const result = normalizeRevenueEntry(raw({ id: "a2", amount: 0.01 }));
      expect(result.type).toBe("payment");
    });

    it("should handle very large positive amounts", () => {
      const result = normalizeRevenueEntry(raw({ id: "a3", amount: 1_000_000_000 }));
      expect(result.type).toBe("payment");
      expect(result.amount).toBe(1_000_000_000);
    });

    it("should handle very large negative amounts", () => {
      const result = normalizeRevenueEntry(raw({ id: "a4", amount: -1_000_000_000 }));
      expect(result.type).toBe("refund");
      expect(result.amount).toBe(-1_000_000_000);
    });

    it("should preserve fractional precision", () => {
      const result = normalizeRevenueEntry(raw({ id: "a5", amount: 19.99 }));
      expect(result.amount).toBe(19.99);
    });

    it("should preserve the exact amount value without rounding", () => {
      const result = normalizeRevenueEntry(raw({ id: "a6", amount: 123.456789 }));
      expect(result.amount).toBe(123.456789);
    });
  });

  // -------------------------------------------------------------------------
  // Source field
  // -------------------------------------------------------------------------

  describe("source field normalization", () => {
    it("should use the provided source as-is", () => {
      const result = normalizeRevenueEntry(raw({ id: "s1", amount: 1, source: "shopify" }));
      expect(result.source).toBe("shopify");
    });

    it("should default source to 'unknown' when source is undefined", () => {
      const { source: _, ...noSource } = raw({ id: "s2", amount: 1, source: "x" });
      const result = normalizeRevenueEntry({ ...noSource });
      expect(result.source).toBe("unknown");
    });

    it("should default source to 'unknown' when source is empty string", () => {
      const result = normalizeRevenueEntry(raw({ id: "s3", amount: 1, source: "" }));
      expect(result.source).toBe("unknown");
    });

    it("should preserve source values from all known integration names", () => {
      const sources = ["stripe", "razorpay", "shopify", "manual", "unknown"];
      for (const source of sources) {
        const result = normalizeRevenueEntry(raw({ id: "s4", amount: 1, source }));
        expect(result.source).toBe(source);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Output shape invariants
  // -------------------------------------------------------------------------

  describe("output shape invariants", () => {
    const fixtures: RawRevenueInput[] = [
      { id: "inv_1", amount: 100, currency: "usd", date: "2025-01-01", source: "stripe" },
      { id: "inv_2", amount: -50, currency: "EUR" },
      { id: "inv_3", amount: 0 },
      { id: "inv_4", amount: 9.99, date: 1700000000 },
      { id: "inv_5", amount: 1, currency: "", date: "bad-date", source: "" },
    ];

    it("should always return all six required fields", () => {
      const required: Array<keyof NormalizedRevenue> = [
        "id", "amount", "currency", "date", "type", "source",
      ];
      for (const fixture of fixtures) {
        const result = normalizeRevenueEntry(fixture);
        for (const field of required) {
          expect(result).toHaveProperty(field);
        }
      }
    });

    it("should always preserve the input id exactly", () => {
      for (const fixture of fixtures) {
        const result = normalizeRevenueEntry(fixture);
        expect(result.id).toBe(fixture.id);
      }
    });

    it("should always preserve the input amount exactly", () => {
      for (const fixture of fixtures) {
        const result = normalizeRevenueEntry(fixture);
        expect(result.amount).toBe(fixture.amount);
      }
    });

    it("should always return currency in uppercase", () => {
      for (const fixture of fixtures) {
        const result = normalizeRevenueEntry(fixture);
        expect(result.currency).toBe(result.currency.toUpperCase());
      }
    });

    it("should always return type as 'payment' or 'refund'", () => {
      for (const fixture of fixtures) {
        const result = normalizeRevenueEntry(fixture);
        expect(["payment", "refund"]).toContain(result.type);
      }
    });

    it("should always return a valid ISO 8601 UTC date string", () => {
      for (const fixture of fixtures) {
        const result = normalizeRevenueEntry(fixture);
        expect(result.date).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
        expect(isNaN(new Date(result.date).getTime())).toBe(false);
      }
    });

    it("should classify positive amounts as payment and negative as refund consistently", () => {
      const pos = normalizeRevenueEntry(raw({ id: "inv_pos", amount: 1 }));
      const neg = normalizeRevenueEntry(raw({ id: "inv_neg", amount: -1 }));
      const zer = normalizeRevenueEntry(raw({ id: "inv_zer", amount: 0 }));
      expect(pos.type).toBe("payment");
      expect(neg.type).toBe("refund");
      expect(zer.type).toBe("payment");
    });
  });
});
