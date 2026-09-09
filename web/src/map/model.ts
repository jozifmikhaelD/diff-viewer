import type { DepEdge, DepGraph, DepNode } from "../api";

/** Top-level directory of a path ("" for root files). */
export function groupOf(path: string): string {
  const i = path.indexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

const TEST_RE = /(\.spec|\.test|_test|\.stories)\.[^/]+$|(^|\/)(__tests__|__mocks__|test|tests|spec|e2e|testdata)\//i;

/** Heuristic for test/spec/story files across ecosystems. */
export function isTestFile(path: string): boolean {
  return TEST_RE.test(path);
}

function dirOf(path: string): string[] {
  const parts = path.split("/");
  parts.pop();
  return parts;
}

/**
 * Assigns every path to a group at the shallowest directory level that
 * actually splits the set (after removing the directory prefix all paths
 * share), keeping the group count readable. Returns path -> group label.
 */
export function groupPaths(paths: readonly string[], maxGroups = 12): Map<string, string> {
  const dirs = paths.map(dirOf);
  let common = dirs.length ? [...dirs[0]] : [];
  for (const d of dirs) {
    let k = 0;
    while (k < common.length && k < d.length && common[k] === d[k]) k++;
    common = common.slice(0, k);
  }
  const rest = dirs.map((d) => d.slice(common.length));
  const label = (segs: string[]) => (segs.length ? segs.join("/") : "(root)");
  let chosen: string[][] | null = null;
  for (let depth = 1; depth <= 4; depth++) {
    const cut = rest.map((d) => d.slice(0, depth));
    const count = new Set(cut.map(label)).size;
    if (count >= 2 && count <= maxGroups) {
      chosen = cut;
      break;
    }
    if (count > maxGroups) break;
  }
  if (!chosen) chosen = rest.map((d) => d.slice(0, 1));
  // Refine dominant groups: a group holding most of the nodes is split one
  // directory deeper (repeatedly) as long as that actually separates files.
  for (let round = 0; round < 3; round++) {
    const counts = new Map<string, number>();
    chosen.forEach((c) => counts.set(label(c), (counts.get(label(c)) ?? 0) + 1));
    const dominant = [...counts.entries()].find(([, n]) => n >= Math.max(25, paths.length * 0.35));
    if (!dominant || counts.size >= maxGroups * 2) break;
    const idx = chosen.map((c, i) => (label(c) === dominant[0] ? i : -1)).filter((i) => i >= 0);
    const depth = chosen[idx[0]].length + 1;
    const deeper = idx.map((i) => rest[i].slice(0, depth));
    if (new Set(deeper.map(label)).size < 2) break;
    idx.forEach((i, k) => {
      chosen![i] = deeper[k];
    });
  }
  const out = new Map<string, string>();
  paths.forEach((p, i) => out.set(p, label(chosen![i])));
  return out;
}

/** Labels always shown: every changed node on small graphs, else the most-churned ones. */
export function alwaysLabelled(nodes: readonly DepNode[], max = 40): Set<string> {
  const changed = nodes.filter((n) => n.changed);
  if (changed.length <= max) return new Set(changed.map((n) => n.path));
  return new Set(
    [...changed]
      .sort((a, b) => b.additions + b.deletions - (a.additions + a.deletions))
      .slice(0, max)
      .map((n) => n.path),
  );
}

/** Case-insensitive substring filter on the path; empty matches everything. */
export function matchesPath(path: string, filter: string): boolean {
  const q = filter.trim().toLowerCase();
  return !q || path.toLowerCase().includes(q);
}

export interface ViewGraph {
  nodes: DepNode[];
  edges: DepEdge[];
  groups: string[];
  groupOf: Map<string, string>;
  hiddenTests: number;
}

export interface ViewOptions {
  showNeighbours: boolean;
  hideTests: boolean;
  /** File-list filter: keeps matching changed files and the neighbours attached to them. */
  filter?: string;
}

/** Applies the neighbour/test/path filters and computes groups for what remains. */
export function viewGraph(g: DepGraph, opts: ViewOptions): ViewGraph {
  let nodes = opts.showNeighbours ? g.nodes : g.nodes.filter((n) => n.changed);
  if (opts.filter?.trim()) {
    const changedKept = new Set(nodes.filter((n) => n.changed && matchesPath(n.path, opts.filter!)).map((n) => n.path));
    const attached = new Set<string>(changedKept);
    for (const e of g.edges) {
      if (changedKept.has(e.from)) attached.add(e.to);
      if (changedKept.has(e.to)) attached.add(e.from);
    }
    nodes = nodes.filter((n) => (n.changed ? changedKept.has(n.path) : attached.has(n.path)));
  }
  let hiddenTests = 0;
  if (opts.hideTests) {
    const kept = nodes.filter((n) => !isTestFile(n.path));
    hiddenTests = nodes.length - kept.length;
    nodes = kept;
  }
  const keep = new Set(nodes.map((n) => n.path));
  const edges = g.edges.filter((e) => keep.has(e.from) && keep.has(e.to));
  const groupMap = groupPaths(nodes.map((n) => n.path));
  const groups = [...new Set(groupMap.values())].sort();
  return { nodes, edges, groups, groupOf: groupMap, hiddenTests };
}

/** Node radius: changed files scale with churn, neighbours stay small. */
export function radiusOf(n: DepNode): number {
  if (!n.changed) return 4;
  return Math.min(14, 6 + Math.sqrt(n.additions + n.deletions) * 0.8);
}

/**
 * Cluster anchors on a grid whose cells scale with cluster size, so big
 * clusters get room and small ones stay close.
 */
export function groupCenters(counts: Map<string, number>, width: number, height: number): Map<string, { x: number; y: number; r: number }> {
  const groups = [...counts.keys()].sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || a.localeCompare(b));
  const radius = (n: number) => 30 + 16 * Math.sqrt(n);
  const cols = Math.max(1, Math.ceil(Math.sqrt(groups.length)));
  const rows = Math.ceil(groups.length / cols);
  const cell = Math.max(...groups.map((g) => radius(counts.get(g) ?? 1))) * 2.3;
  const gridW = cols * cell;
  const gridH = rows * cell;
  const ox = width / 2 - gridW / 2 + cell / 2;
  const oy = height / 2 - gridH / 2 + cell / 2;
  const out = new Map<string, { x: number; y: number; r: number }>();
  groups.forEach((g, i) => {
    out.set(g, { x: ox + (i % cols) * cell, y: oy + Math.floor(i / cols) * cell, r: radius(counts.get(g) ?? 1) });
  });
  return out;
}

/** Zoom transform that fits the given points (with padding) into the viewport. */
export function fitTransform(points: { x: number; y: number }[], width: number, height: number, pad = 60): { k: number; x: number; y: number } {
  if (points.length === 0) return { k: 1, x: 0, y: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const w = Math.max(1, maxX - minX + pad * 2);
  const h = Math.max(1, maxY - minY + pad * 2);
  const k = Math.min(2.5, Math.max(0.2, Math.min(width / w, height / h)));
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return { k, x: width / 2 - cx * k, y: height / 2 - cy * k };
}

/** Summary line for the toolbar. */
export function describe(g: DepGraph, view: ViewGraph): string {
  const changed = view.nodes.filter((n) => n.changed).length;
  const neighbours = view.nodes.length - changed;
  const parts = [`${changed} changed`];
  if (neighbours > 0) parts.push(`${neighbours} ${neighbours === 1 ? "neighbour" : "neighbours"}`);
  parts.push(`${view.edges.length} ${view.edges.length === 1 ? "import" : "imports"}`);
  if (view.hiddenTests > 0) parts.push(`${view.hiddenTests} test ${view.hiddenTests === 1 ? "file" : "files"} hidden`);
  if (g.truncated) parts.push("truncated");
  return parts.join(" · ");
}
