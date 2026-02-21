import { defineConfig, devices } from "@playwright/test";
import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";

chromium.use(stealth());

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    trace: "on-first-retry",
    headless: false,
    // This handles the location popup automatically
    permissions: ["geolocation"],
    geolocation: { latitude: 34.0522, longitude: -118.2437 }, // Example: LA
    launchOptions: {
      args: ["--disable-blink-features=AutomationControlled"],
    },
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
