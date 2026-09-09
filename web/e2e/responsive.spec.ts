import { expect, test } from "@playwright/test";

test("narrow viewports stack the panes and hide history behind a toggle", async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 900 });
  await page.goto("/");
  const toggle = page.getByRole("button", { name: /Hide history/ });
  await expect(toggle).toBeVisible();
  await expect(page.getByRole("separator", { name: "Resize history" })).toHaveCount(0);
  // choosing a commit closes the drawer so the changes get the space
  await page.getByRole("listbox", { name: "History" }).getByText("c3: rename util").click();
  await expect(page.getByRole("button", { name: /Show history/ })).toBeVisible();
  await expect(page.getByRole("listbox", { name: "History" })).toHaveCount(0);
  // file list stacks above the diff (no file-list splitter)
  await expect(page.getByRole("separator", { name: "Resize file list" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Changed files" })).toBeVisible();
  await expect(page.getByRole("region", { name: /Diff for/ })).toBeVisible();
  // no horizontal page scroll
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.getByRole("button", { name: /Show history/ }).click();
  await expect(page.getByRole("listbox", { name: "History" })).toBeVisible();
});

test("controls carry tooltips and ? opens the shortcut list", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("combobox", { name: "Worktree" })).toHaveAttribute("title", /worktrees/);
  await expect(page.getByRole("combobox", { name: "Theme" })).toHaveAttribute("title", /theme/i);
  await expect(page.getByRole("searchbox", { name: "Search commits" })).toHaveAttribute("title", /author:name/);
  await page.getByRole("listbox", { name: "History" }).getByText("c3: rename util").click();
  await expect(page.getByRole("radio", { name: "Flow" })).toHaveAttribute("title", /import direction/);
  await expect(page.getByRole("radio", { name: "Side by side" })).toHaveAttribute("title", /left/);
  await expect(page.getByRole("searchbox", { name: "Filter files" })).toHaveAttribute("title", /map and the flow/);
  await page.keyboard.press("?");
  const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("toggle the flow diagram");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});
