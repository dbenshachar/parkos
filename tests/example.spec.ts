import test from "@playwright/test";

const locationNumber = "80511";
const liscence = "7LBZ281";

test("sign in", async ({ page }) => {
  const waitTime = 1500;

  await page.addInitScript(() => {
    window.addEventListener("DOMContentLoaded", () => {
      const coords = document.createElement("div");
      coords.id = "mouse-coords";
      Object.assign(coords.style, {
        position: "fixed",
        bottom: "20px",
        right: "20px",
        padding: "8px",
        background: "rgba(0, 0, 0, 0.8)",
        color: "#fff",
        fontFamily: "monospace",
        fontSize: "14px",
        zIndex: "10000",
        borderRadius: "4px",
        pointerEvents: "none",
      });
      document.body.appendChild(coords);

      const dot = document.createElement("div");
      Object.assign(dot.style, {
        position: "fixed",
        width: "10px",
        height: "10px",
        background: "red",
        borderRadius: "50%",
        zIndex: "10001",
        pointerEvents: "none",
        transform: "translate(-50%, -50%)",
      });
      document.body.appendChild(dot);

      window.addEventListener("mousemove", (e) => {
        const tuple = `(${e.clientX}, ${e.clientY})`;
        coords.textContent = tuple;
        dot.style.left = `${e.clientX}px`;
        dot.style.top = `${e.clientY}px`;
      });
    });
  });

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
    position: { x: 650, y: 110 },
    force: true,
  });
  await page.waitForTimeout(waitTime);

  await page.keyboard.type(locationNumber);
  await page.keyboard.press("Enter");

  await page.locator("canvas").click({
    position: { x: 784, y: 664 },
    force: true,
  });
  await page.waitForTimeout(waitTime * 2);

  await page.locator("canvas").click({
    position: { x: 610, y: 165 },
    force: true,
  });
  await page.waitForTimeout(waitTime);

  await page.locator("canvas").click({
    position: { x: 630, y: 680 },
    force: true,
  });
  await page.waitForTimeout(waitTime);

  // state
  await page.locator("canvas").click({
    position: { x: 540, y: 400 },
    force: true,
  });
  await page.waitForTimeout(waitTime);

  // liscence
  await page.locator("canvas").click({
    position: { x: 580, y: 280 },
    force: true,
  });
  await page.keyboard.type(liscence);
  await page.waitForTimeout(waitTime);

  await page.locator("canvas").click({
    position: { x: 640, y: 351 },
    force: true,
  });
  await page.waitForTimeout(waitTime);
  await page.locator("canvas").click({
    position: { x: 490, y: 513 },
    force: true,
  });

  await page.locator("canvas").click({
    position: { x: 525, y: 226 },
    force: true,
  });
  await page.waitForTimeout(waitTime);

  await page.locator("canvas").click({
    position: { x: 514, y: 404 },
    force: true,
  });

  await page.pause();
});
