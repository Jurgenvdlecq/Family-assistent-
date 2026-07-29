import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium, type Browser, type Page } from "playwright";
import { prisma } from "@/lib/prisma";
import { startMockPicnicServer, type MockPicnicServer } from "./fixtures/mockPicnicServer";
import { startTestServer, type TestServer } from "./fixtures/testServer";
import { completeOnboardingViaUi, deleteTestHousehold, cleanupMockProducts } from "./fixtures/testHousehold";

/**
 * End-to-end test voor de kritieke gebruikersflow uit Fase 15 van
 * AGENTS.md: onboarding, weekmenu bekijken, gerecht vervangen, boodschappen
 * opbouwen, vaste boodschappen/extra producten toevoegen (in deze app één
 * flow — zie stap 5), voorraad aanpassen, een twijfelproduct corrigeren,
 * het mandje vullen en een fout herstellen (mandje legen).
 *
 * Draait tegen een eigen productiebuild (`next build && next start` — zie
 * `npm run test:e2e`) op een losse poort, en een lokale mock-Picnic-server
 * (geen live Picnic-account nodig, zie fixtures/mockPicnicServer.ts).
 * Gebruikt een vers aangemaakt, geïsoleerd testhuishouden en ruimt zichzelf
 * op, ook de tijdelijke Picnic-testproducten in de gedeelde catalogus.
 *
 * Bewust een productiebuild i.p.v. `next dev`: de dev-server se eigen
 * live-herlaad-websocket bleek zich in deze omgeving onvoorspelbaar te
 * gedragen (zie next.config.ts voor de gerelateerde devIndicators-fix) en
 * kon de hele React-hydratatie laten hangen. Een productiebuild heeft die
 * websocket niet nodig, hydrateert betrouwbaar en is ook sneller.
 */

const TEST_PORT = 3177;
const HOUSEHOLD_NAME = `E2E Testgezin ${Date.now()}`;
const ACCESS_CODE = "e2etest123";
const MOCK_SEARCH_TERM = "aardappelen"; // bestaand, gedeeld seed-ingrediënt — voorkomt vervuiling van de ingrediëntencatalogus.

test("Kritieke gebruikersflow (Fase 15)", { timeout: 180_000 }, async (t) => {
  await cleanupMockProducts();

  const mockPicnic: MockPicnicServer = await startMockPicnicServer();
  const server: TestServer = await startTestServer({ port: TEST_PORT, picnicBaseUrl: mockPicnic.url });
  const browser: Browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  const page: Page = await browser.newPage({ viewport: { width: 420, height: 1400 } });

  let householdId = "";

  try {
    await t.test("1. Onboarding: nieuw huishouden aanmaken", async () => {
      const household = await completeOnboardingViaUi(page, server.baseURL, HOUSEHOLD_NAME, ACCESS_CODE);
      householdId = household.id;
      assert.ok(householdId, "Onboarding moet een huishouden aanmaken en terugleiden naar /");
      assert.equal(page.url(), `${server.baseURL}/`);

      // Fase 15: tests mogen niet van een live Picnic-account afhangen. Een
      // nep-token koppelen zorgt dat de Picnic-stappen hieronder (5, 8, 9)
      // tegen de lokale mock draaien i.p.v. een echt account te vereisen.
      await prisma.household.update({
        where: { id: householdId },
        data: { picnicAuthToken: "e2e-mock-token" },
      });

      // ensureMealPlan() genereert de allereerste weekplanning van een vers
      // huishouden vanaf hier: score elk recept in de hele catalogus, voor
      // elke dag — merkbaar trager dan een normaal paginabezoek later. Warm
      // dit hier alvast op (met een ruime, eigen timeout, buiten stap 2 om)
      // zodat die stap zelf niet onnodig een trage cold start hoeft te
      // verdragen. Via `page` (niet een losse fetch): de sessiecookie van
      // de zojuist voltooide onboarding staat alleen in de browsercontext.
      await page.goto(`${server.baseURL}/`, { waitUntil: "load", timeout: 90_000 });

      // /gerechten scoort en rangschikt onafhankelijk de hele receptcatalogus
      // (zie stap 3) en heeft dezelfde eerste-bezoek-cold-start als hierboven
      // — hier alvast opwarmen voorkomt dat stap 3 zelf die kost moet dragen.
      await page.goto(`${server.baseURL}/gerechten?day=monday&direction=day`, {
        waitUntil: "load",
        timeout: 90_000,
      });
    });

    await t.test("2. Weekmenu bekijken", async () => {
      await page.goto(`${server.baseURL}/`, { waitUntil: "load" });
      await page.locator("text=Jullie weekmenu").waitFor({ state: "visible", timeout: 20_000 });
      const replaceLinks = page.locator('a[aria-label^="Vervang "]');
      await replaceLinks.first().waitFor({ state: "visible" });
      assert.equal(await replaceLinks.count(), 7, "Elke dag van de week moet een 'Vervang'-actie hebben");
    });

    await t.test("3. Gerecht vervangen", async () => {
      await page.getByRole("link", { name: "Vervang maandag" }).click();
      await page.waitForURL(/\/gerechten\?/, { timeout: 15_000 });

      // /gerechten scoort en rangschikt alle suggesties uit de hele
      // receptcatalogus bij elk bezoek — net als de eerste weekplanning
      // (stap 1/2) kan dat op deze sandbox langer duren dan een normaal
      // paginabezoek elders in de flow.
      const kiesButton = page.getByRole("button", { name: "Kies" }).first();
      await kiesButton.waitFor({ state: "visible", timeout: 30_000 });
      await kiesButton.click();

      await page.waitForURL((url) => url.searchParams.has("status"), { timeout: 15_000 });
      const confirmed = page
        .locator("text=Gerecht gewisseld.")
        .or(page.locator("text=Dit gerecht stond al op die dag."));
      await confirmed.first().waitFor({ state: "visible", timeout: 5_000 });
    });

    await t.test("4. Boodschappen opbouwen", async () => {
      await page.goto(`${server.baseURL}/boodschappen`, { waitUntil: "load" });
      await page.locator("text=Jullie boodschappenlijst").waitFor({ state: "visible" });

      const shoppingList = await prisma.shoppingList.findFirst({
        where: { mealPlan: { householdId } },
        include: { lines: true },
      });
      assert.ok(shoppingList, "ensureShoppingList moet een lijst hebben aangemaakt bij het bezoeken van /boodschappen");
      assert.ok(shoppingList!.lines.length > 0, "De boodschappenlijst moet regels bevatten op basis van het weekmenu");
    });

    await t.test("5. Vaste boodschap / extra product toevoegen (via Picnic-zoeken)", async () => {
      await page.locator("#add-fixed-grocery summary").click();
      const searchInput = page.getByPlaceholder("Zoek Picnic-product, bv. appels");
      await searchInput.waitFor({ state: "visible" });
      await searchInput.fill(MOCK_SEARCH_TERM);
      await page.getByRole("button", { name: "Zoeken bij Picnic" }).click();
      await page.waitForURL((url) => url.searchParams.get("fixedQ") === MOCK_SEARCH_TERM, { timeout: 15_000 });

      const chooseButton = page.getByRole("button", { name: "Kies als vaste boodschap" }).first();
      await chooseButton.waitFor({ state: "visible", timeout: 10_000 });
      await chooseButton.click();
      await page.waitForURL((url) => url.searchParams.has("status"), { timeout: 15_000 });

      const fixedGrocery = await prisma.fixedGrocery.findFirst({
        where: { householdId, ingredient: { name: "Aardappelen" } },
      });
      assert.ok(fixedGrocery, "De gekozen vaste boodschap moet zijn opgeslagen");
    });

    await t.test("6. Voorraad aanpassen", async () => {
      await page.goto(`${server.baseURL}/boodschappen`, { waitUntil: "load" });
      await page.locator("#inventory-check summary").click();

      const lowButton = page.locator("#inventory-check").getByRole("button", { name: "Bijna op" }).first();
      await lowButton.waitFor({ state: "visible", timeout: 10_000 });
      await lowButton.click();

      await page.waitForURL((url) => url.searchParams.get("status") === "inventory-updated", { timeout: 15_000 });
      await page.locator("text=Voorraadstatus opgeslagen.").waitFor({ state: "visible", timeout: 5_000 });
    });

    await t.test("7. Twijfelproduct corrigeren", async () => {
      await page.goto(`${server.baseURL}/controle`, { waitUntil: "load" });

      const reviewCountBefore = await prisma.shoppingListLine.count({
        where: { shoppingList: { mealPlan: { householdId } }, needsReview: true },
      });
      assert.ok(reviewCountBefore > 0, "Een vers huishouden zonder onthouden voorkeuren moet minstens één te controleren regel hebben");

      const confirmButton = page.getByRole("button", { name: "Kies en onthoud" }).first();
      await confirmButton.waitFor({ state: "visible", timeout: 10_000 });
      await confirmButton.click();
      await page.waitForURL((url) => url.searchParams.has("status"), { timeout: 15_000 });

      const reviewCountAfter = await prisma.shoppingListLine.count({
        where: { shoppingList: { mealPlan: { householdId } }, needsReview: true },
      });
      assert.ok(reviewCountAfter < reviewCountBefore, "Het aantal te controleren regels moet afnemen na een bevestigde keuze");
    });

    await t.test("8. Mandje vullen", async () => {
      await page.goto(`${server.baseURL}/boodschappen`, { waitUntil: "load" });

      const addButton = page.getByRole("button", { name: "Toevoegen aan Picnic-mandje" });
      await addButton.waitFor({ state: "visible", timeout: 10_000 });
      await addButton.click();

      const confirmButton = page.getByRole("button", { name: "Ja, voeg toe aan mandje" });
      await confirmButton.waitFor({ state: "visible", timeout: 10_000 });
      await confirmButton.click();

      await page.locator("text=toegevoegd aan je Picnic-mandje.").waitFor({ state: "visible", timeout: 15_000 });
      assert.ok(mockPicnic.addedProducts.length > 0, "De mock-Picnic-server moet minstens één add_product-aanroep hebben ontvangen");
    });

    await t.test("9. Fout herstellen: mandje legen", async () => {
      await page.getByRole("button", { name: "Picnic-mandje legen" }).click();
      const confirmClear = page.getByRole("button", { name: "Ja, mandje legen" });
      await confirmClear.waitFor({ state: "visible", timeout: 5_000 });
      await confirmClear.click();

      await page.locator("text=Mandje geleegd.").waitFor({ state: "visible", timeout: 15_000 });
      assert.equal(mockPicnic.addedProducts.length, 0, "Het mock-mandje moet leeg zijn nadat het geleegd is");
    });
  } finally {
    await browser.close();
    await server.close();
    await mockPicnic.close();
    if (householdId) await deleteTestHousehold(householdId);
    else await cleanupMockProducts();
    // Prisma's gedeelde client houdt anders een open databaseverbinding aan
    // (bewust, voor Next.js' hot-reload) — in een losstaand testscript
    // voorkomt dat de proces zichzelf ooit afsluit.
    await prisma.$disconnect();
  }
});
