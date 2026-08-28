import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium, type Browser, type Page } from "playwright";
import { prisma } from "@/lib/prisma";
import { currentDayKey, DAY_LABELS, DAY_ENUM } from "@/lib/week";
import { startMockPicnicServer, type MockPicnicServer } from "./fixtures/mockPicnicServer";
import { startTestServer, type TestServer } from "./fixtures/testServer";
import { completeOnboardingViaUi, deleteTestHousehold, cleanupMockProducts } from "./fixtures/testHousehold";

/**
 * End-to-end test voor de kritieke gebruikersflow uit Fase 15 van
 * PROJECT_BLUEPRINT.md: onboarding, weekmenu bekijken, gerecht vervangen, boodschappen
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
const USERNAME = "e2etest";
const PASSWORD = "e2etest123";
const MOCK_SEARCH_TERM = "aardappelen"; // bestaand, gedeeld seed-ingrediënt — voorkomt vervuiling van de ingrediëntencatalogus.

/** Het beheerblok op /boodschappen staat ingeklapt; alles erbinnen is pas
 *  zichtbaar als het open staat. Idempotent: veilig meerdere keren aan te
 *  roepen, ook als een eerdere stap 'm al opende. */
async function openBeheer(target: Page) {
  await target.locator("#beheer").evaluate((el) => {
    (el as HTMLDetailsElement).open = true;
  });
}

test("Kritieke gebruikersflow (Fase 15)", { timeout: 180_000 }, async (t) => {
  await cleanupMockProducts();

  const mockPicnic: MockPicnicServer = await startMockPicnicServer();
  const server: TestServer = await startTestServer({ port: TEST_PORT, picnicBaseUrl: mockPicnic.url });
  const browser: Browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  const page: Page = await browser.newPage({ viewport: { width: 420, height: 1400 } });

  let householdId = "";

  try {
    await t.test("1. Onboarding: nieuw huishouden aanmaken", async () => {
      const household = await completeOnboardingViaUi(page, server.baseURL, HOUSEHOLD_NAME, USERNAME, PASSWORD);
      householdId = household.id;
      assert.ok(householdId, "Onboarding moet een huishouden aanmaken en terugleiden naar de startpagina");
      assert.equal(page.url(), `${server.baseURL}/boodschappen`);

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
      await page.goto(`${server.baseURL}/week`, { waitUntil: "load", timeout: 90_000 });

      // /gerechten scoort en rangschikt onafhankelijk de hele receptcatalogus
      // (zie stap 3) en heeft dezelfde eerste-bezoek-cold-start als hierboven
      // — hier alvast opwarmen voorkomt dat stap 3 zelf die kost moet dragen.
      await page.goto(`${server.baseURL}/gerechten?day=monday&direction=day`, {
        waitUntil: "load",
        timeout: 90_000,
      });
    });

    await t.test("1b. Onboarding weigert niet-overeenkomende wachtwoorden", async () => {
      // UX-bugfix: vóór deze fix was er maar één wachtwoordveld — een
      // typefout leidde tot een account waar niemand meer in kon, zonder
      // hersteloptie. Bewijst dat de nieuwe "Bevestig wachtwoord"-check
      // daadwerkelijk blokkeert (geen huishouden aangemaakt, geen redirect
      // naar "/") vóórdat er ooit een server-aanroep gebeurt.
      await page.goto(`${server.baseURL}/onboarding`, { waitUntil: "load" });
      await page.getByRole("button", { name: "Volgende" }).click();
      await page.getByPlaceholder("Bijvoorbeeld: Familie Van der Lecq").fill(`${HOUSEHOLD_NAME} (mismatch)`);
      await page.getByRole("button", { name: "Volgende" }).click();
      await page.getByPlaceholder("Naam").fill("Testouder");
      await page.getByRole("button", { name: "Volgende" }).click();
      await page.getByRole("button", { name: "Volgende" }).click();

      await page.getByPlaceholder("Gebruikersnaam (minimaal 3 tekens)").fill("mismatchtest");
      await page.getByPlaceholder("Wachtwoord (minimaal 6 tekens)").fill(PASSWORD);
      await page.getByPlaceholder("Bevestig wachtwoord").fill(`${PASSWORD}-anders`);

      // Zolang de velden niet overeenkomen staat de knop uit — de gebruiker
      // ziet de fout dus al vóórdat die per ongeluk kan versturen, i.p.v.
      // pas na een klik een foutmelding te krijgen.
      const submitButton = page.getByRole("button", { name: "Maak mijn eerste week" });
      assert.equal(
        await submitButton.isDisabled(),
        true,
        "De submitknop moet uitstaan zolang de wachtwoorden niet overeenkomen"
      );
      assert.ok(page.url().includes("/onboarding"), "Bij niet-overeenkomende wachtwoorden mag er geen redirect zijn");

      // Wachtwoord corrigeren maakt de knop weer bruikbaar (en het bewijst
      // meteen dat de disabled-check niet per ongeluk permanent blokkeert).
      await page.getByPlaceholder("Bevestig wachtwoord").fill(PASSWORD);
      assert.equal(
        await submitButton.isDisabled(),
        false,
        "De submitknop moet weer aanstaan zodra de wachtwoorden wél overeenkomen"
      );

      const household = await prisma.household.findFirst({ where: { name: `${HOUSEHOLD_NAME} (mismatch)` } });
      assert.equal(household, null, "Er mag geen huishouden zijn aangemaakt vóórdat er daadwerkelijk verzonden is");
    });

    await t.test(
      "1c. Picnic koppelen kan al tijdens onboarding, direct na het aanmaken van het account (nieuwe functie)",
      async () => {
        const picnicHouseholdName = `${HOUSEHOLD_NAME} (picnic-onboarding)`;
        // Eigen, volledig geïsoleerde browserpagina (eigen browsercontext,
        // eigen cookies): deze substap maakt een tweede huishouden aan en
        // koppelt Picnic — dat mag de sessie van de gedeelde `page`
        // (het hoofdtesthuishouden, `householdId`) niet aanraken.
        const onboardingPage = await browser.newPage({ viewport: { width: 420, height: 1400 } });
        try {
          await onboardingPage.goto(`${server.baseURL}/onboarding`, { waitUntil: "load" });
          await onboardingPage.getByRole("button", { name: "Volgende" }).click();
          await onboardingPage.getByPlaceholder("Bijvoorbeeld: Familie Van der Lecq").fill(picnicHouseholdName);
          await onboardingPage.getByRole("button", { name: "Volgende" }).click();
          await onboardingPage.getByPlaceholder("Naam").fill("Testouder2");
          await onboardingPage.getByRole("button", { name: "Volgende" }).click();
          await onboardingPage.getByRole("button", { name: "Volgende" }).click();
          await onboardingPage.getByPlaceholder("Gebruikersnaam (minimaal 3 tekens)").fill("e2epicnicquick");
          await onboardingPage.getByPlaceholder("Wachtwoord (minimaal 6 tekens)").fill(PASSWORD);
          await onboardingPage.getByPlaceholder("Bevestig wachtwoord").fill(PASSWORD);
          await onboardingPage.getByRole("button", { name: "Maak mijn eerste week" }).click();

          await onboardingPage.waitForURL(`${server.baseURL}/onboarding/picnic`, { timeout: 30_000 });
          await onboardingPage.locator("text=Koppel je Picnic-account").waitFor({ state: "visible", timeout: 10_000 });

          await onboardingPage.getByPlaceholder("Picnic e-mailadres").fill("test@example.com");
          await onboardingPage.getByPlaceholder("Picnic wachtwoord").fill("irrelevant-in-mock");
          await onboardingPage.getByRole("button", { name: "Koppelen" }).click();

          // Bij een geslaagde koppeling redirect de tussenpagina zelf meteen
          // door naar "/" — geen apart "gekoppeld"-tussenscherm nodig (zie
          // onboarding/picnic/page.tsx: al gekoppeld -> redirect).
          await onboardingPage.waitForURL(`${server.baseURL}/boodschappen`, { timeout: 15_000 });

          const picnicHousehold = await prisma.household.findFirstOrThrow({
            where: { name: picnicHouseholdName },
          });
          assert.ok(
            picnicHousehold.picnicAuthToken,
            "Na koppelen tijdens onboarding moet het huishouden een Picnic-token hebben"
          );

          await prisma.household.delete({ where: { id: picnicHousehold.id } });
        } finally {
          await onboardingPage.close();
        }
      }
    );

    await t.test("2. Weekmenu bekijken", async () => {
      await page.goto(`${server.baseURL}/week`, { waitUntil: "load" });
      await page.locator("text=Jullie weekmenu").waitFor({ state: "visible", timeout: 20_000 });
      const replaceLinks = page.locator('a[aria-label^="Vervang "]');
      await replaceLinks.first().waitFor({ state: "visible" });
      assert.equal(await replaceLinks.count(), 7, "Elke dag van de week moet een 'Vervang'-actie hebben");
    });

    await t.test("2b. Voorkeur zetten blijft op dezelfde dag i.p.v. terug naar boven springen (UX-bugfix)", async () => {
      await page.goto(`${server.baseURL}/week`, { waitUntil: "load" });
      const tuesdayBlock = page.locator("#day-tuesday");
      await tuesdayBlock.waitFor({ state: "visible", timeout: 15_000 });
      await tuesdayBlock.getByText("Meer voor deze dag").click();

      const stanceButton = tuesdayBlock.getByRole("button", { name: "Oké" }).first();
      await stanceButton.waitFor({ state: "visible", timeout: 10_000 });
      await stanceButton.click();

      await page.waitForURL((url) => url.searchParams.get("focusDay") === "tuesday", { timeout: 15_000 });
      assert.ok(
        page.url().endsWith("#day-tuesday"),
        "Moet teruggaan naar dezelfde dag i.p.v. bovenaan de startpagina te belanden"
      );

      // "Meer voor deze dag" moet nog open staan, zodat je meteen door kunt
      // met de volgende voorkeur i.p.v. 'm opnieuw te moeten openklappen.
      const detailsOpen = await tuesdayBlock
        .locator("details", { hasText: "Meer voor deze dag" })
        .evaluate((el) => (el as HTMLDetailsElement).open);
      assert.equal(detailsOpen, true, "'Meer voor deze dag' moet open blijven staan na het zetten van een voorkeur");
    });

    await t.test("2c. 'Uit eten' scrollt terug naar de dag zonder ongevraagd 'Meer voor deze dag' te openen (UX-bugfix)", async () => {
      await page.goto(`${server.baseURL}/week`, { waitUntil: "load" });
      const wednesdayBlock = page.locator("#day-wednesday");
      await wednesdayBlock.waitFor({ state: "visible", timeout: 15_000 });

      // De knop heeft een aria-label ("We eten woensdag niet thuis") dat de
      // zichtbare tekst ("Uit eten") overschrijft als toegankelijke naam.
      const skipButton = wednesdayBlock.getByRole("button", { name: "We eten woensdag niet thuis" });
      await skipButton.waitFor({ state: "visible", timeout: 10_000 });
      await skipButton.click();

      await page.waitForURL((url) => url.searchParams.get("focusDay") === "wednesday", { timeout: 15_000 });
      assert.ok(page.url().endsWith("#day-wednesday"), "Moet teruggaan naar dezelfde dag");

      const detailsOpen = await wednesdayBlock
        .locator("details", { hasText: "Meer voor deze dag" })
        .evaluate((el) => (el as HTMLDetailsElement).open);
      assert.equal(
        detailsOpen,
        false,
        "'Uit eten' hoort niet ongevraagd 'Meer voor deze dag' open te klappen (code-review-bevinding)"
      );

      // Weer terugzetten, zodat latere stappen (bv. boodschappenlijst
      // opbouwen) een normale, niet-overgeslagen week aantreffen.
      const restoreButton = wednesdayBlock.getByRole("button", { name: "Zet woensdag terug in de planning" });
      await restoreButton.waitFor({ state: "visible", timeout: 10_000 });
      await restoreButton.click();
      await page.waitForURL((url) => url.searchParams.get("status") === "day-restored", { timeout: 15_000 });
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

      // Gebruikersverzoek: een voltooide gerechtwissel gaat terug naar het
      // weekmenu i.p.v. op /gerechten te blijven staan — en landt meteen op
      // de juiste dag (focusDay + #day-<dag>), niet bovenaan de pagina.
      await page.waitForURL((url) => url.pathname === "/week" && url.searchParams.get("focusDay") === "monday", {
        timeout: 15_000,
      });
      assert.ok(page.url().endsWith("#day-monday"), "Moet landen op de aangepaste dag, niet bovenaan de pagina");
      const confirmed = page
        .locator("text=Gerecht gewisseld.")
        .or(page.locator("text=Dit gerecht stond al op die dag."));
      await confirmed.first().waitFor({ state: "visible", timeout: 5_000 });

      // Nog een dag aanpassen kost nog steeds maar één klik — bewijst dat de
      // volledige heen-en-terug-flow ook een tweede keer gewoon werkt.
      await page.getByRole("link", { name: "Vervang dinsdag" }).click();
      await page.waitForURL(/\/gerechten\?/, { timeout: 15_000 });
      const secondKiesButton = page.getByRole("button", { name: "Kies" }).first();
      await secondKiesButton.waitFor({ state: "visible", timeout: 30_000 });
      await secondKiesButton.click();
      await page.waitForURL((url) => url.pathname === "/week" && url.searchParams.get("focusDay") === "tuesday", {
        timeout: 15_000,
      });
      assert.ok(page.url().endsWith("#day-tuesday"), "Moet ook de tweede keer op de juiste dag landen");
    });

    await t.test("3b. /gerechten zonder ?day= valt terug op vandaag, niet altijd op maandag (UX-bugfix)", async () => {
      await page.goto(`${server.baseURL}/gerechten`, { waitUntil: "load" });
      const expectedLabel = DAY_LABELS[currentDayKey()];
      await page
        .locator("text=" + `Vervangen voor ${expectedLabel}`)
        .waitFor({ state: "visible", timeout: 10_000 });
    });

    await t.test(
      "3c. Geen 'waarom wil je wisselen?'-stap bij een lege dag (UX-bugfix)",
      async () => {
        // Forceer een dag zonder gepland gerecht — in een vers huishouden is
        // elke dag altijd al ingevuld, dus dat kan alleen via een directe
        // DB-manipulatie (net als eerdere e2e-testopzetten in dit bestand).
        const mealPlan = await prisma.mealPlan.findFirstOrThrow({ where: { householdId } });
        await prisma.mealPlanEntry.deleteMany({ where: { mealPlanId: mealPlan.id, dayOfWeek: DAY_ENUM.sunday } });

        await page.goto(`${server.baseURL}/gerechten?day=sunday`, { waitUntil: "load" });
        const kiesButton = page.getByRole("button", { name: "Kies" }).first();
        await kiesButton.waitFor({ state: "visible", timeout: 30_000 });

        const reasonSelect = page.getByLabel("Waarom wil je wisselen?");
        assert.equal(await reasonSelect.count(), 0, "Bij een lege dag hoort er geen 'waarom wil je wisselen?'-stap te zijn");

        await kiesButton.click();
        await page.waitForURL((url) => url.searchParams.get("status") === "meal-replaced", { timeout: 15_000 });

        const filledEntry = await prisma.mealPlanEntry.findFirst({
          where: { mealPlanId: mealPlan.id, dayOfWeek: DAY_ENUM.sunday },
        });
        assert.ok(filledEntry, "Kiezen zonder reden-veld moet de dag alsnog gewoon invullen");
      }
    );

    await t.test(
      "3d. Avondeten aanzetten via de dagkeuze zet de boodschappen ervoor op de lijst (nieuwe functie)",
      async () => {
        // Sinds de koerswijziging "boodschappen eerst" is avondeten opt-in per
        // avond: een verse week levert alleen vaste boodschappen op. Deze stap
        // bewijst dat, tikt daarna de avonden van déze week aan, en bewijst dat
        // er dan wél receptregels op de lijst komen.
        await page.goto(`${server.baseURL}/boodschappen`, { waitUntil: "load" });
        await page.locator("text=Kook je zelf?").waitFor({ state: "visible", timeout: 15_000 });

        const mealLinesBefore = await prisma.shoppingListLine.count({
          where: { shoppingList: { mealPlan: { householdId } }, source: "MEAL" },
        });
        assert.equal(mealLinesBefore, 0, "Zonder aangevinkte avonden horen er geen weekmenu-regels op de lijst te staan");

        // Alleen de dagen van deze week: een dag in de volgende week zou een
        // compleet nieuw weekplan laten genereren, wat deze stap traag maakt
        // en niets extra's bewijst (de weekgrens heeft een eigen stap).
        // Bewust wachten op de knop zelf en niet op ?status= in de URL: die
        // staat er na de eerste klik al, waardoor een volgende wachtactie
        // meteen terugkeert op een pagina die nog niet herladen is.
        let clicked = 0;
        for (let guard = 0; guard < 7; guard += 1) {
          const next = page.locator('button[data-next-week="false"][aria-pressed="false"]').first();
          if ((await next.count()) === 0) break;
          const dayToSelect = await next.getAttribute("data-order-day");
          await next.click();
          await page
            .locator(`button[data-order-day="${dayToSelect}"][aria-pressed="true"]`)
            .waitFor({ state: "visible", timeout: 15_000 });
          clicked += 1;
        }
        assert.ok(clicked > 0, "Er moet minstens één avond van deze week aan te tikken zijn");

        const mealLinesAfter = await prisma.shoppingListLine.count({
          where: { shoppingList: { mealPlan: { householdId } }, source: "MEAL" },
        });
        assert.ok(
          mealLinesAfter > 0,
          "Na het aantikken van de avonden moeten de boodschappen voor die gerechten op de lijst staan"
        );

        // Uitzetten moet het ook echt terugdraaien — en het geplande gerecht
        // laten staan (dat is het verschil met "uit eten").
        const firstSelected = page.locator('button[data-next-week="false"][aria-pressed="true"]').first();
        const isoDate = await firstSelected.getAttribute("data-order-day");
        await firstSelected.click();
        await page
          .locator(`button[data-order-day="${isoDate}"][aria-pressed="false"]`)
          .waitFor({ state: "visible", timeout: 15_000 });

        const mealLinesAfterRemoval = await prisma.shoppingListLine.count({
          where: { shoppingList: { mealPlan: { householdId } }, source: "MEAL" },
        });
        assert.ok(
          mealLinesAfterRemoval < mealLinesAfter,
          "Een avond weer uitzetten moet de bijbehorende boodschappen van de lijst halen"
        );
        const stillPlanned = await prisma.mealPlanEntry.findFirst({
          where: { mealPlan: { householdId }, includedInGroceries: false, skipped: false },
        });
        assert.ok(stillPlanned, "Het geplande gerecht blijft staan — niet meenemen is iets anders dan uit eten");

        // Weer aanzetten, zodat de rest van de flow een gevulde lijst heeft.
        await page.locator(`button[data-order-day="${isoDate}"]`).click();
        await page
          .locator(`button[data-order-day="${isoDate}"][aria-pressed="true"]`)
          .waitFor({ state: "visible", timeout: 15_000 });
      }
    );

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

    await t.test(
      "4b. Een weekmenu-regel kan direct van de boodschappenlijst worden verwijderd (nieuwe functie)",
      async () => {
        // De regel-verwijderknop stond voorheen alleen bij handmatig
        // toegevoegde producten (source MANUAL); gebruikersverzoek: ook
        // weekmenu-regels (source MEAL) moeten van de lijst kunnen. Kiest
        // bewust de alfabetisch laatste MEAL-regel — de latere stappen
        // voegen hun eigen producten toe via zoeken (Aardappelen, Bloemkool,
        // Spruitjes, ...) en raken dus nooit een al bestaande MEAL-regel.
        const mealLine = await prisma.shoppingListLine.findFirstOrThrow({
          where: { shoppingList: { mealPlan: { householdId } }, source: "MEAL" },
          include: { ingredient: true },
          orderBy: { ingredient: { name: "desc" } },
        });

        await page.goto(`${server.baseURL}/boodschappen`, { waitUntil: "load" });
        const lineBlock = page.locator(`#meal-line-${mealLine.id}`);
        await lineBlock.waitFor({ state: "visible", timeout: 10_000 });
        await lineBlock.locator('summary[aria-label^="Opties voor"]').click();
        await lineBlock.getByRole("button", { name: "Verwijderen" }).click();
        await lineBlock.waitFor({ state: "detached", timeout: 15_000 });

        const stillExists = await prisma.shoppingListLine.findUnique({ where: { id: mealLine.id } });
        assert.equal(stillExists, null, "De regel moet daadwerkelijk verwijderd zijn uit de boodschappenlijst");
      }
    );

    await t.test("5. Vaste boodschap / extra product toevoegen (via Picnic-zoeken)", async () => {
      await openBeheer(page);
      await page.locator("#add-fixed-grocery summary").click();
      const searchInput = page.getByPlaceholder("Zoek Picnic-product, bv. appels");
      await searchInput.waitFor({ state: "visible" });
      await searchInput.fill(MOCK_SEARCH_TERM);
      // Scoped op #add-fixed-grocery: sinds WP82 heeft de nieuwe
      // "Product toevoegen"-sectie (#quick-add-product) een eigen, identiek
      // gelabelde zoekknop.
      await page.locator("#add-fixed-grocery").getByRole("button", { name: "Zoeken bij Picnic" }).click();
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

    await t.test("5b. Snel meerdere producten toevoegen (WP92)", async () => {
      await page.goto(`${server.baseURL}/boodschappen`, { waitUntil: "load" });

      // "aardappelen" heeft na stap 5 al een vertrouwde Picnic-keuze
      // (MATCHED_TRUSTED) — die regel hoort automatisch herkend te worden,
      // zonder opnieuw door zoekresultaten te bladeren. "bloemkool" is nieuw
      // voor dit huishouden en moet dus wél een keuze uit de resultaten
      // vragen — dat bewijst dat beide paden (automatisch/handmatig) binnen
      // dezelfde batch naast elkaar werken.
      const quickOrderInput = page.locator("#quick-order textarea[name=quickOrder]");
      await quickOrderInput.fill(`${MOCK_SEARCH_TERM}, bloemkool`);
      await page.locator("#quick-order").getByRole("button", { name: "Zoeken" }).click();
      await page.waitForURL((url) => url.searchParams.has("quickOrder"), { timeout: 15_000 });

      await page.locator("text=1 herkend als jullie eerdere keuze:").waitFor({ state: "visible", timeout: 10_000 });
      const autoAddButton = page.getByRole("button", { name: "Automatisch toevoegen" });
      await autoAddButton.waitFor({ state: "visible" });
      await autoAddButton.click();
      await page.waitForURL((url) => url.searchParams.get("status") === "quick-order-bulk-added", { timeout: 15_000 });

      const autoAddedLine = await prisma.shoppingListLine.findFirst({
        where: {
          shoppingList: { mealPlan: { householdId } },
          source: "MANUAL",
          ingredient: { name: "Aardappelen" },
        },
      });
      assert.ok(autoAddedLine, "De automatisch herkende regel moet als MANUAL-regel zijn opgeslagen");

      // Na de bulk-toevoeging moet de nog-niet-gekozen regel ("bloemkool")
      // gewoon in beeld blijven, met haar eigen zoekresultaat. Het eerste
      // (enige) resultaat staat al aangevinkt (radioknop, standaard-keuze);
      // "Voeg toe" bevestigt in één keer i.p.v. een losse klik per product
      // (bugfix: gebruikersmelding dat elke losse "Toevoegen"-klik een volle
      // paginaherlaad kostte).
      const voegToeButton = page.locator("#quick-order").getByRole("button", { name: "Voeg toe" });
      await voegToeButton.waitFor({ state: "visible", timeout: 10_000 });
      await voegToeButton.click();
      await page.waitForURL((url) => url.searchParams.get("status") === "quick-order-added", { timeout: 15_000 });

      const pickedLine = await prisma.shoppingListLine.findFirst({
        where: {
          shoppingList: { mealPlan: { householdId } },
          source: "MANUAL",
          ingredient: { name: "Bloemkool" },
        },
      });
      assert.ok(pickedLine, "De handmatig gekozen regel moet als MANUAL-regel zijn opgeslagen");
    });

    await t.test("5c. Zelf zoeken als geen van de voorstellen goed is", async () => {
      // Gebruikersmelding: "kan je ook nog een 4e erbij zetten die ik zelf
      // kan zoeken?" — i.p.v. een 4e optie hergebruikt dit de bestaande
      // "Product toevoegen"-zoekbox (#quick-add-product), met de zoekterm
      // alvast ingevuld. Na toevoegen moet je automatisch terug naar
      // #quick-order komen, met deze regel uit het lijstje gestreept.
      //
      // Batch van twee regels (i.p.v. één) — bewijst niet alleen dat "zelf
      // zoeken" voor de gekozen regel werkt, maar ook de kernbelofte dat de
      // rest van het lijstje ("spruitjes") in beeld blijft i.p.v. te
      // verdwijnen achter de op-zichzelf-staande zoekbox (code-reviewbevinding
      // op de eerste versie van deze test, die alleen het triviale
      // één-regel-geval dekte).
      await page.goto(`${server.baseURL}/boodschappen`, { waitUntil: "load" });
      const quickOrderInput = page.locator("#quick-order textarea[name=quickOrder]");
      await quickOrderInput.fill("onbekendproductxyz, spruitjes");
      await page.locator("#quick-order").getByRole("button", { name: "Zoeken" }).click();
      await page.waitForURL((url) => url.searchParams.get("quickOrder") === "onbekendproductxyz, spruitjes", {
        timeout: 15_000,
      });

      const firstLineRaw = page.locator("#quick-order p.font-semibold", { hasText: "onbekendproductxyz" });
      await firstLineRaw.waitFor({ state: "visible", timeout: 10_000 });
      const firstLineBlock = firstLineRaw.locator("..");
      const zelfZoekenLink = firstLineBlock.getByRole("link", { name: "Niet het goede product? Zelf zoeken" });
      await zelfZoekenLink.click();
      await page.waitForURL((url) => url.searchParams.get("manualQ") === "onbekendproductxyz", { timeout: 15_000 });

      const hint = page.locator("#quick-add-product", { hasText: "Je zoekt zelf een product voor" });
      await hint.first().waitFor({ state: "visible", timeout: 10_000 });

      const toevoegenButton = page.locator("#quick-add-product").getByRole("button", { name: "Toevoegen" });
      await toevoegenButton.waitFor({ state: "visible", timeout: 10_000 });
      await toevoegenButton.click();
      await page.waitForURL(
        (url) =>
          url.searchParams.get("status") === "quick-order-added" && url.searchParams.get("quickOrder") === "spruitjes",
        { timeout: 15_000 }
      );

      // De opgeloste regel is echt weg, de nog niet opgeloste regel staat er
      // nog steeds, met een eigen zoekresultaat en "Zelf zoeken"-link.
      await page.locator("#quick-order p.font-semibold", { hasText: "onbekendproductxyz" }).waitFor({ state: "hidden" });
      const remainingLineRaw = page.locator("#quick-order p.font-semibold", { hasText: "spruitjes" });
      await remainingLineRaw.waitFor({ state: "visible", timeout: 10_000 });

      const selfSearchedLine = await prisma.shoppingListLine.findFirst({
        where: {
          shoppingList: { mealPlan: { householdId } },
          source: "MANUAL",
          ingredient: { name: "Onbekendproductxyz" },
        },
      });
      assert.ok(selfSearchedLine, "De via 'Zelf zoeken' gekozen regel moet als MANUAL-regel zijn opgeslagen");

      const notYetAddedLine = await prisma.shoppingListLine.findFirst({
        where: {
          shoppingList: { mealPlan: { householdId } },
          ingredient: { name: "Spruitjes" },
        },
      });
      assert.equal(notYetAddedLine, null, "De nog niet gekozen regel ('spruitjes') mag nog niet zijn opgeslagen");
    });

    await t.test("6. Voorraad aanpassen", async () => {
      await page.goto(`${server.baseURL}/boodschappen`, { waitUntil: "load" });

      // Voor een vers huishouden staat de voorraadcheck al standaard open
      // (er is nog niets bevestigd, dus alles vraagt om aandacht) — alleen
      // klikken als hij nog dicht staat, anders klapt de klik hem juist toe.
      await openBeheer(page);
      const inventorySection = page.locator("#inventory-check");
      const alreadyOpen = await inventorySection.evaluate((el) => (el as HTMLDetailsElement).open);
      if (!alreadyOpen) await inventorySection.locator("summary").first().click();

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

    await t.test("7b. Doorstroom naar het volgende twijfelgeval na een keuze (UX-bugfix)", async () => {
      // Vóór deze fix redirectte elke oplossende actie terug naar dezelfde
      // (nu opgeloste) regel — de gebruiker moest daarna zelf naar het
      // volgende twijfelgeval scrollen/zoeken. Forceer hier een
      // deterministisch scenario met twee twijfelgevallen (onafhankelijk
      // van hoeveel er toevallig nog open staan op dit punt in de flow) en
      // bewijs dat bevestigen op de eerste regel automatisch naar de
      // tweede (alfabetisch eerstvolgende) regel doorspringt.
      const candidateLines = await prisma.shoppingListLine.findMany({
        where: { shoppingList: { mealPlan: { householdId } }, source: "MEAL", productId: { not: null } },
        include: { ingredient: { select: { name: true } } },
      });
      assert.ok(
        candidateLines.length >= 2,
        "Testopzet: er moeten minstens 2 MEAL-regels met een product zijn om dit scenario te bouwen"
      );
      const [first, second] = [...candidateLines]
        .sort((a, b) => a.ingredient.name.localeCompare(b.ingredient.name))
        .slice(0, 2);
      await prisma.shoppingListLine.updateMany({
        where: { id: { in: [first.id, second.id] } },
        data: { needsReview: true },
      });

      await page.goto(`${server.baseURL}/controle`, { waitUntil: "load" });
      const firstCard = page.locator(`#line-${first.id}`);
      await firstCard.waitFor({ state: "visible", timeout: 10_000 });
      // Deze regel had al een product (zie de "productId: { not: null }"-
      // filter hierboven), dus de bevestigknop op die kaart heet "Goed,
      // onthouden" i.p.v. "Kies en onthoud" (dat label is voor een nog
      // niet eerder gekozen alternatief) — zelfde actie, andere tekst.
      await firstCard.getByRole("button", { name: "Goed, onthouden" }).first().click();
      await page.waitForURL((url) => url.searchParams.get("status") === "remembered", { timeout: 15_000 });

      assert.ok(
        page.url().endsWith(`#line-${second.id}`),
        "Moet doorspringen naar de eerstvolgende (alfabetisch) twijfelregel, niet terug naar de zojuist opgeloste regel"
      );
      // De bevestiging staat nu bovenaan (algemeen) i.p.v. per-regel, want
      // de zojuist opgeloste regel staat niet meer in beeld.
      await page
        .locator("text=Opgeslagen en onthouden voor volgende keer.")
        .first()
        .waitFor({ state: "visible", timeout: 5_000 });

      const resolvedLine = await prisma.shoppingListLine.findUniqueOrThrow({ where: { id: first.id } });
      assert.equal(resolvedLine.needsReview, false, "De zojuist gekozen regel moet niet meer om controle vragen");
    });

    await t.test(
      "7c. Zoeken vanuit 'vertrouwde keuzes bekijken' zet een regel niet ongevraagd terug op 'controleren' (UX-bugfix)",
      async () => {
        const trustedLine = await prisma.shoppingListLine.findFirst({
          where: { shoppingList: { mealPlan: { householdId } }, needsReview: false, source: "MEAL" },
          include: { ingredient: { select: { name: true } } },
        });
        assert.ok(trustedLine, "Testopzet: er moet minstens 1 vertrouwde MEAL-regel zijn voor dit scenario");

        await page.goto(`${server.baseURL}/controle`, { waitUntil: "load" });
        const trustedDetails = page.getByText(/vertrouwde keuzes? bekijken/);
        await trustedDetails.waitFor({ state: "visible", timeout: 10_000 });
        await trustedDetails.click();

        const trustedCard = page.locator(`#line-${trustedLine!.id}`);
        await trustedCard.waitFor({ state: "visible", timeout: 10_000 });
        const searchInput = trustedCard.getByPlaceholder(/Zoek Picnic-product/);
        await searchInput.fill(trustedLine!.ingredient.name);
        await trustedCard.getByRole("button", { name: "Zoeken bij Picnic" }).click();
        await page.waitForURL((url) => url.searchParams.get("status") === "searched", { timeout: 15_000 });

        const afterSearch = await prisma.shoppingListLine.findUniqueOrThrow({ where: { id: trustedLine!.id } });
        assert.equal(
          afterSearch.needsReview,
          false,
          "Even rondkijken naar alternatieven vanuit 'vertrouwde keuzes' mag een regel niet terugzetten op 'controleren'"
        );
      }
    );

    await t.test("8. Mandje vullen", async () => {
      await page.goto(`${server.baseURL}/boodschappen`, { waitUntil: "load" });

      const addButton = page.getByRole("button", { name: "Toevoegen aan Picnic-mandje" });
      await addButton.waitFor({ state: "visible", timeout: 10_000 });
      await addButton.click();

      const confirmButton = page.getByRole("button", { name: "Ja, voeg toe aan mandje" });
      await confirmButton.waitFor({ state: "visible", timeout: 10_000 });
      await confirmButton.click();

      // Niet zomaar op "text=...toegevoegd aan je Picnic-mandje." wachten:
      // die substring staat óók al in de confirming-stage-tekst ("N
      // product(en) worden toegevoegd aan je Picnic-mandje.") die al zichtbaar
      // is vóór deze klik — wachten op het verdwijnen van de "Bezig met
      // toevoegen…"-knop garandeert dat de add-actie echt is afgerond
      // voordat de mock-server-assert hieronder gecontroleerd wordt.
      await page.getByRole("button", { name: "Bezig met toevoegen…" }).waitFor({ state: "hidden", timeout: 15_000 });
      assert.ok(mockPicnic.addedProducts.length > 0, "De mock-Picnic-server moet minstens één add_product-aanroep hebben ontvangen");
    });

    await t.test("8b. Mandje legen toont de echte foutmelding bij een Picnic-fout (bugfix-regressie)", async () => {
      // Reproduceert het gebruikersgemelde probleem: vóór de bugfix gooide
      // clearPicnicCartForShoppingList een kale Error, die Next.js in
      // productie herleidt tot een nietszeggende "An error occurred in the
      // Server Components render"-pagina i.p.v. de eigen Nederlandse melding.
      mockPicnic.failClear = true;
      try {
        await page.getByRole("button", { name: "Picnic-mandje legen" }).click();
        const confirmClear = page.getByRole("button", { name: "Ja, mandje legen" });
        await confirmClear.waitFor({ state: "visible", timeout: 5_000 });
        await confirmClear.click();

        await page
          .locator("text=Picnic-sessie verlopen of ongeldig. Koppel je Picnic-account opnieuw bij Ons gezin.")
          .waitFor({ state: "visible", timeout: 15_000 });
        const genericErrorVisible = await page
          .locator("text=An error occurred in the Server Components render")
          .isVisible()
          .catch(() => false);
        assert.equal(
          genericErrorVisible,
          false,
          "de gebruiker moet de eigen Nederlandse foutmelding zien, nooit de generieke Next.js-pagina"
        );
      } finally {
        mockPicnic.failClear = false;
      }
    });

    await t.test("9. Fout herstellen: mandje legen", async () => {
      // Vervolg op 8b: dezelfde bevestiging (nog open na de mislukte poging
      // hierboven) opnieuw versturen, nu zonder gesimuleerde Picnic-fout.
      const confirmClear = page.getByRole("button", { name: "Ja, mandje legen" });
      await confirmClear.waitFor({ state: "visible", timeout: 5_000 });
      await confirmClear.click();

      await page.locator("text=Mandje geleegd.").waitFor({ state: "visible", timeout: 15_000 });
      assert.equal(mockPicnic.addedProducts.length, 0, "Het mock-mandje moet leeg zijn nadat het geleegd is");
    });

    await t.test(
      "10c. Bestellen vanaf de boodschappenpagina zodra de lijst bevestigd is",
      async () => {
        // Forceer de "lijst bevestigd, nog niet naar Picnic"-status (net als
        // 7b/7c: direct via Prisma, i.p.v. leunen op wat eerdere stappen
        // toevallig hebben achtergelaten) — zodat de boodschappenpagina de
        // "Klaar om naar Picnic te gaan"-tekst toont met de echte
        // AddToPicnicCart-knop erin.
        const shoppingList = await prisma.shoppingList.findFirstOrThrow({
          where: { mealPlan: { householdId } },
          include: { lines: true },
        });
        assert.ok(shoppingList.lines.length > 0, "Testopzet: er moet minstens 1 regel op de lijst staan");
        await prisma.shoppingListLine.updateMany({
          where: { shoppingListId: shoppingList.id },
          // transferredToPicnicAt ook expliciet resetten: eerdere stappen
          // (8. Mandje vullen) kunnen deze regel al eens hebben overgedragen
          // — addToPicnicCart is bewust idempotent en zou 'm dan stilzwijgend
          // overslaan, wat deze test zou laten denken dat er niks gebeurde.
          data: { needsReview: false, transferredToPicnicAt: null },
        });
        await prisma.shoppingList.update({
          where: { id: shoppingList.id },
          data: { status: "REVIEWED", reviewedAt: new Date() },
        });

        // Op de boodschappenpagina staat geen tussentekst meer maar meteen de
        // echte knop — dat is precies de winst van het ontdubbelen.
        await page.goto(`${server.baseURL}/boodschappen`, { waitUntil: "load" });

        const addedBefore = mockPicnic.addedProducts.length;
        const addButton = page.getByRole("button", { name: "Toevoegen aan Picnic-mandje" });
        await addButton.waitFor({ state: "visible", timeout: 10_000 });
        await addButton.click();

        const confirmButton = page.getByRole("button", { name: "Ja, voeg toe aan mandje" });
        await confirmButton.waitFor({ state: "visible", timeout: 10_000 });
        await confirmButton.click();

        // Zie de toelichting bij stap "8. Mandje vullen": wachten op het
        // verdwijnen van "Bezig met toevoegen…" i.p.v. op een tekst-substring
        // die ook al vóór de klik zichtbaar was.
        await page.getByRole("button", { name: "Bezig met toevoegen…" }).waitFor({ state: "hidden", timeout: 15_000 });
        assert.ok(
          mockPicnic.addedProducts.length > addedBefore,
          "Vanaf de startpagina bestellen moet ook echt (meer) producten aan het mock-Picnic-mandje toevoegen"
        );
        assert.equal(
          new URL(page.url()).pathname,
          "/boodschappen",
          "Moet op de boodschappenpagina blijven — bestellen gebeurt waar de lijst staat"
        );
      }
    );

    await t.test(
      "10d. Boodschappenpagina toont daarna 'Rond je bestelling af in Picnic' met werkende 'Ik heb besteld'",
      async () => {
        await page.goto(`${server.baseURL}/boodschappen`, { waitUntil: "load" });
        await page.locator("text=Rond je bestelling af in Picnic").waitFor({ state: "visible", timeout: 15_000 });

        const confirmOrderButton = page.getByRole("button", { name: "Ik heb besteld" });
        await confirmOrderButton.waitFor({ state: "visible", timeout: 10_000 });
        await confirmOrderButton.click();

        // confirmPicnicOrder is een rechtstreekse server-actie-aanroep vanuit
        // de client (geen redirect, dus geen navigatie om op te wachten) —
        // de knop zelf toont lokaal "Bezig..." zolang de transition loopt;
        // wacht tot die tekst weer weg is (React-transition afgerond)
        // vóórdat de DB-state gecontroleerd wordt (nooit stilzwijgend een
        // bestelling "plaatsen" — deze knop zet alleen orderConfirmedAt,
        // nooit een echte Picnic-bestelling; dat blijft altijd in de
        // Picnic-app zelf, zoals gevraagd).
        await page.getByRole("button", { name: "Bezig…" }).waitFor({ state: "hidden", timeout: 10_000 });

        const shoppingList = await prisma.shoppingList.findFirstOrThrow({ where: { mealPlan: { householdId } } });
        assert.ok(shoppingList.orderConfirmedAt !== null, "orderConfirmedAt moet gezet zijn na 'Ik heb besteld'");

        await page.goto(`${server.baseURL}/boodschappen`, { waitUntil: "load" });
        const stillShowingConfirmCard = await page
          .locator("text=Rond je bestelling af in Picnic")
          .isVisible()
          .catch(() => false);
        assert.equal(
          stillShowingConfirmCard,
          false,
          "Na 'Ik heb besteld' moet de bevestigingstegel niet opnieuw verschijnen bij een vers bezoek"
        );
      }
    );

    await t.test(
      "10e. Leeg Picnic-mandje terwijl er regels overgedragen zijn: de app vraagt of er besteld is (nieuwe functie)",
      async () => {
        // De app kan niet zien of er afgerekend is. Wat ze wel kan: merken dat
        // het mandje leeg is terwijl zij er producten in heeft gelegd. Dan
        // vraagt ze het, in plaats van een oranje kaart te laten staan tot de
        // gebruiker er zelf aan denkt.
        const shoppingList = await prisma.shoppingList.findFirstOrThrow({
          where: { mealPlan: { householdId } },
          include: { lines: true },
        });
        await prisma.shoppingList.update({
          where: { id: shoppingList.id },
          data: { orderConfirmedAt: null },
        });
        await prisma.shoppingListLine.update({
          where: { id: shoppingList.lines[0].id },
          data: { transferredToPicnicAt: new Date() },
        });

        // Het mandje buiten de app om leegmaken — precies het scenario
        // "afgerekend in de Picnic-app zelf".
        mockPicnic.addedProducts.length = 0;

        await page.goto(`${server.baseURL}/boodschappen`, { waitUntil: "load" });
        await page
          .locator("text=Je Picnic-mandje is leeg — heb je besteld?")
          .waitFor({ state: "visible", timeout: 15_000 });

        await page.getByRole("button", { name: "Ja, besteld" }).click();
        await page.getByRole("button", { name: "Bezig…" }).waitFor({ state: "hidden", timeout: 15_000 });

        const confirmed = await prisma.shoppingList.findUniqueOrThrow({ where: { id: shoppingList.id } });
        assert.ok(confirmed.orderConfirmedAt, "'Ja, besteld' moet de bestelling bevestigen");

        // En daarna staat er een bonnetje in plaats van opnieuw een vraag.
        await page.goto(`${server.baseURL}/boodschappen`, { waitUntil: "load" });
        await page.locator("text=Besteld op").waitFor({ state: "visible", timeout: 15_000 });
        const stillAsking = await page
          .locator("text=Je Picnic-mandje is leeg — heb je besteld?")
          .isVisible()
          .catch(() => false);
        assert.equal(stillAsking, false, "na bevestigen mag de vraag niet opnieuw verschijnen");
      }
    );

    await t.test(
      "11. Een vaste boodschap verwijderen via 'toon volledige lijst': geblokkeerd zolang die al in het mandje ligt, daarna wel, zonder de sjabloon te raken",
      async () => {
        // Bewust als allerlaatste stap: "Aardappelen" (toegevoegd in stap 5)
        // wordt hier definitief van de lijst van déze week gehaald — geen
        // enkele stap hierna leunt daar nog op.
        const fixedGrocery = await prisma.fixedGrocery.findFirstOrThrow({
          where: { householdId, ingredient: { name: "Aardappelen" } },
        });
        const fixedLine = await prisma.shoppingListLine.findFirstOrThrow({
          where: {
            shoppingList: { mealPlan: { householdId } },
            source: "FIXED",
            ingredientId: fixedGrocery.ingredientId,
          },
        });

        // Eerst het veiligheidsgedrag: zolang de regel al in het Picnic-mandje
        // ligt mag de app 'm niet van de lijst halen — dat zou de "ligt al in
        // je mandje"-markering wissen en tot dubbel bestellen leiden.
        await prisma.shoppingListLine.update({
          where: { id: fixedLine.id },
          data: { transferredToPicnicAt: new Date() },
        });
        await page.goto(`${server.baseURL}/boodschappen`, { waitUntil: "load" });
        await page.locator("#alle-te-bestellen-producten > summary").click();
        const blockedBlock = page.locator(`#meal-line-${fixedLine.id}`);
        await blockedBlock.waitFor({ state: "visible", timeout: 10_000 });
        await blockedBlock.locator('summary[aria-label^="Opties voor"]').click();
        await blockedBlock.getByRole("button", { name: "Verwijderen" }).click();
        await page.locator("text=Dit product ligt al in je Picnic-mandje").waitFor({
          state: "visible",
          timeout: 15_000,
        });
        assert.ok(
          await prisma.shoppingListLine.findUnique({ where: { id: fixedLine.id } }),
          "een regel die al in het mandje ligt mag niet verwijderd worden"
        );

        // Daarna het normale geval: niet meer overgedragen, dan kan het wel.
        await prisma.shoppingListLine.update({
          where: { id: fixedLine.id },
          data: { transferredToPicnicAt: null },
        });
        await page.goto(`${server.baseURL}/boodschappen`, { waitUntil: "load" });
        await page.locator("#alle-te-bestellen-producten > summary").click();
        const lineBlock = page.locator(`#meal-line-${fixedLine.id}`);
        await lineBlock.waitFor({ state: "visible", timeout: 10_000 });
        await lineBlock.locator('summary[aria-label^="Opties voor"]').click();
        await lineBlock.getByRole("button", { name: "Verwijderen" }).click();
        await lineBlock.waitFor({ state: "detached", timeout: 15_000 });

        const lineStillExists = await prisma.shoppingListLine.findUnique({ where: { id: fixedLine.id } });
        assert.equal(lineStillExists, null, "De regel van deze week moet verwijderd zijn");

        const templateStillExists = await prisma.fixedGrocery.findUnique({ where: { id: fixedGrocery.id } });
        assert.ok(
          templateStillExists,
          "De vaste-boodschap-sjabloon zelf moet blijven bestaan — alleen deze week uitgeschakeld"
        );
      }
    );
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
