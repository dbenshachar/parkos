import "server-only";
import { Page } from "playwright";

export interface PayByPhoneInfo {
  locationNumber: string;
  cardNumber: string;
  cardCCV: string;
  cardExpiration: string;
  email: string;
  zipCode: string;
  duration: string;
  license: string;
  userName: string;
}

const waitTime = 2000;
export const processPayByPhonePayment = async (
  page: Page,
  info: PayByPhoneInfo,
) => {
  const {
    locationNumber,
    cardNumber,
    cardCCV,
    cardExpiration,
    email,
    zipCode,
    duration,
    license,
    userName,
  } = info;

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
  await page.keyboard.type(license);
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
  await page.waitForTimeout(waitTime);

  // click add vechile
  await page.locator("canvas").click({
    position: { x: 700, y: 700 },
    force: true,
  });
  await page.waitForTimeout(waitTime);

  // enter duration
  await page.locator("canvas").click({
    position: { x: 605, y: 461 },
    force: true,
  });
  await page.keyboard.type(duration);
  await page.waitForTimeout(waitTime);

  // click continue
  await page.locator("canvas").click({
    position: { x: 535, y: 519 },
    force: true,
  });
  await page.waitForTimeout(waitTime);

  // skip phone number
  await page.locator("canvas").click({
    position: { x: 650, y: 683 },
    force: true,
  });
  await page.waitForTimeout(waitTime);

  await page.locator("canvas").click({
    position: { x: 546, y: 575 },
    force: true,
  });
  await page.waitForTimeout(waitTime);

  await page.locator("canvas").click({
    position: { x: 528, y: 689 },
    force: true,
  });
  await page.waitForTimeout(waitTime);

  // add credit card info
  await page.locator("canvas").click({
    position: { x: 419, y: 187 },
    force: true,
  });
  await page.keyboard.type(cardNumber);
  await page.waitForTimeout(waitTime);

  await page.locator("canvas").click({
    position: { x: 417, y: 245 },
    force: true,
  });
  await page.keyboard.type(cardExpiration);
  await page.waitForTimeout(waitTime);

  await page.locator("canvas").click({
    position: { x: 722, y: 256 },
    force: true,
  });
  await page.keyboard.type(cardCCV);
  await page.waitForTimeout(waitTime);

  await page.locator("canvas").click({
    position: { x: 446, y: 308 },
    force: true,
  });
  await page.keyboard.type(userName);
  await page.waitForTimeout(waitTime);

  await page.locator("canvas").click({
    position: { x: 464, y: 408 },
    force: true,
  });
  await page.keyboard.type(email);
  await page.waitForTimeout(waitTime);

  await page.locator("canvas").click({
    position: { x: 384, y: 491 },
    force: true,
  });
  await page.keyboard.type(zipCode);
  await page.waitForTimeout(waitTime);

  await page.locator("canvas").click({
    position: { x: 629, y: 683 },
    force: true,
  });
  await page.waitForTimeout(waitTime * 5);

  await page.locator("canvas").click({
    position: { x: 638, y: 633 },
    force: true,
  });
  await page.waitForTimeout(waitTime);

  await page.locator("canvas").click({
    position: { x: 636, y: 659 },
    force: true,
  });
};
