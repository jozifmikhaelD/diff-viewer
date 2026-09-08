import { expect, test, type APIRequestContext } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

async function repoRoot(request: APIRequestContext): Promise<string> {
  const res = await request.get("/api/repo");
  return ((await res.json()) as { root: string }).root;
}

const env = { ...process.env, GIT_AUTHOR_NAME: "Live", GIT_AUTHOR_EMAIL: "l@x", GIT_COMMITTER_NAME: "Live", GIT_COMMITTER_EMAIL: "l@x" };
let root = "";
let originalApp = "";

// Restore the shared fixture so later specs see the original state.
test.afterEach(() => {
  if (!root) return;
  try {
    execFileSync("git", ["-C", root, "reset", "-q", "--soft", "HEAD~1"], { env });
  } catch {
    // commit may not have happened
  }
  try {
    execFileSync("git", ["-C", root, "rm", "-q", "--cached", "live-new.txt"], { env });
  } catch {
    // not staged
  }
  rmSync(join(root, "live-new.txt"), { force: true });
  if (originalApp) writeFileSync(join(root, "src", "app.ts"), originalApp);
});

test("editing files and committing updates the UI without a reload", async ({ page, request }) => {
  root = await repoRoot(request);
  originalApp = readFileSync(join(root, "src", "app.ts"), "utf8");
  await page.goto("/");
  const history = page.getByRole("listbox", { name: "History" });
  const wt = history.getByRole("option").first();
  await expect(wt.getByText("1 untracked")).toBeVisible();

  // new untracked file -> badge count changes
  writeFileSync(join(root, "live-new.txt"), "hello\n");
  await expect(wt.getByText("2 untracked")).toBeVisible({ timeout: 10_000 });

  // open the working tree; an edit shows up in the file list and the diff
  await wt.click();
  const main = page.getByRole("main");
  await expect(main.getByTestId("stat-files")).toHaveText("4");
  appendFileSync(join(root, "src", "app.ts"), "// live edit\n");
  await main.getByRole("button", { name: /app\.ts/ }).click();
  await expect(main.getByRole("region", { name: "Diff for src/app.ts" }).locator("tr.add", { hasText: "// live edit" })).toBeVisible({ timeout: 10_000 });

  // a commit appears in history without reloading
  execFileSync("git", ["-C", root, "add", "live-new.txt"], { env });
  execFileSync("git", ["-C", root, "commit", "-q", "-m", "live: new file"], { env });
  await expect(history.getByText("live: new file")).toBeVisible({ timeout: 10_000 });
  await expect(wt.getByText("1 untracked")).toBeVisible({ timeout: 10_000 });
});
