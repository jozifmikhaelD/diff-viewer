import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RepoSwitcher } from "./RepoSwitcher";
import { mockFetch } from "./test/fetch";
import { repoInfo } from "./test/fixtures";
import { renderWithQuery } from "./test/render";

afterEach(() => vi.unstubAllGlobals());

describe("RepoSwitcher", () => {
  it("lists recent repos except the current one and opens by click or path", async () => {
    const calls = mockFetch({
      "/api/recent": { body: { recent: [{ path: "/work/repo", lastOpen: "2026-09-08T12:00:00Z" }, { path: "/work/other", lastOpen: "2026-09-08T11:00:00Z" }] } },
      "/api/fs/complete": { body: { dir: "/", entries: [], more: false } },
      "/api/open": { body: { ...repoInfo, root: "/work/other" } },
    });
    const onOpened = vi.fn();
    renderWithQuery(<RepoSwitcher current="/work/repo" onOpened={onOpened} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Open…" }));
    const dialog = await screen.findByRole("dialog", { name: "Open repository" });
    const list = await within(dialog).findByRole("list", { name: "Recent repositories" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    expect(within(list).getByText("other")).toBeInTheDocument();
    await user.click(within(list).getByRole("button", { name: /other/ }));
    await vi.waitFor(() => expect(onOpened).toHaveBeenCalled());
    expect(calls).toContain("/api/open");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open…" }));
    await user.type(await screen.findByRole("combobox", { name: "Repository path" }), "~/src/thing{Enter}");
    await vi.waitFor(() => expect(onOpened).toHaveBeenCalledTimes(2));
  });

  it("suggests directories for the typed path; Tab descends, Enter on a repo opens it", async () => {
    const calls = mockFetch({
      "/api/recent": { body: { recent: [] } },
      "/api/fs/complete": (url) => {
        const p = url.searchParams.get("path") ?? "";
        return p.endsWith("Dev/")
          ? { body: { dir: "/home/me/Dev/", entries: [{ name: "app", path: "/home/me/Dev/app", repo: true }, { name: "notes", path: "/home/me/Dev/notes", repo: false }], more: false } }
          : { body: { dir: "/home/me/", entries: [{ name: "Dev", path: "/home/me/Dev", repo: false }], more: false } };
      },
      "/api/open": { body: { ...repoInfo, root: "/home/me/Dev/app" } },
    });
    const onOpened = vi.fn();
    renderWithQuery(<RepoSwitcher current="/work/repo" onOpened={onOpened} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Open…" }));
    const input = await screen.findByRole("combobox", { name: "Repository path" });
    await user.type(input, "/home/me/D");
    const list = await screen.findByRole("listbox", { name: "Directories" });
    expect(within(list).getByRole("option", { name: /Dev/ })).toBeInTheDocument();
    await user.keyboard("{Tab}");
    expect(input).toHaveValue("/home/me/Dev/");
    await vi.waitFor(() => expect(within(screen.getByRole("listbox", { name: "Directories" })).getAllByRole("option")).toHaveLength(2));
    expect(screen.getByText("git repo")).toBeInTheDocument();
    await user.keyboard("{ArrowDown}{Enter}");
    await vi.waitFor(() => expect(onOpened).toHaveBeenCalled());
    expect(calls.filter((c) => c === "/api/open")).toHaveLength(1);
  });

  it("shows server errors and closes on Escape", async () => {
    mockFetch({
      "/api/recent": { body: { recent: [] } },
      "/api/fs/complete": { body: { dir: "/", entries: [], more: false } },
      "/api/open": { status: 400, body: { error: "/nope is not a git repository" } },
    });
    renderWithQuery(<RepoSwitcher current="/work/repo" onOpened={() => {}} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Open…" }));
    expect(await screen.findByText("No other recent repositories.")).toBeInTheDocument();
    await user.type(screen.getByRole("combobox", { name: "Repository path" }), "/nope{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("not a git repository");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
