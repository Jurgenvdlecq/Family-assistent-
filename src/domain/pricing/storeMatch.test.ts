import { test } from "node:test";
import assert from "node:assert/strict";
import { contentWords, rankStoreProducts, scoreStoreProductForIngredient, storeSearchTerm } from "./storeMatch";
import type { ProviderProduct } from "./types";

function product(name: string, overrides: Partial<ProviderProduct> = {}): ProviderProduct {
  return {
    provider: "AH",
    externalRef: name.toLowerCase().replace(/\W+/g, "-"),
    name,
    brand: "AH",
    packageSize: "1 l",
    content: { amount: 1000, unit: "ML" },
    price: 1.29,
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
    ...overrides,
  };
}

test("een product dat het ingrediënt volledig noemt scoort vol", () => {
  assert.equal(scoreStoreProductForIngredient("Halfvolle melk", "AH Halfvolle melk"), 1);
});

test("de winkelnaam telt niet mee als betekenisdragend woord", () => {
  // Anders zou "AH" in elke productnaam de score kunstmatig verhogen.
  assert.equal(scoreStoreProductForIngredient("Melk", "AH Halfvolle melk"), 1);
});

test("een half passend product komt onder de drempel", () => {
  const score = scoreStoreProductForIngredient("Verse gember", "Gemberkoek");
  assert.ok(score < 1, `verwacht een lagere score, kreeg ${score}`);
});

test("een compleet ander product scoort nul", () => {
  assert.equal(scoreStoreProductForIngredient("Kipfilet", "Bloemkool"), 0);
});

test("rankStoreProducts laat producten onder de drempel weg", () => {
  // Liever geen match dan een verkeerde: een niet-gevonden regel wordt
  // zichtbaar getoond, een verkeerde match verdwijnt in een totaalbedrag.
  const matches = rankStoreProducts("Halfvolle melk", [
    product("AH Halfvolle melk"),
    product("AH Volle melk"),
    product("Bloemkool"),
  ]);
  assert.deepEqual(
    matches.map((match) => match.product.name),
    ["AH Halfvolle melk"]
  );
});

test("rankStoreProducts geeft meerdere kandidaten terug, kleinste verpakking eerst", () => {
  // Meerdere, omdat het equivalentiemodel straks moet kunnen kiezen tussen
  // "zelfde soort" en "goedkoper alternatief".
  const matches = rankStoreProducts("Halfvolle melk", [
    product("AH Halfvolle melk", { externalRef: "groot", content: { amount: 2000, unit: "ML" } }),
    product("AH Halfvolle melk", { externalRef: "klein", content: { amount: 1000, unit: "ML" } }),
    product("AH Biologische halfvolle melk", { externalRef: "bio" }),
  ]);
  assert.equal(matches.length, 3);
  assert.equal(matches[0].product.externalRef, "klein", "de gewone verpakking staat voorop");
});

test("rankStoreProducts is deterministisch bij gelijke score en gelijke inhoud", () => {
  const options = [
    product("AH Halfvolle melk", { externalRef: "z" }),
    product("AH Halfvolle melk", { externalRef: "a" }),
  ];
  assert.equal(rankStoreProducts("Halfvolle melk", options)[0].product.externalRef, "a");
  assert.equal(rankStoreProducts("Halfvolle melk", [...options].reverse())[0].product.externalRef, "a");
});

test("zoeken: de naam van een andere winkel telt niet mee in de match", () => {
  // Uit productiegebruik: onze ingrediënten heten "Picnic Appelmoes". Zonder
  // "picnic" als ruiswoord haalde "AH Appelmoes" de drempel niet, en meldde
  // het scherm "niet gevonden" terwijl het product er gewoon ligt.
  assert.equal(scoreStoreProductForIngredient("Picnic Appelmoes", "AH Appelmoes"), 1);
  assert.equal(storeSearchTerm("Picnic Appelmoes"), "appelmoes");
  assert.equal(storeSearchTerm("Picnic Hagelslag"), "hagelslag");
});

test("zoeken: blijft er niets over, dan zoeken we met de naam zelf", () => {
  // Liever een matige zoekopdracht dan een lege.
  assert.equal(storeSearchTerm("Dirk"), "Dirk");
});

test("zoeken: een samenstelling met of zonder spatie is hetzelfde product", () => {
  // Uit productiegebruik: wij noemen het "Allesreinigerdoekjes", Albert Heijn
  // schrijft "Allesreiniger doekjes". Op letterniveau vond de ene vorm de
  // andere niet, en dan staat er "niet gevonden" terwijl het product er ligt.
  assert.equal(
    scoreStoreProductForIngredient("Allesreinigerdoekjes Citrus", "AH Allesreiniger doekjes citrus"),
    1
  );
  // En andersom net zo goed.
  assert.equal(scoreStoreProductForIngredient("Snack Tomaatjes", "AH Snacktomaatjes"), 1);
});

test("zoeken: losse letters blijven geen match", () => {
  // Het weglaten van spaties mag geen nieuwe overeenkomsten verzinnen die niet
  // uit dezelfde letters bestaan.
  assert.ok(scoreStoreProductForIngredient("Appelmoes", "AH Bananen") < 0.6);
});

test("matching: 'wc papier' matcht geen printpapier — een woord telt alleen als heel woord", () => {
  // Gebruikersmelding: bij toiletpapier stond printpapier van Albert Heijn.
  // Oorzaak: er werd op letterniveau gezocht, en "papier" zit in "printpapier".
  assert.equal(scoreStoreProductForIngredient("Wc papier", "AH Printpapier A4 wit"), 0);
  assert.equal(scoreStoreProductForIngredient("Keukenpapier", "AH Printpapier"), 0);
  // Karnemelk is geen melk, om precies dezelfde reden.
  assert.equal(scoreStoreProductForIngredient("Melk", "AH Karnemelk"), 0);
});

test("matching: los of aaneen geschreven blijft wél matchen, in beide richtingen", () => {
  // De uitzondering op de regel hierboven: een reeks woorden mag samen precies
  // één woord aan de andere kant vormen. "Precies" is het hele punt.
  assert.equal(scoreStoreProductForIngredient("Allesreinigerdoekjes", "AH Allesreiniger doekjes citroen"), 1);
  assert.equal(scoreStoreProductForIngredient("Allesreiniger doekjes", "AH Allesreinigerdoekjes"), 1);
  assert.equal(scoreStoreProductForIngredient("Toiletpapier", "AH Toiletpapier 8 rollen"), 1);
});

test("rangschikken: het product dat op ons eigen product lijkt komt vooraan", () => {
  // Gebruikersmelding: "Alpro heeft AH zelfs exact dezelfde, gek dat ie deze
  // niet pakt." Het ingrediënt heet alleen naar het merk, dus alle
  // Alpro-artikelen scoren daar even hoog en besliste een willekeurige
  // tiebreak. Koffiemelk won.
  const alpro = [
    product("Alpro Barista koffiemelk"),
    product("Alpro Mild & Creamy naturel"),
    product("Alpro Soya drink ongezoet"),
  ];

  const zonder = rankStoreProducts("Alpro", alpro, 8).map((match) => match.product.name);
  assert.equal(zonder[0], "Alpro Barista koffiemelk", "zo ging het mis");

  const met = rankStoreProducts("Alpro", alpro, 8, { name: "Alpro Mild & Creamy 750g" }).map(
    (match) => match.product.name
  );
  assert.equal(met[0], "Alpro Mild & Creamy naturel");
});

test("zoekterm: getallen en verpakkingsmaten horen niet in de zoekopdracht", () => {
  // Zoeken op "alpro mild creamy 750g" levert bij een winkel niets op.
  assert.equal(storeSearchTerm("Alpro Mild & Creamy 750g"), "alpro mild creamy");
  assert.equal(storeSearchTerm("Halfvolle melk 1 l"), "halfvolle melk");
});

test("rangschikken: bij gelijke namen beslist de verpakkingsvorm", () => {
  // Gebruikersmelding: "Appelmoes nog steeds een pot in plaats van losse
  // cups." Hier helpt de productnaam niets — ons eigen product heet "Picnic
  // appelmoes", en na het weglaten van de winkelnaam blijft daar precies
  // hetzelfde woord van over als de ingrediëntnaam. De vorm van de verpakking
  // is dan het enige onderscheid dat er nog is.
  const kandidaten = [
    product("Hak Appelmoes", { packageSize: "350 g" }),
    product("AH Appelmoes", { packageSize: "720 g" }),
    product("AH Appelmoes cups", { packageSize: "4 x 100 g" }),
  ];

  const zonder = rankStoreProducts("Picnic Appelmoes", kandidaten, 8).map((m) => m.product.name);
  assert.notEqual(zonder[0], "AH Appelmoes cups", "zo ging het mis: een pot bovenaan");

  const met = rankStoreProducts("Picnic Appelmoes", kandidaten, 8, {
    name: "Picnic appelmoes",
    packageSize: "8 x 100 gram",
  }).map((m) => m.product.name);
  assert.equal(met[0], "AH Appelmoes cups");
});

test("rangschikken: een onbekende verpakkingsvorm telt nooit als verschil", () => {
  // Onbekend is geen bewijs van het tegendeel; dan moet de volgorde puur op de
  // naam blijven leunen.
  const kandidaten = [product("AH Appelmoes", { packageSize: null })];
  const ranked = rankStoreProducts("Appelmoes", kandidaten, 8, {
    name: "Appelmoes",
    packageSize: "8 x 100 gram",
  });
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].sameForm, false);
});

test("zoekterm: niet meer dan vier woorden, anders vindt de winkel niets meer", () => {
  // Winkelzoekmachines worden strenger naarmate je meer woorden geeft. Onze
  // eigen productnaam kan lang zijn, en dan vindt Albert Heijn haar eigen
  // variant van datzelfde product niet meer terug.
  assert.equal(
    storeSearchTerm("Alpro mild & creamy naturel groot formaat"),
    "alpro mild creamy naturel"
  );
  assert.equal(storeSearchTerm("Alpro mild & creamy"), "alpro mild creamy");
});

test("toelating: het juiste product mag niet sneuvelen op een misleidende ingrediëntnaam", () => {
  // Gebruikersmelding: bij "Wc Papier" stond 24Basics printerpapier. Na het
  // filteren blijft van die ingrediëntnaam alleen "papier" over, en dan haalde
  // printerpapier een perfecte score — terwijl het échte toiletpapier werd
  // wéggegooid, want dat heet "toiletpapier" en bevat "papier" niet als los
  // woord. De toelating keek alleen naar de ingrediëntnaam.
  const kandidaten = [
    product("24Basics Wit papier 80gram", { packageSize: "100 stuks" }),
    product("AH Toiletpapier 4-laags 8 rollen", { packageSize: "8 rollen" }),
    product("Page toiletpapier 3-laags", { packageSize: "6 rollen" }),
  ];

  const namen = rankStoreProducts("Wc Papier", kandidaten, 8, {
    name: "Picnic toiletpapier 4 laags",
    packageSize: "9 rollen",
  }).map((match) => match.product.name);

  assert.ok(
    namen.includes("AH Toiletpapier 4-laags 8 rollen"),
    "toegelaten omdat het op ons eigen product lijkt, ook al matcht de ingrediëntnaam niet"
  );
  assert.ok(
    !namen.some((naam) => naam.includes("24Basics")),
    "en printerpapier hoort er helemaal niet meer bij te staan"
  );
});

test("toelating: wat duidelijk ons product niet is, wordt geen kandidaat", () => {
  // Eerder werd zoiets wél getoond, met "ander soort" erbij. Maar een doos
  // printerpapier naast je toiletpapier zetten is geen nuttige vergelijking,
  // hoe eerlijk het label er ook bij staat.
  const kandidaten = [
    product("Alpro Barista koffiemelk"),
    product("Alpro Mild & creamy zonder suikers"),
  ];
  const namen = rankStoreProducts("Alpro", kandidaten, 8, { name: "Alpro mild & creamy" }).map(
    (match) => match.product.name
  );
  assert.deepEqual(namen, ["Alpro Mild & creamy zonder suikers"]);
});

test("toelating: zonder eigen product blijft de oude, ruimere toelating gelden", () => {
  // Weten we niet wat wij kopen, dan mag die onwetendheid geen producten
  // wegfilteren — dan is de ingrediëntnaam alles wat we hebben.
  const kandidaten = [
    product("Alpro Barista koffiemelk"),
    product("Alpro Mild & creamy zonder suikers"),
  ];
  assert.equal(rankStoreProducts("Alpro", kandidaten, 8).length, 2);
});

test("woorden van twee letters tellen mee, maatafkortingen niet", () => {
  assert.deepEqual(contentWords("Wc papier"), ["wc", "papier"]);
  assert.deepEqual(contentWords("Halfvolle melk 1 l"), ["halfvolle", "melk"]);
  assert.deepEqual(contentWords("Beschuit 13 st"), ["beschuit"]);
});
