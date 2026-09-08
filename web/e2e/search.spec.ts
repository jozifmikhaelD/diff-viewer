import { expect, test } from "@playwright/test";

test("searching commits filters by message, author and jumps to a sha", async ({ page }) => {
  await page.goto("/");
  const history = page.getByRole("listbox", { name: "History" });
  await expect(history.getByRole("option")).toHaveCount(9);
  const box = page.getByRole("searchbox", { name: "Search commits" });
  await box.fill("feature");
  await expect(history.getByRole("option")).toHaveCount(3); // working tree + f1 + f2
  await expect(history.locator("svg.commit-graph")).toHaveCount(0); // no lanes for filtered lists
  await expect(history.locator(".commit-dot")).toHaveCount(2);
  await box.fill("author:nobody");
  await expect(history.getByText("No commits match.")).toBeVisible();
  await box.fill("branch:topic");
  await expect(history.getByText("t1: topic work")).toBeVisible();
  await expect(history.getByText("f2: document feature")).toHaveCount(0);
  const sha = await history.getByText("c2: add version").locator("..").locator(".commit-sha").textContent();
  await box.fill(sha!);
  await expect(history.getByRole("option").nth(1)).toContainText("c2: add version");
  await box.fill("");
  await expect(history.getByRole("option")).toHaveCount(9);
  await expect(history.locator("svg.commit-graph")).toHaveCount(8);
});
