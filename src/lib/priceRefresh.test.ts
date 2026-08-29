/**
 * Integratietest tegen een echte (lokale) Postgres: de dagelijkse
 * prijsverversing.
 *
 * De winkel zelf is een neppe provider. Dat is hier niet alleen praktisch
 * (api.ah.nl is vanuit deze omgeving onbereikbaar) maar ook juist: wat getest
 * moet worden is hoe de verversing zich gedraagt — welke ingrediënten ze
 * bevraagt, wat ze opslaat, en vooral wat ze doet als de winkel niet
 * meewerkt.
 */
import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "./prisma";
import { getPricedIngredients, refreshStorePrices } from "./pricing/refresh";
import { getStorePricesForIngredients } from "./pricing/storePrices";
import type { ProviderProduct, StorePriceProvider } from "@/domain/pricing/types";
import { storeSearchTerm } from "@/domain/pricing/storeMatch";
import { getCurrentWeekStart } from "./week";

function fakeProduct(name: string, price: number, packageSize = "1 l"): ProviderProduct {
  return {
    provider: "AH",
    externalRef: `nep-${name.toLowerCase().replace(/\W+/g, "-")}`,
    name,
    brand: "AH",
    packageSize,
    content: packageSize === "1 l" ? { amount: 1000, unit: "ML" } : null,
    price,
    wasPrice: null,
    unitPrice: null,
    promoType: "GEEN",
    promoLabel: null,
    promoUntil: null,
    gtin: null,
    labels: [],
    freeFromAllergens: [],
    imageId: null,
    url: null,
  };
}

function fakeProvider(behaviour: (term: string) => Promise<ProviderProduct[]>): StorePriceProvider {
  return {
    provider: "AH",
    label: "Albert Heijn (nep)",
    capabilities: { hasEan: false, hasAllergens: false, hasUnitPrice: false, canOrder: false, reliability: "api" },
    search: (term) => behaviour(term),
  };
}

/**
 * Alleen opruimen wat déze test heeft aangemaakt.
 *
 * Stond hier eerder als "alle AH-producten". Dat is te breed: de tests draaien
 * parallel tegen dezelfde database, dus dat wist ook de producten weg die een
 * ander testbestand op datzelfde moment aan het gebruiken was. De nepprovider
 * hierboven geeft elk product een `nep-`-voorvoegsel, en dat is precies de
 * afbakening die hier hoort.
 */
async function cleanupAhProducts() {
  const products = await prisma.product.findMany({
    where: { provider: "AH", externalRef: { startsWith: "nep-" } },
    select: { id: true },
  });
  const ids = products.map((product) => product.id);
  await prisma.priceObservation.deleteMany({ where: { productId: { in: ids } } });
  await prisma.product.deleteMany({ where: { id: { in: ids } } });
}

test("verversing: bevraagt alleen ingrediënten die we ook echt gebruiken", async () => {
  // Het hele assortiment ophalen zou veel verkeer zijn en niets toevoegen:
  // wat we nooit kopen hoeft geen prijs te hebben.
  const asked: string[] = [];
  try {
    await refreshStorePrices(
      fakeProvider(async (term) => {
        asked.push(term);
        return [];
      }),
      { limitIngredients: 5 }
    );

    // Vijf ingrediënten, en per ingrediënt hooguit twee zoekopdrachten: eerst
    // op ons eigen product, en pas als dat niets oplevert nog een keer op het
    // ingrediënt. Deze nepwinkel geeft altijd niets terug, dus hier valt elk
    // ingrediënt met een eigen product terug.
    assert.ok(asked.length >= 5 && asked.length <= 10, `onverwacht aantal zoekopdrachten: ${asked.length}`);

    // Er wordt gezocht met de opgeschoonde naam, niet met de ingrediëntnaam
    // zelf: die kan de naam van een andere winkel bevatten ("Picnic
    // Appelmoes"), en daar vindt Albert Heijn niets nuttigs op.
    const used = await prisma.ingredient.findMany({
      where: { OR: [{ recipeIngredients: { some: {} } }, { fixedGroceries: { some: {} } }] },
      select: { name: true, products: { where: { provider: "PICNIC" }, select: { name: true } } },
    });
    const usedTerms = new Set([
      ...used.map((ingredient) => storeSearchTerm(ingredient.name)),
      ...used.flatMap((ingredient) => ingredient.products.map((product) => storeSearchTerm(product.name))),
    ]);
    assert.ok(
      asked.every((term) => usedTerms.has(term)),
      "elke zoekterm hoort bij een ingrediënt of bij het product dat we daarvoor kopen"
    );
  } finally {
    await cleanupAhProducts();
  }
});

test("verversing: slaat de gevonden producten op met een prijswaarneming", async () => {
  try {
    const result = await refreshStorePrices(
      fakeProvider(async (term) => [fakeProduct(`AH ${term}`, 1.29)]),
      { limitIngredients: 3 }
    );

    assert.equal(result.ingredientsChecked, 3);
    assert.ok(result.productsStored > 0);
    assert.equal(result.errors.length, 0);

    // Even hard afgebakend als de opruiming hierboven: de testbestanden draaien
    // parallel tegen dezelfde database, en andere bestanden houden op datzelfde
    // moment ook AH-producten in leven. Een telling over álle AH-producten zou
    // daardoor wisselend uitvallen.
    const stored = await prisma.product.count({
      where: { provider: "AH", externalRef: { startsWith: "nep-" } },
    });
    assert.equal(stored, result.productsStored);
    const observations = await prisma.priceObservation.count({
      where: { product: { provider: "AH", externalRef: { startsWith: "nep-" } } },
    });
    assert.equal(observations, result.productsStored, "elk opgeslagen product heeft een waarneming");
  } finally {
    await cleanupAhProducts();
  }
});

test("verversing: een ingrediënt zonder passend product wordt geteld, niet stilzwijgend genegeerd", async () => {
  try {
    const result = await refreshStorePrices(
      // De winkel geeft wel iets terug, maar niets wat bij het ingrediënt past.
      fakeProvider(async () => [fakeProduct("Volstrekt iets anders", 9.99)]),
      { limitIngredients: 4 }
    );
    assert.equal(result.ingredientsWithoutMatch, 4);
    assert.equal(result.productsStored, 0);
  } finally {
    await cleanupAhProducts();
  }
});

test("verversing: tien fouten op rij is een storing en stopt de rest", async () => {
  // Doorgaan zou honderden mislukkende aanroepen betekenen; dan is de
  // koppeling stuk, niet het assortiment.
  let calls = 0;
  try {
    const result = await refreshStorePrices(
      fakeProvider(async () => {
        calls += 1;
        throw new Error("winkel onbereikbaar");
      }),
      { limitIngredients: 50 }
    );
    assert.equal(result.abortedAfter, 10);
    assert.equal(calls, 10, "er wordt niet doorgeramd na een duidelijke storing");
    assert.equal(result.productsStored, 0);
  } finally {
    await cleanupAhProducts();
  }
});

test("verversing: een enkele fout onderbreekt de rest niet", async () => {
  try {
    let first = true;
    const result = await refreshStorePrices(
      fakeProvider(async (term) => {
        if (first) {
          first = false;
          throw new Error("eenmalige hapering");
        }
        return [fakeProduct(`AH ${term}`, 1.0)];
      }),
      { limitIngredients: 4 }
    );
    assert.equal(result.errors.length, 1);
    assert.equal(result.abortedAfter, null);
    assert.ok(result.productsStored >= 3, "de overige ingrediënten zijn gewoon opgehaald");
  } finally {
    await cleanupAhProducts();
  }
});

test("winkelprijzen: de lijst leest alleen wat er is opgeslagen, en verzint geen nul", async () => {
  const ingredients = await prisma.ingredient.findMany({
    where: { OR: [{ recipeIngredients: { some: {} } }, { fixedGroceries: { some: {} } }] },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
    take: 3,
  });
  try {
    await refreshStorePrices(
      fakeProvider(async (term) =>
        term === storeSearchTerm(ingredients[0].name) ? [fakeProduct(`AH ${ingredients[0].name}`, 2.5)] : []
      ),
      { limitIngredients: 3 }
    );

    const prices = await getStorePricesForIngredients(
      ingredients.map((ingredient) => ingredient.id),
      ["AH"]
    );
    assert.equal(prices.get(ingredients[0].id)?.get("AH")?.price, 2.5);
    assert.equal(
      prices.has(ingredients[1].id),
      false,
      "een ingrediënt zonder waarneming hoort te ontbreken, niet nul te kosten"
    );
  } finally {
    await cleanupAhProducts();
  }
});

test("verversing: de ingrediënten van de lijst van déze week staan vooraan", async () => {
  // De knop pakt maar een deel van de lijst, dus dát deel moet wél gaan over
  // wat de gebruiker op dit moment voor zich heeft. Zonder afbakening op de
  // week verdringt de geschiedenis de lijst van nu — met vier oude weeklijsten
  // erbij zat er geen enkel ingrediënt van deze week in de eerste vijftien.
  const household = await prisma.household.create({
    data: { name: `Prioriteitstest ${Date.now()}` },
  });
  const weekStart = getCurrentWeekStart();
  const vorigeWeek = new Date(weekStart);
  vorigeWeek.setDate(vorigeWeek.getDate() - 7);

  // Alfabetisch achteraan, zodat alleen prioriteren ze naar voren kan halen.
  const nu = await prisma.ingredient.findMany({
    select: { id: true, name: true },
    orderBy: { name: "desc" },
    take: 3,
  });
  const oud = await prisma.ingredient.findMany({
    where: { id: { notIn: nu.map((ingredient) => ingredient.id) } },
    select: { id: true },
    orderBy: { name: "asc" },
    take: 20,
  });

  try {
    for (const [plan, ingredients] of [
      [weekStart, nu.map((ingredient) => ingredient.id)],
      [vorigeWeek, oud.map((ingredient) => ingredient.id)],
    ] as const) {
      const mealPlan = await prisma.mealPlan.create({
        data: { householdId: household.id, weekStart: plan },
      });
      await prisma.shoppingList.create({
        data: {
          mealPlanId: mealPlan.id,
          lines: {
            create: ingredients.map((ingredientId) => ({
              ingredientId,
              quantity: 1,
              unit: "PIECE" as const,
              source: "MANUAL" as const,
            })),
          },
        },
      });
    }

    const prioritised = await getPricedIngredients({
      prioritiseHouseholdId: household.id,
      weekStart,
    });
    const eersteVijftien = prioritised.slice(0, 15).map((ingredient) => ingredient.id);
    for (const ingredient of nu) {
      assert.ok(
        eersteVijftien.includes(ingredient.id),
        `${ingredient.name} van deze week hoort binnen de eerste vijftien te vallen`
      );
    }
  } finally {
    const plans = await prisma.mealPlan.findMany({ where: { householdId: household.id }, select: { id: true } });
    await prisma.shoppingListLine.deleteMany({
      where: { shoppingList: { mealPlanId: { in: plans.map((plan) => plan.id) } } },
    });
    await prisma.shoppingList.deleteMany({ where: { mealPlanId: { in: plans.map((plan) => plan.id) } } });
    await prisma.mealPlan.deleteMany({ where: { householdId: household.id } });
    await prisma.household.delete({ where: { id: household.id } });
  }
});

test("winkelprijzen: de link en de eenheidsprijs komen mee tot op het scherm", async () => {
  // De gebruiker moet zelf kunnen nakijken of "gelijkwaardig" ook klopt. Dat
  // werkt alleen als de link die de provider leest, de hele weg overleeft:
  // waarneming -> product -> wat de pagina terugleest.
  const ingredients = await prisma.ingredient.findMany({
    where: { OR: [{ recipeIngredients: { some: {} } }, { fixedGroceries: { some: {} } }] },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
    take: 1,
  });
  try {
    await refreshStorePrices(
      fakeProvider(async (term) =>
        term === storeSearchTerm(ingredients[0].name)
          ? [
              {
                ...fakeProduct(`AH ${ingredients[0].name}`, 2.5),
                url: "https://www.ah.nl/producten/product/wi100311",
                unitPrice: { amount: 0.0025, unit: "ML" },
              },
            ]
          : []
      ),
      { limitIngredients: 1 }
    );

    const price = (
      await getStorePricesForIngredients([ingredients[0].id], ["AH"])
    ).get(ingredients[0].id)?.get("AH");
    assert.equal(price?.productUrl, "https://www.ah.nl/producten/product/wi100311");
    assert.equal(price?.unitPrice, 0.0025);
    assert.equal(price?.unitPriceUnit, "ML");
  } finally {
    await cleanupAhProducts();
  }
});

test("verversing: zoekt op ons eigen product, en valt alleen bij nul resultaten terug op het ingrediënt", async () => {
  // Gebruikersmelding: "Alpro heeft AH zelfs exact dezelfde, gek dat ie deze
  // niet pakt." Er werd gezocht op de ingrediëntnaam, en die is soms alleen
  // een merk — dan krijg je van alles behalve het juiste.
  const ingredient = await prisma.ingredient.create({
    data: { name: `Merknaam ${Date.now()}`, unit: "GRAM", category: "OTHER" },
  });
  const recipe = await prisma.recipe.create({
    data: {
      title: `Zoekterm-testgerecht ${ingredient.id}`,
      category: "OTHER",
      ingredients: { create: [{ ingredientId: ingredient.id, quantity: 1, unit: "GRAM" }] },
    },
  });
  await prisma.product.create({
    data: {
      name: `${ingredient.name} mild en romig`,
      provider: "PICNIC",
      externalRef: `picnic-zoekterm-${ingredient.id}`,
      ingredientId: ingredient.id,
      lastSeenAvailable: new Date(),
    },
  });

  const asked: string[] = [];
  try {
    // Eerst: de winkel vindt ons product wél. Dan is één zoekopdracht genoeg.
    await refreshStorePrices(
      fakeProvider(async (term) => {
        asked.push(term);
        return [fakeProduct(`AH ${ingredient.name} mild en romig`, 2.5)];
      }),
      { limitIngredients: 200 }
    );
    const own = storeSearchTerm(`${ingredient.name} mild en romig`);
    assert.ok(asked.includes(own), `er hoort op ons eigen product gezocht te zijn (${own})`);
    assert.equal(
      asked.filter((term) => term === storeSearchTerm(ingredient.name)).length,
      0,
      "en dan niet óók nog op de ingrediëntnaam"
    );

    // Daarna: de winkel vindt niets. Dan pas de bredere zoekopdracht, want een
    // lege uitslag is erger dan een ruwere.
    asked.length = 0;
    await refreshStorePrices(
      fakeProvider(async (term) => {
        asked.push(term);
        return [];
      }),
      { limitIngredients: 200 }
    );
    assert.ok(asked.includes(own));
    assert.ok(asked.includes(storeSearchTerm(ingredient.name)), "nu wél teruggevallen");
  } finally {
    await cleanupAhProducts();
    await prisma.recipe.delete({ where: { id: recipe.id } });
    await prisma.product.deleteMany({ where: { ingredientId: ingredient.id } });
    await prisma.ingredient.delete({ where: { id: ingredient.id } });
  }
});

test("verversing: valt ook terug als de specifieke zoekopdracht wél iets teruggeeft, maar niets bruikbaars", async () => {
  // Een winkel geeft zelden helemaal niets terug; ze geeft iets terug dat er
  // niet bij hoort. Een controle op "leeg" zou dan nooit aanslaan, en dan
  // stonden we met lege handen terwijl het product er gewoon ligt.
  const ingredient = await prisma.ingredient.create({
    data: { name: `Merk ${Date.now()}`, unit: "GRAM", category: "OTHER" },
  });
  const recipe = await prisma.recipe.create({
    data: {
      title: `Terugval-testgerecht ${ingredient.id}`,
      category: "OTHER",
      ingredients: { create: [{ ingredientId: ingredient.id, quantity: 1, unit: "GRAM" }] },
    },
  });
  await prisma.product.create({
    data: {
      name: `${ingredient.name} speciaal`,
      provider: "PICNIC",
      externalRef: `picnic-terugval-${ingredient.id}`,
      ingredientId: ingredient.id,
      lastSeenAvailable: new Date(),
    },
  });

  try {
    const asked: string[] = [];
    const result = await refreshStorePrices(
      fakeProvider(async (term) => {
        asked.push(term);
        // De specifieke zoekopdracht levert wél resultaten op, maar niets dat
        // bij dit ingrediënt hoort. De bredere levert het juiste product.
        return term === storeSearchTerm(ingredient.name)
          ? [fakeProduct(`AH ${ingredient.name} gewoon`, 1.99)]
          : [fakeProduct("AH Iets heel anders", 9.99)];
      }),
      { limitIngredients: 200 }
    );

    assert.ok(asked.includes(storeSearchTerm(`${ingredient.name} speciaal`)), "eerst op ons product");
    assert.ok(asked.includes(storeSearchTerm(ingredient.name)), "en daarna alsnog breder");
    assert.ok(result.productsStored > 0, "het juiste product is uiteindelijk wél opgeslagen");
  } finally {
    await cleanupAhProducts();
    await prisma.recipe.delete({ where: { id: recipe.id } });
    await prisma.product.deleteMany({ where: { ingredientId: ingredient.id } });
    await prisma.ingredient.delete({ where: { id: ingredient.id } });
  }
});

test("verversing: stopt netjes bij het tijdslimiet in plaats van te worden afgekapt", async () => {
  // In productie bleef de knop eindeloos op "bezig met ophalen" staan: de
  // aanroep liep over de limiet van de hostingpartij heen, werd afgekapt, en
  // dan krijgt de browser nooit antwoord — ook niet over wat er wél gelukt is.
  const asked: string[] = [];
  const result = await refreshStorePrices(
    fakeProvider(async (term) => {
      asked.push(term);
      return [];
    }),
    // Een limiet die al verstreken is: er hoort geen enkele aanvraag te volgen.
    { limitIngredients: 5, deadline: Date.now() - 1 }
  );

  assert.equal(asked.length, 0, "geen enkele winkelaanvraag meer gedaan");
  assert.equal(result.ingredientsChecked, 0);
  assert.equal(result.abortedAfter, 0);
  assert.ok(
    result.errors.some((message) => message.includes("tijdslimiet")),
    "en de gebruiker leest waaróm het niet af is"
  );
});

test("verversing: zonder tijdslimiet verandert er niets aan het gedrag", async () => {
  const asked: string[] = [];
  await refreshStorePrices(
    fakeProvider(async (term) => {
      asked.push(term);
      return [];
    }),
    { limitIngredients: 3 }
  );
  assert.ok(asked.length >= 3, "alle drie de ingrediënten zijn gewoon bevraagd");
});
