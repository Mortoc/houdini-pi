import { expect, test } from "@playwright/test";

const PAGE = "/?token=e2e";

test("connects, greets with the hip and model, and streams a turn with a tool card", async ({ page }) => {
  await page.goto(PAGE);
  await expect(page.getByTestId("status")).toHaveText("open");
  await expect(page.getByTestId("hip")).toHaveText("rock.hip");
  await expect(page.getByTestId("model-picker")).toHaveValue("fake/fake-fast");

  await page.getByTestId("prompt").fill("make the wires thinner");
  await page.getByTestId("send").click();
  await expect(page.getByTestId("user-bubble")).toHaveText("make the wires thinner");
  const card = page.getByTestId("tool-card");
  await expect(card).toHaveCount(1);
  await expect(card.locator(".tool-name")).toHaveText("houdini: set_parameter");
  await expect(card.locator(".tool-summary")).toHaveText("/obj/geo1/wire1 · radius");
  await card.locator("summary").click();
  await expect(card.locator(".tool-args")).toContainText('"radius"');
  await expect(page.getByTestId("thinking")).toBeVisible();
  await expect(page.getByTestId("assistant-bubble")).toContainText("I would make the wires thinner");
  await expect(page.getByTestId("turn-footer")).toContainText("done");
  await expect(page.getByTestId("turn-footer")).toContainText("$0.0");
});

test("abort while streaming marks the turn aborted", async ({ page }) => {
  await page.goto(PAGE);
  await expect(page.getByTestId("status")).toHaveText("open");
  await page.getByTestId("prompt").fill("go slow");
  await page.getByTestId("prompt").press("Enter");
  await expect(page.getByTestId("tool-card")).toBeVisible();
  await page.getByTestId("abort").click();
  await expect(page.getByTestId("turn-footer")).toContainText("aborted");
  await expect(page.getByTestId("send")).toHaveText("send");
});

test("model and thinking pickers round-trip through the sidecar", async ({ page }) => {
  await page.goto(PAGE);
  await expect(page.getByTestId("status")).toHaveText("open");
  await page.getByTestId("model-picker").selectOption("fake/fake-deep");
  await expect(page.getByTestId("model-picker")).toHaveValue("fake/fake-deep");
  await page.getByTestId("thinking-picker").selectOption("high");
  await expect(page.getByTestId("thinking-picker")).toHaveValue("high");
  await page.getByTestId("file-tools").click();
  await expect(page.getByTestId("file-tools")).toBeChecked();
});

test("memory tab shows, edits and rolls back the hip memory", async ({ page }) => {
  await page.goto(PAGE);
  await expect(page.getByTestId("status")).toHaveText("open");
  await page.getByRole("tab", { name: "memory" }).click();
  const text = page.getByTestId("memory-text");
  await expect(text).toHaveValue(/metres everywhere/);
  await expect(page.getByTestId("memory-undo")).toBeDisabled();
  await text.fill("## Conventions\n\n- centimetres, actually\n");
  await page.getByTestId("memory-save").click();
  await expect(page.getByTestId("memory-undo")).toBeEnabled();
  await page.getByTestId("memory-undo").click();
  await expect(text).toHaveValue(/metres everywhere/);
});

test("sessions tab lists the current session", async ({ page }) => {
  await page.goto(PAGE);
  await expect(page.getByTestId("status")).toHaveText("open");
  await page.getByRole("tab", { name: "sessions" }).click();
  await expect(page.getByTestId("sessions").locator("li")).toHaveCount(1);
});

test("a wrong token never reaches the sidecar", async ({ page }) => {
  await page.goto("/?token=wrong");
  await expect(page.getByTestId("status")).not.toHaveText("open");
  await expect(page.getByTestId("prompt")).toBeDisabled();
});
