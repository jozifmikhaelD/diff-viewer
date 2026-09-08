import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";

function mockFetch(routes: Record<string, { status?: number; body: unknown }>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      const route = routes[url];
      if (!route) throw new Error(`unexpected fetch ${url}`);
      const status = route.status ?? 200;
      return new Response(JSON.stringify(route.body), {
        status,
        statusText: status === 200 ? "OK" : "Error",
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("App", () => {
  it("shows the repository root once the API responds", async () => {
    mockFetch({
      "/api/health": { body: { ok: true, version: "1.2.3" } },
      "/api/repo": {
        body: { root: "/work/repo", gitDir: "/work/repo/.git", commonDir: "/work/repo/.git", linkedWorktree: false },
      },
    });
    render(<App />);
    expect(screen.getByRole("status")).toHaveTextContent("Connecting");
    expect(await screen.findByTestId("repo-root")).toHaveTextContent("/work/repo");
    expect(screen.getByText("v1.2.3")).toBeInTheDocument();
    expect(screen.queryByText("Worktree of")).not.toBeInTheDocument();
  });

  it("shows the main repo for a linked worktree", async () => {
    mockFetch({
      "/api/health": { body: { ok: true, version: "dev" } },
      "/api/repo": {
        body: {
          root: "/work/wt",
          gitDir: "/work/repo/.git/worktrees/wt",
          commonDir: "/work/repo/.git",
          linkedWorktree: true,
        },
      },
    });
    render(<App />);
    expect(await screen.findByText("Worktree of")).toBeInTheDocument();
    expect(screen.getByText("/work/repo/.git")).toBeInTheDocument();
  });

  it("surfaces API errors", async () => {
    mockFetch({
      "/api/health": { body: { ok: true, version: "dev" } },
      "/api/repo": { status: 500, body: { error: "git exploded" } },
    });
    render(<App />);
    expect(await screen.findByRole("alert")).toHaveTextContent("git exploded");
  });
});
