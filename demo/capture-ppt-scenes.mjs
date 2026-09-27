// Capture high-signal stills for presentation slides.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, "../recordings/ppt-scenes");
fs.mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE ?? "http://localhost:4000";
const VW = 1600, VH = 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (page, name) => page.screenshot({ path: path.join(OUT, name), fullPage: false });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: VW, height: VH } });
const page = await ctx.newPage();

try {
  await page.goto(BASE);

  // 1. Connector / onboarding.
  await page.locator('[data-testid="connect-btn"]').waitFor({ timeout: 30000 });
  await sleep(1200);
  await shot(page, "01-connect-fleet.png");

  // 2. Connected fleet: different Linux desktops + collaboration overlay.
  await page.click('[data-testid="connect-btn"]');
  await page.locator('[data-testid="node-select"]').waitFor({ timeout: 40000 });
  await sleep(6500);
  await shot(page, "02-fleet-collaboration.png");

  // 3. Expanded remote desktop.
  await page.locator('[aria-label="Open node-1 remote desktop"]').click({ timeout: 10000 });
  await sleep(2500);
  await shot(page, "03-expanded-node-remote.png");
  await page.keyboard.press("Escape");
  await sleep(800);

  // 4. AgentOS harness builder.
  await page.click('[data-testid="nav-customize"]');
  await sleep(1200);
  await shot(page, "04-agentos-harness-builder.png");

  // 5. Automations canvas.
  await page.click('[data-testid="nav-automations"]');
  await page.locator('[data-testid="run-pipeline"]').waitFor({ timeout: 10000 });
  await sleep(1800);
  await shot(page, "05-automation-canvas.png");

  // 6. Running distributed work.
  await page.click('[data-testid="run-pipeline"]');
  await page.locator('[data-testid="node-select"]').waitFor({ timeout: 15000 });
  await sleep(5500);
  await shot(page, "06-running-autonomous-workers.png");
} finally {
  await browser.close();
}

console.log("PPT_SCENES:", OUT);
