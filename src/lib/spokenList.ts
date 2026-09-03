import { contentWords } from "@/domain/pricing/storeMatch";
import {
  COUNT_WORDS,
  LEAD_IN_WORDS,
  SPOKEN_NUMBERS,
  TRAILING_WORDS,
} from "@/lib/fixedGroceryProductChoice";

/**
 * Een ingesproken boodschappenlijstje uit elkaar halen.
 *
 * Spraakherkenning geeft terug wat je zégt, en wie zijn lijstje opnoemt zet
 * geen komma's: "melk brood hagelslag pindakaas" komt er als één zin uit. De
 * app maakte daar één zoekopdracht van, vond niets, en dan is de microfoon een
 * knop die niets oplevert.
 *
 * De moeilijkheid is dat woorden soms wél bij elkaar horen. "Magere melk" is
 * één product, "melk brood" zijn er twee, en aan de woorden alleen zie je dat
 * verschil niet. Daarom drie bronnen, in deze volgorde:
 *
 * 1. **Wat de app al kent.** De ingrediënten die er zijn, zijn precies de
 *    dingen die dit huishouden koopt. Komt "snoeptomaatjes" daarin voor, dan
 *    hoort dat bij elkaar — dat weten we, dat hoeven we niet te raden.
 * 2. **Aantallen, verpakkingen en inleidende woorden horen bij wat erna komt.**
 *    "Doe maar twee pakken melk" is één regel.
 * 3. **Bijvoeglijke woorden plakken aan hun buurwoord.** "Magere" hoort bij
 *    wat volgt, "naturel" bij wat eraan voorafgaat.
 *
 * De woordenlijsten voor aantallen, verpakkingen en vulwoorden komen uit
 * `fixedGroceryProductChoice` — dezelfde die de regels daarna weer opschoont.
 * Twee eigen kopieën zouden onvermijdelijk uit elkaar gaan lopen.
 *
 * En één regel die boven alles gaat: **heb je zelf komma's of regels gebruikt,
 * dan blijven die staan.** Wie "drinkyoghurt framboos" intikt bedoelt één
 * product, en daar hoort de app niet overheen te gaan raden. Alleen als er
 * helemaal geen structuur in zit — precies wat dicteren oplevert — probeert ze
 * het zelf.
 */

/** Woorden die bij het vólgende woord horen. */
const LEADING_MODIFIERS = new Set([
  "magere",
  "mager",
  "halfvolle",
  "volle",
  "verse",
  "vers",
  "biologische",
  "biologisch",
  "jonge",
  "belegen",
  "oude",
  "rode",
  "groene",
  "witte",
  "bruine",
  "gele",
  "zwarte",
  "kleine",
  "grote",
  "zoete",
  "volkoren",
  "griekse",
  "franse",
  "italiaanse",
]);

/** En woorden die juist bij het vórige horen. */
const TRAILING_MODIFIERS = new Set([
  "naturel",
  "gesneden",
  "geraspt",
  "geschild",
  "gemalen",
  "gezouten",
  "ongezouten",
  "halfvol",
  "gepeld",
]);

/** Hoeveel woorden een bekende naam maximaal mag beslaan. */
const MAX_KNOWN_NAME_WORDS = 4;

function attachesForward(word: string): boolean {
  const lower = word.toLowerCase();
  return (
    SPOKEN_NUMBERS.has(lower) ||
    COUNT_WORDS.has(lower) ||
    LEAD_IN_WORDS.has(lower) ||
    LEADING_MODIFIERS.has(lower) ||
    /^\d+([.,]\d+)?$/.test(lower)
  );
}

function attachesBackward(word: string): boolean {
  const lower = word.toLowerCase();
  return TRAILING_MODIFIERS.has(lower) || TRAILING_WORDS.has(lower);
}

/**
 * De namen die de app kent, teruggebracht tot hun betekenisdragende woorden.
 *
 * "Picnic Appelmoes" wordt "appelmoes" — wie dat inspreekt zegt de winkelnaam
 * er niet bij. Dezelfde bewerking als de productmatcher gebruikt, zodat beide
 * kanten hetzelfde begrijpen.
 */
export function knownNameIndex(names: string[]): Set<string> {
  const index = new Set<string>();
  for (const name of names) {
    const words = contentWords(name);
    if (words.length > 1 && words.length <= MAX_KNOWN_NAME_WORDS) index.add(words.join(" "));
  }
  return index;
}

/** Hoeveel woorden vanaf `start` samen een bekende naam vormen; 0 als geen. */
function knownNameLength(words: string[], start: number, known: Set<string>): number {
  if (known.size === 0) return 0;
  for (let length = Math.min(MAX_KNOWN_NAME_WORDS, words.length - start); length >= 2; length -= 1) {
    const candidate = contentWords(words.slice(start, start + length).join(" ")).join(" ");
    if (candidate && known.has(candidate)) return length;
  }
  return 0;
}

/**
 * Eén woordenreeks opdelen in losse boodschappen.
 *
 * Exporteert apart van `prepareSpokenText` omdat dit het stuk is dat kan
 * misgaan, en dus het stuk dat los getest hoort te worden.
 */
export function splitSpokenRun(text: string, known: Set<string> = new Set()): string[] {
  const words = text.trim().replace(/\s+/g, " ").split(" ").filter(Boolean);
  if (words.length === 0) return [];

  const items: string[] = [];
  let index = 0;

  while (index < words.length) {
    const start = index;

    // Kent de app hier een naam van meerdere woorden? Die gaat overal voor —
    // "snoeptomaatjes" of "magere melk" hoeft niet geraden te worden als het
    // gewoon in de lijst met ingrediënten staat.
    const knownAtStart = knownNameLength(words, start, known);
    if (knownAtStart > 0) {
      index += knownAtStart;
      while (index < words.length && attachesBackward(words[index])) index += 1;
      items.push(words.slice(start, index).join(" "));
      continue;
    }

    // Aantallen, verpakkingen, inleidende en bijvoeglijke woorden vooraf horen
    // bij het product dat erna komt.
    while (index < words.length && attachesForward(words[index])) index += 1;

    if (index >= words.length) {
      // De reeks eindigde op zulke woorden: geen kop meer, dus laat staan wat
      // er staat in plaats van een half product te verzinnen.
      items.push(words.slice(start).join(" "));
      break;
    }

    const knownHere = knownNameLength(words, index, known);
    index += knownHere > 0 ? knownHere : 1;

    // En wat erachter komt en duidelijk bij dit product hoort.
    while (index < words.length && attachesBackward(words[index])) index += 1;

    items.push(words.slice(start, index).join(" "));
  }

  return items;
}

/**
 * De ingesproken tekst klaarmaken voor de gewone lijstverwerking.
 *
 * Levert dezelfde tekst op, met komma's op de plekken waar de app denkt dat er
 * een nieuw product begint. Daarna doet de bestaande parser de rest — die kent
 * de aantallen, verpakkings- en vulwoorden al en haalt ze uit de zoekterm.
 *
 * Grenzen die er al staan blijven staan; wat ertussen zit wordt alsnog
 * bekeken. De microfoon zet zelf een komma na elke keer dat je even stilvalt,
 * en juist bínnen zo'n stuk zit de zin die geknipt moet worden.
 *
 * Roep dit alleen aan voor tekst die werkelijk ingesproken is. Bij ingetikte
 * tekst is elke komma een keuze van de gebruiker en hoort de app niet te gaan
 * raden — "drinkyoghurt framboos" is één product.
 */
export function prepareSpokenText(text: string, known: Set<string> = new Set()): string {
  const items = text.split(/[\n,;]/).flatMap((segment) => splitSpokenRun(segment, known));
  return items.length > 0 ? items.join(", ") : text;
}
