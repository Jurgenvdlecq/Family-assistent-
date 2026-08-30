import type { ProviderProduct } from "./types";
import { derivePackageForm } from "./packageForm";

/**
 * Welk winkelproduct hoort bij welk ingrediënt?
 *
 * Dit is expres een voorzichtige, uitlegbare score en geen slimme
 * tekstvergelijking. De reden staat in de opdracht: een matcher die er
 * makkelijk iets bij zoekt, liegt. Liever een ingrediënt zonder match — dat
 * wordt zichtbaar getoond als "niet gevonden" — dan een match die er goed
 * uitziet en het verkeerde product is.
 *
 * De score zegt alleen iets over *of dit hetzelfde product is*. Of het ook
 * een gelijkwaardige keuze is (bio, vers, merk) is een aparte vraag, en die
 * hoort in `equivalence.ts`.
 */

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Woorden die niets zeggen over wélk product het is.
 *
 * De winkelnamen staan hier niet toevallig bij. Onze eigen ingrediëntnamen
 * komen uit Picnic-producten en heten daardoor soms letterlijk "Picnic
 * Appelmoes". Zonder "picnic" als ruiswoord haalt dat ingrediënt bij Albert
 * Heijn nooit de drempel — "AH Appelmoes" dekt dan maar één van de twee
 * woorden — en meldt het scherm "niet gevonden" terwijl het product er gewoon
 * ligt. In productie was dat op de meeste regels het geval.
 */
const NOISE_WORDS = new Set([
  "ah",
  // Losse maatafkortingen. Die stonden er niet bij zolang alles van twee
  // letters toch al wegviel; nu korte woorden wél meetellen (zie hieronder)
  // moeten ze hier expliciet staan.
  "st",
  "gr",
  "kg",
  "ml",
  "cl",
  "albert",
  "heijn",
  "dirk",
  "picnic",
  "de",
  "het",
  "een",
  "van",
  "met",
  "per",
  "stuk",
  "stuks",
  "gram",
  "kilo",
  "liter",
  "verpakking",
]);

/**
 * Getallen met of zonder eenheid: "750g", "1l", "500", "6x".
 *
 * Die horen niet in een zoekterm en zeggen niets over wélk product het is —
 * de verpakkingsgrootte wordt apart en veel zorgvuldiger gelezen. Zonder deze
 * filter zou zoeken op onze eigen productnaam "alpro mild creamy 750g"
 * opleveren, en daar vindt een winkel niets bij.
 */
const NUMBER_LIKE = /^\d+(?:[.,]\d+)?(?:g|gr|gram|kg|ml|cl|l|st|stuk|stuks|x)?$/;

export function contentWords(value: string): string[] {
  // Vanaf twee letters. Eerder viel alles van twee tekens weg, en dat kostte
  // precies de woorden die het onderscheid maken: van "Wc papier" bleef alleen
  // "papier" over, en daarmee paste elk soort papier. Maatafkortingen en
  // getallen vallen hierboven en hieronder alsnog weg.
  return normalize(value)
    .split(" ")
    .filter((word) => word.length >= 2 && !NOISE_WORDS.has(word) && !NUMBER_LIKE.test(word));
}

export const STORE_MATCH_THRESHOLD = 0.6;

/**
 * Hoeveel van ons eigen product een kandidaat minstens moet dekken.
 *
 * Dezelfde grens die het equivalentiemodel gebruikt om iets "een ander
 * product" te noemen. Bewust op de helft en niet hoger, want het merk is
 * meestal één van de woorden en een ander merk mag geen beletsel zijn: ons
 * "Testproduct: Aardappelen" en de "Aardappelen" van de winkel delen precies
 * de helft, en dat is wél hetzelfde product.
 *
 * Op zichzelf is die grens te grof — zie `coversWhatItIs` hieronder.
 */
export const REFERENCE_MATCH_THRESHOLD = 0.5;

/**
 * Hoeveel van de gevraagde woorden komen echt terug in deze productnaam?
 *
 * Alleen **hele woorden** tellen. Dat is de kern van deze functie, en het is
 * met schade en schande geleerd: eerder werd er op letterniveau gezocht, en
 * dan zit "papier" in "printpapier". Zo kreeg "wc papier" een perfecte score
 * op AH-printpapier — precies het soort match dat er overtuigend uitziet en
 * het verkeerde product is.
 *
 * Eén uitzondering, en die is symmetrisch: winkels schrijven samenstellingen
 * los of aaneen. "Allesreinigerdoekjes" bij ons, "Allesreiniger doekjes" bij
 * Albert Heijn. Een reeks opeenvolgende woorden aan de ene kant mag daarom
 * samen precies één woord aan de andere kant vormen. "Precies" is het hele
 * punt: "papier" vormt niet "printpapier", want "print" blijft over — en
 * juist dat overgebleven stuk is wat de twee producten verschillend maakt.
 * In een Nederlandse samenstelling zit de soort vooraan, niet achteraan.
 */
export function wordCoverage(wanted: string[], productWords: string[]): number {
  if (wanted.length === 0) return 0;

  const covered = new Array<boolean>(wanted.length).fill(false);
  const productSet = new Set(productWords);

  for (const [index, word] of wanted.entries()) {
    if (productSet.has(word)) covered[index] = true;
  }

  // Losse productwoorden die samen één gevraagd woord vormen.
  for (let start = 0; start < productWords.length; start++) {
    let joined = "";
    for (let end = start; end < productWords.length; end++) {
      joined += productWords[end];
      for (const [index, word] of wanted.entries()) {
        if (!covered[index] && word === joined) covered[index] = true;
      }
    }
  }

  // En andersom: losse gevraagde woorden die samen één productwoord vormen.
  for (let start = 0; start < wanted.length; start++) {
    let joined = "";
    for (let end = start; end < wanted.length; end++) {
      joined += wanted[end];
      if (productSet.has(joined)) {
        for (let index = start; index <= end; index++) covered[index] = true;
      }
    }
  }

  return covered.filter(Boolean).length / wanted.length;
}

/**
 * Waarmee we bij een winkel zoeken.
 *
 * Niet de ingrediëntnaam zelf: die kan de naam van een andere winkel bevatten
 * ("Picnic Appelmoes"), en daar zoekt Albert Heijn niets nuttigs op. Blijft er
 * niets over, dan valt het terug op de oorspronkelijke naam — liever een
 * matige zoekopdracht dan een lege.
 */
/**
 * Meer dan dit aantal woorden maakt een zoekopdracht bij een winkel eerder
 * slechter dan beter.
 *
 * De zoekmachines van winkels worden strenger naarmate je meer woorden geeft.
 * Onze eigen productnaam kan lang zijn ("Alpro mild & creamy naturel groot
 * formaat"), en dan vindt de winkel haar eigen variant van datzelfde product
 * niet meer. Vier woorden is specifiek genoeg om het juiste product te
 * vinden en kort genoeg om varianten niet uit te sluiten.
 */
const MAX_SEARCH_WORDS = 4;

export function storeSearchTerm(ingredientName: string): string {
  const words = contentWords(ingredientName);
  return words.length > 0 ? words.slice(0, MAX_SEARCH_WORDS).join(" ") : ingredientName;
}

/**
 * Hoe goed dekt dit winkelproduct de naam van het ingrediënt?
 *
 * 1 betekent: alle betekenisdragende woorden van het ingrediënt komen terug in
 * de productnaam. Onder de drempel geldt het als niet gevonden.
 */
export function scoreStoreProductForIngredient(ingredientName: string, productName: string): number {
  return wordCoverage(contentWords(ingredientName), contentWords(productName));
}

/**
 * Woorden die zeggen hoe iets verpakt is, niet wát het is.
 *
 * Nodig om het laatste betekenisdragende woord van een productnaam te vinden:
 * bij "Page toiletpapier 9 rollen" is dat "toiletpapier" en niet "rollen".
 */
const PACKAGING_WORDS = new Set([
  "rol",
  "rollen",
  "zak",
  "zakken",
  "zakje",
  "zakjes",
  "pak",
  "pakken",
  "fles",
  "flessen",
  "blik",
  "blikken",
  "doos",
  "dozen",
  "plak",
  "plakken",
  "sneetje",
  "sneetjes",
  "doekje",
  "doekjes",
  "tablet",
  "tabletten",
  "capsule",
  "capsules",
  "wasbeurt",
  "wasbeurten",
]);

/**
 * Dekt deze kandidaat het woord dat zegt wát ons product is?
 *
 * In een Nederlandse productnaam staat de soort achteraan: "magere **melk**",
 * "Alpro mild & **creamy**", "Testproduct: **Aardappelen**". Wat ervóór staat
 * is een merk of een eigenschap, en dat mag best verschillen — daar is de
 * halve-woorden-grens voor.
 *
 * Maar de helft alleen is te grof. Bij een naam van twee woorden ís de helft
 * precies één woord, en dan haalde "Campina Magere kwark" de toelating bij het
 * ingrediënt magere melk: "magere" klopte, "melk" niet. Een kwark is geen melk.
 * Andersom deelt "Aardappelen" van de winkel óók maar de helft met ons
 * "Testproduct: Aardappelen" — en dat is wél hetzelfde product. Het verschil
 * zit niet in hoeveel woorden er overeenkomen maar in wélk woord ontbreekt.
 *
 * Verpakkingswoorden tellen niet als soort: bij "9 rollen" gaat het nog steeds
 * om toiletpapier, en een winkel die het in stuks aanbiedt verkoopt hetzelfde.
 */
function coversWhatItIs(referenceWords: string[], productWords: string[]): boolean {
  const meaningful = referenceWords.filter((word) => !PACKAGING_WORDS.has(word));
  const head = meaningful[meaningful.length - 1];
  // Geen bruikbaar hoofdwoord (alleen verpakkingswoorden, of een lege naam):
  // dan valt er niets extra's te eisen.
  if (head === undefined) return true;
  return wordCoverage([head], productWords) === 1;
}

export interface StoreMatchResult {
  product: ProviderProduct;
  score: number;
  /**
   * Hoeveel betekenisdragende woorden de productnaam méér heeft dan het
   * ingrediënt. "AH Biologische halfvolle melk" dekt "halfvolle melk" volledig,
   * maar is een specifieker product dan "AH Halfvolle melk" — en dat verschil
   * moet in de volgorde terugkomen, anders dringt een bioproduct voor bij het
   * gewone.
   */
  surplusWords: number;
  /** Hoe sterk dit lijkt op het product dat wij zelf kopen; 0 als we dat niet weten. */
  referenceScore: number;
  /** Zelfde verpakkingsvorm als het onze (losse porties of één verpakking). */
  sameForm: boolean;
}

/**
 * De beste kandidaten voor dit ingrediënt, gesorteerd van meest naar minst
 * passend. Alles onder de drempel valt af.
 *
 * Er worden er meerdere teruggegeven en niet één: het equivalentiemodel moet
 * straks kunnen kiezen tussen "hetzelfde soort product" en "een goedkoper
 * alternatief uit een andere klasse", en dat kan alleen als beide bewaard zijn.
 */
export function rankStoreProducts(
  ingredientName: string,
  products: ProviderProduct[],
  limit = 5,
  /**
   * Het product dat wij zelf kopen, als we dat kennen.
   *
   * Dit is het verschil tussen "hoort dit bij dit ingrediënt" en "is dit
   * hetzelfde als wat wij kopen". De ingrediëntnaam is soms alleen een merk —
   * "Alpro" — en dan scoren álle artikelen van dat merk even hoog en bepaalt
   * een willekeurige tiebreak welke er bewaard blijven. In productie leverde
   * dat koffiemelk op terwijl Albert Heijn precies hetzelfde product verkoopt.
   *
   * De verpakking telt apart mee, en dat is geen luxe: bij appelmoes heet ons
   * eigen product "Picnic appelmoes", en na het weglaten van de winkelnaam
   * blijft daar precies hetzelfde woord van over als de ingrediëntnaam. De
   * naam onderscheidt dan niets meer, en het enige wat onze cupjes van een pot
   * onderscheidt is de vorm van de verpakking.
   *
   * De toelating verandert hier niet door: of iets bij dit ingrediënt hoort
   * blijft de ingrediëntnaam bepalen. Alleen de volgorde wordt hiermee
   * gemaakt, zodat het product dat het meest op het onze lijkt vooraan komt en
   * niet wegvalt bij het afkappen.
   */
  reference?: { name?: string | null; packageSize?: string | null } | null
): StoreMatchResult[] {
  const wanted = new Set(contentWords(ingredientName));
  const referenceWords = contentWords(reference?.name ?? "");
  const referenceForm = derivePackageForm(reference?.packageSize, reference?.name);

  /**
   * Voegt de ingrediëntnaam iets toe dat ons eigen product niet al zegt?
   *
   * Dit onderscheidt twee gevallen die er anders hetzelfde uitzien.
   *
   * - "Eieren 10 stuks" tegenover ons "scharreleieren": het woord "eieren"
   *   komt in ons product niet voor, dus een treffer daarop is een eigen
   *   aanwijzing. Elk ei bij de winkel hoort erbij te mogen.
   * - "Alpro" tegenover ons "Alpro mild & creamy": de ingrediëntnaam is hier
   *   niets anders dan een deel van onze eigen productnaam — een merk. Een
   *   treffer daarop zegt alleen "van hetzelfde merk", en dan is Alpro
   *   koffiemelk ineens een kandidaat voor yoghurt. Daar is de gelijkenis met
   *   ons eigen product wél het enige bruikbare houvast.
   */
  const ingredientAddsNothing =
    referenceWords.length > 0 && [...wanted].every((word) => referenceWords.includes(word));

  return products
    .map((product) => ({
      product,
      score: scoreStoreProductForIngredient(ingredientName, product.name),
      referenceScore:
        referenceWords.length > 0 ? wordCoverage(referenceWords, contentWords(product.name)) : 0,
      // Losse porties horen bij losse porties, een pot bij een pot. Onbekend
      // telt nooit als verschil — dan weten we het simpelweg niet.
      sameForm:
        referenceForm !== null &&
        derivePackageForm(product.packageSize, product.name) === referenceForm,
      surplusWords: contentWords(product.name).filter((word) => !wanted.has(word)).length,
    }))
    .filter((match) => {
      // Toegelaten als het bij het ingrediënt hoort óf op ons eigen product
      // lijkt. Dat "of" is niet vrijblijvend, want beide kanten kunnen op
      // zichzelf misleiden:
      //
      // - De ingrediëntnaam. Bij "Wc papier" blijft na het filteren "wc" en
      //   "papier" over, en zonder de andere kant zou elk soort papier passen.
      // - Ons eigen product. Bij "Eieren 10 stuks" heet het onze
      //   "scharreleieren" — één samengesteld woord. Elk ei bij de winkel dat
      //   gewoon "eieren" heet dekt dáár niets van, ook al is het precies wat
      //   het ingrediënt vraagt.
      //
      // Hier stond een tweede, strengere regel onder: kenden we ons eigen
      // product, dán was gelijkenis daarmee verplicht. Daarmee werkte het "of"
      // in de praktijk als "en", en verdween bij eieren élke kandidaat met een
      // perfecte score op de ingrediëntnaam. Die regel is weggehaald na een
      // meting van het geval waarvoor ze ooit bedoeld was: printerpapier
      // scoort tegenwoordig 0,00 op "Wc papier", omdat korte woorden als "wc"
      // weer meetellen en er alleen nog op hele woorden gematcht wordt. Die
      // twee eerdere reparaties vangen het al; deze derde kostte alleen nog
      // maar goede producten.
      //
      const looksLikeOurs = match.referenceScore >= REFERENCE_MATCH_THRESHOLD;

      // Waar de ingrediëntnaam niets toevoegt (zie hierboven) is ons eigen
      // product de enige maatstaf, en dan is "de helft van de woorden" te
      // grof: dan moet óók het woord kloppen dat zegt wát het is.
      if (ingredientAddsNothing) {
        return looksLikeOurs && coversWhatItIs(referenceWords, contentWords(match.product.name));
      }

      return match.score >= STORE_MATCH_THRESHOLD || looksLikeOurs;
    })
    .sort(
      (a, b) =>
        // Hoe goed past dit aan de béste van de twee kanten? Alleen op de
        // ingrediëntscore sorteren zette bij eieren precies het verkeerde
        // vooraan: "Scharreleieren" is exact wat wij kopen, maar scoort 0,00
        // op het woord "eieren" en belandde daarmee achter drie willekeurige
        // eieren. Toelating kijkt naar beide kanten, dus de volgorde ook.
        Math.max(b.score, b.referenceScore) - Math.max(a.score, a.referenceScore) ||
        // Lijkt het op wat wij zelf kopen? Dat weegt zwaarder dan alle
        // vuistregels hieronder, die alleen bestaan omdat we vroeger niets
        // beters hadden.
        b.referenceScore - a.referenceScore ||
        b.score - a.score ||
        // Zelfde verpakkingsvorm. Beslissend zodra de naam niets meer
        // onderscheidt, zoals bij appelmoes.
        Number(b.sameForm) - Number(a.sameForm) ||
        // Het minst specifieke product voorop: dat is de gewone variant.
        a.surplusWords - b.surplusWords ||
        // Daarna de kleinste verpakking — meestal het normale formaat, niet
        // de familieverpakking.
        (a.product.content?.amount ?? Number.MAX_SAFE_INTEGER) -
          (b.product.content?.amount ?? Number.MAX_SAFE_INTEGER) ||
        a.product.externalRef.localeCompare(b.product.externalRef)
    )
    .slice(0, limit);
}
