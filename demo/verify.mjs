import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, "../recordings");
const BASE = "http://localhost:4000";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errs = [];
page.on("console", (m) => m.type() === "error" && errs.push(m.text()));
page.on("pageerror", (e) => errs.push("PAGEERROR: " + e.message));

await page.goto(BASE);
await page.locator('[data-testid="connect-btn"]').waitFor({ timeout: 30000 });
await sleep(1200);
await page.screenshot({ path: path.join(OUT, "v_connect.png") });

// (b) add a machine
await page.fill('[data-testid="add-addr"]', "192.168.1.42");
await page.click('[data-testid="add-btn"]');
await page.locator('[data-testid="discover-node-4"]').waitFor({ timeout: 20000 });
await sleep(1000);
await page.screenshot({ path: path.join(OUT, "v_added.png") });

// (a) connect -> boots the machines
await page.click('[data-testid="connect-btn"]');
await page.locator('[data-testid="node-select"]').waitFor({ timeout: 30000 });
await sleep(22000); // let the powered-off desktops boot + center
await page.screenshot({ path: path.join(OUT, "v_booted.png") });

console.log("console errors:", errs.length ? errs : "none");
await browser.close();
