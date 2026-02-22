import { Locator, test } from "@playwright/test";

const spot_id = "80511";

const email = "a@a.com";
const phoneNumber = "4254920742";
const licensePlate = "7LBZ281";
const state = "California";
const cardExpiration = "12/27";
const ccv = "555";
const cardNumber = "4242424242424242";
const country = "United States";
const zipCode = "93407";
const userName = "John Smith";

const durationMinutes = "1";

// test("park_mobile", async ({ page }) => {
//   const randomDelay = (min: number, max: number) =>
//     Math.floor(Math.random() * (max - min + 1)) + min;

//   let mouseX = 640;
//   let mouseY = 360;

//   const humanScroll = async () => {
//     const amount = (Math.random() > 0.3 ? 1 : -1) * randomDelay(50, 250);
//     await page.mouse.wheel(0, amount);
//     await page.waitForTimeout(randomDelay(200, 600));
//   };

//   const humanInteract = async (
//     locator: Locator,
//     action: string,
//     value = "",
//   ) => {
//     const box = await locator.boundingBox();
//     if (!box) return;

//     const targetX =
//       box.x +
//       box.width / 2 +
//       (Math.random() * (box.width * 0.4) - box.width * 0.2);
//     const targetY =
//       box.y +
//       box.height / 2 +
//       (Math.random() * (box.height * 0.4) - box.height * 0.2);

//     const midX = (mouseX + targetX) / 2 + (Math.random() * 200 - 100);
//     const midY = (mouseY + targetY) / 2 + (Math.random() * 200 - 100);

//     await page.mouse.move(midX, midY, { steps: randomDelay(6, 14) });
//     await page.waitForTimeout(randomDelay(10, 50));
//     await page.mouse.move(targetX, targetY, { steps: randomDelay(8, 18) });

//     mouseX = targetX;
//     mouseY = targetY;

//     await page.waitForTimeout(randomDelay(50, 200));

//     if (action === "click" || action === "fill") {
//       await page.mouse.down();
//       await page.waitForTimeout(randomDelay(40, 120));
//       await page.mouse.up();
//     }

//     if (action === "fill") {
//       await page.waitForTimeout(randomDelay(50, 150));
//       await page.keyboard.type(value, { delay: randomDelay(60, 180) });
//     } else if (action === "selectOption") {
//       await locator.selectOption(value);
//     }

//     await page.waitForTimeout(randomDelay(150, 400));
//   };

//   await page.addInitScript(() => {
//     window.addEventListener("DOMContentLoaded", () => {
//       const coords = document.createElement("div");
//       coords.id = "mouse-coords";
//       Object.assign(coords.style, {
//         position: "fixed",
//         bottom: "20px",
//         right: "20px",
//         padding: "8px",
//         background: "rgba(0, 0, 0, 0.8)",
//         color: "#fff",
//         fontFamily: "monospace",
//         fontSize: "14px",
//         zIndex: "10000",
//         borderRadius: "4px",
//         pointerEvents: "none",
//       });
//       document.body.appendChild(coords);

//       const dot = document.createElement("div");
//       Object.assign(dot.style, {
//         position: "fixed",
//         width: "10px",
//         height: "10px",
//         background: "red",
//         borderRadius: "50%",
//         zIndex: "10001",
//         pointerEvents: "none",
//         transform: "translate(-50%, -50%)",
//       });
//       document.body.appendChild(dot);

//       window.addEventListener("mousemove", (e) => {
//         const tuple = `(${e.clientX}, ${e.clientY})`;
//         coords.textContent = tuple;
//         dot.style.left = `${e.clientX}px`;
//         dot.style.top = `${e.clientY}px`;
//       });
//     });
//   });

//   const now = new Date();
//   const stop = new Date(now.getTime() + durationMinutes * 60000);

//   const formatDate = (date: Date) => {
//     return date.toISOString().split(".")[0] + "-08:00";
//   };

//   const start_at = encodeURIComponent(formatDate(now));
//   const stop_at = encodeURIComponent(formatDate(stop));

//   const url = `https://app.parkmobile.io/checkout/reservation/${spot_id}?start_at=${start_at}&stop_at=${stop_at}&location_origin=flash&cart_id=0`;

//   await page.goto(url, {
//     waitUntil: "domcontentloaded",
//   });

//   await page.setViewportSize({ width: 1280, height: 720 });
//   await page.waitForTimeout(randomDelay(2500, 3500));

//   await humanScroll();

//   const emailInput = page
//     .locator("input[type='email'], input[name='email']")
//     .first();
//   await emailInput.waitFor({ state: "visible" });
//   await humanInteract(emailInput, "fill", email);

//   await humanScroll();

//   const phoneInput = page
//     .locator("input[type='tel'], input[name='phone']")
//     .first();
//   await humanInteract(phoneInput, "fill", phoneNumber);

//   await humanScroll();

//   const contactContinueBtn = page
//     .locator("button")
//     .filter({ hasText: /continue|next/i })
//     .first();
//   await contactContinueBtn.waitFor({ state: "visible" });
//   await humanInteract(contactContinueBtn, "click");

//   await page.waitForTimeout(randomDelay(800, 1500));
//   await humanScroll();

//   const plateInput = page.locator("input#vrn").first();
//   await plateInput.waitFor({ state: "visible", timeout: 15000 });
//   await humanInteract(plateInput, "fill", licensePlate);

//   await humanScroll();

//   const countrySelect = page.locator("select#country").first();
//   await humanInteract(countrySelect, "selectOption", country);

//   await humanScroll();

//   const stateSelect = page.locator("select#state").first();
//   await humanInteract(stateSelect, "selectOption", state);

//   await humanScroll();

//   const vehicleContinueBtn = page
//     .getByRole("button", { name: /continue|next|save/i })
//     .last();
//   await vehicleContinueBtn.waitFor({ state: "visible" });
//   await humanInteract(vehicleContinueBtn, "click");

//   await page.waitForTimeout(randomDelay(800, 1500));
//   await humanScroll();

//   const cardNumberInput = page
//     .locator('[data-pmtest-id="card-number-input"]')
//     .first();
//   await cardNumberInput.waitFor({ state: "visible", timeout: 15000 });
//   await humanInteract(cardNumberInput, "fill", cardNumber);

//   await humanScroll();

//   const cardholderNameInput = page
//     .locator('[data-pmtest-id="cardholder-name-input"]')
//     .first();
//   await humanInteract(cardholderNameInput, "fill", userName);

//   await humanScroll();

//   const expiryInput = page.locator('[data-pmtest-id="expiry-input"]').first();
//   await humanInteract(expiryInput, "fill", cardExpiration);

//   await humanScroll();

//   const securityCodeInput = page
//     .locator('[data-pmtest-id="security-code"]')
//     .first();
//   await humanInteract(securityCodeInput, "fill", ccv);

//   await humanScroll();

//   const zipCodeInput = page
//     .locator('[data-pmtest-id="zip-code-input"]')
//     .first();
//   await humanInteract(zipCodeInput, "fill", zipCode);

//   await humanScroll();

//   const billingCountrySelect = page
//     .locator('[data-pmtest-id="country-input"]')
//     .first();
//   await humanInteract(billingCountrySelect, "selectOption", country);

//   await humanScroll();

//   const cardContinueBtn = page
//     .getByRole("button", { name: /continue|next|save/i })
//     .last();
//   await cardContinueBtn.waitFor({ state: "visible" });
//   await humanInteract(cardContinueBtn, "click");

//   await humanScroll();

//   const resaleCheckbox = page
//     .locator('[data-pmtest-id="resale-disclaimer-checkbox"]')
//     .first();
//   await resaleCheckbox.waitFor({ state: "visible" });
//   await humanInteract(resaleCheckbox, "click");

//   await humanScroll();

//   const completePurchaseBtn = page
//     .locator('[data-pmtest-id="complete-purchase-button"]')
//     .first();
//   await completePurchaseBtn.waitFor({ state: "visible" });
//   await humanInteract(completePurchaseBtn, "click");

//   await page.pause();
// });

// test("pay_by_phone", async ({ page }) => {
//   const waitTime = 2000;

//   await page.addInitScript(() => {
//     window.addEventListener("DOMContentLoaded", () => {
//       const coords = document.createElement("div");
//       coords.id = "mouse-coords";
//       Object.assign(coords.style, {
//         position: "fixed",
//         bottom: "20px",
//         right: "20px",
//         padding: "8px",
//         background: "rgba(0, 0, 0, 0.8)",
//         color: "#fff",
//         fontFamily: "monospace",
//         fontSize: "14px",
//         zIndex: "10000",
//         borderRadius: "4px",
//         pointerEvents: "none",
//       });
//       document.body.appendChild(coords);

//       const dot = document.createElement("div");
//       Object.assign(dot.style, {
//         position: "fixed",
//         width: "10px",
//         height: "10px",
//         background: "red",
//         borderRadius: "50%",
//         zIndex: "10001",
//         pointerEvents: "none",
//         transform: "translate(-50%, -50%)",
//       });
//       document.body.appendChild(dot);

//       window.addEventListener("mousemove", (e) => {
//         const tuple = `(${e.clientX}, ${e.clientY})`;
//         coords.textContent = tuple;
//         dot.style.left = `${e.clientX}px`;
//         dot.style.top = `${e.clientY}px`;
//       });
//     });
//   });

//   await page.goto("https://m.paybyphone.com/", {
//     waitUntil: "domcontentloaded",
//   });
//   await page.setViewportSize({ width: 1280, height: 720 });

//   await page.locator("canvas").click({
//     position: { x: 975, y: 600 },
//     force: true,
//   });
//   await page.waitForTimeout(waitTime);

//   await page.locator("canvas").click({
//     position: { x: 400, y: 650 },
//     force: true,
//   });
//   await page.waitForTimeout(waitTime);

//   await page.locator("canvas").click({
//     position: { x: 400, y: 625 },
//     force: true,
//   });
//   await page.waitForTimeout(waitTime);

//   await page.mouse.wheel(0, 1000);

//   await page.locator("canvas").click({
//     position: { x: 650, y: 700 },
//     force: true,
//   });
//   await page.waitForTimeout(waitTime);

//   await page.locator("canvas").click({
//     position: { x: 650, y: 700 },
//     force: true,
//   });
//   await page.waitForTimeout(waitTime * 5);

//   // signed in

//   await page.locator("canvas").click({
//     position: { x: 650, y: 110 },
//     force: true,
//   });
//   await page.waitForTimeout(waitTime);

//   await page.keyboard.type(spot_id);
//   await page.keyboard.press("Enter");

//   await page.locator("canvas").click({
//     position: { x: 784, y: 664 },
//     force: true,
//   });
//   await page.waitForTimeout(waitTime * 2);

//   await page.locator("canvas").click({
//     position: { x: 610, y: 165 },
//     force: true,
//   });
//   await page.waitForTimeout(waitTime);

//   await page.locator("canvas").click({
//     position: { x: 630, y: 680 },
//     force: true,
//   });
//   await page.waitForTimeout(waitTime);

//   // state
//   await page.locator("canvas").click({
//     position: { x: 540, y: 400 },
//     force: true,
//   });
//   await page.waitForTimeout(waitTime);

//   // liscence
//   await page.locator("canvas").click({
//     position: { x: 580, y: 280 },
//     force: true,
//   });
//   await page.keyboard.type(licensePlate);
//   await page.waitForTimeout(waitTime);

//   await page.locator("canvas").click({
//     position: { x: 640, y: 351 },
//     force: true,
//   });
//   await page.waitForTimeout(waitTime);
//   await page.locator("canvas").click({
//     position: { x: 490, y: 513 },
//     force: true,
//   });

//   await page.locator("canvas").click({
//     position: { x: 525, y: 226 },
//     force: true,
//   });
//   await page.waitForTimeout(waitTime);

//   await page.locator("canvas").click({
//     position: { x: 514, y: 404 },
//     force: true,
//   });
//   await page.waitForTimeout(waitTime);

//   // click add vechile
//   await page.locator("canvas").click({
//     position: { x: 700, y: 700 },
//     force: true,
//   });
//   await page.waitForTimeout(waitTime);

//   // enter duration
//   await page.locator("canvas").click({
//     position: { x: 605, y: 461 },
//     force: true,
//   });
//   await page.keyboard.type(durationMinutes);
//   await page.waitForTimeout(waitTime);

//   // click continue
//   await page.locator("canvas").click({
//     position: { x: 535, y: 519 },
//     force: true,
//   });
//   await page.waitForTimeout(waitTime);

//   // skip phone number
//   await page.locator("canvas").click({
//     position: { x: 650, y: 683 },
//     force: true,
//   });
//   await page.waitForTimeout(waitTime);

//   await page.locator("canvas").click({
//     position: { x: 546, y: 575 },
//     force: true,
//   });
//   await page.waitForTimeout(waitTime);

//   await page.locator("canvas").click({
//     position: { x: 528, y: 689 },
//     force: true,
//   });
//   await page.waitForTimeout(waitTime);

//   // add credit card info
//   await page.locator("canvas").click({
//     position: { x: 419, y: 187 },
//     force: true,
//   });
//   await page.keyboard.type(cardNumber);
//   await page.waitForTimeout(waitTime);

//   await page.locator("canvas").click({
//     position: { x: 417, y: 245 },
//     force: true,
//   });
//   await page.keyboard.type(cardExpiration);
//   await page.waitForTimeout(waitTime);

//   await page.locator("canvas").click({
//     position: { x: 722, y: 256 },
//     force: true,
//   });
//   await page.keyboard.type(ccv);
//   await page.waitForTimeout(waitTime);

//   await page.locator("canvas").click({
//     position: { x: 446, y: 308 },
//     force: true,
//   });
//   await page.keyboard.type(userName);
//   await page.waitForTimeout(waitTime);

//   await page.locator("canvas").click({
//     position: { x: 464, y: 408 },
//     force: true,
//   });
//   await page.keyboard.type(email);
//   await page.waitForTimeout(waitTime);

//   await page.locator("canvas").click({
//     position: { x: 384, y: 491 },
//     force: true,
//   });
//   await page.keyboard.type(zipCode);
//   await page.waitForTimeout(waitTime);

//   await page.locator("canvas").click({
//     position: { x: 629, y: 683 },
//     force: true,
//   });
//   await page.waitForTimeout(waitTime * 5);

//   // click yes on credit card
//   await page.locator("canvas").click({
//     position: { x: 638, y: 633 },
//     force: true,
//   });
//   await page.waitForTimeout(waitTime);

//   await page.locator("canvas").click({
//     position: { x: 636, y: 659 },
//     force: true,
//   });

//   await page.pause();
// });
