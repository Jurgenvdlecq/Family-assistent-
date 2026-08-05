import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { chromium, type Browser } from "playwright";
import { prisma } from "@/lib/prisma";
import { startMockPicnicServer, type MockPicnicServer } from "./fixtures/mockPicnicServer";
import { startTestServer, type TestServer } from "./fixtures/testServer";
import { completeOnboardingViaUi, deleteTestHousehold, cleanupMockProducts } from "./fixtures/testHousehold";
import { hashHouseholdPassword } from "@/domain/household/credentials";
import { clearLoginAttempts } from "@/lib/loginRateLimit";

/**
 * Regressietest voor een bevinding uit de code-review van WP82: een server
 * action die alleen `assertCurrentHousehold(householdId)` aanroept op een
 * los `householdId`-formulierveld bewijst niet dat een apart meegestuurde
 * `shoppingListId` ook echt bij dat huishouden hoort — een aanvrager met
 * een geldige eigen sessie zou een `shoppingListId` van een ánder
 * huishouden kunnen meesturen. Getest via een echte browsersessie omdat
 * `assertCurrentHousehold`/`assertShoppingListAccess` op `next/headers`
 * (cookies) leunen en dus geen live Next.js-requestcontext hebben in een
 * losse `tsx --test`-aanroep (zie OPERATIONS.md, "Testen").
 *
 * SYSTEM_AUDIT.md-vervolg (bevinding 1/2, "IDOR in addFixedGrocery /
 * removeFixedGroceryPermanently"): dit bestand dekt nu ook
 * `removeFixedGroceryPermanently` (`src/app/boodschappen/
 * fixedGroceriesActions.ts`) — dezelfde soort aanval, maar dan een
 * *verwijdering* op basis van een los meegestuurde `lineId` in plaats van
 * een schrijfactie op een `shoppingListId`. `addFixedGrocery` (de andere
 * bevinding uit dezelfde audit) heeft bewust géén eigen scenario hier: die
 * server action wordt nergens in de UI aangeroepen (geverifieerd met een
 * repository-brede grep — geen enkel formulier of component importeert
 * hem), dus er bestaat geen rendered `<form>` waarvan de verborgen velden
 * gemanipuleerd kunnen worden zoals hieronder. De fix zelf (eerst
 * `assertShoppingListAccess` vóór elke write) hergebruikt exact dezelfde,
 * hier bewezen `assertShoppingListAccess`/`loadFixedLine`-patronen.
 */
const TEST_PORT = 3179;

test("addManualProduct weigert een shoppingListId van een ander huishouden", { timeout: 120_000 }, async (t) => {
  await cleanupMockProducts();

  // Eigen poort (afwijkend van criticalFlow.e2e.ts's standaardpoort 4010):
  // npm run test:e2e draait beide e2e-bestanden in hetzelfde proces, dus
  // zonder dit zouden de twee mock-Picnic-servers om dezelfde poort botsen.
  const mockPicnic: MockPicnicServer = await startMockPicnicServer(4011);
  const server: TestServer = await startTestServer({ port: TEST_PORT, picnicBaseUrl: mockPicnic.url });
  const browser: Browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

  let householdAId = "";
  let householdBId = "";

  try {
    await t.test("setup: twee huishoudens", async () => {
      const pageA = await (await browser.newContext()).newPage();
      const householdA = await completeOnboardingViaUi(
        pageA,
        server.baseURL,
        `WP82 Huishouden A ${Date.now()}`,
        "wp82a",
        "wp82awachtwoord"
      );
      householdAId = householdA.id;
      await prisma.household.update({ where: { id: householdAId }, data: { picnicAuthToken: "e2e-mock-token" } });

      const pageB = await (await browser.newContext()).newPage();
      const householdB = await completeOnboardingViaUi(
        pageB,
        server.baseURL,
        `WP82 Huishouden B ${Date.now()}`,
        "wp82b",
        "wp82bwachtwoord"
      );
      householdBId = householdB.id;
      // Eerste weekplanning/boodschappenlijst genereren is trager dan een
      // normaal paginabezoek (zelfde cold start als e2e/criticalFlow.e2e.ts)
      // — hier alvast opwarmen vóór het echte /boodschappen-bezoek.
      await pageB.goto(`${server.baseURL}/`, { waitUntil: "load", timeout: 90_000 });
      await pageB.goto(`${server.baseURL}/boodschappen`, { waitUntil: "load", timeout: 90_000 });
      await pageB.context().close();
    });

    const shoppingListB = await prisma.shoppingList.findFirstOrThrow({
      where: { mealPlan: { householdId: householdBId } },
    });
    const linesBeforeAttack = await prisma.shoppingListLine.count({ where: { shoppingListId: shoppingListB.id } });

    await t.test("A probeert een regel in B's boodschappenlijst te schrijven", async () => {
      const contextA = await browser.newContext();
      const pageA = await contextA.newPage();
      await pageA.goto(`${server.baseURL}/login`, { waitUntil: "load" });
      await pageA.getByPlaceholder("Gebruikersnaam").fill("wp82a");
      await pageA.getByPlaceholder("Wachtwoord").fill("wp82awachtwoord");
      await pageA.getByRole("button", { name: "Openen" }).click();
      await pageA.waitForURL(`${server.baseURL}/`, { timeout: 15_000 });

      await pageA.goto(`${server.baseURL}/boodschappen`, { waitUntil: "load", timeout: 90_000 });
      const searchInput = pageA.getByPlaceholder("Zoek een product, bv. chips");
      await searchInput.waitFor({ state: "visible", timeout: 15_000 });
      await searchInput.fill("aardappelen");
      await pageA.getByRole("button", { name: "Zoeken bij Picnic" }).first().click();
      await pageA.waitForURL((u) => u.searchParams.get("manualQ") === "aardappelen", { timeout: 15_000 });

      // #quick-add-product bevat zowel het zoekformulier (geen
      // shoppingListId-veld) als, per zoekresultaat, een eigen
      // toevoegformulier — specifiek dát laatste type selecteren.
      const form = pageA.locator('#quick-add-product form:has(input[name="shoppingListId"])').first();
      await form.waitFor({ state: "visible", timeout: 10_000 });
      // De aanval: het verborgen shoppingListId-veld overschrijven met de
      // lijst van een ander huishouden vóór het versturen.
      await form.locator('input[name="shoppingListId"]').evaluate((el, value) => {
        (el as HTMLInputElement).value = value;
      }, shoppingListB.id);

      await form.getByRole("button", { name: "Toevoegen" }).click();
      // Verwacht: dit mag nooit stilzwijgend "gelukt" zijn. Ofwel een
      // foutpagina, ofwel in elk geval geen nieuwe regel bij B.
      await pageA.waitForLoadState("load", { timeout: 15_000 }).catch(() => {});
      await contextA.close();
    });

    const linesAfterAttack = await prisma.shoppingListLine.count({ where: { shoppingListId: shoppingListB.id } });
    assert.equal(
      linesAfterAttack,
      linesBeforeAttack,
      "huishouden A mag nooit een regel in huishouden B's boodschappenlijst kunnen aanmaken"
    );

    const linesBBeforeQuickOrderAttack = await prisma.shoppingListLine.count({ where: { shoppingListId: shoppingListB.id } });

    await t.test("A probeert via quick-order (WP92) een regel in B's boodschappenlijst te schrijven", async () => {
      const contextA = await browser.newContext();
      const pageA = await contextA.newPage();
      await pageA.goto(`${server.baseURL}/login`, { waitUntil: "load" });
      await pageA.getByPlaceholder("Gebruikersnaam").fill("wp82a");
      await pageA.getByPlaceholder("Wachtwoord").fill("wp82awachtwoord");
      await pageA.getByRole("button", { name: "Openen" }).click();
      await pageA.waitForURL(`${server.baseURL}/`, { timeout: 15_000 });

      await pageA.goto(`${server.baseURL}/boodschappen`, { waitUntil: "load", timeout: 90_000 });
      const quickOrderInput = pageA.locator("#quick-order textarea[name=quickOrder]");
      await quickOrderInput.waitFor({ state: "visible", timeout: 15_000 });
      // Nieuw ingrediënt zonder eerdere voorkeur voor A — moet dus altijd
      // via de handmatige-keuze-picker lopen (addQuickOrderProduct), niet
      // via het automatisch-toevoegen-bulkpad.
      await quickOrderInput.fill("wp92-aanvalstest");
      await pageA.locator("#quick-order").getByRole("button", { name: "Zoeken" }).click();
      await pageA.waitForURL((u) => u.searchParams.has("quickOrder"), { timeout: 15_000 });

      const form = pageA.locator('#quick-order form:has(input[name="shoppingListId"])').first();
      await form.waitFor({ state: "visible", timeout: 10_000 });
      // De aanval: het verborgen shoppingListId-veld overschrijven met de
      // lijst van een ander huishouden vóór het versturen.
      await form.locator('input[name="shoppingListId"]').evaluate((el, value) => {
        (el as HTMLInputElement).value = value;
      }, shoppingListB.id);

      await form.getByRole("button", { name: "Toevoegen" }).click();
      await pageA.waitForLoadState("load", { timeout: 15_000 }).catch(() => {});
      await contextA.close();
    });

    const linesBAfterQuickOrderAttack = await prisma.shoppingListLine.count({ where: { shoppingListId: shoppingListB.id } });
    assert.equal(
      linesBAfterQuickOrderAttack,
      linesBBeforeQuickOrderAttack,
      "huishouden A mag via addQuickOrderProduct nooit een regel in huishouden B's boodschappenlijst kunnen aanmaken"
    );

    let fixedLineAId = "";
    let fixedLineBId = "";
    let mealLineAId = "";

    await t.test("setup: beide huishoudens krijgen een actieve vaste boodschap, A ook een MEAL-regel", async () => {
      const ingredient = await prisma.ingredient.findFirstOrThrow({ where: { name: "Aardappelen" } });

      for (const householdId of [householdAId, householdBId]) {
        await prisma.fixedGrocery.upsert({
          where: { householdId_ingredientId: { householdId, ingredientId: ingredient.id } },
          update: { quantity: 1, unit: "PIECE" },
          create: { householdId, ingredientId: ingredient.id, quantity: 1, unit: "PIECE" },
        });
      }

      const shoppingListA = await prisma.shoppingList.findFirstOrThrow({ where: { mealPlan: { householdId: householdAId } } });
      const fixedLineA = await prisma.shoppingListLine.create({
        data: {
          shoppingListId: shoppingListA.id,
          ingredientId: ingredient.id,
          quantity: 1,
          unit: "PIECE",
          source: "FIXED",
          needsReview: false,
          matchStatus: "MANUALLY_SELECTED",
          matchConfidence: 1,
          matchReasons: ["e2e-test-setup"],
        },
      });
      fixedLineAId = fixedLineA.id;

      // Losstaande MEAL-regel voor A — nodig voor scenario 4 hieronder
      // ("een lineId van een niet-FIXED-regel wordt niet onbedoeld
      // verwijderd"). Hergebruikt hetzelfde ingrediënt; source is het enige
      // dat hier telt.
      const mealLineA = await prisma.shoppingListLine.create({
        data: {
          shoppingListId: shoppingListA.id,
          ingredientId: ingredient.id,
          quantity: 500,
          unit: "GRAM",
          source: "MEAL",
          needsReview: false,
          matchStatus: "MATCHED_TRUSTED",
          matchConfidence: 1,
          matchReasons: ["e2e-test-setup"],
        },
      });
      mealLineAId = mealLineA.id;

      const shoppingListB2 = await prisma.shoppingList.findFirstOrThrow({ where: { mealPlan: { householdId: householdBId } } });
      const fixedLineB = await prisma.shoppingListLine.create({
        data: {
          shoppingListId: shoppingListB2.id,
          ingredientId: ingredient.id,
          quantity: 1,
          unit: "PIECE",
          source: "FIXED",
          needsReview: false,
          matchStatus: "MANUALLY_SELECTED",
          matchConfidence: 1,
          matchReasons: ["e2e-test-setup"],
        },
      });
      fixedLineBId = fixedLineB.id;
    });

    const fixedGroceryCountBBeforeDeleteAttack = await prisma.fixedGrocery.count({ where: { householdId: householdBId } });

    await t.test("A probeert B's vaste boodschap voorgoed te verwijderen (via een vervalste lineId)", async () => {
      const contextA = await browser.newContext();
      const pageA = await contextA.newPage();
      await pageA.goto(`${server.baseURL}/login`, { waitUntil: "load" });
      await pageA.getByPlaceholder("Gebruikersnaam").fill("wp82a");
      await pageA.getByPlaceholder("Wachtwoord").fill("wp82awachtwoord");
      await pageA.getByRole("button", { name: "Openen" }).click();
      await pageA.waitForURL(`${server.baseURL}/`, { timeout: 15_000 });

      await pageA.goto(`${server.baseURL}/boodschappen`, { waitUntil: "load", timeout: 90_000 });
      await pageA.locator("#fixed-groceries summary").click();

      // Het formulier voor A's EIGEN actieve vaste boodschap bestaat echt op
      // de pagina (nodig om via de browser een geldige Server-Action-
      // aanroep te kunnen doen) — de aanval bestaat uit het overschrijven
      // van het verborgen lineId-veld met dat van huishouden B vóór het
      // versturen, exact dezelfde techniek als de aanval hierboven.
      const form = pageA
        .locator('#fixed-groceries form:has(input[name="householdId"]):has(input[name="lineId"])')
        .first();
      await form.waitFor({ state: "visible", timeout: 10_000 });
      await form.locator('input[name="lineId"]').evaluate((el, value) => {
        (el as HTMLInputElement).value = value;
      }, fixedLineBId);

      await form.getByRole("button", { name: "Verwijder voorgoed" }).click();
      await pageA.waitForLoadState("load", { timeout: 15_000 }).catch(() => {});
      await contextA.close();
    });

    const fixedLineBStillExists = await prisma.shoppingListLine.findUnique({ where: { id: fixedLineBId } });
    assert.ok(
      fixedLineBStillExists,
      "huishouden A mag huishouden B's vaste-boodschapregel niet kunnen verwijderen via een vervalste lineId"
    );
    const fixedGroceryCountBAfterDeleteAttack = await prisma.fixedGrocery.count({ where: { householdId: householdBId } });
    assert.equal(
      fixedGroceryCountBAfterDeleteAttack,
      fixedGroceryCountBBeforeDeleteAttack,
      "huishouden A mag de vaste-boodschap-standaard van huishouden B niet kunnen verwijderen"
    );
    const fixedLineAUntouched = await prisma.shoppingListLine.findUnique({ where: { id: fixedLineAId } });
    assert.ok(
      fixedLineAUntouched,
      "de geweigerde actie mag ook A's eigen vaste-boodschapregel niet hebben aangeraakt (geen partiële uitvoering)"
    );

    await t.test("A verwijdert daarna gewoon zijn eigen vaste boodschap (geldig gebruik blijft werken)", async () => {
      const contextA = await browser.newContext();
      const pageA = await contextA.newPage();
      await pageA.goto(`${server.baseURL}/login`, { waitUntil: "load" });
      await pageA.getByPlaceholder("Gebruikersnaam").fill("wp82a");
      await pageA.getByPlaceholder("Wachtwoord").fill("wp82awachtwoord");
      await pageA.getByRole("button", { name: "Openen" }).click();
      await pageA.waitForURL(`${server.baseURL}/`, { timeout: 15_000 });

      await pageA.goto(`${server.baseURL}/boodschappen`, { waitUntil: "load", timeout: 90_000 });
      await pageA.locator("#fixed-groceries summary").click();
      const form = pageA
        .locator('#fixed-groceries form:has(input[name="householdId"]):has(input[name="lineId"])')
        .first();
      await form.waitFor({ state: "visible", timeout: 10_000 });
      await form.getByRole("button", { name: "Verwijder voorgoed" }).click();
      await pageA.waitForURL((u) => u.searchParams.get("status") === "fixed-removed", { timeout: 15_000 });
      await contextA.close();
    });

    const fixedLineAAfterOwnDelete = await prisma.shoppingListLine.findUnique({ where: { id: fixedLineAId } });
    assert.equal(
      fixedLineAAfterOwnDelete,
      null,
      "een geldige verwijdering van de eigen vaste boodschap moet gewoon blijven werken"
    );

    const mealLineDeleteResult = await prisma.shoppingListLine.deleteMany({ where: { id: mealLineAId, source: "FIXED" } });
    assert.equal(
      mealLineDeleteResult.count,
      0,
      "een lineId van een niet-FIXED-regel mag nooit via de FIXED-only delete verdwijnen (bestaande, ongewijzigde loadFixedLine/deleteMany-scoping)"
    );
    const mealLineStillExists = await prisma.shoppingListLine.findUnique({ where: { id: mealLineAId } });
    assert.ok(mealLineStillExists, "de MEAL-regel van A moet intact blijven");

    // SYSTEM_AUDIT.md-vervolg (bevinding 3, "Gedeelde Ingredient-catalogus en
    // allergieveiligheid"): Ingredient heeft geen householdId (bewust
    // gedeelde catalogus), dus elk huishouden kon voorheen via
    // updateIngredient category/restrictionTags van ELK ingrediënt wijzigen
    // — de twee velden waarop harde allergie-/dieetfiltering draait (zie
    // src/lib/dietaryRestrictions.ts). De UI toont deze velden nu alleen
    // nog als alleen-lezen tekst, maar dat bewijst zelf niets over
    // serverbeveiliging (WORKFLOW.md: "vertrouw allergieveiligheid nooit op
    // alleen client-side beperkingen") — deze test vervalst daarom zelf
    // extra formuliervelden vóór het versturen, alsof een aanvaller de UI
    // volledig omzeilt en rechtstreeks post.
    const zalmfiletBefore = await prisma.ingredient.findFirstOrThrow({ where: { name: "Zalmfilet" } });
    assert.deepEqual(zalmfiletBefore.restrictionTags, ["vis"], "testaanname: Zalmfilet moet uit de seed 'vis' als restrictionTag hebben");

    await t.test("A probeert de restrictionTags/category van een gedeeld ingrediënt (Zalmfilet) te wijzigen", async () => {
      const contextA = await browser.newContext();
      const pageA = await contextA.newPage();
      await pageA.goto(`${server.baseURL}/login`, { waitUntil: "load" });
      await pageA.getByPlaceholder("Gebruikersnaam").fill("wp82a");
      await pageA.getByPlaceholder("Wachtwoord").fill("wp82awachtwoord");
      await pageA.getByRole("button", { name: "Openen" }).click();
      await pageA.waitForURL(`${server.baseURL}/`, { timeout: 15_000 });

      await pageA.goto(`${server.baseURL}/recepten`, { waitUntil: "load", timeout: 90_000 });
      // Exacte tekstmatch i.p.v. :has-text — die laatste matcht ook de
      // omringende "Geavanceerd..."-details (bevat deze tekst ergens in zijn
      // subtree), waardoor .first() per ongeluk steeds diezelfde buitenste
      // summary opnieuw raakt en hem meteen weer dichtklapt.
      await pageA.getByText("Geavanceerd ingrediënt- en productbeheer", { exact: true }).click();
      await pageA.getByText("Ingrediënten beheren", { exact: true }).click();

      const form = pageA.locator('form:has(input[name="name"][value="Zalmfilet"])').first();
      await form.waitFor({ state: "visible", timeout: 10_000 });

      // De aanval: velden toevoegen die de huidige (aangepaste) UI niet meer
      // rendert, maar die de server action vóór deze fix nog wel accepteerde.
      await form.evaluate((formEl) => {
        const restrictionTagsInput = document.createElement("input");
        restrictionTagsInput.type = "hidden";
        restrictionTagsInput.name = "restrictionTags";
        restrictionTagsInput.value = "";
        formEl.appendChild(restrictionTagsInput);

        const categoryInput = document.createElement("input");
        categoryInput.type = "hidden";
        categoryInput.name = "category";
        categoryInput.value = "OTHER";
        formEl.appendChild(categoryInput);
      });

      await form.getByRole("button", { name: "Opslaan" }).click();
      await pageA.waitForLoadState("load", { timeout: 15_000 }).catch(() => {});
      await contextA.close();
    });

    const zalmfiletAfter = await prisma.ingredient.findFirstOrThrow({ where: { name: "Zalmfilet" } });
    assert.deepEqual(
      zalmfiletAfter.restrictionTags,
      ["vis"],
      "een huishouden mag de restrictionTags van een gedeeld ingrediënt niet kunnen wijzigen, ook niet via vervalste formuliervelden"
    );
    assert.equal(
      zalmfiletAfter.category,
      "FISH",
      "een huishouden mag de category van een gedeeld ingrediënt niet kunnen wijzigen, ook niet via vervalste formuliervelden"
    );

    await t.test("A past wel gewoon de naam van hetzelfde ingrediënt aan (toegestaan veld blijft werken)", async () => {
      const contextA = await browser.newContext();
      const pageA = await contextA.newPage();
      await pageA.goto(`${server.baseURL}/login`, { waitUntil: "load" });
      await pageA.getByPlaceholder("Gebruikersnaam").fill("wp82a");
      await pageA.getByPlaceholder("Wachtwoord").fill("wp82awachtwoord");
      await pageA.getByRole("button", { name: "Openen" }).click();
      await pageA.waitForURL(`${server.baseURL}/`, { timeout: 15_000 });

      await pageA.goto(`${server.baseURL}/recepten`, { waitUntil: "load", timeout: 90_000 });
      // Exacte tekstmatch i.p.v. :has-text — die laatste matcht ook de
      // omringende "Geavanceerd..."-details (bevat deze tekst ergens in zijn
      // subtree), waardoor .first() per ongeluk steeds diezelfde buitenste
      // summary opnieuw raakt en hem meteen weer dichtklapt.
      await pageA.getByText("Geavanceerd ingrediënt- en productbeheer", { exact: true }).click();
      await pageA.getByText("Ingrediënten beheren", { exact: true }).click();

      const form = pageA.locator('form:has(input[name="name"][value="Zalmfilet"])').first();
      await form.waitFor({ state: "visible", timeout: 10_000 });
      await form.locator('input[name="name"]').fill("Zalmfilet (e2e-naamwijziging)");
      await form.getByRole("button", { name: "Opslaan" }).click();
      await pageA.waitForURL((u) => u.searchParams.get("status") === "ingredient-updated", { timeout: 15_000 });
      await contextA.close();
    });

    const zalmfiletAfterRename = await prisma.ingredient.findUniqueOrThrow({ where: { id: zalmfiletBefore.id } });
    assert.equal(
      zalmfiletAfterRename.name,
      "Zalmfilet (e2e-naamwijziging)",
      "name is niet veiligheidskritiek en moet gewoon aanpasbaar blijven"
    );
    // Naam voor eventuele volgende testruns weer terugzetten.
    await prisma.ingredient.update({ where: { id: zalmfiletBefore.id }, data: { name: "Zalmfilet" } });

    // SYSTEM_AUDIT.md-vervolg (bevinding 4, "Veilige wachtwoordhashing"):
    // credentials.test.ts dekt hashHouseholdPassword/verifyHouseholdPassword
    // al als pure functies, maar niet de volledige, live inlogflow
    // (src/lib/auth.ts's signInByCredentials leunt op next/headers, zie de
    // toelichting bovenaan dit bestand) — dus ook niet de daadwerkelijke
    // herhash-transactie die daar bovenop komt. Dit huishouden wordt bewust
    // met een rechtstreekse Prisma-insert aangemaakt (niet via onboarding,
    // die gebruikt nu altijd het nieuwe formaat) om een écht, nog niet
    // gemigreerd productiehuishouden na te bootsen.
    let legacyHouseholdId = "";
    try {
      const legacyUsername = `wp82legacy${Date.now()}`;
      const legacyPassword = "oudwachtwoord123";
      const legacyHousehold = await prisma.household.create({
        data: { name: `WP-A4 Legacy ${Date.now()}`, username: legacyUsername, onboardingStatus: "COMPLETED" },
      });
      legacyHouseholdId = legacyHousehold.id;
      const legacyHash = crypto
        .createHash("sha256")
        .update(`${legacyHousehold.id}:${legacyPassword}`)
        .digest("hex");
      await prisma.household.update({ where: { id: legacyHousehold.id }, data: { passwordHash: legacyHash } });

      await t.test("een huishouden met een legacy sha256-hash kan nog inloggen en de hash wordt daarna gemigreerd", async () => {
        const context = await browser.newContext();
        const page = await context.newPage();
        await page.goto(`${server.baseURL}/login`, { waitUntil: "load" });
        await page.getByPlaceholder("Gebruikersnaam").fill(legacyUsername);
        await page.getByPlaceholder("Wachtwoord").fill(legacyPassword);
        await page.getByRole("button", { name: "Openen" }).click();
        await page.waitForURL(`${server.baseURL}/`, { timeout: 15_000 });
        await context.close();
      });

      const afterLogin = await prisma.household.findUniqueOrThrow({ where: { id: legacyHouseholdId } });
      assert.match(
        afterLogin.passwordHash ?? "",
        /^scrypt\$/,
        "een geslaagde legacy-login moet de hash meteen naar het nieuwe scrypt-formaat migreren"
      );
    } finally {
      if (legacyHouseholdId) await deleteTestHousehold(legacyHouseholdId);
    }

    // SYSTEM_AUDIT.md-vervolg ("Login rate limiting" — WP-vervolg deel A5):
    // loginRateLimit.test.ts dekt de zuivere teller-functies al met
    // geïnjecteerde tijdstippen, maar niet de daadwerkelijke koppeling in
    // signInByCredentials (src/lib/auth.ts) — die leunt op next/headers en
    // is dus alleen via een echte browsersessie te testen, net als de
    // legacy-migratie hierboven. Dit huishouden wordt bewust met een
    // rechtstreekse Prisma-insert (nieuw scrypt-formaat) aangemaakt.
    let rateLimitHouseholdId = "";
    try {
      const rlUsername = `wp82ratelimit${Date.now()}`;
      const rlPassword = "geldigwachtwoord123";
      const rlHousehold = await prisma.household.create({
        data: {
          name: `WP-A5 Rate limit ${Date.now()}`,
          username: rlUsername,
          passwordHash: hashHouseholdPassword(rlPassword),
          onboardingStatus: "COMPLETED",
        },
      });
      rateLimitHouseholdId = rlHousehold.id;

      await t.test("na genoeg mislukte pogingen wordt zelfs het juiste wachtwoord tijdelijk geblokkeerd", async () => {
        const context = await browser.newContext();
        const page = await context.newPage();
        for (let i = 0; i < 8; i += 1) {
          await page.goto(`${server.baseURL}/login`, { waitUntil: "load" });
          await page.getByPlaceholder("Gebruikersnaam").fill(rlUsername);
          await page.getByPlaceholder("Wachtwoord").fill("ditIsFoutieve1");
          await page.getByRole("button", { name: "Openen" }).click();
          await page.waitForURL(`${server.baseURL}/login?status=wrong-credentials`, { timeout: 15_000 });
        }

        // Het juiste wachtwoord mag een actieve blokkering niet omzeilen —
        // anders zou de limiter alleen fout wachtwoorden tegenhouden en niet
        // écht tegen brute force beschermen.
        await page.goto(`${server.baseURL}/login`, { waitUntil: "load" });
        await page.getByPlaceholder("Gebruikersnaam").fill(rlUsername);
        await page.getByPlaceholder("Wachtwoord").fill(rlPassword);
        await page.getByRole("button", { name: "Openen" }).click();
        // Dezelfde generieke foutmelding als bij een fout wachtwoord — een
        // aparte "geblokkeerd"-tekst zou zelf al iets prijsgeven.
        await page.waitForURL(`${server.baseURL}/login?status=wrong-credentials`, { timeout: 15_000 });

        await context.close();
      });

      await clearLoginAttempts(rlUsername);

      await t.test("na het wissen van de teller werkt het juiste wachtwoord weer gewoon", async () => {
        const context = await browser.newContext();
        const page = await context.newPage();
        await page.goto(`${server.baseURL}/login`, { waitUntil: "load" });
        await page.getByPlaceholder("Gebruikersnaam").fill(rlUsername);
        await page.getByPlaceholder("Wachtwoord").fill(rlPassword);
        await page.getByRole("button", { name: "Openen" }).click();
        await page.waitForURL(`${server.baseURL}/`, { timeout: 15_000 });
        await context.close();
      });
    } finally {
      await prisma.loginAttempt.deleteMany({ where: { identifier: { startsWith: "wp82ratelimit" } } });
      if (rateLimitHouseholdId) await deleteTestHousehold(rateLimitHouseholdId);
    }
  } finally {
    await browser.close();
    await server.close();
    await mockPicnic.close();
    if (householdAId) await deleteTestHousehold(householdAId);
    if (householdBId) await deleteTestHousehold(householdBId);
    if (!householdAId && !householdBId) await cleanupMockProducts();
    await prisma.$disconnect();
  }
});
