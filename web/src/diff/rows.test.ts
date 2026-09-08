import { describe, expect, it } from "vitest";
import type { FileDiff } from "../api";
import { buildRows, hunkStarts, type GapRow, type LineRow } from "./rows";

const oldLines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
const newLines = [...oldLines];
newLines[4] = "line 5 changed";
newLines.splice(20, 0, "inserted");

const fd: FileDiff = {
  path: "f.txt",
  status: "M",
  binary: false,
  hunks: [
    {
      oldStart: 2,
      oldLines: 7,
      newStart: 2,
      newLines: 7,
      header: "fn a",
      lines: [
        { t: " ", s: "line 2", o: 2, n: 2 },
        { t: " ", s: "line 3", o: 3, n: 3 },
        { t: " ", s: "line 4", o: 4, n: 4 },
        { t: "-", s: "line 5", o: 5 },
        { t: "+", s: "line 5 changed", n: 5 },
        { t: " ", s: "line 6", o: 6, n: 6 },
        { t: " ", s: "line 7", o: 7, n: 7 },
        { t: " ", s: "line 8", o: 8, n: 8 },
      ],
    },
    {
      oldStart: 18,
      oldLines: 6,
      newStart: 18,
      newLines: 7,
      lines: [
        { t: " ", s: "line 18", o: 18, n: 18 },
        { t: " ", s: "line 19", o: 19, n: 19 },
        { t: " ", s: "line 20", o: 20, n: 20 },
        { t: "+", s: "inserted", n: 21 },
        { t: " ", s: "line 21", o: 21, n: 22 },
        { t: " ", s: "line 22", o: 22, n: 23 },
        { t: " ", s: "line 23", o: 23, n: 24 },
      ],
    },
  ],
  old: oldLines,
  new: newLines,
  hasOld: true,
  hasNew: true,
  truncated: false,
  oldSize: 1,
  newSize: 1,
};

describe("buildRows", () => {
  it("interleaves gaps, headers and paired lines", () => {
    const rows = buildRows(fd);
    const kinds = rows.map((r) => r.kind);
    expect(kinds[0]).toBe("gap"); // line 1 before first hunk
    expect(kinds[1]).toBe("header");
    const gaps = rows.filter((r): r is GapRow => r.kind === "gap");
    expect(gaps.map((g) => [g.oldStart, g.oldEnd, g.count, g.expandable])).toEqual([
      [1, 1, 1, true],
      [9, 17, 9, true],
      [24, 30, 7, true],
    ]);
    const paired = rows.find((r): r is LineRow => r.kind === "line" && r.paired);
    expect(paired?.old?.text).toBe("line 5");
    expect(paired?.new?.text).toBe("line 5 changed");
    const insert = rows.find((r): r is LineRow => r.kind === "line" && !r.old && r.new?.text === "inserted");
    expect(insert?.new?.no).toBe(21);
  });

  it("expands gaps from the top and bottom using file content", () => {
    const rows = buildRows(fd, { 1: { up: 2, down: 3 } });
    const idx = rows.findIndex((r) => r.kind === "gap" && r.id === 1);
    const before = rows.slice(idx - 2, idx) as LineRow[];
    expect(before.map((r) => r.old?.no)).toEqual([9, 10]);
    expect(before.map((r) => r.new?.text)).toEqual(["line 9", "line 10"]);
    const gap = rows[idx] as GapRow;
    expect([gap.oldStart, gap.oldEnd, gap.count]).toEqual([11, 14, 4]);
    const after = rows.slice(idx + 1, idx + 4) as LineRow[];
    expect(after.map((r) => r.old?.no)).toEqual([15, 16, 17]);
  });

  it("removes a gap entirely once fully expanded", () => {
    const rows = buildRows(fd, { 0: { up: 5, down: 0 }, 2: { up: 0, down: 100 } });
    expect(rows.filter((r) => r.kind === "gap").map((r) => (r as GapRow).id)).toEqual([1]);
    const last = rows[rows.length - 1] as LineRow;
    expect(last.old?.no).toBe(30);
  });

  it("marks gaps non-expandable without content and sizes the trailing gap from hunks", () => {
    const rows = buildRows({ ...fd, old: null, new: null, truncated: true });
    const gaps = rows.filter((r): r is GapRow => r.kind === "gap");
    expect(gaps.every((g) => !g.expandable)).toBe(true);
    expect(gaps).toHaveLength(2); // trailing gap unknown without content
  });

  it("handles pure additions (new file) and deletions", () => {
    const added: FileDiff = { ...fd, status: "A", hunks: [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: 2, lines: [{ t: "+", s: "a", n: 1 }, { t: "+", s: "b", n: 2 }] }], old: null, new: ["a", "b"], hasOld: false };
    const rows = buildRows(added);
    expect(rows.filter((r) => r.kind === "gap")).toHaveLength(0);
    expect(rows.filter((r) => r.kind === "line")).toHaveLength(2);
  });

  it("reports hunk start indexes for navigation", () => {
    const rows = buildRows(fd);
    const starts = hunkStarts(rows);
    expect(starts).toHaveLength(2);
    expect(rows[starts[0]].kind).toBe("header");
    expect((rows[starts[1]] as LineRow).old?.no).toBe(18);
  });
});
