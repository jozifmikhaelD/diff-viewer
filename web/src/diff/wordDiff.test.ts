import { describe, expect, it } from "vitest";
import { tokenize, wordDiff } from "./wordDiff";

describe("tokenize", () => {
  it("splits into words, whitespace and punctuation", () => {
    expect(tokenize('return `hello ${name}`;')).toEqual(["return", " ", "`", "hello", " ", "$", "{", "name", "}", "`", ";"]);
  });
});

describe("wordDiff", () => {
  it("marks only the changed word", () => {
    const { a, b } = wordDiff("  return `hello ${name}`;", "  return `hi ${name}`;");
    expect(a).toEqual([
      { text: "  return `", changed: false },
      { text: "hello", changed: true },
      { text: " ${name}`;", changed: false },
    ]);
    expect(b.find((s) => s.changed)?.text).toBe("hi");
  });

  it("returns unchanged segments for identical lines", () => {
    expect(wordDiff("same", "same")).toEqual({ a: [{ text: "same", changed: false }], b: [{ text: "same", changed: false }] });
  });

  it("falls back to whole-line highlighting when almost everything differs", () => {
    const { a, b } = wordDiff("alpha beta gamma", "one two three four");
    expect(a).toEqual([{ text: "alpha beta gamma", changed: true }]);
    expect(b).toEqual([{ text: "one two three four", changed: true }]);
  });

  it("handles insertions and empty sides", () => {
    const { a, b } = wordDiff("a b", "a x b");
    expect(a.every((s) => !s.changed)).toBe(true);
    expect(b).toEqual([
      { text: "a ", changed: false },
      { text: "x ", changed: true },
      { text: "b", changed: false },
    ]);
    expect(wordDiff("", "new")).toEqual({ a: [{ text: "", changed: false }], b: [{ text: "new", changed: true }] });
  });
});
