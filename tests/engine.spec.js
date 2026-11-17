// Rules of the game engine and the bots, tested without a browser.
import { test, expect } from "@playwright/test";
import * as E from "../src/assets/game/engine.js";
import { chooseCall, chooseCard, chooseDeclaration } from "../src/assets/game/bots.js";

let serial = 0;
/** "Q♣" → a card object (each call gets its own id, so a card can appear twice) */
const c = (text) => ({ id: `${text}#${serial++}`, rank: text.slice(0, -1), suit: text.slice(-1) });
const cards = (text) => (text ? text.split(" ").map(c) : []);
const keys = (list) => list.map(E.key).join(" ");

const seeded = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** Winner (index into the trick) of cards played in this order. */
const winner = (contract, text) => E.winningIndex(contract, cards(text).map((card, player) => ({ player, card })));

test.describe("cards", () => {
  test("48 cards, every card twice", () => {
    const deck = E.createDeck();
    expect(deck).toHaveLength(48);
    expect(new Set(deck.map((card) => card.id)).size).toBe(48);
    for (const k of new Set(deck.map(E.key))) expect(deck.filter((card) => E.key(card) === k)).toHaveLength(2);
    expect(deck.reduce((sum, card) => sum + E.POINTS[card.rank], 0)).toBe(240);
  });

  test("trump order of the normal game", () => {
    expect(E.trumpOrder("normal").join(" ")).toBe("10♥ Q♣ Q♠ Q♥ Q♦ J♣ J♠ J♥ J♦ A♦ 10♦ K♦ 9♦");
    expect(E.createDeck().filter((card) => E.isTrump("normal", card))).toHaveLength(26);
  });

  test("trumps in the solos", () => {
    const count = (contract) => E.createDeck().filter((card) => E.isTrump(contract, card)).length;
    expect(E.trumpOrder("queens").join(" ")).toBe("Q♣ Q♠ Q♥ Q♦");
    expect(E.trumpOrder("jacks").join(" ")).toBe("J♣ J♠ J♥ J♦");
    expect(E.trumpOrder("clubs").slice(-4).join(" ")).toBe("A♣ 10♣ K♣ 9♣");
    expect(E.trumpOrder("hearts").slice(-3).join(" ")).toBe("A♥ K♥ 9♥"); // the ten of hearts stays on top
    expect(E.trumpOrder("hearts")[0]).toBe("10♥");
    expect(count("queens")).toBe(8);
    expect(count("jacks")).toBe(8);
    expect(count("none")).toBe(0);
    expect(count("hearts")).toBe(24);
    expect(E.plainOrder("queens").join(" ")).toBe("A 10 K J 9");
    expect(E.plainOrder("none").join(" ")).toBe("A 10 K Q J 9");
  });
});

test.describe("who wins the trick", () => {
  test("the highest trump", () => {
    expect(winner("normal", "A♠ 10♠ J♦ K♠")).toBe(2); // the example from the rules page
    expect(winner("normal", "9♦ Q♠ 10♥ Q♣")).toBe(2);
    expect(winner("normal", "A♥ 10♥ K♥ 9♥")).toBe(1); // the ten of hearts is a trump, not a heart
  });

  test("otherwise the highest card of the suit led", () => {
    expect(winner("normal", "K♣ 10♣ A♠ 9♣")).toBe(1);
    expect(winner("normal", "9♠ A♣ A♥ K♠")).toBe(3); // other suits don't count
  });

  test("of two equal cards the first one wins", () => {
    expect(winner("normal", "10♥ 10♥ 9♦ Q♣")).toBe(0);
    expect(winner("normal", "A♣ A♣ 9♣ K♣")).toBe(0);
  });

  test("solos", () => {
    expect(winner("queens", "A♣ Q♦ 10♣ J♣")).toBe(1);
    expect(winner("queens", "A♥ 10♥ K♥ J♥")).toBe(0); // no Dulle in a queen solo
    expect(winner("jacks", "A♠ Q♠ J♦ 10♥")).toBe(2);
    expect(winner("none", "J♣ Q♣ A♦ 9♣")).toBe(1); // no trumps: queen beats jack
    expect(winner("clubs", "A♦ 9♣ 10♦ K♦")).toBe(1); // in a clubs solo diamonds are plain
  });
});

/** A game in the play phase with given hands (seat 0 leads). */
function game(handTexts, contract = "normal") {
  const state = E.createGame({ dealer: 3, hands: handTexts.map(cards) });
  for (let p = 0; p < 4; p++) E.declare(state, p, contract === "normal" ? "healthy" : p === 0 ? contract : "healthy");
  return state;
}

const filler = "9♣ 9♣ 9♠ 9♠ 9♥ 9♥ K♣ K♣ K♠ K♠ K♥ K♥".split(" ");
/** 12 cards: the given ones, filled up with low plain cards. */
const hand = (text) => {
  const own = text.split(" ");
  return [...own, ...filler.slice(0, 12 - own.length)].join(" ");
};

test.describe("following suit", () => {
  test("you must follow suit; queens and jacks are trumps, not their suit", () => {
    const state = game([hand("A♠"), hand("Q♠ 9♥ A♥"), hand("J♦"), hand("10♠")]);
    E.play(state, 0, state.players[0].hand.find((x) => E.key(x) === "A♠").id);
    const legal = keys(E.legalCards(state, 1));
    expect(legal).toContain("9♠");
    expect(legal).not.toContain("Q♠");
  });

  test("if you can't follow, anything goes", () => {
    const state = game(["A♠ 9♣ 9♣ 9♥ 9♥ K♣ K♣ K♥ K♥ A♣ A♣ A♥", "Q♠ 9♦ A♥ 10♣ 10♣ J♣ J♣ A♣ K♥ 9♥ 9♣ 10♦", "J♦ 9♠ 9♠ K♠ K♠ 10♠ 10♠ A♠ Q♣ Q♣ Q♥ Q♥", "10♥ 10♥ Q♦ Q♦ J♠ J♠ J♥ J♥ J♦ A♦ A♦ K♦"]);
    E.play(state, 0, state.players[0].hand[0].id);
    expect(E.legalCards(state, 1)).toHaveLength(12);
    expect(() => E.play(state, 2, state.players[2].hand[0].id)).toThrow(); // not your turn
  });
});

/** Deals a real deck, but puts the given cards into the given seats. */
function dealWith(want) {
  const deck = E.createDeck();
  const hands = [[], [], [], []];
  for (const [p, text] of Object.entries(want)) {
    for (const k of text.split(" ")) {
      const i = deck.findIndex((card) => E.key(card) === k);
      hands[p].push(deck.splice(i, 1)[0]);
    }
  }
  for (const h of hands) while (h.length < 12) h.push(deck.shift());
  return hands;
}

test.describe("reservations", () => {
  const declareAll = (state, list) => list.forEach((d, i) => E.declare(state, (state.leader + i) % 4, d));

  test("all healthy: a normal game, Re are the two with a queen of clubs", () => {
    const state = E.createGame({ dealer: 0, hands: dealWith({ 1: "Q♣", 3: "Q♣" }) });
    declareAll(state, ["healthy", "healthy", "healthy", "healthy"]);
    expect(state.contract).toBe("normal");
    expect(state.re.sort()).toEqual([1, 3]);
    expect(state.turn).toBe(1);
  });

  test("a solo goes before a wedding, the first solo in order wins", () => {
    const state = E.createGame({ dealer: 0, hands: dealWith({ 1: "Q♣ Q♣" }) });
    declareAll(state, ["wedding", "queens", "jacks", "healthy"]);
    expect(state.contract).toBe("queens");
    expect(state.soloist).toBe(2);
    expect(E.party(state, 2)).toBe("re");
    expect(E.party(state, 1)).toBe("kontra");
  });

  test("only a player with both queens of clubs may announce a wedding", () => {
    const state = E.createGame({ dealer: 0, hands: dealWith({ 1: "Q♣", 2: "Q♣" }) });
    expect(E.declarationOptions(state, 1)).not.toContain("wedding");
    expect(() => E.declare(state, 1, "wedding")).toThrow();
  });

  test("both queens of clubs and healthy: a silent solo", () => {
    const state = E.createGame({ dealer: 0, hands: dealWith({ 2: "Q♣ Q♣" }) });
    declareAll(state, ["healthy", "healthy", "healthy", "healthy"]);
    expect(state.contract).toBe("silent");
    expect(state.soloist).toBe(2);
    // The others only see a normal game.
    expect(E.knownParties(state, 1)).toEqual([null, "kontra", null, null]);
    expect(E.knownParties(state, 2)).toEqual(["kontra", "kontra", "re", "kontra"]);
  });
});

test.describe("wedding", () => {
  test("the first trick won by someone else makes the partner", () => {
    const state = E.createGame({
      dealer: 3,
      hands: [
        "10♥ 10♥ Q♣ Q♣ 9♠ 9♠ 9♥ 9♥ 9♣ 9♣ K♥ K♥",
        "A♠ A♠ 10♠ 10♠ K♠ K♠ A♣ A♣ 10♣ 10♣ K♣ K♣",
        "Q♠ Q♠ Q♥ Q♥ Q♦ Q♦ J♣ J♣ J♠ J♠ J♥ J♥",
        "J♦ J♦ A♦ A♦ 10♦ 10♦ K♦ K♦ 9♦ 9♦ A♥ A♥",
      ].map(cards),
    });
    for (let p = 0; p < 4; p++) E.declare(state, p, p === 0 ? "wedding" : "healthy");
    expect(state.contract).toBe("wedding");
    expect(E.party(state, 2)).toBeNull();
    expect(E.nextCall(state, 2)).toBe(0); // no calls before the teams are fixed

    // Trick 1: the wedding player wins with the Dulle – still looking.
    let events = playTrick(state, ["10♥"]);
    expect(events.find((e) => e.type === "trick").winner).toBe(0);
    expect(state.clarified).toBe(0);

    // Trick 2: spades led, seat 2 trumps with the queen of spades and becomes the partner.
    events = playTrick(state, ["9♠"]);
    expect(events.find((e) => e.type === "partner")).toMatchObject({ player: 0, partner: 2 });
    expect(state.re.sort()).toEqual([0, 2]);
    expect(E.party(state, 1)).toBe("kontra");
    expect(state.clarified).toBe(2);
    // The deadlines move back by the two tricks: Kontra is still possible with 10 cards.
    expect(state.players[1].hand).toHaveLength(10);
    expect(E.nextCall(state, 1)).toBe(1);
  });

  test("no partner after three tricks: the wedding player plays alone", () => {
    // Seat 0 has all the top trumps and wins everything.
    const state = E.createGame({ dealer: 3, hands: dealWith({ 0: "10♥ 10♥ Q♣ Q♣ Q♠ Q♠ Q♥ Q♥ Q♦ Q♦ J♣ J♣" }) });
    for (let p = 0; p < 4; p++) E.declare(state, p, p === 0 ? "wedding" : "healthy");
    let events = [];
    for (let i = 0; i < 3; i++) events = playTrick(state, []);
    expect(events.some((e) => e.type === "alone")).toBe(true);
    expect(state.soloist).toBe(0);
    expect(E.isSolo(state)).toBe(true);
  });
});

/** Plays one trick: the leader plays the first of `lead` it has (or its first card), the others the first legal card. */
function playTrick(state, lead) {
  const events = [];
  for (let i = 0; i < 4; i++) {
    const p = state.turn;
    const legal = E.legalCards(state, p);
    const want = i === 0 ? legal.find((card) => lead.includes(E.key(card))) : null;
    events.push(...E.play(state, p, (want ?? legal[0]).id));
  }
  return events;
}

test.describe("calls", () => {
  test("Re or Kontra while you still have 11 cards, each further call one card later", () => {
    const state = E.createGame({ dealer: 3, hands: dealWith({ 0: "Q♣", 1: "Q♣" }) });
    for (let p = 0; p < 4; p++) E.declare(state, p, "healthy");
    expect(E.nextCall(state, 0)).toBe(1);
    expect(E.nextCall(state, 2)).toBe(1);
    playTrick(state, []);
    // 11 cards left: Re still possible …
    expect(E.nextCall(state, 0)).toBe(1);
    E.call(state, 0);
    expect(state.calls.re).toBe(1);
    // Seat 1 (Re) can go on with "no 90": it needs 10 cards and still has 11.
    expect(E.nextCall(state, 1)).toBe(2);
    playTrick(state, []);
    // 10 cards: Kontra is too late now, "no 90" for Re still fine.
    expect(E.nextCall(state, 2)).toBe(0);
    expect(E.nextCall(state, 1)).toBe(2);
    playTrick(state, []);
    expect(E.nextCall(state, 1)).toBe(0); // 9 cards: "no 90" needs 10
  });

  test("a call reveals the party", () => {
    const state = E.createGame({ dealer: 3, hands: dealWith({ 0: "Q♣", 1: "Q♣" }) });
    for (let p = 0; p < 4; p++) E.declare(state, p, "healthy");
    expect(E.knownParties(state, 2)).toEqual([null, null, "kontra", null]);
    E.call(state, 3);
    // Seat 2 now knows: 2 and 3 are Kontra, so 0 and 1 are Re.
    expect(E.knownParties(state, 2)).toEqual(["re", "re", "kontra", "kontra"]);
  });
});

test.describe("scoring", () => {
  /**
   * A finished normal game: Re = seats 0 and 1. `tricks` is a list of
   * [winner, points] or [winner, points, cards as text, players of those cards].
   */
  function finished({ tricks, calls = {}, contract = "normal", soloist = null }) {
    const state = E.createGame({ dealer: 3, hands: [[], [], [], []] });
    state.phase = "over";
    state.contract = contract;
    state.soloist = soloist;
    state.re = soloist !== null ? [soloist] : [0, 1];
    state.calls = { re: 0, kontra: 0, ...calls };
    // Points above 40 without cards are spread over several tricks of at most 30,
    // so they don't count as a Doppelkopf by accident.
    const spread = tricks.flatMap(([w, points, ...rest]) => {
      if (rest.length || points <= 40) return [[w, points, ...rest]];
      const parts = [];
      for (let left = points; left > 0; left -= 30) parts.push([w, Math.min(30, left)]);
      return parts;
    });
    state.tricks = spread.map(([w, points, text = "", players = [0, 1, 2, 3]]) => ({
      winner: w,
      points,
      cards: cards(text).map((card, i) => ({ player: players[i], card })),
    }));
    // Empty tricks fill up to 12 at the start, so the last given trick stays the last one.
    while (state.tricks.length < 12) state.tricks.unshift({ winner: 2, points: 0, cards: [] });
    return E.score(state);
  }

  const ids = (result) => result.lines.map((line) => line.id).join(" ");

  test("Re wins with 121, Kontra with 120 (against the old ones)", () => {
    let r = finished({ tricks: [[0, 121], [2, 119]] });
    expect(r.winner).toBe("re");
    expect(r.total).toBe(1);
    expect(r.scores).toEqual([1, 1, -1, -1]);
    r = finished({ tricks: [[0, 120], [2, 120]] });
    expect(r.winner).toBe("kontra");
    expect(ids(r)).toBe("won againstOld");
    expect(r.scores).toEqual([-2, -2, 2, 2]);
  });

  test("only Kontra called: Re wins with 120", () => {
    const r = finished({ tricks: [[0, 120], [2, 120]], calls: { kontra: 1 } });
    expect(r.winner).toBe("re");
    expect(ids(r)).toBe("won kontraCalled");
  });

  test("the example from the rules page: 4 points each", () => {
    // Re called and wins 185 to 55, Kontra made a Doppelkopf.
    const r = finished({ tricks: [[0, 100], [1, 85], [2, 40], [3, 15]], calls: { re: 1 } });
    expect(r.points).toEqual({ re: 185, kontra: 55 });
    expect(ids(r)).toBe("won under90 under60 reCalled doppelkopf");
    expect(r.total).toBe(4);
    expect(r.scores).toEqual([4, 4, -4, -4]);
  });

  test("a failed call loses the game", () => {
    // Re said "no 90", but Kontra got 90.
    const r = finished({ tricks: [[0, 150], [2, 90]], calls: { re: 2 } });
    expect(r.winner).toBe("kontra");
    expect(ids(r)).toBe("won againstOld reCalled no90Called");
  });

  test("both parties miss their calls: nobody wins", () => {
    const r = finished({ tricks: [[0, 130], [2, 110]], calls: { re: 2, kontra: 2 } });
    expect(r.winner).toBeNull();
    expect(r.scores).toEqual([0, 0, 0, 0]);
  });

  test("black: all tricks", () => {
    const r = finished({ tricks: Array.from({ length: 12 }, () => [0, 20]), calls: { re: 5 } });
    expect(r.winner).toBe("re");
    expect(ids(r)).toBe("won under90 under60 under30 black reCalled no90Called no60Called no30Called blackCalled");
    expect(r.total).toBe(11);
  });

  test("fox caught and Charlie", () => {
    const tricks = [[0, 11, "A♦ 9♣ 9♣ 9♣", [2, 0, 1, 3]], [0, 110], [2, 119]];
    const fox = finished({ tricks });
    expect(fox.specials.map((s) => `${s.id}:${s.party}`)).toEqual(["fox:re"]);
    // The last trick won with the jack of clubs.
    const state = finished({ tricks: [[0, 121], [2, 119], [1, 0, "9♣ J♣ 9♠ 9♠", [0, 1, 2, 3]]] });
    expect(state.specials.map((s) => s.id)).toContain("karlchen");
  });

  test("a solo counts triple and has no extra points", () => {
    const r = finished({ tricks: [[0, 11, "A♦ 9♣ 9♣ 9♣", [2, 0, 1, 3]], [0, 119], [2, 110]], contract: "queens", soloist: 0 });
    expect(r.winner).toBe("re");
    expect(r.specials).toEqual([]);
    expect(r.scores).toEqual([3, -1, -1, -1]);
  });
});

test.describe("simulated games", () => {
  /** Plays a whole game with bots in every seat. */
  function simulate(levels, random) {
    const state = E.createGame({ dealer: Math.floor(random() * 4), random });
    while (state.phase === "reserve") E.declare(state, state.turn, chooseDeclaration(state, state.turn, levels[state.turn], random));
    while (state.phase === "play") {
      const p = state.turn;
      while (chooseCall(state, p, levels[p])) E.call(state, p);
      E.play(state, p, chooseCard(state, p, levels[p], random));
    }
    return state;
  }

  test("thousands of games: only legal moves, 240 points, scores add up to zero", () => {
    const random = seeded(7);
    const contracts = new Set();
    for (let i = 0; i < 3000; i++) {
      const levels = [0, 1, 2, 3].map(() => (random() < 0.5 ? "easy" : "normal"));
      const state = simulate(levels, random); // E.play throws on any illegal card
      const r = state.result;
      contracts.add(state.contract);
      expect(state.tricks).toHaveLength(12);
      expect(r.points.re + r.points.kontra).toBe(240);
      expect(r.scores.reduce((a, b) => a + b, 0)).toBe(0);
      if (r.winner) expect(Math.abs(r.scores[state.re[0]])).toBe(Math.abs(r.total) * (E.isSolo(state) ? 3 : 1));
    }
    for (const c of ["normal", "wedding", "queens", "clubs", "hearts"]) expect(contracts).toContain(c); // bots never keep a wedding silent
  });

  test("normal bots beat easy bots", () => {
    const random = seeded(11);
    const levels = ["normal", "easy", "normal", "easy"];
    const totals = [0, 0, 0, 0];
    for (let i = 0; i < 2000; i++) simulate(levels, random).result.scores.forEach((n, p) => (totals[p] += n));
    expect(totals[0] + totals[2]).toBeGreaterThan(totals[1] + totals[3] + 1000);
  });
});
