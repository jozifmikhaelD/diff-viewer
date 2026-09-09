import { expect, test } from "@playwright/test";

test("the diff pane scrolls through every file and the file list follows", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("listbox", { name: "History" }).getByText("c3: rename util").click();
  const main = page.getByRole("main");
  const stream = main.getByRole("region", { name: "All diffs" });
  await expect(stream.getByRole("region", { name: /Diff for/ })).toHaveCount(5);
  await expect(main.getByRole("treeitem", { selected: true })).toHaveAttribute("data-path", "lib/helper.py");

  // scroll to the bottom: the last file becomes current in the tree
  const scroller = page.getByTestId("diff-stream-scroll");
  await scroller.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
  await expect(main.getByRole("treeitem", { selected: true })).toHaveAttribute("data-path", "unicodé.txt");

  // click a file in the tree: the stream scrolls back to it
  await main.getByRole("button", { name: /app\.ts/ }).click();
  await expect(main.getByRole("treeitem", { selected: true })).toHaveAttribute("data-path", "src/app.ts");
  const top = await scroller.evaluate((el) => el.scrollTop);
  const sectionTop = await stream.locator('section[data-path="src/app.ts"]').evaluate((el) => (el as HTMLElement).offsetTop - (el.parentElement as HTMLElement).offsetTop);
  expect(Math.abs(top - sectionTop)).toBeLessThan(4);

  // n moves to the next file and the stream follows
  await page.keyboard.press("n");
  await expect(main.getByRole("treeitem", { selected: true })).toHaveAttribute("data-path", "src/utils.ts");

  // "Whole file" on a section opens the focused single-file view with blame
  await stream.locator('section[data-path="src/utils.ts"]').getByRole("button", { name: "Whole file" }).click();
  await expect(main.getByRole("region", { name: "Diff for src/utils.ts" }).getByRole("checkbox", { name: "Whole file" })).toBeChecked();
  await main.getByRole("checkbox", { name: "Whole file" }).click(); // not uncheck(): the toolbar unmounts
  await expect(main.getByRole("region", { name: "All diffs" })).toBeVisible();
});
