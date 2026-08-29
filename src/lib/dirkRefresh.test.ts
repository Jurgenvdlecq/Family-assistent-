/**
 * Integratietest tegen een echte (lokale) Postgres én een neppe Dirk-site.
 *
 * De site wordt hier lokaal nagebouwd. Dat is niet alleen praktisch
 * (`www.dirk.nl` is vanuit deze omgeving onbereikbaar) maar ook juist: wat
 * getest moet worden is hoe de verversing zich gedraagt — welke pagina's ze
 * langsloopt, wat ze opslaat, en vooral wat ze doet als de site niets
 * bruikbaars teruggeeft.
 */
import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { prisma } from "./prisma";
import { getPricedIngredients, refreshDirkPrices } from "./pricing/refresh";
import { storeSearchTerm } from "@/domain/pricing/storeMatch";

/** Een categoriepagina in de vorm die de opdracht beschrijft. */
function categoryPage(entries: Array<{ id: string; name: string; size: string; large: string; small: string; hasEuros: boolean }>) {
  return entries
    .map(
      (entry) => `
        <div class="product-card">
          <a href="/boodschappen/test/categorie/${entry.id}">
            <img alt="${entry.name}" src="/img/${entry.id}.jpg">
          </a>
          <span class="product-unit">${entry.size}</span>
          <div class="price">
            <span class="price-large${entry.hasEuros ? " hasEuros" : ""}">${entry.large}</span><span class="price-small">${entry.small}</span>
          </div>
        </div>`
    )
    .join("\n");
}

interface FakeSite {
  server: Server;
  baseUrl: string;
  requested: string[];
}

async function startFakeDirk(pages: Record<string, string>): Promise<FakeSite> {
  const requested: string[] = [];
  const server = createServer((req, res) => {
    const path = (req.url ?? "").split("?")[0];
    requested.push(path);
    const body = pages[path];
    if (body === undefined) {
      res.writeHead(404, { "Content-Type": "text/html" });
      res.end("niet gevonden");
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(body);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return { server, baseUrl: `http://127.0.0.1:${port}`, requested };
}

async function withFakeDirk<T>(
  pages: Record<string, string>,
  run: (site: FakeSite) => Promise<T>
): Promise<T> {
  const site = await startFakeDirk(pages);
  const previous = process.env.DIRK_BASE_URL;
  process.env.DIRK_BASE_URL = site.baseUrl;
  try {
    return await run(site);
  } finally {
    if (previous === undefined) delete process.env.DIRK_BASE_URL;
    else process.env.DIRK_BASE_URL = previous;
    await new Promise<void>((resolve) => site.server.close(() => resolve()));
  }
}

async function cleanupDirkProducts() {
  const products = await prisma.product.findMany({ where: { provider: "DIRK" }, select: { id: true } });
  const ids = products.map((product) => product.id);
  await prisma.priceObservation.deleteMany({ where: { productId: { in: ids } } });
  await prisma.product.deleteMany({ where: { id: { in: ids } } });
}

test("Dirk-verversing: crawlt de categorieën en bewaart alleen wat bij onze ingrediënten past", async () => {
  const ingredients = await getPricedIngredients();
  assert.ok(ingredients.length > 0, "de testdatabase hoort ingrediënten te hebben");
  const target = ingredients[0];

  try {
    const result = await withFakeDirk(
      {
        "/boodschappen": `<a href="/boodschappen/test/categorie">Categorie</a>`,
        "/boodschappen/test/categorie": categoryPage([
          { id: "111", name: target.name, size: "500 gram", large: "2", small: "49", hasEuros: true },
          // Iets wat we nooit kopen: hoort niet in de database te belanden.
          { id: "222", name: "Hondenbrokken rundsmaak", size: "10 kg", large: "24", small: "99", hasEuros: true },
        ]),
      },
      () => refreshDirkPrices()
    );

    assert.equal(result.provider, "DIRK");
    assert.ok(result.productsStored > 0, "er hoort minstens één product bewaard te zijn");

    const stored = await prisma.product.findMany({ where: { provider: "DIRK" } });
    assert.ok(
      stored.some((product) => product.externalRef === "111"),
      "het passende product hoort bewaard te zijn"
    );
    assert.ok(
      !stored.some((product) => product.name.includes("Hondenbrokken")),
      "wat bij geen enkel ingrediënt past hoort niet opgeslagen te worden"
    );
  } finally {
    await cleanupDirkProducts();
  }
});

test("Dirk-verversing: een prijs onder een euro wordt niet honderd keer zo duur opgeslagen", async () => {
  // De valkuil van deze site, nu helemaal tot in de database gevolgd.
  const ingredients = await getPricedIngredients();
  const target = ingredients[0];

  try {
    await withFakeDirk(
      {
        "/boodschappen": `<a href="/boodschappen/test/categorie">Categorie</a>`,
        "/boodschappen/test/categorie": categoryPage([
          { id: "333", name: target.name, size: "100 gram", large: "89", small: "", hasEuros: false },
        ]),
      },
      () => refreshDirkPrices()
    );

    const stored = await prisma.product.findFirst({ where: { provider: "DIRK", externalRef: "333" } });
    assert.ok(stored, "het product hoort bewaard te zijn");
    assert.equal(Number(stored!.price), 0.89, "89 cent, geen 89 euro");
  } finally {
    await cleanupDirkProducts();
  }
});

test("Dirk-verversing: nul producten is een storing, geen lege winkel", async () => {
  // Zonder dit onderscheid lijkt een kapotte scraper op een winkel zonder
  // aanbod — en dan wordt Dirk ten onrechte de goedkoopste.
  try {
    const result = await withFakeDirk(
      {
        "/boodschappen": `<a href="/boodschappen/test/categorie">Categorie</a>`,
        "/boodschappen/test/categorie": "<html><body>Onderhoud</body></html>",
      },
      () => refreshDirkPrices()
    );

    assert.equal(result.productsStored, 0);
    assert.ok(result.errors.length > 0, "de storing hoort gemeld te worden");
    assert.equal(
      await prisma.product.count({ where: { provider: "DIRK" } }),
      0,
      "er hoort niets bewaard te zijn"
    );
  } finally {
    await cleanupDirkProducts();
  }
});

test("Dirk-verversing: zonder categorieën op de overzichtspagina stopt het meteen", async () => {
  const result = await withFakeDirk(
    { "/boodschappen": "<html><body>Even geduld</body></html>" },
    () => refreshDirkPrices()
  );
  assert.equal(result.productsStored, 0);
  assert.match(result.errors.join(" "), /categorie/i);
});

test("Dirk-verversing: eerder opgeslagen prijzen blijven staan als de crawl mislukt", async () => {
  // "Oud maar niet verzonnen" is beter dan weg: de vergelijking meldt de
  // datum erbij.
  const ingredients = await getPricedIngredients();
  const target = ingredients[0];

  try {
    await withFakeDirk(
      {
        "/boodschappen": `<a href="/boodschappen/test/categorie">Categorie</a>`,
        "/boodschappen/test/categorie": categoryPage([
          { id: "444", name: target.name, size: "500 gram", large: "1", small: "99", hasEuros: true },
        ]),
      },
      () => refreshDirkPrices()
    );
    const before = await prisma.product.count({ where: { provider: "DIRK" } });
    assert.ok(before > 0);

    await withFakeDirk({ "/boodschappen": "<html><body>Storing</body></html>" }, () => refreshDirkPrices());

    assert.equal(
      await prisma.product.count({ where: { provider: "DIRK" } }),
      before,
      "een mislukte verversing mag niets weggooien"
    );
  } finally {
    await cleanupDirkProducts();
  }
});

test("Dirk-verversing: bezoekt eerst de categorieën waar de lijst iets te zoeken heeft", async () => {
  // Gebruikersmelding: "Hij zegt dat ie producten heeft gevonden maar geen
  // match." Dirk heeft geen zoekfunctie, dus er wordt gecrawld — en er werden
  // simpelweg de eerste categorieën van Dirks eigen menu gepakt, die niets met
  // de boodschappenlijst te maken hebben. Met een krappe limiet kwam de juiste
  // categorie dus nooit aan de beurt.
  const ingredients = await getPricedIngredients();
  const target = ingredients[0];
  // Het pad moet aan Dirks eigen vorm voldoen: twee segmenten, alleen kleine
  // letters en koppeltekens.
  const slug = target.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  const targetPath = `/boodschappen/schap/${slug}`;
  const bezocht: string[] = [];

  try {
    const result = await withFakeDirk(
      {
        // De relevante categorie staat bewust achteraan in het menu.
        "/boodschappen": `
          <a href="/boodschappen/dranken/wijn-en-bier">Wijn</a>
          <a href="/boodschappen/zoet/snoep-en-koek">Snoep</a>
          <a href="${targetPath}">Doel</a>
        `,
        "/boodschappen/dranken/wijn-en-bier": categoryPage([
          { id: "900", name: "Rode wijn", size: "750 ml", large: "4", small: "99", hasEuros: true },
        ]),
        "/boodschappen/zoet/snoep-en-koek": categoryPage([
          { id: "901", name: "Drop", size: "200 gram", large: "1", small: "99", hasEuros: true },
        ]),
        [targetPath]: categoryPage([
          { id: "902", name: `Dirk ${target.name}`, size: "500 gram", large: "2", small: "49", hasEuros: true },
        ]),
      },
      async (site) => {
        site.server.on("request", (request) => {
          if (request.url) bezocht.push(request.url);
        });
        // Maar één categorie mag bezocht worden: die moet de juiste zijn.
        return refreshDirkPrices({ maxCategories: 1 });
      }
    );

    assert.ok(
      bezocht.includes(targetPath),
      `de relevante categorie hoort bezocht te zijn, bezocht: ${bezocht.join(", ")}`
    );
    assert.ok(result.productsStored > 0, "en dat levert een match op in plaats van 'niets dat paste'");
  } finally {
    await cleanupDirkProducts();
  }
});

test("Dirk-verversing: gebruikt de eigen zoekpagina zodra die leesbaar blijkt", async () => {
  // De code ging ervan uit dat Dirks zoekpagina client-side laadt en dus
  // onleesbaar is. Die aanname kwam uit de oorspronkelijke opdracht en was
  // nooit gemeten. Nu wordt het per verversing echt gevraagd — en als het
  // antwoord ja is, hoeft er niets meer gegokt te worden over categorieën.
  const ingredients = await getPricedIngredients();
  const target = ingredients[0];
  const bezocht: string[] = [];

  try {
    const result = await withFakeDirk(
      {
        // De proef: zoeken op "melk" levert een leesbaar product op.
        "/zoeken/producten/melk": categoryPage([
          { id: "700", name: "Dirk Halfvolle melk", size: "1 liter", large: "1", small: "09", hasEuros: true },
        ]),
        [`/zoeken/producten/${encodeURIComponent(storeSearchTerm(target.name))}`]: categoryPage([
          { id: "701", name: `Dirk ${target.name}`, size: "500 gram", large: "2", small: "49", hasEuros: true },
        ]),
        // De categoriepagina's bestaan wel, maar horen niet aangeraakt te worden.
        "/boodschappen": `<a href="/boodschappen/test/categorie">Categorie</a>`,
        "/boodschappen/test/categorie": categoryPage([
          { id: "702", name: "Iets heel anders", size: "1 stuk", large: "9", small: "99", hasEuros: true },
        ]),
      },
      async (site) => {
        site.server.on("request", (request) => {
          if (request.url) bezocht.push(request.url);
        });
        return refreshDirkPrices({ limitIngredients: 1 });
      }
    );

    assert.ok(
      bezocht.some((url) => url.startsWith("/zoeken/producten/")),
      `de zoekpagina hoort gebruikt te zijn, bezocht: ${bezocht.join(", ")}`
    );
    assert.ok(
      !bezocht.includes("/boodschappen"),
      "en dan hoeft er niet meer gecrawld te worden"
    );
    assert.ok(result.productsStored > 0);
  } finally {
    await cleanupDirkProducts();
  }
});

test("Dirk-verversing: valt terug op crawlen als de zoekpagina niets leesbaars geeft", async () => {
  // Blijkt de oorspronkelijke aanname tóch te kloppen — de pagina rendert
  // client-side — dan verandert er niets aan het bestaande gedrag.
  const ingredients = await getPricedIngredients();
  const target = ingredients[0];
  const slug = target.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  const bezocht: string[] = [];

  try {
    const result = await withFakeDirk(
      {
        // Een lege huls, precies zoals een client-side gerenderde pagina.
        "/zoeken/producten/melk": "<html><body><div id='app'></div></body></html>",
        "/boodschappen": `<a href="/boodschappen/schap/${slug}">Doel</a>`,
        [`/boodschappen/schap/${slug}`]: categoryPage([
          { id: "703", name: `Dirk ${target.name}`, size: "500 gram", large: "2", small: "49", hasEuros: true },
        ]),
      },
      async (site) => {
        site.server.on("request", (request) => {
          if (request.url) bezocht.push(request.url);
        });
        return refreshDirkPrices({ limitIngredients: 1 });
      }
    );

    assert.ok(bezocht.includes("/boodschappen"), "er hoort alsnog gecrawld te zijn");
    assert.ok(result.productsStored > 0, "en dat levert gewoon producten op");
  } finally {
    await cleanupDirkProducts();
  }
});
