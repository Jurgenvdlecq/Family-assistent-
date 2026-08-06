import "dotenv/config";
import type { Page } from "playwright";
import { prisma } from "@/lib/prisma";

export const MOCK_PRODUCT_PREFIX = "e2e-mock-";

/**
 * Ruimt eventuele resten van een eerdere, onderbroken testrun op — vóór en
 * ná elke run, zodat de gedeelde ingrediëntencatalogus nooit met testdata
 * vervuild blijft (de mock-producten hangen aan een bestaand, gedeeld
 * ingrediënt, dus household-cascade ruimt ze niet vanzelf op).
 */
export async function cleanupMockProducts() {
  await prisma.product.deleteMany({ where: { externalRef: { startsWith: MOCK_PRODUCT_PREFIX } } });
}

export async function deleteTestHousehold(householdId: string) {
  await prisma.household.delete({ where: { id: householdId } }).catch(() => {
    // Al verwijderd (bv. dubbele teardown) — geen probleem.
  });
  await cleanupMockProducts();
}

/**
 * Doorloopt de echte onboarding-wizard (QUICK-modus) in de browser en geeft
 * het aangemaakte huishouden terug. Dit is bewust geen directe
 * Prisma-insert: de onboardingflow zelf is stap 1 van de kritieke
 * gebruikersflow uit Fase 15 en moet dus ook echt getest worden.
 */
export async function completeOnboardingViaUi(
  page: Page,
  baseURL: string,
  householdName: string,
  username: string,
  password: string
) {
  await page.goto(`${baseURL}/onboarding`, { waitUntil: "load" });

  // Stap 1: modus (QUICK staat al standaard aan) → Volgende.
  await page.getByRole("button", { name: "Volgende" }).click();

  // Stap 2: gezinsnaam.
  await page.getByPlaceholder("Bijvoorbeeld: Familie Van der Lecq").fill(householdName);
  await page.getByRole("button", { name: "Volgende" }).click();

  // Stap 3: gezinslid.
  await page.getByPlaceholder("Naam").fill("Testouder");
  await page.getByRole("button", { name: "Volgende" }).click();

  // Stap 4: weekritme — standaardwaarden zijn prima, gewoon door.
  await page.getByRole("button", { name: "Volgende" }).click();

  // Stap 5 (laatste stap in QUICK-modus): gebruikersnaam + wachtwoord + versturen.
  await page.getByPlaceholder("Gebruikersnaam (minimaal 3 tekens)").fill(username);
  await page.getByPlaceholder("Wachtwoord (minimaal 6 tekens)").fill(password);
  await page.getByPlaceholder("Bevestig wachtwoord").fill(password);
  await page.getByRole("button", { name: "Maak mijn eerste week" }).click();

  // Landt eerst op de (overslaanbare) Picnic-koppelstap — de meeste tests
  // hebben geen live/mock-Picnic-koppeling nodig op dit punt (die zetten ze
  // zelf later via een directe Prisma-update), dus gewoon overslaan.
  await page.waitForURL(`${baseURL}/onboarding/picnic`, { timeout: 30_000 });
  await page.getByRole("link", { name: "Overslaan, dit doe ik later →" }).click();
  await page.waitForURL(`${baseURL}/`, { timeout: 30_000 });

  const household = await prisma.household.findFirstOrThrow({
    where: { name: householdName },
    orderBy: { createdAt: "desc" },
  });
  return household;
}
