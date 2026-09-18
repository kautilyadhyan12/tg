// ROADMAP 7a-iv-h — amounts anyone can read (Kd, RULINGS 2026-09-17). A photo row
// left at the photo's grams also says them in a cup of the food's own: "~260 g ·
// about 1 cup". A cup is one size in every kitchen, and USDA weighed a cup of each
// food itself; a bowl is any size (Part 2B Appendix B lists 100 ml to 400 ml), so
// "about 1 bowl" would say nothing. Under a quarter cup the same cup is said in
// spoons. The words restate grams the server sent; they price nothing.
//
// Nothing here counts pieces: a row sits at the photo's grams only because the
// photo's count of a measure and its grams disagreed (ROADMAP 7a-iv-b), so "about
// 3 slices" would contradict the scan.

/** A US cup is sixteen tablespoons; a tablespoon, three teaspoons. */
const TBSP_PER_CUP = 16;
const TSP_PER_CUP = 48;
const PER_CUP = { cup: 1, tbsp: TBSP_PER_CUP, tsp: TSP_PER_CUP };

/** An amount clear of floating-point crumbs, so a boundary is where it is
 *  written: a teaspoon's half is 0.5, never 0.49999999999999994. */
const snap = (x) => Math.round(x * 1e9) / 1e9;

/** A measure named as a volume, as `foodMeasures` names USDA's (apps/api
 *  measures.ts): "cup", "half cup", "0.75 cup (1 NLEA serving)", "cup, sliced",
 *  "2 tbsp", "tsp", and the survey release's "serving 1/2 cup". */
const VOLUME = /^(?<serving>serving\s+\(?)?(?:(?<half>half)\s+|(?<number>\d+\/\d+|\d*\.?\d+)\s+)?(?<unit>cups?|tbsp|tsp|tablespoons?|teaspoons?)(?![a-z])(?<rest>.*)$/i;
const UNIT = { cup: 'cup', cups: 'cup', tbsp: 'tbsp', tablespoon: 'tbsp', tablespoons: 'tbsp', tsp: 'tsp', teaspoon: 'tsp', teaspoons: 'tsp' };

/** What a volume measure's words after its unit say of the food, a bracket read as
 *  one more part. Kept: how the food was cut, made or filled ("sliced", "cooked,
 *  diced", "not packed"), since a cup of sliced banana weighs 150 g and of mashed
 *  225 g. Dropped: any part holding a figure, which is a size, a serving, a label
 *  or a cross-reference ("8 fl oz", "1 NLEA serving", "1/2" pieces", "From
 *  19211"), and USDA's "NFS" (not further specified). */
function qualifierOf(rest) {
  return rest
    .replace(/[()]/g, ',')
    .split(',')
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter((part) => part !== '' && part.toLowerCase() !== 'nfs' && !/\d/.test(part))
    .join(', ');
}

/** "1/2" or "0.75" as a number. */
function countOf(number) {
  if (number === undefined) return 1;
  const [top, bottom] = number.split('/');
  return bottom === undefined ? Number(top) : Number(top) / Number(bottom);
}

/** A measure read as a volume — its grams per cup and its words — or null where it
 *  is none, or is no volume of the food as eaten: "cup, dry, yields" weighs what a
 *  dry cup cooks up to. */
function asVolume(measure) {
  const found = VOLUME.exec(String(measure?.name ?? '').trim());
  const grams = Number(measure?.grams);
  if (!found || !(grams > 0)) return null;
  const { serving, half, number, unit: unitWord, rest } = found.groups;
  if (/yield/i.test(rest)) return null;
  const count = half ? 0.5 : countOf(number);
  if (!(count > 0) || !Number.isFinite(count)) return null;
  const unit = UNIT[unitWord.toLowerCase()];
  const qualifier = qualifierOf(rest);
  // The food's own cup, as the server weighs a saved dish by it (`gramsPerMl`):
  // named "cup" or "half cup" and nothing else.
  const own = unit === 'cup' && serving === undefined && number === undefined && rest === '';
  // Cups before spoons; a cup with no words before one with them.
  const rank = own ? 0 : (unit === 'cup' ? 1 : 3) + (qualifier === '' ? 0 : 1);
  return { gramsPerCup: (grams * PER_CUP[unit]) / count, qualifier, rank };
}

/** The volume a food is said in: its own cup; else a cup of any other name, one
 *  with no words of its own first; else a spoon. The earliest in the food's list
 *  where two rank alike, as the server orders a food's measures. */
export function householdVolume(measures) {
  let best = null;
  for (const measure of Array.isArray(measures) ? measures : []) {
    const volume = asVolume(measure);
    if (volume && (best === null || volume.rank < best.rank)) best = volume;
  }
  return best;
}

/** A count of halves in words: "half a cup", "1 cup", "1 and a half cups". */
function halves(n, unit) {
  const whole = Math.floor(n);
  const half = n - whole === 0.5;
  if (whole === 0) return `half a ${unit}`;
  return `${whole}${half ? ' and a half' : ''} ${unit}${whole === 1 && !half ? '' : 's'}`;
}

const QUARTER_CUPS = { 1: 'a quarter cup', 2: 'half a cup', 3: 'three quarters of a cup' };

/** A number of cups in the words a kitchen says, never a fraction sign (Kd:
 *  "what are these numbers will a normal people not knowing math understand"):
 *  halves from a cup up, quarters under one, then tablespoons in halves, then
 *  teaspoons in halves, and nothing under half a teaspoon. Each unit starts where
 *  the one above it would round to nothing, so a rounded amount never reads as the
 *  unit below it would ("4 tablespoons" is a quarter cup, "3 teaspoons" a tablespoon). */
export function cupsInWords(amount) {
  const raw = Number(amount);
  const cups = snap(raw);
  if (!(cups > 0)) return null;
  if (cups >= 0.875) return halves(Math.round(cups * 2) / 2, 'cup');
  if (cups >= 0.25) return QUARTER_CUPS[Math.round(cups * 4)];
  // Each from the amount itself, never from cups already snapped.
  const tbsp = snap(raw * TBSP_PER_CUP);
  if (tbsp >= 1) {
    const rounded = Math.round(tbsp * 2) / 2;
    return rounded >= 4 ? QUARTER_CUPS[1] : halves(rounded, 'tablespoon');
  }
  const tsp = snap(raw * TSP_PER_CUP);
  if (tsp < 0.5) return null;
  const rounded = Math.round(tsp * 2) / 2;
  return rounded >= 3 ? halves(1, 'tablespoon') : halves(rounded, 'teaspoon');
}

/** The grams said in the food's own cup, or its spoon: "about 1 cup", "about half
 *  a cup, sliced", "about 2 teaspoons" — or null for a food with neither, or an
 *  amount too small to say. */
export function householdAmount(measures, grams) {
  const weighed = Number(grams);
  const volume = householdVolume(measures);
  if (!volume || !(weighed > 0)) return null;
  const words = cupsInWords(weighed / volume.gramsPerCup);
  if (words === null) return null;
  return `about ${words}${volume.qualifier === '' ? '' : `, ${volume.qualifier}`}`;
}

/** A scanned row at the photo's own grams, as its line reads it: "~260 g · about
 *  1 cup · estimate", or "~24 g · estimate" for a food with no cup or spoon. */
export function photoGramsMark(measures, grams) {
  const household = householdAmount(measures, grams);
  return `~${grams} g${household === null ? '' : ` · ${household}`} · estimate`;
}
