// Korean product demo: connect computers, direct-control a node, configure
// AgentOS harness, then show distributed local model training across machines.
import { chromium } from "playwright";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, "../recordings");
fs.mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE ?? "http://localhost:4000";
const VW = 1600, VH = 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- sync captions to REAL events by inspecting the live containers ----------
function dockerHas(container, pgrepPattern) {
  try {
    execSync(`docker exec ${container} pgrep -f ${JSON.stringify(pgrepPattern)}`, { stdio: "ignore", timeout: 6000 });
    return true;
  } catch { return false; }
}
function fileNonEmpty(container, file) {
  try {
    execSync(`docker exec ${container} bash -lc ${JSON.stringify(`test -s ~/work/${file}`)}`, { stdio: "ignore", timeout: 6000 });
    return true;
  } catch { return false; }
}
async function pollUntil(fn, { timeout = 20000, every = 600 } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { try { if (fn()) return true; } catch {} await sleep(every); }
  return false;
}
// bring the headed Chromium window to the front so it's the visible window when
// we focus the node (otherwise the claude xterm can sit on top of it)
function raiseBrowser(container) {
  try {
    execSync(`docker exec ${container} bash -lc ${JSON.stringify(
      'export DISPLAY=:1; wid=$(xdotool search --class chromium 2>/dev/null | tail -1); ' +
      '[ -z "$wid" ] && wid=$(xdotool search --class Chromium 2>/dev/null | tail -1); ' +
      '[ -z "$wid" ] && wid=$(xdotool search --name "Chromium" 2>/dev/null | tail -1); ' +
      '[ -n "$wid" ] && { xdotool windowactivate "$wid"; xdotool windowraise "$wid"; }; true'
    )}`, { stdio: "ignore", timeout: 6000 });
  } catch {}
}

// fast, human-looking typing (not clipboard paste)
async function type(loc, text, delay = 16) {
  await loc.click();
  await loc.fill("");
  await loc.pressSequentially(text, { delay });
}

async function caption(page, title, body) {
  await page.evaluate(({ title, body }) => {
    let el = document.getElementById("tao-demo-caption");
    if (!el) {
      el = document.createElement("div");
      el.id = "tao-demo-caption";
      el.style.cssText = `
        position: fixed; left: 34px; top: 34px; z-index: 999999;
        max-width: 760px; pointer-events: none;
        color: #e6edf3; font-family: -apple-system, BlinkMacSystemFont, "Pretendard", "Apple SD Gothic Neo", sans-serif;
        text-shadow: 0 2px 14px rgba(0,0,0,.72), 0 1px 2px rgba(0,0,0,.9);
      `;
      document.body.appendChild(el);
    }
    el.innerHTML = `
      <div style="font-size:30px;font-weight:800;letter-spacing:-.03em;line-height:1.22">${title}</div>
      <div style="margin-top:8px;font-size:16px;font-weight:500;color:rgba(230,237,243,.86);line-height:1.55">${body}</div>
    `;
  }, { title, body });
}

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: VW, height: VH },
  recordVideo: { dir: OUT, size: { width: VW, height: VH } },
});
const page = await ctx.newPage();
const video = page.video();

try {
  await page.goto(BASE);

  const NODES = ["tao-desk-node-1", "tao-desk-node-2", "tao-desk-node-3"];

  // (0) START FROM THE CONNECTOR — pick machines and power on the fleet
  await caption(page, "여러 컴퓨터를 하나의 AgentOS로 연결", "독립된 머신들을 선택해 함께 일하는 하나의 작업 환경으로 묶습니다.");
  await page.locator('[data-testid="connect-btn"]').waitFor({ timeout: 30000 });
  await sleep(1800);
  await page.click('[data-testid="connect-btn"]');
  // wait for the 3 live desktops to actually appear (no fake delay)
  await page.locator('[data-testid="node-select"]').first().waitFor({ timeout: 40000 });
  await page.locator('[data-testid^="vnc-node-"]').nth(2).waitFor({ timeout: 20000 }).catch(() => {});
  await sleep(1400);
  await caption(page, "3대의 독립 컴퓨터가 한 화면에 연결됐습니다", "각 타일은 진짜 리눅스 데스크톱입니다. 오케스트레이터가 요청을 알맞은 컴퓨터로 보냅니다.");
  await sleep(3800);
  await page.screenshot({ path: path.join(OUT, "ko-01-connected-fleet.png") }).catch(() => {});

  // (1) AgentOS harness — pick agents/hooks/skills (this is real config, injected
  //     into every worker prompt)
  await page.click('[data-testid="nav-customize"]');
  await caption(page, "AgentOS 하네스: 에이전트·훅·스킬을 직접 고릅니다", "선택한 항목은 모든 워커 프롬프트에 주입되어 컴퓨터들이 같은 규칙으로 협업합니다.");
  await sleep(800);
  await page.getByText("Source web research", { exact: true }).scrollIntoViewIfNeeded().catch(() => {});
  await page.getByText("Source web research", { exact: true }).click().catch(() => {});
  await sleep(450);
  await page.getByText("Source web research", { exact: true }).click().catch(() => {});
  await page.getByText("Markdown artifacts", { exact: true }).click().catch(() => {});
  await sleep(500);
  await page.getByText("Markdown artifacts", { exact: true }).click().catch(() => {});
  await sleep(900);
  await page.screenshot({ path: path.join(OUT, "ko-02-harness.png") }).catch(() => {});

  // (2) HERO — a REAL browser opens on the web-capable machine.
  //     The canvas pipeline's web step launches a headed Chromium on node-2.
  await page.click('[data-testid="nav-automations"]');
  await page.locator('[data-testid="run-pipeline"]').waitFor({ timeout: 10000 });
  await caption(page, "복잡한 작업은 캔버스에서 분해합니다", "web · file · analyze 단계를 각 컴퓨터에 배치합니다. node-2는 실제 브라우저로 웹을 검색합니다.");
  await type(page.locator("textarea").first(), "AI 에이전트 시장의 최신 동향을 웹에서 조사하고, 내부 문서와 지표를 합쳐 한국어로 정리해줘.");
  await sleep(1500);
  await page.screenshot({ path: path.join(OUT, "ko-03-canvas.png") }).catch(() => {});

  await page.click('[data-testid="run-pipeline"]');
  await caption(page, "node-2가 실제 브라우저를 엽니다", "WebSearch API가 아니라, 데스크톱 위에서 진짜 Chromium이 떠서 라이브 웹을 탐색합니다.");
  // wait until Chromium is actually running on node-2 (real sync, not a guess)
  await pollUntil(() => dockerHas("tao-desk-node-2", "chrome"), { timeout: 22000, every: 600 });
  await sleep(3500);                 // let it navigate to a real results page
  raiseBrowser("tao-desk-node-2");   // make the browser the frontmost window
  await page.locator('[aria-label="Open node-2 remote desktop"]').click({ timeout: 10000 }).catch(() => {});
  await sleep(2500);
  raiseBrowser("tao-desk-node-2");   // raise again now that the view is focused
  await sleep(5000);                 // watch the live web page in the focused view
  await page.screenshot({ path: path.join(OUT, "ko-04-web-browser.png") }).catch(() => {});
  await sleep(2000);
  await page.keyboard.press("Escape").catch(() => {});
  await sleep(700);

  // (3) DISTRIBUTED TRAINING — the orchestrator shards the dataset across the
  //     fleet. Caption only claims what is actually visible (the sharding).
  await caption(page, "분산 학습: 데이터셋을 shard로 나눠 분배합니다", "한 컴퓨터에만 있던 dataset.csv를 오케스트레이터가 조각내, 모든 컴퓨터에 나눠 동시에 학습시킵니다.");
  await page.locator('[data-testid="node-select"]').first().selectOption("train");
  await type(page.locator('[data-testid="composer-input"]').first(), "로컬 데이터셋을 노드별 shard로 나눠 분산 학습하고, 각 노드의 지표를 합쳐 모델을 만들어줘.");
  await sleep(300);
  await page.locator('[data-testid="send-btn"]').first().click();
  // sync: wait until every node has actually received its shard
  await pollUntil(() => NODES.every((c) => fileNonEmpty(c, "shard.csv")), { timeout: 12000, every: 500 });
  await sleep(3500);
  await page.screenshot({ path: path.join(OUT, "ko-05-sharding.png") }).catch(() => {});

  // (4) ORCHESTRATOR BRIEFING — the orchestrator narrates its plan + result live
  //     in the chat (host-side, reliable). Wait for the synthesis text to render.
  await caption(page, "오케스트레이터가 전략과 결과를 한국어로 브리핑", "데이터는 각 컴퓨터에 남고, 작은 통계만 모아 하나의 모델로 합칩니다.");
  // give the streamed Korean plan/synthesis time to appear, then capture
  await page.getByText(/shard|조각|통계|모델|분배|학습/).first().waitFor({ timeout: 9000 }).catch(() => {});
  await sleep(6500);
  await page.screenshot({ path: path.join(OUT, "ko-06-orchestrator-briefing.png") }).catch(() => {});

  await caption(page, "한 대의 AI가 아니라, 여러 컴퓨터가 함께 일하는 OS", "연결 · 하네스 설정 · 실제 브라우저 · 데이터 분산 학습 · 종합 브리핑까지 하나의 흐름으로.");
  await sleep(3500);
  await page.screenshot({ path: path.join(OUT, "poster-korean.png") }).catch(() => {});
} catch (err) {
  console.error("KOREAN DEMO ERROR:", err?.message ?? err);
} finally {
  await ctx.close();
  await browser.close();
}

const vpath = await video.path();
const target = path.join(OUT, "demo-korean.webm");
fs.renameSync(vpath, target);
console.log("VIDEO:", target);
