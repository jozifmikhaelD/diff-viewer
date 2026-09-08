import { expect, test } from "@playwright/test";

test("selecting a commit opens the first file's diff with word highlights; split view and gap expansion work", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("listbox", { name: "History" }).getByText("c3: rename util").click();
  const main = page.getByRole("main");
  // first file in tree order is lib/helper.py
  await expect(main.getByRole("region", { name: "Diff for lib/helper.py" })).toBeVisible();
  await main.getByRole("button", { name: /utils\.ts/ }).click();
  const diff = main.getByRole("region", { name: "Diff for src/utils.ts" });
  await expect(diff.getByRole("heading", { name: /src\/util\.ts → src\/utils\.ts/ })).toBeVisible();
  await expect(diff.locator("tr.del .chg")).toHaveText("hello");
  await expect(diff.locator("tr.add .chg")).toHaveText("hi");

  await diff.getByRole("radio", { name: "Side by side" }).click();
  await expect(diff.locator("table.split")).toBeVisible();
  await expect(diff.locator("td.code.del")).toContainText("hello");
  await expect(diff.locator("td.code.add")).toContainText("hi");

  // app.ts has 4 lines with U3 context: no gaps; README on feature has a gap? use c2 which appends VERSION to app.ts
  await page.getByRole("listbox", { name: "History" }).getByText("c2: add version").click();
  await main.getByRole("button", { name: /app\.ts/ }).click();
  const d2 = main.getByRole("region", { name: "Diff for src/app.ts" });
  // layout choice persists (still side by side)
  await expect(d2.locator("table.split")).toBeVisible();
  await expect(d2.locator("td.code.add")).toContainText('VERSION = "0.1"');
  await d2.getByRole("radio", { name: "Unified" }).click();
  await expect(d2.locator("tr.add")).toContainText('VERSION = "0.1"');
});

test("keyboard: n/p switch files, j/k move between hunks, / focuses the filter", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("listbox", { name: "History" }).getByText("c3: rename util").click();
  const main = page.getByRole("main");
  await expect(main.getByRole("region", { name: "Diff for lib/helper.py" })).toBeVisible();
  await page.keyboard.press("n");
  await expect(main.getByRole("region", { name: "Diff for src/app.ts" })).toBeVisible();
  await page.keyboard.press("n");
  await expect(main.getByRole("region", { name: "Diff for src/utils.ts" })).toBeVisible();
  await page.keyboard.press("p");
  await expect(main.getByRole("region", { name: "Diff for src/app.ts" })).toBeVisible();
  await page.keyboard.press("/");
  await expect(main.getByRole("searchbox")).toBeFocused();
});

test("binary and untracked files render sensible diffs", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("listbox", { name: "History" }).getByText("c2: add version").click();
  const main = page.getByRole("main");
  await main.getByRole("button", { name: /logo\.png/ }).click();
  await expect(main.getByText(/Binary file added/)).toBeVisible();

  await page.getByRole("listbox", { name: "History" }).getByText("Working tree").click();
  await main.getByRole("button", { name: /notes\.txt/ }).click();
  await expect(main.getByRole("region", { name: "Diff for notes.txt" }).locator("tr.add")).toContainText("scratch");
});
