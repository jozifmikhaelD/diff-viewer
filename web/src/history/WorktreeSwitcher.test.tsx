import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { worktreeFeature, worktreeMain } from "../test/fixtures";
import { WorktreeSwitcher } from "./WorktreeSwitcher";

describe("WorktreeSwitcher", () => {
  it("renders a plain label when there is a single worktree", () => {
    render(<WorktreeSwitcher worktrees={[worktreeMain]} value={worktreeMain.path} onChange={() => {}} />);
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByText("repo · main (main worktree)")).toBeInTheDocument();
  });

  it("lists worktrees with branch, marks detached and prunable ones, and emits changes", async () => {
    const detached = { ...worktreeFeature, path: "/work/wt-detached", branch: "", detached: true, head: "deadbeefcafe" };
    const prunable = { ...worktreeFeature, path: "/work/gone", prunable: true };
    const onChange = vi.fn();
    render(
      <WorktreeSwitcher worktrees={[worktreeMain, worktreeFeature, detached, prunable]} value={worktreeMain.path} onChange={onChange} />,
    );
    const options = screen.getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      "repo · main (main worktree)",
      "wt-feature · feature",
      "wt-detached · detached @ deadbee",
      "gone · feature",
    ]);
    expect(options[3]).toBeDisabled();
    await userEvent.setup().selectOptions(screen.getByRole("combobox"), "/work/wt-feature");
    expect(onChange).toHaveBeenCalledWith("/work/wt-feature");
  });
});
