// Lets two kinds of bots play against each other, fairly: every deal is played twice,
// once with A in seats 0 and 2 and B in seats 1 and 3, and once the other way round.
// So both get the same cards in the same seats, and luck cancels out.
//
//   node scripts/arena.mjs [A] [B] [deals] [seed]
//   node scripts/arena.mjs normal strong 300
//
// A and B are levels from bots.js. With OLD_BOTS=path/to/bots.js, the level "old:<level>"
// uses that file instead, to compare against an earlier version.

import * as E from "../src/assets/game/engine.js";
import * as B from "../src/assets/game/bots.js";

const OLD = process.env.OLD_BOTS ? await import(process.env.OLD_BOTS) : null;
/** The bot module and level for a name like "normal" or "old:normal". */
const bot = (name) => (name.startsWith("old:") ? [OLD, name.slice(4)] : [B, name]);

const [a = "normal", b = "strong", deals = "200", seedArg = "1"] = process.argv.slice(2);

function seeded(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Plays one game with the given hands and levels per seat; returns the result. */
export function playGame(hands, dealer, levels, random) {
  const state = E.createGame({ dealer, hands: hands.map((h) => h.map((c) => ({ ...c }))) });
  while (state.phase === "reserve") {
    const [M, level] = bot(levels[state.turn]);
    E.declare(state, state.turn, M.chooseDeclaration(state, state.turn, level, random));
  }
  while (state.phase === "play") {
    const p = state.turn;
    const [M, level] = bot(levels[p]);
    while (M.chooseCall(state, p, level)) E.call(state, p);
    E.play(state, p, M.chooseCard(state, p, level, random));
  }
  return state;
}

const random = seeded(Number(seedArg));
const totals = { [a]: 0, [b]: 0 };
const stats = { games: 0, ms: 0 };
const by = { [a]: { solos: 0, soloWins: 0, soloPoints: 0, calls: 0, callWins: 0, callPoints: 0 }, [b]: { solos: 0, soloWins: 0, soloPoints: 0, calls: 0, callWins: 0, callPoints: 0 } };
const perGame = [];
for (let i = 0; i < Number(deals); i++) {
  const deck = E.shuffle(E.createDeck(), random);
  const hands = [0, 1, 2, 3].map((p) => deck.slice(p * 12, p * 12 + 12));
  const dealer = i % 4;
  let diff = 0;
  for (const levels of [[a, b, a, b], [b, a, b, a]]) {
    const start = performance.now();
    const state = playGame(hands, dealer, levels, random);
    stats.ms += performance.now() - start;
    stats.games++;
    const r = state.result;
    r.scores.forEach((n, p) => (totals[levels[p]] += n / 2)); // per seat
    diff += r.scores[levels.indexOf(a)] - r.scores[levels.indexOf(b)];
    if (state.soloist !== null && state.contract !== "wedding") {
      const s = by[levels[state.soloist]];
      s.solos++;
      if (r.winner === "re") s.soloWins++;
      s.soloPoints += r.scores[state.soloist];
    }
    for (const c of state.callLog) {
      const s = by[levels[c.player]];
      s.calls++;
      if (r.winner === E.party(state, c.player)) s.callWins++;
      s.callPoints += r.scores[c.player];
    }
  }
  perGame.push(diff / 4);
}
const mean = perGame.reduce((s, x) => s + x, 0) / perGame.length;
const sd = Math.sqrt(perGame.reduce((s, x) => s + (x - mean) ** 2, 0) / (perGame.length - 1));
const ci = (1.96 * sd) / Math.sqrt(perGame.length);
const per = (x) => (x / stats.games).toFixed(2);
console.log(`${stats.games} games (${deals} deals × 2)`);
console.log(`  ${a}: ${per(totals[a])} points per seat and game`);
console.log(`  ${b}: ${per(totals[b])} points per seat and game`);
console.log(`  ${a} − ${b} per seat: ${mean.toFixed(2)} ± ${ci.toFixed(2)} (95 %)`);
const pct = (x, n) => `${((100 * x) / Math.max(1, n)).toFixed(0)} %`;
const avg = (x, n) => (x / Math.max(1, n)).toFixed(1);
for (const level of [a, b]) {
  const s = by[level];
  console.log(`  ${level}: ${s.solos} solos (${pct(s.soloWins, s.solos)} won, ${avg(s.soloPoints, s.solos)} each), ${s.calls} calls (${pct(s.callWins, s.calls)} won, ${avg(s.callPoints, s.calls)} each)`);
}
console.log(`  ${(stats.ms / stats.games).toFixed(1)} ms per game`);
