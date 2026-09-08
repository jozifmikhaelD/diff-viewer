import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommitList } from "./CommitList";
import { mockFetch } from "../test/fetch";
import { commits, worktreeMain } from "../test/fixtures";
import { renderWithQuery } from "../test/render";

const rect = { width: 400, height: 600 };

afterEach(() => vi.unstubAllGlobals());

describe("CommitList", () => {
  it("renders commits with refs, author, short sha and working-tree badges", async () => {
    mockFetch({ "/api/log": { body: { commits, hasMore: false, skip: 0, limit: 200 } } });
    const onSelect = vi.fn();
    renderWithQuery(<CommitList worktree={worktreeMain} selection={null} onSelect={onSelect} testRect={rect} />);

    await screen.findByText("m1: merge topic");
    const rows = screen.getAllByRole("option");
    // working tree + 6 commits
    expect(rows).toHaveLength(7);
    const wt = rows[0];
    expect(wt).toHaveTextContent("Working tree");
    expect(within(wt).getByText("1 staged")).toBeInTheDocument();
    expect(within(wt).getByText("2 unstaged")).toBeInTheDocument();
    expect(within(wt).getByText("3 untracked")).toBeInTheDocument();

    const merge = rows[1];
    expect(merge).toHaveTextContent("m1: merge topic");
    expect(within(merge).getByText("main")).toHaveClass("ref-head");
    expect(within(merge).getByText("m1m1m1m")).toBeInTheDocument();
    expect(within(merge).getByText("Fixture Author")).toBeInTheDocument();
    expect(within(rows[4]).getByText("v0.1.0")).toHaveClass("ref-tag");
    // graph svg present on commit rows only
    expect(merge.querySelector("svg.commit-graph")).not.toBeNull();
    expect(wt.querySelector("svg.commit-graph")).toBeNull();
  });

  it("reports selection of commits and the working tree", async () => {
    mockFetch({ "/api/log": { body: { commits, hasMore: false, skip: 0, limit: 200 } } });
    const onSelect = vi.fn();
    renderWithQuery(
      <CommitList worktree={worktreeMain} selection={{ kind: "commit", sha: "c4c4c4c4" }} onSelect={onSelect} testRect={rect} />,
    );
    await screen.findByText("c4: add submodule");
    const rows = screen.getAllByRole("option");
    expect(rows[3]).toHaveAttribute("aria-selected", "true");
    const user = userEvent.setup();
    await user.click(rows[2]);
    expect(onSelect).toHaveBeenCalledWith({ kind: "commit", sha: "t1t1t1t1" });
    await user.click(rows[0]);
    expect(onSelect).toHaveBeenCalledWith({ kind: "worktree" });
  });

  it("fetches the next page when the loader row becomes visible", async () => {
    const page1 = commits.slice(0, 3);
    const page2 = commits.slice(3);
    const calls = mockFetch({
      "/api/log": (url) =>
        url.searchParams.get("skip") === "3"
          ? { body: { commits: page2, hasMore: false, skip: 3, limit: 3 } }
          : { body: { commits: page1, hasMore: true, skip: 0, limit: 3 } },
    });
    renderWithQuery(<CommitList worktree={worktreeMain} selection={null} onSelect={() => {}} pageSize={3} testRect={rect} />);
    await waitFor(() => expect(screen.getByText("c1: initial project")).toBeInTheDocument());
    expect(calls.filter((c) => c.startsWith("/api/log"))).toHaveLength(2);
    expect(screen.queryByText("Loading more…")).not.toBeInTheDocument();
  });

  it("shows the empty state and errors", async () => {
    mockFetch({ "/api/log": { status: 500, body: { error: "bad object" } } });
    renderWithQuery(<CommitList worktree={worktreeMain} selection={null} onSelect={() => {}} testRect={rect} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("bad object");
  });
});
