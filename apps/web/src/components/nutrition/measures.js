// ROADMAP 7a-iv-a — adding a food by measure (RULINGS 2026-09-16, the portion
// redesign). Pure helpers the measure picker and the meal list share. The SERVER
// works out every gram and calorie from its own list of the food's measures:
// these only shape what the picker offers, what it sends, and how an item reads.

/** The contract's own bound (@app/shared chosenItemsSchema: a measure's amount,
 *  like an item's grams, is at most 10,000). */
export const MAX_AMOUNT = 10000;

/** A saved dish's choice key, beside the measure ids ("g", "usda-4", "serving"). */
export const DISH_KEY_PREFIX = 'dish:';

/** The sizes a new dish can be saved at in one tap: the midpoints of Part 2B
 *  Appendix B's global starter set — cup 240 ml, mug 300–350 ml, cereal bowl
 *  350–400 ml — beside any size typed in millilitres. */
export const DISH_SIZES = [
  { label: 'Cup', volumeMl: 240, containerClass: 'cup' },
  { label: 'Mug', volumeMl: 325, containerClass: 'mug' },
  { label: 'Bowl', volumeMl: 375, containerClass: 'cereal_bowl' },
];

/** How full a dish was: the amount a dish takes, and nothing is picked until the
 *  person picks it (Kd, 2026-07-18: no invented "full"). Said in words, never as a
 *  fraction (Kd, RULINGS 2026-09-17: "what are these numbers will a normal people
 *  not knowing math understand"): `label` on its button, `words` in a line. */
export const FILL_CHOICES = [
  { label: 'Quarter', words: 'quarter full', value: 0.25 },
  { label: 'Half', words: 'half full', value: 0.5 },
  { label: 'Three quarters', words: 'three quarters full', value: 0.75 },
  { label: 'Full', words: 'full', value: 1 },
];

const GRAMS = { id: 'g', name: 'g', grams: 1 };

/** Every choice the picker offers for a food: its own measures, as the search
 *  sent them, then the person's saved dishes. A food with no measures (an older
 *  answer) is offered by the gram. */
export function pickerChoices(food, dishware) {
  const measures = Array.isArray(food?.measures) && food.measures.length > 0 ? food.measures : [GRAMS];
  return [
    ...measures.map((m) => ({ key: m.id, kind: 'measure', id: m.id, name: m.name, grams: m.grams })),
    ...(Array.isArray(dishware) ? dishware : []).map((d) => ({
      key: `${DISH_KEY_PREFIX}${d.id}`, kind: 'dish', dishwareId: d.id, name: d.label, volumeMl: d.volumeMl,
    })),
  ];
}

/** The choice and amount a picked food starts at: the measure the server named,
 *  else its first measure once (grams: its serving's weight). */
export function startingValue(food) {
  const [first] = pickerChoices(food, []);
  const start = food?.startsAt;
  const named = start ? pickerChoices(food, []).find((c) => c.id === start.measure) : undefined;
  if (named && Number.isFinite(start.amount) && start.amount > 0) return { key: named.key, amount: String(start.amount) };
  return { key: first.key, amount: first.id === 'g' ? String(food?.serving || 100) : '1' };
}

/** Whether a value is still the one a food starts at: a scanned row the person has
 *  not moved from where the scan started it (ROADMAP 7a-iv-b). */
export function isStartingValue(food, value) {
  const start = startingValue(food);
  return value?.key === start.key && parseFloat(value?.amount) === parseFloat(start.amount);
}

/** A choice's value that keeps what the item weighed (`grams`, as the server worked
 *  them out): those grams, or as many of the measure as weigh them, to a hundredth.
 *  Null for a dish, whose amount is how full it was, or where nothing is weighed yet.
 *  A scanned row taken from a saved dish to another measure keeps its grams (Kd's
 *  click-through of 7a-iv-a, RULINGS 2026-09-16). */
export function valueKeepingGrams(choice, grams) {
  const weighed = Number(grams);
  if (!choice || choice.kind === 'dish' || !Number.isFinite(weighed) || weighed <= 0) return null;
  if (choice.id === 'g') return { key: choice.key, amount: String(Math.min(MAX_AMOUNT, Math.round(weighed))) };
  const amount = Math.round((weighed / choice.grams) * 100) / 100;
  return amount > 0 && amount <= MAX_AMOUNT ? { key: choice.key, amount: String(amount) } : null;
}

/** The value after the person picks another choice: a dish starts with no fill
 *  picked; grams start at what the item weighed where that is known; any other
 *  measure starts at one. */
export function valueForChoice(choice, currentGrams) {
  if (!choice) return null;
  if (choice.kind === 'dish') return { key: choice.key, amount: '' };
  if (choice.id === 'g') {
    const grams = Math.round(Number(currentGrams));
    return { key: choice.key, amount: Number.isFinite(grams) && grams > 0 ? String(Math.min(MAX_AMOUNT, grams)) : '100' };
  }
  return { key: choice.key, amount: '1' };
}

/** How far − and + move an amount: ten grams, or half of any other measure. */
export const amountStep = (choice) => (choice?.id === 'g' ? 10 : 0.5);

/** An amount one step of − (direction −1) or + (+1) away, on the step's grid,
 *  never past the contract's bound, and never below one step — or below a smaller
 *  amount the person typed, which − leaves as it is. */
export function steppedAmount(amountText, choice, direction) {
  const step = amountStep(choice);
  const current = parseFloat(amountText);
  const from = Number.isFinite(current) && current > 0 ? current : 0;
  const next = direction > 0 ? Math.floor(from / step + 1e-9) * step + step : Math.ceil(from / step - 1e-9) * step - step;
  const lowest = from > 0 && from < step ? from : step;
  return String(Math.min(MAX_AMOUNT, Math.max(lowest, next)));
}

/** What the picker sends for a food: the measure arm, or a saved dish's arm, or
 *  null while the amount is no amount (a dish needs a fill of ¼ to full). */
export function chosenItemFor(canonical, choice, amountText) {
  const amount = parseFloat(amountText);
  if (!canonical || !choice || !Number.isFinite(amount) || amount <= 0) return null;
  if (choice.kind === 'dish') return amount <= 1 ? { canonical, dishwareId: choice.dishwareId, fillLevel: amount } : null;
  return amount <= MAX_AMOUNT ? { canonical, measure: choice.id, amount } : null;
}

/** Whether a measure's amount comes to less than a gram, which the server weighs
 *  to the whole gram and refuses as nothing ("0.4" g, a quarter of a 1.2 g nut).
 *  A dish's grams are the server's alone (the food's own cup), so its refusal
 *  comes back from the preview instead (`amountRefusal`). */
export function comesToUnderAGram(choice, amountText) {
  const amount = parseFloat(amountText);
  return choice?.kind === 'measure' && Number.isFinite(amount) && amount > 0 && Math.round(amount * choice.grams) < 1;
}

/** What the server's refusal of an amount says to the person, by its code, or
 *  null for any other failure: never "try searching for it again" when the food
 *  was found and the amount was the problem. */
const AMOUNT_REFUSALS = new Map([
  ['portion_out_of_range', 'That amount is too small or too large to log — pick another amount.'],
  ['unknown_measure', "That measure isn't one of this food's — pick one from the list."],
]);
export const amountRefusal = (err) => AMOUNT_REFUSALS.get(err?.response?.data?.error) ?? null;

/** An amount as a person reads it: no float noise ("1.5", "0.25"). */
export const formatAmount = (amount) => String(Math.round(Number(amount) * 100) / 100);

/** A measure as the picker lists it: its name and what one of it weighs. Grams and
 *  ounces are spelled out (Kd's click-through of 7a-iv-b: "g" and "oz" alone read
 *  as nothing to someone who does not weigh food). */
export function choiceLabel(choice) {
  if (choice.kind === 'dish') return `${choice.name} · ${choice.volumeMl} ml`;
  if (choice.id === 'g') return 'grams';
  if (choice.id === 'oz') return `ounces · ${formatAmount(choice.grams)} g`;
  return `${choice.name} · ${formatAmount(choice.grams)} g`;
}

/** What the amount beside − and + counts, so a number never stands alone: "60"
 *  of grams read as sixty avocados (Kd's click-through of 7a-iv-b). */
export function unitLabel(choice) {
  if (!choice) return '';
  if (choice.id === 'g') return 'grams';
  if (choice.id === 'oz') return 'ounces';
  return choice.name;
}

/** A row's amount as a short list line reads it: the amount of its measure and
 *  what the server says that weighs ("2 × slice cooked · 16 g", "60 g",
 *  "3 oz · 85 g", "My blue bowl, half full · 180 g"), or what is still to pick. */
export function amountSummary(choice, amountText, grams) {
  const amount = parseFloat(amountText);
  const weighed = Number.isFinite(grams) && grams > 0 ? ` · ${Math.round(grams)} g` : '';
  if (!choice) return 'Pick an amount';
  if (choice.kind === 'dish') {
    const fill = FILL_CHOICES.find((f) => f.value === amount);
    if (!fill) return `${choice.name} · how full?`;
    return `${choice.name}, ${fill.words}${weighed}`;
  }
  if (!Number.isFinite(amount) || amount <= 0) return 'Pick an amount';
  if (choice.id === 'g') return `${formatAmount(amount)} g`;
  if (choice.id === 'oz') return `${formatAmount(amount)} oz${weighed}`;
  return `${formatAmount(amount)} × ${choice.name}${weighed}`;
}

/** A saved item's amount as the meal list reads it, in the short list's words: by
 *  the measure it was logged by ("1.5 × medium (3" dia) · 273 g", "My blue bowl,
 *  half full · 180 g", "2 oz · 57 g"), else by its grams ("273 g"). */
export function loggedAmountText(item) {
  const m = item?.measure;
  const grams = Number(item?.gramsPoint);
  if (!m || m.id === 'g') return amountSummary(GRAM_CHOICE, formatAmount(grams), grams);
  // A dish filled to a level the picker never offers (the contract takes any)
  // reads as how much of it, never as "how full?" on a food already eaten.
  const fill = m.id === 'dish' && FILL_CHOICES.some((f) => f.value === m.amount);
  const choice = fill ? { kind: 'dish', name: m.name } : { kind: 'measure', id: m.id, name: m.name };
  return amountSummary(choice, String(m.amount), grams);
}
const GRAM_CHOICE = { kind: 'measure', ...GRAMS };

/** Where the picker opens for a food already logged (ROADMAP 7a-iv-g): at the
 *  measure and amount it was logged by, where that measure is still one of the
 *  food's (`measures`, as the server sends them now), else at its grams. A saved
 *  dish opens at its grams too: the dish's size may have changed since, and
 *  opening must never change the numbers by itself. */
export function loggedValue(item, measures) {
  const m = item?.measure;
  if (m && m.id !== 'dish' && Array.isArray(measures) && measures.some((x) => x.id === m.id)) {
    return { key: m.id, amount: formatAmount(m.amount) };
  }
  return { key: GRAMS.id, amount: formatAmount(item?.gramsPoint) };
}
