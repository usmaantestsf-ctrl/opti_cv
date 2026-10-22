import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  authenticateUser,
  signSession,
  verifySession,
  checkLoginRateLimit,
  recordFailedLoginAttempt,
  clearLoginRateLimit,
} from "@/lib/auth";

describe("Auth Module", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.SESSION_SECRET = "test_super_secret_session_key_32_characters_long!";
    process.env.USER1_NAME = "Alice";
    process.env.USER1_PASSWORD = "alice_secure_password_123";
    process.env.USER2_NAME = "Bob";
    process.env.USER2_PASSWORD = "bob_secure_password_456";
    delete process.env.USER3_NAME;
    delete process.env.USER3_PASSWORD;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("authenticateUser", () => {
    it("authenticates USER1 correctly", async () => {
      const user = await authenticateUser("Alice", "alice_secure_password_123");
      expect(user).toEqual({ uid: "user1", name: "Alice" });
    });

    it("authenticates USER2 correctly", async () => {
      const user = await authenticateUser("Bob", "bob_secure_password_456");
      expect(user).toEqual({ uid: "user2", name: "Bob" });
    });

    it("rejects wrong password", async () => {
      const user = await authenticateUser("Alice", "wrong_password");
      expect(user).toBeNull();
    });

    it("rejects unknown username", async () => {
      const user = await authenticateUser("Charlie", "some_password");
      expect(user).toBeNull();
    });

    it("stops scanning when USER index is missing", async () => {
      // USER1 and USER2 exist. Even if USER4 was defined, if USER3 is missing, USER4 should not be reached.
      process.env.USER4_NAME = "David";
      process.env.USER4_PASSWORD = "david_password";

      const user = await authenticateUser("David", "david_password");
      expect(user).toBeNull();
    });

    it("supports adding USER3 dynamically when contiguous", async () => {
      process.env.USER3_NAME = "Charlie";
      process.env.USER3_PASSWORD = "charlie_password";

      const user = await authenticateUser("Charlie", "charlie_password");
      expect(user).toEqual({ uid: "user3", name: "Charlie" });
    });
  });

  describe("signSession & verifySession", () => {
    it("signs and successfully verifies a session JWT", async () => {
      const token = await signSession({ uid: "user1", name: "Alice" });
      expect(typeof token).toBe("string");

      const verified = await verifySession(token);
      expect(verified).toEqual({ uid: "user1", name: "Alice" });
    });

    it("returns null for an invalid or tampered token", async () => {
      const token = await signSession({ uid: "user1", name: "Alice" });
      const tampered = token.slice(0, -5) + "abcde";

      const verified = await verifySession(tampered);
      expect(verified).toBeNull();
    });

    it("returns null for malformed token string", async () => {
      const verified = await verifySession("invalid.jwt.token");
      expect(verified).toBeNull();
    });
  });

  describe("Rate Limiting", () => {
    const testIp = "192.168.1.100";

    beforeEach(() => {
      clearLoginRateLimit(testIp);
    });

    it("allows attempts initially and blocks after 5 failed attempts", () => {
      expect(checkLoginRateLimit(testIp).allowed).toBe(true);

      for (let i = 0; i < 4; i++) {
        recordFailedLoginAttempt(testIp);
        expect(checkLoginRateLimit(testIp).allowed).toBe(true);
      }

      recordFailedLoginAttempt(testIp); // 5th fail
      expect(checkLoginRateLimit(testIp).allowed).toBe(false);
    });

    it("clears rate limit upon clearLoginRateLimit", () => {
      for (let i = 0; i < 5; i++) {
        recordFailedLoginAttempt(testIp);
      }
      expect(checkLoginRateLimit(testIp).allowed).toBe(false);

      clearLoginRateLimit(testIp);
      expect(checkLoginRateLimit(testIp).allowed).toBe(true);
    });
  });
});
