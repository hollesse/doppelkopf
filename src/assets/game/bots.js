// Computer players. "easy" plays a random allowed card and never calls.
// "normal" plays the strategies from the rules page: plain aces early, load up the
// partner's tricks, win tricks with points cheaply, protect the fox, call with a strong hand.
// Bots only use what they could know at a real table: their own cards, the cards played
// and the parties that are public (see knownParties in engine.js).

import * as E from "./engine.js";

const pick = (list, random) => list[Math.floor(random() * list.length)];

// ---------- Reservations ----------

/** Counts what makes a hand strong for a contract. */
function handInfo(hand, contract) {
  const trumps = hand.filter((card) => E.isTrump(contract, card));
  const top = trumps.filter((card) => E.trumpRank(contract, card) < 3).length; // the best three kinds
  const aces = hand.filter((card) => card.rank === "A" && !E.isTrump(contract, card)).length;
  return { trumps: trumps.length, top, aces };
}

export function chooseDeclaration(state, p, level, random = Math.random) {
  const hand = state.players[p].hand;
  if (level === "normal") {
    const queens = handInfo(hand, "queens");
    if (queens.trumps >= 6 && queens.aces >= 2) return "queens";
    const jacks = handInfo(hand, "jacks");
    if (jacks.trumps >= 6 && jacks.aces >= 3) return "jacks";
    for (const solo of ["clubs", "spades", "hearts", "diamonds"]) {
      const info = handInfo(hand, solo);
      if (info.trumps >= 10 && info.top >= 3) return solo;
    }
  }
  return E.canWedding(state, p) ? "wedding" : "healthy";
}

// ---------- Calls ----------

/** Whether the bot makes its next call now (it only ever calls Re or Kontra). */
export function chooseCall(state, p, level) {
  if (level !== "normal" || E.nextCall(state, p) !== 1) return false;
  const { trumps, top, aces } = handInfo(state.players[p].hand, state.contract);
  const soloist = state.soloist === p;
  if (soloist) return trumps >= 9 && top >= 3;
  if (E.party(state, p) === "re") return trumps >= 6 && top + aces >= 4;
  return trumps >= 7 && top >= 3;
}

// ---------- Playing a card ----------

/** How valuable a card is to keep: trumps by their rank, plain cards by their order. */
function strength(contract, card) {
  const t = E.trumpRank(contract, card);
  if (t >= 0) return 100 - t;
  return 10 - E.plainOrder(contract).indexOf(card.rank);
}

const cheapest = (contract, cards) =>
  [...cards].sort((a, b) => strength(contract, a) - strength(contract, b) || E.POINTS[a.rank] - E.POINTS[b.rank])[0];

/** Was a plain suit already led in an earlier trick? */
const suitLed = (state, suit) => state.tricks.some((t) => E.group(state.contract, t.cards[0].card) === suit);

/** Cards of a suit (or "T") still out there, not in this hand and not yet played. */
function unseen(state, p, groupId) {
  const gone = new Set([...state.tricks.flatMap((t) => t.cards), ...state.trick].map(({ card }) => card.id));
  for (const card of state.players[p].hand) gone.add(card.id);
  return E.createDeck().filter((card) => !gone.has(card.id) && E.group(state.contract, card) === groupId);
}

/** Is this the highest card of its kind still in play (no higher one unseen)? */
function isBoss(state, p, card) {
  const g = E.group(state.contract, card);
  const led = card.suit;
  return !unseen(state, p, g).some((other) => E.beats(state.contract, other, card, led));
}

export function chooseCard(state, p, level, random = Math.random) {
  const legal = E.legalCards(state, p);
  if (level !== "normal" || legal.length === 1) return pick(legal, random).id;
  return (state.trick.length ? follow(state, p, legal) : lead(state, p, legal)).id;
}

function lead(state, p, legal) {
  const contract = state.contract;
  const side = E.party(state, p);
  // A plain ace in a suit nobody has led yet usually goes through.
  const aces = legal.filter((card) => card.rank === "A" && !E.isTrump(contract, card) && !suitLed(state, card.suit));
  if (aces.length) return aces[0];
  const trumps = legal.filter((card) => E.isTrump(contract, card));
  const plain = legal.filter((card) => !E.isTrump(contract, card));
  // The highest trump still in play wins for sure.
  const boss = trumps.filter((card) => isBoss(state, p, card));
  if (boss.length && (side === "re" || state.soloist === p)) return boss[0];
  if (trumps.length && (state.soloist === p || (side === "re" && trumps.length >= 4) || !plain.length)) {
    // Pull trumps with a small one, but never give away the fox.
    const small = trumps.filter((card) => E.key(card) !== "A♦");
    return cheapest(contract, small.length ? small : trumps);
  }
  // Otherwise a low card from the shortest plain suit, so we can trump it later.
  const bySuit = (suit) => plain.filter((card) => card.suit === suit).length;
  const sorted = [...plain].sort((a, b) => bySuit(a.suit) - bySuit(b.suit) || strength(contract, a) - strength(contract, b));
  return sorted[0];
}

function follow(state, p, legal) {
  const contract = state.contract;
  const trick = state.trick;
  const led = E.group(contract, trick[0].card);
  const best = trick[E.winningIndex(contract, trick)];
  const known = E.knownParties(state, p);
  const mine = known[p];
  const last = trick.length === E.PLAYERS - 1;
  const partnerWins = mine && known[best.player] === mine;
  const points = E.trickPoints(trick);

  const winners = legal.filter((card) => E.beats(contract, card, best.card, led));
  // A partner's trick is safe if we are last, or nobody after us can beat their card.
  const safe = partnerWins && (last || isBoss(state, p, best.card));

  if (safe) {
    // Load up: the most points, but keep the high trumps.
    const loads = legal.filter((card) => E.trumpRank(contract, card) < 0 || E.trumpRank(contract, card) >= 5);
    const pool = loads.length ? loads : legal;
    return [...pool].sort((a, b) => E.POINTS[b.rank] - E.POINTS[a.rank] || strength(contract, a) - strength(contract, b))[0];
  }
  if (winners.length && !partnerWins) {
    if (last) {
      // Win as cheaply as possible.
      return cheapest(contract, winners);
    }
    // Not last: a card the others are unlikely to beat, if the trick is worth it.
    const sure = winners.filter((card) => isBoss(state, p, card));
    if (sure.length) return cheapest(contract, sure);
    if (points >= 10 || led !== "T") {
      const strong = winners.filter((card) => E.trumpRank(contract, card) >= 0 && E.trumpRank(contract, card) <= 4);
      if (strong.length) return cheapest(contract, strong);
      if (led !== "T" && E.isTrump(contract, winners[0])) return cheapest(contract, winners.filter((c) => E.key(c) !== "A♦")) ?? cheapest(contract, winners);
    }
  }
  // Can't or shouldn't win: give as few points as possible, keep strong cards and the fox.
  const throwaway = legal.filter((card) => E.key(card) !== "A♦");
  const pool = throwaway.length ? throwaway : legal;
  return [...pool].sort((a, b) => E.POINTS[a.rank] - E.POINTS[b.rank] || strength(contract, a) - strength(contract, b))[0];
}
