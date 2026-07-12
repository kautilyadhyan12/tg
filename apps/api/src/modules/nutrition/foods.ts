// P2.6a curated food inventory — exact values from food_database.py.
// Source line is retained P1.8a-style; kcal/macros are per 100 g as in salvage.
import type { FoodReference } from "./openfoodfacts.adapter.js";

export interface CuratedFood extends FoodReference { source: "curated"; sourceLine: number; }
const slug = (v: string): string => v.toLowerCase().replaceAll(/[^a-z0-9]+/g, "_").replaceAll(/^_+|_+$/g, "");
const row = (name: string, kcal: number, proteinG: number, carbsG: number, fatG: number, fiberG: number, serving: number, unit: string, sourceLine: number): CuratedFood => ({ canonical: slug(name), name, kcal, proteinG, carbsG, fatG, fiberG, serving, unit, source: "curated", sourceLine });

export const CURATED_FOODS: readonly CuratedFood[] = [
row("Chicken breast (cooked)",165,31,0,3.6,0,100,"g",10),row("Chicken thigh (cooked)",209,26,0,11,0,100,"g",11),row("Ground beef 85% (cooked)",218,26,0,13,0,100,"g",12),row("Ground beef 90% (cooked)",196,26,0,10,0,100,"g",13),row("Steak (sirloin, cooked)",244,33,0,12,0,100,"g",14),
row("Pork chop (cooked)",231,27,0,14,0,100,"g",15),row("Bacon (cooked)",541,37,1.4,42,0,100,"g",16),row("Turkey breast (cooked)",135,30,0,1,0,100,"g",17),row("Lamb (cooked)",294,25,0,21,0,100,"g",18),row("Salmon (cooked)",208,22,0,13,0,100,"g",21),
row("Tuna (canned in water)",116,26,0,1,0,100,"g",22),row("Tilapia (cooked)",128,26,0,2.7,0,100,"g",23),row("Cod (cooked)",105,23,0,.9,0,100,"g",24),row("Shrimp (cooked)",99,24,.2,.3,0,100,"g",25),row("Sardines (canned in oil)",208,25,0,11,0,100,"g",26),
row("Egg (whole, large)",72,6.3,.4,4.8,0,50,"egg",29),row("Egg white",17,3.6,.2,.1,0,33,"white",30),row("Greek yogurt (plain)",59,10,3.6,.4,0,100,"g",31),row("Cottage cheese (low-fat)",81,11,3.4,2.3,0,100,"g",32),row("Milk (whole)",61,3.2,4.8,3.3,0,240,"cup",33),
row("Milk (skim)",34,3.4,5,.1,0,240,"cup",34),row("Cheddar cheese",403,25,1.3,33,0,30,"slice",35),row("Mozzarella cheese",280,28,3,17,0,30,"slice",36),row("Butter",717,.9,.1,81,0,14,"tbsp",37),row("Tofu (firm)",144,17,3,9,2,100,"g",40),
row("Tempeh",192,20,8,11,0,100,"g",41),row("Lentils (cooked)",116,9,20,.4,8,100,"g",42),row("Chickpeas (cooked)",164,9,27,2.6,8,100,"g",43),row("Black beans (cooked)",132,9,24,.5,8.7,100,"g",44),row("Kidney beans (cooked)",127,9,23,.5,6.4,100,"g",45),row("Edamame (cooked)",121,12,9,5,5,100,"g",46),
row("Rice (white, cooked)",130,2.7,28,.3,.4,100,"g",49),row("Rice (brown, cooked)",112,2.6,24,.9,1.8,100,"g",50),row("Oats (dry)",389,17,66,7,11,40,"cup",51),row("Quinoa (cooked)",120,4.4,21,1.9,2.8,100,"g",52),row("Pasta (cooked)",131,5,25,1.1,1.8,100,"g",53),
row("Whole wheat bread",247,13,41,4.2,7,30,"slice",54),row("White bread",265,9,49,3.2,2.7,30,"slice",55),row("Tortilla (flour)",304,8,52,7,3,50,"tortilla",56),row("Bagel (plain)",257,10,51,1.5,2,100,"bagel",57),row("Cereal (cornflakes)",357,8,84,.4,3,30,"cup",58),row("Granola",471,10,64,20,6,50,"cup",59),
row("Potato (baked)",93,2.5,21,.1,2.2,150,"potato",62),row("Sweet potato (baked)",90,2,21,.2,3.3,150,"potato",63),row("French fries",312,3.4,41,15,3.8,100,"g",64),row("Corn (cooked)",96,3.4,21,1.5,2.4,100,"g",65),
row("Broccoli (cooked)",35,2.4,7,.4,3.3,100,"g",68),row("Spinach (raw)",23,2.9,3.6,.4,2.2,100,"g",69),row("Kale (cooked)",28,1.9,5.6,.4,2,100,"g",70),row("Carrots (raw)",41,.9,10,.2,2.8,100,"g",71),row("Bell pepper",31,1,6,.3,2.1,100,"g",72),
row("Cucumber",16,.7,3.6,.1,.5,100,"g",73),row("Tomato",18,.9,3.9,.2,1.2,100,"g",74),row("Lettuce",15,1.4,2.9,.2,1.3,100,"g",75),row("Onion",40,1.1,9.3,.1,1.7,100,"g",76),row("Mushrooms",22,3.1,3.3,.3,1,100,"g",77),
row("Asparagus (cooked)",22,2.4,4.1,.2,2,100,"g",78),row("Zucchini",17,1.2,3.1,.3,1,100,"g",79),row("Cauliflower (cooked)",23,1.8,4.1,.5,2.3,100,"g",80),row("Brussels sprouts",36,2.6,7.1,.5,2.6,100,"g",81),row("Cabbage",25,1.3,5.8,.1,2.5,100,"g",82),row("Avocado",160,2,9,15,7,100,"g",83),
row("Apple",52,.3,14,.2,2.4,180,"apple",86),row("Banana",89,1.1,23,.3,2.6,120,"banana",87),row("Orange",47,.9,12,.1,2.4,150,"orange",88),row("Strawberries",32,.7,7.7,.3,2,100,"g",89),row("Blueberries",57,.7,14,.3,2.4,100,"g",90),
row("Grapes",67,.6,17,.4,.9,100,"g",91),row("Watermelon",30,.6,7.6,.2,.4,100,"g",92),row("Mango",60,.8,15,.4,1.6,100,"g",93),row("Pineapple",50,.5,13,.1,1.4,100,"g",94),row("Pear",57,.4,15,.1,3.1,180,"pear",95),row("Peach",39,.9,9.5,.3,1.5,150,"peach",96),row("Kiwi",61,1.1,15,.5,3,75,"kiwi",97),
row("Almonds",579,21,22,50,13,28,"oz",100),row("Peanuts",567,26,16,49,9,28,"oz",101),row("Walnuts",654,15,14,65,7,28,"oz",102),row("Cashews",553,18,30,44,3.3,28,"oz",103),row("Peanut butter",588,25,20,50,6,32,"tbsp",104),
row("Almond butter",614,21,19,56,10,32,"tbsp",105),row("Chia seeds",486,17,42,31,34,28,"oz",106),row("Flax seeds",534,18,29,42,27,28,"oz",107),row("Sunflower seeds",584,21,20,51,9,28,"oz",108),
row("Olive oil",884,0,0,100,0,14,"tbsp",111),row("Coconut oil",862,0,0,100,0,14,"tbsp",112),row("Vegetable oil",884,0,0,100,0,14,"tbsp",113),row("Mayonnaise",680,1,1,75,0,15,"tbsp",114),
row("Coffee (black)",2,.3,0,0,0,240,"cup",117),row("Tea (unsweetened)",1,0,.3,0,0,240,"cup",118),row("Orange juice",45,.7,10,.2,.2,240,"cup",119),row("Apple juice",46,.1,11,.1,.2,240,"cup",120),row("Coke / cola",42,0,11,0,0,240,"cup",121),
row("Beer (regular)",43,.5,3.6,0,0,350,"can",122),row("Wine (red)",85,.1,2.6,0,0,150,"glass",123),row("Whey protein (powder)",400,80,8,6,0,30,"scoop",124),
row("Pizza (cheese)",266,11,33,10,2.3,107,"slice",127),row("Pizza (pepperoni)",296,13,33,12,2,107,"slice",128),row("Hamburger (fast food)",250,13,30,9,1.5,100,"burger",129),row("Hot dog",290,10,4,26,0,60,"hotdog",130),row("Sushi roll",145,3,30,.5,.8,100,"g",131),
row("Burrito (chicken)",215,12,26,7,2,100,"g",132),row("Sandwich (turkey)",200,14,27,4,2,150,"sandwich",133),row("Caesar salad (with chicken)",130,10,7,7,2,100,"g",134),row("Fried rice",174,5,27,5,1,100,"g",135),row("Mac and cheese",164,6,20,7,1,100,"g",136),
row("Chocolate (dark 70%)",598,7.8,46,43,11,30,"oz",139),row("Chocolate chip cookie",488,5,65,24,2,30,"cookie",140),row("Ice cream (vanilla)",207,3.5,24,11,.7,100,"g",141),row("Potato chips",536,7,53,34,5,28,"oz",142),row("Pretzels",380,10,80,3,3,30,"oz",143),
row("Popcorn (plain)",387,12,78,4.5,14,30,"cup",144),row("Honey",304,.3,82,0,.2,21,"tbsp",145),row("Sugar (white)",387,0,100,0,0,4,"tsp",146),row("Donut (glazed)",421,4.7,50,23,1.3,60,"donut",147),row("Croissant",406,8,46,21,2.6,60,"croissant",148),
row("Roti / Chapati",297,11,46,7.5,5,40,"roti",151),row("Naan",310,9,55,6,2,90,"naan",152),row("Dal (lentil curry)",110,6,18,1.5,4,100,"g",153),row("Paneer",296,18,4,23,0,100,"g",154),row("Chicken curry",175,14,6,11,1,100,"g",155),
row("Butter chicken",220,14,8,15,1,100,"g",156),row("Biryani (chicken)",200,9,26,7,1.5,100,"g",157),row("Samosa",308,5,32,18,3,50,"samosa",158),row("Idli",39,2,8,.1,.4,30,"idli",159),row("Dosa (plain)",168,3.9,30,3.7,1,75,"dosa",160),
row("Ramen (cooked)",436,10,63,16,2,100,"g",163),row("Pad Thai",192,8,30,5,2,100,"g",164),row("Spring roll",138,5,21,4,2,50,"roll",165),row("Dumplings (pork)",200,8,26,7,2,100,"g",166),row("Pho (beef)",350,25,45,8,2,400,"bowl",167),
];

export function searchCurated(query: string, limit: number): CuratedFood[] {
  const q = query.toLowerCase().trim();
  return CURATED_FOODS.map((food) => { const name = food.name.toLowerCase(); const score = name === q ? 100 : name.startsWith(q) ? 80 : name.includes(q) ? 50 : q.split(/\s+/).every((word) => name.includes(word)) ? 30 : 0; return { food, score }; }).filter((v) => v.score > 0).sort((a, b) => b.score - a.score).slice(0, limit).map((v) => v.food);
}

export function findCurated(query: string): CuratedFood | null {
  const q = slug(query);
  return CURATED_FOODS.find((f) => f.canonical === q || f.canonical.includes(q) || q.includes(f.canonical)) ?? searchCurated(query, 1)[0] ?? null;
}
