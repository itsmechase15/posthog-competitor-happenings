import { readFile } from "node:fs/promises";
import { chromium, type Browser } from "playwright-core";
import { createLogger } from "../log.js";

const log = createLogger("card-render");

/**
 * Turning one static HTML card into a PNG.
 *
 * Chromium because the card is HTML and CSS, which is the only layout engine
 * worth writing a two-panel diff in. `playwright-core` rather than
 * `playwright`, so installing this app does not download a browser: the
 * daily job installs the headless shell in its own step, and a machine
 * without one falls back to an issue with text layers only. That fallback is
 * the whole contract of this module – it throws, and the caller opens the
 * issue anyway.
 */

/** A card is 720px wide, which is about as wide as GitHub renders an image. */
export const CARD_WIDTH = 720;

/** Retina, so the copy on the card is legible where GitHub scales it down. */
const SCALE = 2;

/** A render that has not finished by now is a render nobody is waiting for. */
const RENDER_TIMEOUT_MS = 20_000;

/**
 * The browsers to try, in order. The headless shell is the small download and
 * the one the workflows install; plain Chromium is what a developer machine
 * with `npx playwright install chromium` already has.
 */
const CHANNELS: Array<string | undefined> = ["chromium-headless-shell", undefined];

/**
 * Inter, read off disk and inlined as a data URL.
 *
 * Bundled rather than linked, because the render has no network and a card
 * that falls back to whatever font the runner happens to have installed is a
 * card that looks different every time the runner image changes. Missing
 * fonts cost the card its typeface and nothing else.
 */
const FONT_FILES = [
  { file: "inter-regular.woff2", weight: 400 },
  { file: "inter-semibold.woff2", weight: 600 },
];

let fontCss: string | undefined;

export async function loadFontCss(): Promise<string> {
  if (fontCss !== undefined) return fontCss;

  const faces: string[] = [];
  for (const { file, weight } of FONT_FILES) {
    // Resolved off this module rather than the working directory: the same
    // path has to work from `src/media` under tsx and `dist/media` after a
    // build, and both sit one directory below the repo root.
    const path = new URL(`../../assets/fonts/${file}`, import.meta.url);
    try {
      const bytes = await readFile(path);
      faces.push(
        [
          "@font-face {",
          "  font-family: 'Inter';",
          "  font-style: normal;",
          `  font-weight: ${weight};`,
          `  src: url(data:font/woff2;base64,${bytes.toString("base64")}) format('woff2');`,
          "}",
        ].join("\n"),
      );
    } catch (error) {
      log.warn(`could not read ${file}: ${error instanceof Error ? error.message : error}`);
    }
  }

  fontCss = faces.join("\n");
  return fontCss;
}

async function launch(): Promise<Browser> {
  const failures: string[] = [];
  for (const channel of CHANNELS) {
    try {
      return await chromium.launch(channel ? { channel } : {});
    } catch (error) {
      failures.push(`${channel ?? "chromium"}: ${error instanceof Error ? error.message : error}`);
    }
  }
  throw new Error(`no Chromium to render with (${failures.join("; ")})`);
}

/**
 * Screenshot one card. Throws when there is no browser to do it with, which is
 * a card without a picture rather than an issue without a card.
 */
export async function renderCardPng(html: string): Promise<Buffer> {
  const browser = await launch();
  try {
    const page = await browser.newPage({
      viewport: { width: CARD_WIDTH, height: 600 },
      deviceScaleFactor: SCALE,
    });
    page.setDefaultTimeout(RENDER_TIMEOUT_MS);
    await page.setContent(html, { waitUntil: "load" });
    // The card element rather than the viewport, so the PNG is exactly as tall
    // as the copy on it and a short edit does not ship 400px of white.
    return await page.locator(".card").screenshot({ type: "png" });
  } finally {
    await browser.close().catch(() => undefined);
  }
}
