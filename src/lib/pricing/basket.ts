import { prisma } from "@/lib/prisma";
import type { ProductProvider } from "@/generated/prisma/enums";
import {
  compareBasket,
  type BasketComparison,
  type BasketLineInput,
  type StoreCandidateInput,
} from "@/domain/pricing/basketComparison";
import { deriveQualityTier } from "@/domain/pricing/qualityTier";
import { judgeDiscount, summarizePriceHistory, type PriceSample } from "@/domain/pricing/priceHistory";
import { buildSplitAdvice, type SplitAdvice } from "@/domain/pricing/splitAdvice";
import { adviseStockUp, type StockUpAdvice } from "@/domain/pricing/stockUpAdvice";
import { parsePackContent, unitPriceFor } from "@/domain/pricing/unitPrice";
import { getPriceHistories } from "./observations";
import { isUserChosenPackageCount } from "@/lib/shoppingList";
import {
  getStoreCandidatesForIngredients,
  getStoreProductsByIds,
  type StorePriceForIngredient,
} from "./storePrices";

/**
 * De brug tussen de boodschappenlijst en de mandje-simulatie.
 *
 * Alles wat hier gebeurt is data verzamelen; het rekenwerk en de
 * equivalentie-afweging zitten in `src/domain/pricing`. Reden voor die knip:
 * de vraag "is houdbare melk een vervanger voor verse melk" is een
 * productbeslissing die met een gewone unittest te bewijzen moet zijn, zonder
 * database.
 *
 * Deze laag leest alleen uit de database. Een winkel bevragen tijdens het
 * laden van een pagina gebeurt nooit — dat doet de geplande verversing.
 */

export interface BasketOverview {
  comparison: BasketComparison;
  /** Handmatige correcties: per ingrediënt per winkel het product dat het huishouden zelf koos. */
  choicesByIngredient: Map<string, Map<ProductProvider, string>>;
  /** Alle kandidaten per ingrediënt, zodat de gebruiker een ander product kan kiezen. */
  candidatesByIngredient: Map<string, StorePriceForIngredient[]>;
  /** De regels zelf, voor de tabel op het scherm. */
  lineMeta: Map<string, { ingredientId: string; picnicProductName: string | null; isFixed: boolean }>;
  /**
   * Regels die deze week echt in de actie zijn — met het bedrag dat de actie
   * scheelt. Alleen als de korting ook werkelijk iets oplevert bij het aantal
   * dat je nodig hebt, en nooit bij een van-prijs die de geschiedenis
   * tegenspreekt.
   */
  promoHighlights: PromoHighlight[];
  /**
   * Loont het om een deel van de lijst bij een andere winkel te halen?
   * Leeg zolang het de moeite van een tweede winkel niet waard is.
   */
  splitAdvice: SplitAdvice[];
  /** Houdbare producten waarvan het loont om er deze week extra van te kopen. */
  stockUpAdvice: StockUpAdvice[];
  /** `null` betekent: er is deze week nog geen lijst om door te rekenen. */
  shoppingListId: string | null;
}

export interface PromoHighlight {
  lineId: string;
  ingredientName: string;
  provider: ProductProvider;
  promoLabel: string;
  explanation: string | null;
  /** Wat de actie scheelt bij het aantal verpakkingen van deze regel. */
  saving: number;
  /** Een vaste boodschap koop je elke week; daar telt een actie zwaarder. */
  isFixed: boolean;
}

/** De winkels waar we vandaag inzicht in hebben. Picnic is de referentie, geen kolom. */
export const COMPARISON_PROVIDERS: ProductProvider[] = ["AH", "DIRK"];

/**
 * Rekent de huidige boodschappenlijst van een huishouden door.
 *
 * De referentie is bewust het product dat er nú op de regel staat — dat is wat
 * er daadwerkelijk besteld zou worden. Staat er nog geen product op (regel is
 * nog niet gematcht), dan is de regel niet vergelijkbaar en zegt de app dat
 * ook, in plaats van een willekeurig product als "wat jullie normaal kopen" te
 * behandelen.
 */
export async function getBasketOverview(
  householdId: string,
  mealPlanId: string,
  providers: ProductProvider[] = COMPARISON_PROVIDERS,
  now: Date = new Date()
): Promise<BasketOverview> {
  // Het weekplan wordt hier expliciet aan het huishouden gebonden. Vandaag
  // komen beide argumenten uit dezelfde sessie, maar zonder deze koppeling
  // nodigt de signatuur uit om er ooit een mealPlanId uit een queryparameter in
  // te stoppen — en dan lever je de regels van een ander huishouden.
  const shoppingList = await prisma.shoppingList.findFirst({
    where: { mealPlanId, mealPlan: { householdId } },
    include: { lines: { include: { ingredient: true, product: true } } },
  });

  const empty: BasketOverview = {
    comparison: compareBasket([], new Map(), providers),
    choicesByIngredient: new Map(),
    candidatesByIngredient: new Map(),
    lineMeta: new Map(),
    promoHighlights: [],
    splitAdvice: [],
    stockUpAdvice: [],
    shoppingListId: null,
  };
  if (!shoppingList || shoppingList.lines.length === 0) return empty;

  // Regels die je zelf haalt gaan sowieso niet via een winkelbestelling; ze
  // horen dus ook niet in een winkeltotaal thuis. Ze verdwijnen niet uit
  // beeld, ze tellen alleen niet mee — de pagina zegt dat er ook bij.
  // Een regel zonder hoeveelheid kost bij elke winkel niets en zou het aantal
  // vergeleken regels ("voor 12 van de 15 regels") alleen maar opblazen.
  const lines = shoppingList.lines.filter((line) => line.fulfillment === "PICNIC" && line.quantity > 0);
  if (lines.length === 0) return { ...empty, shoppingListId: shoppingList.id };

  const ingredientIds = [...new Set(lines.map((line) => line.ingredientId))];

  // Waarmee de rangschikking moet vergelijken: het product dat op de regel
  // staat, dus wat er werkelijk besteld zou worden.
  const referenceNameByIngredient = new Map<string, string | null>(
    lines.map((line) => [line.ingredientId, line.product?.name ?? null])
  );

  const [rankedByIngredient, choices] = await Promise.all([
    getStoreCandidatesForIngredients(ingredientIds, providers, 8, now, referenceNameByIngredient),
    prisma.householdStoreProductChoice.findMany({
      where: { householdId, ingredientId: { in: ingredientIds }, provider: { in: providers } },
    }),
  ]);

  const choicesByIngredient = new Map<string, Map<ProductProvider, string>>();
  for (const choice of choices) {
    const perProvider = choicesByIngredient.get(choice.ingredientId) ?? new Map<ProductProvider, string>();
    perProvider.set(choice.provider, choice.productId);
    choicesByIngredient.set(choice.ingredientId, perProvider);
  }

  // De gekozen producten er rechtstreeks bij halen. De rangschikking levert
  // maar een handvol kandidaten per winkel, en die verzameling verandert
  // naarmate er prijzen bijkomen — een keuze die daarbuiten valt zou anders
  // stilzwijgend verdwijnen en de regel als "niet gevonden" tonen.
  // Wat er al in huis is — het hamsteradvies mag nooit adviseren om nog eens
  // drie potten te kopen van iets waar de kast al vol mee ligt.
  const inventoryItems = await prisma.inventoryItem.findMany({
    where: { householdId, ingredientId: { in: ingredientIds } },
    select: { ingredientId: true, quantity: true },
  });
  const inventoryByIngredient = new Map(
    inventoryItems.map((item) => [item.ingredientId, item.quantity ?? 0])
  );

  const pinned = await getStoreProductsByIds(choices.map((choice) => choice.productId), now);
  const pinnedById = new Map(pinned.map((product) => [product.productId, product]));

  const candidatesByIngredient = new Map(rankedByIngredient);
  for (const choice of choices) {
    const product = pinnedById.get(choice.productId);
    if (!product) continue;
    const existing = candidatesByIngredient.get(choice.ingredientId) ?? [];
    if (existing.some((candidate) => candidate.productId === product.productId)) continue;
    // Vooraan: dit is wat het huishouden zelf heeft aangewezen.
    candidatesByIngredient.set(choice.ingredientId, [product, ...existing]);
  }

  const basketLines: BasketLineInput[] = [];
  const candidatesByLine = new Map<string, StorePriceForIngredient[]>();
  const lineMeta = new Map<string, { ingredientId: string; picnicProductName: string | null; isFixed: boolean }>();

  for (const line of lines) {
    // De eenheidsprijs van ons eigen product, zodat de Picnic-kolom hetzelfde
    // getal toont als de winkels ernaast.
    //
    // Bewust dezelfde lezer als AH en Dirk (`parsePackContent`), en niet de
    // opgeslagen `packageQuantity`. Die laatste komt uit `parsePackageQuantity`,
    // die geen multipack kent: bij "6 x 1 liter" slaat hij 1000 op. Dat is voor
    // de verpakkingsberekening prima, maar als eenheidsprijs levert het € 6,00
    // per liter op naast een correcte € 1,00 per liter van AH — precies het
    // soort getal dat er overtuigend uitziet en fout is. `packageQuantity` is
    // hier alleen nog het vangnet voor een verpakkingstekst die deze lezer niet
    // begrijpt.
    const referenceContent =
      parsePackContent(line.product?.packageSize) ??
      (line.product?.packageQuantity != null
        ? { amount: line.product.packageQuantity, unit: line.ingredient.unit }
        : null);
    const referenceUnitPrice =
      line.product?.price == null ? null : unitPriceFor(Number(line.product.price), referenceContent);

    basketLines.push({
      lineId: line.id,
      ingredientId: line.ingredientId,
      ingredientName: line.ingredient.name,
      neededQuantity: line.quantity,
      unit: line.unit,
      // Bij een vaste of handmatige regel in stuks staat er een door de
      // gebruiker gekozen aantal verpakkingen ("2x brood"), geen hoeveelheid.
      // Dezelfde uitzondering die de rest van de app al maakt.
      quantityIsPackageCount: isUserChosenPackageCount(line),
      reference: line.product
        ? {
            name: line.product.name,
            brand: line.product.brand,
            packageSize: line.product.packageSize,
            // De klasse staat alleen opgeslagen bij producten die uit een
            // prijsverversing komen; Picnic-producten zijn er nooit langs
            // geweest. Zonder deze afleiding zou élke regel "niet te
            // vergelijken" heten, puur omdat het veld leeg is. Zonder merk
            // blijft het antwoord `null`, en dan is "niet vergelijkbaar" ook
            // het eerlijke antwoord.
            qualityTier:
              line.product.qualityTier ??
              deriveQualityTier({
                provider: line.product.provider,
                name: line.product.name,
                brand: line.product.brand,
              }),
            gtin: line.product.gtin,
            price: line.product.price === null ? null : Number(line.product.price),
            packageQuantity: line.product.packageQuantity,
            // De verpakkingsinhoud staat in de eenheid van het ingrediënt; de
            // regel kan er een andere hebben.
            packageUnit: line.ingredient.unit,
            unitPrice: referenceUnitPrice?.amount ?? null,
            unitPriceUnit: referenceUnitPrice?.unit ?? null,
          }
        : null,
    });
    lineMeta.set(line.id, {
      ingredientId: line.ingredientId,
      picnicProductName: line.product?.name ?? null,
      isFixed: line.source === "FIXED",
    });

    const all = candidatesByIngredient.get(line.ingredientId) ?? [];
    const chosen = choicesByIngredient.get(line.ingredientId);
    // Een handmatige correctie is geen suggestie maar een beslissing: is er
    // voor deze winkel een product gekozen, dan rekent de app daarmee en niet
    // met wat de matcher zelf mooier vindt.
    const effective = all.filter((candidate) => {
      const pinned = chosen?.get(candidate.provider);
      return pinned ? candidate.productId === pinned : true;
    });
    candidatesByLine.set(line.id, effective);
  }

  // Alleen voor kandidaten met een van-prijs valt er iets te beoordelen; voor
  // de rest hoeven we de geschiedenis niet op te halen.
  const withWasPrice = [...new Set(
    [...candidatesByLine.values()].flat().filter((candidate) => candidate.wasPrice !== null)
      .map((candidate) => candidate.productId)
  )];
  const histories = await getPriceHistories(withWasPrice);

  const storeCandidatesByLine = new Map<string, StoreCandidateInput[]>();
  for (const [lineId, candidates] of candidatesByLine) {
    storeCandidatesByLine.set(
      lineId,
      candidates.map((candidate) => toStoreCandidate(candidate, histories, now))
    );
  }

  const comparison = compareBasket(basketLines, storeCandidatesByLine, providers, now);

  return {
    comparison,
    choicesByIngredient,
    candidatesByIngredient,
    lineMeta,
    promoHighlights: collectPromoHighlights(comparison, lineMeta),
    splitAdvice: buildSplitAdvice(comparison),
    stockUpAdvice: collectStockUpAdvice(comparison, histories, inventoryByIngredient, lineMeta),
    shoppingListId: shoppingList.id,
  };
}

/**
 * Waarvan loont het om deze week extra te kopen?
 *
 * De "normale prijs" komt uit het prijsverloop dat hierboven toch al is
 * opgehaald — zonder die geschiedenis is er geen advies, en dat is precies de
 * bedoeling: zonder normale prijs weet je niet of dit een korting is.
 */
function collectStockUpAdvice(
  comparison: BasketComparison,
  histories: Map<string, PriceSample[]>,
  inventoryByIngredient: Map<string, number>,
  lineMeta: Map<string, { ingredientId: string }>
): StockUpAdvice[] {
  const advice: StockUpAdvice[] = [];

  for (const line of comparison.lines) {
    for (const store of line.stores.values()) {
      if (store.cost === null || store.packagesToBuy === null || store.packagesToBuy <= 0) continue;
      if (store.fakeDiscount) continue;

      const history = summarizePriceHistory(histories.get(store.productId) ?? []);
      const pricePerPackage = Number((store.cost / store.packagesToBuy).toFixed(2));
      const item = adviseStockUp({
        ingredientName: line.ingredientName,
        productName: store.name,
        packagesThisWeek: store.packagesToBuy,
        pricePerPackage,
        typicalPricePerPackage: history.typicalPrice,
        inStock: inventoryByIngredient.get(lineMeta.get(line.lineId)?.ingredientId ?? "") ?? 0,
        packageQuantity: store.packageQuantity,
      });
      if (item) advice.push(item);
    }
  }

  return advice.sort((a, b) => b.saving - a.saving);
}

/**
 * Welke acties zijn het waard om te noemen?
 *
 * Alleen wat bij dít aantal verpakkingen echt geld scheelt. "1+1 gratis" bij
 * één stuk staat er dus niet tussen, en een van-prijs die de geschiedenis
 * tegenspreekt ook niet — anders wordt de attentie een reclamebalk in plaats
 * van een hulpmiddel.
 */
function collectPromoHighlights(
  comparison: BasketComparison,
  lineMeta: Map<string, { isFixed: boolean }>
): PromoHighlight[] {
  const highlights: PromoHighlight[] = [];

  for (const line of comparison.lines) {
    for (const store of line.stores.values()) {
      if (!store.promoLabel || store.fakeDiscount) continue;
      if (store.cost === null || store.costWithoutPromo === null) continue;
      const saving = Number((store.costWithoutPromo - store.cost).toFixed(2));
      if (saving < 0.01) continue;

      highlights.push({
        lineId: line.lineId,
        ingredientName: line.ingredientName,
        provider: store.provider,
        promoLabel: store.promoLabel,
        explanation: store.promoExplanation,
        saving,
        isFixed: lineMeta.get(line.lineId)?.isFixed ?? false,
      });
    }
  }

  // Vaste boodschappen eerst: die koop je elke week, dus daar telt een actie
  // zwaarder dan bij iets eenmaligs.
  return highlights.sort((a, b) => {
    if (a.isFixed !== b.isFixed) return a.isFixed ? -1 : 1;
    return b.saving - a.saving;
  });
}

/**
 * Eén winkelproduct naar de vorm die de doorrekening gebruikt, inclusief het
 * oordeel over de actie.
 *
 * Dat oordeel hoort hier en niet in het domein: het leunt op de
 * prijsgeschiedenis uit de database. Wat het domein ermee doet — de korting
 * niet als voordeel tonen — staat wél daar.
 */
function toStoreCandidate(
  candidate: StorePriceForIngredient,
  histories: Map<string, PriceSample[]>,
  now: Date
): StoreCandidateInput {
  const verdict = judgeDiscount(
    { price: candidate.price, wasPrice: candidate.wasPrice, observedAt: candidate.observedAt },
    histories.get(candidate.productId) ?? [],
    now
  );

  return {
    fakeDiscount: verdict.kind === "NEPKORTING",
    provider: candidate.provider,
    productId: candidate.productId,
    name: candidate.name,
    brand: candidate.brand,
    packageSize: candidate.packageSize,
    packageQuantity: candidate.packageQuantity,
    packageUnit: candidate.unit,
    qualityTier: candidate.qualityTier,
    gtin: candidate.gtin,
    price: candidate.price,
    promoLabel: candidate.promoLabel,
    promoUntil: candidate.promoUntil,
    wasPrice: candidate.wasPrice,
    productUrl: candidate.productUrl,
    unitPrice: candidate.unitPrice,
    unitPriceUnit: candidate.unitPriceUnit,
    observedAt: candidate.observedAt,
    stale: candidate.stale,
  };
}
