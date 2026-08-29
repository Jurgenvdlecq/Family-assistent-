import { prisma } from "@/lib/prisma";
import type { ProductProvider, QualityTier, Unit } from "@/generated/prisma/enums";
import { rankStoreProducts } from "@/domain/pricing/storeMatch";
import { parsePackContent } from "@/domain/pricing/unitPrice";
import type { ProviderProduct } from "@/domain/pricing/types";
import { displayableProductUrl } from "@/domain/pricing/productUrl";
import { getLatestPrices, isPriceStale } from "./observations";

/**
 * De bekende winkelprijzen per ingrediënt, uit wat de laatste verversing heeft
 * opgeslagen.
 *
 * Leest bewust alleen uit de database: een pagina mag nooit op een externe
 * winkel wachten. Staat er niets, dan is het antwoord "niet gevonden" — en dat
 * hoort ook zo op het scherm te komen, niet als nul.
 */

export interface StorePriceForIngredient {
  provider: ProductProvider;
  productId: string;
  name: string;
  brand: string | null;
  packageSize: string | null;
  /** Inhoud in basiseenheden; `null` als de verpakking niet te lezen was. */
  packageQuantity: number | null;
  /**
   * De eenheid waarin `packageQuantity` staat — die van de verpakkingstekst
   * zelf, niet die van het ingrediënt.
   *
   * Dat onderscheid is de kern. `packageQuantity` wordt gelezen uit wat er op
   * de verpakking staat ("4 stuks", "1 l"), en dat hoeft niets te maken te
   * hebben met de eenheid waarin wij het ingrediënt bijhouden. Stond hier de
   * eenheid van het ingrediënt, dan lijken twee verpakkingen altijd in
   * dezelfde eenheid te staan en rekent de vergelijking vrolijk "4 stuks" af
   * tegen "750 gram" — dat leverde € 6.181,74 voor drie pakken Alpro op.
   */
  unit: Unit | null;
  qualityTier: QualityTier | null;
  gtin: string | null;
  /** Waar deze winkel bevestigt dat het product vrij van is. Leeg = onbekend. */
  freeFromAllergens: string[];
  /** De productpagina bij de winkel, om zelf na te kijken of het hetzelfde is. */
  productUrl: string | null;
  /** Prijs per liter/kilo/stuk, zodat verpakkingsgroottes vergelijkbaar zijn. */
  unitPrice: number | null;
  unitPriceUnit: Unit | null;
  price: number;
  wasPrice: number | null;
  promoLabel: string | null;
  promoUntil: Date | null;
  observedAt: Date;
  /** Ouder dan de versheidsgrens — de UI moet dat erbij zeggen. */
  stale: boolean;
}

/**
 * In welke eenheid staat de verpakkingsinhoud van dit winkelproduct?
 *
 * Uit de verpakkingstekst zelf, met dezelfde lezer die de inhoud ook heeft
 * bepaald (`parsePackContent` in de prijsverversing) — zo horen getal en
 * eenheid bij elkaar. Is de tekst niet te lezen, dan valt hij terug op de
 * eenheid van het ingrediënt; `packageQuantity` is dan toch meestal `null`,
 * en dan valt er verderop sowieso niets te rekenen.
 */
function packageContentUnit(packageSize: string | null, ingredientUnit: Unit | null): Unit | null {
  return parsePackContent(packageSize)?.unit ?? ingredientUnit;
}

/**
 * Een eenheidsprijs die niet in dezelfde eenheid staat als het ingrediënt,
 * zeggen we liever niet.
 *
 * Aanleiding: bij vuilniszakken staat "60 liter" op de verpakking. Dat is hoe
 * groot één zák is, niet wat er in het pak zit — en toch werd er "€ 0,03 per
 * liter" van gemaakt. Wij tellen vuilniszakken in stuks, dus een prijs per
 * liter hoort daar niet. Zo'n getal ziet er overtuigend uit en betekent niets,
 * en dat is precies het soort fout dat dit scherm niet mag maken.
 */
function comparableUnitPrice(
  amount: number | null,
  unit: Unit | null,
  ingredientUnit: Unit | null
): { amount: number | null; unit: Unit | null } {
  const usable = amount !== null && unit !== null && (ingredientUnit === null || unit === ingredientUnit);
  return usable ? { amount, unit } : { amount: null, unit: null };
}

/** Per ingrediënt, per winkel: het best passende product met zijn laatste prijs. */
export type StorePricesByIngredient = Map<string, Map<ProductProvider, StorePriceForIngredient>>;

/** Per ingrediënt: alle bruikbare winkelproducten, op volgorde van hoe goed ze passen. */
export type StoreCandidatesByIngredient = Map<string, StorePriceForIngredient[]>;

/**
 * Zoekt voor elk ingrediënt het best passende product per winkel.
 *
 * De rangschikking wordt hier opnieuw uitgerekend met dezelfde functie als de
 * verversing (`rankStoreProducts`), zodat "welk product hoort hierbij" maar op
 * één plek beslist wordt. Alternatief zou een opgeslagen volgorde zijn, maar
 * die veroudert zodra de matchregels veranderen.
 */
export async function getStorePricesForIngredients(
  ingredientIds: string[],
  providers: ProductProvider[],
  now: Date = new Date()
): Promise<StorePricesByIngredient> {
  const candidates = await getStoreCandidatesForIngredients(ingredientIds, providers, 1, now);
  const result: StorePricesByIngredient = new Map();
  for (const [ingredientId, list] of candidates) {
    const perProvider = new Map<ProductProvider, StorePriceForIngredient>();
    for (const candidate of list) {
      // De lijst is al gesorteerd op hoe goed het past; de eerste per winkel wint.
      if (!perProvider.has(candidate.provider)) perProvider.set(candidate.provider, candidate);
    }
    result.set(ingredientId, perProvider);
  }
  return result;
}

/**
 * Specifieke producten opzoeken, buiten de rangschikking om.
 *
 * Nodig voor een handmatige correctie: die is een beslissing, geen suggestie.
 * Zou de gekozen tegenhanger alleen uit de shortlist van de matcher gehaald
 * worden, dan verdwijnt de keuze zodra de matcher later een ander product
 * mooier vindt — en dat zonder melding. Hier wordt hij dus rechtstreeks
 * opgehaald.
 */
export async function getStoreProductsByIds(
  productIds: string[],
  now: Date = new Date()
): Promise<StorePriceForIngredient[]> {
  if (productIds.length === 0) return [];
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    include: { ingredient: { select: { unit: true } } },
  });
  const latest = await getLatestPrices(products.map((product) => product.id));

  return products
    .map((product): StorePriceForIngredient | null => {
      const price = latest.get(product.id);
      // Zonder waarneming is er geen prijs — en dat is geen prijs van nul.
      if (!price) return null;
      const ingredientUnit = product.ingredient?.unit ?? null;
      const unitPrice = comparableUnitPrice(price.unitPrice, price.unitPriceUnit, ingredientUnit);
      return {
        provider: product.provider,
        productId: product.id,
        name: product.name,
        brand: product.brand,
        packageSize: product.packageSize,
        packageQuantity: product.packageQuantity,
        unit: packageContentUnit(product.packageSize, ingredientUnit),
        qualityTier: product.qualityTier,
        gtin: product.gtin,
        freeFromAllergens: product.freeFromAllergens,
        productUrl: displayableProductUrl(product.productUrl),
        unitPrice: unitPrice.amount,
        unitPriceUnit: unitPrice.unit,
        price: price.price,
        wasPrice: price.wasPrice,
        promoLabel: price.promoLabel,
        promoUntil: price.promoUntil,
        observedAt: price.observedAt,
        stale: isPriceStale(price.observedAt, now),
      };
    })
    .filter((product) => product !== null);
}

/**
 * Alle bruikbare kandidaten per ingrediënt, per winkel — niet alleen de beste.
 *
 * Het mandje doorrekenen heeft meer dan één kandidaat nodig: het beste product
 * op naam is niet altijd het best vergelijkbare product. Houdbare melk kan
 * bovenaan staan terwijl de verse variant er ook is; die keuze hoort bij de
 * equivalentieregels thuis, niet hier. Deze functie levert dus de kandidaten
 * en laat de afweging aan `compareBasket`.
 */
export async function getStoreCandidatesForIngredients(
  ingredientIds: string[],
  providers: ProductProvider[],
  perProviderLimit = 8,
  now: Date = new Date(),
  /**
   * Per ingrediënt het product dat wij zelf kopen: naam én verpakking.
   *
   * Zonder dit rangschikt deze functie alleen op de ingrediëntnaam, en die is
   * soms alleen een merk — dan scoren alle varianten gelijk en beslist een
   * willekeurige tiebreak welke er overblijven bij het afkappen.
   */
  referenceByIngredient?: Map<string, { name: string | null; packageSize: string | null }>
): Promise<StoreCandidatesByIngredient> {
  const result: StoreCandidatesByIngredient = new Map();
  if (ingredientIds.length === 0 || providers.length === 0) return result;

  const products = await prisma.product.findMany({
    where: { ingredientId: { in: ingredientIds }, provider: { in: providers } },
    // `searchTerm` hoort hier net zo goed bij als bij het ophalen. De
    // toelating draait namelijk twee keer: één keer bij de verversing om te
    // bepalen wát er wordt opgeslagen, en hier nog een keer om te bepalen wat
    // er getoond wordt. Werd hier alsnog op de ingrediëntnaam gematcht, dan
    // vloog "Snoeptomaatjes" er in deze tweede ronde gewoon weer uit en zou
    // de hele ingetypte zoekterm niets uithalen.
    include: { ingredient: { select: { id: true, name: true, unit: true, searchTerm: true } } },
  });
  if (products.length === 0) return result;

  const latest = await getLatestPrices(products.map((product) => product.id));

  // Per (ingrediënt, winkel) de kandidaten verzamelen en er één kiezen.
  const grouped = new Map<string, typeof products>();
  for (const product of products) {
    if (!product.ingredientId) continue;
    const key = `${product.ingredientId}:${product.provider}`;
    const list = grouped.get(key) ?? [];
    list.push(product);
    grouped.set(key, list);
  }

  for (const [key, candidates] of grouped) {
    const [ingredientId, provider] = key.split(":") as [string, ProductProvider];
    // Een zelf ingetypte zoekterm gaat voor: wie 'm invulde zei daarmee dat de
    // eigen naam het niet redde.
    const ingredientName =
      candidates[0].ingredient?.searchTerm?.trim() || candidates[0].ingredient?.name || "";

    // Alleen kandidaten met een bekende prijs doen mee — een product zonder
    // waarneming is geen prijs van nul.
    const withPrice = candidates.filter((candidate) => latest.has(candidate.id));
    if (withPrice.length === 0) continue;

    const ranked = rankStoreProducts(
      ingredientName,
      withPrice.map(
        (candidate): ProviderProduct => ({
          provider: candidate.provider,
          externalRef: candidate.id,
          name: candidate.name,
          brand: candidate.brand,
          packageSize: candidate.packageSize,
          content:
            candidate.packageQuantity !== null && candidate.ingredient
              ? { amount: candidate.packageQuantity, unit: candidate.ingredient.unit }
              : null,
          price: Number(candidate.price ?? 0),
          wasPrice: null,
          unitPrice: null,
          promoType: "GEEN",
          promoLabel: null,
          promoUntil: null,
          gtin: candidate.gtin,
          labels: [],
          freeFromAllergens: candidate.freeFromAllergens,
          imageId: null,
          url: candidate.productUrl,
        })
      ),
      perProviderLimit,
      referenceByIngredient?.get(ingredientId) ?? null
    );
    if (ranked.length === 0) continue;

    const perIngredient = result.get(ingredientId) ?? [];
    for (const match of ranked) {
      const chosen = withPrice.find((candidate) => candidate.id === match.product.externalRef);
      if (!chosen) continue;
      const price = latest.get(chosen.id)!;
      const ingredientUnit = chosen.ingredient?.unit ?? null;
      const unitPrice = comparableUnitPrice(price.unitPrice, price.unitPriceUnit, ingredientUnit);
      perIngredient.push({
        provider,
        productId: chosen.id,
        name: chosen.name,
        brand: chosen.brand,
        packageSize: chosen.packageSize,
        packageQuantity: chosen.packageQuantity,
        unit: packageContentUnit(chosen.packageSize, ingredientUnit),
        qualityTier: chosen.qualityTier,
        gtin: chosen.gtin,
        freeFromAllergens: chosen.freeFromAllergens,
        productUrl: displayableProductUrl(chosen.productUrl),
        unitPrice: unitPrice.amount,
        unitPriceUnit: unitPrice.unit,
        price: price.price,
        wasPrice: price.wasPrice,
        promoLabel: price.promoLabel,
        promoUntil: price.promoUntil,
        observedAt: price.observedAt,
        stale: isPriceStale(price.observedAt, now),
      });
    }
    if (perIngredient.length > 0) result.set(ingredientId, perIngredient);
  }

  return result;
}
