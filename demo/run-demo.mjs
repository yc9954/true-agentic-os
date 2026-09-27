// Full functional demo of True Agentic OS:
//  1. Connect the fleet (real Linux desktops boot over noVNC)
//  2. Customize tab — live accent theme + orchestrator model (both wired)
//  3. Automations tab — a ComfyUI/n8n-style canvas where the distribution is
//     ASSEMBLED, then "Run on fleet"
//  4. Fleet view — the 3 machines work in parallel (node-2 does a real WebSearch),
//     and the orchestrator synthesizes one combined answer in the chat
//  5. New Task — clears the conversation (tab is functional)
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, "../recordings");
fs.mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE ?? "http://localhost:4000";
const VW = 1600, VH = 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (page, name) => page.screenshot({ path: path.join(OUT, name) }).catch(() => {});

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: VW, height: VH },
  recordVideo: { dir: OUT, size: { width: VW, height: VH } },
});
const page = await ctx.newPage();
const video = page.video();

try {
  // ---- 1. Connect ----------------------------------------------------------
  await page.goto(BASE);
  const connectBtn = page.locator('[data-testid="connect-btn"]');
  const alreadyConnected = page.locator('[data-testid="node-select"]');
  await Promise.race([
    connectBtn.waitFor({ timeout: 30000 }).then(() => "connect"),
    alreadyConnected.waitFor({ timeout: 30000 }).then(() => "connected"),
  ]);
  if (await connectBtn.isVisible().catch(() => false)) {
    await sleep(3000);
    await page.click('[data-testid="connect-btn"]');
  }
  await page.locator('[data-testid="node-select"]').waitFor({ timeout: 40000 });
  await sleep(9000); // desktops render
  await shot(page, "01-fleet.png");

  // ---- 2. Customize (AgentOS harness + routing profile) ---------------------
  await page.click('[data-testid="nav-customize"]');
  await page.locator('[data-testid="mode-auto"]').waitFor({ timeout: 10000 });
  await sleep(1800);
  await page.click('[data-testid="mode-distribute"]'); // POSTs /api/settings -> "saved"
  await sleep(1400);
  await page.click('[data-testid="mode-auto"]');
  await sleep(1200);
  await shot(page, "02-customize.png");

  // ---- 3. Automations canvas -----------------------------------------------
  await page.click('[data-testid="nav-automations"]');
  await page.locator('[data-testid="run-pipeline"]').waitFor({ timeout: 10000 });
  await sleep(2500);
  await shot(page, "03-automations.png");
  // show steps are assemblable: add one (it auto-wires in), then remove it and
  // run the clean pre-wired web+file+analyze pipeline
  await page.click('[data-testid="add-step-custom"]').catch(() => {});
  await sleep(2200);
  await shot(page, "03b-automations-add.png");
  await page.locator('[data-testid="remove-step"]').last().click().catch(() => {});
  await sleep(1500);
  await page.click('[data-testid="run-pipeline"]');     // dispatch + jump to Fleet view

  // ---- 4. Fleet — watch the distributed run + synthesis --------------------
  await page.locator('[data-testid="node-select"]').waitFor({ timeout: 15000 });
  await sleep(22000); // machines working — node-2 is running a real WebSearch on screen
  await shot(page, "04-running.png");

  // wait for the orchestrator's synthesized answer to appear, then let it stream
  await page.getByText("Synthesis", { exact: false }).first().waitFor({ timeout: 220000 }).catch(() => {});
  await sleep(16000);
  await shot(page, "05-synthesis.png");
  await page.screenshot({ path: path.join(OUT, "poster.png") }).catch(() => {});

  // ---- 5. New Task ---------------------------------------------------------
  await page.click('[data-testid="nav-new-task"]');
  await sleep(2500);
  await shot(page, "06-newtask.png");
  await sleep(1500);
} catch (err) {
  console.error("DEMO ERROR:", err?.message ?? err);
} finally {
  await ctx.close();
  await browser.close();
}

const vpath = await video.path();
fs.renameSync(vpath, path.join(OUT, "demo.webm"));
console.log("VIDEO:", path.join(OUT, "demo.webm"));
