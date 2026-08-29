import { describe, expect, it } from "vitest";
import { truncateAddress } from "../sorostream";

describe("truncateAddress — case-insensitive truncation (#486)", () => {
  it("returns empty string for empty input", () => {
    expect(truncateAddress("")).toBe("");
  });

  it("truncates a standard uppercase Stellar address correctly", () => {
    const addr = "GBKLYONWFBQFBFZK6HMTXQZJNBKQEXZ3PJOVXNKZXVTV4FQXVMKLKHA";
    expect(truncateAddress(addr)).toBe("GBKL...LKHA");
  });

  it("normalises a lowercase address to uppercase before truncating", () => {
    const lower = "gbklyonwfbqfbfzk6hmtxqzjnbkqexz3pjovxnkzxvtv4fqxvmklkha";
    expect(truncateAddress(lower)).toBe("GBKL...LKHA");
  });

  it("normalises a mixed-case address to uppercase before truncating", () => {
    const mixed = "GBKLyonWFBQFBFZK6HMtxQZJNBKQEXZ3PJOVXNKZXVtV4FQXVmKlkhA";
    // The first 4 and last 4 chars uppercased
    const expected = `${mixed.toUpperCase().slice(0, 4)}...${mixed.toUpperCase().slice(-4)}`;
    expect(truncateAddress(mixed)).toBe(expected);
  });

  it("produces the same output for the same address regardless of input case", () => {
    const upper = "GBKLYONWFBQFBFZK6HMTXQZJNBKQEXZ3PJOVXNKZXVTV4FQXVMKLKHA";
    const lower = upper.toLowerCase();
    const mixed = upper
      .split("")
      .map((c, i) => (i % 2 === 0 ? c.toLowerCase() : c.toUpperCase()))
      .join("");

    const truncUpper = truncateAddress(upper);
    const truncLower = truncateAddress(lower);
    const truncMixed = truncateAddress(mixed);

    expect(truncUpper).toBe(truncLower);
    expect(truncUpper).toBe(truncMixed);
  });

  it("always uses uppercase characters in the truncated result", () => {
    const addr = "gbklyonwfbqfbfzk6hmtxqzjnbkqexz3pjovxnkzxvtv4fqxvmklkha";
    const result = truncateAddress(addr);
    expect(result).toBe(result.toUpperCase().replace(/\./g, "...").slice(0, 4) + "..." + result.slice(-4));
    // All non-ellipsis characters should be uppercase
    expect(result.replace(/\./g, "")).toBe(result.replace(/\./g, "").toUpperCase());
  });

  it("formats as XXXX...XXXX (4 chars, ellipsis, 4 chars)", () => {
    const addr = "GBKLYONWFBQFBFZK6HMTXQZJNBKQEXZ3PJOVXNKZXVTV4FQXVMKLKHA";
    const result = truncateAddress(addr);
    expect(result).toMatch(/^.{4}\.\.\..{4}$/);
  });

  it("handles a short address gracefully", () => {
    // Short strings should still not throw
    expect(() => truncateAddress("GABC")).not.toThrow();
  });
});
