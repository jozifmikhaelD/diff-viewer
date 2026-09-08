import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DepGraph } from "../api";
import { mockFetch } from "../test/fetch";
import { worktreeMain } from "../test/fixtures";
import { renderWithQuery } from "../test/render";
import { DepsMap } from "./DepsMap";

const graph: DepGraph = {
  nodes: [
    { path: "src/app.ts", changed: true, status: "M", additions: 3, deletions: 1, depth: 0 },
    { path: "src/utils.ts", changed: false, additions: 0, deletions: 0, depth: 1 },
    { path: "lib/helper.py", changed: true, status: "D", additions: 0, deletions: 2, depth: 0 },
  ],
  edges: [{ from: "src/app.ts", to: "src/utils.ts" }],
  truncated: false,
  indexed: 4,
};

afterEach(() => vi.unstubAllGlobals());

describe("DepsMap", () => {
  it("renders nodes, edges, legend and summary; clicking a changed node selects it", async () => {
    const calls = mockFetch({ "/api/deps": { body: graph } });
    const onSelect = vi.fn();
    renderWithQuery(
      <DepsMap worktree={worktreeMain} selector={{ commit: "abc" }} changedPaths={new Set(["src/app.ts", "lib/helper.py"])} selectedPath={null} onSelectPath={onSelect} size={{ width: 600, height: 400 }} />,
    );
    await waitFor(() => expect(document.querySelectorAll("g.node")).toHaveLength(3));
    expect(calls[0]).toBe("/api/deps?wt=%2Fwork%2Frepo&commit=abc&depth=1");
    expect(screen.getByText("2 changed · 1 neighbour · 1 import")).toBeInTheDocument();
    expect(document.querySelectorAll("line.dep-edge")).toHaveLength(1);
    expect(document.querySelectorAll("g.node.neighbour")).toHaveLength(1);
    expect(screen.getByRole("list", { name: "Directories" })).toHaveTextContent("lib");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /src\/app\.ts/ }));
    expect(onSelect).toHaveBeenCalledWith("src/app.ts");
    // unchanged neighbours are not buttons
    expect(screen.queryByRole("button", { name: /utils\.ts/ })).not.toBeInTheDocument();
  });

  it("hides neighbours and refetches when depth changes", async () => {
    const calls = mockFetch({ "/api/deps": { body: graph } });
    renderWithQuery(
      <DepsMap worktree={worktreeMain} selector={{ worktree: "all" }} changedPaths={new Set()} selectedPath={null} onSelectPath={() => {}} size={{ width: 600, height: 400 }} />,
    );
    await waitFor(() => expect(document.querySelectorAll("g.node")).toHaveLength(3));
    const user = userEvent.setup();
    await user.click(screen.getByRole("checkbox", { name: "Neighbours" }));
    await waitFor(() => expect(document.querySelectorAll("g.node")).toHaveLength(2));
    expect(document.querySelectorAll("line.dep-edge")).toHaveLength(0);
    fireEvent.change(screen.getByRole("slider", { name: "Neighbour depth" }), { target: { value: "2" } });
    await waitFor(() => expect(calls.some((c) => c.endsWith("depth=2"))).toBe(true));
  });

  it("explains when nothing could be indexed", async () => {
    mockFetch({ "/api/deps": { body: { nodes: [], edges: [], truncated: false, indexed: 0 } } });
    renderWithQuery(
      <DepsMap worktree={worktreeMain} selector={{ commit: "abc" }} changedPaths={new Set()} selectedPath={null} onSelectPath={() => {}} size={{ width: 600, height: 400 }} />,
    );
    expect(await screen.findByText(/No import statements could be resolved/)).toBeInTheDocument();
  });
});
