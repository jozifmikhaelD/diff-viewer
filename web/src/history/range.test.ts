import { describe, expect, it } from "vitest";
import { anchorOf, rangeFromClick } from "./selection";

const order = ["e", "d", "c", "b", "a"]; // newest first

describe("rangeFromClick", () => {
  it("orders from (older) to (newer) regardless of click order", () => {
    expect(rangeFromClick("d", "b", order)).toEqual({ kind: "range", from: "b", to: "d", mergeBase: false });
    expect(rangeFromClick("b", "d", order)).toEqual({ kind: "range", from: "b", to: "d", mergeBase: false });
  });
  it("returns null for same commit or unknown commits", () => {
    expect(rangeFromClick("d", "d", order)).toBeNull();
    expect(rangeFromClick("zz", "d", order)).toBeNull();
  });
});

describe("anchorOf", () => {
  it("uses the selected commit or the newer end of a range", () => {
    expect(anchorOf({ kind: "commit", sha: "c" })).toBe("c");
    expect(anchorOf({ kind: "range", from: "a", to: "d", mergeBase: false })).toBe("d");
    expect(anchorOf({ kind: "worktree" })).toBeNull();
    expect(anchorOf(null)).toBeNull();
  });
});
