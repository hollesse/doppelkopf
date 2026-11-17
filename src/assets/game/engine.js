// Doppelkopf rules, without any user interface. Used by the game page (ui.js),
// the computer players (bots.js) and the tests, which run it in Node.
//
// Rules as on the rules page: 48 cards with nines, the first of two equal cards wins
// (also the ten of hearts), Re/Kontra and further calls, wedding, solos, extra points
// (fox, Charlie, Doppelkopf) in normal games, solos count triple.
//
// Seats 0–3 in clockwise order. The state is a plain object; functions that change it
// return a list of events (what happened), which the page turns into messages and animations.

export const SUITS = ["♣", "♠", "♥", "♦"];
export const RANKS = ["9", "10", "J", "Q", "K", "A"];
export const POINTS = { 9: 0, 10: 10, J: 2, Q: 3, K: 4, A: 11 };
export const PLAYERS = 4;
export const TRICKS = 12;

/** Solos a player can announce. "silent" (a wedding kept quiet) is a solo too, but nobody announces it. */
export const SOLOS = ["queens", "jacks", "clubs", "spades", "hearts", "diamonds", "none"];
const SOLO_SUIT = { clubs: "♣", spades: "♠", hearts: "♥", diamonds: "♦" };

/** Calls in order. Level 1 is Re or Kontra, then no 90, no 60, no 30, black. */
export const CALLS = [null, "re", "no90", "no60", "no30", "black"];
/** A call of level L needs the opponents below this many points (level 5: no trick at all). */
const LIMIT = { 2: 90, 3: 60, 4: 30 };

export const key = (card) => card.rank + card.suit;
export const isRed = (card) => card.suit === "♥" || card.suit === "♦";
export const next = (seat) => (seat + 1) % PLAYERS;

// ---------- Cards ----------

export function createDeck() {
  const deck = [];
  for (const copy of ["a", "b"]) for (const suit of SUITS) for (const rank of RANKS) deck.push({ id: rank + suit + copy, rank, suit });
  return deck;
}

export function shuffle(cards, random = Math.random) {
  const list = [...cards];
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

const TRUMPS_NORMAL = ["10♥", "Q♣", "Q♠", "Q♥", "Q♦", "J♣", "J♠", "J♥", "J♦"];

/** Trumps from high to low, as keys like "Q♣". */
export function trumpOrder(contract) {
  if (contract === "queens") return ["Q♣", "Q♠", "Q♥", "Q♦"];
  if (contract === "jacks") return ["J♣", "J♠", "J♥", "J♦"];
  if (contract === "none") return [];
  const suit = SOLO_SUIT[contract] ?? "♦"; // normal game, wedding and silent solo: diamonds
  const rest = ["A", "10", "K", "9"].map((rank) => rank + suit).filter((k) => k !== "10♥");
  return [...TRUMPS_NORMAL, ...rest];
}

/** Ranks of a plain suit from high to low. */
export function plainOrder(contract) {
  if (contract === "queens") return ["A", "10", "K", "J", "9"];
  if (contract === "jacks") return ["A", "10", "K", "Q", "9"];
  if (contract === "none") return ["A", "10", "K", "Q", "J", "9"];
  return ["A", "10", "K", "9"];
}

// The orders are looked up very often (the bots play whole games in their head), so they
// are computed once per contract.
const CONTRACTS = ["normal", "wedding", "silent", ...SOLOS];
const TRUMP_INDEX = Object.fromEntries(CONTRACTS.map((c) => [c, new Map(trumpOrder(c).map((k, i) => [k, i]))]));
const PLAIN_INDEX = Object.fromEntries(CONTRACTS.map((c) => [c, new Map(plainOrder(c).map((r, i) => [r, i]))]));

// The same by card id ("Q♣a"), which saves building the key for the 48 real cards.
const TRUMP_BY_ID = Object.fromEntries(
  CONTRACTS.map((c) => [c, new Map(createDeck().map((card) => [card.id, TRUMP_INDEX[c].get(key(card)) ?? -1]))]),
);

/** Position in the trump order (0 = highest), or -1 for a plain card. */
export function trumpRank(contract, card) {
  const rank = TRUMP_BY_ID[contract].get(card.id);
  return rank !== undefined ? rank : (TRUMP_INDEX[contract].get(card.rank + card.suit) ?? -1);
}
export const isTrump = (contract, card) => trumpRank(contract, card) >= 0;
/** What a card counts as for following suit: "T" for trump, otherwise its suit. */
export const group = (contract, card) => (isTrump(contract, card) ? "T" : card.suit);

/** Does `card` beat `best`, which was played earlier in a trick led with `led`? */
export function beats(contract, card, best, led) {
  const a = trumpRank(contract, best);
  const b = trumpRank(contract, card);
  if (b >= 0) return a < 0 || b < a; // equal cards: the first one stays
  if (a >= 0 || card.suit !== led) return false;
  const order = PLAIN_INDEX[contract];
  return order.get(card.rank) < order.get(best.rank);
}

/** Index (into the trick) of the card that wins it so far. */
export function winningIndex(contract, trick) {
  const led = group(contract, trick[0].card);
  let best = 0;
  for (let i = 1; i < trick.length; i++) if (beats(contract, trick[i].card, trick[best].card, led)) best = i;
  return best;
}

export const trickPoints = (trick) => trick.reduce((sum, { card }) => sum + POINTS[card.rank], 0);

// ---------- A new game ----------

/** Deals a new game. `dealer` is a seat; the next one leads and declares first. */
export function createGame({ dealer = 0, random = Math.random, hands = null } = {}) {
  const deck = hands ? null : shuffle(createDeck(), random);
  const leader = next(dealer);
  return {
    dealer,
    leader,
    phase: "reserve", // → "play" → "over"
    turn: leader,
    players: Array.from({ length: PLAYERS }, (_, p) => ({ hand: hands ? hands[p] : deck.slice(p * 12, p * 12 + 12) })),
    declarations: Array(PLAYERS).fill(null), // "healthy" | "wedding" | a solo
    contract: null, // "normal" | "wedding" | "silent" | one of SOLOS
    soloist: null, // seat of a solo player, also a wedding without partner
    wedding: null, // seat of the player with both queens of clubs
    partner: null, // seat that joined the wedding
    clarified: 0, // in a wedding: the trick (1–3) that decided the teams; 0 otherwise
    re: [], // seats of the Re party, once fixed
    calls: { re: 0, kontra: 0 }, // highest call level of each party
    callLog: [], // [{ player, level }]
    revealed: Array(PLAYERS).fill(false), // the party of this player is public
    trick: [], // [{ player, card }]
    tricks: [], // [{ cards: [{ player, card }], winner, points }]
    result: null,
  };
}

const hasBothQueens = (hand) => hand.filter((card) => key(card) === "Q♣").length === 2;
export const canWedding = (state, p) => hasBothQueens(state.players[p].hand);

/** Options for the reservation round: "healthy", "wedding" (with both queens of clubs) and the solos. */
export function declarationOptions(state, p) {
  return ["healthy", ...(canWedding(state, p) ? ["wedding"] : []), ...SOLOS];
}

/** A player says "healthy" or announces a reservation. Everyone declares once, starting with the leader. */
export function declare(state, p, declaration) {
  if (state.phase !== "reserve" || state.turn !== p) throw new Error(`not ${p}'s turn to declare`);
  if (!declarationOptions(state, p).includes(declaration)) throw new Error(`invalid declaration ${declaration}`);
  state.declarations[p] = declaration;
  const events = [{ type: "declare", player: p, reserved: declaration !== "healthy" }];
  state.turn = next(p);
  if (state.declarations.every(Boolean)) events.push(...startPlay(state));
  return events;
}

/** After the reservation round: a solo goes first (the first one in seat order), then a wedding. */
function startPlay(state) {
  const order = Array.from({ length: PLAYERS }, (_, i) => (state.leader + i) % PLAYERS);
  const solo = order.find((p) => SOLOS.includes(state.declarations[p]));
  const wedding = order.find((p) => state.declarations[p] === "wedding");
  const silent = order.find((p) => hasBothQueens(state.players[p].hand));
  if (solo !== undefined) {
    state.contract = state.declarations[solo];
    setSolo(state, solo);
  } else if (wedding !== undefined) {
    state.contract = "wedding";
    state.wedding = wedding;
    state.revealed[wedding] = true; // announced: has both queens of clubs, so Re
  } else if (silent !== undefined) {
    // Both queens of clubs, but nothing said: a silent solo. Nobody knows yet.
    state.contract = "silent";
    state.soloist = silent;
    state.re = [silent];
  } else {
    state.contract = "normal";
    state.re = order.filter((p) => state.players[p].hand.some((card) => key(card) === "Q♣"));
  }
  state.phase = "play";
  state.turn = state.leader;
  return [{ type: "contract", contract: state.contract, player: solo ?? wedding ?? null }];
}

function setSolo(state, p) {
  state.soloist = p;
  state.re = [p];
  state.revealed.fill(true);
}

export const isSolo = (state) => state.soloist !== null;

// ---------- Teams ----------

/** "re" or "kontra"; null while a wedding is still looking for a partner (except the wedding player). */
export function party(state, p) {
  if (state.contract === "wedding" && !state.clarified) return p === state.wedding ? "re" : null;
  return state.re.includes(p) ? "re" : "kontra";
}

/**
 * What `viewer` knows about everyone's party (null = unknown): their own, everyone who
 * called or played a queen of clubs, and what follows from counting.
 */
export function knownParties(state, viewer) {
  const known = Array.from({ length: PLAYERS }, (_, p) => (p === viewer || state.revealed[p] ? party(state, p) : null));
  const looksNormal = state.contract === "normal" || (state.contract === "silent" && viewer !== state.soloist);
  if (state.contract === "silent" && viewer === state.soloist) return known.map((_, p) => party(state, p));
  if (!looksNormal) return known;

  const queens = [...state.tricks.flatMap((t) => t.cards), ...state.trick].filter(({ card }) => key(card) === "Q♣");
  for (const { player } of queens) known[player] = "re";
  if (state.contract === "silent") {
    // Both queens of clubs from one player: a silent solo, everyone else is Kontra.
    if (queens.length === 2 && queens[0].player === queens[1].player) return known.map((_, p) => party(state, p));
    return known; // nobody can count on two Re players yet
  }
  // A normal game has two Re and two Kontra players.
  const count = (side) => known.filter((x) => x === side).length;
  if (count("re") === 2) return known.map((x) => x ?? "kontra");
  if (count("kontra") === 2) return known.map((x) => x ?? "re");
  return known;
}

// ---------- Playing ----------

/** Cards `p` may play now: follow suit if possible, otherwise anything. */
export function legalCards(state, p) {
  const hand = state.players[p].hand;
  if (!state.trick.length) return [...hand];
  const led = group(state.contract, state.trick[0].card);
  const follow = hand.filter((card) => group(state.contract, card) === led);
  return follow.length ? follow : [...hand];
}

export const canPlay = (state, p, id) =>
  state.phase === "play" && state.turn === p && legalCards(state, p).some((card) => card.id === id);

export function play(state, p, id) {
  if (!canPlay(state, p, id)) throw new Error(`${p} may not play ${id}`);
  const hand = state.players[p].hand;
  const card = hand.splice(hand.findIndex((c) => c.id === id), 1)[0];
  state.trick.push({ player: p, card });
  const events = [{ type: "play", player: p, card }];
  if (key(card) === "Q♣" && state.contract === "normal" && !state.revealed[p]) {
    state.revealed[p] = true;
    events.push({ type: "reveal", player: p });
  }
  if (state.trick.length < PLAYERS) {
    state.turn = next(p);
    return events;
  }
  // The trick is complete.
  const cards = state.trick;
  const winner = cards[winningIndex(state.contract, cards)].player;
  const points = trickPoints(cards);
  state.tricks.push({ cards, winner, points });
  state.trick = [];
  state.turn = winner;
  events.push({ type: "trick", winner, points, cards });
  if (state.contract === "wedding" && !state.clarified) events.push(...clarifyWedding(state, winner));
  if (state.tricks.length === TRICKS) {
    state.phase = "over";
    state.result = score(state);
    events.push({ type: "over", result: state.result });
  }
  return events;
}

/** The first trick won by someone else makes them the partner; after three tricks the player stays alone. */
function clarifyWedding(state, winner) {
  const n = state.tricks.length;
  if (winner !== state.wedding) {
    state.partner = winner;
    state.clarified = n;
    state.re = [state.wedding, winner];
    state.revealed.fill(true);
    return [{ type: "partner", player: state.wedding, partner: winner }];
  }
  if (n === 3) {
    state.clarified = n;
    setSolo(state, state.wedding);
    return [{ type: "alone", player: state.wedding }];
  }
  return [];
}

// ---------- Calls ----------

/**
 * The next call `p` can make now (1 = Re/Kontra … 5 = black), or 0.
 * Level L is allowed while you still hold at least 12 − L cards; in a wedding the
 * deadlines move back by the number of tricks it took to find the partner.
 */
export function nextCall(state, p) {
  if (state.phase !== "play") return 0;
  const side = party(state, p);
  if (!side) return 0;
  const level = state.calls[side] + 1;
  if (level > 5) return 0;
  const cards = state.players[p].hand.length;
  return cards >= 12 - level - state.clarified ? level : 0;
}

export function call(state, p) {
  const level = nextCall(state, p);
  if (!level) throw new Error(`${p} can't call now`);
  const side = party(state, p);
  state.calls[side] = level;
  state.callLog.push({ player: p, level });
  state.revealed[p] = true;
  return [{ type: "call", player: p, level, party: side }];
}

// ---------- Scoring ----------

/** Did a party with call level `level` make it against opponents with these points and tricks? */
function made(level, oppPoints, oppTricks) {
  if (level === 5) return oppTricks === 0;
  return oppPoints < LIMIT[level];
}

/**
 * Who won and the game points, as on the rules page.
 * Returns { winner: "re" | "kontra" | null, points: { re, kontra }, tricks, lines, specials, total, scores }.
 * `lines` lists what the total is made of: { id, value } with ids like "won", "under90", "reCalled",
 * "fox", …; `scores[p]` is what each player gets (solo: three times for the soloist).
 */
export function score(state) {
  const points = { re: 0, kontra: 0 };
  const tricks = { re: 0, kontra: 0 };
  for (const trick of state.tricks) {
    const side = party(state, trick.winner);
    points[side] += trick.points;
    tricks[side]++;
  }
  const other = (side) => (side === "re" ? "kontra" : "re");
  const absage = (side) => state.calls[side] >= 2;

  let winner;
  if (absage("re") || absage("kontra")) {
    const reMade = absage("re") && made(state.calls.re, points.kontra, tricks.kontra);
    const koMade = absage("kontra") && made(state.calls.kontra, points.re, tricks.re);
    if (absage("re") && absage("kontra")) winner = reMade ? "re" : koMade ? "kontra" : null;
    else if (absage("re")) winner = reMade ? "re" : "kontra";
    else winner = koMade ? "kontra" : "re";
  } else if (state.calls.kontra && !state.calls.re) {
    winner = points.kontra >= 121 ? "kontra" : "re"; // only Kontra called: Re wins with 120
  } else {
    winner = points.re >= 121 ? "re" : "kontra";
  }

  const lines = [];
  const specials = specialPoints(state);
  if (winner) {
    const loser = other(winner);
    lines.push({ id: "won", value: 1 });
    if (winner === "kontra" && !isSolo(state)) lines.push({ id: "againstOld", value: 1 });
    if (points[loser] < 90) lines.push({ id: "under90", value: 1 });
    if (points[loser] < 60) lines.push({ id: "under60", value: 1 });
    if (points[loser] < 30) lines.push({ id: "under30", value: 1 });
    if (tricks[loser] === 0) lines.push({ id: "black", value: 1 });
    if (state.calls.re) lines.push({ id: "reCalled", value: 2 });
    if (state.calls.kontra) lines.push({ id: "kontraCalled", value: 2 });
    for (const side of ["re", "kontra"]) {
      for (let level = 2; level <= state.calls[side]; level++) lines.push({ id: `${CALLS[level]}Called`, value: 1 });
    }
    for (const special of specials) lines.push({ id: special.id, value: special.party === winner ? 1 : -1, party: special.party });
  }
  const total = lines.reduce((sum, line) => sum + line.value, 0);

  const scores = Array.from({ length: PLAYERS }, (_, p) => {
    if (!winner) return 0;
    const sign = party(state, p) === winner ? 1 : -1;
    return sign * total * (isSolo(state) && p === state.soloist ? 3 : 1);
  });
  return { winner, points, tricks, lines, specials, total, scores };
}

/** Fox caught, Charlie, Doppelkopf: only in normal games (and a wedding with partner). */
function specialPoints(state) {
  if (isSolo(state)) return [];
  const found = [];
  state.tricks.forEach((trick, i) => {
    const side = party(state, trick.winner);
    for (const { player, card } of trick.cards) {
      if (key(card) === "A♦" && party(state, player) !== side) found.push({ id: "fox", party: side, trick: i });
    }
    if (trick.points >= 40) found.push({ id: "doppelkopf", party: side, trick: i });
    if (i === TRICKS - 1) {
      const best = trick.cards.find(({ player }) => player === trick.winner)?.card;
      if (best && key(best) === "J♣") found.push({ id: "karlchen", party: side, trick: i });
    }
  });
  return found;
}
