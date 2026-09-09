import { useQuery } from "@tanstack/react-query";
import { select } from "d3-selection";
import { zoom as d3zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from "d3-zoom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { depsApi, type ChangesetSelector, type FileStatus, type Worktree } from "../api";
import { describe, fitTransform, viewGraph } from "../map/model";
import { ZoomButtons } from "../map/ZoomButtons";
import { layoutFlow, NODE_H, toMermaid, type FlowLayout } from "./layout";

interface Props {
  worktree: Worktree;
  selector: ChangesetSelector;
  changedPaths: Set<string>;
  selectedPath: string | null;
  onSelectPath: (path: string) => void;
  filter?: string;
  size?: { width: number; height: number };
}

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

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Layered left-to-right diagram of how the change flows through the code. */
export function FlowView({ worktree, selector, changedPaths, selectedPath, onSelectPath, filter = "", size }: Props) {
  const [depth, setDepth] = useState(1);
  const [showNeighbours, setShowNeighbours] = useState(true);
  const [hideTests, setHideTests] = useState(true);
  const debouncedFilter = useDebounced(filter.trim(), 200);
  const query = useQuery({
    queryKey: ["deps", worktree.path, selector, depth, debouncedFilter],
    queryFn: () => depsApi.graph(worktree.path, selector, depth, debouncedFilter),
    placeholderData: (prev) => prev,
  });
  const view = useMemo(() => (query.data ? viewGraph(query.data, { showNeighbours, hideTests, filter }) : null), [query.data, showNeighbours, hideTests, filter]);
  const layout: FlowLayout | null = useMemo(() => (view ? layoutFlow(view.nodes, view.edges, (p) => view.groupOf.get(p) ?? "") : null), [view]);

  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [dims, setDims] = useState(size ?? { width: 800, height: 500 });
  const [transform, setTransform] = useState<ZoomTransform>(zoomIdentity);
  const [hover, setHover] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (size || !wrapRef.current || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setDims({ width, height });
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [size]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const z = d3zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.15, 4])
      // Explicit extent: the default reads the SVG viewBox, which jsdom lacks.
      .extent((): [[number, number], [number, number]] => {
        const w = Number(svg.getAttribute("width")) || 800;
        const h = Number(svg.getAttribute("height")) || 500;
        return [
          [0, 0],
          [w, h],
        ];
      })
      // d3's default rule (ctrl allowed only for wheel = trackpad pinch), plus:
      // synthetic events (tests) have no view and d3-zoom would dereference it.
      .filter((e: Event) => (e as MouseEvent).view !== null && (!(e as MouseEvent).ctrlKey || e.type === "wheel") && !(e as MouseEvent).button)
      .on("zoom", (e) => setTransform(e.transform));
    zoomRef.current = z;
    select(svg).call(z);
    return () => {
      select(svg).on(".zoom", null);
    };
  }, []);

  const zoomBy = useCallback((k: number) => {
    const svg = svgRef.current;
    const z = zoomRef.current;
    if (!svg || !z) return;
    select(svg).call(z.scaleBy, k);
  }, []);

  const fit = useCallback(() => {
    const svg = svgRef.current;
    const z = zoomRef.current;
    if (!svg || !z || !layout) return;
    const pts = layout.nodes.flatMap((n) => [
      { x: n.x, y: n.y },
      { x: n.x + n.w, y: n.y + n.h },
    ]);
    const t = fitTransform(pts, dims.width, dims.height, 40);
    select(svg).call(z.transform, zoomIdentity.translate(t.x, t.y).scale(t.k));
  }, [layout, dims]);
  useEffect(() => {
    fit();
  }, [fit]);

  const byPath = useMemo(() => new Map(layout?.nodes.map((n) => [n.path, n]) ?? []), [layout]);
  const focus = useMemo(() => {
    if (!hover || !layout) return null;
    const set = new Set<string>([hover]);
    for (const e of layout.edges) {
      if (e.from === hover) set.add(e.to);
      if (e.to === hover) set.add(e.from);
    }
    return set;
  }, [hover, layout]);

  const copyMermaid = async () => {
    if (!layout) return;
    try {
      await navigator.clipboard.writeText(toMermaid(layout));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable
    }
  };

  const summary = query.data && view ? describe(query.data, view) : "";
  return (
    <section className="deps flow" aria-label="Flow diagram">
      <header className="diff-toolbar deps-toolbar">
        <h3 className="diff-path">Flow</h3>
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
        <ZoomButtons onZoom={(k) => zoomBy(k)} onFit={fit} />
        <button type="button" className="ghost" onClick={copyMermaid} title="Copy this diagram as Mermaid text" disabled={!layout || layout.nodes.length === 0}>
          {copied ? "Copied" : "Copy as Mermaid"}
        </button>
      </header>
      {query.isPending && <p role="status">Indexing imports…</p>}
      {query.isError && (
        <p role="alert" className="error">
          Could not build the diagram: {query.error.message}
        </p>
      )}
      {query.data && query.data.indexed === 0 && (
        <p className="diff-notice">No import statements could be resolved in this tree (supported: TypeScript/JavaScript, Python, Go, Java/Kotlin).</p>
      )}
      {query.data?.truncated && !filter.trim() && (
        <p className="diff-notice">Large change: showing the first {query.data.nodes.filter((n) => n.changed).length} changed files. Type in the file filter to narrow the diagram.</p>
      )}
      {view && view.nodes.length === 0 && query.data && query.data.nodes.length > 0 && <p className="diff-notice">No files match the filter.</p>}
      <div className="deps-canvas" ref={wrapRef}>
        <svg ref={svgRef} width={dims.width} height={dims.height} role="img" aria-label="Files laid out by import direction, left to right">
          <defs>
            <marker id="flow-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--muted)" />
            </marker>
          </defs>
          <g transform={transform.toString()}>
            {layout?.layers.map((l) => {
              const first = layout.nodes.find((n) => n.layer === l.index);
              if (!first) return null;
              return (
                <text key={l.index} x={first.x + first.w / 2} y={12} textAnchor="middle" className="hull-label" data-testid="flow-layer">
                  {l.label || "(root)"} · {l.count}
                </text>
              );
            })}
            {layout?.edges.map((e) => {
              const a = byPath.get(e.from);
              const b = byPath.get(e.to);
              if (!a || !b) return null;
              const x1 = a.x + a.w;
              const y1 = a.y + a.h / 2;
              const x2 = b.x;
              const y2 = b.y + b.h / 2;
              const c = Math.max(30, (x2 - x1) / 2);
              const lit = focus ? e.from === hover || e.to === hover : true;
              return (
                <path
                  key={`${e.from}>${e.to}`}
                  className={`flow-edge${e.reversed ? " reversed" : ""}${focus ? (lit ? " lit" : " dim") : ""}`}
                  d={`M ${x1} ${y1} C ${x1 + c} ${y1}, ${x2 - c} ${y2}, ${x2} ${y2}`}
                  markerEnd="url(#flow-arrow)"
                  data-from={e.reversed ? e.to : e.from}
                  data-to={e.reversed ? e.from : e.to}
                >
                  <title>{e.reversed ? `${e.to} imports ${e.from} (cycle)` : `${e.from} imports ${e.to}`}</title>
                </path>
              );
            })}
            {layout?.nodes.map((d) => {
              const n = d.node;
              const clickable = changedPaths.has(n.path);
              const dim = focus ? !focus.has(n.path) : false;
              const name = n.path.split("/").pop() ?? n.path;
              return (
                <g
                  key={n.path}
                  className={`flow-node${n.changed ? " changed" : " neighbour"}${selectedPath === n.path ? " selected" : ""}${clickable ? " clickable" : ""}${dim ? " dim" : ""}`}
                  transform={`translate(${d.x},${d.y})`}
                  data-path={n.path}
                  role={clickable ? "button" : undefined}
                  tabIndex={clickable ? 0 : undefined}
                  aria-label={`${n.path}${n.changed ? ` (${n.status ?? "changed"}, +${n.additions} -${n.deletions})` : " (unchanged)"}`}
                  onClick={() => clickable && onSelectPath(n.path)}
                  onMouseEnter={() => setHover(n.path)}
                  onMouseLeave={() => setHover((h) => (h === n.path ? null : h))}
                  onKeyDown={(e) => {
                    if (clickable && (e.key === "Enter" || e.key === " ")) onSelectPath(n.path);
                  }}
                >
                  <title>{`${n.path}${n.changed ? `\n${n.status ?? ""} +${n.additions} -${n.deletions}` : "\nunchanged neighbour"}`}</title>
                  <rect className="flow-box" width={d.w} height={d.h} rx={5} />
                  <rect width={4} height={d.h} rx={2} fill={n.changed ? statusColor(n.status) : "var(--muted)"} />
                  <text x={10} y={NODE_H / 2 + 4} className="flow-label">
                    {name.length > 22 ? name.slice(0, 21) + "…" : name}
                  </text>
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
            <span className="lang-dot" style={{ background: "var(--muted)" }} /> unchanged
          </li>
          <li>
            <span className="legend-dash" /> cycle
          </li>
        </ul>
      </div>
    </section>
  );
}
