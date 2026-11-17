// Animations for the game page, so you can follow what happens:
//   - a played card flies from the player to its place in the trick,
//   - a finished trick slides to whoever won it.
//
// How it works ("FLIP"): before a move, snapshot() notes where your cards are. After the
// move the page is rendered in its final state, and the card in the trick is moved from
// where it came from to where it is now. The layout of the page never changes.
// With "reduce motion" switched on in the system, nothing moves.

const REDUCED_MOTION = matchMedia("(prefers-reduced-motion: reduce)");
const FLY = 380; // ms
const SWEEP = 450; // ms

const $ = (id) => document.getElementById(id);
const center = (rect) => ({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });

/** Where your hand cards are right now. Call it before the engine changes the state. */
export function snapshot() {
  const rects = new Map();
  for (const el of $("my-hand").querySelectorAll("[data-id]")) rects.set(el.dataset.id, el.getBoundingClientRect());
  return rects;
}

/** The box of a player: you at the bottom, the bots at the top. */
const playerBox = (player) => (player === 0 ? $("me") : document.querySelector(`.opp[data-player="${player}"]`));

/** A played card flies from its player to the trick. */
export async function flyIn(event, before) {
  if (REDUCED_MOTION.matches) return;
  const el = document.querySelector(`.tslot[data-seat="${event.player}"] .card`);
  if (!el) return;
  const fromRect = event.player === 0 ? before.get(event.card.id) : playerBox(event.player)?.querySelector(".oppfan")?.getBoundingClientRect();
  if (!fromRect) return;
  const a = center(fromRect);
  const b = center(el.getBoundingClientRect());
  const scale = event.player === 0 ? 1 : 0.5;
  await el.animate(
    [
      { transform: `translate(${a.x - b.x}px, ${a.y - b.y}px) scale(${scale})`, opacity: 0.7 },
      { transform: "none", opacity: 1 },
    ],
    { duration: FLY, easing: "cubic-bezier(.2,.8,.2,1)" },
  ).finished;
}

/** All four cards of the finished trick slide to the winner. */
export async function sweep(winner) {
  if (REDUCED_MOTION.matches) return;
  const box = playerBox(winner);
  if (!box) return;
  const b = center(box.getBoundingClientRect());
  const cards = [...document.querySelectorAll(".tslot .card")];
  await Promise.all(
    cards.map((el) => {
      const a = center(el.getBoundingClientRect());
      return el.animate(
        [
          { transform: "none", opacity: 1 },
          { transform: `translate(${b.x - a.x}px, ${b.y - a.y}px) scale(0.4)`, opacity: 0 },
        ],
        { duration: SWEEP, easing: "ease-in", fill: "forwards" },
      ).finished;
    }),
  );
}
