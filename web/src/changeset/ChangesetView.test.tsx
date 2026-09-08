import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Changeset } from "../api";
import { mockFetch } from "../test/fetch";
import { commits, worktreeMain } from "../test/fixtures";
import { renderWithQuery } from "../test/render";
import { ChangesetView } from "./ChangesetView";

const changeset: Changeset = {
  kind: "commit",
  from: "c2c2c2c2",
  to: "c3c3c3c3",
  files: [
    { path: "src/utils.ts", oldPath: "src/util.ts", status: "R", additions: 1, deletions: 1, binary: false },
    { path: "lib/helper.py", status: "D", additions: 0, deletions: 2, binary: false },
    { path: "README.md", status: "M", additions: 3, deletions: 0, binary: false },
  ],
  totals: { files: 3, additions: 4, deletions: 3 },
};

afterEach(() => vi.unstubAllGlobals());

describe("ChangesetView", () => {
  it("shows the commit header, totals, languages and files for a commit", async () => {
    const calls = mockFetch({
      "/api/changeset": { body: changeset },
      "/api/log": { body: { commits: [commits[3]], hasMore: false, skip: 0, limit: 1 } },
    });
    renderWithQuery(<ChangesetView worktree={worktreeMain} selection={{ kind: "commit", sha: "c3c3c3c3" }} selectedPath={null} onSelectPath={() => {}} />);
    expect(await screen.findByRole("heading", { name: "c3: rename util" })).toBeInTheDocument();
    expect(screen.getByTestId("stat-files")).toHaveTextContent("3");
    expect(screen.getByTestId("stat-additions")).toHaveTextContent("+4");
    expect(screen.getByTestId("stat-deletions")).toHaveTextContent("−3");
    const langs = screen.getByRole("list", { name: "Languages" });
    expect(within(langs).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Markdown1", "Python1", "TypeScript1"]);
    expect(screen.getAllByRole("treeitem").filter((i) => i.classList.contains("file-item"))).toHaveLength(3);
    expect(calls).toContain("/api/changeset?wt=%2Fwork%2Frepo&commit=c3c3c3c3");
  });

  it("offers worktree modes and refetches when switching", async () => {
    const calls = mockFetch({
      "/api/changeset": (url) => ({
        body: { ...changeset, kind: "worktree", files: url.searchParams.get("worktree") === "staged" ? changeset.files.slice(0, 1) : changeset.files, totals: { files: url.searchParams.get("worktree") === "staged" ? 1 : 3, additions: 1, deletions: 1 } },
      }),
    });
    renderWithQuery(<ChangesetView worktree={worktreeMain} selection={{ kind: "worktree" }} selectedPath={null} onSelectPath={() => {}} />);
    expect(await screen.findByRole("heading", { name: "Working tree" })).toBeInTheDocument();
    expect(await screen.findByTestId("stat-files")).toHaveTextContent("3");
    const staged = screen.getByRole("radio", { name: /Staged/ });
    expect(staged).toHaveTextContent("1"); // count from worktree status
    await userEvent.setup().click(staged);
    await waitFor(() => expect(screen.getByTestId("stat-files")).toHaveTextContent("1"));
    expect(calls).toContain("/api/changeset?wt=%2Fwork%2Frepo&worktree=staged");
  });

  it("reports selection and errors", async () => {
    mockFetch({ "/api/changeset": { status: 404, body: { error: "bad revision 'zzz'" } }, "/api/log": { body: { commits: [], hasMore: false, skip: 0, limit: 1 } } });
    renderWithQuery(<ChangesetView worktree={worktreeMain} selection={{ kind: "commit", sha: "zzz" }} selectedPath={null} onSelectPath={() => {}} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("bad revision");
  });
});
