import { expect, test } from "@playwright/test";

test("the dependency map shows changed files, their imports, and neighbours; clicking a node opens its diff", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("combobox", { name: "Worktree" }).selectOption({ label: "wt-feature · feature" });
  await page.getByRole("button", { name: "feature vs main" }).click();
  const main = page.getByRole("main");
  await main.getByRole("radio", { name: "Map" }).click();
  const map = main.getByRole("region", { name: "Dependency map" });
  await expect(map).toBeVisible();
  // feature.ts + README.md changed; feature.ts imports app.ts (unchanged neighbour)
  await expect(map.locator("g.node")).toHaveCount(3);
  await expect(map.locator("g.node.neighbour")).toHaveCount(1);
  await expect(map.locator('line.dep-edge[data-from="src/feature.ts"][data-to="src/app.ts"]')).toHaveCount(1);
  await expect(map.getByText("2 changed · 1 neighbour · 1 import")).toBeVisible();

  await map.getByRole("checkbox", { name: "Neighbours" }).uncheck();
  await expect(map.locator("g.node")).toHaveCount(2);

  await map.getByRole("button", { name: /src\/feature\.ts/ }).click();
  await expect(main.getByRole("region", { name: "Diff for src/feature.ts" })).toBeVisible();
});

test("m toggles the map and depth 2 reaches second-order neighbours", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("listbox", { name: "History" }).getByText("c3: rename util").click();
  const main = page.getByRole("main");
  await main.getByRole("region", { name: /Diff for/ }).waitFor();
  await page.keyboard.press("m");
  const map = main.getByRole("region", { name: "Dependency map" });
  await expect(map).toBeVisible();
  // c3: app.ts -> utils.ts edge among the 5 changed files
  await expect(map.locator('line.dep-edge[data-from="src/app.ts"][data-to="src/utils.ts"]')).toHaveCount(1);
  await expect(map.getByRole("list", { name: "Directories" })).toContainText("src");
  await page.keyboard.press("m");
  await expect(main.getByRole("region", { name: /Diff for/ })).toBeVisible();
});
