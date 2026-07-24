// Curated v1-receptenbibliotheek voor het pilotgezin.
// Bewust statisch en handmatig samengesteld (sectie 2 / fase 0 van het
// technisch ontwerpdocument) — geen open-ended receptenzoekmachine.

export type IngredientUnit = "GRAM" | "PIECE" | "ML";
export type IngredientCategory =
  | "MEAT"
  | "FISH"
  | "DAIRY"
  | "VEGETABLE"
  | "FRUIT"
  | "GRAIN"
  | "LEGUME"
  | "PANTRY"
  | "OTHER";

export interface IngredientSeed {
  name: string;
  unit: IngredientUnit;
  category: IngredientCategory;
}

// ── Genormaliseerde ingrediëntenpool ────────────────────────────────────
export const INGREDIENTS: IngredientSeed[] = [
  // Vlees
  { name: "Gehakt (rund)", unit: "GRAM", category: "MEAT" },
  { name: "Kipfilet", unit: "GRAM", category: "MEAT" },
  { name: "Kipdijfilet", unit: "GRAM", category: "MEAT" },
  { name: "Spekblokjes", unit: "GRAM", category: "MEAT" },
  { name: "Schnitzel", unit: "PIECE", category: "MEAT" },
  { name: "Runderlappen", unit: "GRAM", category: "MEAT" },
  { name: "Rookworst", unit: "PIECE", category: "MEAT" },
  { name: "Hamburgers (rund)", unit: "PIECE", category: "MEAT" },
  { name: "Kipworst", unit: "PIECE", category: "MEAT" },
  { name: "Pulled chicken", unit: "GRAM", category: "MEAT" },
  { name: "Kipshoarma", unit: "GRAM", category: "MEAT" },
  { name: "Kipdrumsticks", unit: "PIECE", category: "MEAT" },
  // Vis
  { name: "Zalmfilet", unit: "PIECE", category: "FISH" },
  { name: "Vissticks", unit: "PIECE", category: "FISH" },
  { name: "Witvisfilet", unit: "PIECE", category: "FISH" },
  // Zuivel & eieren
  { name: "Geraspte kaas", unit: "GRAM", category: "DAIRY" },
  { name: "Parmezaanse kaas", unit: "GRAM", category: "DAIRY" },
  { name: "Melk", unit: "ML", category: "DAIRY" },
  { name: "Boter", unit: "GRAM", category: "DAIRY" },
  { name: "Slagroom", unit: "ML", category: "DAIRY" },
  { name: "Feta", unit: "GRAM", category: "DAIRY" },
  { name: "Mozzarella", unit: "GRAM", category: "DAIRY" },
  { name: "Ei", unit: "PIECE", category: "DAIRY" },
  { name: "Griekse yoghurt", unit: "GRAM", category: "DAIRY" },
  // Groente
  { name: "Ui", unit: "PIECE", category: "VEGETABLE" },
  { name: "Knoflook", unit: "PIECE", category: "VEGETABLE" },
  { name: "Wortel", unit: "PIECE", category: "VEGETABLE" },
  { name: "Paprika", unit: "PIECE", category: "VEGETABLE" },
  { name: "Courgette", unit: "PIECE", category: "VEGETABLE" },
  { name: "Broccoli", unit: "GRAM", category: "VEGETABLE" },
  { name: "Sperziebonen", unit: "GRAM", category: "VEGETABLE" },
  { name: "Prei", unit: "PIECE", category: "VEGETABLE" },
  { name: "Boerenkool (voorgesneden)", unit: "GRAM", category: "VEGETABLE" },
  { name: "Cherrytomaatjes", unit: "GRAM", category: "VEGETABLE" },
  { name: "Tomaat", unit: "PIECE", category: "VEGETABLE" },
  { name: "Komkommer", unit: "PIECE", category: "VEGETABLE" },
  { name: "Sla", unit: "GRAM", category: "VEGETABLE" },
  { name: "Spinazie", unit: "GRAM", category: "VEGETABLE" },
  { name: "Champignons", unit: "GRAM", category: "VEGETABLE" },
  { name: "Zoete aardappel", unit: "GRAM", category: "VEGETABLE" },
  { name: "Aardappelen", unit: "GRAM", category: "VEGETABLE" },
  { name: "Rode kool", unit: "GRAM", category: "VEGETABLE" },
  { name: "Bloemkool", unit: "GRAM", category: "VEGETABLE" },
  { name: "Aubergine", unit: "PIECE", category: "VEGETABLE" },
  { name: "Rode ui", unit: "PIECE", category: "VEGETABLE" },
  { name: "Rode paprika", unit: "PIECE", category: "VEGETABLE" },
  // Fruit
  { name: "Citroen", unit: "PIECE", category: "FRUIT" },
  { name: "Avocado", unit: "PIECE", category: "FRUIT" },
  // Granen / zetmeel
  { name: "Pasta", unit: "GRAM", category: "GRAIN" },
  { name: "Rijst", unit: "GRAM", category: "GRAIN" },
  { name: "Lasagnebladen", unit: "GRAM", category: "GRAIN" },
  { name: "Tortillawraps", unit: "PIECE", category: "GRAIN" },
  { name: "Broodjes (burger)", unit: "PIECE", category: "GRAIN" },
  { name: "Brood", unit: "PIECE", category: "GRAIN" },
  { name: "Couscous", unit: "GRAM", category: "GRAIN" },
  // Peulvruchten
  { name: "Kidneybonen (blik)", unit: "GRAM", category: "LEGUME" },
  { name: "Bruine linzen", unit: "GRAM", category: "LEGUME" },
  { name: "Kikkererwten (blik)", unit: "GRAM", category: "LEGUME" },
  { name: "Zwarte bonen (blik)", unit: "GRAM", category: "LEGUME" },
  // Voorraadkast
  { name: "Tomatenblokjes (blik)", unit: "GRAM", category: "PANTRY" },
  { name: "Kokosmelk", unit: "ML", category: "PANTRY" },
  { name: "Currypasta", unit: "GRAM", category: "PANTRY" },
  { name: "Teriyakisaus", unit: "ML", category: "PANTRY" },
  { name: "Pesto", unit: "GRAM", category: "PANTRY" },
  { name: "Olijfolie", unit: "ML", category: "PANTRY" },
  { name: "Sojasaus", unit: "ML", category: "PANTRY" },
  { name: "Kerriepoeder", unit: "GRAM", category: "PANTRY" },
  { name: "Groentebouillon", unit: "ML", category: "PANTRY" },
  { name: "Runderbouillon", unit: "ML", category: "PANTRY" },
  { name: "Pijnboompitten", unit: "GRAM", category: "PANTRY" },
  { name: "Bloem", unit: "GRAM", category: "PANTRY" },
  { name: "Paneermeel", unit: "GRAM", category: "PANTRY" },
  { name: "Chilivlokken", unit: "GRAM", category: "PANTRY" },
  { name: "Paprikapoeder", unit: "GRAM", category: "PANTRY" },
  { name: "Komijnpoeder", unit: "GRAM", category: "PANTRY" },
  { name: "Balsamicoazijn", unit: "ML", category: "PANTRY" },
  { name: "Tomatensoep (pak)", unit: "ML", category: "PANTRY" },
];

export type RecipeCategory =
  | "PASTA"
  | "WRAPS"
  | "RICE_DISH"
  | "ALL_VEGGIE_DAY"
  | "QUICK_AND_EASY"
  | "COMFORT_FOOD"
  | "AIRFRYER"
  | "OTHER";

export type RecipeStatus = "FOUND" | "ADAPTED" | "PROVEN" | "SAFE_CHOICE";
export type VariantType = "FAST" | "FRESH" | "REHEATABLE" | "KID_FRIENDLY";

export interface RecipeIngredientSeed {
  ingredient: string; // verwijst naar INGREDIENTS[].name
  quantity: number;
  unit: IngredientUnit;
}

export interface RecipeVariantSeed {
  variantType: VariantType;
  contextFit: string[];
}

export interface RecipeSeed {
  title: string;
  category: RecipeCategory;
  source: string;
  properties: string[];
  status: RecipeStatus;
  instructions: string[];
  ingredients: RecipeIngredientSeed[];
  variants: RecipeVariantSeed[];
}

export const RECIPES: RecipeSeed[] = [
  // ── PASTA ────────────────────────────────────────────────────────────
  {
    title: "Pasta bolognese",
    category: "PASTA",
    source: "eigen",
    properties: ["opwarmbaar", "kindvriendelijk", "comfortfood"],
    status: "SAFE_CHOICE",
    instructions: [
      "Fruit ui en knoflook aan, voeg gehakt toe en bak rul.",
      "Voeg wortel en tomatenblokjes toe, laat 20 minuten sudderen.",
      "Kook de pasta beetgaar en serveer met geraspte kaas.",
    ],
    ingredients: [
      { ingredient: "Pasta", quantity: 500, unit: "GRAM" },
      { ingredient: "Gehakt (rund)", quantity: 500, unit: "GRAM" },
      { ingredient: "Tomatenblokjes (blik)", quantity: 800, unit: "GRAM" },
      { ingredient: "Ui", quantity: 2, unit: "PIECE" },
      { ingredient: "Knoflook", quantity: 2, unit: "PIECE" },
      { ingredient: "Wortel", quantity: 2, unit: "PIECE" },
      { ingredient: "Olijfolie", quantity: 30, unit: "ML" },
      { ingredient: "Geraspte kaas", quantity: 100, unit: "GRAM" },
    ],
    variants: [
      { variantType: "REHEATABLE", contextFit: ["drukke_dag", "opwarmbaar"] },
    ],
  },
  {
    title: "Pasta pesto met kip",
    category: "PASTA",
    source: "eigen",
    properties: ["snel", "kindvriendelijk"],
    status: "PROVEN",
    instructions: [
      "Bak kipfilet in blokjes gaar.",
      "Kook de pasta, meng met pesto en kip.",
      "Werk af met cherrytomaatjes en parmezaanse kaas.",
    ],
    ingredients: [
      { ingredient: "Pasta", quantity: 400, unit: "GRAM" },
      { ingredient: "Kipfilet", quantity: 400, unit: "GRAM" },
      { ingredient: "Pesto", quantity: 100, unit: "GRAM" },
      { ingredient: "Cherrytomaatjes", quantity: 200, unit: "GRAM" },
      { ingredient: "Parmezaanse kaas", quantity: 50, unit: "GRAM" },
      { ingredient: "Pijnboompitten", quantity: 30, unit: "GRAM" },
    ],
    variants: [{ variantType: "FAST", contextFit: ["drukke_dag", "snel"] }],
  },
  {
    title: "Pasta carbonara",
    category: "PASTA",
    source: "eigen",
    properties: ["snel", "comfortfood"],
    status: "FOUND",
    instructions: [
      "Bak spekblokjes uit.",
      "Klop eieren met parmezaanse kaas los.",
      "Meng warme pasta met spek en het eimengsel van het vuur af.",
    ],
    ingredients: [
      { ingredient: "Pasta", quantity: 400, unit: "GRAM" },
      { ingredient: "Spekblokjes", quantity: 200, unit: "GRAM" },
      { ingredient: "Ei", quantity: 4, unit: "PIECE" },
      { ingredient: "Parmezaanse kaas", quantity: 80, unit: "GRAM" },
    ],
    variants: [{ variantType: "FAST", contextFit: ["drukke_dag", "snel"] }],
  },
  {
    title: "Lasagne",
    category: "PASTA",
    source: "eigen",
    properties: ["weekend", "comfortfood", "opwarmbaar"],
    status: "PROVEN",
    instructions: [
      "Maak een bolognesesaus en een bechamelsaus.",
      "Laag lasagnebladen, saus en kaas afwisselend in een ovenschaal.",
      "45 minuten op 180°C in de oven.",
    ],
    ingredients: [
      { ingredient: "Lasagnebladen", quantity: 250, unit: "GRAM" },
      { ingredient: "Gehakt (rund)", quantity: 500, unit: "GRAM" },
      { ingredient: "Tomatenblokjes (blik)", quantity: 800, unit: "GRAM" },
      { ingredient: "Melk", quantity: 500, unit: "ML" },
      { ingredient: "Bloem", quantity: 40, unit: "GRAM" },
      { ingredient: "Boter", quantity: 40, unit: "GRAM" },
      { ingredient: "Geraspte kaas", quantity: 150, unit: "GRAM" },
    ],
    variants: [{ variantType: "REHEATABLE", contextFit: ["weekend", "opwarmbaar"] }],
  },
  {
    title: "Spaghetti aglio olio met broccoli",
    category: "PASTA",
    source: "eigen",
    properties: ["snel", "vegetarisch"],
    status: "FOUND",
    instructions: [
      "Kook de spaghetti en broccoli samen beetgaar.",
      "Fruit knoflook en chilivlokken zacht in olijfolie.",
      "Meng alles door elkaar met parmezaanse kaas.",
    ],
    ingredients: [
      { ingredient: "Pasta", quantity: 400, unit: "GRAM" },
      { ingredient: "Broccoli", quantity: 300, unit: "GRAM" },
      { ingredient: "Knoflook", quantity: 4, unit: "PIECE" },
      { ingredient: "Olijfolie", quantity: 60, unit: "ML" },
      { ingredient: "Chilivlokken", quantity: 5, unit: "GRAM" },
      { ingredient: "Parmezaanse kaas", quantity: 60, unit: "GRAM" },
    ],
    variants: [{ variantType: "FAST", contextFit: ["drukke_dag", "snel"] }],
  },

  // ── WRAPS ────────────────────────────────────────────────────────────
  {
    title: "Kipwraps",
    category: "WRAPS",
    source: "eigen",
    properties: ["snel", "kindvriendelijk"],
    status: "SAFE_CHOICE",
    instructions: [
      "Bak kipfilet in reepjes met paprikapoeder.",
      "Vul tortillawraps met kip, sla, tomaat en yoghurtsaus.",
    ],
    ingredients: [
      { ingredient: "Tortillawraps", quantity: 8, unit: "PIECE" },
      { ingredient: "Kipfilet", quantity: 500, unit: "GRAM" },
      { ingredient: "Sla", quantity: 150, unit: "GRAM" },
      { ingredient: "Tomaat", quantity: 3, unit: "PIECE" },
      { ingredient: "Griekse yoghurt", quantity: 150, unit: "GRAM" },
      { ingredient: "Paprikapoeder", quantity: 5, unit: "GRAM" },
    ],
    variants: [{ variantType: "FAST", contextFit: ["drukke_dag", "snel", "kindvriendelijk"] }],
  },
  {
    title: "Vegetarische wraps met bonen",
    category: "ALL_VEGGIE_DAY",
    source: "eigen",
    properties: ["snel", "vegetarisch"],
    status: "PROVEN",
    instructions: [
      "Verwarm de zwarte bonen met komijnpoeder.",
      "Vul de wraps met bonen, avocado, sla en feta.",
    ],
    ingredients: [
      { ingredient: "Tortillawraps", quantity: 8, unit: "PIECE" },
      { ingredient: "Zwarte bonen (blik)", quantity: 400, unit: "GRAM" },
      { ingredient: "Avocado", quantity: 2, unit: "PIECE" },
      { ingredient: "Sla", quantity: 100, unit: "GRAM" },
      { ingredient: "Feta", quantity: 100, unit: "GRAM" },
      { ingredient: "Komijnpoeder", quantity: 5, unit: "GRAM" },
    ],
    variants: [{ variantType: "FAST", contextFit: ["drukke_dag", "snel"] }],
  },
  {
    title: "Vissticks wraps",
    category: "WRAPS",
    source: "eigen",
    properties: ["snel", "kindvriendelijk"],
    status: "FOUND",
    instructions: [
      "Bak de vissticks volgens verpakking.",
      "Vul wraps met vissticks, komkommer en sla.",
    ],
    ingredients: [
      { ingredient: "Tortillawraps", quantity: 8, unit: "PIECE" },
      { ingredient: "Vissticks", quantity: 12, unit: "PIECE" },
      { ingredient: "Komkommer", quantity: 1, unit: "PIECE" },
      { ingredient: "Sla", quantity: 100, unit: "GRAM" },
    ],
    variants: [{ variantType: "KID_FRIENDLY", contextFit: ["kindvriendelijk", "snel"] }],
  },
  {
    title: "Pulled chicken wraps",
    category: "WRAPS",
    source: "eigen",
    properties: ["opwarmbaar", "gezellig_samen"],
    status: "FOUND",
    instructions: [
      "Verwarm pulled chicken met een scheutje bbq-saus.",
      "Vul wraps met pulled chicken, rode kool en rode ui.",
    ],
    ingredients: [
      { ingredient: "Tortillawraps", quantity: 8, unit: "PIECE" },
      { ingredient: "Pulled chicken", quantity: 500, unit: "GRAM" },
      { ingredient: "Rode kool", quantity: 200, unit: "GRAM" },
      { ingredient: "Rode ui", quantity: 1, unit: "PIECE" },
    ],
    variants: [{ variantType: "REHEATABLE", contextFit: ["weekend", "gezellig_samen"] }],
  },

  // ── RICE_DISH ────────────────────────────────────────────────────────
  {
    title: "Kip teriyaki met rijst",
    category: "RICE_DISH",
    source: "eigen",
    properties: ["opwarmbaar", "nieuwe_suggestie"],
    status: "ADAPTED",
    instructions: [
      "Bak kipdijfilet in blokjes met paprika en wortel.",
      "Voeg teriyakisaus toe en laat inkoken.",
      "Serveer met gekookte rijst.",
    ],
    ingredients: [
      { ingredient: "Kipdijfilet", quantity: 500, unit: "GRAM" },
      { ingredient: "Rijst", quantity: 400, unit: "GRAM" },
      { ingredient: "Paprika", quantity: 2, unit: "PIECE" },
      { ingredient: "Wortel", quantity: 2, unit: "PIECE" },
      { ingredient: "Teriyakisaus", quantity: 100, unit: "ML" },
    ],
    variants: [{ variantType: "REHEATABLE", contextFit: ["drukke_dag", "opwarmbaar"] }],
  },
  {
    title: "Nasi met ei en groenten",
    category: "RICE_DISH",
    source: "eigen",
    properties: ["snel", "opwarmbaar"],
    status: "PROVEN",
    instructions: [
      "Roerbak wortel en prei met sojasaus.",
      "Meng door gekookte rijst met een gebakken ei erbovenop.",
    ],
    ingredients: [
      { ingredient: "Rijst", quantity: 400, unit: "GRAM" },
      { ingredient: "Ei", quantity: 4, unit: "PIECE" },
      { ingredient: "Wortel", quantity: 2, unit: "PIECE" },
      { ingredient: "Prei", quantity: 1, unit: "PIECE" },
      { ingredient: "Sojasaus", quantity: 40, unit: "ML" },
    ],
    variants: [{ variantType: "FAST", contextFit: ["drukke_dag", "snel"] }],
  },
  {
    title: "Kip kerrie met rijst",
    category: "RICE_DISH",
    source: "eigen",
    properties: ["opwarmbaar", "comfortfood"],
    status: "FOUND",
    instructions: [
      "Bak kipfilet aan, voeg currypasta en kokosmelk toe.",
      "Laat 15 minuten sudderen, serveer met rijst.",
    ],
    ingredients: [
      { ingredient: "Kipfilet", quantity: 500, unit: "GRAM" },
      { ingredient: "Rijst", quantity: 400, unit: "GRAM" },
      { ingredient: "Currypasta", quantity: 60, unit: "GRAM" },
      { ingredient: "Kokosmelk", quantity: 400, unit: "ML" },
      { ingredient: "Paprika", quantity: 1, unit: "PIECE" },
    ],
    variants: [{ variantType: "REHEATABLE", contextFit: ["drukke_dag", "opwarmbaar"] }],
  },
  {
    title: "Chili sin carne met rijst",
    category: "ALL_VEGGIE_DAY",
    source: "eigen",
    properties: ["opwarmbaar", "vegetarisch"],
    status: "PROVEN",
    instructions: [
      "Fruit ui en paprika, voeg kidneybonen en tomatenblokjes toe.",
      "Kruid met paprikapoeder en komijn, laat inkoken.",
      "Serveer met rijst.",
    ],
    ingredients: [
      { ingredient: "Rijst", quantity: 400, unit: "GRAM" },
      { ingredient: "Kidneybonen (blik)", quantity: 400, unit: "GRAM" },
      { ingredient: "Tomatenblokjes (blik)", quantity: 800, unit: "GRAM" },
      { ingredient: "Paprika", quantity: 2, unit: "PIECE" },
      { ingredient: "Ui", quantity: 1, unit: "PIECE" },
      { ingredient: "Paprikapoeder", quantity: 10, unit: "GRAM" },
      { ingredient: "Komijnpoeder", quantity: 5, unit: "GRAM" },
    ],
    variants: [{ variantType: "REHEATABLE", contextFit: ["drukke_dag", "opwarmbaar"] }],
  },
  {
    title: "Roerbak rundvlees met rijst",
    category: "RICE_DISH",
    source: "eigen",
    properties: ["snel"],
    status: "FOUND",
    instructions: [
      "Roerbak reepjes runderlappen kort en fel.",
      "Voeg paprika en broccoli toe, blus af met sojasaus.",
      "Serveer met rijst.",
    ],
    ingredients: [
      { ingredient: "Runderlappen", quantity: 500, unit: "GRAM" },
      { ingredient: "Rijst", quantity: 400, unit: "GRAM" },
      { ingredient: "Paprika", quantity: 2, unit: "PIECE" },
      { ingredient: "Broccoli", quantity: 250, unit: "GRAM" },
      { ingredient: "Sojasaus", quantity: 50, unit: "ML" },
    ],
    variants: [{ variantType: "FAST", contextFit: ["drukke_dag", "snel"] }],
  },

  // ── ALL_VEGGIE_DAY ───────────────────────────────────────────────────
  {
    title: "Linzensoep met brood",
    category: "ALL_VEGGIE_DAY",
    source: "eigen",
    properties: ["gezond", "opwarmbaar"],
    status: "FOUND",
    instructions: [
      "Fruit ui, wortel en prei aan.",
      "Voeg linzen en groentebouillon toe, laat 25 minuten koken.",
      "Serveer met brood.",
    ],
    ingredients: [
      { ingredient: "Bruine linzen", quantity: 300, unit: "GRAM" },
      { ingredient: "Wortel", quantity: 3, unit: "PIECE" },
      { ingredient: "Prei", quantity: 1, unit: "PIECE" },
      { ingredient: "Ui", quantity: 1, unit: "PIECE" },
      { ingredient: "Groentebouillon", quantity: 1000, unit: "ML" },
      { ingredient: "Brood", quantity: 1, unit: "PIECE" },
    ],
    variants: [{ variantType: "REHEATABLE", contextFit: ["gezond", "opwarmbaar"] }],
  },
  {
    title: "Groentecurry met rijst",
    category: "ALL_VEGGIE_DAY",
    source: "eigen",
    properties: ["gezond", "opwarmbaar"],
    status: "PROVEN",
    instructions: [
      "Fruit currypasta kort aan, voeg kokosmelk toe.",
      "Voeg bloemkool, wortel en spinazie toe en laat gaar sudderen.",
      "Serveer met rijst.",
    ],
    ingredients: [
      { ingredient: "Rijst", quantity: 400, unit: "GRAM" },
      { ingredient: "Bloemkool", quantity: 300, unit: "GRAM" },
      { ingredient: "Wortel", quantity: 2, unit: "PIECE" },
      { ingredient: "Spinazie", quantity: 150, unit: "GRAM" },
      { ingredient: "Currypasta", quantity: 60, unit: "GRAM" },
      { ingredient: "Kokosmelk", quantity: 400, unit: "ML" },
    ],
    variants: [{ variantType: "REHEATABLE", contextFit: ["gezond", "opwarmbaar"] }],
  },
  {
    title: "Shakshuka",
    category: "ALL_VEGGIE_DAY",
    source: "eigen",
    properties: ["gezellig_samen", "weekend"],
    status: "FOUND",
    instructions: [
      "Stoof paprika en ui in tomatenblokjes met paprikapoeder.",
      "Maak kuiltjes en breek er eieren in, laat gaar stoven.",
      "Serveer met brood.",
    ],
    ingredients: [
      { ingredient: "Tomatenblokjes (blik)", quantity: 800, unit: "GRAM" },
      { ingredient: "Paprika", quantity: 2, unit: "PIECE" },
      { ingredient: "Ui", quantity: 1, unit: "PIECE" },
      { ingredient: "Ei", quantity: 6, unit: "PIECE" },
      { ingredient: "Feta", quantity: 100, unit: "GRAM" },
      { ingredient: "Paprikapoeder", quantity: 10, unit: "GRAM" },
      { ingredient: "Brood", quantity: 1, unit: "PIECE" },
    ],
    variants: [{ variantType: "FRESH", contextFit: ["weekend", "gezellig_samen"] }],
  },
  {
    title: "Caprese ovenschotel",
    category: "ALL_VEGGIE_DAY",
    source: "eigen",
    properties: ["vegetarisch", "kindvriendelijk"],
    status: "FOUND",
    instructions: [
      "Laag aardappelen, tomaat en mozzarella in een ovenschaal.",
      "Besprenkel met olijfolie en balsamicoazijn, 30 minuten in de oven.",
    ],
    ingredients: [
      { ingredient: "Aardappelen", quantity: 600, unit: "GRAM" },
      { ingredient: "Tomaat", quantity: 4, unit: "PIECE" },
      { ingredient: "Mozzarella", quantity: 250, unit: "GRAM" },
      { ingredient: "Olijfolie", quantity: 30, unit: "ML" },
      { ingredient: "Balsamicoazijn", quantity: 20, unit: "ML" },
    ],
    variants: [{ variantType: "FRESH", contextFit: ["weekend", "kindvriendelijk"] }],
  },
  {
    title: "Bonenchili met tortilla",
    category: "ALL_VEGGIE_DAY",
    source: "eigen",
    properties: ["opwarmbaar", "gezond"],
    status: "FOUND",
    instructions: [
      "Fruit ui en paprika, voeg kikkererwten en tomatenblokjes toe.",
      "Laat inkoken en serveer met tortillawraps.",
    ],
    ingredients: [
      { ingredient: "Kikkererwten (blik)", quantity: 400, unit: "GRAM" },
      { ingredient: "Tomatenblokjes (blik)", quantity: 800, unit: "GRAM" },
      { ingredient: "Paprika", quantity: 2, unit: "PIECE" },
      { ingredient: "Ui", quantity: 1, unit: "PIECE" },
      { ingredient: "Tortillawraps", quantity: 8, unit: "PIECE" },
      { ingredient: "Komijnpoeder", quantity: 5, unit: "GRAM" },
    ],
    variants: [{ variantType: "REHEATABLE", contextFit: ["drukke_dag", "opwarmbaar"] }],
  },
  {
    title: "Griekse salade met couscous",
    category: "ALL_VEGGIE_DAY",
    source: "eigen",
    properties: ["gezond", "licht"],
    status: "FOUND",
    instructions: [
      "Kook de couscous volgens verpakking.",
      "Meng met komkommer, tomaat, feta en olijfolie.",
    ],
    ingredients: [
      { ingredient: "Couscous", quantity: 300, unit: "GRAM" },
      { ingredient: "Komkommer", quantity: 1, unit: "PIECE" },
      { ingredient: "Tomaat", quantity: 3, unit: "PIECE" },
      { ingredient: "Feta", quantity: 150, unit: "GRAM" },
      { ingredient: "Olijfolie", quantity: 40, unit: "ML" },
    ],
    variants: [{ variantType: "FRESH", contextFit: ["gezond", "snel"] }],
  },

  // ── QUICK_AND_EASY ───────────────────────────────────────────────────
  {
    title: "Schnitzel met groenten",
    category: "QUICK_AND_EASY",
    source: "eigen",
    properties: ["snel", "kindvriendelijk"],
    status: "SAFE_CHOICE",
    instructions: [
      "Bak de schnitzels goudbruin en gaar.",
      "Stoom de sperziebonen.",
      "Serveer met aardappelen.",
    ],
    ingredients: [
      { ingredient: "Schnitzel", quantity: 4, unit: "PIECE" },
      { ingredient: "Sperziebonen", quantity: 400, unit: "GRAM" },
      { ingredient: "Aardappelen", quantity: 800, unit: "GRAM" },
      { ingredient: "Boter", quantity: 20, unit: "GRAM" },
    ],
    variants: [{ variantType: "FAST", contextFit: ["drukke_dag", "kindvriendelijk"] }],
  },
  {
    title: "Vissticks met aardappelpuree",
    category: "QUICK_AND_EASY",
    source: "eigen",
    properties: ["snel", "kindvriendelijk"],
    status: "PROVEN",
    instructions: [
      "Bak de vissticks volgens verpakking.",
      "Kook en stamp de aardappelen met boter en melk tot puree.",
    ],
    ingredients: [
      { ingredient: "Vissticks", quantity: 12, unit: "PIECE" },
      { ingredient: "Aardappelen", quantity: 800, unit: "GRAM" },
      { ingredient: "Boter", quantity: 30, unit: "GRAM" },
      { ingredient: "Melk", quantity: 100, unit: "ML" },
      { ingredient: "Sperziebonen", quantity: 300, unit: "GRAM" },
    ],
    variants: [{ variantType: "KID_FRIENDLY", contextFit: ["kindvriendelijk", "snel"] }],
  },
  {
    title: "Omelet met groenten en kaas",
    category: "QUICK_AND_EASY",
    source: "eigen",
    properties: ["snel", "vegetarisch"],
    status: "FOUND",
    instructions: [
      "Bak paprika en champignons kort aan.",
      "Voeg losgeklopt ei toe en laat stollen, bestrooi met kaas.",
    ],
    ingredients: [
      { ingredient: "Ei", quantity: 8, unit: "PIECE" },
      { ingredient: "Paprika", quantity: 1, unit: "PIECE" },
      { ingredient: "Champignons", quantity: 200, unit: "GRAM" },
      { ingredient: "Geraspte kaas", quantity: 100, unit: "GRAM" },
      { ingredient: "Brood", quantity: 1, unit: "PIECE" },
    ],
    variants: [{ variantType: "FAST", contextFit: ["drukke_dag", "snel"] }],
  },
  {
    title: "Tomatensoep met tosti",
    category: "QUICK_AND_EASY",
    source: "eigen",
    properties: ["snel", "kindvriendelijk", "licht"],
    status: "SAFE_CHOICE",
    instructions: [
      "Verwarm de tomatensoep.",
      "Bak tosti's met kaas.",
    ],
    ingredients: [
      { ingredient: "Tomatensoep (pak)", quantity: 1000, unit: "ML" },
      { ingredient: "Brood", quantity: 2, unit: "PIECE" },
      { ingredient: "Geraspte kaas", quantity: 150, unit: "GRAM" },
      { ingredient: "Boter", quantity: 20, unit: "GRAM" },
    ],
    variants: [{ variantType: "FAST", contextFit: ["drukke_dag", "licht", "kindvriendelijk"] }],
  },
  {
    title: "Kipfilet met sperziebonen en aardappelen",
    category: "QUICK_AND_EASY",
    source: "eigen",
    properties: ["snel", "gezond"],
    status: "PROVEN",
    instructions: [
      "Bak de kipfilet gaar met wat boter.",
      "Kook sperziebonen en aardappelen apart gaar.",
    ],
    ingredients: [
      { ingredient: "Kipfilet", quantity: 500, unit: "GRAM" },
      { ingredient: "Sperziebonen", quantity: 400, unit: "GRAM" },
      { ingredient: "Aardappelen", quantity: 800, unit: "GRAM" },
      { ingredient: "Boter", quantity: 20, unit: "GRAM" },
    ],
    variants: [{ variantType: "FAST", contextFit: ["drukke_dag", "gezond"] }],
  },
  {
    title: "Kipworst met bloemkool uit de oven",
    category: "QUICK_AND_EASY",
    source: "eigen",
    properties: ["snel", "gezond"],
    status: "FOUND",
    instructions: [
      "Meng bloemkoolroosjes met olijfolie en paprikapoeder, rooster in de oven.",
      "Bak de kipworst mee de laatste 15 minuten.",
    ],
    ingredients: [
      { ingredient: "Kipworst", quantity: 4, unit: "PIECE" },
      { ingredient: "Bloemkool", quantity: 500, unit: "GRAM" },
      { ingredient: "Olijfolie", quantity: 30, unit: "ML" },
      { ingredient: "Paprikapoeder", quantity: 5, unit: "GRAM" },
    ],
    variants: [{ variantType: "FAST", contextFit: ["drukke_dag", "gezond"] }],
  },

  // ── COMFORT_FOOD ─────────────────────────────────────────────────────
  {
    title: "Stamppot boerenkool met worst",
    category: "COMFORT_FOOD",
    source: "eigen",
    properties: ["opwarmbaar", "winter", "comfortfood"],
    status: "PROVEN",
    instructions: [
      "Kook aardappelen en boerenkool samen gaar.",
      "Stamp met melk en boter, serveer met gebakken rookworst.",
    ],
    ingredients: [
      { ingredient: "Aardappelen", quantity: 1000, unit: "GRAM" },
      { ingredient: "Boerenkool (voorgesneden)", quantity: 500, unit: "GRAM" },
      { ingredient: "Rookworst", quantity: 2, unit: "PIECE" },
      { ingredient: "Melk", quantity: 150, unit: "ML" },
      { ingredient: "Boter", quantity: 30, unit: "GRAM" },
    ],
    variants: [{ variantType: "REHEATABLE", contextFit: ["winter", "opwarmbaar"] }],
  },
  {
    title: "Hachee met aardappelpuree",
    category: "COMFORT_FOOD",
    source: "eigen",
    properties: ["weekend", "opwarmbaar", "comfortfood"],
    status: "FOUND",
    instructions: [
      "Bak runderlappen en ui aan, voeg runderbouillon toe.",
      "Laat minimaal 1,5 uur zachtjes stoven.",
      "Serveer met aardappelpuree.",
    ],
    ingredients: [
      { ingredient: "Runderlappen", quantity: 600, unit: "GRAM" },
      { ingredient: "Ui", quantity: 4, unit: "PIECE" },
      { ingredient: "Runderbouillon", quantity: 400, unit: "ML" },
      { ingredient: "Aardappelen", quantity: 800, unit: "GRAM" },
      { ingredient: "Boter", quantity: 30, unit: "GRAM" },
      { ingredient: "Melk", quantity: 100, unit: "ML" },
    ],
    variants: [{ variantType: "REHEATABLE", contextFit: ["weekend", "opwarmbaar"] }],
  },
  {
    title: "Macaroni met kaassaus",
    category: "COMFORT_FOOD",
    source: "eigen",
    properties: ["kindvriendelijk", "comfortfood"],
    status: "SAFE_CHOICE",
    instructions: [
      "Kook de macaroni beetgaar.",
      "Maak een roux van boter en bloem, voeg melk en kaas toe tot een gladde saus.",
      "Meng door de macaroni.",
    ],
    ingredients: [
      { ingredient: "Pasta", quantity: 400, unit: "GRAM" },
      { ingredient: "Boter", quantity: 40, unit: "GRAM" },
      { ingredient: "Bloem", quantity: 40, unit: "GRAM" },
      { ingredient: "Melk", quantity: 500, unit: "ML" },
      { ingredient: "Geraspte kaas", quantity: 200, unit: "GRAM" },
    ],
    variants: [{ variantType: "KID_FRIENDLY", contextFit: ["kindvriendelijk", "comfortfood"] }],
  },
  {
    title: "Ovenschotel met kip en groenten",
    category: "COMFORT_FOOD",
    source: "eigen",
    properties: ["opwarmbaar", "vertrouwd"],
    status: "SAFE_CHOICE",
    instructions: [
      "Meng kipfilet, aardappelen, courgette en paprika in een ovenschaal met olijfolie.",
      "35 minuten op 200°C, laatste 10 minuten met kaas erover.",
    ],
    ingredients: [
      { ingredient: "Kipfilet", quantity: 500, unit: "GRAM" },
      { ingredient: "Aardappelen", quantity: 600, unit: "GRAM" },
      { ingredient: "Courgette", quantity: 2, unit: "PIECE" },
      { ingredient: "Paprika", quantity: 2, unit: "PIECE" },
      { ingredient: "Olijfolie", quantity: 30, unit: "ML" },
      { ingredient: "Geraspte kaas", quantity: 100, unit: "GRAM" },
    ],
    variants: [{ variantType: "REHEATABLE", contextFit: ["drukke_dag", "vertrouwd", "opwarmbaar"] }],
  },
  {
    title: "Zelfgemaakte burgers met zoete aardappel",
    category: "COMFORT_FOOD",
    source: "eigen",
    properties: ["weekend", "gezellig_samen"],
    status: "PROVEN",
    instructions: [
      "Snijd de zoete aardappel in partjes en rooster in de oven.",
      "Bak de hamburgers gaar en serveer op het broodje met sla en tomaat.",
    ],
    ingredients: [
      { ingredient: "Hamburgers (rund)", quantity: 4, unit: "PIECE" },
      { ingredient: "Broodjes (burger)", quantity: 4, unit: "PIECE" },
      { ingredient: "Zoete aardappel", quantity: 600, unit: "GRAM" },
      { ingredient: "Sla", quantity: 100, unit: "GRAM" },
      { ingredient: "Tomaat", quantity: 2, unit: "PIECE" },
      { ingredient: "Olijfolie", quantity: 30, unit: "ML" },
    ],
    variants: [{ variantType: "FRESH", contextFit: ["weekend", "gezellig_samen"] }],
  },

  // ── AIRFRYER ─────────────────────────────────────────────────────────
  {
    title: "Airfryer kipdijfilet met groenten",
    category: "AIRFRYER",
    source: "eigen",
    properties: ["snel", "airfryer", "gezond"],
    status: "PROVEN",
    instructions: [
      "Kruid kipdijfilet met paprikapoeder.",
      "20 minuten in de airfryer op 190°C, groenten de laatste 12 minuten erbij.",
    ],
    ingredients: [
      { ingredient: "Kipdijfilet", quantity: 500, unit: "GRAM" },
      { ingredient: "Courgette", quantity: 2, unit: "PIECE" },
      { ingredient: "Paprika", quantity: 2, unit: "PIECE" },
      { ingredient: "Olijfolie", quantity: 20, unit: "ML" },
      { ingredient: "Paprikapoeder", quantity: 5, unit: "GRAM" },
    ],
    variants: [{ variantType: "FAST", contextFit: ["drukke_dag", "airfryer", "snel"] }],
  },
  {
    title: "Airfryer zalmfilet met broccoli",
    category: "AIRFRYER",
    source: "eigen",
    properties: ["snel", "airfryer", "gezond"],
    status: "FOUND",
    instructions: [
      "Kruid zalmfilet met citroen en peper.",
      "12 minuten in de airfryer op 180°C, broccoli de laatste 8 minuten erbij.",
    ],
    ingredients: [
      { ingredient: "Zalmfilet", quantity: 4, unit: "PIECE" },
      { ingredient: "Broccoli", quantity: 400, unit: "GRAM" },
      { ingredient: "Citroen", quantity: 1, unit: "PIECE" },
      { ingredient: "Olijfolie", quantity: 15, unit: "ML" },
    ],
    variants: [{ variantType: "FAST", contextFit: ["drukke_dag", "airfryer", "gezond"] }],
  },
  {
    title: "Airfryer frietjes met schnitzel",
    category: "AIRFRYER",
    source: "eigen",
    properties: ["snel", "airfryer", "kindvriendelijk"],
    status: "PROVEN",
    instructions: [
      "Airfryer de frietjes 18 minuten op 180°C.",
      "Bak de schnitzels in de pan of laatste 10 minuten mee in de airfryer.",
    ],
    ingredients: [
      { ingredient: "Aardappelen", quantity: 800, unit: "GRAM" },
      { ingredient: "Schnitzel", quantity: 4, unit: "PIECE" },
      { ingredient: "Olijfolie", quantity: 20, unit: "ML" },
      { ingredient: "Sperziebonen", quantity: 300, unit: "GRAM" },
    ],
    variants: [{ variantType: "KID_FRIENDLY", contextFit: ["kindvriendelijk", "airfryer"] }],
  },
  {
    title: "Airfryer groentespiesjes met kip",
    category: "AIRFRYER",
    source: "eigen",
    properties: ["snel", "airfryer", "weekend"],
    status: "FOUND",
    instructions: [
      "Rijg kip, paprika en courgette aan spiesjes.",
      "15 minuten in de airfryer op 190°C, halverwege omdraaien.",
    ],
    ingredients: [
      { ingredient: "Kipdijfilet", quantity: 500, unit: "GRAM" },
      { ingredient: "Paprika", quantity: 2, unit: "PIECE" },
      { ingredient: "Courgette", quantity: 2, unit: "PIECE" },
      { ingredient: "Rode ui", quantity: 1, unit: "PIECE" },
      { ingredient: "Olijfolie", quantity: 20, unit: "ML" },
      { ingredient: "Couscous", quantity: 300, unit: "GRAM" },
    ],
    variants: [{ variantType: "FRESH", contextFit: ["weekend", "airfryer", "gezellig_samen"] }],
  },

  // ── OTHER ────────────────────────────────────────────────────────────
  {
    title: "Zalm met citroen en groenten",
    category: "OTHER",
    source: "eigen",
    properties: ["gezond", "licht"],
    status: "PROVEN",
    instructions: [
      "Bak de zalmfilet met citroen in de pan.",
      "Stoom broccoli en wortel als bijgerecht.",
    ],
    ingredients: [
      { ingredient: "Zalmfilet", quantity: 4, unit: "PIECE" },
      { ingredient: "Broccoli", quantity: 300, unit: "GRAM" },
      { ingredient: "Wortel", quantity: 3, unit: "PIECE" },
      { ingredient: "Citroen", quantity: 1, unit: "PIECE" },
      { ingredient: "Boter", quantity: 20, unit: "GRAM" },
    ],
    variants: [{ variantType: "FRESH", contextFit: ["gezond", "licht"] }],
  },
  {
    title: "Griekse salade met kip",
    category: "OTHER",
    source: "eigen",
    properties: ["gezond", "licht", "snel"],
    status: "FOUND",
    instructions: [
      "Bak kipfilet met wat olijfolie en kruiden.",
      "Meng met komkommer, tomaat, feta en olijven.",
    ],
    ingredients: [
      { ingredient: "Kipfilet", quantity: 500, unit: "GRAM" },
      { ingredient: "Komkommer", quantity: 1, unit: "PIECE" },
      { ingredient: "Tomaat", quantity: 3, unit: "PIECE" },
      { ingredient: "Feta", quantity: 150, unit: "GRAM" },
      { ingredient: "Olijfolie", quantity: 30, unit: "ML" },
    ],
    variants: [{ variantType: "FRESH", contextFit: ["gezond", "snel"] }],
  },
  {
    title: "Vispakketje met groenten uit de oven",
    category: "OTHER",
    source: "eigen",
    properties: ["gezond", "makkelijk_opruimen"],
    status: "FOUND",
    instructions: [
      "Verpak witvisfilet met courgette, tomaat en citroen in bakpapier.",
      "20 minuten op 200°C in de oven.",
    ],
    ingredients: [
      { ingredient: "Witvisfilet", quantity: 4, unit: "PIECE" },
      { ingredient: "Courgette", quantity: 2, unit: "PIECE" },
      { ingredient: "Tomaat", quantity: 3, unit: "PIECE" },
      { ingredient: "Citroen", quantity: 1, unit: "PIECE" },
      { ingredient: "Olijfolie", quantity: 20, unit: "ML" },
    ],
    variants: [{ variantType: "FRESH", contextFit: ["gezond", "makkelijk_opruimen"] }],
  },
  {
    title: "Aubergine ovenschotel met tomaat en mozzarella",
    category: "OTHER",
    source: "eigen",
    properties: ["vegetarisch", "weekend"],
    status: "FOUND",
    instructions: [
      "Snijd aubergine in plakken en bak kort aan.",
      "Laag met tomatenblokjes en mozzarella, 30 minuten in de oven.",
    ],
    ingredients: [
      { ingredient: "Aubergine", quantity: 2, unit: "PIECE" },
      { ingredient: "Tomatenblokjes (blik)", quantity: 800, unit: "GRAM" },
      { ingredient: "Mozzarella", quantity: 250, unit: "GRAM" },
      { ingredient: "Olijfolie", quantity: 30, unit: "ML" },
      { ingredient: "Knoflook", quantity: 2, unit: "PIECE" },
    ],
    variants: [{ variantType: "FRESH", contextFit: ["weekend", "vegetarisch"] }],
  },
];
