import type { DiffLine, FileDiff, Hunk } from "../api";

/**
 * Row model shared by the unified and side-by-side renderers.
 *
 * A file's rows are its hunks' lines interleaved with "gaps" (unchanged
 * regions between hunks). Gaps can be expanded when full content is available.
 * Within a hunk, runs of deletions followed by additions are paired so the
 * side-by-side view shows them on the same row and word-diff can apply.
 */
export interface LineSide {
  no: number;
  text: string;
  type: " " | "+" | "-";
  nonl?: boolean;
}

export interface LineRow {
  kind: "line";
  key: string;
  /** Present for context and deletions. */
  old?: LineSide;
  /** Present for context and additions. */
  new?: LineSide;
  /** True when old and new are a paired change (candidate for word diff). */
  paired: boolean;
  hunk: number;
}

export interface GapRow {
  kind: "gap";
  key: string;
  id: number;
  /** Unchanged old-file line range [oldStart, oldEnd] (1-based inclusive). */
  oldStart: number;
  oldEnd: number;
  newStart: number;
  newEnd: number;
  count: number;
  expandable: boolean;
}

export interface HunkHeaderRow {
  kind: "header";
  key: string;
  hunk: number;
  text: string;
}

export type Row = LineRow | GapRow | HunkHeaderRow;

/** How much of each gap has been expanded: lines revealed from the top and bottom. */
export type GapState = Record<number, { up: number; down: number }>;

export const EXPAND_STEP = 20;

export function buildRows(fd: FileDiff, gaps: GapState = {}, showHunkHeaders = true): Row[] {
  const rows: Row[] = [];
  const content = fd.new ?? fd.old; // unchanged regions are identical on both sides
  const canExpand = content !== null && !fd.truncated;
  const totalOld = fd.old?.length ?? lastLine(fd.hunks, "old");
  const totalNew = fd.new?.length ?? lastLine(fd.hunks, "new");

  let prevOldEnd = 0;
  let prevNewEnd = 0;
  fd.hunks.forEach((h, hi) => {
    const oldStart = h.oldLines === 0 ? h.oldStart + 1 : h.oldStart;
    const newStart = h.newLines === 0 ? h.newStart + 1 : h.newStart;
    pushGap(rows, hi, prevOldEnd + 1, oldStart - 1, prevNewEnd + 1, newStart - 1, gaps, canExpand, fd);
    if (showHunkHeaders && h.header) rows.push({ kind: "header", key: `h${hi}`, hunk: hi, text: h.header });
    pairLines(rows, h, hi);
    prevOldEnd = oldStart - 1 + h.oldLines;
    prevNewEnd = newStart - 1 + h.newLines;
  });
  pushGap(rows, fd.hunks.length, prevOldEnd + 1, totalOld, prevNewEnd + 1, totalNew, gaps, canExpand, fd);
  return rows;
}

function lastLine(hunks: Hunk[], side: "old" | "new"): number {
  const h = hunks[hunks.length - 1];
  if (!h) return 0;
  return side === "old" ? h.oldStart + h.oldLines - 1 : h.newStart + h.newLines - 1;
}

function pushGap(
  rows: Row[],
  id: number,
  oldStart: number,
  oldEnd: number,
  newStart: number,
  newEnd: number,
  gaps: GapState,
  canExpand: boolean,
  fd: FileDiff,
) {
  const count = newEnd - newStart + 1;
  if (count <= 0) return;
  const st = gaps[id] ?? { up: 0, down: 0 };
  const source = fd.new ?? fd.old ?? [];
  const useNew = fd.new !== null;
  // lines revealed from the top of the gap
  const up = Math.min(st.up, count);
  for (let k = 0; k < up; k++) {
    const o = oldStart + k;
    const n = newStart + k;
    rows.push(contextRow(`g${id}u${k}`, o, n, source[(useNew ? n : o) - 1] ?? "", id));
  }
  const remaining = count - up;
  const down = Math.min(st.down, remaining);
  if (remaining - down > 0) {
    rows.push({
      kind: "gap",
      key: `g${id}`,
      id,
      oldStart: oldStart + up,
      oldEnd: oldEnd - down,
      newStart: newStart + up,
      newEnd: newEnd - down,
      count: remaining - down,
      expandable: canExpand,
    });
  }
  for (let k = down; k > 0; k--) {
    const o = oldEnd - k + 1;
    const n = newEnd - k + 1;
    rows.push(contextRow(`g${id}d${k}`, o, n, source[(useNew ? n : o) - 1] ?? "", id));
  }
}

function contextRow(key: string, o: number, n: number, text: string, hunk: number): LineRow {
  return { kind: "line", key, old: { no: o, text, type: " " }, new: { no: n, text, type: " " }, paired: false, hunk: -1 - hunk };
}

function pairLines(rows: Row[], h: Hunk, hi: number) {
  const lines = h.lines;
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (l.t === " ") {
      rows.push({ kind: "line", key: `${hi}:${i}`, old: side(l, "o"), new: side(l, "n"), paired: false, hunk: hi });
      i++;
      continue;
    }
    // collect a run of deletions then additions
    const dels: DiffLine[] = [];
    const adds: DiffLine[] = [];
    while (i < lines.length && lines[i].t === "-") dels.push(lines[i++]);
    while (i < lines.length && lines[i].t === "+") adds.push(lines[i++]);
    const n = Math.max(dels.length, adds.length);
    for (let k = 0; k < n; k++) {
      const d = dels[k];
      const a = adds[k];
      rows.push({
        kind: "line",
        key: `${hi}:${d?.o ?? "x"}:${a?.n ?? "x"}`,
        old: d ? side(d, "o") : undefined,
        new: a ? side(a, "n") : undefined,
        paired: Boolean(d && a),
        hunk: hi,
      });
    }
  }
}

function side(l: DiffLine, which: "o" | "n"): LineSide {
  return { no: (which === "o" ? l.o : l.n) ?? 0, text: l.s, type: l.t, nonl: l.nonl };
}

/** Indexes of rows that start a hunk (for j/k navigation). */
export function hunkStarts(rows: Row[]): number[] {
  const starts: number[] = [];
  let last = Number.NaN;
  rows.forEach((r, i) => {
    if (r.kind === "gap") {
      last = Number.NaN;
      return;
    }
    if (r.kind === "header") {
      if (r.hunk !== last) starts.push(i);
      last = r.hunk;
      return;
    }
    if (r.hunk >= 0 && r.hunk !== last) starts.push(i);
    if (r.hunk >= 0) last = r.hunk;
  });
  return starts;
}
