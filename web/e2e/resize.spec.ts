import { expect, test } from "@playwright/test";

test("history and file-list panes resize by dragging and persist across reloads", async ({ page }) => {
  await page.goto("/");
  const sidebar = page.locator(".sidebar");
  const before = (await sidebar.boundingBox())!.width;
  const handle = page.getByRole("separator", { name: "Resize history" });
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + 3, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 153, box.y + 200, { steps: 5 });
  await page.mouse.up();
  const after = (await sidebar.boundingBox())!.width;
  expect(Math.round(after - before)).toBe(150);

  await page.getByRole("listbox", { name: "History" }).getByText("c3: rename util").click();
  const files = page.getByRole("region", { name: "Changed files" });
  const filesBefore = (await files.boundingBox())!.width;
  const h2 = page.getByRole("separator", { name: "Resize file list" });
  const b2 = (await h2.boundingBox())!;
  await page.mouse.move(b2.x + 3, b2.y + 100);
  await page.mouse.down();
  await page.mouse.move(b2.x - 47, b2.y + 100, { steps: 5 });
  await page.mouse.up();
  expect(Math.round((await files.boundingBox())!.width - filesBefore)).toBe(-50);

  await page.reload();
  expect(Math.round((await page.locator(".sidebar").boundingBox())!.width)).toBe(Math.round(after));
  await page.getByRole("separator", { name: "Resize history" }).dblclick();
  expect(Math.round((await page.locator(".sidebar").boundingBox())!.width)).toBe(Math.round(before));
});
