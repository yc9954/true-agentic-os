// Visible web browsing on the node's real desktop. Launches a HEADED Chromium
// on DISPLAY=:1 (so it streams over noVNC), runs a real search, visibly opens
// the top result, and extracts titles + URLs + snippets into findings.md.
// Driven by the orchestrator's "Web Browse" op:  node agent-browse.mjs "<query>"
import { chromium } from "playwright";
import { execSync } from "node:child_process";
import fs from "node:fs";

const query = process.argv.slice(2).join(" ").trim() || "AI agent market 2026";
const OUT = process.env.OUT || "/home/node/work/findings.md";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function displayGeom() {
  try {
    const g = execSync("xdotool getdisplaygeometry", { env: { ...process.env, DISPLAY: ":1" } })
      .toString().trim().split(/\s+/).map(Number);
    if (g.length === 2 && g[0] > 0) return { w: g[0], h: g[1] };
  } catch {}
  return { w: 1280, h: 800 };
}
function maximizeChromium() {
  try {
    execSync(
      'wid=$(xdotool search --class chromium 2>/dev/null | tail -1); ' +
      '[ -n "$wid" ] && wmctrl -ir "$wid" -b add,maximized_vert,maximized_horz',
      { shell: "/bin/bash", env: { ...process.env, DISPLAY: ":1" } },
    );
  } catch {}
}

const { w, h } = displayGeom();

const browser = await chromium.launch({
  headless: false,
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--start-maximized",
    `--window-size=${w},${h}`,
    "--window-position=0,0",
    "--disable-gpu",
  ],
});
const ctx = await browser.newContext({ viewport: null, locale: "en-US" });
const page = await ctx.newPage();

let results = [];
try {
  // --- Bing: type the query visibly, submit, read the results page ---------
  await page.goto("https://www.bing.com/", { waitUntil: "domcontentloaded", timeout: 30000 });
  await sleep(800);
  maximizeChromium();
  const box = page.locator("#sb_form_q");
  await box.click({ timeout: 8000 });
  await box.type(query.slice(0, 200), { delay: 55 }); // visible typing
  await sleep(500);
  await page.keyboard.press("Enter");
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(2800);

  results = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll("li.b_algo").forEach((el) => {
      const a = el.querySelector("h2 a");
      const p = el.querySelector(".b_caption p") || el.querySelector("p");
      const cite = el.querySelector("cite");
      if (a && a.href)
        out.push({ title: a.innerText.trim(), url: a.href, cite: cite ? cite.innerText.trim() : "", snippet: p ? p.innerText.trim() : "" });
    });
    return out.slice(0, 8);
  });
  // Bing wraps result links in a /ck/a redirect with the real URL base64url'd in
  // the u=a1… param — decode it back to the clean source URL.
  for (const r of results) {
    const m = /[?&]u=a1([^&]+)/.exec(r.url);
    if (m) {
      try {
        const b = m[1].replace(/-/g, "+").replace(/_/g, "/");
        const dec = Buffer.from(b + "=".repeat((4 - (b.length % 4)) % 4), "base64").toString("utf8");
        if (/^https?:\/\//.test(dec)) r.url = dec;
      } catch {}
    }
    if (!/^https?:\/\//.test(r.url) && r.cite) r.url = r.cite;
  }

  // --- visibly open the top result so you SEE navigation ------------------
  if (results.length) {
    try {
      await page.locator("li.b_algo h2 a").first().click({ timeout: 6000 });
      await page.waitForLoadState("domcontentloaded", { timeout: 12000 }).catch(() => {});
      await page.waitForTimeout(3500);
      await page.mouse.wheel(0, 1200);
      await page.waitForTimeout(2000);
    } catch {}
  }
} catch (e) {
  console.error("browse error:", e?.message ?? e);
}

const md =
  `# Web findings — "${query}"\n\n` +
  `_Gathered by opening a real browser on this machine and searching the live web._\n\n` +
  (results.length
    ? results.map((r) => `- **${r.title}**\n  ${r.snippet}\n  ${r.url}`).join("\n\n")
    : "_No results extracted from the page._");
fs.writeFileSync(OUT, md + "\n");
console.log(`wrote ${results.length} results -> ${OUT}`);

await page.waitForTimeout(1500);
await browser.close().catch(() => {});
process.exit(0);
