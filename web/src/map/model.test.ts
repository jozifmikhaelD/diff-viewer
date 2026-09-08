import { describe as d, expect, it } from "vitest";
import type { DepGraph } from "../api";
import { describe, groupCenters, groupOf, radiusOf, viewGraph } from "./model";

const g: DepGraph = {
  nodes: [
    { path: "src/app.ts", changed: true, status: "M", additions: 10, deletions: 2, depth: 0 },
    { path: "src/utils.ts", changed: false, additions: 0, deletions: 0, depth: 1 },
    { path: "README.md", changed: true, status: "A", additions: 1, deletions: 0, depth: 0 },
  ],
  edges: [
    { from: "src/app.ts", to: "src/utils.ts" },
    { from: "src/app.ts", to: "README.md" },
  ],
  truncated: false,
  indexed: 3,
};

d("map model", () => {
  it("groups by top-level directory", () => {
    expect(groupOf("src/a/b.ts")).toBe("src");
    expect(groupOf("README.md")).toBe("");
  });

  it("hides neighbours and their edges", () => {
    const full = viewGraph(g, true);
    expect(full.nodes).toHaveLength(3);
    expect(full.edges).toHaveLength(2);
    expect(full.groups).toEqual(["", "src"]);
    const changedOnly = viewGraph(g, false);
    expect(changedOnly.nodes.map((n) => n.path)).toEqual(["src/app.ts", "README.md"]);
    expect(changedOnly.edges).toEqual([{ from: "src/app.ts", to: "README.md" }]);
  });

  it("sizes changed nodes by churn and keeps neighbours small", () => {
    expect(radiusOf(g.nodes[1])).toBe(5);
    expect(radiusOf(g.nodes[0])).toBeGreaterThan(radiusOf(g.nodes[2]));
    expect(radiusOf({ ...g.nodes[0], additions: 10000 })).toBe(16);
  });

  it("places groups around a circle, or centred when alone", () => {
    const one = groupCenters(["src"], 400, 200);
    expect(one.get("src")).toEqual({ x: 200, y: 100 });
    const two = groupCenters(["a", "b"], 400, 200);
    expect(two.get("a")!.y).toBeLessThan(100);
    expect(two.get("b")!.y).toBeGreaterThan(100);
  });

  it("describes the view", () => {
    expect(describe(g, viewGraph(g, true))).toBe("2 changed · 1 neighbour · 2 imports");
    expect(describe({ ...g, truncated: true }, viewGraph(g, false))).toBe("2 changed · 1 import · truncated");
  });
});
