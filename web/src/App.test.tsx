import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { mockFetch } from "./test/fetch";
import { commits, repoInfo } from "./test/fixtures";
import { renderWithQuery } from "./test/render";

afterEach(() => vi.unstubAllGlobals());

describe("App", () => {
  it("shows the worktree switcher, history, and the repo root", async () => {
    const calls = mockFetch({
      "/api/health": { body: { ok: true, version: "1.2.3" } },
      "/api/repo": { body: repoInfo },
      "/api/log": { body: { commits, hasMore: false, skip: 0, limit: 200 } },
    });
    renderWithQuery(<App />);
    expect(await screen.findByRole("combobox")).toHaveValue("/work/repo");
    expect(screen.getByText("v1.2.3")).toBeInTheDocument();
    expect(screen.getByTitle("/work/repo")).toBeInTheDocument();
    const history = screen.getByRole("listbox", { name: "History" });
    expect(within(history).getByText("Working tree")).toBeInTheDocument();
    expect(calls.some((c) => c.startsWith("/api/log?wt=%2Fwork%2Frepo"))).toBe(true);
  });

  it("switching worktree reloads history for that worktree and clears the selection", async () => {
    const calls = mockFetch({
      "/api/health": { body: { ok: true, version: "dev" } },
      "/api/repo": { body: repoInfo },
      "/api/log": { body: { commits: [], hasMore: false, skip: 0, limit: 200 } },
    });
    renderWithQuery(<App />);
    const select = await screen.findByRole("combobox");
    const user = userEvent.setup();
    await user.click(screen.getByText("Working tree"));
    expect(screen.getByText(/Working tree selected/)).toBeInTheDocument();
    await user.selectOptions(select, "/work/wt-feature");
    expect(select).toHaveValue("/work/wt-feature");
    expect(await screen.findByText(/Select a commit/)).toBeInTheDocument();
    expect(calls.some((c) => c.startsWith("/api/log?wt=%2Fwork%2Fwt-feature"))).toBe(true);
  });

  it("surfaces API errors", async () => {
    mockFetch({
      "/api/health": { body: { ok: true, version: "dev" } },
      "/api/repo": { status: 500, body: { error: "git exploded" } },
    });
    renderWithQuery(<App />);
    expect(await screen.findByRole("alert")).toHaveTextContent("git exploded");
  });
});
