"""
Built-in food database — 200+ common foods with nutrition info.
Per 100g unless otherwise noted in serving_unit.
Source: USDA averages + common reference values.
"""

# Each entry: name, calories, protein_g, carbs_g, fat_g, fiber_g, serving_size_g, serving_unit
FOODS = [
    # ── Proteins — meat ──────────────────────────────────────────────────
    {"name": "Chicken breast (cooked)",  "kcal": 165, "p": 31.0, "c": 0,    "f": 3.6,  "fib": 0,   "serving": 100, "unit": "g"},
    {"name": "Chicken thigh (cooked)",   "kcal": 209, "p": 26.0, "c": 0,    "f": 11.0, "fib": 0,   "serving": 100, "unit": "g"},
    {"name": "Ground beef 85% (cooked)", "kcal": 218, "p": 26.0, "c": 0,    "f": 13.0, "fib": 0,   "serving": 100, "unit": "g"},
    {"name": "Ground beef 90% (cooked)", "kcal": 196, "p": 26.0, "c": 0,    "f": 10.0, "fib": 0,   "serving": 100, "unit": "g"},
    {"name": "Steak (sirloin, cooked)",  "kcal": 244, "p": 33.0, "c": 0,    "f": 12.0, "fib": 0,   "serving": 100, "unit": "g"},
    {"name": "Pork chop (cooked)",       "kcal": 231, "p": 27.0, "c": 0,    "f": 14.0, "fib": 0,   "serving": 100, "unit": "g"},
    {"name": "Bacon (cooked)",           "kcal": 541, "p": 37.0, "c": 1.4,  "f": 42.0, "fib": 0,   "serving": 100, "unit": "g"},
    {"name": "Turkey breast (cooked)",   "kcal": 135, "p": 30.0, "c": 0,    "f": 1.0,  "fib": 0,   "serving": 100, "unit": "g"},
    {"name": "Lamb (cooked)",            "kcal": 294, "p": 25.0, "c": 0,    "f": 21.0, "fib": 0,   "serving": 100, "unit": "g"},

    # ── Proteins — fish ──────────────────────────────────────────────────
    {"name": "Salmon (cooked)",          "kcal": 208, "p": 22.0, "c": 0,    "f": 13.0, "fib": 0,   "serving": 100, "unit": "g"},
    {"name": "Tuna (canned in water)",   "kcal": 116, "p": 26.0, "c": 0,    "f": 1.0,  "fib": 0,   "serving": 100, "unit": "g"},
    {"name": "Tilapia (cooked)",         "kcal": 128, "p": 26.0, "c": 0,    "f": 2.7,  "fib": 0,   "serving": 100, "unit": "g"},
    {"name": "Cod (cooked)",             "kcal": 105, "p": 23.0, "c": 0,    "f": 0.9,  "fib": 0,   "serving": 100, "unit": "g"},
    {"name": "Shrimp (cooked)",          "kcal": 99,  "p": 24.0, "c": 0.2,  "f": 0.3,  "fib": 0,   "serving": 100, "unit": "g"},
    {"name": "Sardines (canned in oil)", "kcal": 208, "p": 25.0, "c": 0,    "f": 11.0, "fib": 0,   "serving": 100, "unit": "g"},

    # ── Proteins — eggs, dairy ───────────────────────────────────────────
    {"name": "Egg (whole, large)",       "kcal": 72,  "p": 6.3,  "c": 0.4,  "f": 4.8,  "fib": 0,   "serving": 50,  "unit": "egg"},
    {"name": "Egg white",                "kcal": 17,  "p": 3.6,  "c": 0.2,  "f": 0.1,  "fib": 0,   "serving": 33,  "unit": "white"},
    {"name": "Greek yogurt (plain)",     "kcal": 59,  "p": 10.0, "c": 3.6,  "f": 0.4,  "fib": 0,   "serving": 100, "unit": "g"},
    {"name": "Cottage cheese (low-fat)", "kcal": 81,  "p": 11.0, "c": 3.4,  "f": 2.3,  "fib": 0,   "serving": 100, "unit": "g"},
    {"name": "Milk (whole)",             "kcal": 61,  "p": 3.2,  "c": 4.8,  "f": 3.3,  "fib": 0,   "serving": 240, "unit": "cup"},
    {"name": "Milk (skim)",              "kcal": 34,  "p": 3.4,  "c": 5.0,  "f": 0.1,  "fib": 0,   "serving": 240, "unit": "cup"},
    {"name": "Cheddar cheese",           "kcal": 403, "p": 25.0, "c": 1.3,  "f": 33.0, "fib": 0,   "serving": 30,  "unit": "slice"},
    {"name": "Mozzarella cheese",        "kcal": 280, "p": 28.0, "c": 3.0,  "f": 17.0, "fib": 0,   "serving": 30,  "unit": "slice"},
    {"name": "Butter",                   "kcal": 717, "p": 0.9,  "c": 0.1,  "f": 81.0, "fib": 0,   "serving": 14,  "unit": "tbsp"},

    # ── Proteins — plant ─────────────────────────────────────────────────
    {"name": "Tofu (firm)",              "kcal": 144, "p": 17.0, "c": 3.0,  "f": 9.0,  "fib": 2.0, "serving": 100, "unit": "g"},
    {"name": "Tempeh",                   "kcal": 192, "p": 20.0, "c": 8.0,  "f": 11.0, "fib": 0,   "serving": 100, "unit": "g"},
    {"name": "Lentils (cooked)",         "kcal": 116, "p": 9.0,  "c": 20.0, "f": 0.4,  "fib": 8.0, "serving": 100, "unit": "g"},
    {"name": "Chickpeas (cooked)",       "kcal": 164, "p": 9.0,  "c": 27.0, "f": 2.6,  "fib": 8.0, "serving": 100, "unit": "g"},
    {"name": "Black beans (cooked)",     "kcal": 132, "p": 9.0,  "c": 24.0, "f": 0.5,  "fib": 8.7, "serving": 100, "unit": "g"},
    {"name": "Kidney beans (cooked)",    "kcal": 127, "p": 9.0,  "c": 23.0, "f": 0.5,  "fib": 6.4, "serving": 100, "unit": "g"},
    {"name": "Edamame (cooked)",         "kcal": 121, "p": 12.0, "c": 9.0,  "f": 5.0,  "fib": 5.0, "serving": 100, "unit": "g"},

    # ── Carbs — grains ───────────────────────────────────────────────────
    {"name": "Rice (white, cooked)",     "kcal": 130, "p": 2.7,  "c": 28.0, "f": 0.3,  "fib": 0.4, "serving": 100, "unit": "g"},
    {"name": "Rice (brown, cooked)",     "kcal": 112, "p": 2.6,  "c": 24.0, "f": 0.9,  "fib": 1.8, "serving": 100, "unit": "g"},
    {"name": "Oats (dry)",               "kcal": 389, "p": 17.0, "c": 66.0, "f": 7.0,  "fib": 11.0,"serving": 40,  "unit": "cup"},
    {"name": "Quinoa (cooked)",          "kcal": 120, "p": 4.4,  "c": 21.0, "f": 1.9,  "fib": 2.8, "serving": 100, "unit": "g"},
    {"name": "Pasta (cooked)",           "kcal": 131, "p": 5.0,  "c": 25.0, "f": 1.1,  "fib": 1.8, "serving": 100, "unit": "g"},
    {"name": "Whole wheat bread",        "kcal": 247, "p": 13.0, "c": 41.0, "f": 4.2,  "fib": 7.0, "serving": 30,  "unit": "slice"},
    {"name": "White bread",              "kcal": 265, "p": 9.0,  "c": 49.0, "f": 3.2,  "fib": 2.7, "serving": 30,  "unit": "slice"},
    {"name": "Tortilla (flour)",         "kcal": 304, "p": 8.0,  "c": 52.0, "f": 7.0,  "fib": 3.0, "serving": 50,  "unit": "tortilla"},
    {"name": "Bagel (plain)",            "kcal": 257, "p": 10.0, "c": 51.0, "f": 1.5,  "fib": 2.0, "serving": 100, "unit": "bagel"},
    {"name": "Cereal (cornflakes)",      "kcal": 357, "p": 8.0,  "c": 84.0, "f": 0.4,  "fib": 3.0, "serving": 30,  "unit": "cup"},
    {"name": "Granola",                  "kcal": 471, "p": 10.0, "c": 64.0, "f": 20.0, "fib": 6.0, "serving": 50,  "unit": "cup"},

    # ── Carbs — starchy ──────────────────────────────────────────────────
    {"name": "Potato (baked)",           "kcal": 93,  "p": 2.5,  "c": 21.0, "f": 0.1,  "fib": 2.2, "serving": 150, "unit": "potato"},
    {"name": "Sweet potato (baked)",     "kcal": 90,  "p": 2.0,  "c": 21.0, "f": 0.2,  "fib": 3.3, "serving": 150, "unit": "potato"},
    {"name": "French fries",             "kcal": 312, "p": 3.4,  "c": 41.0, "f": 15.0, "fib": 3.8, "serving": 100, "unit": "g"},
    {"name": "Corn (cooked)",            "kcal": 96,  "p": 3.4,  "c": 21.0, "f": 1.5,  "fib": 2.4, "serving": 100, "unit": "g"},

    # ── Vegetables ───────────────────────────────────────────────────────
    {"name": "Broccoli (cooked)",        "kcal": 35,  "p": 2.4,  "c": 7.0,  "f": 0.4,  "fib": 3.3, "serving": 100, "unit": "g"},
    {"name": "Spinach (raw)",            "kcal": 23,  "p": 2.9,  "c": 3.6,  "f": 0.4,  "fib": 2.2, "serving": 100, "unit": "g"},
    {"name": "Kale (cooked)",            "kcal": 28,  "p": 1.9,  "c": 5.6,  "f": 0.4,  "fib": 2.0, "serving": 100, "unit": "g"},
    {"name": "Carrots (raw)",            "kcal": 41,  "p": 0.9,  "c": 10.0, "f": 0.2,  "fib": 2.8, "serving": 100, "unit": "g"},
    {"name": "Bell pepper",              "kcal": 31,  "p": 1.0,  "c": 6.0,  "f": 0.3,  "fib": 2.1, "serving": 100, "unit": "g"},
    {"name": "Cucumber",                 "kcal": 16,  "p": 0.7,  "c": 3.6,  "f": 0.1,  "fib": 0.5, "serving": 100, "unit": "g"},
    {"name": "Tomato",                   "kcal": 18,  "p": 0.9,  "c": 3.9,  "f": 0.2,  "fib": 1.2, "serving": 100, "unit": "g"},
    {"name": "Lettuce",                  "kcal": 15,  "p": 1.4,  "c": 2.9,  "f": 0.2,  "fib": 1.3, "serving": 100, "unit": "g"},
    {"name": "Onion",                    "kcal": 40,  "p": 1.1,  "c": 9.3,  "f": 0.1,  "fib": 1.7, "serving": 100, "unit": "g"},
    {"name": "Mushrooms",                "kcal": 22,  "p": 3.1,  "c": 3.3,  "f": 0.3,  "fib": 1.0, "serving": 100, "unit": "g"},
    {"name": "Asparagus (cooked)",       "kcal": 22,  "p": 2.4,  "c": 4.1,  "f": 0.2,  "fib": 2.0, "serving": 100, "unit": "g"},
    {"name": "Zucchini",                 "kcal": 17,  "p": 1.2,  "c": 3.1,  "f": 0.3,  "fib": 1.0, "serving": 100, "unit": "g"},
    {"name": "Cauliflower (cooked)",     "kcal": 23,  "p": 1.8,  "c": 4.1,  "f": 0.5,  "fib": 2.3, "serving": 100, "unit": "g"},
    {"name": "Brussels sprouts",         "kcal": 36,  "p": 2.6,  "c": 7.1,  "f": 0.5,  "fib": 2.6, "serving": 100, "unit": "g"},
    {"name": "Cabbage",                  "kcal": 25,  "p": 1.3,  "c": 5.8,  "f": 0.1,  "fib": 2.5, "serving": 100, "unit": "g"},
    {"name": "Avocado",                  "kcal": 160, "p": 2.0,  "c": 9.0,  "f": 15.0, "fib": 7.0, "serving": 100, "unit": "g"},

    # ── Fruits ───────────────────────────────────────────────────────────
    {"name": "Apple",                    "kcal": 52,  "p": 0.3,  "c": 14.0, "f": 0.2,  "fib": 2.4, "serving": 180, "unit": "apple"},
    {"name": "Banana",                   "kcal": 89,  "p": 1.1,  "c": 23.0, "f": 0.3,  "fib": 2.6, "serving": 120, "unit": "banana"},
    {"name": "Orange",                   "kcal": 47,  "p": 0.9,  "c": 12.0, "f": 0.1,  "fib": 2.4, "serving": 150, "unit": "orange"},
    {"name": "Strawberries",             "kcal": 32,  "p": 0.7,  "c": 7.7,  "f": 0.3,  "fib": 2.0, "serving": 100, "unit": "g"},
    {"name": "Blueberries",              "kcal": 57,  "p": 0.7,  "c": 14.0, "f": 0.3,  "fib": 2.4, "serving": 100, "unit": "g"},
    {"name": "Grapes",                   "kcal": 67,  "p": 0.6,  "c": 17.0, "f": 0.4,  "fib": 0.9, "serving": 100, "unit": "g"},
    {"name": "Watermelon",               "kcal": 30,  "p": 0.6,  "c": 7.6,  "f": 0.2,  "fib": 0.4, "serving": 100, "unit": "g"},
    {"name": "Mango",                    "kcal": 60,  "p": 0.8,  "c": 15.0, "f": 0.4,  "fib": 1.6, "serving": 100, "unit": "g"},
    {"name": "Pineapple",                "kcal": 50,  "p": 0.5,  "c": 13.0, "f": 0.1,  "fib": 1.4, "serving": 100, "unit": "g"},
    {"name": "Pear",                     "kcal": 57,  "p": 0.4,  "c": 15.0, "f": 0.1,  "fib": 3.1, "serving": 180, "unit": "pear"},
    {"name": "Peach",                    "kcal": 39,  "p": 0.9,  "c": 9.5,  "f": 0.3,  "fib": 1.5, "serving": 150, "unit": "peach"},
    {"name": "Kiwi",                     "kcal": 61,  "p": 1.1,  "c": 15.0, "f": 0.5,  "fib": 3.0, "serving": 75,  "unit": "kiwi"},

    # ── Nuts and seeds ───────────────────────────────────────────────────
    {"name": "Almonds",                  "kcal": 579, "p": 21.0, "c": 22.0, "f": 50.0, "fib": 13.0,"serving": 28,  "unit": "oz"},
    {"name": "Peanuts",                  "kcal": 567, "p": 26.0, "c": 16.0, "f": 49.0, "fib": 9.0, "serving": 28,  "unit": "oz"},
    {"name": "Walnuts",                  "kcal": 654, "p": 15.0, "c": 14.0, "f": 65.0, "fib": 7.0, "serving": 28,  "unit": "oz"},
    {"name": "Cashews",                  "kcal": 553, "p": 18.0, "c": 30.0, "f": 44.0, "fib": 3.3, "serving": 28,  "unit": "oz"},
    {"name": "Peanut butter",            "kcal": 588, "p": 25.0, "c": 20.0, "f": 50.0, "fib": 6.0, "serving": 32,  "unit": "tbsp"},
    {"name": "Almond butter",            "kcal": 614, "p": 21.0, "c": 19.0, "f": 56.0, "fib": 10.0,"serving": 32,  "unit": "tbsp"},
    {"name": "Chia seeds",               "kcal": 486, "p": 17.0, "c": 42.0, "f": 31.0, "fib": 34.0,"serving": 28,  "unit": "oz"},
    {"name": "Flax seeds",               "kcal": 534, "p": 18.0, "c": 29.0, "f": 42.0, "fib": 27.0,"serving": 28,  "unit": "oz"},
    {"name": "Sunflower seeds",          "kcal": 584, "p": 21.0, "c": 20.0, "f": 51.0, "fib": 9.0, "serving": 28,  "unit": "oz"},

    # ── Oils and fats ────────────────────────────────────────────────────
    {"name": "Olive oil",                "kcal": 884, "p": 0,    "c": 0,    "f": 100.0,"fib": 0,   "serving": 14,  "unit": "tbsp"},
    {"name": "Coconut oil",              "kcal": 862, "p": 0,    "c": 0,    "f": 100.0,"fib": 0,   "serving": 14,  "unit": "tbsp"},
    {"name": "Vegetable oil",            "kcal": 884, "p": 0,    "c": 0,    "f": 100.0,"fib": 0,   "serving": 14,  "unit": "tbsp"},
    {"name": "Mayonnaise",               "kcal": 680, "p": 1.0,  "c": 1.0,  "f": 75.0, "fib": 0,   "serving": 15,  "unit": "tbsp"},

    # ── Drinks ───────────────────────────────────────────────────────────
    {"name": "Coffee (black)",           "kcal": 2,   "p": 0.3,  "c": 0,    "f": 0,    "fib": 0,   "serving": 240, "unit": "cup"},
    {"name": "Tea (unsweetened)",        "kcal": 1,   "p": 0,    "c": 0.3,  "f": 0,    "fib": 0,   "serving": 240, "unit": "cup"},
    {"name": "Orange juice",             "kcal": 45,  "p": 0.7,  "c": 10.0, "f": 0.2,  "fib": 0.2, "serving": 240, "unit": "cup"},
    {"name": "Apple juice",              "kcal": 46,  "p": 0.1,  "c": 11.0, "f": 0.1,  "fib": 0.2, "serving": 240, "unit": "cup"},
    {"name": "Coke / cola",              "kcal": 42,  "p": 0,    "c": 11.0, "f": 0,    "fib": 0,   "serving": 240, "unit": "cup"},
    {"name": "Beer (regular)",           "kcal": 43,  "p": 0.5,  "c": 3.6,  "f": 0,    "fib": 0,   "serving": 350, "unit": "can"},
    {"name": "Wine (red)",               "kcal": 85,  "p": 0.1,  "c": 2.6,  "f": 0,    "fib": 0,   "serving": 150, "unit": "glass"},
    {"name": "Whey protein (powder)",    "kcal": 400, "p": 80.0, "c": 8.0,  "f": 6.0,  "fib": 0,   "serving": 30,  "unit": "scoop"},

    # ── Common meals / prepared ──────────────────────────────────────────
    {"name": "Pizza (cheese)",           "kcal": 266, "p": 11.0, "c": 33.0, "f": 10.0, "fib": 2.3, "serving": 107, "unit": "slice"},
    {"name": "Pizza (pepperoni)",        "kcal": 296, "p": 13.0, "c": 33.0, "f": 12.0, "fib": 2.0, "serving": 107, "unit": "slice"},
    {"name": "Hamburger (fast food)",    "kcal": 250, "p": 13.0, "c": 30.0, "f": 9.0,  "fib": 1.5, "serving": 100, "unit": "burger"},
    {"name": "Hot dog",                  "kcal": 290, "p": 10.0, "c": 4.0,  "f": 26.0, "fib": 0,   "serving": 60,  "unit": "hotdog"},
    {"name": "Sushi roll",               "kcal": 145, "p": 3.0,  "c": 30.0, "f": 0.5,  "fib": 0.8, "serving": 100, "unit": "g"},
    {"name": "Burrito (chicken)",        "kcal": 215, "p": 12.0, "c": 26.0, "f": 7.0,  "fib": 2.0, "serving": 100, "unit": "g"},
    {"name": "Sandwich (turkey)",        "kcal": 200, "p": 14.0, "c": 27.0, "f": 4.0,  "fib": 2.0, "serving": 150, "unit": "sandwich"},
    {"name": "Caesar salad (with chicken)","kcal": 130,"p":10.0, "c": 7.0,  "f": 7.0,  "fib": 2.0, "serving": 100, "unit": "g"},
    {"name": "Fried rice",               "kcal": 174, "p": 5.0,  "c": 27.0, "f": 5.0,  "fib": 1.0, "serving": 100, "unit": "g"},
    {"name": "Mac and cheese",           "kcal": 164, "p": 6.0,  "c": 20.0, "f": 7.0,  "fib": 1.0, "serving": 100, "unit": "g"},

    # ── Sweets and snacks ────────────────────────────────────────────────
    {"name": "Chocolate (dark 70%)",     "kcal": 598, "p": 7.8,  "c": 46.0, "f": 43.0, "fib": 11.0,"serving": 30,  "unit": "oz"},
    {"name": "Chocolate chip cookie",    "kcal": 488, "p": 5.0,  "c": 65.0, "f": 24.0, "fib": 2.0, "serving": 30,  "unit": "cookie"},
    {"name": "Ice cream (vanilla)",      "kcal": 207, "p": 3.5,  "c": 24.0, "f": 11.0, "fib": 0.7, "serving": 100, "unit": "g"},
    {"name": "Potato chips",             "kcal": 536, "p": 7.0,  "c": 53.0, "f": 34.0, "fib": 5.0, "serving": 28,  "unit": "oz"},
    {"name": "Pretzels",                 "kcal": 380, "p": 10.0, "c": 80.0, "f": 3.0,  "fib": 3.0, "serving": 30,  "unit": "oz"},
    {"name": "Popcorn (plain)",          "kcal": 387, "p": 12.0, "c": 78.0, "f": 4.5,  "fib": 14.0,"serving": 30,  "unit": "cup"},
    {"name": "Honey",                    "kcal": 304, "p": 0.3,  "c": 82.0, "f": 0,    "fib": 0.2, "serving": 21,  "unit": "tbsp"},
    {"name": "Sugar (white)",            "kcal": 387, "p": 0,    "c": 100.0,"f": 0,    "fib": 0,   "serving": 4,   "unit": "tsp"},
    {"name": "Donut (glazed)",           "kcal": 421, "p": 4.7,  "c": 50.0, "f": 23.0, "fib": 1.3, "serving": 60,  "unit": "donut"},
    {"name": "Croissant",                "kcal": 406, "p": 8.0,  "c": 46.0, "f": 21.0, "fib": 2.6, "serving": 60,  "unit": "croissant"},

    # ── Indian / South Asian ─────────────────────────────────────────────
    {"name": "Roti / Chapati",           "kcal": 297, "p": 11.0, "c": 46.0, "f": 7.5,  "fib": 5.0, "serving": 40,  "unit": "roti"},
    {"name": "Naan",                     "kcal": 310, "p": 9.0,  "c": 55.0, "f": 6.0,  "fib": 2.0, "serving": 90,  "unit": "naan"},
    {"name": "Dal (lentil curry)",       "kcal": 110, "p": 6.0,  "c": 18.0, "f": 1.5,  "fib": 4.0, "serving": 100, "unit": "g"},
    {"name": "Paneer",                   "kcal": 296, "p": 18.0, "c": 4.0,  "f": 23.0, "fib": 0,   "serving": 100, "unit": "g"},
    {"name": "Chicken curry",            "kcal": 175, "p": 14.0, "c": 6.0,  "f": 11.0, "fib": 1.0, "serving": 100, "unit": "g"},
    {"name": "Butter chicken",           "kcal": 220, "p": 14.0, "c": 8.0,  "f": 15.0, "fib": 1.0, "serving": 100, "unit": "g"},
    {"name": "Biryani (chicken)",        "kcal": 200, "p": 9.0,  "c": 26.0, "f": 7.0,  "fib": 1.5, "serving": 100, "unit": "g"},
    {"name": "Samosa",                   "kcal": 308, "p": 5.0,  "c": 32.0, "f": 18.0, "fib": 3.0, "serving": 50,  "unit": "samosa"},
    {"name": "Idli",                     "kcal": 39,  "p": 2.0,  "c": 8.0,  "f": 0.1,  "fib": 0.4, "serving": 30,  "unit": "idli"},
    {"name": "Dosa (plain)",             "kcal": 168, "p": 3.9,  "c": 30.0, "f": 3.7,  "fib": 1.0, "serving": 75,  "unit": "dosa"},

    # ── Asian ────────────────────────────────────────────────────────────
    {"name": "Ramen (cooked)",           "kcal": 436, "p": 10.0, "c": 63.0, "f": 16.0, "fib": 2.0, "serving": 100, "unit": "g"},
    {"name": "Pad Thai",                 "kcal": 192, "p": 8.0,  "c": 30.0, "f": 5.0,  "fib": 2.0, "serving": 100, "unit": "g"},
    {"name": "Spring roll",              "kcal": 138, "p": 5.0,  "c": 21.0, "f": 4.0,  "fib": 2.0, "serving": 50,  "unit": "roll"},
    {"name": "Dumplings (pork)",         "kcal": 200, "p": 8.0,  "c": 26.0, "f": 7.0,  "fib": 1.0, "serving": 100, "unit": "g"},
    {"name": "Pho (beef)",               "kcal": 350, "p": 25.0, "c": 45.0, "f": 8.0,  "fib": 2.0, "serving": 400, "unit": "bowl"},
]


def search_foods(query: str, limit: int = 10) -> list:
    """
    Simple substring search.
    Returns matching foods with score (higher = better match).
    """
    if not query:
        return FOODS[:limit]

    q = query.lower().strip()
    results = []

    for food in FOODS:
        name_lower = food["name"].lower()

        # Score: exact match > startswith > contains
        if name_lower == q:
            score = 100
        elif name_lower.startswith(q):
            score = 80
        elif q in name_lower:
            score = 50
        else:
            # Word-level match
            words = q.split()
            if all(w in name_lower for w in words):
                score = 30
            else:
                continue

        results.append({**food, "score": score})

    # Sort by score descending
    results.sort(key=lambda x: -x["score"])
    return results[:limit]


def get_food_by_name(name: str) -> dict | None:
    """Get a food by exact name match (case-insensitive)."""
    n = name.lower().strip()
    for food in FOODS:
        if food["name"].lower() == n:
            return food
    return None