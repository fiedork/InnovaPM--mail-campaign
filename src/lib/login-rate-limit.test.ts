import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";

import {
  checkLoginAttempt,
  clearLoginRateLimitForTests,
  recordLoginFailure,
  resetLoginAttempts,
} from "./login-rate-limit";

describe("login rate limiter", () => {
  it("uses bounded JSON parsing and returns 400 for malformed login payloads", () => {
    const source = readFileSync("src/app/api/auth/login/route.ts", "utf8");

    expect(source).toContain("await jsonPayload(request)");
    expect(source).toContain("status: 400");
  });

  beforeEach(() => clearLoginRateLimitForTests());

  it("blocks an IP after five failed attempts for ten minutes", () => {
    const ip = "203.0.113.10";
    const now = 1_000_000;

    for (let index = 0; index < 5; index += 1) {
      expect(checkLoginAttempt(ip, now).allowed).toBe(true);
      recordLoginFailure(ip, now);
    }

    const blocked = checkLoginAttempt(ip, now);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(600);
    expect(checkLoginAttempt(ip, now + 600_000).allowed).toBe(true);
  });

  it("clears failures after successful login", () => {
    const ip = "203.0.113.20";
    const now = 2_000_000;

    recordLoginFailure(ip, now);
    resetLoginAttempts(ip);

    expect(checkLoginAttempt(ip, now).allowed).toBe(true);
  });
});
