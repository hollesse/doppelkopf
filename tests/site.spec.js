import { test as base, expect } from "@playwright/test";
import languages from "../src/_data/languages.js";

// Every test fails if the page throws a JavaScript error.
const test = base.extend({
  page: async ({ page }, use) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await use(page);
    expect(errors, "JavaScript errors on the page").toEqual([]);
  },
});

// Relative to baseURL, e.g. "./" for English and "de/" for German.
const pathOf = (lang) => (lang.path === "/" ? "./" : lang.path.slice(1));
const byCode = Object.fromEntries(languages.map((lang) => [lang.code, lang]));

/** Opens a language page without being redirected by the start page. */
async function openLanguage(page, lang) {
  await page.addInitScript((code) => localStorage.setItem("lang", code), lang.code);
  await page.goto(pathOf(lang));
}

test.describe("every language page", () => {
  for (const lang of languages) {
    test(`${lang.code} renders its own texts`, async ({ page }) => {
      await openLanguage(page, lang);

      await expect(page).toHaveTitle(lang.t.title);
      await expect(page.locator("html")).toHaveAttribute("lang", lang.htmlLang);
      await expect(page.locator("html")).toHaveAttribute("dir", lang.dir);
      await expect(page.locator("h2").first()).toHaveText(lang.t.setupH);
      await expect(page.locator("#spickzettel h2")).toHaveText(lang.t.chH);
      await expect(page.locator(".langmenu a[aria-current=page]")).toHaveAttribute("data-lang", lang.code);

      // One hreflang link per language plus x-default, and a canonical URL.
      await expect(page.locator('link[rel=alternate][hreflang]')).toHaveCount(languages.length + 1);
      await expect(page.locator("link[rel=canonical]")).toHaveAttribute("href", lang.url);

      // No template leftovers or missing texts.
      const text = await page.locator("body").innerText();
      expect(text).not.toMatch(/undefined|\[object|\{\{|\{%|\{(mine|led|right|total)\}/);
    });

    test(`${lang.code} fits the screen width`, async ({ page }) => {
      await openLanguage(page, lang);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
});

test.describe("start page redirect", () => {
  const cases = [
    ["de-DE", "de"],
    ["de-AT", "de"],
    ["de-CH", "de"],
    ["en-US", "en"],
    ["fr-FR", "en"],
  ];
  for (const [locale, code] of cases) {
    test(`browser language ${locale} → ${code}`, async ({ browser, baseURL }) => {
      const context = await browser.newContext({ locale });
      const page = await context.newPage();
      await page.goto(baseURL);
      await expect(page).toHaveURL(byCode[code].url.replace(/^https:\/\/[^/]+/, new URL(baseURL).origin));
      await context.close();
    });
  }

  test("a language picked in the menu wins over the browser language", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ locale: "de-DE" });
    const page = await context.newPage();
    await page.goto(baseURL);
    await expect(page).toHaveURL(/\/de\/$/);

    await page.locator(".langmenu summary").click();
    await page.locator('.langmenu a[data-lang="en"]').click();
    await expect(page).toHaveURL(baseURL);

    await page.goto(baseURL);
    await expect(page).toHaveURL(baseURL);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await context.close();
  });

});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("the rules are readable and the menu works", async ({ page }) => {
    await page.goto("de/");
    await expect(page.locator("h1")).toContainText("Doppelkopf");
    await expect(page.locator("#truempfe h3").first()).toHaveText(byCode.de.t.tr1h);
    await expect(page.locator("#shurl")).toHaveText(byCode.de.url.replace("https://", ""));

    // Things that need JavaScript are hidden.
    await expect(page.locator("#ueben")).toBeHidden();
    await expect(page.locator('nav a[href="#ueben"]')).toBeHidden();
    await expect(page.locator("#shCopy")).toBeHidden();

    // The language menu is plain links.
    await page.locator(".langmenu summary").click();
    await page.locator('.langmenu a[data-lang="en"]').click();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });

  test("the start page stays English", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, locale: "de-DE" });
    const page = await context.newPage();
    await page.goto(baseURL);
    await expect(page).toHaveURL(baseURL);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await context.close();
  });
});

test.describe("practice quiz", () => {
  // The rules of a normal game, written down independently from rules.js.
  // Cards are read as "rank suit" in English letters, e.g. "Q♣".
  const TRUMP_ORDER = ["10♥", "Q♣", "Q♠", "Q♥", "Q♦", "J♣", "J♠", "J♥", "J♦", "A♦", "10♦", "K♦", "9♦"];
  const PLAIN_ORDER = ["A", "10", "K", "9"];
  const isTrump = (card) => TRUMP_ORDER.includes(card);
  const suit = (card) => card.slice(-1);
  const rank = (card) => card.slice(0, -1);

  function wins(led, mine) {
    if (led === mine) return false; // the first of two equal cards wins
    if (isTrump(mine) && isTrump(led)) return TRUMP_ORDER.indexOf(mine) < TRUMP_ORDER.indexOf(led);
    if (isTrump(mine)) return true;
    if (isTrump(led)) return false;
    if (suit(mine) !== suit(led)) return false;
    return PLAIN_ORDER.indexOf(rank(mine)) < PLAIN_ORDER.indexOf(rank(led));
  }

  const cardOf = async (locator) => (await locator.locator(".c").innerText()).replace(/\s/g, "");

  test("judges answers by the rules and counts the score", async ({ page }) => {
    // Seeded random numbers, so every run deals the same cards.
    await page.addInitScript(() => {
      let seed = 3;
      Math.random = () => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    });
    const lang = byCode.en;
    await openLanguage(page, lang);
    await expect(page.locator("#score")).toHaveText("0 of 0 correct");

    const seen = new Set();
    const rounds = 40;
    for (let round = 1; round <= rounds; round++) {
      const led = await cardOf(page.locator("#ledCard"));
      const mine = await cardOf(page.locator("#myCard"));
      if (led === mine) seen.add("same card");
      else if (isTrump(led) && isTrump(mine)) seen.add(`both trump, ${wins(led, mine) ? "higher" : "lower"}`);
      else if (isTrump(mine)) seen.add("trump beats plain");
      else if (isTrump(led)) seen.add("plain on trump");
      else if (suit(led) === suit(mine)) seen.add(`same suit, ${wins(led, mine) ? "higher" : "lower"}`);
      else seen.add("other suit");

      const answer = wins(led, mine) ? "Yes" : "No";
      await page.getByRole("button", { name: answer, exact: true }).click();
      await expect(page.locator("#fb .ok"), `${mine} after ${led}`).toHaveText(lang.t.quiz.right.trim());
      await expect(page.locator("#score")).toHaveText(`${round} of ${round} correct`);
      await page.getByRole("button", { name: lang.t.qNext }).click();
    }

    // The dealt cards covered every rule.
    for (const must of ["same card", "both trump, higher", "both trump, lower", "trump beats plain", "plain on trump", "same suit, higher", "same suit, lower", "other suit"]) {
      expect(seen, `dealt cards should include: ${must}`).toContain(must);
    }

    // A wrong answer is marked as wrong.
    const led = await cardOf(page.locator("#ledCard"));
    const mine = await cardOf(page.locator("#myCard"));
    await page.getByRole("button", { name: wins(led, mine) ? "No" : "Yes", exact: true }).click();
    await expect(page.locator("#fb .ko")).toBeVisible();
    await expect(page.locator("#score")).toHaveText(`${rounds} of ${rounds + 1} correct`);
  });

  test("feedback and card letters are in the page language", async ({ page }) => {
    await openLanguage(page, byCode.de);
    await expect(page.locator("#score")).toHaveText("0 von 0 richtig");
    await page.locator("#btns .yes").click();
    await expect(page.locator("#fb")).toContainText(/Richtig!|Nicht ganz\./);
    // German cards say B and D, never J and Q.
    const letters = new Set();
    for (let i = 0; i < 20; i++) {
      for (const id of ["#ledCard", "#myCard"]) letters.add((await cardOf(page.locator(id))).slice(0, -1));
      await page.locator("#next").click();
      await page.locator("#btns .yes").click();
    }
    expect([...letters].sort()).toEqual(expect.arrayContaining(["B", "D"]));
    expect([...letters]).not.toContain("J");
    expect([...letters]).not.toContain("Q");
    const pageLetters = await page.locator("main .card .c").evaluateAll((cards) => cards.map((c) => c.firstChild.textContent));
    expect(pageLetters).not.toContain("J");
    expect(pageLetters).not.toContain("Q");
  });
});

test.describe("share", () => {
  test("QR code and link point to the page itself", async ({ page }) => {
    const lang = byCode.de;
    await openLanguage(page, lang);
    await expect(page.locator("#shurl")).toHaveAttribute("href", lang.url);
    await expect(page.locator("#qr svg")).toBeVisible();
    await expect(page.locator("#shCopy")).toBeVisible();
  });
});

test.describe("self-contained", () => {
  for (const lang of languages) {
    test(`${lang.code} loads nothing from other servers and every file exists`, async ({ page, baseURL }) => {
      const origin = new URL(baseURL).origin;
      const foreign = [];
      const broken = [];
      page.on("request", (request) => {
        if (!request.url().startsWith(origin)) foreign.push(request.url());
      });
      page.on("response", (response) => {
        if (response.status() >= 400) broken.push(`${response.status()} ${response.url()}`);
      });

      await openLanguage(page, lang);
      await page.evaluate(() => document.fonts.ready);

      expect(foreign, "requests to other servers").toEqual([]);
      expect(broken, "missing files").toEqual([]);
      const failedFonts = await page.evaluate(() => [...document.fonts].filter((f) => f.status === "error").length);
      expect(failedFonts, "fonts that failed to load").toBe(0);
    });
  }

  test("icons exist", async ({ page, request }) => {
    await openLanguage(page, byCode.en);
    for (const selector of ['link[rel="icon"]', 'link[rel="apple-touch-icon"]']) {
      const href = await page.locator(selector).getAttribute("href");
      const response = await request.get(new URL(href, page.url()).href);
      expect(response.ok(), `${selector} → ${href}`).toBe(true);
    }
  });
});

test.describe("offline", () => {
  /** Waits until the service worker has cached everything and controls the page. */
  async function installed(page) {
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) {
        await new Promise((resolve) => navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true }));
      }
    });
  }

  async function openAndInstall(page, lang) {
    await openLanguage(page, lang);
    await installed(page);
  }

  test("after one visit the whole site works without network", async ({ page, context }) => {
    await openAndInstall(page, byCode.en);
    await context.setOffline(true);

    await page.reload();
    await expect(page.locator("h2").first()).toHaveText(byCode.en.t.setupH);
    await expect(page.locator("#qr svg")).toBeVisible();

    // Other languages were cached too, not only the visited page.
    await page.locator(".langmenu summary").click();
    await page.locator('.langmenu a[data-lang="de"]').click();
    await expect(page).toHaveURL(/\/de\/$/);
    await expect(page.locator("h2").first()).toHaveText(byCode.de.t.setupH);
    await page.evaluate(() => document.fonts.ready);
    const failedFonts = await page.evaluate(() => [...document.fonts].filter((f) => f.status === "error").length);
    expect(failedFonts, "fonts that failed to load offline").toBe(0);

    // The quiz still works.
    await page.locator("#btns .yes").click();
    await expect(page.locator("#fb span")).toBeVisible();
  });

  test("the start page redirects offline too", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ locale: "en-US" });
    const page = await context.newPage();
    await page.goto(baseURL);
    await installed(page);
    await context.setOffline(true);
    await page.evaluate(() => localStorage.setItem("lang", "de"));
    await page.goto(baseURL);
    await expect(page).toHaveURL(/\/de\/$/);
    await expect(page.locator("h2").first()).toHaveText(byCode.de.t.setupH);
    await context.close();
  });

  test("the app can be installed: manifest and its icons exist", async ({ page, request }) => {
    await openLanguage(page, byCode.en);
    const href = await page.locator('link[rel="manifest"]').getAttribute("href");
    const manifestUrl = new URL(href, page.url()).href;
    const manifest = await (await request.get(manifestUrl)).json();
    expect(manifest.start_url).toBe("./");
    expect(manifest.display).toBe("standalone");
    for (const icon of manifest.icons) {
      const response = await request.get(new URL(icon.src, manifestUrl).href);
      expect(response.ok(), icon.src).toBe(true);
    }
  });
});
