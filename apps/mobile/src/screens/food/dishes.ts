import type { Dishware } from "@app/shared";
import type { OutboxView } from "./outbox";

// A person's saved dishes (ROADMAP 32b-ii-b), as the browser saves them (apps/web/src/components/
// nutrition/MeasurePicker.jsx): a name, and one of three sizes or a size in ml. The server weighs a
// food by the dish's size and how full it was; these only shape what is offered and said.

/** The sizes offered, as the browser offers them. */
export const DISH_SIZES = [
  { label: "Cup", volumeMl: 240, containerClass: "cup" },
  { label: "Mug", volumeMl: 325, containerClass: "mug" },
  { label: "Bowl", volumeMl: 375, containerClass: "cereal_bowl" },
] as const;

/** The most a dish holds, and the longest name, as the server takes them. */
export const MOST_DISH_ML = 10_000;
export const MOST_DISH_NAME = 100;

export type DishSize = (typeof DISH_SIZES)[number]["label"] | "ml";

/** What is sent for a new dish, or null while the size is no size. A dish with no name is called by
 *  its size ("My mug"), as the browser calls it. */
export function newDish(name: string, size: DishSize | null, ml: string): { label: string; containerClass: string; volumeMl: number } | null {
  if (size === null) return null;
  const typed = name.trim().slice(0, MOST_DISH_NAME);
  if (size === "ml") {
    const n = Number(ml.trim().replace(",", "."));
    if (ml.trim() === "" || !Number.isFinite(n) || n < 1 || n > MOST_DISH_ML) return null;
    return { label: typed === "" ? "My dish" : typed, containerClass: "custom", volumeMl: Math.round(n) };
  }
  const picked = DISH_SIZES.find((s) => s.label === size);
  if (picked === undefined) return null;
  return { label: typed === "" ? `My ${picked.label.toLowerCase()}` : typed, containerClass: picked.containerClass, volumeMl: picked.volumeMl };
}

/** A dish as its chip reads: its name and what it holds. */
export const dishWords = (dish: Pick<Dishware, "label" | "volumeMl">): string => `${dish.label} · ${String(dish.volumeMl)} ml`;

/** Whether a meal, or a change to one, still waiting on this phone weighs a food with the dish: removed
 *  now, the server would refuse that meal. */
export function dishWaiting(view: Pick<OutboxView, "waiting" | "changing">, id: string): boolean {
  const uses = (items: readonly object[] | undefined): boolean => (items ?? []).some((i) => "dishwareId" in i && i.dishwareId === id);
  return view.waiting.some((m) => uses(m.body.items)) || [...view.changing.values()].some((changes) => changes.some((c) => uses(c.body.items)));
}
