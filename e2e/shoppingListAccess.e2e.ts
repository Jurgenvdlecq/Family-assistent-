import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium, type Browser } from "playwright";
import { prisma } from "@/lib/prisma";
import { startMockPicnicServer, type MockPicnicServer } from "./fixtures/mockPicnicServer";
import { startTestServer, type TestServer } from "./fixtures/testServer";
import { completeOnboardingViaUi, deleteTestHousehold, cleanupMockProducts } from "./fixtures/testHousehold";

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
