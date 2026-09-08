import { describe, expect, it } from "vitest";
import type { Commit } from "../api";
import { emptyLaneState, layoutLanes } from "./lanes";

const sig = { name: "a", email: "a@x", time: 0 };
const c = (sha: string, ...parents: string[]): Commit => ({
  sha,
  parents,
  author: sig,
  committer: sig,
  subject: sha,
});

describe("layoutLanes", () => {
  it("keeps a linear history in lane 0", () => {
    const { rows, state } = layoutLanes([c("c", "b"), c("b", "a"), c("a")]);
    expect(rows.map((r) => r.lane)).toEqual([0, 0, 0]);
    expect(rows[0]).toMatchObject({ incoming: [0], outgoing: [0], through: [], width: 1 });
    expect(rows[2].outgoing).toEqual([]);
    expect(state.active).toEqual([]);
  });

  it("opens a second lane for a merge and closes it at the fork point", () => {
    // m -> (b, t); b -> a; t -> a; a
    const { rows } = layoutLanes([c("m", "b", "t"), c("b", "a"), c("t", "a"), c("a")]);
    const [m, b, t, a] = rows;
    expect(m).toMatchObject({ lane: 0, outgoing: [0, 1], width: 2 });
    expect(b).toMatchObject({ lane: 0, outgoing: [0], through: [1] });
    expect(t).toMatchObject({ lane: 1, outgoing: [0], through: [0] });
    expect(a).toMatchObject({ lane: 0, incoming: [0], outgoing: [], width: 1 });
  });

  it("draws a converging edge when two lanes wait for the same commit", () => {
    // Two branch tips f and m both descend from a.
    const { rows } = layoutLanes([c("f", "a"), c("m", "a"), c("a")]);
    expect(rows[0]).toMatchObject({ lane: 0, outgoing: [0] });
    expect(rows[1]).toMatchObject({ lane: 1, outgoing: [0], through: [0] });
    expect(rows[2]).toMatchObject({ lane: 0, incoming: [0] });
  });

  it("handles octopus merges", () => {
    const { rows } = layoutLanes([c("o", "p1", "p2", "p3"), c("p1"), c("p2"), c("p3")]);
    expect(rows[0].outgoing).toEqual([0, 1, 2]);
    expect(rows[0].width).toBe(3);
    expect(rows[3]).toMatchObject({ lane: 2, width: 3 });
  });

  it("continues across pages using the returned state", () => {
    const all = [c("m", "b", "t"), c("b", "a"), c("t", "a"), c("a")];
    const whole = layoutLanes(all).rows;
    const p1 = layoutLanes(all.slice(0, 2), emptyLaneState());
    const p2 = layoutLanes(all.slice(2), p1.state);
    expect([...p1.rows, ...p2.rows]).toEqual(whole);
  });

  it("treats unknown parents (beyond the loaded window) as open lanes", () => {
    const { rows, state } = layoutLanes([c("x", "unseen")]);
    expect(rows[0].outgoing).toEqual([0]);
    expect(state.active).toEqual(["unseen"]);
  });
});
