// Curated v1-productcatalogus: één (soms twee) concrete producten per
// ingrediënt uit seed-data.ts. Geen live Picnic-koppeling (zie risico R1
// in het ontwerpdocument) — dit zijn representatieve placeholderproducten
// zodat de matching- en Controle-flow (fase 2) echt te bouwen en te
// testen is. Ingrediënten met twee kandidaten simuleren een twijfelgeval:
// zonder eerdere productkeuze (Preference) weet de assistent nog niet
// welke merk/verpakking het gezin vertrouwt.

export interface ProductCandidateSeed {
  name: string;
  brand?: string;
  packageSize?: string;
  price?: number;
}

export interface ProductMappingSeed {
  ingredient: string; // verwijst naar INGREDIENTS[].name in seed-data.ts
  candidates: ProductCandidateSeed[]; // 1 = vertrouwde match, 2 = twijfelgeval
}

export const PRODUCTS: ProductMappingSeed[] = [
  // Vlees
  { ingredient: "Gehakt (rund)", candidates: [{ name: "Rundergehakt", brand: "Boerenhof", packageSize: "500 gram", price: 4.99 }] },
  {
    ingredient: "Kipfilet",
    candidates: [
      { name: "Kipfilet naturel", brand: "Boerenhof", packageSize: "500 gram verpakking", price: 5.49 },
      { name: "Kipfilet scharrel", brand: "Vrije Hoeve", packageSize: "500 gram verpakking", price: 6.99 },
    ],
  },
  { ingredient: "Kipdijfilet", candidates: [{ name: "Kipdijfilet zonder vel", brand: "Boerenhof", packageSize: "500 gram", price: 5.29 }] },
  { ingredient: "Spekblokjes", candidates: [{ name: "Spekblokjes", brand: "Boerenhof", packageSize: "150 gram", price: 2.29 }] },
  { ingredient: "Schnitzel", candidates: [{ name: "Schnitzel naturel", brand: "Boerenhof", packageSize: "2 stuks", price: 3.99 }] },
  { ingredient: "Runderlappen", candidates: [{ name: "Runderlappen", brand: "Boerenhof", packageSize: "500 gram", price: 6.49 }] },
  { ingredient: "Rookworst", candidates: [{ name: "Rookworst", brand: "Boerenhof", packageSize: "1 stuk, 300 gram", price: 2.79 }] },
  {
    ingredient: "Hamburgers (rund)",
    candidates: [
      { name: "Runderburgers", brand: "Boerenhof", packageSize: "4 stuks", price: 4.49 },
      { name: "Runderburgers grillworst-stijl", brand: "Vrije Hoeve", packageSize: "4 stuks", price: 5.99 },
    ],
  },
  { ingredient: "Kipworst", candidates: [{ name: "Kipworst", brand: "Boerenhof", packageSize: "4 stuks", price: 3.49 }] },
  { ingredient: "Pulled chicken", candidates: [{ name: "Pulled chicken bbq", brand: "Vershof", packageSize: "300 gram", price: 4.99 }] },
  { ingredient: "Kipshoarma", candidates: [{ name: "Kipshoarma", brand: "Boerenhof", packageSize: "400 gram", price: 4.79 }] },
  { ingredient: "Kipdrumsticks", candidates: [{ name: "Kipdrumsticks", brand: "Boerenhof", packageSize: "500 gram", price: 3.99 }] },

  // Vis
  { ingredient: "Zalmfilet", candidates: [{ name: "Zalmfilet", brand: "Vershof", packageSize: "4 stuks, 300 gram", price: 8.99 }] },
  { ingredient: "Vissticks", candidates: [{ name: "Vissticks", brand: "Vershof", packageSize: "20 stuks", price: 3.29 }] },
  { ingredient: "Witvisfilet", candidates: [{ name: "Witvisfilet (koolvis)", brand: "Vershof", packageSize: "4 stuks, 320 gram", price: 6.49 }] },

  // Zuivel & eieren
  { ingredient: "Geraspte kaas", candidates: [{ name: "Geraspte belegen kaas", brand: "Zuivelhoeve", packageSize: "200 gram", price: 2.99 }] },
  { ingredient: "Parmezaanse kaas", candidates: [{ name: "Parmezaanse kaas geraspt", brand: "Zuivelhoeve", packageSize: "100 gram", price: 2.49 }] },
  {
    ingredient: "Melk",
    candidates: [
      { name: "Halfvolle melk", brand: "Zuivelhoeve", packageSize: "1 liter", price: 1.19 },
      { name: "Halfvolle melk (weidemelk)", brand: "Melkveld", packageSize: "1 liter", price: 1.45 },
    ],
  },
  { ingredient: "Boter", candidates: [{ name: "Roomboter", brand: "Zuivelhoeve", packageSize: "250 gram", price: 2.79 }] },
  { ingredient: "Slagroom", candidates: [{ name: "Slagroom", brand: "Zuivelhoeve", packageSize: "200 ml", price: 1.59 }] },
  { ingredient: "Feta", candidates: [{ name: "Feta", brand: "Zuivelhoeve", packageSize: "200 gram", price: 2.99 }] },
  { ingredient: "Mozzarella", candidates: [{ name: "Mozzarella", brand: "Zuivelhoeve", packageSize: "125 gram", price: 1.19 }] },
  {
    ingredient: "Ei",
    candidates: [
      { name: "Scharreleieren", brand: "Boerenhof", packageSize: "10 stuks", price: 2.99 },
      { name: "Vrije-uitloopeieren", brand: "Vrije Hoeve", packageSize: "10 stuks", price: 3.49 },
    ],
  },
  { ingredient: "Griekse yoghurt", candidates: [{ name: "Griekse yoghurt", brand: "Zuivelhoeve", packageSize: "500 gram", price: 2.19 }] },

  // Groente
  {
    ingredient: "Ui",
    candidates: [
      { name: "Uien", brand: "Groenteland", packageSize: "1 kg net", price: 1.29 },
      { name: "Uien los", brand: "Groenteland", packageSize: "per stuk", price: 0.35 },
    ],
  },
  { ingredient: "Knoflook", candidates: [{ name: "Knoflook", brand: "Groenteland", packageSize: "3 bollen", price: 0.99 }] },
  { ingredient: "Wortel", candidates: [{ name: "Winterpeen", brand: "Groenteland", packageSize: "1 kg", price: 1.09 }] },
  { ingredient: "Paprika", candidates: [{ name: "Paprika rood", brand: "Groenteland", packageSize: "per stuk", price: 0.89 }] },
  { ingredient: "Courgette", candidates: [{ name: "Courgette", brand: "Groenteland", packageSize: "per stuk", price: 0.79 }] },
  { ingredient: "Broccoli", candidates: [{ name: "Broccoli", brand: "Groenteland", packageSize: "per stuk, ca. 350 gram", price: 1.39 }] },
  { ingredient: "Sperziebonen", candidates: [{ name: "Sperziebonen", brand: "Groenteland", packageSize: "300 gram", price: 1.99 }] },
  { ingredient: "Prei", candidates: [{ name: "Prei", brand: "Groenteland", packageSize: "per stuk", price: 0.99 }] },
  { ingredient: "Boerenkool (voorgesneden)", candidates: [{ name: "Boerenkool gesneden", brand: "Groenteland", packageSize: "300 gram", price: 1.49 }] },
  { ingredient: "Cherrytomaatjes", candidates: [{ name: "Cherrytomaten", brand: "Groenteland", packageSize: "250 gram", price: 1.79 }] },
  { ingredient: "Tomaat", candidates: [{ name: "Trostomaten", brand: "Groenteland", packageSize: "per stuk", price: 0.45 }] },
  { ingredient: "Komkommer", candidates: [{ name: "Komkommer", brand: "Groenteland", packageSize: "per stuk", price: 0.89 }] },
  { ingredient: "Sla", candidates: [{ name: "Gemengde sla", brand: "Groenteland", packageSize: "150 gram", price: 1.69 }] },
  { ingredient: "Spinazie", candidates: [{ name: "Verse spinazie", brand: "Groenteland", packageSize: "300 gram", price: 1.89 }] },
  { ingredient: "Champignons", candidates: [{ name: "Champignons", brand: "Groenteland", packageSize: "250 gram", price: 1.29 }] },
  { ingredient: "Zoete aardappel", candidates: [{ name: "Zoete aardappel", brand: "Groenteland", packageSize: "per kilo", price: 2.29 }] },
  {
    ingredient: "Aardappelen",
    candidates: [
      { name: "Aardappelen (kruimig)", brand: "Groenteland", packageSize: "2 kg net", price: 2.49 },
      { name: "Aardappelen (vastkokend)", brand: "Groenteland", packageSize: "2 kg net", price: 2.59 },
    ],
  },
  { ingredient: "Rode kool", candidates: [{ name: "Rode kool gesneden", brand: "Groenteland", packageSize: "500 gram", price: 1.59 }] },
  { ingredient: "Bloemkool", candidates: [{ name: "Bloemkool", brand: "Groenteland", packageSize: "per stuk", price: 1.79 }] },
  { ingredient: "Aubergine", candidates: [{ name: "Aubergine", brand: "Groenteland", packageSize: "per stuk", price: 1.09 }] },
  { ingredient: "Rode ui", candidates: [{ name: "Rode uien", brand: "Groenteland", packageSize: "500 gram net", price: 1.19 }] },
  { ingredient: "Rode paprika", candidates: [{ name: "Paprika rood", brand: "Groenteland", packageSize: "per stuk", price: 0.89 }] },

  // Fruit
  { ingredient: "Citroen", candidates: [{ name: "Citroen", brand: "Groenteland", packageSize: "per stuk", price: 0.59 }] },
  { ingredient: "Avocado", candidates: [{ name: "Avocado", brand: "Groenteland", packageSize: "per stuk", price: 1.19 }] },

  // Granen / zetmeel
  { ingredient: "Pasta", candidates: [{ name: "Penne", brand: "Napoli", packageSize: "500 gram", price: 1.09 }] },
  { ingredient: "Rijst", candidates: [{ name: "Basmatirijst", brand: "Molenaar", packageSize: "1 kg", price: 2.49 }] },
  { ingredient: "Lasagnebladen", candidates: [{ name: "Lasagnebladen", brand: "Napoli", packageSize: "250 gram", price: 1.59 }] },
  { ingredient: "Tortillawraps", candidates: [{ name: "Tortillawraps", brand: "Molenaar", packageSize: "8 stuks", price: 1.99 }] },
  { ingredient: "Broodjes (burger)", candidates: [{ name: "Hamburgerbroodjes", brand: "Bakkerszoon", packageSize: "4 stuks", price: 1.79 }] },
  { ingredient: "Brood", candidates: [{ name: "Volkoren brood", brand: "Bakkerszoon", packageSize: "800 gram", price: 2.29 }] },
  { ingredient: "Couscous", candidates: [{ name: "Couscous", brand: "Molenaar", packageSize: "500 gram", price: 1.79 }] },

  // Peulvruchten
  { ingredient: "Kidneybonen (blik)", candidates: [{ name: "Kidneybonen", brand: "Groenteland", packageSize: "400 gram blik", price: 1.09 }] },
  { ingredient: "Bruine linzen", candidates: [{ name: "Bruine linzen", brand: "Molenaar", packageSize: "500 gram", price: 1.99 }] },
  { ingredient: "Kikkererwten (blik)", candidates: [{ name: "Kikkererwten", brand: "Groenteland", packageSize: "400 gram blik", price: 1.09 }] },
  { ingredient: "Zwarte bonen (blik)", candidates: [{ name: "Zwarte bonen", brand: "Groenteland", packageSize: "400 gram blik", price: 1.19 }] },

  // Voorraadkast
  {
    ingredient: "Tomatenblokjes (blik)",
    candidates: [
      { name: "Tomatenblokjes", brand: "Napoli", packageSize: "400 gram blik", price: 0.89 },
      { name: "Gepelde tomaten", brand: "Napoli", packageSize: "400 gram blik", price: 0.99 },
    ],
  },
  { ingredient: "Kokosmelk", candidates: [{ name: "Kokosmelk", brand: "Molenaar", packageSize: "400 ml", price: 1.49 }] },
  { ingredient: "Currypasta", candidates: [{ name: "Rode currypasta", brand: "Molenaar", packageSize: "100 gram", price: 2.29 }] },
  { ingredient: "Teriyakisaus", candidates: [{ name: "Teriyakisaus", brand: "Molenaar", packageSize: "250 ml", price: 2.49 }] },
  { ingredient: "Pesto", candidates: [{ name: "Pesto rosso", brand: "Napoli", packageSize: "190 gram", price: 2.19 }] },
  {
    ingredient: "Olijfolie",
    candidates: [
      { name: "Olijfolie", brand: "Napoli", packageSize: "500 ml", price: 3.99 },
      { name: "Olijfolie extra vierge", brand: "Napoli", packageSize: "500 ml", price: 5.49 },
    ],
  },
  { ingredient: "Sojasaus", candidates: [{ name: "Sojasaus", brand: "Molenaar", packageSize: "250 ml", price: 1.79 }] },
  { ingredient: "Kerriepoeder", candidates: [{ name: "Kerriepoeder", brand: "Molenaar", packageSize: "40 gram", price: 1.19 }] },
  { ingredient: "Groentebouillon", candidates: [{ name: "Groentebouillonblokjes", brand: "Molenaar", packageSize: "12 blokjes", price: 1.29 }] },
  { ingredient: "Runderbouillon", candidates: [{ name: "Runderbouillonblokjes", brand: "Molenaar", packageSize: "12 blokjes", price: 1.29 }] },
  { ingredient: "Pijnboompitten", candidates: [{ name: "Pijnboompitten", brand: "Molenaar", packageSize: "40 gram", price: 2.99 }] },
  { ingredient: "Bloem", candidates: [{ name: "Tarwebloem", brand: "Molenaar", packageSize: "1 kg", price: 0.99 }] },
  { ingredient: "Paneermeel", candidates: [{ name: "Paneermeel", brand: "Molenaar", packageSize: "400 gram", price: 1.19 }] },
  { ingredient: "Chilivlokken", candidates: [{ name: "Chilivlokken", brand: "Molenaar", packageSize: "35 gram", price: 1.39 }] },
  { ingredient: "Paprikapoeder", candidates: [{ name: "Paprikapoeder", brand: "Molenaar", packageSize: "40 gram", price: 1.09 }] },
  { ingredient: "Komijnpoeder", candidates: [{ name: "Komijnpoeder", brand: "Molenaar", packageSize: "35 gram", price: 1.09 }] },
  { ingredient: "Balsamicoazijn", candidates: [{ name: "Balsamicoazijn", brand: "Napoli", packageSize: "250 ml", price: 2.29 }] },
  { ingredient: "Tomatensoep (pak)", candidates: [{ name: "Tomatensoep", brand: "Molenaar", packageSize: "1 liter pak", price: 1.69 }] },
];
