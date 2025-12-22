import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatDate } from "./dateFormatter";

describe("formatDate", () => {
  it("returns formatted date for valid inputs", () => {
    assert.equal(formatDate("2024-01-15"), "Jan 15, 2024");
    assert.equal(formatDate(new Date("2020-06-01")), "Jun 1, 2020");
  });

  it("returns fallback for empty strings", () => {
    assert.equal(formatDate("", { fallback: "Invalid date" }), "Invalid date");
  });

  it("returns fallback for invalid date strings", () => {
    assert.equal(formatDate("invalid", { fallback: "Invalid date" }), "Invalid date");
  });

  it("returns fallback for invalid Date objects", () => {
    assert.equal(formatDate(new Date("bad"), { fallback: "Invalid date" }), "Invalid date");
  });

  it("returns empty string fallback by default", () => {
    assert.equal(formatDate("not a real date"), "");
  });
});
