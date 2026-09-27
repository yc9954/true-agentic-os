import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const url = process.env.URL ?? "http://localhost:6081/vnc.html?autoconnect=true&resize=scale&reconnect=true";
const out = process.env.OUT ?? path.resolve(__dirname, "../recordings/vnc1.png");

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: Number(process.env.VW ?? 1300), height: Number(process.env.VH ?? 840) },
});
const errs = [];
page.on("console", (m) => m.type() === "error" && errs.push(m.text()));
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(Number(process.env.WAIT ?? 6000));
await page.screenshot({ path: out });
console.log("shot:", out, "errors:", errs.length ? errs.slice(0, 3) : "none");
await browser.close();
