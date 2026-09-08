import { expect, test } from "@playwright/test";

test("double-click opens the whole file with changes inline and blame on hover; clicking blame jumps to the commit", async ({ page }) => {
  await page.goto("/");
  const history = page.getByRole("listbox", { name: "History" });
  await history.getByText("c3: rename util").click();
  const main = page.getByRole("main");
  await main.getByRole("button", { name: /app\.ts/ }).dblclick();
  const diff = main.getByRole("region", { name: "Diff for src/app.ts" });
  await expect(diff.getByRole("checkbox", { name: "Whole file" })).toBeChecked();
  await expect(diff.getByRole("checkbox", { name: "Blame" })).toBeChecked();
  // app.ts has 4 lines at c3: the final file only, no deleted rows
  await expect(diff.locator("tr.line")).toHaveCount(5); // final file only (5 lines at c3)
  await expect(diff.locator("tr.del")).toHaveCount(0);
  await expect(diff.getByText(/unchanged lines/)).toHaveCount(0);

  await diff.locator("tr.add").hover();
  const note = diff.getByTestId("blame-note");
  await expect(note).toContainText("Fixture Author");
  await expect(note).toContainText("c3: rename util");
  await diff.locator("tr.ctx").first().hover();
  await expect(diff.getByTestId("blame-note")).toContainText("c1: initial project");
  await diff.getByTestId("blame-note").getByRole("button").click();
  await expect(main.getByRole("heading", { name: /c1: initial project/ })).toBeVisible();
});

test("working-tree blame marks uncommitted lines", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("listbox", { name: "History" }).getByText("Working tree").click();
  const main = page.getByRole("main");
  await main.getByRole("button", { name: /README\.md/ }).dblclick();
  const diff = main.getByRole("region", { name: "Diff for README.md" });
  await diff.locator("tr.add").hover();
  await expect(diff.getByTestId("blame-note")).toContainText("Uncommitted changes");
});
