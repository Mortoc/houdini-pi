import { expect, test } from "@playwright/test";

const PAGE = "/?token=e2e";

async function open(page: import("@playwright/test").Page) {
  await page.goto(PAGE);
  await expect(page.getByTestId("status")).toHaveCount(0);
  await expect(page.getByTestId("prompt")).toBeEnabled();
  await expect(page.getByTestId("send")).toHaveText("send");
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
  await expect(cards).toHaveCount(4);
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
  const short = cards.nth(2).getByTestId("code-block");
  await expect(short).toHaveClass(/fits/);
  expect(await short.evaluate((el) => el.scrollHeight > el.clientHeight), "a one-liner gets no scrollbar").toBe(false);
  await expect(page.getByTestId("assistant-bubble")).toContainText("I would make the wires thinner");
  await expect(python.getByTestId("tool-result")).toHaveCount(0);
  const failed = cards.nth(2);
  await expect(failed.getByTestId("tool-result")).toContainText("AttributeError: 'NoneType' object has no attribute 'destroy'");
  await expect(failed.getByTestId("tool-result")).toHaveClass(/error/);
  await expect(failed.getByTestId("copy-button")).toHaveCount(2);
  const inspect = cards.nth(3);
  await expect(inspect.locator(".tool-name")).toHaveText("inspect COP");
  const image = inspect.getByTestId("tool-image");
  await expect(image).toHaveClass(/thumb/);
  await image.click();
  await expect(image).toHaveClass(/expanded/);
  await image.click();
  await expect(image).toHaveClass(/thumb/);
  await expect(page.getByTestId("turn-footer")).toContainText("Done, 1 tool error");
  await expect(page.getByTestId("turn-footer").locator(".verdict")).toHaveCSS("color", "rgb(230, 126, 34)");
  await expect(page.getByTestId("thinking")).toHaveCount(0);
  await expect(page.getByTestId("session-name")).toContainText("Named:");
});

test("scrolling up suspends follow-to-bottom until the reader jumps back", async ({ page }) => {
  await open(page);
  await page.setViewportSize({ width: 900, height: 420 });
  for (const n of [1, 2, 3]) {
    await page.getByTestId("prompt").fill(`turn ${n}`);
    await page.getByTestId("prompt").press("Enter");
    await expect(page.getByTestId("turn-footer")).toContainText("Done");
    await expect(page.getByTestId("send")).toHaveText("send");
  }
  const chat = page.getByTestId("chat");
  expect(await chat.evaluate((el) => el.scrollHeight > el.clientHeight), "needs overflow to test scrolling").toBe(true);
  await chat.evaluate((el) => { el.scrollTop = 0; el.dispatchEvent(new Event("scroll")); });
  await expect(page.getByTestId("jump-down")).toBeVisible();
  await page.getByTestId("prompt").fill("turn 4");
  await page.getByTestId("prompt").press("Enter");
  await expect(page.getByTestId("send")).toHaveText("send");
  expect(await chat.evaluate((el) => el.scrollTop)).toBeLessThan(40);
  await page.getByTestId("jump-down").click();
  await expect(page.getByTestId("jump-down")).toHaveCount(0);
  expect(await chat.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(50);
});

test("code blocks copy to the clipboard", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await open(page);
  await page.getByTestId("prompt").fill("copy me");
  await page.getByTestId("prompt").press("Enter");
  const code = page.getByTestId("code-block").first();
  await expect(code).toBeVisible();
  await code.locator("..").getByTestId("copy-button").click();
  await expect(code.locator("..").getByTestId("copy-button")).toHaveText("copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("thin every wire");
});

test("the activity line shows what the agent is doing and leaves when it is done", async ({ page }) => {
  await open(page);
  await expect(page.getByTestId("activity")).toHaveCount(0);
  await page.getByTestId("prompt").fill("go");
  await page.getByTestId("prompt").press("Enter");
  const activity = page.getByTestId("activity");
  await expect(activity).toBeVisible();
  await expect(activity.locator(".thinking-dots i")).toHaveCount(3);
  await expect(activity).toContainText(/thinking|Looking at|running|waiting/);
  await expect(page.getByTestId("send")).toHaveText("send");
  await expect(activity).toHaveCount(0);
  await expect(page.getByTestId("thinking")).toHaveCount(0);
  await expect(page.getByTestId("undo-turn")).toHaveCount(0);
});

test("stop halts the turn; Undo reverts it and hands the message back", async ({ page }) => {
  await open(page);
  await page.getByTestId("prompt").fill("go slow");
  await page.getByTestId("prompt").press("Enter");
  await expect(page.getByTestId("assistant-bubble").last().getByTestId("tool-card").first()).toBeVisible();
  const stop = page.getByTestId("activity").getByTestId("abort");
  await expect(stop).toContainText("stop");
  await expect(stop.locator("svg")).toHaveCount(1);
  await stop.click();
  await expect(page.getByTestId("turn-footer")).toContainText("Aborted");
  await expect(page.getByTestId("send")).toHaveText("send");
  await expect(page.getByTestId("activity")).toHaveCount(0);
  const before = await page.getByTestId("user-bubble").count();
  await page.getByTestId("undo-turn").click();
  await expect(page.getByTestId("prompt")).toHaveValue("go slow");
  await expect(page.getByTestId("user-bubble")).toHaveCount(before - 1);
  await expect(page.getByTestId("turn-footer")).toHaveCount(0);
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
  await page.getByTestId("thinking-picker").click();
  await page.getByTestId("thinking-picker-list").getByRole("option", { name: "thinking: high" }).click();
  await expect(page.getByTestId("thinking-picker")).toHaveAttribute("data-value", "high");
  await expect(page.getByTestId("thinking-picker-list")).toHaveCount(0);
  await expect(page.getByTestId("link-picker")).toHaveAttribute("data-value", "none");
  await page.getByTestId("link-picker").click();
  await page.getByTestId("link-picker-list").getByRole("option", { name: "Link 2" }).click();
  await expect(page.getByTestId("link-picker")).toHaveAttribute("data-value", "2");
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

test("reloading the pane replays tool cards and errors from history", async ({ page }) => {
  await open(page);
  await page.getByTestId("prompt").fill("remember this");
  await page.getByTestId("prompt").press("Enter");
  await expect(page.getByTestId("send")).toHaveText("steer");
  await expect(page.getByTestId("send")).toHaveText("send");
  await page.reload();
  await expect(page.getByTestId("send")).toHaveText("send");
  const bubbles = page.getByTestId("assistant-bubble");
  await expect(bubbles.last()).toContainText("I would make the wires thinner");
  const cards = bubbles.last().getByTestId("tool-card");
  await expect(cards).toHaveCount(4);
  await expect(cards.nth(2).getByTestId("tool-result")).toContainText("AttributeError");
  await expect(cards.nth(3).getByTestId("tool-image")).toBeVisible();
});

test("a wrong token never reaches the sidecar", async ({ page }) => {
  await page.goto("/?token=wrong");
  await expect(page.getByTestId("status")).toBeVisible();
  await expect(page.getByTestId("prompt")).toBeDisabled();
});
