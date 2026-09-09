import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { blameApi, diffApi, type Blame, type BlameCommit, type ChangesetSelector, type FileChange, type FileDiff, type Worktree } from "../api";
import { relativeTime } from "../lib/time";
import { languageFor, mergePieces, tokenizeLines, type LineTokens } from "./highlight";
import { buildRows, EXPAND_STEP, hunkStarts, type GapRow, type GapState, type LineRow, type Row } from "./rows";
import { wordDiff, type Segment } from "./wordDiff";

export type DiffMode = "unified" | "split";

interface Props {
  worktree: Worktree;
  selector: ChangesetSelector;
  file: FileChange;
  scheme?: "light" | "dark";
  /** Show the entire file (all context expanded) instead of just hunks. */
  wholeFile?: boolean;
  onWholeFileChange?: (v: boolean) => void;
  /** Show inline blame for the hovered/selected line. */
  blame?: boolean;
  onBlameChange?: (v: boolean) => void;
  onSelectCommit?: (sha: string) => void;
  mode: DiffMode;
  onModeChange: (m: DiffMode) => void;
  ignoreWhitespace: boolean;
  onIgnoreWhitespaceChange: (v: boolean) => void;
}

const fmtBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

export function DiffView({ worktree, selector, file, scheme = "light", wholeFile = false, onWholeFileChange, blame = false, onBlameChange, onSelectCommit, mode, onModeChange, ignoreWhitespace, onIgnoreWhitespaceChange }: Props) {
  const query = useQuery({
    queryKey: ["diff", worktree.path, selector, file.path, file.oldPath ?? "", ignoreWhitespace],
    queryFn: () => diffApi.file(worktree.path, selector, file.path, file.oldPath, { ignoreWhitespace }),
    refetchInterval: "worktree" in selector ? 30000 : false,
  });
  const [gaps, setGaps] = useState<GapState>({});
  const fd = query.data;
  // Whole-file mode: every gap fully expanded (only possible with content).
  const effectiveGaps = useMemo(() => {
    if (!wholeFile || !fd || fd.truncated || !(fd.old ?? fd.new)) return gaps;
    const all: GapState = { ...gaps };
    for (const r of buildRows(fd, {})) if (r.kind === "gap") all[r.id] = { up: r.count + (gaps[r.id]?.up ?? 0), down: gaps[r.id]?.down ?? 0 };
    return all;
  }, [wholeFile, fd, gaps]);
  // Whole-file mode shows the final file only: deleted lines are dropped and
  // paired changes render just their new side.
  const rows = useMemo(() => {
    const all = fd ? buildRows(fd, effectiveGaps) : [];
    return wholeFile ? all.filter((r) => r.kind !== "line" || r.new) : all;
  }, [fd, effectiveGaps, wholeFile]);
  const blameQuery = useQuery({
    queryKey: ["blame", worktree.path, selector, file.path],
    queryFn: () => blameApi.file(worktree.path, selector, file.path),
    enabled: blame && Boolean(fd) && !fd?.binary && fd?.hasNew !== false,
    staleTime: 60_000,
  });
  const [focusLine, setFocusLine] = useState<number | null>(null);
  const blameCtx: BlameContext | null = useMemo(() => {
    if (!blame) return null;
    return { data: blameQuery.data ?? null, focusLine, setFocusLine, onSelectCommit };
  }, [blame, blameQuery.data, focusLine, onSelectCommit]);
  const starts = useMemo(() => hunkStarts(rows), [rows]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [hunkIdx, setHunkIdx] = useState(-1);
  const highlight = useHighlight(fd, file.path, scheme);

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
        <span className="file-stat" title="Lines added and deleted in this file">
          <span className="stat-add">+{file.additions}</span> <span className="stat-del">−{file.deletions}</span>
        </span>
        <span className="spacer" />
        <label className="check" title="Hide changes that only add or remove whitespace (git diff -w)">
          <input type="checkbox" checked={ignoreWhitespace} onChange={(e) => onIgnoreWhitespaceChange(e.target.checked)} /> Ignore whitespace
        </label>
        {onWholeFileChange && (
          <label className="check" title="Show the entire file with changes inline (double-click a file)">
            <input type="checkbox" checked={wholeFile} onChange={(e) => onWholeFileChange(e.target.checked)} disabled={Boolean(fd && (fd.truncated || !(fd.old ?? fd.new)))} /> Whole file
          </label>
        )}
        {onBlameChange && (
          <label className="check" title="Who changed the hovered line, and when">
            <input type="checkbox" checked={blame} onChange={(e) => onBlameChange(e.target.checked)} disabled={Boolean(fd && (fd.binary || !fd.hasNew))} /> Blame
          </label>
        )}
        {fd && !fd.truncated && fd.hunks.length > 0 && (fd.old ?? fd.new) && (
          <button type="button" className="ghost" onClick={expandAll} title="Show every unchanged line between hunks">
            Expand all
          </button>
        )}
        <div className="segmented" role="radiogroup" aria-label="Diff layout" hidden={wholeFile}>
          {(["unified", "split"] as DiffMode[]).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={mode === m} className={mode === m ? "on" : ""} onClick={() => onModeChange(m)} title={m === "unified" ? "Old and new lines in one column" : "Old on the left, new on the right"}>
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
      {blame && blameQuery.isError && (
        <p role="alert" className="error">
          Could not load blame: {blameQuery.error.message}
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
          {!fd.binary && fd.hunks.length > 0 && (mode === "split" && !wholeFile ? <SplitTable rows={rows} onExpand={expand} hl={highlight} blame={blameCtx} /> : <UnifiedTable rows={rows} onExpand={expand} hl={highlight} blame={blameCtx} newOnly={wholeFile} />)}
        </div>
      )}
    </section>
  );
}

interface BlameContext {
  data: Blame | null;
  focusLine: number | null;
  setFocusLine: (n: number | null) => void;
  onSelectCommit?: (sha: string) => void;
}

function blameFor(ctx: BlameContext | null, newNo: number | undefined): BlameCommit | null {
  if (!ctx?.data || !newNo) return null;
  const sha = ctx.data.lines[newNo - 1];
  return sha ? ctx.data.commits[sha] ?? null : null;
}

function blameTitle(c: BlameCommit): string {
  const when = c.time ? new Date(c.time * 1000).toLocaleString() : "";
  return c.uncommitted ? "Uncommitted change" : `${c.author} <${c.email}>\n${when}\n${c.sha.slice(0, 7)} ${c.summary}`;
}

/** GitLens-style trailing note for the focused line. */
function BlameNote({ ctx, newNo }: { ctx: BlameContext | null; newNo: number | undefined }) {
  if (!ctx || ctx.focusLine !== newNo) return null;
  const c = blameFor(ctx, newNo);
  if (!c) return ctx.data ? null : <span className="blame-note muted">loading blame…</span>;
  const text = c.uncommitted ? "Uncommitted changes" : `${c.author}, ${relativeTime(c.time)} · ${c.summary}`;
  return (
    <span className="blame-note" title={blameTitle(c)} data-testid="blame-note">
      {c.uncommitted || !ctx.onSelectCommit ? (
        text
      ) : (
        <button type="button" className="blame-link" onClick={() => ctx.onSelectCommit?.(c.sha)}>
          {text}
        </button>
      )}
    </span>
  );
}

/** Per-side line tokens (index = line number - 1); empty until Shiki resolves. */
interface Highlight {
  old: LineTokens[] | null;
  new: LineTokens[] | null;
}

const NO_HIGHLIGHT: Highlight = { old: null, new: null };

type HighlightState = Highlight & { for: FileDiff | undefined; scheme: string };

function useHighlight(fd: FileDiff | undefined, path: string, scheme: "light" | "dark"): Highlight {
  const [hl, setHl] = useState<HighlightState>({ ...NO_HIGHLIGHT, for: undefined, scheme });
  const lang = languageFor(path);
  useEffect(() => {
    if (!fd || fd.binary || !lang) return;
    let cancelled = false;
    // Full sides when available; otherwise tokenize the hunk lines by side so
    // multi-line constructs at least highlight within a hunk.
    const oldLines = fd.old ? { lines: fd.old, numbers: null } : linesFromHunks(fd, "-");
    const newLines = fd.new ? { lines: fd.new, numbers: null } : linesFromHunks(fd, "+");
    void Promise.all([tokenizeLines(oldLines.lines, lang, scheme), tokenizeLines(newLines.lines, lang, scheme)]).then(([o, n]) => {
      if (cancelled) return;
      setHl({ for: fd, scheme, old: o ? remap(o, oldLines.numbers) : null, new: n ? remap(n, newLines.numbers) : null });
    });
    return () => {
      cancelled = true;
    };
  }, [fd, lang, scheme]);
  // Results for a different file or scheme are stale: render plain until the new ones land.
  return hl.for === fd && hl.scheme === scheme ? hl : NO_HIGHLIGHT;
}

/** Lines of one side taken from hunks (for truncated files), with their line numbers. */
function linesFromHunks(fd: FileDiff, side: "-" | "+"): { lines: string[]; numbers: number[] | null } {
  const lines: string[] = [];
  const numbers: number[] = [];
  for (const h of fd.hunks) {
    for (const l of h.lines) {
      if (l.t === " " || l.t === side) {
        lines.push(l.s);
        numbers.push((side === "-" ? l.o : l.n) ?? 0);
      }
    }
  }
  return { lines, numbers };
}

/** Places tokens at their line numbers when they came from a subset of lines. */
function remap(tokens: LineTokens[], numbers: number[] | null): LineTokens[] {
  if (!numbers) return tokens;
  const out: LineTokens[] = [];
  numbers.forEach((no, i) => {
    if (no > 0) out[no - 1] = tokens[i];
  });
  return out;
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

function Code({ text, segments, tokens }: { text: string; segments?: Segment[]; tokens?: LineTokens }) {
  const pieces = mergePieces(tokens, segments, text);
  return (
    <>
      {pieces.map((p, i) => (
        <span key={i} className={p.changed ? "chg" : undefined} style={p.color ? { color: p.color } : undefined}>
          {p.text}
        </span>
      ))}
    </>
  );
}

const tokensAt = (side: LineTokens[] | null, no: number | undefined) => (side && no ? side[no - 1] : undefined);

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

function UnifiedTable({ rows, onExpand, hl, blame, newOnly = false }: { rows: Row[]; onExpand: (g: GapRow, d: "up" | "down" | "all") => void; hl: Highlight; blame: BlameContext | null; newOnly?: boolean }) {
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
          if (newOnly) {
            if (r.new) out.push(<LineTr key={`${r.key}n`} row={r} side={r.new} otherNo={r.old?.no} segments={r.new.type === "+" ? seg?.b : undefined} tokens={tokensAt(hl.new, r.new.no)} index={i} blame={blame} newNo={r.new.no} />);
            return out;
          }
          if (r.old) out.push(<LineTr key={`${r.key}o`} row={r} side={r.old} otherNo={r.old.type === " " ? r.new?.no : undefined} segments={seg?.a} tokens={tokensAt(hl.old, r.old.no) ?? (r.old.type === " " ? tokensAt(hl.new, r.new?.no) : undefined)} index={i} blame={blame} newNo={r.old.type === " " ? r.new?.no : undefined} />);
          if (r.new && r.new.type !== " ") out.push(<LineTr key={`${r.key}n`} row={r} side={r.new} segments={seg?.b} tokens={tokensAt(hl.new, r.new.no)} index={i} blame={blame} newNo={r.new.no} />);
          return out;
        })}
      </tbody>
    </table>
  );
}

function LineTr({ row, side, otherNo, segments, tokens, index, blame, newNo: blameNo }: { row: LineRow; side: NonNullable<LineRow["old"]>; otherNo?: number; segments?: Segment[]; tokens?: LineTokens; index: number; blame: BlameContext | null; newNo?: number }) {
  const cls = lineClass(side.type);
  const isNewSide = blameNo !== undefined && blameNo === side.no && side.type !== "-";
  const oldNo = side.type === "+" ? "" : isNewSide ? otherNo ?? side.no : side.no;
  const newNo = side.type === "-" ? "" : side.type === " " && !isNewSide ? otherNo ?? side.no : side.no;
  const bc = blameFor(blame, blameNo);
  const focused = blame && blameNo !== undefined && blame.focusLine === blameNo;
  return (
    <tr
      className={`line ${cls}${focused ? " focused" : ""}`}
      data-row={index}
      data-key={row.key}
      onMouseEnter={blame && blameNo ? () => blame.setFocusLine(blameNo) : undefined}
      onClick={blame && blameNo ? () => blame.setFocusLine(blameNo) : undefined}
    >
      <td className="no">{oldNo}</td>
      <td className="no" title={bc ? blameTitle(bc) : undefined}>
        {newNo}
      </td>
      <td className="code">
        <span className="sign">{side.type === " " ? " " : side.type}</span>
        <Code text={side.text} segments={segments} tokens={tokens} />
        {side.nonl && <span className="nonl" title="No newline at end of file">⏎</span>}
        <BlameNote ctx={blame} newNo={blameNo} />
      </td>
    </tr>
  );
}

function SplitTable({ rows, onExpand, hl, blame }: { rows: Row[]; onExpand: (g: GapRow, d: "up" | "down" | "all") => void; hl: Highlight; blame: BlameContext | null }) {
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
          const newNo = r.new?.no;
          const bc = blameFor(blame, newNo);
          const focused = blame && newNo !== undefined && blame.focusLine === newNo;
          return (
            <tr
              key={r.key}
              className={`line${focused ? " focused" : ""}`}
              data-row={i}
              data-key={r.key}
              onMouseEnter={blame && newNo ? () => blame.setFocusLine(newNo) : undefined}
              onClick={blame && newNo ? () => blame.setFocusLine(newNo) : undefined}
            >
              <td className={`no ${r.old ? lineClass(r.old.type) : "empty"}`}>{r.old?.no ?? ""}</td>
              <td className={`code ${r.old ? lineClass(r.old.type) : "empty"}`}>
                {r.old && <Code text={r.old.text} segments={seg?.a} tokens={tokensAt(hl.old, r.old.no) ?? (r.old.type === " " ? tokensAt(hl.new, r.new?.no) : undefined)} />}
                {r.old?.nonl && <span className="nonl" title="No newline at end of file">⏎</span>}
              </td>
              <td className={`no ${r.new ? lineClass(r.new.type) : "empty"}`} title={bc ? blameTitle(bc) : undefined}>
                {r.new?.no ?? ""}
              </td>
              <td className={`code ${r.new ? lineClass(r.new.type) : "empty"}`}>
                {r.new && <Code text={r.new.text} segments={seg?.b} tokens={tokensAt(hl.new, r.new.no)} />}
                {r.new?.nonl && <span className="nonl" title="No newline at end of file">⏎</span>}
                <BlameNote ctx={blame} newNo={newNo} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export type { FileDiff };
