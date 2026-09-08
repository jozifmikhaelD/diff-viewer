import { describe, expect, it } from "vitest";
import type { FileChange } from "../api";
import { buildTree, languageBreakdown, matchesFilter } from "./summary";

const fc = (path: string, additions = 1, deletions = 0, extra: Partial<FileChange> = {}): FileChange => ({
  path,
  status: "M",
  additions,
  deletions,
  binary: false,
  ...extra,
});

describe("languageBreakdown", () => {
  it("groups by language and sorts by churn", () => {
    const stats = languageBreakdown([fc("a.ts", 10), fc("b.tsx", 5, 5), fc("c.py", 2), fc("Makefile", 1), fc("x.unknown", 30)]);
    expect(stats.map((s) => [s.name, s.files, s.additions, s.deletions])).toEqual([
      ["Other", 1, 30, 0],
      ["TypeScript", 2, 15, 5],
      ["Python", 1, 2, 0],
      ["Makefile", 1, 1, 0],
    ]);
  });
});

describe("buildTree", () => {
  it("nests files under directories, dirs first, alphabetical", () => {
    const tree = buildTree([fc("src/b.ts"), fc("README.md"), fc("src/a.ts"), fc("lib/x.py", 2, 3)]);
    expect(tree.map((n) => n.name)).toEqual(["lib", "src", "README.md"]);
    const src = tree[1];
    expect(src.kind).toBe("dir");
    if (src.kind === "dir") {
      expect(src.children.map((c) => c.name)).toEqual(["a.ts", "b.ts"]);
      expect(src.files).toBe(2);
    }
    const lib = tree[0];
    if (lib.kind === "dir") expect([lib.additions, lib.deletions]).toEqual([2, 3]);
  });

  it("collapses single-child directory chains", () => {
    const tree = buildTree([fc("src/app/components/Button.tsx"), fc("src/app/components/Input.tsx"), fc("src/index.ts")]);
    expect(tree).toHaveLength(1);
    const src = tree[0];
    expect(src.name).toBe("src");
    if (src.kind === "dir") {
      expect(src.children.map((c) => c.name)).toEqual(["app/components", "index.ts"]);
      const comps = src.children[0];
      if (comps.kind === "dir") expect(comps.path).toBe("src/app/components");
    }
  });

  it("returns an empty tree for no files", () => {
    expect(buildTree([])).toEqual([]);
  });
});

describe("matchesFilter", () => {
  it("matches case-insensitively on path and old path", () => {
    const f = fc("src/utils.ts", 1, 1, { status: "R", oldPath: "src/util.ts" });
    expect(matchesFilter(f, "")).toBe(true);
    expect(matchesFilter(f, "UTILS")).toBe(true);
    expect(matchesFilter(f, "util.ts")).toBe(true);
    expect(matchesFilter(f, "nope")).toBe(false);
  });
});
