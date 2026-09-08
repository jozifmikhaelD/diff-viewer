import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { diffApi, type ChangesetSelector, type FileChange, type FileDiff, type Worktree } from "../api";
import { buildRows, EXPAND_STEP, hunkStarts, type GapRow, type GapState, type LineRow, type Row } from "./rows";
import { wordDiff, type Segment } from "./wordDiff";

export type DiffMode = "unified" | "split";

interface Props {
  worktree: Worktree;
  selector: ChangesetSelector;
  file: FileChange;
  mode: DiffMode;
  onModeChange: (m: DiffMode) => void;
  ignoreWhitespace: boolean;
  onIgnoreWhitespaceChange: (v: boolean) => void;
}

const fmtBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

export function DiffView({ worktree, selector, file, mode, onModeChange, ignoreWhitespace, onIgnoreWhitespaceChange }: Props) {
  const query = useQuery({
    queryKey: ["diff", worktree.path, selector, file.path, file.oldPath ?? "", ignoreWhitespace],
    queryFn: () => diffApi.file(worktree.path, selector, file.path, file.oldPath, { ignoreWhitespace }),
    refetchInterval: "worktree" in selector ? 30000 : false,
  });
  const [gaps, setGaps] = useState<GapState>({});
  const fd = query.data;
  const rows = useMemo(() => (fd ? buildRows(fd, gaps) : []), [fd, gaps]);
  const starts = useMemo(() => hunkStarts(rows), [rows]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [hunkIdx, setHunkIdx] = useState(-1);

  const expand = useCallback((gap: GapRow, dir: "up" | "down" | "all") => {
    setGaps((g) => {
      const cur = g[gap.id] ?? { up: 0, down: 0 };
      if (dir === "all") return { ...g, [gap.id]: { up: cur.up + gap.count, down: cur.down } };
      return { ...g, [gap.id]: { ...cur, [dir]: cur[dir] + EXPAND_STEP } };
    });
  }, []);
  const expandAll = () => {
    if (!fd) return;
    const all: GapState = {};
    for (const r of rows) if (r.kind === "gap") all[r.id] = { up: (gaps[r.id]?.up ?? 0) + r.count, down: gaps[r.id]?.down ?? 0 };
    setGaps({ ...gaps, ...all });
  };

  // j / k hunk navigation
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTyping(e.target)) return;
      if (e.key !== "j" && e.key !== "k") return;
      if (starts.length === 0) return;
      e.preventDefault();
      const next = e.key === "j" ? Math.min(hunkIdx + 1, starts.length - 1) : Math.max(hunkIdx - 1, 0);
      setHunkIdx(next);
      const el = scrollRef.current?.querySelector<HTMLElement>(`[data-row="${starts[next]}"]`);
      el?.scrollIntoView({ block: "center" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [starts, hunkIdx]);

  const churn = file.additions + file.deletions;
  return (
    <section className="diff" aria-label={`Diff for ${file.path}`}>
      <header className="diff-toolbar">
        <h3 className="diff-path" title={file.path}>
          {file.oldPath && (
            <>
              <span className="file-from">{file.oldPath}</span> →{" "}
            </>
          )}
          {file.path}
        </h3>
        <span className="file-stat">
          <span className="stat-add">+{file.additions}</span> <span className="stat-del">−{file.deletions}</span>
        </span>
        <span className="spacer" />
        <label className="check">
          <input type="checkbox" checked={ignoreWhitespace} onChange={(e) => onIgnoreWhitespaceChange(e.target.checked)} /> Ignore whitespace
        </label>
        {fd && !fd.truncated && fd.hunks.length > 0 && (fd.old ?? fd.new) && (
          <button type="button" className="ghost" onClick={expandAll}>
            Expand all
          </button>
        )}
        <div className="segmented" role="radiogroup" aria-label="Diff layout">
          {(["unified", "split"] as DiffMode[]).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={mode === m} className={mode === m ? "on" : ""} onClick={() => onModeChange(m)}>
              {m === "unified" ? "Unified" : "Side by side"}
            </button>
          ))}
        </div>
      </header>
      {query.isPending && <p role="status">Loading diff…</p>}
      {query.isError && (
        <p role="alert" className="error">
          Could not load diff: {query.error.message}
        </p>
      )}
      {fd && (
        <div className="diff-scroll" ref={scrollRef}>
          {fd.binary && (
            <p className="diff-notice">
              Binary file{fd.hasOld && fd.hasNew ? ` changed: ${fmtBytes(fd.oldSize)} → ${fmtBytes(fd.newSize)}` : fd.hasNew ? ` added (${fmtBytes(fd.newSize)})` : ` deleted (${fmtBytes(fd.oldSize)})`}.
            </p>
          )}
          {fd.submodule && <p className="diff-notice">Submodule pointer changed.</p>}
          {fd.truncated && <p className="diff-notice">File is large; context expansion is disabled.</p>}
          {!fd.binary && fd.hunks.length === 0 && (
            <p className="diff-notice">{churn === 0 && !ignoreWhitespace ? "No textual changes." : "No changes to show" + (ignoreWhitespace ? " once whitespace is ignored." : ".")}</p>
          )}
          {!fd.binary && fd.hunks.length > 0 && (mode === "split" ? <SplitTable rows={rows} onExpand={expand} /> : <UnifiedTable rows={rows} onExpand={expand} />)}
        </div>
      )}
    </section>
  );
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

function useWordDiffs(rows: Row[]) {
  return useMemo(() => {
    const map = new Map<string, { a: Segment[]; b: Segment[] }>();
    for (const r of rows) {
      if (r.kind === "line" && r.paired && r.old && r.new) map.set(r.key, wordDiff(r.old.text, r.new.text));
    }
    return map;
  }, [rows]);
}

function Code({ text, segments, changed }: { text: string; segments?: Segment[]; changed?: boolean }) {
  if (!segments) return <span className={changed ? "chg" : undefined}>{text}</span>;
  return (
    <>
      {segments.map((s, i) => (
        <span key={i} className={s.changed ? "chg" : undefined}>
          {s.text}
        </span>
      ))}
    </>
  );
}

function GapCells({ gap, onExpand, colSpan }: { gap: GapRow; onExpand: (g: GapRow, d: "up" | "down" | "all") => void; colSpan: number }) {
  return (
    <td colSpan={colSpan} className="gap-cell">
      {gap.expandable ? (
        <span className="gap-controls">
          <button type="button" onClick={() => onExpand(gap, "up")} title="Show 20 more lines above" aria-label="Expand up">
            ▲
          </button>
          <button type="button" className="gap-all" onClick={() => onExpand(gap, "all")}>
            {gap.count} unchanged {gap.count === 1 ? "line" : "lines"}
          </button>
          <button type="button" onClick={() => onExpand(gap, "down")} title="Show 20 more lines below" aria-label="Expand down">
            ▼
          </button>
        </span>
      ) : (
        <span className="gap-static">
          {gap.count} unchanged {gap.count === 1 ? "line" : "lines"}
        </span>
      )}
    </td>
  );
}

const lineClass = (t?: " " | "+" | "-") => (t === "+" ? "add" : t === "-" ? "del" : "ctx");

function UnifiedTable({ rows, onExpand }: { rows: Row[]; onExpand: (g: GapRow, d: "up" | "down" | "all") => void }) {
  const wd = useWordDiffs(rows);
  return (
    <table className="diff-table unified">
      <tbody>
        {rows.flatMap((r, i) => {
          if (r.kind === "gap")
            return [
              <tr key={r.key} className="gap" data-row={i}>
                <GapCells gap={r} onExpand={onExpand} colSpan={3} />
              </tr>,
            ];
          if (r.kind === "header")
            return [
              <tr key={r.key} className="hunk-header" data-row={i}>
                <td colSpan={3}>@@ {r.text}</td>
              </tr>,
            ];
          const out = [];
          const seg = wd.get(r.key);
          if (r.old) out.push(<LineTr key={`${r.key}o`} row={r} side={r.old} otherNo={r.old.type === " " ? r.new?.no : undefined} segments={seg?.a} index={i} />);
          if (r.new && r.new.type !== " ") out.push(<LineTr key={`${r.key}n`} row={r} side={r.new} segments={seg?.b} index={i} />);
          return out;
        })}
      </tbody>
    </table>
  );
}

function LineTr({ row, side, otherNo, segments, index }: { row: LineRow; side: NonNullable<LineRow["old"]>; otherNo?: number; segments?: Segment[]; index: number }) {
  const cls = lineClass(side.type);
  const oldNo = side.type === "+" ? "" : side.no;
  const newNo = side.type === "-" ? "" : side.type === " " ? otherNo ?? side.no : side.no;
  return (
    <tr className={`line ${cls}`} data-row={index} data-key={row.key}>
      <td className="no">{oldNo}</td>
      <td className="no">{newNo}</td>
      <td className="code">
        <span className="sign">{side.type === " " ? " " : side.type}</span>
        <Code text={side.text} segments={segments} />
        {side.nonl && <span className="nonl" title="No newline at end of file">⏎</span>}
      </td>
    </tr>
  );
}

function SplitTable({ rows, onExpand }: { rows: Row[]; onExpand: (g: GapRow, d: "up" | "down" | "all") => void }) {
  const wd = useWordDiffs(rows);
  return (
    <table className="diff-table split">
      <tbody>
        {rows.map((r, i) => {
          if (r.kind === "gap")
            return (
              <tr key={r.key} className="gap" data-row={i}>
                <GapCells gap={r} onExpand={onExpand} colSpan={4} />
              </tr>
            );
          if (r.kind === "header")
            return (
              <tr key={r.key} className="hunk-header" data-row={i}>
                <td colSpan={4}>@@ {r.text}</td>
              </tr>
            );
          const seg = wd.get(r.key);
          return (
            <tr key={r.key} className="line" data-row={i} data-key={r.key}>
              <td className={`no ${r.old ? lineClass(r.old.type) : "empty"}`}>{r.old?.no ?? ""}</td>
              <td className={`code ${r.old ? lineClass(r.old.type) : "empty"}`}>
                {r.old && <Code text={r.old.text} segments={seg?.a} />}
                {r.old?.nonl && <span className="nonl" title="No newline at end of file">⏎</span>}
              </td>
              <td className={`no ${r.new ? lineClass(r.new.type) : "empty"}`}>{r.new?.no ?? ""}</td>
              <td className={`code ${r.new ? lineClass(r.new.type) : "empty"}`}>
                {r.new && <Code text={r.new.text} segments={seg?.b} />}
                {r.new?.nonl && <span className="nonl" title="No newline at end of file">⏎</span>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export type { FileDiff };
