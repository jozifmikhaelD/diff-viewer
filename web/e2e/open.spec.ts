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
  await dialog.getByRole("combobox", { name: "Repository path" }).fill(wt);
  await dialog.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page.locator(".repo-root")).toHaveAttribute("title", wt);
  await expect(page.getByRole("listbox", { name: "History" }).locator(".ref-head", { hasText: "feature" })).toBeVisible();

  // the previous repo is offered as a recent suggestion as soon as the field opens
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.getByRole("button", { name: "Open…" }).click();
  const recent = page.getByRole("listbox", { name: "Repositories and directories" });
  await expect(recent.getByRole("option", { name: /recent/ }).first()).toContainText(original);
  await recent.getByRole("option", { name: new RegExp(original.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).click();
  await expect(page.locator(".repo-root")).toHaveAttribute("title", original);

  // typing a parent path suggests directories, marking git repos
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.getByRole("button", { name: "Open…" }).click();
  await expect(page.getByRole("dialog", { name: "Open repository" })).toBeVisible();
  const parent = original.slice(0, original.lastIndexOf("/") + 1);
  await page.getByRole("combobox", { name: "Repository path" }).fill(parent + "re");
  const list = page.getByRole("listbox", { name: "Repositories and directories" });
  await expect(list.getByRole("option", { name: /repo/ })).toContainText("git repo");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.locator(".repo-root")).toHaveAttribute("title", original);

  // a bad path is reported inline
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.getByRole("button", { name: "Open…" }).click();
  await page.getByRole("combobox", { name: "Repository path" }).fill("/definitely/not/here");
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
