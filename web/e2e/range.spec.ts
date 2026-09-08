import { expect, test } from "@playwright/test";

test("shift-click selects a range; merge-base toggle switches to three-dot semantics", async ({ page }) => {
  await page.goto("/");
  const history = page.getByRole("listbox", { name: "History" });
  await history.getByText("c1: initial project").click();
  await history.getByText("c3: rename util").click({ modifiers: ["Shift"] });
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: /Range/ })).toContainText("..");
  // c1..c3 = c2 + c3 changes: app.ts, utils(rename), helper.py deleted, spaces, unicode, logo.png
  await expect(main.getByTestId("stat-files")).toHaveText("6");
  await expect(history.locator(".in-range")).toHaveCount(3);
  await main.getByRole("checkbox", { name: /merge base/ }).check();
  await expect(main.getByRole("heading", { name: /Range/ })).toContainText("…");
  await expect(main.getByTestId("stat-files")).toHaveText("6"); // linear history: same result
});

test("branch vs base preset compares a feature worktree against main since the merge base", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: /vs main/ })).toHaveCount(0);
  await page.getByRole("combobox").selectOption({ label: "wt-feature · feature" });
  await page.getByRole("button", { name: "feature vs main" }).click();
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: /Range/ })).toBeVisible();
  await expect(main.getByTestId("stat-files")).toHaveText("2");
  await expect(main.getByRole("tree")).toContainText("feature.ts");
});
