import { expect, test } from "@playwright/test";

test("serves the app against the fixture repo", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("void");
  await expect(page.getByRole("heading", { name: "void" })).toBeVisible();
  await expect(page.locator(".repo-root")).toContainText("/repo");
});

test("health endpoint reports ok", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.ok()).toBeTruthy();
  expect(await res.json()).toMatchObject({ ok: true });
});
