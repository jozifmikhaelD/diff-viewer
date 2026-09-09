import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FileChange, FileDiff } from "../api";
import { mockFetch } from "../test/fetch";
import { worktreeMain } from "../test/fixtures";
import { renderWithQuery } from "../test/render";
import { DiffStream } from "./DiffStream";

const files: FileChange[] = [
  { path: "a.ts", status: "M", additions: 1, deletions: 0, binary: false },
  { path: "b.ts", status: "A", additions: 2, deletions: 0, binary: false },
  { path: "c.ts", status: "D", additions: 0, deletions: 3, binary: false },
];
const diffFor = (path: string): FileDiff => ({
  path,
  status: "M",
  binary: false,
  hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: [{ t: "+", s: `line of ${path}`, n: 1 }] }],
  old: [],
  new: [`line of ${path}`],
  hasOld: true,
  hasNew: true,
  truncated: false,
  oldSize: 0,
  newSize: 1,
});

afterEach(() => vi.unstubAllGlobals());

/** Positions the container at y=0 and each section at 300px intervals shifted by scrollTop. */
function layout(scrollTop: number) {
  const c = screen.getByTestId("diff-stream-scroll");
  c.getBoundingClientRect = () => ({ top: 0, left: 0, bottom: 500, right: 800, width: 800, height: 500, x: 0, y: 0, toJSON: () => ({}) });
  document.querySelectorAll<HTMLElement>("section[data-path]").forEach((s, i) => {
    const top = 40 + i * 300 - scrollTop;
    s.getBoundingClientRect = () => ({ top, left: 0, bottom: top + 300, right: 800, width: 800, height: 300, x: 0, y: top, toJSON: () => ({}) });
  });
  return c;
}

describe("DiffStream", () => {
  it("renders every file as a section and loads its diff", async () => {
    mockFetch({ "/api/diff": (url) => ({ body: diffFor(url.searchParams.get("path")!) }) });
    renderWithQuery(<DiffStream worktree={worktreeMain} selector={{ commit: "x" }} files={files} selectedPath="a.ts" onSelectPath={() => {}} mode="unified" onModeChange={() => {}} ignoreWhitespace={false} onIgnoreWhitespaceChange={() => {}} />);
    const sections = screen.getAllByRole("region", { name: /Diff for/ });
    expect(sections.map((s) => s.getAttribute("data-path"))).toEqual(["a.ts", "b.ts", "c.ts"]);
    await waitFor(() => expect(screen.getByText("line of c.ts")).toBeInTheDocument());
    expect(sections[0]).toHaveClass("current");
    expect(within(sections[1]).getByText("b.ts")).toBeInTheDocument();
  });

  it("reports the file under the reading line as you scroll", async () => {
    mockFetch({ "/api/diff": (url) => ({ body: diffFor(url.searchParams.get("path")!) }) });
    const onSelectPath = vi.fn();
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { setTimeout(() => cb(0), 0); return 1; });
    renderWithQuery(<DiffStream worktree={worktreeMain} selector={{ commit: "x" }} files={files} selectedPath="a.ts" onSelectPath={onSelectPath} mode="unified" onModeChange={() => {}} ignoreWhitespace={false} onIgnoreWhitespaceChange={() => {}} />);
    await waitFor(() => expect(screen.getByText("line of a.ts")).toBeInTheDocument());
    const c = layout(320); // second section's top is now at 20px, within the 56px offset
    fireEvent.scroll(c);
    await waitFor(() => expect(onSelectPath).toHaveBeenCalledWith("b.ts"));
    layout(650);
    fireEvent.scroll(c);
    await waitFor(() => expect(onSelectPath).toHaveBeenLastCalledWith("c.ts"));
  });

  it("scrolls to a file selected elsewhere", async () => {
    mockFetch({ "/api/diff": (url) => ({ body: diffFor(url.searchParams.get("path")!) }) });
    const { rerender } = renderWithQuery(<DiffStream worktree={worktreeMain} selector={{ commit: "x" }} files={files} selectedPath="a.ts" onSelectPath={() => {}} mode="unified" onModeChange={() => {}} ignoreWhitespace={false} onIgnoreWhitespaceChange={() => {}} />);
    await waitFor(() => expect(screen.getByText("line of a.ts")).toBeInTheDocument());
    const c = screen.getByTestId("diff-stream-scroll");
    const scrollTo = vi.fn();
    c.scrollTo = scrollTo;
    const target = document.querySelector<HTMLElement>('section[data-path="c.ts"]')!;
    Object.defineProperty(target, "offsetTop", { value: 640, configurable: true });
    Object.defineProperty(c, "offsetTop", { value: 40, configurable: true });
    rerender(<DiffStream worktree={worktreeMain} selector={{ commit: "x" }} files={files} selectedPath="c.ts" onSelectPath={() => {}} mode="unified" onModeChange={() => {}} ignoreWhitespace={false} onIgnoreWhitespaceChange={() => {}} />);
    expect(scrollTo).toHaveBeenCalledWith({ top: 600, behavior: "auto" });
    expect(target).toHaveClass("current");
  });
});
