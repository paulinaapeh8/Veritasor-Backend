/**
 * Integration tests for attestations API.
 * Uses requireAuth (checks x-user-id header); expects 401 when unauthenticated.
 *
 * Note: Routes that call resolveBusinessIdForUser() without a businessId query
 * param will hit the real DB client (not configured in tests) and return 500.
 * Tests that require an actual database are omitted here; they belong in e2e tests.
 */
import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";

const authHeader = { "x-user-id": "test-user-id" };
const TEST_BUSINESS_ID = "test-biz-001";

describe("GET /api/attestations", () => {
  it("should return 401 when unauthenticated", async () => {
    const res = await request(app).get("/api/attestations");
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/unauthorized/i);
  });

  it("should return empty list when businessId is provided", async () => {
    const res = await request(app)
      .get("/api/attestations")
      .set(authHeader)
      .query({ businessId: TEST_BUSINESS_ID });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("status", "success");
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body).toHaveProperty("pagination");
  });

  it("should return an error when no business is resolvable (no DB configured)", async () => {
    const res = await request(app)
      .get("/api/attestations")
      .set(authHeader);

    // Without a DB, resolveBusinessIdForUser throws → 500
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe("GET /api/attestations/:id", () => {
  it("should return 401 when unauthenticated", async () => {
    const res = await request(app).get("/api/attestations/abc-123");
    expect(res.status).toBe(401);
  });
});

describe("POST /api/attestations", () => {
  it("should return 401 when unauthenticated", async () => {
    const res = await request(app)
      .post("/api/attestations")
      .set("Idempotency-Key", "test-key-unauth")
      .send({
        businessId: TEST_BUSINESS_ID,
        period: "2024-01",
        merkleRoot: "abc",
      });

    expect(res.status).toBe(401);
  });
});

describe("DELETE /api/attestations/:id/revoke", () => {
  it("should return 401 when unauthenticated", async () => {
    const res = await request(app).delete("/api/attestations/xyz-456/revoke");
    expect(res.status).toBe(401);
  });
});
