"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCurrentHousehold } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { ProductProvider } from "@/generated/prisma/enums";
import { refreshDirkPrices, refreshStorePrices, type RefreshResult } from "@/lib/pricing/refresh";
import { ahPriceProvider } from "@/lib/pricing/ahClient";
import { finishRefreshRun, hasRunningRefresh, startRefreshRuns } from "@/lib/pricing/refreshRuns";
import { errorMessage } from "@/lib/logger";
import { getCurrentWeekStart } from "@/lib/week";

const PROVIDERS: ProductProvider[] = ["AH", "DIRK"];

/**
 * "Nee, bij deze winkel kopen we dít."
 *
 * De ids komen van de client, dus wordt hier alles opnieuw gecontroleerd: het
 * ingrediënt moet daadwerkelijk op de boodschappenlijst van dít huishouden
 * staan, en het product moet bij dát ingrediënt en bij die winkel horen. Zonder
 * die controles zou een aangepast formulier een keuze kunnen opslaan bij een
 * ander huishouden of bij een willekeurig product.
 */
export async function chooseStoreProduct(formData: FormData) {
  const household = await requireCurrentHousehold();
  const ingredientId = String(formData.get("ingredientId") ?? "").trim();
  const productId = String(formData.get("productId") ?? "").trim();
  const provider = String(formData.get("provider") ?? "").trim() as ProductProvider;
  const lineId = String(formData.get("lineId") ?? "").trim();
  if (!ingredientId || !productId || !PROVIDERS.includes(provider)) return;

  // Staat dit ingrediënt wel op een lijst van dit huishouden? Zo niet, dan is
  // er niets te corrigeren en slaan we ook niets op.
  const onOwnList = await prisma.shoppingListLine.findFirst({
    where: { ingredientId, shoppingList: { mealPlan: { householdId: household.id } } },
    select: { id: true },
  });
  if (!onOwnList) return;

  // Hoort het product bij dit ingrediënt én bij deze winkel? Een product van
  // een andere winkel kiezen zou een vergelijking opleveren die nergens op slaat.
  const product = await prisma.product.findFirst({
    where: { id: productId, ingredientId, provider },
    select: { id: true },
  });
  if (!product) return;

  await prisma.householdStoreProductChoice.upsert({
    where: { householdId_ingredientId_provider: { householdId: household.id, ingredientId, provider } },
    update: { productId, chosenAt: new Date() },
    create: { householdId: household.id, ingredientId, productId, provider },
  });

  revalidatePath("/prijzen");
  // De samenvattingsregel op de boodschappenlijst hangt van dezelfde keuze af.
  revalidatePath("/boodschappen");
  // Terug naar dezelfde regel, niet naar de bovenkant van de pagina. De id komt
  // van de client, dus gecodeerd — anders breekt een rare waarde de URL.
  const anchor = encodeURIComponent(lineId);
  redirect(`/prijzen?focus=${anchor}&status=keuze-opgeslagen#regel-${anchor}`);
}

/** De correctie weer loslaten: vanaf nu kiest de app zelf weer. */
export async function clearStoreProductChoice(formData: FormData) {
  const household = await requireCurrentHousehold();
  const ingredientId = String(formData.get("ingredientId") ?? "").trim();
  const provider = String(formData.get("provider") ?? "").trim() as ProductProvider;
  const lineId = String(formData.get("lineId") ?? "").trim();
  if (!ingredientId || !PROVIDERS.includes(provider)) return;

  await prisma.householdStoreProductChoice.deleteMany({
    where: { householdId: household.id, ingredientId, provider },
  });

  revalidatePath("/prijzen");
  revalidatePath("/boodschappen");
  const anchor = encodeURIComponent(lineId);
  redirect(`/prijzen?focus=${anchor}&status=keuze-gewist#regel-${anchor}`);
}

/**
 * "Prijzen nu verversen" — dezelfde klus als de nachtelijke taak, maar
 * afgemeten en met de uitslag meteen op het scherm.
 *
 * Waarom afgemeten: een aanroep vanuit de app mag niet minutenlang duren, en
 * de volledige lijst kost dat wel (er zit bewust een pauze tussen de aanvragen
 * zodat we de winkels niet overvragen). Deze knop doet daarom een beperkt
 * aantal ingrediënten. Dat staat ook zo op het scherm — een knop die "alles
 * bijgewerkt" suggereert terwijl hij een deel doet, is precies de soort
 * belofte die deze app niet hoort te maken.
 *
 * De uitkomst wordt vastgelegd (`PriceRefreshRun`): eerst een regel per winkel
 * bij de start, daarna bijgewerkt met wat het opleverde. Zo is een afgebroken
 * verversing zichtbaar in plaats van onzichtbaar, en houdt een lopende regel
 * een tweede gelijktijdige verversing tegen.
 */
export async function refreshPricesNow() {
  // Alleen voor een ingelogd huishouden: dit doet echte aanvragen naar
  // externe winkels, dus geen open eindpunt.
  const household = await requireCurrentHousehold();

  // Twee tabbladen, of twee gezinsleden tegelijk, zouden de zorgvuldig
  // ingebouwde pauze tussen de aanvragen verdubbelen. En een blokkade door de
  // winkel valt niet op deze knop maar op de nachtelijke verversing.
  if (await hasRunningRefresh(REFRESH_PROVIDERS)) {
    redirect("/prijzen?status=verversing-loopt-al");
  }

  // Dezelfde week als de pagina doorrekent: anders prioriteren we een lijst
  // die de gebruiker niet voor zich heeft.
  const weekStart = getCurrentWeekStart();
  const runIds = await startRefreshRuns(REFRESH_PROVIDERS, "MANUAL");
  const results: RefreshResult[] = [];

  // Elke winkel krijgt een eigen deel van de tijd, en samen blijven ze ruim
  // onder wat de hostingpartij toestaat. Zonder deze begrenzing kapt Vercel
  // de aanroep af, krijgt de browser nooit antwoord en blijft de knop op
  // "bezig met ophalen" staan — precies wat er in productie gebeurde.
  const budgetPerProvider = Math.floor(MANUAL_TIME_BUDGET_MS / REFRESH_PROVIDERS.length);

  // Elke winkel apart afhandelen: een storing bij de één mag de ander niet
  // meeslepen — dan zie je van geen van beide wat er aan de hand is.
  for (const provider of REFRESH_PROVIDERS) {
    // De winkels gaan één voor één, dus elke winkel telt haar deel vanaf nu.
    // Is de vorige sneller klaar dan haar deel, dan schuift die winst niet
    // door — dat zou de laatste winkel over het totaal heen kunnen tillen.
    const deadline = Date.now() + budgetPerProvider;
    let result: RefreshResult;
    try {
      result =
        provider === "AH"
          ? await refreshStorePrices(ahPriceProvider, {
              limitIngredients: MANUAL_INGREDIENT_LIMIT,
              withExtras: false,
              prioritiseHouseholdId: household.id,
              weekStart,
              deadline,
            })
          : await refreshDirkPrices({
              limitIngredients: MANUAL_INGREDIENT_LIMIT,
              maxCategories: MANUAL_DIRK_CATEGORY_LIMIT,
              prioritiseHouseholdId: household.id,
              weekStart,
              deadline,
            });
    } catch (error) {
      result = failedRun(provider, error);
    }
    results.push(result);
    await finishRefreshRun(runIds.get(provider)!, result);
  }

  revalidatePath("/prijzen");
  revalidatePath("/boodschappen");

  // Een groene "klaar"-melding terwijl er nul producten zijn opgehaald, is
  // precies de schijn die deze app niet hoort te wekken.
  const nothingStored = results.every((result) => result.productsStored === 0);
  redirect(`/prijzen?status=${nothingStored ? "verversen-mislukt" : "ververst"}`);
}

/** De winkels die een handmatige verversing langsgaat. */
const REFRESH_PROVIDERS: ProductProvider[] = ["AH", "DIRK"];

/**
 * Zoveel ingrediënten pakt een handmatige verversing; de rest doet de
 * nachtelijke taak. Bewust laag gehouden: er zit een pauze tussen de
 * aanvragen, en de hostingpartij kapt een te lange aanroep af.
 */
const MANUAL_INGREDIENT_LIMIT = 15;

/**
 * En zoveel categoriepagina's bij Dirk.
 *
 * Ruimer dan de zes van vroeger, want ze worden nu gekozen op wat er op de
 * lijst staat in plaats van op de volgorde van Dirks eigen menu — dan is elke
 * extra pagina ook echt een kans op een match. Het tijdsbudget bewaakt de
 * bovengrens, dus dit getal hoeft niet meer voorzichtig te zijn.
 */
const MANUAL_DIRK_CATEGORY_LIMIT = 14;

/**
 * Hoeveel tijd de hele knop mag kosten, verdeeld over de winkels.
 *
 * Onder de 60 seconden die de pagina zichzelf toestaat: er blijft ruim tijd
 * over om de uitslag per winkel weg te schrijven en door te sturen. Wordt
 * dit aan de hostingpartij overgelaten, dan wordt de aanroep midden in het
 * werk afgekapt en blijft de knop eindeloos op "bezig met ophalen" staan.
 */
const MANUAL_TIME_BUDGET_MS = 48_000;

/** Een winkel die helemaal niet bereikbaar was, in dezelfde vorm als een gewone uitslag. */
function failedRun(provider: ProductProvider, error: unknown): RefreshResult {
  return {
    provider,
    ingredientsChecked: 0,
    productsStored: 0,
    ingredientsWithoutMatch: 0,
    itemsSeen: null,
    errors: [errorMessage(error)],
    abortedAfter: null,
  };
}
