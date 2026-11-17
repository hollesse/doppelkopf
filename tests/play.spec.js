// The game page: both languages, without JavaScript, and complete games through the UI.
import { test as base, expect } from "@playwright/test";
import languages from "../src/_data/languages.js";

const test = base.extend({
  page: async ({ page }, use) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await use(page);
    expect(errors, "JavaScript errors on the page").toEqual([]);
  },
});

const byCode = Object.fromEntries(languages.map((lang) => [lang.code, lang]));
const playPath = (lang) => (lang.path === "/" ? "play/" : `${lang.code}/play/`);

/** Seeded random numbers, so every run deals the same cards. */
function seed(page, value) {
  return page.addInitScript((start) => {
    let s = start;
    Math.random = () => {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }, value);
}

async function openPlay(page, lang) {
  await page.addInitScript((code) => localStorage.setItem("lang", code), lang.code);
  await page.goto(playPath(lang));
}

async function start(page, { level = "normal", name = "" } = {}) {
  await page.check(`input[name=level][value="${level}"]`, { force: true });
  if (name) await page.locator("input[name=player]").fill(name);
  await page.locator("#setup-form button[type=submit]").click();
  await expect(page.locator("#table")).toBeVisible();
}

// Bots move quickly with reduced motion.
test.use({ reducedMotion: "reduce" });

/** Waits until something is up to you: the reservation, your card, or the end of the game. */
async function waitForMe(page) {
  await page.waitForFunction(
    () => !document.getElementById("over").hidden || !document.getElementById("reserve").hidden || document.getElementById("me").classList.contains("active"),
    null,
    { timeout: 20_000 },
  );
  if (await page.locator("#over").isVisible()) return "over";
  if (await page.locator("#reserve").isVisible()) return "reserve";
  return "play";
}

/** Plays your first allowed card: tap it, then "Play". Cards overlap, so tap their left strip. */
async function playFirstCard(page) {
  await page.locator("#my-hand button.playable").first().click({ position: { x: 6, y: 20 } });
  await page.locator("#btn-play").click();
}

/** Plays until the game is over; returns how often each situation came up. */
async function playToEnd(page, { onReserve = "healthy", lang } = {}) {
  const seen = { cards: 0, mustFollow: false };
  for (;;) {
    const what = await waitForMe(page);
    if (what === "over") return seen;
    if (what === "reserve") {
      if (onReserve === "healthy") await page.locator('[data-declare="healthy"]').click();
      else {
        await page.locator("#reserve summary").click();
        await page.locator(`[data-declare="${onReserve}"]`).click();
      }
      continue;
    }
    // Once: tapping a card you may not play explains why.
    const dim = page.locator("#my-hand button.dim");
    if (lang && !seen.mustFollow && (await dim.count())) {
      await dim.first().click({ position: { x: 6, y: 20 } });
      await expect(page.locator("#status")).toContainText(lang.t.game.mustFollow.split("{card}")[1].split("{what}")[0].trim());
      seen.mustFollow = true;
    }
    await playFirstCard(page);
    seen.cards++;
  }
}

/** The "this game" column of the standings adds up to zero. */
async function checkStandings(page) {
  const rows = page.locator("#standings tbody tr");
  await expect(rows).toHaveCount(4);
  const values = await rows.locator("td:nth-child(2)").allTextContents();
  expect(values.map(Number).reduce((a, b) => a + b, 0)).toBe(0);
  return values.map(Number);
}

test.describe("game page in both languages", () => {
  for (const lang of languages) {
    test(`${lang.code}`, async ({ page }) => {
      await openPlay(page, lang);
      await expect(page).toHaveTitle(lang.t.game.title);
      await expect(page.locator("html")).toHaveAttribute("lang", lang.htmlLang);
      await expect(page.locator("h1")).toHaveText(lang.t.game.h1);
      await expect(page.locator("#setup h2")).toHaveText(lang.t.game.setupH);
      await expect(page.locator("link[rel=canonical]")).toHaveAttribute("href", `${lang.url}play/`);
      await expect(page.locator('.langmenu a[data-lang="de"]')).toHaveAttribute("href", /\/de\/play\/$/);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
});

test("the rules page links to the game", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("lang", "de"));
  await page.goto("de/");
  await page.locator("#gegen-bots a").click();
  await expect(page).toHaveURL(/\/de\/play\/$/);
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("shows the header, but no game controls", async ({ page }) => {
    await page.goto("de/play/");
    await expect(page.locator("h1")).toHaveText(byCode.de.t.game.h1);
    await expect(page.locator("#setup")).toBeHidden();
    await expect(page.locator("#table")).toBeHidden();
  });
});

test("a complete game and the next one (de, normal)", async ({ page }) => {
  test.setTimeout(120_000);
  const lang = byCode.de;
  const g = lang.t.game;
  await seed(page, 1);
  await openPlay(page, lang);
  await start(page, { name: "<b>Jo</b>" });

  // Your name is shown as text, the bots have typical names of the page language.
  await expect(page.locator("#me-name")).toHaveText("<b>Jo</b>");
  const botNames = g.botNames.split(/\s*,\s*/).map((pair) => pair.split("/")[0]);
  const shown = await page.locator("#opponents .oppname").allTextContents();
  expect(new Set(shown).size).toBe(3);
  for (const name of shown) expect(botNames).toContain(name);
  // 12 cards each, the bots' as a fan of backs.
  await expect(page.locator("#my-hand button")).toHaveCount(12);
  for (const fan of await page.locator("#opponents .oppfan").all()) await expect(fan.locator(".fanback")).toHaveCount(12);

  const seen = await playToEnd(page, { lang });
  expect(seen.cards).toBe(12);
  expect(seen.mustFollow).toBe(true);

  // The result: card points add up to 240, the scores to zero.
  await expect(page.locator("#over-h")).toHaveText(/gewinnt|Keiner/);
  const points = (await page.locator("#over-points .pts").allTextContents()).map(Number);
  expect(points[0] + points[1]).toBe(240);
  const scores = await checkStandings(page);
  await expect(page.locator("#standings tbody tr.you th")).toContainText("<b>Jo</b>");
  await expect(page.locator("#over-lines tbody tr").first()).toBeVisible();

  // Next game: the totals carry over.
  await page.locator("#btn-next").click();
  await expect(page.locator("#over")).toBeHidden();
  await expect(page.locator("#log")).toContainText("Spiel 2");
  await expect(page.locator("#total")).toHaveText(`Du: ${scores[0] > 0 ? "+" : ""}${scores[0]}`);
  await expect(page.locator("#my-hand button")).toHaveCount(12);

  // Statistics: one game on "normal".
  const stats = await page.evaluate(() => JSON.parse(localStorage.getItem("game-stats")));
  expect(stats.normal.games).toBe(1);
  expect(stats.normal.points).toBe(scores[0]);
});

test("calling Re or Kontra (en, strong)", async ({ page }) => {
  test.setTimeout(120_000);
  const g = byCode.en.t.game;
  await seed(page, 4);
  await openPlay(page, byCode.en);
  await start(page, { level: "strong" });
  expect(await waitForMe(page)).toBe("reserve");
  await page.locator('[data-declare="healthy"]').click();
  await waitForMe(page);

  // In a normal game you know your own party and may call right away.
  const button = page.locator("#btn-call");
  await expect(button).toBeVisible();
  const label = await button.textContent();
  const side = label.includes(g.calls.re) ? "re" : "kontra";
  expect(label).toBe(g.callBtn.replace("{call}", g.calls[side]));
  await button.click();
  await expect(page.locator("#log li").first()).toHaveText(g.youCalled.replace("{call}", g.calls[side]));
  await expect(page.locator("#me-info .party")).toHaveText(`${g.calls[side]}!`);
  // Next step: "no 90".
  await expect(button).toHaveText(g.callBtn.replace("{call}", g.calls.no90));

  await playToEnd(page);
  await expect(page.locator("#over-lines")).toContainText(g.lines[`${side}Called`]);
  await checkStandings(page);
});

test("playing a solo (en)", async ({ page }) => {
  test.setTimeout(120_000);
  const g = byCode.en.t.game;
  await seed(page, 2);
  await openPlay(page, byCode.en);
  await start(page, { name: "Jo" });
  await playToEnd(page, { onReserve: "queens" });
  await expect(page.locator("#contract")).toHaveText(`${g.contracts.queens} · Jo`);
  // You were alone against three: you get or lose three times what each of them does.
  const scores = await checkStandings(page);
  expect(Math.abs(scores[0])).toBe(3 * Math.abs(scores[1]));
  if (scores[0]) await expect(page.locator("#over-lines")).toContainText(g.soloTriple);
  await expect(page.locator("#over-lines")).not.toContainText(g.lines.fox);
});

test("a game without nines: 10 cards each (preselected from the rules page)", async ({ page }) => {
  test.setTimeout(120_000);
  await seed(page, 6);
  await page.addInitScript(() => localStorage.setItem("lang", "de"));
  await page.goto("de/ohne-neunen/");
  await page.locator("#gegen-bots a").click();
  await expect(page.locator('input[name=nines][value="0"]')).toBeChecked();
  await start(page);
  await expect(page.locator("#my-hand button")).toHaveCount(10);
  for (const fan of await page.locator("#opponents .oppfan").all()) await expect(fan.locator(".fanback")).toHaveCount(10);
  await expect(page.locator("#log")).toContainText(byCode.de.t.game.withoutNines);
  expect(await page.locator("#my-hand button .c").allTextContents()).not.toContainEqual(expect.stringMatching(/^9/));
  const seen = await playToEnd(page);
  expect(seen.cards).toBe(10);
  await checkStandings(page);
  // The nines are worth nothing, so there are still 240 card points.
  const points = (await page.locator("#over-points .pts").allTextContents()).map(Number);
  expect(points[0] + points[1]).toBe(240);
});

test("the table fits one screen and nothing moves between moves", async ({ browser, baseURL }) => {
  test.setTimeout(60_000);
  for (const viewport of [{ width: 320, height: 568 }, { width: 820, height: 1180 }]) {
    const context = await browser.newContext({ viewport, reducedMotion: "reduce", baseURL });
    const page = await context.newPage();
    await seed(page, 3);
    await openPlay(page, byCode.de);
    await start(page);
    const boxes = () =>
      page.evaluate(() =>
        ["trickarea", "my-hand", "btn-play", "status"].map((id) => {
          const r = document.getElementById(id).getBoundingClientRect();
          return [Math.round(r.top), Math.round(r.height)];
        }),
      );
    if ((await waitForMe(page)) === "reserve") await page.locator('[data-declare="healthy"]').click();
    await waitForMe(page);
    const first = await boxes();
    for (let i = 0; i < 4; i++) {
      await playFirstCard(page);
      await waitForMe(page);
      expect(await boxes(), `${viewport.width}×${viewport.height}, move ${i + 1}`).toEqual(first);
    }
    const fits = await page.evaluate(() => ({
      scroll: document.documentElement.scrollHeight - window.innerHeight,
      wide: document.documentElement.scrollWidth - window.innerWidth,
      controls: document.querySelector(".controls").getBoundingClientRect().bottom - window.innerHeight,
    }));
    expect(fits.scroll, "page scrolls").toBeLessThanOrEqual(0);
    expect(fits.wide, "page too wide").toBeLessThanOrEqual(0);
    expect(fits.controls, "buttons below the screen").toBeLessThanOrEqual(0);
    await context.close();
  }
});
