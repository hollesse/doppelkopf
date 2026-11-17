// The game page: settings, table, your moves and the bots' turns.
// All rules live in engine.js, the computer players in bots.js, animations in fx.js.

import * as E from "./engine.js";
import { chooseCall, chooseCard, chooseDeclaration } from "./bots.js";
import { flyIn, snapshot, sweep } from "./fx.js";

const T = JSON.parse(document.getElementById("game-text").textContent);
const LETTERS = JSON.parse(document.getElementById("rank-letters").textContent);
const $ = (id) => document.getElementById(id);
const fill = (template, values) => template.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? "");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Bots wait a moment so you can follow their moves.
const REDUCED_MOTION = matchMedia("(prefers-reduced-motion: reduce)").matches;
const BOT_DELAY = REDUCED_MOTION ? 60 : 650;

const HUMAN = 0;
const SETTINGS_KEY = "game-settings";
const STATS_KEY = "game-stats";
// "Lukas/Jonas, Anna/Marie, …": a typical first name per bot and an alternative
// for when you have the same name.
const BOT_NAMES = T.botNames.split(/\s*,\s*/).map((pair) => pair.split("/").map((name) => name.trim()));
const sameName = (a, b) => a.localeCompare(b, document.documentElement.lang, { sensitivity: "base" }) === 0;

let state = null;
let level = "normal";
let names = [];
let dealer = E.PLAYERS - 1; // the first game is led by you
let session = { games: 0, totals: [0, 0, 0, 0] };
let selected = null; // id of the card you tapped once
let hint = ""; // short-lived message for you, e.g. "you have to follow suit"
let log = [];
let botsRunning = false;
let animating = false; // no input while cards are moving
let swept = false; // the last trick was collected and is no longer shown
let gameId = 0;

// ---------- Texts ----------

const label = (card) => `${LETTERS[card.rank] ?? card.rank}${card.suit}`;
const callName = (level, side) => (level === 1 ? T.calls[side] : T.calls[E.CALLS[level]]);
const partyName = (side) => T.calls[side];

/** The contract as you see it: a silent solo looks like a normal game to the others. */
function contractText() {
  if (!state.contract) return "";
  const c = state.contract === "silent" && state.soloist !== HUMAN && state.phase !== "over" ? "normal" : state.contract;
  const who = state.soloist ?? state.wedding;
  const name = T.contracts[c];
  return c === "normal" || who === null ? name : `${name} · ${names[who]}`;
}

/** What to follow: "trump" or the suit name. */
const followName = (card) => (E.isTrump(state.contract, card) ? T.trump : T.suits[card.suit]);

// ---------- Rendering helpers ----------

/** A list item with plain text: names you type in are never read as HTML. */
function listItem(text, className = "") {
  const li = document.createElement("li");
  li.textContent = text;
  if (className) li.className = className;
  return li;
}

const escape = (text) => text.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);

function cardHTML(card, { size = "tc", tag = "div", classes = "", attrs = "" } = {}) {
  const red = E.isRed(card) ? " r" : "";
  const rank = LETTERS[card.rank] ?? card.rank;
  return (
    `<${tag} class="card ${size}${red} ${classes}" ${attrs} aria-label="${label(card)}">` +
    `<span class="c">${rank}<span>${card.suit}</span></span><span class="pip">${card.suit}</span></${tag}>`
  );
}

/** Your hand in a fixed order: trumps from high to low, then the plain suits. */
function sortHand(hand) {
  const contract = state.contract ?? "normal";
  const plain = E.plainOrder(contract);
  const value = (card) => {
    const t = E.trumpRank(contract, card);
    if (t >= 0) return t;
    return 100 + E.SUITS.indexOf(card.suit) * 10 + plain.indexOf(card.rank);
  };
  return [...hand].sort((a, b) => value(a) - value(b) || a.id.localeCompare(b.id));
}

/** Party badge of a player as far as you know it; after a call it shows the call. */
function badge(p, known) {
  const side = known[p];
  if (!side) return "";
  const calls = state.callLog.filter((c) => c.player === p);
  if (!calls.length) return `<span class="party ${side}">${partyName(side)}</span>`;
  return `<span class="party ${side} called">${escape(callName(calls.at(-1).level, side))}!</span>`;
}

const tricksWon = (p) => state.tricks.filter((t) => t.winner === p).length;

// ---------- Rendering ----------

function render() {
  if (!state) return;
  const myTurn = state.phase === "play" && state.turn === HUMAN && !animating;
  const legal = new Set(myTurn ? E.legalCards(state, HUMAN).map((card) => card.id) : []);
  const known = state.phase === "over" ? [0, 1, 2, 3].map((p) => E.party(state, p)) : E.knownParties(state, HUMAN);

  $("contract").textContent = contractText();
  $("total").textContent = fill(T.yourTotal, { n: signed(session.totals[HUMAN]) });

  // Opponents: left, across, right
  $("opponents").innerHTML = [1, 2, 3]
    .map((p) => {
      const n = state.players[p].hand.length;
      const active = (state.phase === "play" || state.phase === "reserve") && state.turn === p ? " active" : "";
      return (
        `<div class="opp${active}" data-player="${p}">` +
        `<div class="opphead"><span class="oppname">${escape(names[p])}</span><span class="badges">${badge(p, known)}</span></div>` +
        `<div class="oppfoot"><span class="oppfan" role="img" aria-label="${fill(T.handCount, { n })}" style="--n:${n}">${'<span class="fanback"></span>'.repeat(n)}</span>` +
        `<span class="info">${fill(T.tricksCount, { n: tricksWon(p) })}</span></div></div>`
      );
    })
    .join("");

  // The trick: the current one, or the last one until it was collected.
  const last = state.tricks.at(-1);
  const shown = state.trick.length ? state.trick : swept || !last ? [] : last.cards;
  const winner = !state.trick.length && last && !swept ? last.winner : null;
  for (const slot of $("trickarea").children) {
    const seat = Number(slot.dataset.seat);
    const entry = shown.find((e) => e.player === seat);
    slot.innerHTML = entry ? cardHTML(entry.card, { classes: seat === winner ? "gold" : "" }) : "";
  }
  $("trickarea").classList.toggle("done", winner !== null);

  // You
  const me = state.players[HUMAN];
  $("me-name").textContent = names[HUMAN];
  $("me-info").innerHTML = `${badge(HUMAN, known)}<span>${fill(T.tricksCount, { n: tricksWon(HUMAN) })}</span>`;
  $("me").classList.toggle("active", myTurn || (state.phase === "reserve" && state.turn === HUMAN));
  const hand = sortHand(me.hand);
  $("my-hand").style.setProperty("--n", hand.length); // the CSS overlaps cards to fit them in one row
  $("my-hand").innerHTML = hand
    .map((card) => {
      const classes = [myTurn && legal.has(card.id) ? "playable" : "", myTurn && !legal.has(card.id) ? "dim" : "", selected === card.id ? "selected" : ""].join(" ");
      return cardHTML(card, { tag: "button", classes, attrs: `data-id="${card.id}"` });
    })
    .join("");

  // Buttons stay in place: hidden ones keep their space, unusable ones are disabled.
  const callLevel = state.phase === "play" ? E.nextCall(state, HUMAN) : 0;
  $("btn-play").disabled = !(myTurn && selected && legal.has(selected));
  $("btn-call").classList.toggle("off", !callLevel);
  $("btn-call").disabled = !callLevel || animating;
  $("btn-call").textContent = callLevel ? fill(T.callBtn, { call: callName(callLevel, E.party(state, HUMAN)) }) : "";

  // Before the first card
  const reserving = state.phase === "reserve" && state.turn === HUMAN;
  $("reserve").hidden = !reserving;
  if (reserving) {
    const wedding = E.canWedding(state, HUMAN);
    $("reserve-p").textContent = wedding ? T.reserveWedding : T.reserveP;
    $("reserve").querySelector('[data-declare="wedding"]').hidden = !wedding;
  }

  // Messages
  $("status").textContent = hint || statusText(myTurn);
  $("log").replaceChildren(...log.map((line) => listItem(line)));
}

function statusText(myTurn) {
  if (state.phase === "reserve") return state.turn === HUMAN ? T.reserveH : "";
  if (!myTurn) return "";
  if (!state.trick.length) return T.yourLead;
  const led = state.trick[0].card;
  const canFollow = state.players[HUMAN].hand.some((card) => E.group(state.contract, card) === E.group(state.contract, led));
  return canFollow ? fill(T.yourFollow, { what: followName(led) }) : T.cantFollow;
}

const signed = (n) => (n > 0 ? `+${n}` : String(n));

// ---------- Events → messages ----------

function describe(event) {
  const you = event.player === HUMAN;
  const name = names[event.player];
  switch (event.type) {
    case "declare":
      return you ? "" : fill(event.reserved ? T.declReserved : T.declHealthy, { name });
    case "contract": {
      const c = event.contract;
      if (c === "silent" && you) return T.youSilent;
      if (c === "normal" || c === "silent") return T.normalGame;
      if (c === "wedding") return you ? T.youWedding : fill(T.weddingOn, { name });
      return fill(you ? T.youSolo : T.soloOn, { name, contract: T.contracts[c] });
    }
    case "partner":
      if (event.partner === HUMAN) return fill(T.youPartner, { name });
      return fill(you ? T.partnerYou : T.partner, { name, partner: names[event.partner] });
    case "alone":
      return you ? T.youAlone : fill(T.alone, { name });
    case "reveal":
      return you ? "" : fill(T.reveal, { name });
    case "call":
      return fill(you ? T.youCalled : T.called, { name, call: callName(event.level, event.party) });
    case "trick":
      return fill(event.winner === HUMAN ? T.youTrick : T.trickWon, { name: names[event.winner], n: event.points });
    default:
      return "";
  }
}

function logEvents(events) {
  for (const event of events) {
    const line = describe(event);
    if (line) log = [line, ...log].slice(0, 4);
  }
}

/** Shows the events of one move: render the new state, then animate how it got there. */
async function show(events, before) {
  const id = gameId;
  logEvents(events);
  const played = events.find((e) => e.type === "play");
  if (played) swept = false;
  animating = true; // before render(), so it never shows "your turn" too early
  render();
  if (played) await flyIn(played, before);
  if (id !== gameId) return false;
  const trick = events.find((e) => e.type === "trick");
  if (trick) {
    await sleep(REDUCED_MOTION ? 0 : 900);
    if (id !== gameId) return false;
    if (!REDUCED_MOTION && state.phase !== "over") {
      await sweep(trick.winner);
      swept = true;
    }
  }
  animating = false;
  render();
  return id === gameId;
}

/** Runs one action of yours, then lets the bots play. */
async function perform(action) {
  if (animating) return;
  const before = snapshot();
  const events = action();
  selected = null;
  hint = "";
  if (!(await show(events, before))) return;
  if (state.phase === "over") showOver();
  else runBots();
}

// ---------- Bots ----------

async function runBots() {
  if (botsRunning) return;
  botsRunning = true;
  const id = gameId;
  while (state.phase !== "over" && state.turn !== HUMAN) {
    render();
    await sleep(state.phase === "reserve" ? BOT_DELAY / 2 : BOT_DELAY);
    if (id !== gameId) return; // a new game was started meanwhile
    const p = state.turn;
    const before = snapshot();
    let events;
    if (state.phase === "reserve") {
      events = E.declare(state, p, chooseDeclaration(state, p, level));
    } else {
      events = [];
      while (chooseCall(state, p, level)) events.push(...E.call(state, p));
      events.push(...E.play(state, p, chooseCard(state, p, level)));
    }
    if (!(await show(events, before))) return;
  }
  botsRunning = false;
  render();
  if (state.phase === "over") showOver();
}

// ---------- Your moves ----------

$("my-hand").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-id]");
  if (!button || !state || animating || state.phase !== "play" || state.turn !== HUMAN) return;
  const id = button.dataset.id;
  if (!E.canPlay(state, HUMAN, id)) {
    const card = state.players[HUMAN].hand.find((c) => c.id === id);
    hint = fill(T.mustFollow, { card: label(card), what: followName(state.trick[0].card) });
    selected = null;
    render();
    return;
  }
  hint = "";
  // Tapping the selected card again plays it.
  if (selected === id) perform(() => E.play(state, HUMAN, id));
  else {
    selected = id;
    render();
  }
});

$("btn-play").addEventListener("click", () => {
  if (selected) {
    const id = selected;
    perform(() => E.play(state, HUMAN, id));
  }
});

$("btn-call").addEventListener("click", () => {
  if (!state || animating || !E.nextCall(state, HUMAN)) return;
  logEvents(E.call(state, HUMAN));
  render();
});

$("reserve").addEventListener("click", (event) => {
  const button = event.target.closest("[data-declare]");
  if (!button || !state || state.phase !== "reserve" || state.turn !== HUMAN) return;
  $("reserve").querySelector("details").open = false;
  perform(() => E.declare(state, HUMAN, button.dataset.declare));
});

// ---------- Game start and end ----------

function startGame() {
  gameId++;
  botsRunning = false;
  animating = false;
  swept = false;
  dealer = E.next(dealer);
  state = E.createGame({ dealer });
  selected = null;
  hint = "";
  log = [fill(T.gameNo, { n: session.games + 1 })];
  $("over").hidden = true;
  render();
  runBots();
}

function newMatch({ level: chosen, player = "" }) {
  level = chosen;
  // Typical first names of the page language, in random order. A bot that has
  // your name uses its alternative.
  const me = player.trim() || T.you;
  const shuffled = [...BOT_NAMES].sort(() => Math.random() - 0.5);
  names = [me, ...shuffled.slice(0, 3).map(([name, alternative]) => (sameName(name, me) ? alternative : name))];
  session = { games: 0, totals: [0, 0, 0, 0] };
  dealer = E.PLAYERS - 1;
  $("setup").hidden = true;
  $("table").hidden = false;
  document.documentElement.classList.add("playing"); // the table takes the whole screen
  window.scrollTo(0, 0);
  startGame();
}

// ---------- Statistics (only in this browser) ----------

const LEVELS = ["easy", "normal"];
const emptyStats = () => Object.fromEntries(LEVELS.map((l) => [l, { games: 0, wins: 0, points: 0 }]));

function loadStats() {
  try {
    const saved = JSON.parse(localStorage.getItem(STATS_KEY));
    const stats = emptyStats();
    for (const l of LEVELS) Object.assign(stats[l], saved?.[l]);
    return stats;
  } catch {
    return emptyStats();
  }
}

function saveStats(stats) {
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(stats));
  } catch {}
}

/** Counts a finished game once: played, won (your party won), your game points. */
function recordGame() {
  if (state.recorded) return;
  state.recorded = true;
  const result = state.result;
  session.games++;
  result.scores.forEach((n, p) => (session.totals[p] += n));
  const stats = loadStats();
  const row = stats[level];
  row.games++;
  if (result.winner && E.party(state, HUMAN) === result.winner) row.wins++;
  row.points += result.scores[HUMAN];
  saveStats(stats);
}

function renderStats() {
  const stats = loadStats();
  const total = { games: 0, wins: 0, points: 0 };
  for (const l of LEVELS) for (const k in total) total[k] += stats[l][k];
  const row = (name, r, cls = "") =>
    `<tr class="${cls}"><th scope="row">${name}</th><td>${r.games}</td><td>${r.wins}</td><td>${signed(r.points)}</td></tr>`;
  const html = total.games
    ? `<h3>${T.statsH}</h3><table class="stats"><thead><tr><th></th><th scope="col">${T.statsGames}</th><th scope="col">${T.statsWins}</th><th scope="col">${T.statsPoints}</th></tr></thead><tbody>` +
      row(T.easy, stats.easy) +
      row(T.normal, stats.normal) +
      row(T.statsTotal, total, "total") +
      `</tbody></table><p class="statsnote">${T.statsNote} <button type="button" class="linkbtn" data-reset-stats>${T.statsReset}</button></p>`
    : "";
  for (const box of document.querySelectorAll("[data-stats]")) box.innerHTML = html;
}

document.addEventListener("click", (event) => {
  if (!event.target.closest("[data-reset-stats]")) return;
  if (!confirm(T.statsConfirm)) return;
  try {
    localStorage.removeItem(STATS_KEY);
  } catch {}
  renderStats();
});

function showOver() {
  recordGame();
  renderStats();
  render();
  const r = state.result;
  const mine = r.scores[HUMAN];
  $("over-h").textContent = r.winner ? fill(T.overWins, { party: partyName(r.winner) }) : T.overNone;
  $("over-text").textContent = !r.winner ? T.noWinner : mine >= 0 ? fill(T.youWon, { n: signed(mine) }) : fill(T.youLost, { n: mine });

  // Card points of both parties, with their players
  const members = (side) => [0, 1, 2, 3].filter((p) => E.party(state, p) === side).map((p) => names[p]).join(", ");
  $("over-points").innerHTML = ["re", "kontra"]
    .map(
      (side) =>
        `<div class="side ${side}${r.winner === side ? " won" : ""}"><b>${partyName(side)}</b><span class="pts">${r.points[side]}</span>` +
        `<small>${escape(members(side))}</small><small>${fill(T.tricksCount, { n: r.tricks[side] })}</small></div>`,
    )
    .join("");

  // What the game points are made of
  const rows = r.lines.map((line) => {
    const text = line.party ? `${T.lines[line.id]} (${partyName(line.party)})` : T.lines[line.id];
    return `<tr><td class="num">${signed(line.value)}</td><td>${text}</td></tr>`;
  });
  const solo = E.isSolo(state) && r.winner ? `<tr><td></td><td class="note">${T.soloTriple}</td></tr>` : "";
  $("over-lines").innerHTML =
    `<tbody>${rows.join("")}</tbody><tfoot><tr><td class="num">${r.total}</td><td>${T.lines.total}</td></tr>${solo}</tfoot>`;

  // Everyone's result and running total
  $("standings").innerHTML =
    `<thead><tr><th></th><th scope="col">${T.thisGame}</th><th scope="col">${fill(T.afterGames, { n: session.games })}</th></tr></thead><tbody>` +
    [0, 1, 2, 3]
      .map((p) => `<tr class="${p === HUMAN ? "you" : ""}"><th scope="row">${escape(names[p])} <span class="party ${E.party(state, p)}">${partyName(E.party(state, p))}</span></th><td>${signed(r.scores[p])}</td><td>${signed(session.totals[p])}</td></tr>`)
      .join("") +
    "</tbody>";

  $("over").hidden = false;
  $("over").querySelector(".overbox").scrollTop = 0;
  $("btn-next").focus({ preventScroll: true });
}

function readSettings() {
  const form = $("setup-form");
  return { level: form.level.value, player: form.player.value.trim() };
}

$("setup-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const settings = readSettings();
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {}
  newMatch(settings);
});

$("btn-next").addEventListener("click", startGame);

$("btn-settings").addEventListener("click", () => {
  gameId++;
  state = null;
  $("over").hidden = true;
  $("table").hidden = true;
  $("setup").hidden = false;
  document.documentElement.classList.remove("playing");
  renderStats();
});

// Restore the last settings.
try {
  const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY));
  if (saved) {
    const form = $("setup-form");
    if (LEVELS.includes(saved.level)) form.level.value = saved.level;
    form.player.value = saved.player ?? "";
  }
} catch {}

renderStats();
