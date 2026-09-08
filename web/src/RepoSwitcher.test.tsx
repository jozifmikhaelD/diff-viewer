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
    await user.type(await screen.findByRole("textbox", { name: "Repository path" }), "~/src/thing{Enter}");
    await vi.waitFor(() => expect(onOpened).toHaveBeenCalledTimes(2));
  });

  it("shows server errors and closes on Escape", async () => {
    mockFetch({
      "/api/recent": { body: { recent: [] } },
      "/api/open": { status: 400, body: { error: "/nope is not a git repository" } },
    });
    renderWithQuery(<RepoSwitcher current="/work/repo" onOpened={() => {}} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Open…" }));
    expect(await screen.findByText("No other recent repositories.")).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "Repository path" }), "/nope{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("not a git repository");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
