import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DepGraph } from "../api";
import { mockFetch } from "../test/fetch";
import { worktreeMain } from "../test/fixtures";
import { renderWithQuery } from "../test/render";
import { FlowView } from "./FlowView";

const graph: DepGraph = {
  nodes: [
    { path: "src/pages/home.tsx", changed: true, status: "M", additions: 3, deletions: 1, depth: 0 },
    { path: "src/components/card.tsx", changed: true, status: "A", additions: 20, deletions: 0, depth: 0 },
    { path: "src/lib/api.ts", changed: false, additions: 0, deletions: 0, depth: 1 },
  ],
  edges: [
    { from: "src/pages/home.tsx", to: "src/components/card.tsx" },
    { from: "src/components/card.tsx", to: "src/lib/api.ts" },
  ],
  truncated: false,
  indexed: 3,
};

afterEach(() => vi.unstubAllGlobals());

describe("FlowView", () => {
  it("lays files out in layers with labels, edges and click-through", async () => {
    mockFetch({ "/api/deps": { body: graph } });
    const onSelect = vi.fn();
    renderWithQuery(
      <FlowView
        worktree={worktreeMain}
        selector={{ commit: "abc" }}
        changedPaths={new Set(["src/pages/home.tsx", "src/components/card.tsx"])}
        selectedPath={null}
        onSelectPath={onSelect}
        size={{ width: 800, height: 400 }}
      />,
    );
    await waitFor(() => expect(document.querySelectorAll("g.flow-node")).toHaveLength(3));
    const layers = screen.getAllByTestId("flow-layer").map((l) => l.textContent);
    expect(layers).toEqual(["pages · 1", "components · 1", "lib · 1"]);
    expect(screen.getByText("src/")).toBeInTheDocument(); // shared prefix shown once
    expect(document.querySelector('g.flow-node[data-path="src/lib/api.ts"] .flow-dir')).toHaveTextContent("lib");
    expect(document.querySelectorAll("path.flow-edge")).toHaveLength(2);
    const home = document.querySelector('g.flow-node[data-path="src/pages/home.tsx"]')!;
    const api = document.querySelector('g.flow-node[data-path="src/lib/api.ts"]')!;
    const x = (el: Element) => Number(/translate\(([\d.]+)/.exec(el.getAttribute("transform")!)![1]);
    expect(x(home)).toBeLessThan(x(api));
    await userEvent.setup().click(screen.getByRole("button", { name: /home\.tsx/ }));
    expect(onSelect).toHaveBeenCalledWith("src/pages/home.tsx");
    expect(screen.queryByRole("button", { name: /api\.ts/ })).not.toBeInTheDocument();
  });

  it("zooms in and out with the buttons and refits", async () => {
    mockFetch({ "/api/deps": { body: graph } });
    renderWithQuery(
      <FlowView worktree={worktreeMain} selector={{ commit: "abc" }} changedPaths={new Set()} selectedPath={null} onSelectPath={() => {}} size={{ width: 800, height: 400 }} />,
    );
    await waitFor(() => expect(document.querySelectorAll("g.flow-node")).toHaveLength(3));
    const scale = () => Number(/scale\(([\d.]+)\)/.exec(document.querySelector("svg > g")!.getAttribute("transform") ?? "scale(1)")?.[1] ?? 1);
    const before = scale();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    await waitFor(() => expect(scale()).toBeGreaterThan(before));
    await user.click(screen.getByRole("button", { name: "Zoom out" }));
    await waitFor(() => expect(scale()).toBeCloseTo(before, 3));
    await user.click(screen.getByRole("button", { name: "Fit" }));
    await waitFor(() => expect(scale()).toBeCloseTo(before, 3));
  });

  it("copies a Mermaid diagram", async () => {
    mockFetch({ "/api/deps": { body: graph } });
    const user = userEvent.setup(); // installs a clipboard stub
    renderWithQuery(
      <FlowView worktree={worktreeMain} selector={{ commit: "abc" }} changedPaths={new Set()} selectedPath={null} onSelectPath={() => {}} size={{ width: 800, height: 400 }} />,
    );
    await waitFor(() => expect(document.querySelectorAll("g.flow-node")).toHaveLength(3));
    await user.click(screen.getByRole("button", { name: "Copy as Mermaid" }));
    const text = await waitFor(async () => {
      const t = await navigator.clipboard.readText();
      expect(t).toContain("flowchart LR");
      return t;
    });
    expect(text).toContain("flowchart LR");
    expect(text).toContain("home.tsx (M +3 -1)");
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
  });
});
