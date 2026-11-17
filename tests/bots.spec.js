// The computer players in typical situations: do they follow the conventions from the
// rules page, so a human can read their cards? Tested without a browser.
import { test, expect } from "@playwright/test";
import * as E from "../src/assets/game/engine.js";
import { beliefs, chooseCall, chooseCard, dubious, sampleWorld } from "../src/assets/game/bots.js";

const seeded = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** Takes cards like "Q♣ 9♦" out of `deck` (real cards with ids). */
function take(deck, text) {
  return text.split(" ").map((k) => {
    const i = deck.findIndex((card) => E.key(card) === k);
    if (i < 0) throw new Error(`no ${k} left`);
    return deck.splice(i, 1)[0];
  });
}

/**
 * A normal game, seat 0 leads (unless `dealer` says otherwise). `hands` gives the cards of
 * some seats; the others get the rest at random.
 */
function game(hands, { dealer = 3, seed = 1 } = {}) {
  const deck = E.shuffle(E.createDeck(), seeded(seed));
  const dealt = [0, 1, 2, 3].map((p) => (hands[p] ? take(deck, hands[p]) : null));
  for (let p = 0; p < 4; p++) if (!dealt[p]) dealt[p] = deck.splice(0, 12);
  const state = E.createGame({ dealer, hands: dealt });
  for (let i = 0; i < 4; i++) E.declare(state, state.turn, "healthy");
  return state;
}

/** Plays a card by its name, e.g. play(state, "A♠"): the player whose turn it is. */
function play(state, k) {
  const p = state.turn;
  const card = state.players[p].hand.find((c) => E.key(c) === k);
  if (!card) throw new Error(`${p} has no ${k}`);
  return E.play(state, p, card.id);
}

const cardOf = (state, p, id) => E.key(state.players[p].hand.find((c) => c.id === id));
const normal = (state, p) => cardOf(state, p, chooseCard(state, p, "normal"));

// A full deal for the trick situations below (seat 0 leads):
//   seat 0 (Kontra): both black plain suits,
//   seat 1 (Kontra): only one spade, low trumps, the hearts aces,
//   seats 2 and 3 (Re): the high trumps, one queen of clubs each, one fox each.
const DEAL = {
  0: "A♠ A♠ 10♠ 10♠ A♣ A♣ 10♣ 10♣ K♣ K♣ 9♣ 9♣",
  1: "9♠ J♦ 9♦ 9♦ K♦ K♦ A♥ A♥ 10♦ 10♦ 9♥ 9♥",
  2: "K♠ Q♣ Q♠ Q♥ Q♦ J♣ J♠ J♥ J♦ K♥ K♥ A♦",
  3: "K♠ 9♠ Q♣ Q♠ Q♥ Q♦ J♣ J♠ J♥ 10♥ 10♥ A♦",
};

test.describe("leading", () => {
  test("Re without aces leads a trump", () => {
    const state = game({ 0: "Q♣ Q♥ J♠ 9♦ K♦ 10♦ K♠ K♠ 9♣ K♣ 9♥ K♥" });
    expect(E.isTrump("normal", { rank: normal(state, 0).slice(0, -1), suit: normal(state, 0).slice(-1) })).toBe(true);
  });

  test("Kontra without aces leads a plain suit", () => {
    const state = game({ 0: "Q♥ J♠ 9♦ K♦ 10♦ K♠ K♠ 9♣ K♣ 9♥ K♥ 9♠" });
    const k = normal(state, 0);
    expect(E.isTrump("normal", { rank: k.slice(0, -1), suit: k.slice(-1) })).toBe(false);
  });

  test("plain aces first, black before hearts", () => {
    const state = game({ 0: "A♥ A♣ Q♥ J♠ 9♦ K♦ 10♦ K♠ 9♣ K♣ 9♥ K♥" });
    expect(normal(state, 0)).toBe("A♣");
  });

  test("never the fox", () => {
    const state = game({ 0: "Q♣ A♦ 9♣ 9♣ K♣ K♣ 9♠ 9♠ K♠ K♠ 9♥ K♥" });
    expect(normal(state, 0)).not.toBe("A♦");
  });
});

test.describe("following", () => {
  test("Re shows the queen of clubs when it takes a trick", () => {
    const state = game(DEAL);
    play(state, "A♣");
    play(state, "9♥"); // seat 1 has no clubs
    expect(normal(state, 2)).toBe("Q♣");
  });

  test("a trick the partner is sure to win gets the fox", () => {
    const state = game(DEAL);
    play(state, "A♣");
    play(state, "9♥");
    play(state, "Q♣"); // seat 2 shows: Re
    // Seat 3 is Re too and plays last: the trick is safe.
    expect(normal(state, 3)).toBe("A♦");
  });

  test("no points for an opponent's trick", () => {
    const state = game(DEAL);
    play(state, "A♣");
    play(state, "9♥");
    play(state, "Q♣"); // seat 2 wins and is Re
    play(state, "9♠");
    expect(state.tricks[0].winner).toBe(2);
    play(state, "Q♠"); // seat 2 leads a trump
    play(state, "10♥"); // seat 3 takes it with the Dulle
    // Seat 0 (Kontra) has no trumps and can't win: it gives the fewest points, not an ace or a ten.
    expect(normal(state, 0)).toBe("9♣");
  });

  test("trumps in with at least a jack when someone can still overtrump", () => {
    const state = game(DEAL);
    // First round of spades: everyone follows, seat 0 wins with the ace.
    play(state, "A♠");
    play(state, "9♠");
    play(state, "K♠");
    play(state, "K♠");
    expect(state.tricks[0].winner).toBe(0);
    // Second round: seat 1 has no spades left, seats 2 and 3 might trump as well.
    play(state, "A♠");
    expect(normal(state, 1)).toBe("J♦");
  });
});

test.describe("calls", () => {
  test("a strong hand calls right away, a weak one doesn't", () => {
    const strong = game({ 1: "10♥ 10♥ Q♠ Q♠ Q♥ Q♥ J♣ J♣ A♦ 10♦ A♠ A♥" });
    expect(E.party(strong, 1)).toBe("kontra");
    expect(chooseCall(strong, 1, "normal")).toBe(true);
    const weak = game({ 1: "9♦ K♦ 9♠ K♠ 9♣ K♣ 9♥ K♥ 10♠ 10♣ J♦ Q♦" });
    expect(chooseCall(weak, 1, "normal")).toBe(false);
  });
});

test.describe("what a bot believes", () => {
  test("a player who leads trumps looks like Re", () => {
    const state = game({ 0: "9♦ 9♣ 9♣ K♣ K♣ 9♠ 9♠ K♠ K♠ 9♥ K♥ 10♠", 1: "Q♣ 10♣ 10♣ A♣ A♣ A♠ A♠ 10♠ A♥ A♥ 10♦ K♦" });
    play(state, "9♦");
    // Seat 1 is Re and doesn't know its partner yet: the trump lead points to seat 0.
    expect(E.knownParties(state, 1)).toEqual([null, "re", null, null]);
    expect(beliefs(state, 1)).toEqual(["re", "re", "kontra", "kontra"]);
  });

  test("imagined deals fit everything seen", () => {
    const state = game(DEAL);
    play(state, "A♣");
    play(state, "9♥"); // seat 1: no clubs
    play(state, "Q♣"); // seat 2: no clubs either, and Re with exactly one queen of clubs
    const random = seeded(5);
    for (let i = 0; i < 200; i++) {
      const world = sampleWorld(state, 0, random);
      expect(world).not.toBeNull();
      for (let p = 0; p < 4; p++) expect(world.players[p].hand).toHaveLength(state.players[p].hand.length);
      expect(world.players[0].hand).toEqual(state.players[0].hand); // its own cards stay
      for (const p of [1, 2]) {
        const clubs = world.players[p].hand.filter((c) => E.group("normal", c) === "♣");
        expect(clubs, `seat ${p} has no plain clubs`).toEqual([]);
      }
      expect(world.players[2].hand.some((c) => E.key(c) === "Q♣"), "seat 2 had only one queen of clubs").toBe(false);
      // All 48 cards are still there exactly once.
      const all = [...world.players.flatMap((x) => x.hand), ...world.trick.map((e) => e.card)];
      expect(new Set(all.map((c) => c.id)).size).toBe(48);
    }
  });

  test("strong doesn't throw a queen into a trick its partner has already won", () => {
    // Reported from a real game: both Re players called and played a jack, you (Kontra)
    // took the trick with the queen of spades, and your partner, last to play, added
    // the other queen of spades instead of a jack.
    const deck = E.shuffle(E.createDeck(), seeded(101));
    const fixed = { 0: "Q♣ J♣", 1: "Q♣ J♠", 2: "Q♠", 3: "Q♠ J♥" };
    const hands = [0, 1, 2, 3].map((p) => take(deck, fixed[p]));
    for (const hand of hands) while (hand.length < 12) hand.push(deck.shift());
    const state = E.createGame({ dealer: 3, hands });
    for (let p = 0; p < 4; p++) E.declare(state, p, "healthy");
    E.call(state, 0);
    E.call(state, 1); // both Re are known, so seat 3 knows seat 2 is its partner
    play(state, "J♣");
    play(state, "J♠");
    play(state, "Q♠");
    expect(normal(state, 3)).toBe("J♥");
    for (let i = 0; i < 10; i++) {
      const k = cardOf(state, 3, chooseCard(state, 3, "strong", seeded(i)));
      expect(k, `run ${i}`).not.toMatch(/^Q/);
    }
  });

  test("moves strong never prefers over the conventions", () => {
    const state = game(DEAL);
    play(state, "A♣");
    play(state, "9♥");
    const card = (p, k) => state.players[p].hand.find((c) => E.key(c) === k);
    const legal = (p) => E.legalCards(state, p);
    // Seat 2 (Re) doesn't know yet that seat 3 is its partner: trumping with the fox
    // could be overtrumped by seat 3. A jack is fine.
    expect(dubious(state, 2, card(2, "A♦"), legal(2))).toBe(true);
    expect(dubious(state, 2, card(2, "J♦"), legal(2))).toBe(false);
    play(state, "Q♣"); // now seat 2 is known as Re
    // Seat 3 (Re, last): the fox into the partner's safe trick is right, a queen is a waste.
    expect(dubious(state, 3, card(3, "A♦"), legal(3))).toBe(false);
    expect(dubious(state, 3, card(3, "Q♠"), legal(3))).toBe(true);
  });

  test("strong looks ahead and still only plays allowed cards", () => {
    const state = game(DEAL);
    play(state, "A♣");
    const id = chooseCard(state, 1, "strong", seeded(2));
    expect(E.canPlay(state, 1, id)).toBe(true);
  });
});
