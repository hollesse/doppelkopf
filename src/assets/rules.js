// Rules page only. Adds the practice quiz and the QR code / share buttons.
// The page is fully readable without this file.

const $ = (id) => document.getElementById(id);

// ---------- Quiz: "Does your card win?" (normal game, two cards) ----------

const text = JSON.parse($("quiz-text").textContent);
const LETTERS = JSON.parse($("quiz-ranks").textContent); // J/Q/K/A → letters on the cards

const SUITS = ["♣", "♠", "♥", "♦"];
const RANKS = ["9", "10", "J", "Q", "K", "A"];
// Trumps from high to low, as "rank suit".
const TRUMPS = ["10♥", "Q♣", "Q♠", "Q♥", "Q♦", "J♣", "J♠", "J♥", "J♦", "A♦", "10♦", "K♦", "9♦"];
// Plain suits from high to low.
const PLAIN = ["A", "10", "K", "9"];

const DECK = SUITS.flatMap((suit) => RANKS.map((rank) => ({ rank, suit })));
const id = (card) => card.rank + card.suit;
const trump = (card) => TRUMPS.indexOf(id(card)); // -1 for plain cards; lower is higher
/** "Suit" for following: all trumps count as one suit. */
const group = (card) => (trump(card) >= 0 ? "T" : card.suit);

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const fill = (template, values) => template.replace(/\{(\w+)\}/g, (_, key) => values[key]);
const label = (card) => LETTERS[card.rank] ?? card.rank;
const name = (card) => card.suit + label(card);

function cardHTML(card) {
  const red = card.suit === "♥" || card.suit === "♦" ? " r" : "";
  return `<div class="card${red}"><div class="c">${label(card)}<span>${card.suit}</span></div><div class="pip">${card.suit}</div></div>`;
}

/** Returns [wins, explanation] for `mine` played after `led`. */
function judge(led, mine) {
  const names = { led: name(led), mine: name(mine) };
  if (id(led) === id(mine)) return [false, text.sameCard];
  const t1 = trump(led);
  const t2 = trump(mine);
  if (t1 >= 0 && t2 >= 0) return t2 < t1 ? [true, fill(text.bothTrumpHigher, names)] : [false, fill(text.bothTrumpLower, names)];
  if (t2 >= 0) return [true, fill(text.trumpBeats, names)];
  if (t1 >= 0) return [false, fill(text.trumpLed, names)];
  if (led.suit !== mine.suit) return [false, fill(text.otherSuit, names)];
  return PLAIN.indexOf(mine.rank) < PLAIN.indexOf(led.rank)
    ? [true, fill(text.suitHigher, names)]
    : [false, fill(text.suitLower, names)];
}

let current = null;
let right = 0;
let total = 0;

const showScore = () => ($("score").textContent = fill(text.score, { right, total }));

function deal() {
  const led = pick(DECK);
  // Often the same suit (or trump), so following suit and the same card come up regularly.
  const roll = Math.random();
  const mine = roll < 0.1 ? led : roll < 0.5 ? pick(DECK.filter((card) => group(card) === group(led))) : pick(DECK);
  current = { led, mine };
  $("ledCard").innerHTML = cardHTML(led);
  $("myCard").innerHTML = cardHTML(mine);
  $("fb").innerHTML = "";
  $("btns").hidden = false;
  $("next").hidden = true;
}

$("btns").addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button || !current) return;
  const [wins, why] = judge(current.led, current.mine);
  const correct = (button.dataset.a === "1") === wins;
  total++;
  if (correct) right++;
  $("fb").innerHTML =
    `<span class="${correct ? "ok" : "ko"}">${correct ? text.right : text.wrong}</span>` +
    (wins ? text.yes : text.no) +
    why;
  showScore();
  $("btns").hidden = true;
  $("next").hidden = false;
  $("next").focus({ preventScroll: true });
});

$("next").addEventListener("click", deal);
deal();
showScore();

// ---------- Share ----------

const shareUrl = $("shurl").href;

if (window.qrcode) {
  const qr = qrcode(0, "M");
  qr.addData(shareUrl);
  qr.make();
  $("qr").innerHTML = qr.createSvgTag(5, 2);
}

const copyButton = $("shCopy");
const copyLabel = copyButton.textContent;

function copied() {
  copyButton.textContent = copyButton.dataset.done;
  setTimeout(() => (copyButton.textContent = copyLabel), 1800);
}

function selectUrl() {
  const range = document.createRange();
  range.selectNodeContents($("shurl"));
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

async function copyLink() {
  try {
    await navigator.clipboard.writeText(shareUrl);
    copied();
  } catch {
    selectUrl();
  }
}

copyButton.addEventListener("click", copyLink);

const shareButton = $("shShare");
const policy = document.permissionsPolicy || document.featurePolicy;
const canShare = !!navigator.share && !(policy?.allowsFeature && !policy.allowsFeature("web-share"));

if (canShare) {
  shareButton.hidden = false;
  shareButton.addEventListener("click", () => {
    navigator.share({ title: document.title, url: shareUrl }).catch((error) => {
      if (error?.name !== "AbortError") {
        shareButton.hidden = true;
        copyLink();
      }
    });
  });
}
