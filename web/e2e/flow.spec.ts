import { expect, test } from "@playwright/test";

test("the flow pane lays changed files out by import direction and copies Mermaid", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await page.getByRole("combobox", { name: "Worktree" }).selectOption({ label: "wt-feature · feature" });
  await page.getByRole("button", { name: "feature vs main" }).click();
  const main = page.getByRole("main");
  await main.getByRole("radio", { name: "Flow" }).click();
  const flow = main.getByRole("region", { name: "Flow diagram" });
  await expect(flow.locator("g.flow-node")).toHaveCount(3);
  // feature.ts imports app.ts: feature is an entry point (layer 0), app.ts sits to its right
  const x = async (path: string) => Number(/translate\(([\d.]+)/.exec((await flow.locator(`g.flow-node[data-path="${path}"]`).getAttribute("transform"))!)![1]);
  expect(await x("src/feature.ts")).toBeLessThan(await x("src/app.ts"));
  await expect(flow.locator('path.flow-edge[data-from="src/feature.ts"][data-to="src/app.ts"]')).toHaveCount(1);
  await expect(flow.getByTestId("flow-layer").first()).toContainText("· 2");

  await flow.getByRole("button", { name: "Copy as Mermaid" }).click();
  await expect(flow.getByRole("button", { name: "Copied" })).toBeVisible();
  const text = await page.evaluate(() => (navigator as unknown as { clipboard: { readText(): Promise<string> } }).clipboard.readText());
  expect(text).toContain("flowchart LR");
  expect(text).toContain("feature.ts (A");

  await flow.getByRole("button", { name: /feature\.ts/ }).click();
  await expect(main.getByRole("region", { name: "Diff for src/feature.ts" })).toBeVisible();

  await page.keyboard.press("f");
  await expect(main.getByRole("region", { name: "Flow diagram" })).toBeVisible();
  await page.keyboard.press("f");
  await expect(main.getByRole("region", { name: /Diff for/ })).toBeVisible();
});
