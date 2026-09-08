import { describe, expect, it } from "vitest";
import { languageFor, mergePieces } from "./highlight";

describe("languageFor", () => {
  it.each([
    ["src/app.ts", "typescript"],
    ["a/b.tsx", "tsx"],
    ["x.py", "python"],
    ["main.go", "go"],
    ["Dockerfile", "dockerfile"],
    ["Dockerfile.dev", "dockerfile"],
    ["Makefile", "makefile"],
    ["README.md", "markdown"],
    ["weird.unknown", null],
    [".bashrc", null],
    ["noext", null],
  ])("%s -> %s", (p, want) => {
    expect(languageFor(p)).toBe(want);
  });
});

describe("mergePieces", () => {
  const tokens = [
    { text: "return ", color: "#a" },
    { text: "`hello ${name}`", color: "#b" },
    { text: ";", color: "#c" },
  ];
  it("keeps tokens when there is no word diff", () => {
    expect(mergePieces(tokens, undefined, "x")).toEqual(tokens.map((t) => ({ ...t, changed: false })));
  });
  it("uses word-diff segments when there are no tokens", () => {
    expect(mergePieces(undefined, [{ text: "a", changed: false }, { text: "b", changed: true }], "ab")).toEqual([
      { text: "a", changed: false },
      { text: "b", changed: true },
    ]);
    expect(mergePieces([], undefined, "plain")).toEqual([{ text: "plain", changed: false }]);
  });
  it("splits tokens at segment boundaries preserving colours", () => {
    const segments = [
      { text: "return `", changed: false },
      { text: "hello", changed: true },
      { text: " ${name}`;", changed: false },
    ];
    expect(mergePieces(tokens, segments, "return `hello ${name}`;")).toEqual([
      { text: "return ", color: "#a", changed: false },
      { text: "`", color: "#b", changed: false },
      { text: "hello", color: "#b", changed: true },
      { text: " ${name}`", color: "#b", changed: false },
      { text: ";", color: "#c", changed: false },
    ]);
  });
  it("appends uncoloured text when segments outrun tokens", () => {
    expect(mergePieces([{ text: "ab" }], [{ text: "abcd", changed: true }], "abcd")).toEqual([
      { text: "ab", color: undefined, changed: true },
      { text: "cd", changed: true },
    ]);
  });
});
