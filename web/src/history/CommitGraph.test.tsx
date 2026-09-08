import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CommitGraph } from "./CommitGraph";
import { LANE_WIDTH, MAX_LANES, clampLane } from "./lanes";

describe("CommitGraph", () => {
  it("caps the drawn width and squeezes deep lanes into the last column", () => {
    const { container } = render(<CommitGraph row={{ sha: "x", lane: 25, incoming: [25], outgoing: [25], through: [3, 12, 19], width: 26 }} laneCount={26} />);
    const svg = container.querySelector("svg")!;
    expect(Number(svg.getAttribute("width"))).toBe(MAX_LANES * LANE_WIDTH);
    const circle = container.querySelector("circle")!;
    expect(Number(circle.getAttribute("cx"))).toBe((MAX_LANES - 1) * LANE_WIDTH + LANE_WIDTH / 2);
    // lanes 12 and 19 share the overflow column: only one through-line for it, plus lane 3
    expect(container.querySelectorAll("line")).toHaveLength(2);
    expect(clampLane(3)).toBe(3);
    expect(clampLane(99)).toBe(MAX_LANES - 1);
  });

  it("draws narrow graphs at their natural width", () => {
    const { container } = render(<CommitGraph row={{ sha: "x", lane: 0, incoming: [0], outgoing: [0], through: [], width: 2 }} laneCount={2} />);
    expect(Number(container.querySelector("svg")!.getAttribute("width"))).toBe(2 * LANE_WIDTH);
  });
});
