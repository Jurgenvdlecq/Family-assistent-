import test from "node:test";
import assert from "node:assert/strict";
import {
  assertPubliclyReachableUrl,
  extractRecipeFromHtml,
  fetchRecipePageHtml,
  isDisallowedAddress,
} from "./recipeImport";

test("extractRecipeFromHtml leest een simpel schema.org/Recipe-blok", () => {
  const html = `<html><head><script type="application/ld+json">
    {"@context":"https://schema.org","@type":"Recipe","name":"Groene curry",
     "recipeIngredient":["400g kipfilet","1 blik kokosmelk","2 el groene currypasta"],
     "recipeInstructions":["Snijd de kip.","Bak de currypasta kort aan."]}
  </script></head><body></body></html>`;

  const result = extractRecipeFromHtml(html);
  assert.deepEqual(result, {
    title: "Groene curry",
    ingredientLines: ["400g kipfilet", "1 blik kokosmelk", "2 el groene currypasta"],
    instructions: ["Snijd de kip.", "Bak de currypasta kort aan."],
  });
});

test("extractRecipeFromHtml vindt een Recipe genest in @graph", () => {
  const html = `<script type="application/ld+json">
    {"@context":"https://schema.org","@graph":[
      {"@type":"WebSite","name":"Voorbeeldsite"},
      {"@type":"Recipe","name":"Pasta pesto","recipeIngredient":["300g pasta","1 pot pesto"]}
    ]}
  </script>`;

  const result = extractRecipeFromHtml(html);
  assert.equal(result?.title, "Pasta pesto");
  assert.deepEqual(result?.ingredientLines, ["300g pasta", "1 pot pesto"]);
});

test("extractRecipeFromHtml ondersteunt recipeInstructions als HowToStep-objecten", () => {
  const html = `<script type="application/ld+json">
    {"@type":"Recipe","name":"Wraps","recipeIngredient":["4 wraps"],
     "recipeInstructions":[{"@type":"HowToStep","text":"Verwarm de wraps."}]}
  </script>`;

  const result = extractRecipeFromHtml(html);
  assert.deepEqual(result?.instructions, ["Verwarm de wraps."]);
});

test("extractRecipeFromHtml decodeert veelvoorkomende HTML-entities", () => {
  const html = `<script type="application/ld+json">
    {"@type":"Recipe","name":"Kip &amp; rijst","recipeIngredient":["1 kip &quot;heel&quot;"]}
  </script>`;

  const result = extractRecipeFromHtml(html);
  assert.equal(result?.title, 'Kip & rijst');
  assert.equal(result?.ingredientLines[0], '1 kip "heel"');
});

test("extractRecipeFromHtml geeft null terug zonder JSON-LD", () => {
  assert.equal(extractRecipeFromHtml("<html><body><p>Geen recept hier</p></body></html>"), null);
});

test("extractRecipeFromHtml geeft null terug bij JSON-LD dat geen Recipe is", () => {
  const html = `<script type="application/ld+json">{"@type":"Article","name":"Nieuwsbericht"}</script>`;
  assert.equal(extractRecipeFromHtml(html), null);
});

test("extractRecipeFromHtml negeert kapotte JSON-LD zonder te crashen", () => {
  const html = `<script type="application/ld+json">{niet geldige json</script>`;
  assert.equal(extractRecipeFromHtml(html), null);
});

test("isDisallowedAddress blokkeert private/interne IPv4-adressen", () => {
  for (const ip of ["127.0.0.1", "10.0.0.5", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "0.0.0.0"]) {
    assert.equal(isDisallowedAddress(ip), true, `${ip} zou geblokkeerd moeten zijn`);
  }
});

test("isDisallowedAddress staat publieke IPv4-adressen toe", () => {
  for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34"]) {
    assert.equal(isDisallowedAddress(ip), false, `${ip} zou toegestaan moeten zijn`);
  }
});

test("isDisallowedAddress blokkeert interne IPv6-adressen", () => {
  for (const ip of ["::1", "fe80::1", "fc00::1", "fd12:3456::1", "::ffff:127.0.0.1"]) {
    assert.equal(isDisallowedAddress(ip), true, `${ip} zou geblokkeerd moeten zijn`);
  }
});

test("assertPubliclyReachableUrl weigert niet-http(s)-schema's", async () => {
  await assert.rejects(() => assertPubliclyReachableUrl("file:///etc/passwd"), /http\(s\)/);
  await assert.rejects(() => assertPubliclyReachableUrl("ftp://voorbeeld.nl/x"), /http\(s\)/);
});

test("assertPubliclyReachableUrl weigert localhost zonder zelfs te resolven", async () => {
  await assert.rejects(() => assertPubliclyReachableUrl("http://localhost/recept"), /normale website/);
});

test("assertPubliclyReachableUrl weigert een hostnaam die naar een privé-IP resolvet", async () => {
  const fakeLookup = async () => [{ address: "127.0.0.1", family: 4 }];
  await assert.rejects(() => assertPubliclyReachableUrl("http://interne-dienst.voorbeeld/", fakeLookup), /normale website/);
});

test("assertPubliclyReachableUrl staat een hostnaam toe die naar een publiek IP resolvet", async () => {
  const fakeLookup = async () => [{ address: "93.184.216.34", family: 4 }];
  const url = await assertPubliclyReachableUrl("https://voorbeeld.nl/recept", fakeLookup);
  assert.equal(url.hostname, "voorbeeld.nl");
});

test("fetchRecipePageHtml herhaalt de SSRF-check bij een doorverwijzing naar een privé-adres", async () => {
  const fakeLookup = async (hostname: string) =>
    hostname === "veilig.voorbeeld" ? [{ address: "93.184.216.34", family: 4 }] : [{ address: "10.0.0.5", family: 4 }];

  const fakeFetch = (async (input: unknown) => {
    const url = String(input);
    if (url.startsWith("https://veilig.voorbeeld")) {
      return new Response(null, { status: 302, headers: { location: "https://intern.voorbeeld/geheim" } });
    }
    throw new Error(`onverwachte fetch naar ${url}`);
  }) as typeof fetch;

  await assert.rejects(
    () => fetchRecipePageHtml(new URL("https://veilig.voorbeeld/recept"), { lookup: fakeLookup, fetchImpl: fakeFetch }),
    /normale website/
  );
});

test("fetchRecipePageHtml volgt een doorverwijzing naar een publiek adres wel", async () => {
  const fakeLookup = async () => [{ address: "93.184.216.34", family: 4 }];
  const fakeFetch = (async (input: unknown) => {
    const url = String(input);
    if (url === "https://kort.voorbeeld/x") {
      return new Response(null, { status: 301, headers: { location: "https://echte-site.voorbeeld/recept" } });
    }
    return new Response("<html>recept</html>", { status: 200, headers: { "content-type": "text/html" } });
  }) as typeof fetch;

  const html = await fetchRecipePageHtml(new URL("https://kort.voorbeeld/x"), { lookup: fakeLookup, fetchImpl: fakeFetch });
  assert.equal(html, "<html>recept</html>");
});

test("fetchRecipePageHtml geeft een duidelijke fout bij een niet-html-response", async () => {
  const fakeFetch = (async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
  await assert.rejects(
    () => fetchRecipePageHtml(new URL("https://voorbeeld.nl/x"), { fetchImpl: fakeFetch }),
    /geen webpagina met een recept/
  );
});
