import jwt from "jsonwebtoken";
import { describe, expect, it } from "vitest";
import {
	generateRefreshToken,
	generateToken,
	type TokenPayload,
	verifyRefreshToken,
	verifyToken,
} from "../../../src/utils/jwt";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const payload: TokenPayload = {
	userId: "user-123",
	email: "test@example.com",
};

// Secrets mirror the defaults in src/utils/jwt.ts (env vars not set in tests).
const ACCESS_SECRET = "dev-secret-key";
const REFRESH_SECRET = "dev-refresh-secret-key";

/** Signs a token that is already expired by using a negative expiresIn. */
function makeExpiredToken(secret: string): string {
	return jwt.sign(payload, secret, { expiresIn: -1 });
}

// ---------------------------------------------------------------------------
// generateToken
// ---------------------------------------------------------------------------

describe("generateToken", () => {
	it("returns a non-empty string", () => {
		const token = generateToken(payload);
		expect(typeof token).toBe("string");
		expect(token.length).toBeGreaterThan(0);
	});

	it("returns a valid JWT with three dot-separated segments", () => {
		const token = generateToken(payload);
		expect(token.split(".")).toHaveLength(3);
	});

	it("embeds the correct payload fields", () => {
		const token = generateToken(payload);
		const decoded = jwt.decode(token) as TokenPayload & { exp: number };
		expect(decoded.userId).toBe(payload.userId);
		expect(decoded.email).toBe(payload.email);
	});

	it("sets an expiry roughly 1 hour from now", () => {
		const before = Math.floor(Date.now() / 1000);
		const token = generateToken(payload);
		const { exp } = jwt.decode(token) as { exp: number };
		const after = Math.floor(Date.now() / 1000);
		expect(exp).toBeGreaterThanOrEqual(before + 3600);
		expect(exp).toBeLessThanOrEqual(after + 3600);
	});
});

// ---------------------------------------------------------------------------
// generateRefreshToken
// ---------------------------------------------------------------------------

describe("generateRefreshToken", () => {
	it("returns a non-empty string", () => {
		const token = generateRefreshToken(payload);
		expect(typeof token).toBe("string");
		expect(token.length).toBeGreaterThan(0);
	});

	it("returns a valid JWT with three dot-separated segments", () => {
		const token = generateRefreshToken(payload);
		expect(token.split(".")).toHaveLength(3);
	});

	it("embeds the correct payload fields", () => {
		const token = generateRefreshToken(payload);
		const decoded = jwt.decode(token) as TokenPayload & { exp: number };
		expect(decoded.userId).toBe(payload.userId);
		expect(decoded.email).toBe(payload.email);
	});

	it("sets an expiry roughly 7 days from now", () => {
		const before = Math.floor(Date.now() / 1000);
		const token = generateRefreshToken(payload);
		const { exp } = jwt.decode(token) as { exp: number };
		const after = Math.floor(Date.now() / 1000);
		expect(exp).toBeGreaterThanOrEqual(before + 7 * 24 * 3600);
		expect(exp).toBeLessThanOrEqual(after + 7 * 24 * 3600);
	});
});

// ---------------------------------------------------------------------------
// verifyToken
// ---------------------------------------------------------------------------

describe("verifyToken", () => {
	it("returns the original payload for a valid token", () => {
		const token = generateToken(payload);
		const result = verifyToken(token);
		expect(result).not.toBeNull();
		expect(result!.userId).toBe(payload.userId);
		expect(result!.email).toBe(payload.email);
	});

	it("returns null for a tampered token", () => {
		const token = generateToken(payload);
		const tampered = token.slice(0, -4) + "xxxx";
		expect(verifyToken(tampered)).toBeNull();
	});

	it("returns null for a completely invalid string", () => {
		expect(verifyToken("not.a.token")).toBeNull();
	});

	it("returns null for an empty string", () => {
		expect(verifyToken("")).toBeNull();
	});

	it("returns null for an expired token", () => {
		const expired = makeExpiredToken(ACCESS_SECRET);
		expect(verifyToken(expired)).toBeNull();
	});

	it("returns null when a refresh token is passed to verifyToken", () => {
		// Signed with the wrong secret — must not verify.
		const refreshToken = generateRefreshToken(payload);
		expect(verifyToken(refreshToken)).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// verifyRefreshToken
// ---------------------------------------------------------------------------

describe("verifyRefreshToken", () => {
	it("returns the original payload for a valid refresh token", () => {
		const token = generateRefreshToken(payload);
		const result = verifyRefreshToken(token);
		expect(result).not.toBeNull();
		expect(result!.userId).toBe(payload.userId);
		expect(result!.email).toBe(payload.email);
	});

	it("returns null for a tampered refresh token", () => {
		const token = generateRefreshToken(payload);
		const tampered = token.slice(0, -4) + "xxxx";
		expect(verifyRefreshToken(tampered)).toBeNull();
	});

	it("returns null for a completely invalid string", () => {
		expect(verifyRefreshToken("not.a.token")).toBeNull();
	});

	it("returns null for an empty string", () => {
		expect(verifyRefreshToken("")).toBeNull();
	});

	it("returns null for an expired refresh token", () => {
		const expired = makeExpiredToken(REFRESH_SECRET);
		expect(verifyRefreshToken(expired)).toBeNull();
	});

	it("returns null when an access token is passed to verifyRefreshToken", () => {
		// Signed with the wrong secret — must not verify.
		const accessToken = generateToken(payload);
		expect(verifyRefreshToken(accessToken)).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// sign (new function)
// ---------------------------------------------------------------------------

describe("sign", () => {
	it("returns a non-empty string for valid payload", async () => {
		const { sign } = await import("../../../src/utils/jwt");
		const token = sign(payload);
		expect(typeof token).toBe("string");
		expect(token.length).toBeGreaterThan(0);
	});

	it("returns a valid JWT with three dot-separated segments", async () => {
		const { sign } = await import("../../../src/utils/jwt");
		const token = sign(payload);
		expect(token.split(".")).toHaveLength(3);
	});

	it("supports expiresIn option", async () => {
		const { sign } = await import("../../../src/utils/jwt");
		const before = Math.floor(Date.now() / 1000);
		const token = sign(payload, { expiresIn: "2h" });
		const { exp } = jwt.decode(token) as { exp: number };
		const after = Math.floor(Date.now() / 1000);
		expect(exp).toBeGreaterThanOrEqual(before + 7200);
		expect(exp).toBeLessThanOrEqual(after + 7200);
	});

	it("supports algorithm option", async () => {
		const { sign } = await import("../../../src/utils/jwt");
		const token = sign(payload, { algorithm: "HS256" });
		const decoded = jwt.decode(token, { complete: true });
		expect(decoded?.header.alg).toBe("HS256");
	});
});

// ---------------------------------------------------------------------------
// verify (new function)
// ---------------------------------------------------------------------------

describe("verify", () => {
	it("returns the decoded payload for a valid token", async () => {
		const { sign, verify } = await import("../../../src/utils/jwt");
		const token = sign(payload);
		const result = verify(token);
		expect(result).toMatchObject(payload);
	});

	it("throws error for expired token", async () => {
		const { verify } = await import("../../../src/utils/jwt");
		const expired = makeExpiredToken(ACCESS_SECRET);
		expect(() => verify(expired)).toThrow();
	});

	it("throws error for invalid token", async () => {
		const { verify } = await import("../../../src/utils/jwt");
		expect(() => verify("not.a.token")).toThrow();
	});

	it("throws error for tampered token", async () => {
		const { sign, verify } = await import("../../../src/utils/jwt");
		const token = sign(payload);
		const tampered = token.slice(0, -4) + "xxxx";
		expect(() => verify(tampered)).toThrow();
	});

	it("round-trip: sign then verify returns equivalent payload", async () => {
		const { sign, verify } = await import("../../../src/utils/jwt");
		const testPayload = { sub: "user-456", email: "roundtrip@test.com" };
		const token = sign(testPayload);
		const result = verify(token);
		expect(result).toMatchObject(testPayload);
	});
});

// ---------------------------------------------------------------------------
// Expiry Skew Handling Tests
// Tests for clock skew tolerance, custom clock timestamps, and maxAge options
// ---------------------------------------------------------------------------

describe("verify expiry skew handling", () => {
	it("throws TokenExpiredError for token expired beyond clockTolerance", async () => {
		const { sign, verify } = await import("../../../src/utils/jwt");
		const token = sign(payload, { expiresIn: -5 }); // expired 5 seconds ago
		expect(() => verify(token, { clockTolerance: 3 })).toThrow();
	});

	it("accepts token within clockTolerance window", async () => {
		const { sign, verify } = await import("../../../src/utils/jwt");
		// Token expired 2 seconds ago, tolerance is 5 seconds
		const token = sign(payload, { expiresIn: -2 });
		const result = verify(token, { clockTolerance: 5 });
		expect(result).toMatchObject(payload);
	});

	it("throws when maxAge is exceeded (token age > maxAge)", async () => {
		const { sign, verify } = await import("../../../src/utils/jwt");
		const now = Math.floor(Date.now() / 1000);
		// Token issued 10 seconds ago, so its age is 10 seconds
		const token = sign({ ...payload, iat: now - 10 });
		// maxAge of 5 seconds means token is too old (10 > 5)
		expect(() => verify(token, { maxAge: 5 })).toThrow();
	});

	it("accepts token when maxAge is not exceeded", async () => {
		const { sign, verify } = await import("../../../src/utils/jwt");
		const token = sign(payload, { expiresIn: "1h" });
		const result = verify(token, { maxAge: 3600 }); // 1 hour in seconds
		expect(result).toMatchObject(payload);
	});

	it("rejects future token when verified before nbf with clockTolerance", async () => {
		const { sign, verify } = await import("../../../src/utils/jwt");
		const now = Math.floor(Date.now() / 1000);
		// Token not valid before 10 seconds from now
		const token = sign({ ...payload, nbf: now + 10 });
		// Even with 5 second tolerance, token is still 5 seconds in the future
		expect(() => verify(token, { clockTolerance: 5 })).toThrow();
	});

	it("accepts future token when nbf is within clockTolerance", async () => {
		const { sign, verify } = await import("../../../src/utils/jwt");
		const now = Math.floor(Date.now() / 1000);
		// Token not valid before 3 seconds from now
		const token = sign({ ...payload, nbf: now + 3 });
		// With 5 second tolerance, token is within acceptable window
		const result = verify(token, { clockTolerance: 5 });
		expect(result).toMatchObject(payload);
	});

	it("verifies with custom clockTimestamp in the past (token appears not yet expired)", async () => {
		const { sign, verify } = await import("../../../src/utils/jwt");
		const now = Math.floor(Date.now() / 1000);
		// Token expires in 10 seconds from actual current time
		const token = sign(payload, { expiresIn: 10 });
		// Verify with timestamp from 5 seconds ago - token still valid
		const result = verify(token, { clockTimestamp: now - 5 });
		expect(result).toMatchObject(payload);
	});

	it("rejects token with custom clockTimestamp in the future (token appears expired)", async () => {
		const { sign, verify } = await import("../../../src/utils/jwt");
		const now = Math.floor(Date.now() / 1000);
		// Token expires in 5 seconds from actual current time
		const token = sign(payload, { expiresIn: 5 });
		// Verify with timestamp 10 seconds in the future - token appears expired
		expect(() => verify(token, { clockTimestamp: now + 10 })).toThrow();
	});

	it("combines clockTimestamp and clockTolerance for skew handling", async () => {
		const { sign, verify } = await import("../../../src/utils/jwt");
		const now = Math.floor(Date.now() / 1000);
		// Token expires in 5 seconds from actual current time
		const token = sign(payload, { expiresIn: 5 });
		// Verify with timestamp 7 seconds in the future (token appears 2s expired)
		// With 3 second tolerance, this should pass
		const result = verify(token, { 
			clockTimestamp: now + 7, 
			clockTolerance: 3 
		});
		expect(result).toMatchObject(payload);
	});

	it("rejects when combined clockTimestamp and clockTolerance still exceed expiry", async () => {
		const { sign, verify } = await import("../../../src/utils/jwt");
		const now = Math.floor(Date.now() / 1000);
		// Token expires in 5 seconds from actual current time
		const token = sign(payload, { expiresIn: 5 });
		// Verify with timestamp 15 seconds in the future (token appears 10s expired)
		// With 3 second tolerance, token is still 7s expired - should fail
		expect(() => verify(token, { 
			clockTimestamp: now + 15, 
			clockTolerance: 3 
		})).toThrow();
	});

	it("handles zero clockTolerance strictly", async () => {
		const { sign, verify } = await import("../../../src/utils/jwt");
		const now = Math.floor(Date.now() / 1000);
		const token = sign(payload, { expiresIn: "1h" });
		// Zero tolerance means strict verification
		const result = verify(token, { clockTolerance: 0 });
		expect(result).toMatchObject(payload);
	});

	it("validates iat (issued at) with clock skew tolerance", async () => {
		const { sign, verify } = await import("../../../src/utils/jwt");
		const now = Math.floor(Date.now() / 1000);
		// Token issued 5 seconds in the future (clock skew scenario)
		const token = sign({ ...payload, iat: now + 5 });
		// With 10 second tolerance, should accept
		const result = verify(token, { clockTolerance: 10 });
		expect(result).toMatchObject(payload);
	});

	it("uses iat claim with maxAge for age validation", async () => {
		const { sign, verify } = await import("../../../src/utils/jwt");
		const now = Math.floor(Date.now() / 1000);
		// Token issued 20 seconds ago with exp far in future
		const token = sign({ ...payload, iat: now - 20, exp: now + 3600 });
		// maxAge of 10 seconds should reject (token is 20s old)
		expect(() => verify(token, { maxAge: 10 })).toThrow();
	});
});

