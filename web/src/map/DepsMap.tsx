import { useQuery } from "@tanstack/react-query";
import { drag as d3drag } from "d3-drag";
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationLinkDatum, type SimulationNodeDatum } from "d3-force";
import { select } from "d3-selection";
import { zoom as d3zoom, zoomIdentity, type ZoomTransform } from "d3-zoom";
import { useEffect, useMemo, useRef, useState } from "react";
import { depsApi, type ChangesetSelector, type DepNode, type Worktree } from "../api";
import { describe, groupCenters, groupOf, radiusOf, viewGraph } from "./model";

interface Props {
  worktree: Worktree;
  selector: ChangesetSelector;
  /** Paths that exist in the current changeset (clickable into the diff). */
  changedPaths: Set<string>;
  selectedPath: string | null;
  onSelectPath: (path: string) => void;
  /** Test hook: fixed size when the container cannot be measured. */
  size?: { width: number; height: number };
}

type SimNode = SimulationNodeDatum & { node: DepNode; group: string; r: number };
type SimLink = SimulationLinkDatum<SimNode>;

const GROUP_COLORS = ["#5b5bd6", "#d6409f", "#f76b15", "#30a46c", "#0090ff", "#e5484d", "#8e4ec6", "#ffb224", "#12a594", "#ab4aba"];

export function DepsMap({ worktree, selector, changedPaths, selectedPath, onSelectPath, size }: Props) {
  const [depth, setDepth] = useState(1);
  const [showNeighbours, setShowNeighbours] = useState(true);
  const [cluster, setCluster] = useState(true);
  const query = useQuery({
    queryKey: ["deps", worktree.path, selector, depth],
    queryFn: () => depsApi.graph(worktree.path, selector, depth),
  });
  const view = useMemo(() => (query.data ? viewGraph(query.data, showNeighbours) : null), [query.data, showNeighbours]);

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
  const simRef = useRef<ReturnType<typeof forceSimulation<SimNode>> | null>(null);

  // (Re)build the simulation when the graph or layout options change.
  useEffect(() => {
    if (!view) return;
    const centers = groupCenters(view.groups, dims.width, dims.height);
    const nodes: SimNode[] = view.nodes.map((n) => {
      const c = centers.get(groupOf(n.path))!;
      return { node: n, group: groupOf(n.path), r: radiusOf(n), x: c.x + (Math.random() - 0.5) * 40, y: c.y + (Math.random() - 0.5) * 40 };
    });
    const byPath = new Map(nodes.map((n) => [n.node.path, n]));
    const simLinks: SimLink[] = view.edges.map((e) => ({ source: byPath.get(e.from)!, target: byPath.get(e.to)! }));
    const sim = forceSimulation<SimNode>(nodes)
      .force("link", forceLink<SimNode, SimLink>(simLinks).distance(60).strength(0.6))
      .force("charge", forceManyBody().strength(-180))
      .force("collide", forceCollide<SimNode>((d) => d.r + 14))
      .force("center", forceCenter(dims.width / 2, dims.height / 2).strength(cluster ? 0.02 : 0.1));
    if (cluster && view.groups.length > 1) {
      sim.force("gx", forceX<SimNode>((d) => centers.get(d.group)!.x).strength(0.12));
      sim.force("gy", forceY<SimNode>((d) => centers.get(d.group)!.y).strength(0.12));
    }
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setPositions([...nodes]);
        setLinks([...simLinks]);
      });
    };
    sim.on("tick", schedule);
    simRef.current = sim;
    schedule();
    return () => {
      sim.stop();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [view, dims, cluster]);

  // zoom + drag
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const z = d3zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 4])
      .filter((e: Event) => !(e.target as Element).closest("g.node"))
      .on("zoom", (e) => setTransform(e.transform));
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

  const groupColor = useMemo(() => {
    const m = new Map<string, string>();
    view?.groups.forEach((g, i) => m.set(g, GROUP_COLORS[i % GROUP_COLORS.length]));
    return m;
  }, [view]);

  return (
    <section className="deps" aria-label="Dependency map">
      <header className="diff-toolbar deps-toolbar">
        <h3 className="diff-path">Map</h3>
        {query.data && view && <span className="deps-summary">{describe(query.data, view)}</span>}
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
          <input type="checkbox" checked={cluster} onChange={(e) => setCluster(e.target.checked)} /> Cluster by directory
        </label>
      </header>
      {query.isPending && <p role="status">Indexing imports…</p>}
      {query.isError && (
        <p role="alert" className="error">
          Could not build the map: {query.error.message}
        </p>
      )}
      {query.data && query.data.indexed === 0 && <p className="diff-notice">No import statements could be resolved in this tree (supported: TypeScript/JavaScript, Python, Go, Java/Kotlin).</p>}
      <div className="deps-canvas" ref={wrapRef}>
        <svg ref={svgRef} width={dims.width} height={dims.height} role="img" aria-label="Files and their imports">
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--muted)" />
            </marker>
          </defs>
          <g transform={transform.toString()}>
            {links.map((l, i) => {
              const s = l.source as SimNode;
              const t = l.target as SimNode;
              if (s.x === undefined || t.x === undefined) return null;
              const dx = (t.x ?? 0) - (s.x ?? 0);
              const dy = (t.y ?? 0) - (s.y ?? 0);
              const len = Math.hypot(dx, dy) || 1;
              const tx = (t.x ?? 0) - (dx / len) * (t.r + 2);
              const ty = (t.y ?? 0) - (dy / len) * (t.r + 2);
              return <line key={i} className="dep-edge" x1={s.x} y1={s.y} x2={tx} y2={ty} markerEnd="url(#arrow)" data-from={s.node.path} data-to={t.node.path} />;
            })}
            {positions.map((d) => {
              const n = d.node;
              const clickable = changedPaths.has(n.path);
              const name = n.path.split("/").pop() ?? n.path;
              return (
                <g
                  key={n.path}
                  className={`node${n.changed ? " changed" : " neighbour"}${selectedPath === n.path ? " selected" : ""}${clickable ? " clickable" : ""}`}
                  transform={`translate(${d.x ?? 0},${d.y ?? 0})`}
                  data-path={n.path}
                  role={clickable ? "button" : undefined}
                  tabIndex={clickable ? 0 : undefined}
                  aria-label={`${n.path}${n.changed ? ` (${n.status ?? "changed"}, +${n.additions} −${n.deletions})` : " (unchanged)"}`}
                  onClick={() => clickable && onSelectPath(n.path)}
                  onKeyDown={(e) => {
                    if (clickable && (e.key === "Enter" || e.key === " ")) onSelectPath(n.path);
                  }}
                >
                  <title>{`${n.path}${n.changed ? `\n${n.status ?? ""} +${n.additions} −${n.deletions}` : "\nunchanged neighbour"}`}</title>
                  <circle r={d.r} fill={n.changed ? groupColor.get(d.group) : "var(--bg-elev)"} stroke={groupColor.get(d.group)} strokeWidth={n.changed ? 0 : 1.5} />
                  <text dy={d.r + 11} textAnchor="middle" className="dep-label">
                    {name}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
        {view && view.groups.length > 1 && (
          <ul className="deps-legend" aria-label="Directories">
            {view.groups.map((g) => (
              <li key={g}>
                <span className="lang-dot" style={{ background: groupColor.get(g) }} /> {g || "(root)"}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
