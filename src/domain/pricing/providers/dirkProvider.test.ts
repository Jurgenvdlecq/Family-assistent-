import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DIRK_CAPABILITIES,
  dirkProductUrl,
  parseDirkBrand,
  rankDirkCategories,
  parseDirkCategoryPaths,
  parseDirkPrice,
  parseDirkProductId,
  parseDirkProducts,
} from "./dirkProvider";

/**
 * De HTML hieronder is nagebouwd volgens de vorm die in de opdracht staat
 * (prijs gesplitst in `price-large` + `price-small`, met `hasEuros` als
 * doorslag, en het product-ID als laatste getal in de URL). Dat is geen
 * opgehaalde pagina: `www.dirk.nl` is vanuit deze omgeving niet bereikbaar.
 * Deze tests leggen dus vast dat de regels uit de opdracht correct worden
 * toegepast — of de opmaak nog steeds zo is, blijkt pas bij de eerste
 * verversing in productie. Daar is de "nul producten is een fout"-bewaking
 * voor.
 */
const CATEGORY_HTML = `
<div class="product-card">
  <a href="/boodschappen/zuivel/melk/verse-halfvolle-melk-1-liter/213456">
    <img alt="Melkunie Verse halfvolle melk" src="/img/1.jpg">
  </a>
  <span class="product-unit">1 liter</span>
  <div class="price"><span class="price-large hasEuros">1</span><span class="price-small">29</span></div>
</div>
<div class="product-card">
  <a href="/boodschappen/groente/verse-gember/998877">
    <img alt="Verse gember" src="/img/2.jpg">
  </a>
  <span class="product-unit">100 gram</span>
  <div class="price"><span class="price-large">89</span><span class="price-small"></span></div>
</div>
<div class="product-card">
  <a href="/boodschappen/vlees/kipfilet/445566">
    <img alt="1 de Beste Kipfilet naturel" src="/img/3.jpg">
  </a>
  <span class="product-unit">300 gram</span>
  <div class="price"><span class="price-large hasEuros">3</span><span class="price-small">49</span></div>
</div>
`;

test("Dirk: de prijs staat gesplitst, en hasEuros bepaalt hoe je 'm leest", () => {
  // Dit is de enige echte valkuil op deze pagina. Zonder de klasse mee te
  // wegen wordt "89 cent" gelezen als € 89,00.
  assert.equal(parseDirkPrice("1", "29", true), 1.29);
  assert.equal(parseDirkPrice("89", "", false), 0.89);
  assert.equal(parseDirkPrice("8", "9", false), 0.89);
  assert.equal(parseDirkPrice("12", "5", true), 12.5);
});

test("Dirk: een onleesbare prijs levert niets op, geen nul", () => {
  assert.equal(parseDirkPrice("", "", true), null);
  assert.equal(parseDirkPrice("-", "", false), null);
});

test("Dirk: het product-ID is het laatste getal in de URL", () => {
  assert.equal(parseDirkProductId("/boodschappen/zuivel/melk/verse-melk-1-l/213456"), "213456");
  assert.equal(parseDirkProductId("/boodschappen/zuivel/melk/verse-melk-1-l/213456/"), "213456");
  assert.equal(parseDirkProductId("/boodschappen/zonder-nummer"), null);
});

test("Dirk: een categoriepagina levert producten met prijs en verpakking", () => {
  const products = parseDirkProducts(CATEGORY_HTML);
  assert.equal(products.length, 3);

  const melk = products[0];
  assert.equal(melk.externalRef, "213456");
  assert.equal(melk.name, "Melkunie Verse halfvolle melk");
  assert.equal(melk.price, 1.29);
  assert.equal(melk.packageSize, "1 liter");
  assert.deepEqual(melk.content, { amount: 1000, unit: "ML" });
  assert.equal(melk.provider, "DIRK");
  // Geen barcode en geen allergenen: die geeft Dirk niet, en verzinnen mag niet.
  assert.equal(melk.gtin, null);
  assert.deepEqual(melk.freeFromAllergens, []);
});

test("Dirk: een prijs onder een euro wordt niet honderd keer zo duur", () => {
  const gember = parseDirkProducts(CATEGORY_HTML).find((product) => product.externalRef === "998877");
  assert.ok(gember);
  assert.equal(gember!.price, 0.89, "89 cent, geen 89 euro");
});

test("Dirk: het huismerk wordt herkend, een willekeurig eerste woord niet", () => {
  // Een verzonnen merk werkt door in de klassebepaling, en juist daar mag
  // niet gegokt worden.
  assert.equal(parseDirkBrand("1 de Beste Kipfilet naturel"), "1 de Beste");
  assert.equal(parseDirkBrand("Verse gember"), null);
  assert.equal(parseDirkProducts(CATEGORY_HTML)[2].brand, "1 de Beste");
});

test("Dirk: een blok zonder bruikbare naam of id wordt overgeslagen", () => {
  // Overslaan is goed; met prijs nul opnemen zou Dirk goedkoper laten lijken.
  const broken = `<div class="price"><span class="price-large hasEuros">2</span><span class="price-small">00</span></div>`;
  assert.deepEqual(parseDirkProducts(broken), []);
});

test("Dirk: zonder prijsopmaak levert de pagina niets op — dat is een storing, geen leeg schap", () => {
  assert.deepEqual(parseDirkProducts("<html><body>Onderhoud</body></html>"), []);
});

test("Dirk: de categorieën komen uit de site zelf, niet uit een vaste lijst", () => {
  const html = `
    <a href="/boodschappen/zuivel/melk">Melk</a>
    <a href="/boodschappen/zuivel/melk?pagina=2">Melk 2</a>
    <a href="/boodschappen/groente">Groente</a>
    <a href="/aanbiedingen">Aanbiedingen</a>
  `;
  assert.deepEqual(parseDirkCategoryPaths(html), ["/boodschappen/zuivel/melk"]);
});

test("Dirk: de mogelijkheden zijn eerlijk opgeschreven", () => {
  // De vergelijker leest dit blok om te weten wat hij mag concluderen.
  assert.equal(DIRK_CAPABILITIES.hasEan, false);
  assert.equal(DIRK_CAPABILITIES.hasAllergens, false);
  assert.equal(DIRK_CAPABILITIES.canOrder, false, "bestellen blijft bij Picnic");
  assert.equal(DIRK_CAPABILITIES.reliability, "scrape");
});

test("Dirk: de link naar het product komt van de pagina zelf", () => {
  const products = parseDirkProducts(CATEGORY_HTML);
  assert.equal(
    products[0].url,
    "https://www.dirk.nl/boodschappen/zuivel/melk/verse-halfvolle-melk-1-liter/213456",
    "de gebruiker moet zelf kunnen nakijken of dit hetzelfde product is"
  );
});

test("Dirk: alleen een adres dat echt op dirk.nl staat wordt een link", () => {
  assert.equal(dirkProductUrl("/boodschappen/zuivel/melk/123"), "https://www.dirk.nl/boodschappen/zuivel/melk/123");
  assert.equal(dirkProductUrl("https://www.dirk.nl/product/123"), "https://www.dirk.nl/product/123");
  // Een gewijzigde pagina mag geen link naar een andere site op ons scherm
  // kunnen zetten — en al helemaal geen adres dat code uitvoert.
  assert.equal(dirkProductUrl("https://kwaadaardig.example/product/123"), null);
  assert.equal(dirkProductUrl("//kwaadaardig.example/product/123"), null);
  assert.equal(dirkProductUrl("javascript:alert(1)"), null);
  assert.equal(dirkProductUrl(null), null);
});

test("Dirk: de categorieën waar de lijst iets te zoeken heeft komen eerst", () => {
  // Gebruikersmelding: "Hij zegt dat ie producten heeft gevonden maar geen
  // match, terwijl sommige producten identiek zijn." Dirk heeft geen
  // zoekfunctie, dus er wordt gecrawld — en er werden simpelweg de eerste
  // categorieën van Dirks eigen menu gepakt. Die staan los van de lijst.
  const paths = [
    "/boodschappen/wijn-en-bier",
    "/boodschappen/huishouden/schoonmaak",
    "/boodschappen/zuivel/melk",
    "/boodschappen/snoep-en-koek",
    "/boodschappen/huishouden/toiletpapier",
  ];

  const ranked = rankDirkCategories(paths, ["Halfvolle melk", "Wc papier", "Picnic toiletpapier 4 laags"]);

  assert.deepEqual(ranked.slice(0, 2), [
    "/boodschappen/zuivel/melk",
    "/boodschappen/huishouden/toiletpapier",
  ]);
  // Wat niets dekt verdwijnt niet, het schuift alleen naar achteren: is er
  // tijd over, dan is het alsnog welkom.
  assert.equal(ranked.length, paths.length);
});

test("Dirk: zonder namen blijft de volgorde van de site zelf staan", () => {
  const paths = ["/boodschappen/a", "/boodschappen/b"];
  assert.deepEqual(rankDirkCategories(paths, []), paths);
});
