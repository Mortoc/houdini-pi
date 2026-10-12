import { expect, test } from "@playwright/test";

const PAGE = "/?token=e2e";

async function open(page: import("@playwright/test").Page) {
  await page.goto(PAGE);
  await expect(page.getByTestId("status")).toHaveCount(0);
  await expect(page.getByTestId("prompt")).toBeEnabled();
}

test("connects, shows the hip and the default conversation name, streams a turn with a tool card", async ({ page }) => {
  await open(page);
  await expect(page.getByTestId("hip")).toHaveText("rock.hip");
  await expect(page.getByTestId("session-name")).toHaveText("New Conversation");
  await expect(page.getByTestId("model-picker")).toContainText("Fake Fast");

  await page.getByTestId("prompt").fill("make the wires thinner");
  await page.getByTestId("send").click();
  await expect(page.getByTestId("user-bubble")).toHaveText("make the wires thinner");
  const cards = page.getByTestId("tool-card");
  await expect(cards).toHaveCount(3);
  const card = cards.first();
  await expect(card.locator(".tool-name")).toHaveText("houdini: set_parameter");
  await expect(card.locator(".tool-summary")).toHaveText("/obj/geo1/wire1 · radius");
  await card.locator("summary").click();
  await expect(card.locator(".tool-args")).toContainText('"radius"');
  const python = cards.nth(1);
  await expect(python.locator(".tool-name")).toHaveText("houdini: execute_python");
  const code = python.getByTestId("code-block");
  await expect(code).toBeVisible();
  await expect(code.locator(".tok-kw").first()).toHaveText("import");
  await expect(code.locator(".tok-cmt").first()).toHaveText("# thin every wire");
  const scrolls = await code.evaluate((el) => el.scrollHeight > el.clientHeight);
  expect(scrolls, "six-line script must scroll inside a four-line box").toBe(true);
  await expect(page.getByTestId("assistant-bubble")).toContainText("I would make the wires thinner");
  const inspect = cards.nth(2);
  await expect(inspect.locator(".tool-name")).toHaveText("inspect COP");
  await expect(inspect.getByTestId("tool-image")).toBeVisible();
  await expect(page.getByTestId("turn-footer")).toContainText("Done");
  await expect(page.getByTestId("turn-footer").locator(".verdict")).toHaveCSS("color", "rgb(46, 204, 113)");
  await expect(page.getByTestId("thinking")).toHaveCount(0);
  await expect(page.getByTestId("session-name")).toContainText("Named:");
});

test("thinking indicator animates while streaming and disappears after", async ({ page }) => {
  await open(page);
  await page.getByTestId("prompt").fill("go");
  await page.getByTestId("prompt").press("Enter");
  const thinking = page.getByTestId("thinking");
  await expect(thinking).toBeVisible();
  await expect(thinking.locator(".thinking-dots i")).toHaveCount(3);
  await expect(page.getByTestId("turn-footer")).toContainText("Done");
  await expect(thinking).toHaveCount(0);
});

test("abort while streaming marks the turn aborted", async ({ page }) => {
  await open(page);
  await page.getByTestId("prompt").fill("go slow");
  await page.getByTestId("prompt").press("Enter");
  await expect(page.getByTestId("tool-card")).toBeVisible();
  await page.getByTestId("abort").click();
  await expect(page.getByTestId("turn-footer")).toContainText("Aborted");
  await expect(page.getByTestId("send")).toHaveText("send");
});

test("model picker searches and picks; thinking picker round-trips", async ({ page }) => {
  await open(page);
  await page.getByTestId("model-picker").click();
  const popup = page.getByTestId("model-popup");
  await expect(popup.locator("li[role=option]")).toHaveCount(2);
  await page.getByTestId("model-search").fill("deep");
  await expect(popup.locator("li[role=option]")).toHaveCount(1);
  await page.getByTestId("model-search").press("Enter");
  await expect(page.getByTestId("model-popup")).toHaveCount(0);
  await expect(page.getByTestId("model-picker")).toContainText("Fake Deep");
  await page.getByTestId("thinking-picker").selectOption("high");
  await expect(page.getByTestId("thinking-picker")).toHaveValue("high");
});

test("memory tab shows, edits and rolls back the hip memory", async ({ page }) => {
  await open(page);
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

test("sessions tab lists the current conversation; New Conversation resets the name", async ({ page }) => {
  await open(page);
  await page.getByRole("tab", { name: "sessions" }).click();
  await expect(page.getByTestId("sessions").locator("li")).toHaveCount(1);
  await page.getByTestId("new-session").click();
  await expect(page.getByTestId("session-name")).toHaveText("New Conversation");
});

test("dropped node paths become chips and ride along with the prompt", async ({ page }) => {
  await open(page);
  await page.getByTestId("chat").dispatchEvent("drop", {
    dataTransfer: await page.evaluateHandle(() => {
      const dt = new DataTransfer();
      dt.setData("text/plain", "/obj/geo1/wire1\n/obj/envlight1");
      return dt;
    }),
  });
  await expect(page.getByTestId("node-chips").locator(".chip")).toHaveCount(2);
  await page.getByTestId("prompt").fill("make these red");
  await page.getByTestId("send").click();
  await expect(page.getByTestId("user-bubble")).toContainText("Nodes: `/obj/geo1/wire1`, `/obj/envlight1`");
  await expect(page.getByTestId("node-chips")).toHaveCount(0);
});

test("a wrong token never reaches the sidecar", async ({ page }) => {
  await page.goto("/?token=wrong");
  await expect(page.getByTestId("status")).toBeVisible();
  await expect(page.getByTestId("prompt")).toBeDisabled();
});
