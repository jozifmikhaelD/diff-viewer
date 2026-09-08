import { describe, expect, it } from "vitest";
import { isEmptySearch, parseSearch } from "./search";

describe("parseSearch", () => {
  it("treats plain words as an escaped message regexp", () => {
    expect(parseSearch("fix login (v2)")).toEqual({ grep: "fix login \\(v2\\)" });
  });
  it("extracts author: and ref:/branch: terms", () => {
    expect(parseSearch("author:ann typo")).toEqual({ author: "ann", grep: "typo" });
    expect(parseSearch("branch:feature")).toEqual({ ref: "feature" });
    expect(parseSearch("ref:v0.1.0 rename")).toEqual({ ref: "v0.1.0", grep: "rename" });
  });
  it("treats a leading hex token as a commit to jump to", () => {
    expect(parseSearch("eeaee7d")).toEqual({ ref: "eeaee7d" });
    expect(parseSearch("DEADBEEF1234")).toEqual({ ref: "deadbeef1234" });
    // hex after words is just a word; short hex is a word
    expect(parseSearch("fix eeaee7d")).toEqual({ grep: "fix eeaee7d" });
    expect(parseSearch("abc")).toEqual({ grep: "abc" });
  });
  it("reports empty searches", () => {
    expect(isEmptySearch(parseSearch("   "))).toBe(true);
    expect(isEmptySearch(parseSearch("x"))).toBe(false);
  });
});
