// Short product demo (< 60s): connect the fleet, show autonomous workers,
// expanded remote control, AgentOS harness builder, automation canvas, and run.
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

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: VW, height: VH },
  recordVideo: { dir: OUT, size: { width: VW, height: VH } },
});
const page = await ctx.newPage();
const video = page.video();

try {
  await page.goto(BASE);

  // 0. Start from the connector: choose other computers and bring them online.
  await page.locator('[data-testid="connect-btn"]').waitFor({ timeout: 30000 });
  await sleep(4500);
  const connectBtn = page.locator('[data-testid="connect-btn"]');
  const nodeSelect = page.locator('[data-testid="node-select"]');
  const alreadyConnected = await nodeSelect.isVisible({ timeout: 8000 }).catch(() => false);
  if (!alreadyConnected && await connectBtn.isVisible({ timeout: 8000 }).catch(() => false)) {
    await connectBtn.click();
  }
  await nodeSelect.waitFor({ timeout: 40000 });
  await sleep(5500);

  // 1. Fleet view: real desktops + collaboration strip + per-node work plans.
  await page.screenshot({ path: path.join(OUT, "short-01-fleet.png") }).catch(() => {});
  await sleep(7000);

  // 2. Chrome Remote Desktop-style expanded node.
  await page.locator('[aria-label="Open node-1 remote desktop"]').click({ timeout: 10000 });
  await sleep(6500);
  await page.screenshot({ path: path.join(OUT, "short-02-expanded-node.png") }).catch(() => {});
  await page.keyboard.press("Escape");
  await sleep(800);

  // 3. AgentOS Customize: local harness builder + hooks/skills/agents.
  await page.click('[data-testid="nav-customize"]');
  await sleep(2200);
  await page.getByPlaceholder("e.g. Workspace preflight").fill("Demo handoff skill");
  await page.getByPlaceholder("before_worker_dispatch").fill("after_node_done");
  await page.getByPlaceholder("Describe what this hook, skill, or agent should do locally...").fill(
    "Summarize the node workspace, cite generated artifacts, and leave a concise markdown handoff for synthesis.",
  );
  await sleep(1200);
  await page.getByRole("button", { name: /Build local asset/i }).click();
  await sleep(2500);
  await page.screenshot({ path: path.join(OUT, "short-03-harness-builder.png") }).catch(() => {});

  // 4. Automations canvas: assemble how work is distributed.
  await page.click('[data-testid="nav-automations"]');
  await page.locator('[data-testid="run-pipeline"]').waitFor({ timeout: 10000 });
  await sleep(5500);
  await page.screenshot({ path: path.join(OUT, "short-04-automations.png") }).catch(() => {});
  await page.click('[data-testid="run-pipeline"]');
  await sleep(12000);
  await page.screenshot({ path: path.join(OUT, "poster-short.png") }).catch(() => {});
} catch (err) {
  console.error("SHORT DEMO ERROR:", err?.message ?? err);
} finally {
  await ctx.close();
  await browser.close();
}

const vpath = await video.path();
const target = path.join(OUT, "demo-short.webm");
fs.renameSync(vpath, target);
console.log("VIDEO:", target);
