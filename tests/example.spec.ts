import test from "@playwright/test";

const locationNumber = "80511";

test("sign in", async ({ page }) => {
  const waitTime = 1500;

  await page.goto("https://m.paybyphone.com/", {
    waitUntil: "domcontentloaded",
  });
  await page.setViewportSize({ width: 1280, height: 720 });

  await page.locator("canvas").click({
    position: { x: 975, y: 600 },
    force: true,
  });
  await page.waitForTimeout(waitTime);

  await page.locator("canvas").click({
    position: { x: 400, y: 650 },
    force: true,
  });
  await page.waitForTimeout(waitTime);

  await page.locator("canvas").click({
    position: { x: 400, y: 625 },
    force: true,
  });
  await page.waitForTimeout(waitTime);

  await page.mouse.wheel(0, 1000);

  await page.locator("canvas").click({
    position: { x: 650, y: 700 },
    force: true,
  });
  await page.waitForTimeout(waitTime);

  await page.locator("canvas").click({
    position: { x: 650, y: 700 },
    force: true,
  });
  await page.waitForTimeout(waitTime * 5);

  // signed in

  await page.locator("canvas").click({
    position: { x: 650, y: 180 },
    force: true,
  });
  await page.waitForTimeout(waitTime);

  await page.keyboard.type(locationNumber);
  await page.keyboard.press("Enter");

  await page.pause();
});
