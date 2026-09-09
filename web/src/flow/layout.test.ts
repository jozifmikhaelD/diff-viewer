import { describe, expect, it } from "vitest";
import type { DepNode } from "../api";
import { assignLayers, breakCycles, layoutFlow, orderLayers, toMermaid } from "./layout";

const n = (path: string, changed = true): DepNode => ({ path, changed, status: changed ? "M" : undefined, additions: 1, deletions: 0, depth: changed ? 0 : 1 });
const groupOf = (p: string) => p.split("/").slice(0, -1).join("/") || "(root)";

describe("flow layout", () => {
  it("breaks cycles by reversing back edges", () => {
    const edges = breakCycles(
      ["a", "b", "c"],
      [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
        { from: "c", to: "a" },
      ],
    );
    expect(edges.filter((e) => e.reversed)).toHaveLength(1);
    const layers = assignLayers(["a", "b", "c"], edges);
    expect(new Set(layers.values()).size).toBe(3); // acyclic chain
  });

  it("assigns longest-path layers with entry points first", () => {
    const paths = ["page.tsx", "comp.tsx", "service.ts", "util.ts"];
    const edges = breakCycles(paths, [
      { from: "page.tsx", to: "comp.tsx" },
      { from: "page.tsx", to: "util.ts" },
      { from: "comp.tsx", to: "service.ts" },
      { from: "service.ts", to: "util.ts" },
    ]);
    const layers = assignLayers(paths, edges);
    expect([...layers.entries()].sort()).toEqual([
      ["comp.tsx", 1],
      ["page.tsx", 0],
      ["service.ts", 2],
      ["util.ts", 3],
    ]);
  });

  it("orders layers to reduce crossings", () => {
    // a1->b2 and a2->b1 cross if b keeps alphabetical order; barycenter should swap the b's
    const paths = ["a1", "a2", "b1", "b2"];
    const edges = breakCycles(paths, [
      { from: "a1", to: "b2" },
      { from: "a2", to: "b1" },
    ]);
    const layers = assignLayers(paths, edges);
    const order = orderLayers(paths, layers, edges);
    expect(order.get("b2")).toBeLessThan(order.get("b1")!);
  });

  it("produces coordinates, layer labels and dimensions", () => {
    const nodes = [n("src/pages/home.tsx"), n("src/components/card.tsx"), n("src/components/list.tsx"), n("src/lib/api.ts", false)];
    const layout = layoutFlow(
      nodes,
      [
        { from: "src/pages/home.tsx", to: "src/components/card.tsx" },
        { from: "src/pages/home.tsx", to: "src/components/list.tsx" },
        { from: "src/components/card.tsx", to: "src/lib/api.ts" },
      ],
      groupOf,
    );
    expect(layout.layers.map((l) => [l.index, l.count, l.label])).toEqual([
      [0, 1, "src/pages"],
      [1, 2, "src/components"],
      [2, 1, "src/lib"],
    ]);
    const home = layout.nodes.find((x) => x.path.endsWith("home.tsx"))!;
    const api = layout.nodes.find((x) => x.path.endsWith("api.ts"))!;
    expect(home.x).toBeLessThan(api.x);
    expect(layout.width).toBeGreaterThan(api.x);
    expect(layout.height).toBeGreaterThan(0);
    // nodes in the same layer do not overlap vertically
    const comps = layout.nodes.filter((x) => x.layer === 1).sort((a, b) => a.y - b.y);
    expect(comps[1].y).toBeGreaterThanOrEqual(comps[0].y + comps[0].h);
  });

  it("exports Mermaid with subgraphs, dashed reversed edges and a changed class", () => {
    const layout = layoutFlow(
      [n("a/x.ts"), n("a/y.ts", false)],
      [
        { from: "a/x.ts", to: "a/y.ts" },
        { from: "a/y.ts", to: "a/x.ts" },
      ],
      groupOf,
    );
    const m = toMermaid(layout);
    expect(m.startsWith("flowchart LR")).toBe(true);
    expect(m).toContain('subgraph "a"');
    expect(m).toContain('na_x_ts["x.ts (M +1 -0)"]');
    expect(m).toContain("-.->");
    expect(m).toContain("-->");
    expect(m).toContain("class na_x_ts changed;");
  });

  it("handles an empty graph", () => {
    const layout = layoutFlow([], [], groupOf);
    expect(layout.nodes).toEqual([]);
    expect(layout.layers).toEqual([]);
    expect(toMermaid(layout)).toBe("flowchart LR");
  });
});
