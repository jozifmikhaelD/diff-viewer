import { expect, test, type APIRequestContext } from "@playwright/test";

async function repoRoot(request: APIRequestContext): Promise<string> {
  const res = await request.get("/api/repo");
  return ((await res.json()) as { root: string }).root;
}

let original = "";
test.afterEach(async ({ request }) => {
  if (original) await request.post("/api/open", { data: { path: original } });
});

test("Open… switches to another repository by path and lists it as recent", async ({ page, request }) => {
  original = await repoRoot(request);
  const wt = original.replace(/\/repo$/, "/wt-feature");
  await page.goto("/");
  await page.getByRole("button", { name: "Open…" }).click();
  const dialog = page.getByRole("dialog", { name: "Open repository" });
  await dialog.getByRole("textbox", { name: "Repository path" }).fill(wt);
  await dialog.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page.locator(".repo-root")).toHaveAttribute("title", wt);
  await expect(page.getByRole("listbox", { name: "History" }).locator(".ref-head", { hasText: "feature" })).toBeVisible();

  // the previous repo is offered in the recent list
  await page.getByRole("button", { name: "Open…" }).click();
  const recent = page.getByRole("list", { name: "Recent repositories" });
  await expect(recent).toContainText(original);
  await recent.getByRole("button", { name: /repo$/ }).first().click();
  await expect(page.locator(".repo-root")).toHaveAttribute("title", original);

  // a bad path is reported inline
  await page.getByRole("button", { name: "Open…" }).click();
  await page.getByRole("textbox", { name: "Repository path" }).fill("/definitely/not/here");
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("no such directory");
  await page.keyboard.press("Escape");
});

test("theme select applies data-theme and persists", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("combobox", { name: "Theme" }).selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("combobox", { name: "Theme" }).selectOption("system");
});
