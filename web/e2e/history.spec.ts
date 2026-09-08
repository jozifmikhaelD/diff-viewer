import { expect, test } from "@playwright/test";

test("history lists fixture commits with graph, refs and working-tree badges", async ({ page }) => {
  await page.goto("/");
  const history = page.getByRole("listbox", { name: "History" });
  await expect(history.getByRole("option")).toHaveCount(9); // working tree + 8 commits

  const wt = history.getByRole("option").first();
  await expect(wt).toContainText("Working tree");
  await expect(wt.getByText("1 staged")).toBeVisible();
  await expect(wt.getByText("1 unstaged")).toBeVisible();
  await expect(wt.getByText("1 untracked")).toBeVisible();

  await expect(history.getByText("m1: merge topic")).toBeVisible();
  await expect(history.locator(".ref-head", { hasText: "main" })).toBeVisible();
  await expect(history.locator(".ref-tag", { hasText: "v0.1.0" })).toBeVisible();
  await expect(history.locator("svg.commit-graph").first()).toBeVisible();

  await history.getByText("c3: rename util").click();
  await expect(page.getByRole("main").getByRole("heading", { name: /c3: rename util/ })).toBeVisible();
});

test("switching worktree shows that worktree's HEAD and a clean working tree", async ({ page }) => {
  await page.goto("/");
  const select = page.getByRole("combobox", { name: "Worktree" });
  await expect(select).toContainText("repo · main (main worktree)");
  await select.selectOption({ label: "wt-feature · feature" });

  const history = page.getByRole("listbox", { name: "History" });
  await expect(history.locator(".ref-head", { hasText: "feature" })).toBeVisible();
  await expect(history.getByRole("option").first().getByText("clean")).toBeVisible();
  await expect(history.getByText("f2: document feature")).toBeVisible();
});
