import { describe, it, expect } from "vitest";
import { calculateBackoff } from "../src/core/backoff.js";

describe("calculateBackoff", () => {
  it("fixed: always returns baseDelay", () => {
    expect(calculateBackoff("fixed", 1000, 1)).toBe(1000);
    expect(calculateBackoff("fixed", 1000, 5)).toBe(1000);
  });

  it("linear: returns baseDelay * attempt", () => {
    expect(calculateBackoff("linear", 500, 1)).toBe(500);
    expect(calculateBackoff("linear", 500, 3)).toBe(1500);
  });

  it("exponential: doubles each attempt", () => {
    expect(calculateBackoff("exponential", 1000, 1)).toBe(1000);
    expect(calculateBackoff("exponential", 1000, 2)).toBe(2000);
    expect(calculateBackoff("exponential", 1000, 3)).toBe(4000);
  });

  it("exponential: caps at 10 minutes", () => {
    const result = calculateBackoff("exponential", 1000, 100);
    expect(result).toBe(10 * 60 * 1000);
  });
});
