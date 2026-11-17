// Looks for odd moves: lets two bot levels play (like arena.mjs, same deals with swapped
// seats) and checks every card against patterns that are almost always mistakes.
// Only what the bot could know counts: its partner is "known" only if E.knownParties says so.
//
//   node scripts/audit.mjs [A] [B] [deals] [seed] [examples]
//   npm run audit -- strong normal 100
//
// Prints, per level, how often each pattern happened (per 1,000 card decisions with a
// real choice) and a few examples of each.

import * as E from "../src/assets/game/engine.js";
import * as B from "../src/assets/game/bots.js";

const [a = "strong", b = "normal", deals = "100", seedArg = "1", examplesArg = "2"] = process.argv.slice(2);
const EXAMPLES = Number(examplesArg);

function seeded(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PATTERNS = {
  highIntoSafe: "high trump (Dulle/queen) into a trick the partner surely has, a lower card was possible",
  noSchmier: "partner surely has the trick, gave ≥7 points less than possible (without high trumps)",
  giftToOpponent: "ace/ten into an opponent's trick (last to play, can't or doesn't win), a card worth ≤4 was possible",
  missedCheapWin: "last to play, opponent wins ≥10 points, a cheap winning card (no Dulle/queen) was there, didn't take it",
  overtookPartner: "last to play, partner already wins, took it over with a high trump, another card was possible",
  foxLost: "played the fox, the opponents won it, another card was possible",
  leadFox: "led the fox while a higher trump was still out, another card was possible",
  secondHearts: "led a second round of plain hearts, a suit nobody had led yet was possible",
  deviated: "(strong only) played another card than the conventions would",
};

const isHigh = (contract, card) => {
  const t = E.trumpRank(contract, card);
  return t >= 0 && t <= 4; // Dulle and the four queens in a normal game
};
const pts = (card) => E.POINTS[card.rank];
const name = (card) => E.key(card);
const hand = (cards) => cards.map(name).join(" ");

const stats = {};
const examples = {};
const decisions = {};
for (const level of [a, b]) {
  stats[level] = Object.fromEntries(Object.keys(PATTERNS).map((k) => [k, 0]));
  examples[level] = Object.fromEntries(Object.keys(PATTERNS).map((k) => [k, []]));
  decisions[level] = 0;
}

function note(level, pattern, text) {
  stats[level][pattern]++;
  if (examples[level][pattern].length < EXAMPLES) examples[level][pattern].push(text);
}

/** Checks one card decision before it is played. Returns a check to run after the trick, if any. */
function check(state, p, level, cardId) {
  const legal = E.legalCards(state, p);
  if (legal.length < 2) return null;
  decisions[level]++;
  const c = legal.find((x) => x.id === cardId);
  const contract = state.contract;
  const side = E.party(state, p);
  const known = E.knownParties(state, p);
  const trick = state.trick;
  const where = `trick ${state.tricks.length + 1}, ${contract}, seat ${p} (${side ?? "?"}), hand ${hand(state.players[p].hand)}`;
  const shown = trick.map((e) => `${e.player}:${name(e.card)}`).join(" ");

  if (level === "strong") {
    const normal = B.chooseCard(state, p, "normal");
    const nk = name(state.players[p].hand.find((x) => x.id === normal));
    if (nk !== name(c)) note(level, "deviated", `${where} | trick [${shown}] | played ${name(c)}, conventions: ${nk}`);
  }

  if (!trick.length) {
    // Leading the fox is only a mistake if a higher trump is still out there (not played, not ours).
    const gone = new Set([...state.tricks.flatMap((t) => t.cards).map((e) => e.card.id), ...state.players[p].hand.map((x) => x.id)]);
    const higherOut = E.createDeck({ nines: state.nines !== false }).some((x) => !gone.has(x.id) && E.beats(contract, x, c, "T"));
    if (name(c) === "A♦" && E.isTrump(contract, c) && higherOut && legal.some((x) => name(x) !== "A♦")) note(level, "leadFox", `${where} | led ${name(c)}`);
    const heartsLed = state.tricks.filter((t) => E.group(contract, t.cards[0].card) === "♥").length;
    const ledBefore = (g) => state.tricks.some((t) => E.group(contract, t.cards[0].card) === g);
    const fresh = legal.filter((x) => !E.isTrump(contract, x) && !ledBefore(x.suit));
    if (E.group(contract, c) === "♥" && heartsLed >= 1 && fresh.length) {
      note(level, "secondHearts", `${where} | led ${name(c)} after ${heartsLed} round(s) of hearts`);
    }
    return null;
  }

  const led = E.group(contract, trick[0].card);
  const best = trick[E.winningIndex(contract, trick)];
  const last = trick.length === 3;
  const partnerBest = side && best.player !== p && known[best.player] === side;
  const opponentBest = side && known[best.player] && known[best.player] !== side;
  const beats = (x) => E.beats(contract, x, best.card, led);
  const points = E.trickPoints(trick);
  const tail = `${where} | trick [${shown}] | played ${name(c)}`;

  if (last && partnerBest) {
    const lower = legal.filter((x) => !isHigh(contract, x));
    if (isHigh(contract, c) && lower.length) note(level, "highIntoSafe", `${tail}, could play ${hand(lower)}`);
    const loads = lower.length ? lower : legal;
    const most = Math.max(...loads.map(pts));
    if (most - pts(c) >= 7) note(level, "noSchmier", `${tail} (${pts(c)}), could give ${most}`);
    if (beats(c) && isHigh(contract, c) && lower.length) note(level, "overtookPartner", `${tail}`);
  }
  if (last && opponentBest && !beats(c)) {
    const cheap = legal.filter((x) => pts(x) <= 4);
    if (pts(c) >= 10 && cheap.length) note(level, "giftToOpponent", `${tail} (${pts(c)}), could give ${hand(cheap)}`);
  }
  if (last && opponentBest && points >= 10 && !beats(c)) {
    const cheapWin = legal.filter((x) => beats(x) && !isHigh(contract, x));
    if (cheapWin.length) note(level, "missedCheapWin", `${tail}, ${points} points on the table, could win with ${hand(cheapWin)}`);
  }
  if (name(c) === "A♦" && legal.some((x) => name(x) !== "A♦")) {
    // After the trick: did the opponents get it?
    return (finished) => {
      if (E.isSolo(state) || !finished) return;
      if (E.party(state, finished.winner) !== E.party(state, p)) note(level, "foxLost", `${tail}, won by seat ${finished.winner}`);
    };
  }
  return null;
}

const random = seeded(Number(seedArg));
for (let i = 0; i < Number(deals); i++) {
  const deck = E.shuffle(E.createDeck(), random);
  const hands = [0, 1, 2, 3].map((p) => deck.slice(p * 12, p * 12 + 12));
  for (const levels of [[a, b, a, b], [b, a, b, a]]) {
    const state = E.createGame({ dealer: i % 4, hands: hands.map((h) => h.map((c) => ({ ...c }))) });
    while (state.phase === "reserve") E.declare(state, state.turn, B.chooseDeclaration(state, state.turn, levels[state.turn], random));
    const after = [];
    while (state.phase === "play") {
      const p = state.turn;
      while (B.chooseCall(state, p, levels[p])) E.call(state, p);
      const id = B.chooseCard(state, p, levels[p], random);
      const pending = check(state, p, levels[p], id);
      if (pending) after.push(pending);
      const events = E.play(state, p, id);
      const done = events.find((e) => e.type === "trick");
      if (done) {
        // Party of the winner may only be fixed now (wedding); check the fox afterwards.
        for (const f of after.splice(0)) f(done);
      }
    }
  }
}

for (const level of [a, b]) {
  const n = decisions[level];
  console.log(`\n== ${level}: ${n} card decisions with a choice`);
  for (const [k, text] of Object.entries(PATTERNS)) {
    if (k === "deviated" && level !== "strong") continue;
    const count = stats[level][k];
    console.log(`  ${String(count).padStart(5)}  (${((1000 * count) / Math.max(1, n)).toFixed(1).padStart(5)} ‰)  ${k}: ${text}`);
    for (const ex of examples[level][k]) console.log(`           e.g. ${ex}`);
  }
}
