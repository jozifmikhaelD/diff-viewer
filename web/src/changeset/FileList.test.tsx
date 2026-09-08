import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { FileChange } from "../api";
import { useState } from "react";
import { FileList } from "./FileList";

type P = Omit<Parameters<typeof FileList>[0], "filter" | "onFilterChange">;
function Filtered(props: P) {
  const [filter, setFilter] = useState("");
  return <FileList {...props} filter={filter} onFilterChange={setFilter} />;
}

const files: FileChange[] = [
  { path: "src/utils.ts", oldPath: "src/util.ts", status: "R", similarity: 64, additions: 1, deletions: 1, binary: false },
  { path: "src/app.ts", status: "M", additions: 1, deletions: 1, binary: false },
  { path: "lib/helper.py", status: "D", additions: 0, deletions: 2, binary: false },
  { path: "assets/logo.png", status: "A", additions: 0, deletions: 0, binary: true },
  { path: "vendor/sub", status: "A", additions: 1, deletions: 0, binary: false, submodule: true },
  { path: "notes.txt", status: "?", additions: 1, deletions: 0, binary: false },
];

describe("FileList", () => {
  it("renders a tree with directory totals and file annotations", () => {
    render(<Filtered files={files} selectedPath={null} onSelect={() => {}} view="tree" onViewChange={() => {}} />);
    const items = screen.getAllByRole("treeitem");
    const dirs = items.filter((i) => i.classList.contains("dir-item")).map((i) => within(i).getByText(/^(assets|lib|src|vendor)$/).textContent);
    expect(dirs).toEqual(["assets", "lib", "src", "vendor"]);
    const src = items.find((i) => i.classList.contains("dir-item") && within(i).queryByText("src"));
    expect(src).toBeDefined();
    expect(within(src!).getByText("+2")).toBeInTheDocument();
    expect(within(src!).getByText("−2")).toBeInTheDocument();
    expect(screen.getByText("← src/util.ts")).toBeInTheDocument();
    expect(screen.getByText("binary")).toBeInTheDocument();
    expect(screen.getByText("submodule")).toBeInTheDocument();
    expect(screen.getByTitle("untracked")).toHaveTextContent("U");
    expect(screen.getByTitle("deleted")).toHaveTextContent("D");
  });

  it("collapses directories and switches to flat view", async () => {
    const onViewChange = vi.fn();
    const { rerender } = render(<Filtered files={files} selectedPath={null} onSelect={() => {}} view="tree" onViewChange={onViewChange} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^src/ }));
    expect(screen.queryByText("app.ts")).not.toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Flat" }));
    expect(onViewChange).toHaveBeenCalledWith("flat");
    rerender(<Filtered files={files} selectedPath={null} onSelect={() => {}} view="flat" onViewChange={onViewChange} />);
    expect(screen.getAllByRole("treeitem")).toHaveLength(6);
    expect(screen.getAllByText("src/")).toHaveLength(2);
  });

  it("filters, selects, and shows empty states", async () => {
    const onSelect = vi.fn();
    render(<Filtered files={files} selectedPath="src/app.ts" onSelect={onSelect} view="flat" onViewChange={() => {}} />);
    expect(screen.getByRole("treeitem", { selected: true })).toHaveAttribute("data-path", "src/app.ts");
    const user = userEvent.setup();
    await user.type(screen.getByRole("searchbox"), "util");
    expect(screen.getAllByRole("treeitem")).toHaveLength(1); // rename matches on old path
    await user.click(screen.getByRole("button", { name: /utils\.ts/ }));
    expect(onSelect).toHaveBeenCalledWith("src/utils.ts");
    await user.clear(screen.getByRole("searchbox"));
    await user.type(screen.getByRole("searchbox"), "zzz");
    expect(screen.getByText(/No files match/)).toBeInTheDocument();
  });

  it("double-clicking a file opens it", async () => {
    const onOpen = vi.fn();
    const onSelect = vi.fn();
    render(<Filtered files={files} selectedPath={null} onSelect={onSelect} onOpen={onOpen} view="flat" onViewChange={() => {}} />);
    await userEvent.setup().dblClick(screen.getByRole("button", { name: /app\.ts/ }));
    expect(onOpen).toHaveBeenCalledWith("src/app.ts");
    expect(onSelect).toHaveBeenCalled();
  });

  it("shows the no-changes state", () => {
    render(<Filtered files={[]} selectedPath={null} onSelect={() => {}} view="tree" onViewChange={() => {}} />);
    expect(screen.getByText("No changes.")).toBeInTheDocument();
  });
});
