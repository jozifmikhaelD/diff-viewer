import { describe as d, expect, it } from "vitest";
import type { DepGraph } from "../api";
import { alwaysLabelled, describe, fitTransform, groupCenters, groupOf, groupPaths, isTestFile, matchesPath, radiusOf, viewGraph } from "./model";

const g: DepGraph = {
  nodes: [
    { path: "src/app.ts", changed: true, status: "M", additions: 10, deletions: 2, depth: 0 },
    { path: "src/utils.ts", changed: false, additions: 0, deletions: 0, depth: 1 },
    { path: "README.md", changed: true, status: "A", additions: 1, deletions: 0, depth: 0 },
    { path: "src/app.spec.ts", changed: false, additions: 0, deletions: 0, depth: 1 },
  ],
  edges: [
    { from: "src/app.ts", to: "src/utils.ts" },
    { from: "src/app.ts", to: "README.md" },
    { from: "src/app.spec.ts", to: "src/app.ts" },
  ],
  truncated: false,
  indexed: 4,
};

d("map model", () => {
  it("groups by top-level directory", () => {
    expect(groupOf("src/a/b.ts")).toBe("src");
    expect(groupOf("README.md")).toBe("");
  });

  it("detects test files across ecosystems", () => {
    for (const p of ["a/b.spec.ts", "x.test.tsx", "pkg/foo_test.go", "src/__tests__/a.ts", "e2e/login.ts", "Button.stories.tsx", "tests/unit.py"]) {
      expect(isTestFile(p), p).toBe(true);
    }
    for (const p of ["src/app.ts", "contest/rules.md", "attest.go", "spectrum/x.ts"]) {
      expect(isTestFile(p), p).toBe(false);
    }
  });

  it("groups at the shallowest level that splits the set after the common prefix", () => {
    const paths = [
      "frontend/lib/src/domain/queue/components/a.ts",
      "frontend/lib/src/domain/queue/components/b.ts",
      "frontend/lib/src/domain/queue/services/c.ts",
      "frontend/lib/src/domain/queue/index.ts",
    ];
    const gm = groupPaths(paths);
    expect(gm.get(paths[0])).toBe("components");
    expect(gm.get(paths[2])).toBe("services");
    expect(gm.get(paths[3])).toBe("(root)");
    // no split possible: everything in one group
    const same = groupPaths(["a/b/x.ts", "a/b/y.ts"]);
    expect(new Set(same.values()).size).toBe(1);
    // too many first-level groups still yields first-level grouping
    const many = groupPaths(Array.from({ length: 30 }, (_, i) => `d${i}/f.ts`));
    expect(new Set(many.values()).size).toBe(30);
  });

  it("splits a dominant group one level deeper", () => {
    const paths = [".claude/a.md", ".devcontainer/x.json"];
    for (let i = 0; i < 30; i++) paths.push(`fhir/modules/core/f${i}.kt`);
    for (let i = 0; i < 20; i++) paths.push(`fhir/modules/api/g${i}.kt`);
    for (let i = 0; i < 10; i++) paths.push(`fhir/docs/d${i}.md`);
    const gm = groupPaths(paths);
    const groups = new Set(gm.values());
    expect(groups.has("fhir")).toBe(false); // refined
    expect(gm.get("fhir/docs/d1.md")).toBe("fhir/docs");
    expect(gm.get("fhir/modules/core/f1.kt")).toBe("fhir/modules/core");
    expect(gm.get(".claude/a.md")).toBe(".claude");
  });

  it("labels every changed node on small graphs and only the most churned on large ones", () => {
    const small = alwaysLabelled(g.nodes);
    expect([...small].sort()).toEqual(["README.md", "src/app.ts"]);
    const many = Array.from({ length: 100 }, (_, i) => ({ path: `f${i}.ts`, changed: true, status: "M" as const, additions: i, deletions: 0, depth: 0 }));
    const top = alwaysLabelled(many, 10);
    expect(top.size).toBe(10);
    expect(top.has("f99.ts")).toBe(true);
    expect(top.has("f0.ts")).toBe(false);
  });

  it("filters the map by path, keeping neighbours attached to matching files", () => {
    expect(matchesPath("src/App.ts", "app")).toBe(true);
    expect(matchesPath("src/App.ts", "")).toBe(true);
    const v = viewGraph(g, { showNeighbours: true, hideTests: true, filter: "readme" });
    expect(v.nodes.map((n) => n.path)).toEqual(["README.md"]);
    const v2 = viewGraph(g, { showNeighbours: true, hideTests: true, filter: "app.ts" });
    // README.md is changed but does not match, so it is excluded even though app.ts imports it
    expect(v2.nodes.map((n) => n.path).sort()).toEqual(["src/app.ts", "src/utils.ts"]);
  });

  it("hides neighbours and test files and drops their edges", () => {
    const full = viewGraph(g, { showNeighbours: true, hideTests: false });
    expect(full.nodes).toHaveLength(4);
    expect(full.edges).toHaveLength(3);
    const noTests = viewGraph(g, { showNeighbours: true, hideTests: true });
    expect(noTests.nodes.map((n) => n.path)).toEqual(["src/app.ts", "src/utils.ts", "README.md"]);
    expect(noTests.hiddenTests).toBe(1);
    expect(noTests.edges).toHaveLength(2);
    expect(noTests.groups).toEqual(["(root)", "src"]);
    const changedOnly = viewGraph(g, { showNeighbours: false, hideTests: true });
    expect(changedOnly.nodes.map((n) => n.path)).toEqual(["src/app.ts", "README.md"]);
  });

  it("sizes changed nodes by churn and keeps neighbours small", () => {
    expect(radiusOf(g.nodes[1])).toBe(4);
    expect(radiusOf(g.nodes[0])).toBeGreaterThan(radiusOf(g.nodes[2]));
    expect(radiusOf({ ...g.nodes[0], additions: 100000 })).toBe(14);
  });

  it("lays clusters on a grid centred in the canvas, biggest first", () => {
    const c = groupCenters(new Map([["a", 1], ["b", 20], ["c", 3]]), 800, 600);
    expect(c.size).toBe(3);
    expect(c.get("b")!.r).toBeGreaterThan(c.get("a")!.r);
    const xs = [...c.values()].map((p) => p.x);
    expect(Math.min(...xs)).toBeGreaterThan(0);
    expect(Math.max(...xs)).toBeLessThan(800);
  });

  it("computes a fitting zoom transform", () => {
    const t = fitTransform([{ x: 0, y: 0 }, { x: 1000, y: 500 }], 500, 500);
    expect(t.k).toBeLessThan(1);
    // centre of the points maps to the centre of the viewport
    expect(500 * t.k + t.x).toBeCloseTo(250, 5);
    expect(fitTransform([], 500, 500)).toEqual({ k: 1, x: 0, y: 0 });
  });

  it("describes the view", () => {
    expect(describe(g, viewGraph(g, { showNeighbours: true, hideTests: true }))).toBe("2 changed · 1 neighbour · 2 imports · 1 test file hidden");
    expect(describe({ ...g, truncated: true }, viewGraph(g, { showNeighbours: false, hideTests: false }))).toBe("2 changed · 1 import · truncated");
  });
});
