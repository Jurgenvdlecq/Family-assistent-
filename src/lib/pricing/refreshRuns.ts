import { prisma } from "@/lib/prisma";
import type { PriceRefreshTrigger, ProductProvider } from "@/generated/prisma/enums";
import { DISPLAY_TIME_ZONE } from "@/lib/week";
import type { RefreshResult } from "./refresh";

/**
 * Wat er bij een prijsverversing gebeurd is, bewaren en teruglezen.
 *
 * De aanleiding is concreet: de uitkomst stond alleen in een logbestand, en
 * daar heeft de gebruiker niets aan. "Wanneer zijn deze prijzen opgehaald" en
 * "waarom staat er niets" zijn vragen die op het scherm beantwoord horen te
 * worden, niet in een dashboard van de hostingpartij.
 *
 * De regel wordt bewust **vóór** het werk aangemaakt, met `finishedAt` nog
 * leeg, en daarna bijgewerkt. Dat lost twee dingen tegelijk op: een
 * verversing die halverwege wordt afgebroken (de hostingpartij kapt een te
 * lange aanroep af) laat een zichtbaar spoor achter in plaats van niets, en
 * een lopende regel is meteen het slot dat een tweede gelijktijdige
 * verversing tegenhoudt.
 */

export interface RefreshRunSummary {
  provider: ProductProvider;
  startedAt: Date;
  finishedAt: Date | null;
  ingredientsChecked: number;
  productsStored: number;
  error: string | null;
  trigger: PriceRefreshTrigger;
}

/** Hoeveel tekens van een foutmelding we bewaren — genoeg om te begrijpen, niet zo veel dat het een logbestand wordt. */
const MAX_ERROR_LENGTH = 500;

/**
 * Zolang beschouwen we een niet-afgeronde verversing als "loopt nog".
 *
 * Daarna is hij vrijwel zeker afgebroken en mag er opnieuw geprobeerd worden —
 * anders zou één afgekapte aanroep de knop voorgoed blokkeren.
 */
export const RUNNING_REFRESH_WINDOW_MS = 3 * 60 * 1000;

/** Begin van een verversing vastleggen; levert per winkel het id van de regel. */
export async function startRefreshRuns(
  providers: ProductProvider[],
  trigger: PriceRefreshTrigger,
  startedAt: Date = new Date()
): Promise<Map<ProductProvider, string>> {
  const ids = new Map<ProductProvider, string>();
  for (const provider of providers) {
    const run = await prisma.priceRefreshRun.create({
      data: { provider, trigger, startedAt },
      select: { id: true },
    });
    ids.set(provider, run.id);
  }
  return ids;
}

/** De uitkomst bij de eerder aangemaakte regel zetten. */
export async function finishRefreshRun(
  runId: string,
  result: RefreshResult,
  finishedAt: Date = new Date()
): Promise<void> {
  await prisma.priceRefreshRun.update({
    where: { id: runId },
    data: {
      finishedAt,
      ingredientsChecked: result.ingredientsChecked,
      productsStored: result.productsStored,
      // Alleen de eerste fout: die zegt bijna altijd genoeg, en tien
      // varianten van dezelfde storing helpen niemand verder.
      error: result.errors.length > 0 ? result.errors[0].slice(0, MAX_ERROR_LENGTH) : null,
    },
  });
}

/** Loopt er op dit moment al een verversing? */
export async function hasRunningRefresh(
  providers: ProductProvider[],
  now: Date = new Date()
): Promise<boolean> {
  if (providers.length === 0) return false;
  const running = await prisma.priceRefreshRun.findFirst({
    where: {
      provider: { in: providers },
      finishedAt: null,
      startedAt: { gte: new Date(now.getTime() - RUNNING_REFRESH_WINDOW_MS) },
    },
    select: { id: true },
  });
  return running !== null;
}

/** De laatste verversing per winkel. */
export async function getLastRefreshRuns(
  providers: ProductProvider[]
): Promise<Map<ProductProvider, RefreshRunSummary>> {
  const result = new Map<ProductProvider, RefreshRunSummary>();
  if (providers.length === 0) return result;

  // Bewust één gerichte query per winkel in plaats van één query met een
  // geraden aantal rijen: bij een winkel die een keer los is ververst zou zo'n
  // venster de laatste run stilzwijgend missen, en dan meldt het scherm "nog
  // niet opgehaald" terwijl er wél is opgehaald.
  const runs = await Promise.all(
    providers.map((provider) =>
      prisma.priceRefreshRun.findFirst({
        where: { provider },
        orderBy: { startedAt: "desc" },
      })
    )
  );

  for (const run of runs) {
    if (!run) continue;
    result.set(run.provider, {
      provider: run.provider,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      ingredientsChecked: run.ingredientsChecked,
      productsStored: run.productsStored,
      error: run.error,
      trigger: run.trigger,
    });
  }

  return result;
}

function formatMoment(moment: Date): string {
  // Altijd de klok van de gebruiker, niet die van de server. Vercel draait op
  // UTC; zonder deze tijdzone meldt de nachtelijke verversing structureel
  // twee uur te vroeg (zie ook DISPLAY_TIME_ZONE in lib/week.ts).
  return moment.toLocaleString("nl-NL", {
    timeZone: DISPLAY_TIME_ZONE,
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * De uitkomst in gewone taal, voor op het scherm.
 *
 * De volgorde is met opzet: wat er is opgehaald staat vóórop, en een fout is
 * een nuance daarbij. Andersom zou één mislukt ingrediënt van de vijfentwintig
 * de melding "het ophalen ging mis" opleveren terwijl er zeventig producten
 * zijn bijgewerkt — het spiegelbeeld van de misleiding die deze regels juist
 * moeten voorkomen.
 */
export function describeRefreshRun(run: RefreshRunSummary | undefined, label: string): string {
  if (!run) return `${label}: nog niet opgehaald.`;

  const when = formatMoment(run.startedAt);

  if (run.finishedAt === null) {
    return `${label}: de verversing van ${when} is niet afgerond. Een deel van de prijzen kan wel zijn bijgewerkt.`;
  }

  const stored = `${run.productsStored} ${run.productsStored === 1 ? "product" : "producten"}`;

  if (run.productsStored > 0 && run.error) {
    return `${label}: ${stored} bijgewerkt op ${when}, maar niet alles lukte — ${run.error}`;
  }
  if (run.error) return `${label}: het ophalen ging mis op ${when} — ${run.error}`;
  if (run.productsStored === 0) {
    return `${label}: op ${when} ${run.ingredientsChecked} ${
      run.ingredientsChecked === 1 ? "ingrediënt" : "ingrediënten"
    } bekeken, maar geen enkel passend product gevonden.`;
  }
  return `${label}: ${stored} bijgewerkt op ${when}, van ${run.ingredientsChecked} ${
    run.ingredientsChecked === 1 ? "ingrediënt" : "ingrediënten"
  }.`;
}
