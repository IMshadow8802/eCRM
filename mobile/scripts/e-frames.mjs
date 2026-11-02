// Renders every frame of design E to e2e-shots/e/{frame}.png (Task 39, §5.2).
// Run from mobile/: node scripts/e-frames.mjs [frame ...]
// Headless Brave, one page per frame: the frame is lifted out of the gallery
// and drawn alone at 390 × 844 (phone, scale 3) or 1194 × 834 (tablet, scale 2),
// so it lines up with an app shot taken at the same dp size.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "../docs/superpowers/specs/2026-11-02-mobile-redesign/direction-e-blend.html");
const out = join(root, "e2e-shots/e");
const pages = join(out, "html");
mkdirSync(pages, { recursive: true });

const BRAVE = "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser";
const html = readFileSync(source, "utf8");
const captions = [...html.matchAll(/<figcaption>([0-9T][0-9a-c]*) ·/g)].map((m) => m[1]);
const wanted = process.argv.slice(2);

captions.forEach((frame, index) => {
  if (wanted.length && !wanted.includes(frame)) return;
  const tablet = frame.startsWith("T");
  const [w, h, scale] = tablet ? [1194, 834, 2] : [390, 844, 3];
  // Lift figure #index's device out of the page; drop the bezel and corners.
  const lift = `<script>addEventListener("DOMContentLoaded",()=>{
    const dev=document.querySelectorAll("figure")[${index}].querySelector(".ph,.tab");
    // Keep the icon sprite (an svg of <symbol>s every <use> points at).
    document.body.replaceChildren(document.querySelector('svg[width="0"]'), dev);
    document.body.style.cssText="margin:0;padding:0;background:#fff;overflow:hidden";
    dev.style.cssText+=";border-radius:0;box-shadow:none;margin:0";
  });</script>`;
  const page = join(pages, `${frame}.html`);
  writeFileSync(page, html.replace("</body>", `${lift}</body>`));
  execFileSync(BRAVE, [
    "--headless=new", "--disable-gpu", "--hide-scrollbars", `--force-device-scale-factor=${scale}`,
    `--window-size=${w},${h}`, `--screenshot=${join(out, `${frame}.png`)}`, `file://${page}`,
  ], { stdio: "ignore", timeout: 60_000 });
  console.log(frame);
});
