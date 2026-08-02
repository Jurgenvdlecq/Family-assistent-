/**
 * Vertaalt veelvoorkomende Engelse ingrediëntnamen naar het Nederlands, met
 * een vast woordenboek — bewust geen taalmodel (kosten/afhankelijkheid,
 * expliciete productkeuze). Dekt daarom alleen een vaste lijst gangbare
 * woorden, geen volledige zinnen: onbekende woorden blijven onvertaald
 * staan. Titel en bereidingswijze worden hier bewust niet aangeraakt — een
 * woordenboek op woordniveau geeft bij lopende zinnen al snel kromme of
 * grammaticaal onjuiste tekst, wat erger is dan gewoon Engels laten staan.
 */

// Meerdere woorden eerst (langste/specifiekste match wint), losse woorden
// erna — zodat "chicken breast" niet eerst als los "chicken" wordt geraakt.
const PHRASE_TRANSLATIONS: Array<[RegExp, string]> = [
  [/\bchicken breasts?\b/gi, "kipfilet"],
  [/\bchicken thighs?\b/gi, "kipdijfilet"],
  [/\bchicken drumsticks?\b/gi, "kippendrumsticks"],
  [/\bground beef\b/gi, "rundergehakt"],
  [/\bground pork\b/gi, "varkensgehakt"],
  [/\bcoconut milk\b/gi, "kokosmelk"],
  [/\bgreen curry paste\b/gi, "groene currypasta"],
  [/\bred curry paste\b/gi, "rode currypasta"],
  [/\byellow curry paste\b/gi, "gele currypasta"],
  [/\bfish sauce\b/gi, "vissaus"],
  [/\bsoy sauce\b/gi, "sojasaus"],
  [/\boyster sauce\b/gi, "oestersaus"],
  [/\bolive oil\b/gi, "olijfolie"],
  [/\bvegetable oil\b/gi, "plantaardige olie"],
  [/\bsesame oil\b/gi, "sesamolie"],
  [/\bgreen beans?\b/gi, "sperziebonen"],
  [/\bbell peppers?\b/gi, "paprika"],
  [/\bcherry tomatoes?\b/gi, "cherrytomaten"],
  [/\bsweet potato(es)?\b/gi, "zoete aardappel"],
  [/\bbrown sugar\b/gi, "bruine suiker"],
  [/\bgarlic cloves?\b/gi, "teentjes knoflook"],
  [/\bspring onions?\b/gi, "lente-ui"],
  [/\bgreen onions?\b/gi, "lente-ui"],
  [/\bbay leaf|bay leaves\b/gi, "laurierblad"],
  [/\bchicken stock|chicken broth\b/gi, "kippenbouillon"],
  [/\bvegetable stock|vegetable broth\b/gi, "groentebouillon"],
  [/\bheavy cream\b/gi, "slagroom"],
  [/\bsour cream\b/gi, "zure room"],
  [/\bcream cheese\b/gi, "roomkaas"],
  [/\bpeanut butter\b/gi, "pindakaas"],
  [/\bbread crumbs?\b/gi, "paneermeel"],
];

const WORD_TRANSLATIONS: Record<string, string> = {
  chicken: "kip",
  beef: "rundvlees",
  pork: "varkensvlees",
  bacon: "spek",
  sausage: "worst",
  fish: "vis",
  salmon: "zalm",
  tuna: "tonijn",
  cod: "kabeljauw",
  shrimp: "garnalen",
  shrimps: "garnalen",
  prawns: "garnalen",
  egg: "ei",
  eggs: "eieren",
  milk: "melk",
  butter: "boter",
  margarine: "margarine",
  cheese: "kaas",
  cream: "room",
  yogurt: "yoghurt",
  yoghurt: "yoghurt",
  rice: "rijst",
  pasta: "pasta",
  spaghetti: "spaghetti",
  noodles: "noedels",
  bread: "brood",
  flour: "bloem",
  cornstarch: "maizena",
  cornflour: "maizena",
  sugar: "suiker",
  honey: "honing",
  salt: "zout",
  pepper: "peper",
  onion: "ui",
  onions: "uien",
  garlic: "knoflook",
  ginger: "gember",
  tomato: "tomaat",
  tomatoes: "tomaten",
  potato: "aardappel",
  potatoes: "aardappelen",
  carrot: "wortel",
  carrots: "wortelen",
  broccoli: "broccoli",
  cauliflower: "bloemkool",
  spinach: "spinazie",
  lettuce: "sla",
  cucumber: "komkommer",
  celery: "bleekselderij",
  lemon: "citroen",
  lime: "limoen",
  orange: "sinaasappel",
  apple: "appel",
  banana: "banaan",
  cilantro: "koriander",
  coriander: "koriander",
  basil: "basilicum",
  parsley: "peterselie",
  mint: "munt",
  thyme: "tijm",
  rosemary: "rozemarijn",
  oregano: "oregano",
  water: "water",
  oil: "olie",
  vinegar: "azijn",
  mushroom: "champignon",
  mushrooms: "champignons",
  cabbage: "kool",
  zucchini: "courgette",
  courgette: "courgette",
  eggplant: "aubergine",
  aubergine: "aubergine",
  cumin: "komijn",
  paprika: "paprikapoeder",
  chili: "chili",
  chilli: "chili",
  chilies: "chilipepers",
  chillies: "chilipepers",
  cinnamon: "kaneel",
  nutmeg: "nootmuskaat",
  vanilla: "vanille",
  cornmeal: "maismeel",
  beans: "bonen",
  lentils: "linzen",
  chickpeas: "kikkererwten",
  tofu: "tofu",
  walnuts: "walnoten",
  almonds: "amandelen",
  peanuts: "pinda's",
  raisins: "rozijnen",
};

/**
 * Vertaalt herkenbare Engelse ingrediëntwoorden binnen één regel naar het
 * Nederlands. Onherkende woorden (bijv. "diced", "to taste", merknamen)
 * blijven ongewijzigd staan — geen gok, alleen wat zeker herkend wordt.
 * Cijfers en eenheden (cup, tbsp, oz, ...) komen niet in dit woordenboek
 * voor en blijven dus vanzelf ongemoeid.
 */
export function translateIngredientTextToDutch(line: string): string {
  let translated = line;
  for (const [pattern, replacement] of PHRASE_TRANSLATIONS) {
    translated = translated.replace(pattern, replacement);
  }
  translated = translated.replace(/[a-zA-Z]+/g, (word) => WORD_TRANSLATIONS[word.toLowerCase()] ?? word);
  return translated;
}
