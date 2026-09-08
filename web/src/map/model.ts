import type { DepEdge, DepGraph, DepNode } from "../api";

/** Top-level directory used for clustering ("" for root files). */
export function groupOf(path: string): string {
  const i = path.indexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

export interface ViewGraph {
  nodes: DepNode[];
  edges: DepEdge[];
  groups: string[];
}

/** Applies the "hide neighbours" filter and lists groups in a stable order. */
export function viewGraph(g: DepGraph, showNeighbours: boolean): ViewGraph {
  const nodes = showNeighbours ? g.nodes : g.nodes.filter((n) => n.changed);
  const keep = new Set(nodes.map((n) => n.path));
  const edges = g.edges.filter((e) => keep.has(e.from) && keep.has(e.to));
  const groups = [...new Set(nodes.map((n) => groupOf(n.path)))].sort();
  return { nodes, edges, groups };
}

/** Node radius: changed files scale with churn, neighbours stay small. */
export function radiusOf(n: DepNode): number {
  if (!n.changed) return 5;
  return Math.min(16, 7 + Math.sqrt(n.additions + n.deletions));
}

/** Evenly spaced anchor points for group clustering. */
export function groupCenters(groups: string[], width: number, height: number): Map<string, { x: number; y: number }> {
  const centers = new Map<string, { x: number; y: number }>();
  const cx = width / 2;
  const cy = height / 2;
  if (groups.length <= 1) {
    for (const g of groups) centers.set(g, { x: cx, y: cy });
    return centers;
  }
  const r = Math.min(width, height) * 0.3;
  groups.forEach((g, i) => {
    const a = (2 * Math.PI * i) / groups.length - Math.PI / 2;
    centers.set(g, { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  });
  return centers;
}

/** Summary line for the toolbar. */
export function describe(g: DepGraph, view: ViewGraph): string {
  const changed = view.nodes.filter((n) => n.changed).length;
  const neighbours = view.nodes.length - changed;
  const parts = [`${changed} changed`];
  if (neighbours > 0) parts.push(`${neighbours} ${neighbours === 1 ? "neighbour" : "neighbours"}`);
  parts.push(`${view.edges.length} ${view.edges.length === 1 ? "import" : "imports"}`);
  if (g.truncated) parts.push("truncated");
  return parts.join(" · ");
}
