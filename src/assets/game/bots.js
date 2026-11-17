// Computer players.
//
// "normal" plays like a solid club player, by the conventions from the rules page, so
// you can read its cards like a human's:
//   - Re leads trumps (so the partner's queen of clubs can win), Kontra leads plain suits,
//   - a Re player shows the queen of clubs as soon as it wins a trick,
//   - plain aces on the first round of their suit, black aces before hearts,
//     no second round of hearts,
//   - load up (schmieren) only tricks the partner is sure to win, the fox first,
//   - trump in with at least a jack while someone can still overtrump,
//   - Re/Kontra with a good hand, early, so the partner knows; solos only with clear hands.
// It knows what a player at the table could know (own cards, played cards, calls) and
// reads the others' leads as hints: leading trumps looks like Re, leading low plain cards
// like Kontra.
//
// "strong" plays the same, but before each card it imagines a few dozen ways the hidden
// cards could be distributed (only those that fit everything seen so far), plays the game
// to the end in its head for every card it could play, and picks the card that does best
// on average ("Perfect Information Monte Carlo", as in Sievers & Helmert, KI 2015).

import * as E from "./engine.js";

export const LEVELS = ["normal", "strong"];

/** Thresholds, measured with scripts/arena.mjs (see README). */
export const TUNING = { re: 11, kontra: 11.5 };

// The full deck with or without nines, for working out which cards are still out there.
const DECKS = { true: E.createDeck({ nines: true }), false: E.createDeck({ nines: false }) };
const deckOf = (state) => DECKS[state.nines !== false];
const SIDES = [0, 1, 2, 3];

// ---------- What a bot knows and believes ----------

/** Cards nobody has played yet and `p` doesn't hold. */
function unseenCards(state, p) {
  const gone = new Set(state.players[p].hand.map((card) => card.id));
  for (const trick of state.tricks) for (const { card } of trick.cards) gone.add(card.id);
  for (const { card } of state.trick) gone.add(card.id);
  return deckOf(state).filter((card) => !gone.has(card.id));
}

/** For every player the groups ("T" or a suit) they could not follow: they have none left. */
export function voids(state) {
  const result = SIDES.map(() => new Set());
  const tricks = [...state.tricks.map((t) => t.cards), state.trick];
  for (const cards of tricks) {
    if (!cards.length) continue;
    const led = E.group(state.contract, cards[0].card);
    for (const { player, card } of cards.slice(1)) if (E.group(state.contract, card) !== led) result[player].add(led);
  }
  return result;
}

/** The game looks like a normal game to `viewer` (a silent solo does, for everyone but the soloist). */
const looksNormal = (state, viewer) => state.contract === "normal" || (state.contract === "silent" && viewer !== state.soloist);

/**
 * Soft hints from the leads: +1 for every trump lead (Re usually leads trumps), −1 for every
 * low plain lead (Kontra usually leads plain suits). Aces are neutral: everyone leads them.
 */
function leadHints(state) {
  const hints = [0, 0, 0, 0];
  const leads = [...state.tricks.map((t) => t.cards[0]), state.trick[0]].filter(Boolean);
  for (const { player, card } of leads) {
    if (E.isTrump(state.contract, card)) hints[player]++;
    else if (card.rank !== "A") hints[player]--;
  }
  return hints;
}

/**
 * The parties as `viewer` believes them: certain where E.knownParties knows them,
 * otherwise a guess from the leads when they clearly point one way. null = no idea.
 */
export function beliefs(state, viewer) {
  const known = E.knownParties(state, viewer);
  if (!looksNormal(state, viewer) || known.every(Boolean)) return known;
  const unknown = SIDES.filter((p) => !known[p]);
  const reLeft = 2 - known.filter((x) => x === "re").length;
  if (reLeft <= 0 || reLeft >= unknown.length) return known;
  const hints = leadHints(state);
  const sorted = [...unknown].sort((a, b) => hints[b] - hints[a]);
  if (hints[sorted[reLeft - 1]] <= hints[sorted[reLeft]]) return known; // no clear difference
  const guess = [...known];
  sorted.forEach((p, i) => (guess[p] = i < reLeft ? "re" : "kontra"));
  return guess;
}

// ---------- Hand strength: reservations and calls ----------

const isHigh = (contract, card) => {
  const t = E.trumpRank(contract, card);
  return t >= 0 && t <= 2; // ten of hearts, queen of clubs, queen of spades in a normal game
};

/** Rough value of a hand for a contract, in "tricks-ish" units. */
function handValue(hand, contract) {
  const trumps = hand.filter((card) => E.isTrump(contract, card));
  let value = trumps.length + trumps.filter((card) => isHigh(contract, card)).length * 0.75;
  for (const suit of E.SUITS) {
    const plain = hand.filter((card) => card.suit === suit && !E.isTrump(contract, card));
    if (!plain.length) value += trumps.length >= 5 ? 0.75 : 0; // can trump this suit right away
    else if (plain.some((card) => card.rank === "A") && plain.length <= 2) value += 0.75; // the ace likely goes through
  }
  return value;
}

export function chooseDeclaration(state, p, level) {
  const hand = state.players[p].hand;
  // Solos only with clear hands: they count triple, and a lost solo hurts.
  const aces = (contract) => hand.filter((card) => card.rank === "A" && !E.isTrump(contract, card)).length;
  const count = (contract) => hand.filter((card) => E.isTrump(contract, card)).length;
  const top = (contract, n) => hand.filter((card) => E.trumpRank(contract, card) >= 0 && E.trumpRank(contract, card) < n).length;
  if (count("queens") >= 6 && top("queens", 2) >= 3 && aces("queens") >= 2) return "queens";
  if (count("jacks") >= 6 && top("jacks", 2) >= 3 && aces("jacks") >= 3) return "jacks";
  for (const solo of ["clubs", "spades", "hearts", "diamonds"]) {
    if (count(solo) >= Math.ceil((10 * E.size(state)) / 12) && top(solo, 3) >= 4) return solo; // 10 of 12, 9 of 10
  }
  void level;
  return E.canWedding(state, p) ? "wedding" : "healthy";
}

/** Re or Kontra early with a good hand; the partner then knows. Never more than that. */
export function chooseCall(state, p, level) {
  void level;
  if (E.nextCall(state, p) !== 1) return false;
  const hand = state.players[p].hand;
  // The same thresholds work with and without nines: fewer cards, but more of them trumps
  // (measured with 2,000 games each: about 0.9 calls per game, ~78 % of them won).
  const value = handValue(hand, state.contract);
  if (state.soloist === p) return value >= 11;
  // Better hands call at once; the partner's call or a played queen makes us bolder.
  const side = E.party(state, p);
  const known = E.knownParties(state, p);
  const partnerShown = SIDES.some((q) => q !== p && known[q] === side && state.revealed[q]);
  const need = side === "re" ? TUNING.re : TUNING.kontra;
  return value >= need - (partnerShown ? 1 : 0);
}

// ---------- Playing a card: the conventions ----------

export function chooseCard(state, p, level, random = Math.random) {
  const legal = E.legalCards(state, p);
  if (legal.length === 1) return legal[0].id;
  if (level === "strong") return search(state, p, legal, random);
  return conventionCard(state, p, legal).id;
}

/** How much a card is worth keeping: trumps by rank, plain cards by their order. */
function strength(contract, card) {
  const t = E.trumpRank(contract, card);
  if (t >= 0) return 100 - t;
  return 10 - E.plainOrder(contract).indexOf(card.rank);
}

const byCheapest = (contract) => (a, b) => strength(contract, a) - strength(contract, b) || E.POINTS[a.rank] - E.POINTS[b.rank];
const cheapest = (contract, cards) => [...cards].sort(byCheapest(contract))[0];
const isFox = (card) => E.key(card) === "A♦";

/** Context for a decision, computed once. */
function view(state, p) {
  const contract = state.contract;
  const side = E.party(state, p);
  const belief = beliefs(state, p);
  const unseen = unseenCards(state, p);
  const empty = voids(state);
  const rounds = {}; // how often each plain suit was led
  for (const t of state.tricks) {
    const g = E.group(contract, t.cards[0].card);
    rounds[g] = (rounds[g] ?? 0) + 1;
  }
  const partner = (q) => q !== p && side && belief[q] === side;
  const opponent = (q) => q !== p && !(side && belief[q] === side); // unknown counts as opponent
  return { contract, side, belief, unseen, empty, rounds, partner, opponent };
}

/** Could one of `players` (still to play) beat `card` in a trick led with `led`? */
/** A plain suit with at most 6 cards in the deck (hearts in a normal game). */
const shortSuit = (state, suit) => deckOf(state).filter((c) => c.suit === suit && !E.isTrump(state.contract, c)).length <= 6;

function canBeBeaten(state, v, card, led, players) {
  const higher = v.unseen.filter((c) => E.beats(v.contract, c, card, led));
  if (!higher.length) return false;
  return players.some((q) => {
    // Out of the suit for sure, or likely: after a first round, or in a short suit like
    // hearts in a normal game (only 6 plain cards), where someone is often blank already.
    const voidLed = v.empty[q].has(led) || (led !== "T" && ((v.rounds[led] ?? 0) >= 1 || shortSuit(state, led)));
    // Following suit with a higher card, or trumping in when out of the suit.
    if (!voidLed) return higher.some((c) => E.group(v.contract, c) === led);
    return !v.empty[q].has("T") && higher.some((c) => E.isTrump(v.contract, c));
  });
}

function conventionCard(state, p, legal) {
  return state.trick.length ? follow(state, p, legal, view(state, p)) : lead(state, p, legal, view(state, p));
}

function lead(state, p, legal, v) {
  const { contract } = v;
  const hand = state.players[p].hand;
  const trumps = legal.filter((card) => E.isTrump(contract, card));
  const plain = legal.filter((card) => !E.isTrump(contract, card));
  const suitLength = (suit) => hand.filter((card) => card.suit === suit && !E.isTrump(contract, card)).length;
  const soloist = state.soloist === p;
  const againstSolo = state.soloist !== null && !soloist;

  // A boss trump (nothing higher left) pulls trumps safely: good for the soloist and for Re.
  const boss = trumps.filter((card) => !v.unseen.some((c) => E.beats(contract, c, card, "T")));
  if (soloist && boss.length) return cheapest(contract, boss);

  // Plain aces on the first round of their suit: black before hearts, short suits first.
  const aces = plain.filter((card) => card.rank === "A" && !(v.rounds[card.suit] > 0));
  if (aces.length && !(soloist && trumps.length >= 6)) {
    return [...aces].sort((a, b) => (a.suit === "♥") - (b.suit === "♥") || suitLength(a.suit) - suitLength(b.suit))[0];
  }

  const notFox = (cards) => cards.filter((card) => !isFox(card));
  const lowTrump = () => cheapest(contract, notFox(trumps).length ? notFox(trumps) : trumps);
  const lowPlain = () => {
    // Avoid suits that already went round once (someone is likely out and trumps),
    // and the second round of hearts in particular.
    const fresh = plain.filter((card) => !(v.rounds[card.suit] > 0));
    const pool = fresh.length ? fresh : plain;
    return [...pool].sort((a, b) => suitLength(a.suit) - suitLength(b.suit) || byCheapest(contract)(a, b))[0];
  };

  if (soloist) {
    if (boss.length) return cheapest(contract, boss);
    // Pull trumps with small ones; if only the fox is left, rather a plain card.
    return notFox(trumps).length || !plain.length ? lowTrump() : lowPlain();
  }
  if (againstSolo) return plain.length ? lowPlain() : lowTrump();

  // Re leads trumps (the partner's queen of clubs can take it), Kontra leads plain suits.
  // If the partner announced Kontra, they have strength in trumps: lead a trump for them.
  const partnerCalled = state.callLog.some((c) => v.partner(c.player));
  // (Never lead the fox for this, if anything else is possible.)
  if (notFox(trumps).length && (v.side === "re" || partnerCalled || !plain.length)) {
    if (boss.length && trumps.length >= 4) return cheapest(contract, boss);
    return lowTrump();
  }
  return plain.length ? lowPlain() : lowTrump();
}

function follow(state, p, legal, v) {
  const { contract } = v;
  const trick = state.trick;
  const led = E.group(contract, trick[0].card);
  const best = trick[E.winningIndex(contract, trick)];
  const after = SIDES.map((i) => (p + i) % 4).slice(1, 4 - trick.length); // still to play after p
  const points = E.trickPoints(trick);
  const opponentsAfter = after.filter(v.opponent);

  const winners = legal.filter((card) => E.beats(contract, card, best.card, led));
  const sureWinners = winners.filter((card) => !canBeBeaten(state, v, card, led, opponentsAfter));
  const partnerBest = v.partner(best.player);
  const partnerSafe = partnerBest && !canBeBeaten(state, v, best.card, led, opponentsAfter);

  // 1. The partner has the trick for sure: load it up, the fox first. Only for a partner we
  //    know for sure (a played queen of clubs, a call, counting) – a partner guessed from
  //    the leads may be an opponent, and then the fox and the aces are gone.
  if (partnerSafe && E.knownParties(state, p)[best.player] === v.side) return schmier(contract, legal);
  if (partnerSafe) return discard(contract, legal);

  // 2. Show the queen of clubs (Re) as soon as it takes a trick: the partner then knows.
  if (contract === "normal" && v.side === "re" && !state.revealed[p]) {
    const queen = winners.find((card) => E.key(card) === "Q♣");
    if (queen && (sureWinners.includes(queen) || points >= 10 || state.tricks.length < 4)) return queen;
  }

  // 3. Take the trick if it is worth it and nobody after us can take it back.
  if (!partnerBest && sureWinners.length) {
    const worth = points + Math.max(...sureWinners.map((c) => E.POINTS[c.rank]));
    // The fox only when nobody can come after us: otherwise it's not as safe as it looks.
    const cheap = cheapest(contract, after.length ? withoutFox(sureWinners) : sureWinners);
    if (worth >= 10 || strength(contract, cheap) < 92 || after.length === 0) return cheap;
  }

  // 4. An opponent leads a plain suit we can't follow: trump in high enough (at least a jack)
  //    while someone can still overtrump with the fox or a lower trump.
  if (!partnerBest && led !== "T" && winners.length && winners.every((c) => E.isTrump(contract, c))) {
    const jackOrBetter = winners.filter((c) => E.trumpRank(contract, c) <= 8 && E.trumpRank(contract, c) >= 0); // never the fox
    if (opponentsAfter.length && jackOrBetter.length && points >= 10) return cheapest(contract, jackOrBetter);
    if (!opponentsAfter.length && (points >= 4 || winners.some((c) => strength(contract, c) < 92))) return cheapest(contract, winners);
  }

  // 5. Last to play against an opponent: take it with the cheapest card if it has points.
  if (!partnerBest && after.length === 0 && winners.length && points >= 4) return cheapest(contract, winners);

  // 6. Partner probably wins but it isn't sure: don't give points, don't overtake.
  // 7. Otherwise: give as little as possible, keep the fox and strong cards.
  return discard(contract, legal);
}

/** The cards without the fox, unless that leaves nothing. */
const withoutFox = (cards) => (cards.some((c) => !isFox(c)) ? cards.filter((c) => !isFox(c)) : cards);

/** Load up the partner's trick: fox, aces, tens, then other points – but keep the high trumps. */
function schmier(contract, legal) {
  const keep = (card) => E.trumpRank(contract, card) >= 0 && E.trumpRank(contract, card) <= 4; // Dulle and queens
  const pool = legal.filter((card) => !keep(card));
  const cards = pool.length ? pool : legal;
  return [...cards].sort((a, b) => isFox(b) - isFox(a) || E.POINTS[b.rank] - E.POINTS[a.rank] || strength(contract, a) - strength(contract, b))[0];
}

/** Give as few points as possible, never the fox if avoidable. */
function discard(contract, legal) {
  const noFox = legal.filter((card) => !isFox(card));
  const pool = noFox.length ? noFox : legal;
  return [...pool].sort((a, b) => E.POINTS[a.rank] - E.POINTS[b.rank] || strength(contract, a) - strength(contract, b))[0];
}

// ---------- "strong": imagine the hidden cards, play it out ----------

/** Games played in the head per decision, shared by the cards to choose from. */
export const BUDGET = { rollouts: 160, minWorlds: 8, maxWorlds: 30 };

/**
 * How much better (in game points per game) another card must look than the card the
 * conventions would play, beyond the noise. With few imagined deals the averages are
 * noisy; without this, "strong" sometimes threw a queen into a trick its partner had
 * already won, just because that card happened to come out ahead by chance.
 */
export const OVERRULE = { margin: 0.1, sigmas: 2 };

function search(state, p, legal, random) {
  // Both copies of a card are worth the same: try each kind once.
  const kinds = [...new Map(legal.map((card) => [E.key(card), card])).values()];
  const preferred = conventionCard(state, p, legal);
  if (kinds.length === 1) return preferred.id;
  const target = Math.max(BUDGET.minWorlds, Math.min(BUDGET.maxWorlds, Math.floor(BUDGET.rollouts / kinds.length)));
  // values[k][w]: how card kind k does in imagined deal w. Every card is tried on the same
  // deals, so they can be compared deal by deal ("paired"), which cancels most of the luck.
  const values = kinds.map(() => []);
  for (let w = 0; w < target; w++) {
    const world = sampleWorld(state, p, random);
    if (!world) continue;
    kinds.forEach((card, k) => {
      const sim = structuredClone(world);
      E.play(sim, p, card.id);
      values[k].push(rollout(sim, p));
    });
  }
  const base = kinds.findIndex((card) => E.key(card) === E.key(preferred));
  const n = values[base].length;
  if (n < 2) return preferred.id;
  // Overrule the conventions only for a card that is clearly better.
  let best = null;
  let bestGain = 0;
  kinds.forEach((card, k) => {
    if (k === base) return;
    const diffs = values[k].map((v, w) => v - values[base][w]);
    const mean = diffs.reduce((a, b) => a + b, 0) / n;
    const sd = Math.sqrt(diffs.reduce((a, d) => a + (d - mean) ** 2, 0) / (n - 1));
    const sure = mean - OVERRULE.sigmas * (sd / Math.sqrt(n));
    if (sure > OVERRULE.margin && mean > bestGain) {
      best = card;
      bestGain = mean;
    }
  });
  return best ? best.id : preferred.id;
}

/** Plays the game to the end with "normal" bots everywhere (no new calls); value for `p`. */
function rollout(sim, p) {
  while (sim.phase === "play") {
    const q = sim.turn;
    const legal = E.legalCards(sim, q);
    E.play(sim, q, legal.length === 1 ? legal[0].id : conventionCard(sim, q, legal).id);
  }
  const r = sim.result;
  const side = E.party(sim, p);
  // Game points first; card points break ties ("win by more").
  return r.scores[p] + (r.points[side] - 120) / 240;
}

/**
 * A copy of the state where the cards `p` can't see are dealt anew, at random, but so that
 * they fit everything known: who couldn't follow which suit, who must or can't hold a queen
 * of clubs (Re players who haven't shown it yet, Kontra players, the wedding player).
 * Returns null if no fitting distribution was found.
 */
export function sampleWorld(state, p, random = Math.random) {
  const others = SIDES.filter((q) => q !== p);
  const need = Object.fromEntries(others.map((q) => [q, state.players[q].hand.length]));
  const empty = voids(state);
  const known = E.knownParties(state, p);
  const unseen = unseenCards(state, p);
  const played = (q) => [...state.tricks.flatMap((t) => t.cards), ...state.trick].filter((e) => e.player === q && E.key(e.card) === "Q♣").length;

  // How many queens of clubs each other player must hold, and who can't hold one.
  const mustQueens = Object.fromEntries(others.map((q) => [q, 0]));
  const noQueen = new Set();
  const normalLooking = looksNormal(state, p);
  for (const q of others) {
    if (state.contract === "wedding") {
      if (q === state.wedding) mustQueens[q] = 2 - played(q);
      else noQueen.add(q);
    } else if (normalLooking) {
      if (played(q) >= 1 || known[q] === "kontra") noQueen.add(q); // in a normal game a Re player has exactly one
      else if (known[q] === "re") mustQueens[q] = 1; // called Re, but hasn't shown the queen yet
    }
  }

  for (let attempt = 0; attempt < 30; attempt++) {
    const hands = Object.fromEntries(others.map((q) => [q, []]));
    const room = (q) => need[q] - hands[q].length;
    const fits = (q, card) => room(q) > 0 && !empty[q].has(E.group(state.contract, card)) && !(E.key(card) === "Q♣" && noQueen.has(q));
    const queens = unseen.filter((card) => E.key(card) === "Q♣");
    const rest = E.shuffle(unseen.filter((card) => E.key(card) !== "Q♣"), random);
    let ok = true;
    // Queens of clubs first: to those who must have one, the rest to anyone allowed.
    for (const q of others) for (let i = 0; i < mustQueens[q]; i++) {
      const queen = queens.pop();
      if (!queen) break;
      hands[q].push(queen);
    }
    for (const queen of queens) {
      const options = others.filter((q) => fits(q, queen) && !(normalLooking && hands[q].some((c) => E.key(c) === "Q♣")) && mustQueens[q] === 0);
      if (!options.length) {
        ok = false;
        break;
      }
      hands[options[Math.floor(random() * options.length)]].push(queen);
    }
    if (!ok) continue;
    // Then the other cards, the most restricted first.
    const options = (card) => others.filter((q) => fits(q, card));
    rest.sort((a, b) => options(a).length - options(b).length);
    for (const card of rest) {
      const choices = options(card);
      if (!choices.length) {
        ok = false;
        break;
      }
      // Weighted by free room, so the deal stays close to uniform.
      let r = random() * choices.reduce((s, q) => s + room(q), 0);
      const q = choices.find((x) => (r -= room(x)) < 0) ?? choices[choices.length - 1];
      hands[q].push(card);
    }
    if (!ok || others.some((q) => room(q) !== 0)) continue;
    const world = structuredClone(state);
    for (const q of others) world.players[q].hand = hands[q];
    // In what looks like a normal game, the imagined deal decides the teams. (A silent solo
    // looks like a normal game from outside, so it is imagined as one: no peeking.)
    if (normalLooking) {
      world.contract = "normal";
      world.soloist = null;
      world.re = SIDES.filter((q) => world.players[q].hand.some((c) => E.key(c) === "Q♣") || played(q) > 0);
    }
    return world;
  }
  return null;
}
