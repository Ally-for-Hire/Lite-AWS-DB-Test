import { expect, test } from "@playwright/test";

function uniqueSuffix() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function createNote(page, title, content) {
  await page.goto("/");
  await page.locator("#new-title").fill(title);
  await page.locator("#new-content").fill(content);
  await page.locator("#create-form").getByRole("button", { name: "Create" }).click();

  await expect(page.locator("#message")).toHaveText("Note created");
  await expect(page.locator("#editor-title")).toHaveValue(title);
  await expect(page.locator("#editor-content")).toHaveValue(content);
  await expect(page.locator("#editor-status")).toContainText("Current version: 1");
}

test("shows the empty state on first load", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator("#notes-count")).toHaveText("0");
  await expect(page.locator("#notes-empty")).toBeVisible();
  await expect(page.locator("#editor-status")).toHaveText("No note selected");
  await expect(page.locator("#versions-empty")).toBeVisible();
  await expect(page.locator("#save")).toBeDisabled();
  await expect(page.locator("#undo")).toBeDisabled();
  await expect(page.locator("#redo")).toBeDisabled();
});

test("exposes basic accessible controls and status surfaces", async ({ page }) => {
  const title = `Playwright a11y ${uniqueSuffix()}`;

  await createNote(page, title, "keyboard body");

  await expect(page.locator("#message")).toHaveAttribute("aria-live", "polite");
  await expect(page.getByRole("button", { name: "Reload" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Versioned Notes" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save Version" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Title" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: new RegExp(title) })).toBeVisible();
});

test("creates a note and loads it into the editor", async ({ page }) => {
  const title = `Playwright create ${uniqueSuffix()}`;
  const content = "Initial note body from Playwright.";

  await createNote(page, title, content);

  await expect(page.locator("#notes-list")).toContainText(title);
  await expect(page.locator("#versions-count")).toHaveText("1");
  await expect(page.locator('[data-version="1"]')).toContainText("Version 1");
});

test("saves new versions, previews history, and restores older content", async ({ page }) => {
  const title = `Playwright history ${uniqueSuffix()}`;
  const originalContent = "Version one body";
  const revisedTitle = `${title} revised`;
  const revisedContent = "Version two body";

  await createNote(page, title, originalContent);

  await page.locator("#editor-title").fill(revisedTitle);
  await page.locator("#editor-content").fill(revisedContent);
  await page.locator("#save").click();

  await expect(page.locator("#message")).toHaveText("Saved as a new child version");
  await expect(page.locator("#editor-title")).toHaveValue(revisedTitle);
  await expect(page.locator("#editor-content")).toHaveValue(revisedContent);
  await expect(page.locator("#editor-status")).toContainText("Current version: 2");
  await expect(page.locator("#editor-status")).toContainText("parent v1");

  await page.locator("#undo").click();
  await expect(page.locator("#message")).toHaveText("undo");
  await expect(page.locator("#editor-title")).toHaveValue(title);
  await expect(page.locator("#editor-content")).toHaveValue(originalContent);
  await expect(page.locator("#editor-status")).toContainText("Current version: 1");

  await page.locator("#redo").click();
  await expect(page.locator("#message")).toHaveText("redo");
  await expect(page.locator("#editor-title")).toHaveValue(revisedTitle);
  await expect(page.locator("#editor-content")).toHaveValue(revisedContent);
  await expect(page.locator("#editor-status")).toContainText("Current version: 2");

  const versionOneRow = page.locator('[data-version="1"]');
  await versionOneRow.getByRole("button", { name: "Preview" }).click();
  await expect(page.locator("#message")).toHaveText("Previewed version 1");
  await expect(page.locator("#preview-panel")).toBeVisible();
  await expect(page.locator("#preview-title")).toHaveText("Version 1");
  await expect(page.locator("#preview-content")).toHaveText(originalContent);
  await expect(page.locator("#editor-title")).toHaveValue(revisedTitle);
  await expect(page.locator("#editor-content")).toHaveValue(revisedContent);

  await versionOneRow.getByRole("button", { name: "Fork" }).click();
  await expect(page.locator("#message")).toHaveText("Forked from version 1");
  await expect(page.locator("#editor-title")).toHaveValue(title);
  await expect(page.locator("#editor-content")).toHaveValue(originalContent);
  await expect(page.locator("#editor-status")).toContainText("Current version: 3");
  await expect(page.locator("#editor-status")).toContainText("parent v2");
  await expect(page.locator("#editor-status")).toContainText("copied from v1");
  await expect(page.locator("#versions-count")).toHaveText("3");
  await expect(page.locator('[data-version="3"]')).toContainText("restore");
  await expect(page.locator('[data-version="3"]')).toContainText("copied from v1");
});

test("preview can be closed without changing editor state", async ({ page }) => {
  const title = `Playwright preview ${uniqueSuffix()}`;

  await createNote(page, title, "v1 body");

  await page.locator("#editor-title").fill(`${title} v2`);
  await page.locator("#editor-content").fill("v2 body");
  await page.locator("#save").click();

  await page.locator('[data-version="1"]').getByRole("button", { name: "Preview" }).click();
  await expect(page.locator("#preview-panel")).toBeVisible();
  await expect(page.locator("#preview-content")).toHaveText("v1 body");

  await page.locator("#close-preview").click();
  await expect(page.locator("#preview-panel")).toBeHidden();
  await expect(page.locator("#editor-title")).toHaveValue(`${title} v2`);
  await expect(page.locator("#editor-content")).toHaveValue("v2 body");
});

test("preview does not overwrite draft edits and history actions are blocked while dirty", async ({ page }) => {
  const firstTitle = `Playwright draft ${uniqueSuffix()}`;
  const secondTitle = `Playwright second ${uniqueSuffix()}`;

  await createNote(page, firstTitle, "Original body");
  await createNote(page, secondTitle, "Second note");

  await page.locator(`[data-note-id]:has-text("${firstTitle}")`).click();
  await expect(page.locator("#editor-title")).toHaveValue(firstTitle);

  await page.locator("#editor-title").fill(`${firstTitle} unsaved`);
  await page.locator("#editor-content").fill("Unsaved draft body");

  await expect(page.locator("#draft-status")).toHaveText("Unsaved draft changes. Save to create a new child version before switching notes or history.");
  await expect(page.locator("#save")).toBeEnabled();
  await expect(page.locator("#undo")).toBeDisabled();
  await expect(page.locator("#redo")).toBeDisabled();

  await page.locator('[data-version="1"]').getByRole("button", { name: "Preview" }).click();
  await expect(page.locator("#message")).toHaveText("Previewed version 1");
  await expect(page.locator("#preview-content")).toHaveText("Original body");
  await expect(page.locator("#editor-title")).toHaveValue(`${firstTitle} unsaved`);
  await expect(page.locator("#editor-content")).toHaveValue("Unsaved draft body");

  await page.locator(`[data-note-id]:has-text("${secondTitle}")`).click();
  await expect(page.locator("#message")).toHaveText("Save your draft before switching notes");
  await expect(page.locator("#editor-title")).toHaveValue(`${firstTitle} unsaved`);

  await expect(page.locator('[data-version="1"]').getByRole("button", { name: "Open" })).toBeDisabled();
  await expect(page.locator('[data-version="1"]').getByRole("button", { name: "Fork" })).toBeDisabled();
  await expect(page.locator("#editor-title")).toHaveValue(`${firstTitle} unsaved`);
  await expect(page.locator("#editor-content")).toHaveValue("Unsaved draft body");
});

test("shows validation errors when creating an invalid note", async ({ page }) => {
  await page.goto("/");
  const initialCount = await page.locator("#notes-count").textContent();
  await page.locator("#new-title").fill("   ");
  await page.locator("#new-content").fill("Body that should not save");
  await page.locator("#create-form").getByRole("button", { name: "Create" }).click();

  await expect(page.locator("#message")).toHaveText("Title is required");
  await expect(page.locator("#notes-count")).toHaveText(initialCount ?? "0");
});

test("editing from an old version creates a new branch and redo becomes ambiguous", async ({ page }) => {
  const title = `Playwright tree ${uniqueSuffix()}`;

  await createNote(page, title, "v1 body");

  await page.locator("#editor-title").fill(`${title} v2`);
  await page.locator("#editor-content").fill("v2 body");
  await page.locator("#save").click();
  await expect(page.locator("#message")).toHaveText("Saved as a new child version");

  await page.locator('[data-version="1"]').getByRole("button", { name: "Open" }).click();
  await expect(page.locator("#message")).toHaveText("Opened version 1");
  await expect(page.locator("#editor-status")).toContainText("Current version: 1");
  await expect(page.locator("#redo")).toBeEnabled();

  await page.locator("#editor-title").fill(`${title} branch`);
  await page.locator("#editor-content").fill("v3 branch body");
  await page.locator("#save").click();

  await expect(page.locator("#message")).toHaveText("Saved as a new child version");
  await expect(page.locator("#editor-status")).toContainText("Current version: 3");
  await expect(page.locator("#editor-status")).toContainText("parent v1");

  await page.locator("#undo").click();
  await expect(page.locator("#editor-status")).toContainText("Current version: 1");
  await expect(page.locator("#redo")).toBeDisabled();
  await expect(page.locator('[data-version="1"]')).toContainText("2 children");

  await page.locator('[data-version="2"]').getByRole("button", { name: "Open" }).click();
  await expect(page.locator("#message")).toHaveText("Opened version 2");
  await expect(page.locator("#editor-title")).toHaveValue(`${title} v2`);

  await page.locator('[data-version="3"]').getByRole("button", { name: "Open" }).click();
  await expect(page.locator("#message")).toHaveText("Opened version 3");
  await expect(page.locator("#editor-title")).toHaveValue(`${title} branch`);
});

test("save failure keeps the draft locally and shows degraded service state", async ({ page }) => {
  const title = `Playwright degraded ${uniqueSuffix()}`;

  await createNote(page, title, "v1 body");

  await page.route("**/api/notes/*", async (route) => {
    if (route.request().method() === "PUT") {
      await route.fulfill({
        status: 429,
        contentType: "application/json",
        body: JSON.stringify({
          error: "FreeTierLimit",
          code: "FREE_TIER_RATE_LIMIT",
          message: "Temporary free-tier capacity limit reached. Try again later. Your local draft should be kept."
        })
      });
      return;
    }

    await route.fallback();
  });

  await page.locator("#editor-title").fill(`${title} local draft`);
  await page.locator("#editor-content").fill("draft kept locally");
  await page.locator("#save").click();

  await expect(page.locator("#service-alert")).toHaveText("Temporary free-tier capacity limit reached. Try again later. Your local draft should be kept.");
  await expect(page.locator("#message")).toHaveText("Temporary free-tier capacity limit reached. Try again later. Your local draft should be kept.");
  await expect(page.locator("#editor-title")).toHaveValue(`${title} local draft`);
  await expect(page.locator("#editor-content")).toHaveValue("draft kept locally");

  await page.unroute("**/api/notes/*");
  await page.reload();

  await expect(page.locator("#message")).toHaveText("Recovered local draft after a failed save");
  await expect(page.locator("#editor-title")).toHaveValue(`${title} local draft`);
  await expect(page.locator("#editor-content")).toHaveValue("draft kept locally");
  await expect(page.locator("#draft-status")).toHaveText("Unsaved draft changes. Save to create a new child version before switching notes or history.");
});

test("successful save clears degraded service state and local draft recovery", async ({ page }) => {
  const title = `Playwright recovery ${uniqueSuffix()}`;

  await createNote(page, title, "v1 body");

  await page.route("**/api/notes/*", async (route) => {
    if (route.request().method() === "PUT") {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: "PlatformLimit",
          code: "WORKER_RESOURCE_LIMIT",
          message: "The worker hit a platform resource limit. Try again later. Your local draft should be kept."
        })
      });
      return;
    }

    await route.fallback();
  });

  await page.locator("#editor-title").fill(`${title} retry`);
  await page.locator("#editor-content").fill("retry body");
  await page.locator("#save").click();

  await expect(page.locator("#service-alert")).toHaveText("The worker hit a platform resource limit. Try again later. Your local draft should be kept.");

  await page.unroute("**/api/notes/*");
  await page.locator("#save").click();

  await expect(page.locator("#message")).toHaveText("Saved as a new child version");
  await expect(page.locator("#service-alert")).toBeHidden();
  await expect(page.locator("#draft-status")).toBeHidden();

  await page.reload();
  await expect(page.locator("#message")).not.toHaveText("Recovered local draft after a failed save");
  await expect(page.locator("#editor-title")).toHaveValue(`${title} retry`);
  await expect(page.locator("#editor-content")).toHaveValue("retry body");
});

test("reload refreshes the selected note and version history", async ({ page, request }) => {
  const title = `Playwright reload ${uniqueSuffix()}`;

  await createNote(page, title, "v1 body");
  const noteId = await page.locator(".note-row.active").getAttribute("data-note-id");
  expect(noteId).toBeTruthy();

  const response = await request.put(`/api/notes/${noteId}`, {
    data: {
      title: `${title} remote`,
      content: "v2 remote body",
      expectedCurrentVersion: 1
    }
  });
  expect(response.ok()).toBeTruthy();

  await page.locator("#reload").click();

  await expect(page.locator("#editor-title")).toHaveValue(`${title} remote`);
  await expect(page.locator("#editor-content")).toHaveValue("v2 remote body");
  await expect(page.locator("#editor-status")).toContainText("Current version: 2");
  await expect(page.locator("#versions-count")).toHaveText("2");
});

test("concurrent editors preserve the losing draft on version conflict", async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  const title = `Playwright conflict ${uniqueSuffix()}`;

  await createNote(pageA, title, "v1 body");
  await pageB.goto("/");
  await pageB.locator(`[data-note-id]:has-text("${title}")`).click();
  await expect(pageB.locator("#editor-title")).toHaveValue(title);

  await pageA.locator("#editor-title").fill(`${title} winner`);
  await pageA.locator("#editor-content").fill("winner body");
  await pageA.locator("#save").click();
  await expect(pageA.locator("#message")).toHaveText("Saved as a new child version");

  await pageB.locator("#editor-title").fill(`${title} loser`);
  await pageB.locator("#editor-content").fill("loser body");
  await pageB.locator("#save").click();

  await expect(pageB.locator("#message")).toHaveText("Version mismatch");
  await expect(pageB.locator("#editor-title")).toHaveValue(`${title} loser`);
  await expect(pageB.locator("#editor-content")).toHaveValue("loser body");
  await expect(pageB.locator("#draft-status")).toHaveText("Unsaved draft changes. Save to create a new child version before switching notes or history.");

  await pageB.reload();
  await expect(pageB.locator("#message")).toHaveText("Recovered local draft after a failed save");
  await expect(pageB.locator("#editor-title")).toHaveValue(`${title} loser`);
  await expect(pageB.locator("#editor-content")).toHaveValue("loser body");

  await contextA.close();
  await contextB.close();
});
