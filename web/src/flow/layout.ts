import type { DepEdge, DepNode } from "../api";

/**
 * Layered (Sugiyama-style) layout for the import graph, read left to right:
 * files nothing imports (entry points) sit in the first column, the files
 * they import in the next, and so on. Cycles are broken by reversing the
 * back edges found by a DFS; those edges are drawn dashed.
 */
export interface FlowNode {
  path: string;
  node: DepNode;
  layer: number;
  order: number;
  x: number;
  y: number;
  w: number;
  h: number;
  group: string;
  /** Directory of the file relative to the prefix every file shares ("" at that root). */
  dir: string;
}

export interface FlowEdge {
  from: string;
  to: string;
  /** True when the original import direction was reversed to break a cycle. */
  reversed: boolean;
}

export interface FlowLayer {
  index: number;
  count: number;
  /** Deepest directory shared by the layer's files (relative), or a "mixed" note. */
  label: string;
}

export interface FlowLayout {
  nodes: FlowNode[];
  edges: FlowEdge[];
  layers: FlowLayer[];
  width: number;
  height: number;
  /** Directory prefix shared by every file, shown once in the toolbar. */
  commonPrefix: string;
}

export const NODE_W = 170;
export const NODE_H = 36;

function dirParts(path: string): string[] {
  const parts = path.split("/");
  parts.pop();
  return parts;
}

/** Longest common directory prefix of the given paths, as segments. */
export function commonDir(paths: readonly string[]): string[] {
  if (paths.length === 0) return [];
  let common = dirParts(paths[0]);
  for (const p of paths.slice(1)) {
    const d = dirParts(p);
    let k = 0;
    while (k < common.length && k < d.length && common[k] === d[k]) k++;
    common = common.slice(0, k);
    if (common.length === 0) break;
  }
  return common;
}

/** Heading for a set of files: their shared directory, or the dominant one plus how many others. */
export function layerLabel(paths: readonly string[], strip: readonly string[]): string {
  const rel = (p: string) => dirParts(p).slice(strip.length).join("/") || "(root)";
  const shared = commonDir(paths).slice(strip.length).join("/");
  const dirs = new Set(paths.map(rel));
  if (dirs.size === 1) return [...dirs][0];
  if (shared) return `${shared}/… (${dirs.size} dirs)`;
  const tally = new Map<string, number>();
  for (const p of paths) tally.set(rel(p), (tally.get(rel(p)) ?? 0) + 1);
  const top = [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
  return `${top} +${dirs.size - 1} more`;
}
export const COL_GAP = 90;
export const ROW_GAP = 12;

/** Reverses back edges found by DFS so the graph becomes acyclic. */
export function breakCycles(paths: readonly string[], edges: readonly DepEdge[]): FlowEdge[] {
  const out = new Map<string, string[]>();
  for (const p of paths) out.set(p, []);
  for (const e of edges) out.get(e.from)?.push(e.to);
  const state = new Map<string, 0 | 1 | 2>();
  const reversed = new Set<string>();
  const visit = (u: string) => {
    state.set(u, 1);
    for (const v of out.get(u) ?? []) {
      const s = state.get(v) ?? 0;
      if (s === 1) reversed.add(`${u} ${v}`);
      else if (s === 0) visit(v);
    }
    state.set(u, 2);
  };
  for (const p of paths) if (!state.get(p)) visit(p);
  return edges.map((e) => (reversed.has(`${e.from} ${e.to}`) ? { from: e.to, to: e.from, reversed: true } : { from: e.from, to: e.to, reversed: false }));
}

/** Longest-path layering: layer(v) = 1 + max layer of its predecessors. */
export function assignLayers(paths: readonly string[], edges: readonly FlowEdge[]): Map<string, number> {
  const preds = new Map<string, string[]>();
  for (const p of paths) preds.set(p, []);
  for (const e of edges) preds.get(e.to)?.push(e.from);
  const memo = new Map<string, number>();
  const layer = (v: string): number => {
    const m = memo.get(v);
    if (m !== undefined) return m;
    memo.set(v, 0); // guard; the graph is acyclic after breakCycles
    const l = Math.max(-1, ...(preds.get(v) ?? []).map(layer)) + 1;
    memo.set(v, l);
    return l;
  };
  for (const p of paths) layer(p);
  return memo;
}

/** Barycenter sweeps to reduce edge crossings; returns the order within each layer. */
export function orderLayers(paths: readonly string[], layers: Map<string, number>, edges: readonly FlowEdge[], sweeps = 6): Map<string, number> {
  const byLayer = new Map<number, string[]>();
  for (const p of [...paths].sort()) {
    const l = layers.get(p) ?? 0;
    byLayer.set(l, [...(byLayer.get(l) ?? []), p]);
  }
  const maxLayer = Math.max(-1, ...byLayer.keys());
  const preds = new Map<string, string[]>();
  const succs = new Map<string, string[]>();
  for (const e of edges) {
    preds.set(e.to, [...(preds.get(e.to) ?? []), e.from]);
    succs.set(e.from, [...(succs.get(e.from) ?? []), e.to]);
  }
  const pos = new Map<string, number>();
  const commit = () => byLayer.forEach((list) => list.forEach((p, i) => pos.set(p, i)));
  commit();
  const bary = (p: string, neigh: string[]) => {
    const ns = neigh.map((n) => pos.get(n)).filter((v): v is number => v !== undefined);
    return ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : (pos.get(p) ?? 0);
  };
  for (let s = 0; s < sweeps; s++) {
    const down = s % 2 === 0;
    for (let l = down ? 1 : maxLayer - 1; down ? l <= maxLayer : l >= 0; l += down ? 1 : -1) {
      const list = byLayer.get(l);
      if (!list) continue;
      const keyed = list.map((p) => ({ p, b: bary(p, down ? (preds.get(p) ?? []) : (succs.get(p) ?? [])) }));
      keyed.sort((a, b) => a.b - b.b || a.p.localeCompare(b.p));
      byLayer.set(l, keyed.map((k) => k.p));
      commit();
    }
  }
  return pos;
}

/** Full layout. `groupOf` supplies directory labels for layers. */
export function layoutFlow(nodes: readonly DepNode[], edges: readonly DepEdge[], groupOf: (path: string) => string): FlowLayout {
  const paths = nodes.map((n) => n.path);
  const strip = commonDir(paths);
  const flowEdges = breakCycles(paths, edges);
  const layers = assignLayers(paths, flowEdges);
  const order = orderLayers(paths, layers, flowEdges);
  const counts = new Map<number, number>();
  for (const p of paths) counts.set(layers.get(p) ?? 0, (counts.get(layers.get(p) ?? 0) ?? 0) + 1);
  const layerCount = counts.size ? Math.max(...counts.keys()) + 1 : 0;
  const tallest = Math.max(1, ...counts.values());
  const height = tallest * (NODE_H + ROW_GAP) - ROW_GAP + 40;
  const byPath = new Map(nodes.map((n) => [n.path, n]));
  const out: FlowNode[] = paths.map((p) => {
    const layer = layers.get(p) ?? 0;
    const n = counts.get(layer) ?? 1;
    const top = (height - (n * (NODE_H + ROW_GAP) - ROW_GAP)) / 2;
    return {
      path: p,
      node: byPath.get(p)!,
      layer,
      order: order.get(p) ?? 0,
      x: 20 + layer * (NODE_W + COL_GAP),
      y: top + (order.get(p) ?? 0) * (NODE_H + ROW_GAP),
      w: NODE_W,
      h: NODE_H,
      group: groupOf(p),
      dir: dirParts(p).slice(strip.length).join("/"),
    };
  });
  const layerMeta: FlowLayer[] = [];
  for (let l = 0; l < layerCount; l++) {
    const members = out.filter((n) => n.layer === l);
    layerMeta.push({ index: l, count: members.length, label: layerLabel(members.map((m) => m.path), strip) });
  }
  return { nodes: out, edges: flowEdges, layers: layerMeta, width: 20 + layerCount * (NODE_W + COL_GAP) - COL_GAP + 20, height, commonPrefix: strip.join("/") };
}

/** Mermaid flowchart (LR) with one subgraph per directory group. */
export function toMermaid(layout: FlowLayout): string {
  const id = (p: string) => "n" + p.replace(/[^A-Za-z0-9]/g, "_");
  const name = (p: string) => p.split("/").pop()?.replace(/"/g, "'") ?? p;
  const lines = ["flowchart LR"];
  const groups = new Map<string, FlowNode[]>();
  for (const n of layout.nodes) groups.set(n.group, [...(groups.get(n.group) ?? []), n]);
  for (const [g, members] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`  subgraph ${JSON.stringify(g || "(root)")}`);
    for (const m of members) {
      const label = m.node.changed ? `${name(m.path)} (${m.node.status ?? "M"} +${m.node.additions} -${m.node.deletions})` : name(m.path);
      lines.push(`    ${id(m.path)}["${label}"]`);
    }
    lines.push("  end");
  }
  for (const e of layout.edges) {
    const [a, b] = e.reversed ? [e.to, e.from] : [e.from, e.to];
    lines.push(`  ${id(a)} ${e.reversed ? "-.->" : "-->"} ${id(b)}`);
  }
  const changed = layout.nodes.filter((n) => n.node.changed).map((n) => id(n.path));
  if (changed.length) lines.push("  classDef changed stroke-width:2px;", `  class ${changed.join(",")} changed;`);
  return lines.join("\n");
}
