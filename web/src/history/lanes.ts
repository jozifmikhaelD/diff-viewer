import type { Commit } from "../api";

/**
 * Lane layout for a commit graph. Commits must be in topological order
 * (every parent after its children), which the server guarantees.
 *
 * Each row records: the lane its node sits in, lanes flowing into the node
 * from the row above (its own lane plus any that were waiting for this
 * commit), lanes flowing out of the node to the row below (one per parent),
 * and lanes that pass straight through untouched.
 */
export interface LaneRow {
  sha: string;
  lane: number;
  incoming: number[];
  outgoing: number[];
  through: number[];
  /** Number of lanes in use across this row (max of before/after). */
  width: number;
}

export interface LaneState {
  /** lane index -> sha the lane is waiting for (null = free) */
  active: (string | null)[];
}

export function emptyLaneState(): LaneState {
  return { active: [] };
}

/** Lays out `commits` continuing from `state`; returns rows and the new state. */
export function layoutLanes(
  commits: readonly Commit[],
  state: LaneState = emptyLaneState(),
): { rows: LaneRow[]; state: LaneState } {
  const active = [...state.active];
  const rows: LaneRow[] = [];

  for (const c of commits) {
    const before = [...active];
    let lane = active.indexOf(c.sha);
    if (lane === -1) {
      lane = firstFree(active);
      active[lane] = c.sha;
    }
    const incoming = [lane];
    for (let j = 0; j < active.length; j++) {
      if (j !== lane && active[j] === c.sha) {
        incoming.push(j);
        active[j] = null;
      }
    }
    // Node consumed its lane; the first parent will normally reclaim it.
    active[lane] = null;

    const outgoing: number[] = [];
    for (const p of c.parents) {
      let target = active.indexOf(p);
      if (target === -1) {
        target = active[lane] === null && !outgoing.includes(lane) ? lane : firstFree(active);
        active[target] = p;
      }
      if (!outgoing.includes(target)) outgoing.push(target);
    }

    const through: number[] = [];
    for (let j = 0; j < before.length; j++) {
      if (j !== lane && before[j] !== null && before[j] !== c.sha && active[j] === before[j]) {
        through.push(j);
      }
    }
    trimFree(active);
    rows.push({
      sha: c.sha,
      lane,
      incoming,
      outgoing,
      through,
      width: Math.max(before.length, active.length, lane + 1),
    });
  }
  return { rows, state: { active } };
}

function firstFree(active: (string | null)[]): number {
  const i = active.indexOf(null);
  if (i !== -1) return i;
  active.push(null);
  return active.length - 1;
}

function trimFree(active: (string | null)[]): void {
  while (active.length > 0 && active[active.length - 1] === null) active.pop();
}

export const LANE_COLORS = [
  "#5b5bd6",
  "#d6409f",
  "#f76b15",
  "#30a46c",
  "#0090ff",
  "#e5484d",
  "#8e4ec6",
  "#ffb224",
];

export function laneColor(lane: number): string {
  return LANE_COLORS[lane % LANE_COLORS.length];
}

export const LANE_WIDTH = 14;
export const ROW_HEIGHT = 30;
/** Lanes beyond this are drawn squeezed into the last column so the graph never crowds out the text. */
export const MAX_LANES = 10;

/** Visible lane index for a logical lane (clamped to the last drawn column). */
export function clampLane(lane: number): number {
  return Math.min(lane, MAX_LANES - 1);
}
