import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FileChange, FileDiff } from "../api";
import { mockFetch } from "../test/fetch";
import { worktreeMain } from "../test/fixtures";
import { renderWithQuery } from "../test/render";
import { DiffView } from "./DiffView";

const file: FileChange = { path: "src/utils.ts", oldPath: "src/util.ts", status: "R", additions: 1, deletions: 1, binary: false };
const oldLines = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "export function greet(name: string): string {", "  return `hello ${name}`;", "}"];
const newLines = [...oldLines.slice(0, 11), "  return `hi ${name}`;", "}"];
const fd: FileDiff = {
  path: "src/utils.ts",
  oldPath: "src/util.ts",
  status: "R",
  binary: false,
  hunks: [
    {
      oldStart: 11,
      oldLines: 3,
      newStart: 11,
      newLines: 3,
      header: "export function greet",
      lines: [
        { t: " ", s: oldLines[10], o: 11, n: 11 },
        { t: "-", s: oldLines[11], o: 12 },
        { t: "+", s: newLines[11], n: 12 },
        { t: " ", s: "}", o: 13, n: 13, nonl: true },
      ],
    },
  ],
  old: oldLines,
  new: newLines,
  hasOld: true,
  hasNew: true,
  truncated: false,
  oldSize: 10,
  newSize: 10,
};

const noop = () => {};
afterEach(() => vi.unstubAllGlobals());

function renderDiff(mode: "unified" | "split" = "unified", ws = false, onMode = noop, onWs = noop) {
  return renderWithQuery(
    <DiffView worktree={worktreeMain} selector={{ commit: "c3c3c3c3" }} file={file} mode={mode} onModeChange={onMode} ignoreWhitespace={ws} onIgnoreWhitespaceChange={onWs} />,
  );
}

describe("DiffView", () => {
  it("renders a unified diff with line numbers, word highlights, gap and no-newline marker", async () => {
    const calls = mockFetch({ "/api/diff": { body: fd } });
    renderDiff();
    const table = await screen.findByRole("table");
    expect(calls[0]).toBe("/api/diff?wt=%2Fwork%2Frepo&commit=c3c3c3c3&path=src%2Futils.ts&oldPath=src%2Futil.ts");
    expect(screen.getByRole("heading", { name: /src\/util\.ts → src\/utils\.ts/ })).toBeInTheDocument();
    expect(within(table).getByText("@@ export function greet")).toBeInTheDocument();
    const del = table.querySelector("tr.del")!;
    expect(del).toHaveTextContent("12");
    expect(within(del as HTMLElement).getByText("hello")).toHaveClass("chg");
    const add = table.querySelector("tr.add")!;
    expect(within(add as HTMLElement).getByText("hi")).toHaveClass("chg");
    expect(screen.getByTitle("No newline at end of file")).toBeInTheDocument();
    expect(screen.getByText("10 unchanged lines")).toBeInTheDocument();
  });

  it("expands gaps stepwise and fully", async () => {
    mockFetch({ "/api/diff": { body: fd } });
    renderDiff();
    await screen.findByRole("table");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Expand down" }));
    // gap of 10 fully consumed by a 20-line step
    expect(screen.queryByText(/unchanged lines/)).not.toBeInTheDocument();
    expect(screen.getAllByRole("row").filter((r) => r.classList.contains("ctx"))).toHaveLength(12);
  });

  it("renders side by side with paired rows and empty cells", async () => {
    mockFetch({ "/api/diff": { body: fd } });
    renderDiff("split");
    const table = await screen.findByRole("table");
    expect(table).toHaveClass("split");
    const paired = table.querySelector("tr[data-key]")!.parentElement!.querySelectorAll("tr.line");
    expect(paired).toHaveLength(3); // ctx, paired change, ctx
    const change = paired[1];
    expect(change.querySelector("td.code.del")).toHaveTextContent("hello");
    expect(change.querySelector("td.code.add")).toHaveTextContent("hi");
  });

  it("toggles layout and whitespace via callbacks and refetches with ws=1", async () => {
    const calls = mockFetch({ "/api/diff": { body: fd } });
    const onMode = vi.fn();
    const onWs = vi.fn();
    const { rerender } = renderDiff("unified", false, onMode, onWs);
    await screen.findByRole("table");
    const user = userEvent.setup();
    await user.click(screen.getByRole("radio", { name: "Side by side" }));
    expect(onMode).toHaveBeenCalledWith("split");
    await user.click(screen.getByRole("checkbox", { name: /Ignore whitespace/ }));
    expect(onWs).toHaveBeenCalledWith(true);
    rerender(
      <DiffView worktree={worktreeMain} selector={{ commit: "c3c3c3c3" }} file={file} mode="unified" onModeChange={onMode} ignoreWhitespace onIgnoreWhitespaceChange={onWs} />,
    );
    await screen.findByRole("table");
    expect(calls.some((c) => c.endsWith("&ws=1"))).toBe(true);
  });

  it("shows binary, submodule and empty states", async () => {
    mockFetch({
      "/api/diff": (url) =>
        url.searchParams.get("path") === "logo.png"
          ? { body: { ...fd, path: "logo.png", binary: true, hunks: [], old: null, new: null, hasOld: false, hasNew: true, newSize: 2048 } }
          : { body: { ...fd, hunks: [], submodule: true, old: null, new: null } },
    });
    const { unmount } = renderWithQuery(
      <DiffView worktree={worktreeMain} selector={{ commit: "x" }} file={{ ...file, path: "logo.png", oldPath: undefined, binary: true }} mode="unified" onModeChange={noop} ignoreWhitespace={false} onIgnoreWhitespaceChange={noop} />,
    );
    expect(await screen.findByText("Binary file added (2.0 KB).")).toBeInTheDocument();
    unmount();
    renderDiff();
    expect(await screen.findByText("Submodule pointer changed.")).toBeInTheDocument();
  });

  it("navigates hunks with j/k without stealing keys from inputs", async () => {
    mockFetch({ "/api/diff": { body: fd } });
    renderDiff();
    await screen.findByRole("table");
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    fireEvent.keyDown(window, { key: "j" });
    expect(scroll).toHaveBeenCalledTimes(1);
    const input = document.createElement("input");
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: "j" });
    expect(scroll).toHaveBeenCalledTimes(1);
  });
});
