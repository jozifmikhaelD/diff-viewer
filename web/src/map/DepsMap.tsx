import { useQuery } from "@tanstack/react-query";
import { drag as d3drag } from "d3-drag";
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationLinkDatum, type SimulationNodeDatum } from "d3-force";
import { select } from "d3-selection";
import { zoom as d3zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from "d3-zoom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { depsApi, type ChangesetSelector, type DepNode, type FileStatus, type Worktree } from "../api";
import { alwaysLabelled, describe, fitTransform, groupCenters, radiusOf, viewGraph } from "./model";

interface Props {
  worktree: Worktree;
  selector: ChangesetSelector;
  /** Paths that exist in the current changeset (clickable into the diff). */
  changedPaths: Set<string>;
  selectedPath: string | null;
  onSelectPath: (path: string) => void;
  /** File-list filter text; narrows the map to matching changed files and their neighbours. */
  filter?: string;
  /** Test hook: fixed size when the container cannot be measured. */
  size?: { width: number; height: number };
}

type SimNode = SimulationNodeDatum & { node: DepNode; group: string; r: number; label: string };
type SimLink = SimulationLinkDatum<SimNode>;

const STATUS_COLOR: Record<string, string> = {
  A: "var(--add)",
  M: "var(--warn)",
  D: "var(--del)",
  R: "var(--accent)",
  C: "var(--accent)",
  T: "var(--accent)",
  U: "var(--del)",
  "?": "var(--muted)",
};
const statusColor = (s: FileStatus | undefined) => STATUS_COLOR[s ?? "M"] ?? "var(--warn)";

/** Label width estimate for collision (monospace-ish 6px per char at 11px). */
const labelWidth = (label: string) => Math.min(160, label.length * 6);

export function DepsMap({ worktree, selector, changedPaths, selectedPath, onSelectPath, filter = "", size }: Props) {
  const [depth, setDepth] = useState(1);
  const [showNeighbours, setShowNeighbours] = useState(true);
  const [hideTests, setHideTests] = useState(true);
  const query = useQuery({
    queryKey: ["deps", worktree.path, selector, depth],
    queryFn: () => depsApi.graph(worktree.path, selector, depth),
  });
  const view = useMemo(() => (query.data ? viewGraph(query.data, { showNeighbours, hideTests, filter }) : null), [query.data, showNeighbours, hideTests, filter]);
  const labelled = useMemo(() => (view ? alwaysLabelled(view.nodes) : new Set<string>()), [view]);

  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [dims, setDims] = useState(size ?? { width: 800, height: 500 });
  useEffect(() => {
    if (size || !wrapRef.current || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setDims({ width, height });
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [size]);

  const [positions, setPositions] = useState<SimNode[]>([]);
  const [links, setLinks] = useState<SimLink[]>([]);
  const [transform, setTransform] = useState<ZoomTransform>(zoomIdentity);
  const [hover, setHover] = useState<string | null>(null);
  const simRef = useRef<ReturnType<typeof forceSimulation<SimNode>> | null>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const fittedRef = useRef(false);

  const fit = useCallback(
    (nodes: SimNode[]) => {
      const svg = svgRef.current;
      const z = zoomRef.current;
      if (!svg || !z) return;
      const pts = nodes.filter((n) => n.x !== undefined).map((n) => ({ x: n.x ?? 0, y: n.y ?? 0 }));
      const t = fitTransform(pts, dims.width, dims.height);
      select(svg).call(z.transform, zoomIdentity.translate(t.x, t.y).scale(t.k));
    },
    [dims],
  );

  // (Re)build the simulation when the graph or layout options change.
  useEffect(() => {
    if (!view) return;
    const counts = new Map<string, number>();
    for (const n of view.nodes) counts.set(view.groupOf.get(n.path) ?? "", (counts.get(view.groupOf.get(n.path) ?? "") ?? 0) + 1);
    const centers = groupCenters(counts, dims.width, dims.height);
    const nodes: SimNode[] = view.nodes.map((n) => {
      const group = view.groupOf.get(n.path) ?? "";
      const c = centers.get(group)!;
      const a = Math.random() * Math.PI * 2;
      const d = Math.random() * c.r * 0.6;
      return { node: n, group, r: radiusOf(n), label: n.path.split("/").pop() ?? n.path, x: c.x + Math.cos(a) * d, y: c.y + Math.sin(a) * d };
    });
    const byPath = new Map(nodes.map((n) => [n.node.path, n]));
    const simLinks: SimLink[] = view.edges.map((e) => ({ source: byPath.get(e.from)!, target: byPath.get(e.to)! }));
    const sim = forceSimulation<SimNode>(nodes)
      .force("link", forceLink<SimNode, SimLink>(simLinks).distance(46).strength(0.35))
      .force("charge", forceManyBody().strength(-70).distanceMax(220))
      .force("collide", forceCollide<SimNode>((d) => Math.max(d.r + 10, (d.node.changed ? labelWidth(d.label) : 12) / 2)).iterations(2))
      .force("gx", forceX<SimNode>((d) => centers.get(d.group)!.x).strength(0.18))
      .force("gy", forceY<SimNode>((d) => centers.get(d.group)!.y).strength(0.18));
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setPositions([...nodes]);
        setLinks([...simLinks]);
      });
    };
    fittedRef.current = false;
    sim.on("tick", () => {
      schedule();
      if (!fittedRef.current && sim.alpha() < 0.3) {
        fittedRef.current = true;
        fit(nodes);
      }
    });
    sim.on("end", () => {
      if (!fittedRef.current) {
        fittedRef.current = true;
        fit(nodes);
      }
    });
    simRef.current = sim;
    schedule();
    return () => {
      sim.stop();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [view, dims, fit]);

  // zoom + drag
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const z = d3zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.15, 5])
      .filter((e: Event) => !(e.target as Element).closest("g.node"))
      .on("zoom", (e) => setTransform(e.transform));
    zoomRef.current = z;
    select(svg).call(z);
    return () => {
      select(svg).on(".zoom", null);
    };
  }, []);
  useEffect(() => {
    const svg = svgRef.current;
    const sim = simRef.current;
    if (!svg || !sim) return;
    // React renders g.node elements in `positions` order, so bind by index.
    const nodeSel = select(svg).selectAll<SVGGElement, SimNode>("g.node").data(positions);
    const dragBehaviour = d3drag<SVGGElement, SimNode>()
      // d3-drag reads event.view.document; synthetic events (tests) have no view.
      .filter((e: MouseEvent) => !e.ctrlKey && !e.button && Boolean(e.view))
      .on("start", (_e, d) => {
        sim.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on("drag", (e, d) => {
        d.fx = transform.invertX(e.sourceEvent.offsetX ?? e.x);
        d.fy = transform.invertY(e.sourceEvent.offsetY ?? e.y);
      })
      .on("end", (_e, d) => {
        sim.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });
    nodeSel.call(dragBehaviour);
  }, [positions, transform]);

  // Hover focus: the hovered node, its direct neighbours and their edges stay bright.
  const focus = useMemo(() => {
    if (!hover) return null;
    const set = new Set<string>([hover]);
    for (const l of links) {
      const s = (l.source as SimNode).node.path;
      const t = (l.target as SimNode).node.path;
      if (s === hover) set.add(t);
      if (t === hover) set.add(s);
    }
    return set;
  }, [hover, links]);

  // Cluster hulls: circle around each group's nodes.
  const hulls = useMemo(() => {
    const by = new Map<string, SimNode[]>();
    for (const p of positions) {
      if (p.x === undefined) continue;
      by.set(p.group, [...(by.get(p.group) ?? []), p]);
    }
    return [...by.entries()].map(([group, ns]) => {
      const cx = ns.reduce((a, n) => a + (n.x ?? 0), 0) / ns.length;
      const cy = ns.reduce((a, n) => a + (n.y ?? 0), 0) / ns.length;
      const r = Math.max(28, ...ns.map((n) => Math.hypot((n.x ?? 0) - cx, (n.y ?? 0) - cy) + n.r + 18));
      return { group, cx, cy, r, count: ns.length };
    });
  }, [positions]);

  const showAllLabels = transform.k >= 1.6 || positions.length <= 30;
  const summary = query.data && view ? describe(query.data, view) : "";

  return (
    <section className="deps" aria-label="Dependency map">
      <header className="diff-toolbar deps-toolbar">
        <h3 className="diff-path">Map</h3>
        {summary && <span className="deps-summary">{summary}</span>}
        <span className="spacer" />
        <label className="check">
          Depth
          <input type="range" min={0} max={2} value={depth} onChange={(e) => setDepth(Number(e.target.value))} aria-label="Neighbour depth" />
          <span className="count">{depth}</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={showNeighbours} onChange={(e) => setShowNeighbours(e.target.checked)} /> Neighbours
        </label>
        <label className="check">
          <input type="checkbox" checked={hideTests} onChange={(e) => setHideTests(e.target.checked)} /> Hide tests
        </label>
        <button type="button" className="ghost" onClick={() => fit(positions)} title="Fit the graph to the view">
          Fit
        </button>
      </header>
      {query.isPending && <p role="status">Indexing imports…</p>}
      {query.isError && (
        <p role="alert" className="error">
          Could not build the map: {query.error.message}
        </p>
      )}
      {query.data && query.data.indexed === 0 && <p className="diff-notice">No import statements could be resolved in this tree (supported: TypeScript/JavaScript, Python, Go, Java/Kotlin).</p>}
      {query.data?.truncated && !filter.trim() && <p className="diff-notice">Large change: showing the first {query.data.nodes.filter((n) => n.changed).length} changed files. Type in the file filter to narrow the map.</p>}
      {view && view.nodes.length === 0 && query.data && query.data.nodes.length > 0 && <p className="diff-notice">No files match the filter.</p>}
      <div className="deps-canvas" ref={wrapRef}>
        <svg ref={svgRef} width={dims.width} height={dims.height} role="img" aria-label="Files and their imports">
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--muted)" />
            </marker>
          </defs>
          <g transform={transform.toString()}>
            {hulls.length > 1 &&
              hulls.map((h) => (
                <g key={h.group} className="hull">
                  <circle cx={h.cx} cy={h.cy} r={h.r} />
                  <text x={h.cx} y={h.cy - h.r - 6} textAnchor="middle" className="hull-label">
                    {h.group} · {h.count}
                  </text>
                </g>
              ))}
            {links.map((l, i) => {
              const s = l.source as SimNode;
              const t = l.target as SimNode;
              if (s.x === undefined || t.x === undefined) return null;
              const dx = (t.x ?? 0) - (s.x ?? 0);
              const dy = (t.y ?? 0) - (s.y ?? 0);
              const len = Math.hypot(dx, dy) || 1;
              const tx = (t.x ?? 0) - (dx / len) * (t.r + 2);
              const ty = (t.y ?? 0) - (dy / len) * (t.r + 2);
              const lit = focus ? s.node.path === hover || t.node.path === hover : true;
              return (
                <line
                  key={i}
                  className={`dep-edge${focus ? (lit ? " lit" : " dim") : ""}`}
                  x1={s.x}
                  y1={s.y}
                  x2={tx}
                  y2={ty}
                  markerEnd={lit ? "url(#arrow)" : undefined}
                  data-from={s.node.path}
                  data-to={t.node.path}
                />
              );
            })}
            {positions.map((d) => {
              const n = d.node;
              const clickable = changedPaths.has(n.path);
              const dim = focus ? !focus.has(n.path) : false;
              const showLabel = labelled.has(n.path) || showAllLabels || (focus?.has(n.path) ?? false) || selectedPath === n.path;
              return (
                <g
                  key={n.path}
                  className={`node${n.changed ? " changed" : " neighbour"}${selectedPath === n.path ? " selected" : ""}${clickable ? " clickable" : ""}${dim ? " dim" : ""}`}
                  transform={`translate(${d.x ?? 0},${d.y ?? 0})`}
                  data-path={n.path}
                  role={clickable ? "button" : undefined}
                  tabIndex={clickable ? 0 : undefined}
                  aria-label={`${n.path}${n.changed ? ` (${n.status ?? "changed"}, +${n.additions} −${n.deletions})` : " (unchanged)"}`}
                  onClick={() => clickable && onSelectPath(n.path)}
                  onMouseEnter={() => setHover(n.path)}
                  onMouseLeave={() => setHover((h) => (h === n.path ? null : h))}
                  onKeyDown={(e) => {
                    if (clickable && (e.key === "Enter" || e.key === " ")) onSelectPath(n.path);
                  }}
                >
                  <title>{`${n.path}${n.changed ? `\n${n.status ?? ""} +${n.additions} −${n.deletions}` : "\nunchanged neighbour"}`}</title>
                  <circle r={d.r} fill={n.changed ? statusColor(n.status) : "var(--bg-elev)"} stroke={n.changed ? "var(--bg)" : "var(--muted)"} strokeWidth={n.changed ? 1.5 : 1.2} />
                  {showLabel && (
                    <text dy={d.r + 11} textAnchor="middle" className="dep-label">
                      {d.label}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>
        <ul className="deps-legend" aria-label="Legend">
          <li>
            <span className="lang-dot" style={{ background: "var(--add)" }} /> added
          </li>
          <li>
            <span className="lang-dot" style={{ background: "var(--warn)" }} /> modified
          </li>
          <li>
            <span className="lang-dot" style={{ background: "var(--del)" }} /> deleted
          </li>
          <li>
            <span className="lang-dot" style={{ background: "var(--accent)" }} /> renamed
          </li>
          <li>
            <span className="lang-dot hollow" /> unchanged neighbour
          </li>
        </ul>
      </div>
    </section>
  );
}
