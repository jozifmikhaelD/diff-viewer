import { expect, test } from "@playwright/test";

test("clicking a commit shows totals, languages and the file tree", async ({ page }) => {
  await page.goto("/");
  const history = page.getByRole("listbox", { name: "History" });
  await history.getByText("c3: rename util").click();

  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: /c3: rename util/ })).toBeVisible();
  await expect(main.getByTestId("stat-files")).toHaveText("5");
  await expect(main.getByTestId("stat-additions")).toHaveText("+4");
  await expect(main.getByTestId("stat-deletions")).toHaveText("−4");
  await expect(main.getByRole("list", { name: "Languages" })).toContainText("TypeScript");
  await expect(main.getByRole("list", { name: "Languages" })).toContainText("Python");

  const files = main.getByRole("tree");
  await expect(files.getByText("← src/util.ts")).toBeVisible();
  await expect(files.getByTitle("deleted", { exact: true })).toBeVisible();
  await expect(files.getByText("name with spaces.txt")).toBeVisible();
  await expect(files.getByText("unicodé.txt")).toBeVisible();

  await main.getByRole("radio", { name: "Flat" }).click();
  await expect(files.locator(".file-dir", { hasText: "src/" })).toHaveCount(2);
  await main.getByRole("searchbox").fill("app");
  await expect(files.getByRole("treeitem")).toHaveCount(1);
  await files.getByRole("button", { name: /app\.ts/ }).click();
  await expect(files.getByRole("treeitem", { selected: true })).toHaveAttribute("data-path", "src/app.ts");
});

test("working tree shows all/staged/unstaged/untracked modes", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("listbox", { name: "History" }).getByText("Working tree").click();
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: "Working tree" })).toBeVisible();
  await expect(main.getByTestId("stat-files")).toHaveText("3");
  await expect(main.getByTitle("untracked", { exact: true })).toBeVisible();

  await main.getByRole("radio", { name: /Staged/ }).click();
  await expect(main.getByTestId("stat-files")).toHaveText("1");
  await expect(main.getByRole("tree")).toContainText("README.md");

  await main.getByRole("radio", { name: /Unstaged/ }).click();
  await expect(main.getByRole("tree")).toContainText("app.ts");

  await main.getByRole("radio", { name: /Untracked/ }).click();
  await expect(main.getByRole("tree")).toContainText("notes.txt");
});

test("merge commits are diffed against the first parent and root commits against nothing", async ({ page }) => {
  await page.goto("/");
  const history = page.getByRole("listbox", { name: "History" });
  await history.getByText("m1: merge topic").click();
  const main = page.getByRole("main");
  await expect(main.getByText("merge · vs first parent")).toBeVisible();
  await expect(main.getByTestId("stat-files")).toHaveText("1");
  await history.getByText("c1: initial project").click();
  await expect(main.getByTestId("stat-files")).toHaveText("4");
  await expect(main.getByTestId("stat-deletions")).toHaveText("−0");
});
