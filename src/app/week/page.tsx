import Link from "next/link";
import {
  CalendarDays,
  CheckCircle2,
  Search,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireCurrentHousehold } from "@/lib/auth";
import { getHouseholdMealParticipantsByDay } from "@/lib/household";
import { ensureMealPlan } from "@/lib/mealPlan";
import {
  getCurrentWeekStart,
  formatWeekRange,
  DAY_KEYS,
  DAY_LABELS,
  DAY_SHORT_LABELS,
  DAY_ENUM,
  dateForDay,
  formatDayShort,
  timeOfDayGreeting,
  isDayStartedOrPast,
  currentDayKey,
  type DayKey,
} from "@/lib/week";
import {
  CATEGORY_LABELS,
  VARIANT_LABELS,
  STATUS_LABELS,
  UNIT_LABELS,
  statusTone,
  variantTone,
} from "@/lib/categoryStyle";
import NavBar from "@/components/NavBar";
import Tag from "@/components/Tag";
import { getPendingLearningPrompts } from "@/domain/learning/patterns";
import {
  answerSmartLearningPrompt,
  dismissSmartLearningPrompt,
  regenerateCurrentWeekPlan,
  setPersonMealPreference,
  setLooseMealForDay,
  setDayRoutine,
  removeDayRoutine,
  submitMealFeedback,
  toggleMealPlanEntrySkipped,
} from "../actions";

// Deze pagina schrijft (idempotent) naar de database bij elk bezoek
// (ensureMealPlan) — nooit statisch prerenderen tijdens de build, dat
// voert dezelfde databasecode uit met build-time state en botst met
// bestaande data.
export const dynamic = "force-dynamic";

const STATUS_MESSAGES: Record<string, string> = {
  "loose-meal-set": "Losse maaltijd ingepland.",
  "feedback-saved": "Bedankt, feedback opgeslagen.",
  "preference-saved": "Voorkeur opgeslagen.",
  "week-regenerated": "Week opnieuw gepland.",
  "learning-answered": "Bedankt, ik onthoud dit.",
  "learning-dismissed": "Vraag overgeslagen.",
  "routine-set": "Onthouden als vaste gewoonte.",
  "routine-removed": "Vaste gewoonte gestopt.",
  "meal-replaced": "Gerecht gewisseld.",
  "meal-wish-planned": "Maaltijdwens ingepland.",
  "meal-unchanged": "Dit gerecht stond al op die dag.",
  "day-skipped": "Deze dag telt niet meer mee.",
  "day-restored": "Deze dag telt weer gewoon mee.",
};

/** Meldingen die geen bevestiging zijn maar een blokkade/fout — amber i.p.v. groen. */
const WARNING_STATUS_MESSAGES: Record<string, string> = {
  "week-regenerate-blocked":
    "Er liggen al producten van deze week in je Picnic-mandje. Opnieuw plannen zou ze dubbel kunnen bestellen — leeg eerst je Picnic-mandje op de boodschappenpagina.",
  "loose-meal-missing-title": "Geef de losse maaltijd eerst een naam.",
  "loose-meal-missing-lines": "Vul minimaal één productregel in voor de losse maaltijd.",
  "loose-meal-unrecognized":
    "Ik kon geen producten herkennen in je losse maaltijd. Gebruik bijvoorbeeld: patatjes, Kai: frikandel.",
  "day-has-no-meal": "Voor deze dag staat geen maaltijd meer gepland — herlaad de pagina voor de actuele week.",
};

const PERSONAL_STANCE_LABELS = {
  LIKED: "Favoriet",
  SOMETIMES: "Oké",
  RATHER_NOT: "Liever niet",
  NEVER: "Nooit",
} as const;

const PERSONAL_STANCE_TONES = {
  LIKED: "border-tag-green-ink bg-tag-green-bg text-tag-green-ink",
  SOMETIMES: "border-tag-blue-ink bg-tag-blue-bg text-tag-blue-ink",
  RATHER_NOT: "border-tag-amber-ink bg-tag-amber-bg text-tag-amber-ink",
  NEVER: "border-red-500 bg-red-50 text-red-700",
} as const;

const PERSONAL_STANCES = ["LIKED", "SOMETIMES", "RATHER_NOT", "NEVER"] as const;


/**
 * De weekpagina toont nog één tegel, en die gaat uitsluitend over leervragen.
 *
 * De aandachtsmeldingen stonden hier ook, maar dat was dubbelop geworden: sinds
 * boodschappen de startpagina is, staat elk van die vier situaties dáár al op
 * z'n eigen plek — de controleknop bij de amberen "producten vragen aandacht"-
 * balk, en de twee Picnic-situaties in `AddToPicnicCart` zelf, met de echte
 * knop erbij in plaats van een verwijzing. Ze hier herhalen betekende twee
 * plekken die hetzelfde beweren en uit elkaar kunnen lopen. De onderliggende
 * `getAttentionItems` blijft ongemoeid: de pushlaag leest daar nog uit.
 */
function learningPromptCard(): { icon: LucideIcon; title: string; body: string; href: string; cta: string } {
  return {
    icon: Sparkles,
    title: "Ik heb een korte vraag",
    body: "Beantwoord maximaal twee leervragen, dan kan ik beter begrijpen waarom iets wel of niet blijft staan.",
    href: "#leervragen",
    cta: "Vraag bekijken",
  };
}

function PreferenceButtons({
  householdId,
  personId,
  dayKey,
  subjectType,
  subjectId,
  currentStance,
}: {
  householdId: string;
  personId: string;
  dayKey: string;
  subjectType: "RECIPE_VARIANT" | "RECIPE_CATEGORY" | "INGREDIENT";
  subjectId: string;
  currentStance: string | undefined;
}) {
  return (
    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
      {PERSONAL_STANCES.map((stance) => (
        <form key={stance} action={setPersonMealPreference}>
          <input type="hidden" name="householdId" value={householdId} />
          <input type="hidden" name="personId" value={personId} />
          <input type="hidden" name="dayKey" value={dayKey} />
          <input type="hidden" name="subjectType" value={subjectType} />
          <input type="hidden" name="subjectId" value={subjectId} />
          <input type="hidden" name="stance" value={stance} />
          <button
            type="submit"
            className={`w-full rounded-md border px-2 py-1.5 text-[11px] font-medium ${
              currentStance === stance
                ? PERSONAL_STANCE_TONES[stance]
                : "border-line bg-surface text-ink-muted hover:border-accent"
            }`}
          >
            {PERSONAL_STANCE_LABELS[stance]}
          </button>
        </form>
      ))}
    </div>
  );
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; focusDay?: string; openDetails?: string }>;
}) {
  const params = await searchParams;
  const statusMessage = params.status ? STATUS_MESSAGES[params.status] : undefined;
  const warningMessage = params.status ? WARNING_STATUS_MESSAGES[params.status] : undefined;
  const focusDayKey = (DAY_KEYS as readonly string[]).includes(params.focusDay ?? "")
    ? (params.focusDay as DayKey)
    : undefined;
  const openFocusedDayDetails = params.openDetails !== "0";
  const currentHousehold = await requireCurrentHousehold();
  const household = await prisma.household.findUniqueOrThrow({
    where: { id: currentHousehold.id },
    include: { persons: { orderBy: { createdAt: "asc" } } },
  });

  const weekStart = getCurrentWeekStart();
  const mealPlan = await ensureMealPlan(household.id, weekStart);
  if (!mealPlan) {
    throw new Error("Weekplanning kon niet worden geladen.");
  }
  const [participantsByDay, learningPrompts, dayRoutines] = await Promise.all([
    getHouseholdMealParticipantsByDay(household.id),
    getPendingLearningPrompts(
      household.id,
      household.maxSmartQuestionsPerSession,
    ),
    prisma.dayRoutine.findMany({
      where: { householdId: household.id },
      include: { recipeVariant: { include: { recipe: true } } },
    }),
  ]);
  const routineByDay = new Map(
    dayRoutines.map((routine) => [routine.dayOfWeek, routine]),
  );
  const mealVariantIds = mealPlan.entries.map((entry) => entry.recipeVariantId);
  const mealCategoryIds = [
    ...new Set(
      mealPlan.entries.map((entry) => entry.recipeVariant.recipe.category),
    ),
  ];
  const mealIngredientIds = [
    ...new Set(
      mealPlan.entries.flatMap((entry) =>
        entry.recipeVariant.recipe.ingredients.map((ri) => ri.ingredientId),
      ),
    ),
  ];
  const participantIds = [
    ...new Set(
      DAY_KEYS.flatMap((dayKey) =>
        participantsByDay[dayKey].map((person) => person.id),
      ),
    ),
  ];
  const personalPreferences = await prisma.preference.findMany({
    where: {
      ownerType: "PERSON",
      ownerId: { in: participantIds },
      OR: [
        { subjectType: "RECIPE_VARIANT", subjectId: { in: mealVariantIds } },
        { subjectType: "RECIPE_CATEGORY", subjectId: { in: mealCategoryIds } },
        { subjectType: "INGREDIENT", subjectId: { in: mealIngredientIds } },
      ],
    },
  });
  const personalPreferenceByPersonAndVariant = new Map(
    personalPreferences.map((preference) => [
      `${preference.ownerId}:${preference.subjectType}:${preference.subjectId}`,
      preference.stance,
    ]),
  );

  const entryByDay = new Map(mealPlan.entries.map((e) => [e.dayOfWeek, e]));
  const greetingName = household.persons[0]?.name ?? household.name;
  const greeting = timeOfDayGreeting();
  const defaultWishDayKey = currentDayKey();
  const nextStep = learningPromptCard();
  const NextStepIcon = nextStep.icon;

  const priorFeedback = await prisma.feedbackEvent.findMany({
    where: {
      householdId: household.id,
      subjectType: "RECIPE_VARIANT",
      subjectId: { in: mealPlan.entries.map((e) => e.recipeVariantId) },
      eventType: "EXPLICIT_FEEDBACK",
    },
    select: { subjectId: true },
  });
  const alreadyAsked = new Set(priorFeedback.map((f) => f.subjectId));

  return (
    <div className="mx-auto flex min-h-screen w-full min-w-0 max-w-2xl flex-col pb-[calc(6rem+env(safe-area-inset-bottom))]">
      <header className="flex items-center justify-between px-6 pt-6 pb-2">
        <CalendarDays size={18} className="text-ink-muted" />
        <span className="text-sm font-semibold">Jouw week</span>
        <Link
          href="/ons-gezin"
          aria-label="Gezinsinstellingen"
          className="text-ink-muted hover:text-ink"
        >
          <Sparkles size={18} />
        </Link>
      </header>

      <div className="px-6 pt-4">
        {statusMessage && (
          <p className="mb-4 rounded-lg border border-tag-green-ink/20 bg-tag-green-bg px-3 py-2 text-sm font-medium text-tag-green-ink">
            {statusMessage}
          </p>
        )}
        {warningMessage && (
          <p className="mb-4 rounded-lg border border-tag-amber-ink/25 bg-tag-amber-bg px-3 py-2 text-sm font-medium text-tag-amber-ink">
            {warningMessage}
          </p>
        )}
        <h1 className="mb-1 text-[1.65rem] font-semibold leading-tight text-ink">
          {greeting}, {greetingName}
        </h1>
        <p className="mb-2 text-[15px] text-ink-muted">
          Dit is jullie week. Corrigeer alleen wat niet klopt, dan regel ik de
          rest.
        </p>
        {/* Alleen nog de leervraag-tegel. De bestelacties stonden hier ook,
            maar die horen bij de boodschappenpagina — daar staat de échte knop,
            in plaats van een verwijzing ernaartoe. */}
        {learningPrompts.length > 0 && (
          <section className="mb-4 rounded-xl border border-accent/30 bg-surface p-4">
            <div className="flex min-w-0 gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                <NextStepIcon size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-ink">{nextStep.title}</p>
                <p className="mt-1 text-sm text-ink-muted">{nextStep.body}</p>
                <Link
                  href={nextStep.href}
                  className="mt-3 inline-flex rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-ink hover:opacity-90"
                >
                  {nextStep.cta}
                </Link>
              </div>
            </div>
          </section>
        )}

        {learningPrompts.length > 0 && (
          <div id="leervragen" className="mb-6 grid gap-3">
            {learningPrompts.map((prompt) => (
              <div
                key={prompt.id}
                className="rounded-xl border border-line bg-surface p-4"
              >
                <p className="mb-1 text-sm font-semibold text-ink">
                  {prompt.title}
                </p>
                <p className="mb-3 text-sm text-ink-muted">{prompt.question}</p>
                <div className="grid gap-2">
                  <div className="grid grid-cols-2 gap-2">
                    {prompt.answerOptions.map((reason) => (
                      <form
                        key={reason.value}
                        action={answerSmartLearningPrompt}
                      >
                        <input
                          type="hidden"
                          name="householdId"
                          value={household.id}
                        />
                        <input
                          type="hidden"
                          name="promptId"
                          value={prompt.id}
                        />
                        <input
                          type="hidden"
                          name="answer"
                          value={reason.value}
                        />
                        <button
                          type="submit"
                          className="w-full rounded-lg border border-line px-2 py-2 text-xs font-medium text-ink-muted hover:border-accent hover:text-accent"
                        >
                          {reason.label}
                        </button>
                      </form>
                    ))}
                  </div>
                  <form action={dismissSmartLearningPrompt}>
                    <input
                      type="hidden"
                      name="householdId"
                      value={household.id}
                    />
                    <input type="hidden" name="promptId" value={prompt.id} />
                    <button
                      type="submit"
                      className="text-xs font-medium text-ink-faint hover:text-ink-muted"
                    >
                      Nu niet
                    </button>
                  </form>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="px-6 pb-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">
              {formatWeekRange(weekStart)}
            </p>
            <h2 className="text-lg font-semibold text-ink">Jullie weekmenu</h2>
          </div>
          <span className="text-xs text-ink-muted">
            {mealPlan.entries.length} maaltijden
          </span>
        </div>
        {/* Sinds de dagkeuze levert een gepland gerecht niet vanzelf
            boodschappen op — dat zou de gebruiker hier ten onrechte kunnen
            aannemen, want zo werkte het voorheen wél. */}
        <p className="mt-2 text-xs text-ink-muted">
          Dit is het menu. Voor welke avonden ik boodschappen meeneem, kies je bij{" "}
          <Link href="/boodschappen#avondeten" className="underline">
            Boodschappen
          </Link>
          .
        </p>
      </div>

      <div className="flex min-w-0 flex-col divide-y divide-line border-y border-line bg-surface">
        {DAY_KEYS.map((dayKey) => {
          const entry = entryByDay.get(DAY_ENUM[dayKey]);
          const recipe = entry?.recipeVariant.recipe;
          const dedupedIngredients =
            recipe?.ingredients.filter(
              (ri, index, list) =>
                list.findIndex(
                  (item) => item.ingredientId === ri.ingredientId,
                ) === index,
            ) ?? [];
          const visibleIngredients = dedupedIngredients.slice(0, 4);
          const reason = entry?.reason ?? undefined;
          const routine = routineByDay.get(DAY_ENUM[dayKey]);
          const routineMatchesEntry = Boolean(
            entry &&
            routine &&
            routine.recipeVariantId === entry.recipeVariantId,
          );
          const participants = participantsByDay[dayKey];
          const isNew =
            entry &&
            recipe &&
            (recipe.status === "FOUND" || recipe.status === "ADAPTED") &&
            !alreadyAsked.has(entry.recipeVariantId) &&
            // Pas vragen "hoe was dit?" zodra de dag echt begonnen is — anders
            // vroeg de app dit al bij een verse week over maaltijden die nog
            // moesten komen (bugfix UX-review, punt 5).
            isDayStartedOrPast(dateForDay(weekStart, dayKey));
          const skipped = entry?.skipped ?? false;
          return (
            <div
              key={dayKey}
              id={`day-${dayKey}`}
              className={`scroll-mt-6 flex min-w-0 flex-col gap-3 px-6 py-4 ${skipped ? "opacity-60" : ""}`}
            >
              <div className="flex min-w-0 items-center gap-3">
                <div className="w-11 shrink-0 text-center">
                  <p className="text-[10px] font-semibold tracking-wide text-ink-faint">
                    {DAY_SHORT_LABELS[dayKey]}
                  </p>
                  <p className="text-[11px] text-ink-faint">
                    {formatDayShort(dateForDay(weekStart, dayKey))}
                  </p>
                </div>

                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 font-medium text-ink">
                    {recipe?.title ?? "—"}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {skipped && <Tag tone="amber">Uit eten</Tag>}
                    {entry && (
                      <Tag tone={variantTone(entry.recipeVariant.variantType)}>
                        {VARIANT_LABELS[entry.recipeVariant.variantType]}
                      </Tag>
                    )}
                    {recipe && (
                      <Tag tone={statusTone(recipe.status)}>
                        {STATUS_LABELS[recipe.status]}
                      </Tag>
                    )}
                  </div>
                </div>

                {entry && (
                  <form action={toggleMealPlanEntrySkipped}>
                    <input type="hidden" name="householdId" value={household.id} />
                    <input type="hidden" name="dayKey" value={dayKey} />
                    <input
                      type="hidden"
                      name="weekStart"
                      value={weekStart.toISOString()}
                    />
                    <button
                      type="submit"
                      aria-label={
                        skipped
                          ? `Zet ${DAY_LABELS[dayKey].toLowerCase()} terug in de planning`
                          : `We eten ${DAY_LABELS[dayKey].toLowerCase()} niet thuis`
                      }
                      className="shrink-0 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink-muted transition-colors hover:border-accent/60 hover:bg-surface-2 hover:text-accent"
                    >
                      {skipped ? "Toch wel" : "Uit eten"}
                    </button>
                  </form>
                )}

                <a
                  href={`/gerechten?day=${dayKey}&direction=day`}
                  aria-label={`Vervang ${DAY_LABELS[dayKey].toLowerCase()}`}
                  className="shrink-0 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink-muted transition-colors hover:border-accent/60 hover:bg-surface-2 hover:text-accent"
                >
                  Wissel
                </a>
              </div>

              {dedupedIngredients.length > 0 && (
                <details className="ml-14 rounded-lg border border-line bg-surface-2 px-3 py-2">
                  <summary className="cursor-pointer text-xs font-medium text-ink-muted">
                    Ingrediënten ({dedupedIngredients.length})
                  </summary>
                  <ul className="mt-2 flex flex-col gap-1">
                    {dedupedIngredients.map((ri) => (
                      <li key={ri.ingredientId} className="truncate text-xs text-ink-muted">
                        {ri.ingredient.name} · {ri.quantity}
                        {UNIT_LABELS[ri.unit] ?? ri.unit}
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              {reason && (
                <details className="ml-14 rounded-lg bg-surface-2 px-3 py-2">
                  <summary className="cursor-pointer text-xs font-medium text-ink-muted">
                    Waarom dit?
                  </summary>
                  <p className="mt-2 text-xs text-ink-muted">{reason}</p>
                </details>
              )}

              {entry && (
                <div className="ml-14 flex flex-wrap items-center gap-2 text-xs">
                  {routineMatchesEntry ? (
                    <>
                      <span className="inline-flex items-center gap-1 font-medium text-tag-green-ink">
                        <CheckCircle2 size={13} /> Vaste gewoonte op{" "}
                        {DAY_LABELS[dayKey].toLowerCase()}
                      </span>
                      <form action={removeDayRoutine}>
                        <input
                          type="hidden"
                          name="householdId"
                          value={household.id}
                        />
                        <input type="hidden" name="dayKey" value={dayKey} />
                        <button
                          type="submit"
                          className="font-medium text-ink-faint underline decoration-dotted hover:text-ink"
                        >
                          Stoppen
                        </button>
                      </form>
                    </>
                  ) : (
                    <>
                      {routine && (
                        <span className="text-ink-faint">
                          Gewoonlijk: {routine.recipeVariant.recipe.title}
                        </span>
                      )}
                      <form action={setDayRoutine}>
                        <input
                          type="hidden"
                          name="householdId"
                          value={household.id}
                        />
                        <input type="hidden" name="dayKey" value={dayKey} />
                        <input
                          type="hidden"
                          name="recipeVariantId"
                          value={entry.recipeVariantId}
                        />
                        <button
                          type="submit"
                          className="font-medium text-ink-faint underline decoration-dotted hover:text-ink"
                        >
                          {routine
                            ? "Onthoud dit i.p.v."
                            : `Onthoud voor elke ${DAY_LABELS[dayKey].toLowerCase()}`}
                        </button>
                      </form>
                    </>
                  )}
                </div>
              )}

              <details
                className="ml-14 rounded-lg border border-line bg-surface-2 px-3 py-2"
                open={(focusDayKey === dayKey && openFocusedDayDetails) || undefined}
              >
                <summary className="cursor-pointer text-xs font-medium text-ink-muted">
                  Meer voor deze dag
                </summary>
                <div className="mt-3 flex min-w-0 flex-col gap-4">
                  <div>
                    <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
                      Losse maaltijd invullen
                    </p>
                    <form action={setLooseMealForDay} className="grid gap-2">
                      <input
                        type="hidden"
                        name="householdId"
                        value={household.id}
                      />
                      <input type="hidden" name="dayKey" value={dayKey} />
                      <input
                        name="title"
                        defaultValue={
                          recipe?.properties.includes("losse_maaltijd")
                            ? recipe.title
                            : ""
                        }
                        placeholder="Bijv. Airfryeravond"
                        className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                      />
                      <textarea
                        name="lineText"
                        rows={5}
                        defaultValue={
                          recipe?.properties.includes("losse_maaltijd")
                            ? recipe.instructions.join("\n")
                            : ""
                        }
                        placeholder={
                          "Patatjes\nKai: frikandel\nLynn: kaasstengels\nJurgen en Ellen: Carrero\nEllen: mini kaassouffle"
                        }
                        className="min-h-28 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                      />
                      <button
                        type="submit"
                        className="w-fit rounded-lg bg-accent px-3 py-2 text-xs font-medium text-accent-ink transition-all duration-150 hover:-translate-y-0.5 hover:bg-accent/90 active:translate-y-0 active:scale-[0.98]"
                      >
                        Zet op deze dag
                      </button>
                    </form>
                  </div>

                  {entry && participants.length > 0 && (
                    <div>
                      <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
                        Voorkeuren aanpassen
                      </p>
                      <div className="flex min-w-0 flex-col gap-3">
                        {participants.map((person) => {
                          const currentStance =
                            personalPreferenceByPersonAndVariant.get(
                              `${person.id}:RECIPE_VARIANT:${entry.recipeVariantId}`,
                            );
                          const categoryStance =
                            personalPreferenceByPersonAndVariant.get(
                              `${person.id}:RECIPE_CATEGORY:${recipe?.category}`,
                            );
                          return (
                            <div key={person.id} className="min-w-0">
                              <p className="mb-1.5 truncate text-xs font-medium text-ink">
                                {person.name}
                              </p>
                              <div className="flex min-w-0 flex-col gap-2">
                                <div>
                                  <p className="mb-1 text-[11px] text-ink-faint">
                                    Dit gerecht
                                  </p>
                                  <PreferenceButtons
                                    householdId={household.id}
                                    personId={person.id}
                                    dayKey={dayKey}
                                    subjectType="RECIPE_VARIANT"
                                    subjectId={entry.recipeVariantId}
                                    currentStance={currentStance}
                                  />
                                </div>
                                {recipe && (
                                  <div>
                                    <p className="mb-1 text-[11px] text-ink-faint">
                                      {CATEGORY_LABELS[recipe.category] ??
                                        recipe.category}
                                    </p>
                                    <PreferenceButtons
                                      householdId={household.id}
                                      personId={person.id}
                                      dayKey={dayKey}
                                      subjectType="RECIPE_CATEGORY"
                                      subjectId={recipe.category}
                                      currentStance={categoryStance}
                                    />
                                  </div>
                                )}
                                {visibleIngredients.map((ri) => {
                                  const ingredientStance =
                                    personalPreferenceByPersonAndVariant.get(
                                      `${person.id}:INGREDIENT:${ri.ingredientId}`,
                                    );
                                  return (
                                    <div key={ri.ingredientId}>
                                      <p className="mb-1 truncate text-[11px] text-ink-faint">
                                        {ri.ingredient.name}
                                      </p>
                                      <PreferenceButtons
                                        householdId={household.id}
                                        personId={person.id}
                                        dayKey={dayKey}
                                        subjectType="INGREDIENT"
                                        subjectId={ri.ingredientId}
                                        currentStance={ingredientStance}
                                      />
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </details>

              {isNew && entry && (
                <div className="ml-14 flex items-center justify-between rounded-lg bg-tag-blue-bg px-3 py-2">
                  <span className="text-xs text-tag-blue-ink">
                    Nieuw gerecht — hoe was dit voor{" "}
                    {DAY_LABELS[dayKey].toLowerCase()}?
                  </span>
                  <div className="flex gap-1.5">
                    <form action={submitMealFeedback}>
                      <input
                        type="hidden"
                        name="householdId"
                        value={household.id}
                      />
                      <input
                        type="hidden"
                        name="recipeVariantId"
                        value={entry.recipeVariantId}
                      />
                      <input type="hidden" name="dayKey" value={dayKey} />
                      <input type="hidden" name="positive" value="true" />
                      <button
                        type="submit"
                        className="rounded-md bg-surface px-2.5 py-1 text-xs font-medium text-tag-blue-ink shadow-sm hover:opacity-80"
                      >
                        Werkte goed
                      </button>
                    </form>
                    <form action={submitMealFeedback}>
                      <input
                        type="hidden"
                        name="householdId"
                        value={household.id}
                      />
                      <input
                        type="hidden"
                        name="recipeVariantId"
                        value={entry.recipeVariantId}
                      />
                      <input type="hidden" name="dayKey" value={dayKey} />
                      <input type="hidden" name="positive" value="false" />
                      <button
                        type="submit"
                        className="rounded-md bg-surface px-2.5 py-1 text-xs font-medium text-ink-muted shadow-sm hover:opacity-80"
                      >
                        Niet echt
                      </button>
                    </form>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="px-6">
        <section className="mt-6 rounded-xl border border-line bg-surface p-4">
          <p className="mb-2 text-sm font-semibold text-ink">
            Toch ergens anders zin in?
          </p>
          <form action="/gerechten" className="grid gap-2">
            <div className="grid grid-cols-[112px_1fr] gap-2">
              <select
                name="day"
                defaultValue={defaultWishDayKey}
                aria-label="Dag kiezen"
                className="min-w-0 rounded-lg border border-line bg-surface px-2 py-2.5 text-sm text-ink"
              >
                {DAY_KEYS.map((dayKey) => (
                  <option key={dayKey} value={dayKey}>
                    {DAY_LABELS[dayKey]}
                  </option>
                ))}
              </select>
              <input
                name="q"
                placeholder="Bijv. AVG met kip en sperziebonen"
                className="min-w-0 rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-ink outline-none focus:border-accent"
              />
            </div>
            <button
              type="submit"
              className="inline-flex w-fit items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-ink transition-all duration-150 hover:-translate-y-0.5 hover:bg-accent/90 active:translate-y-0 active:scale-[0.98]"
            >
              <Search size={15} />
              Zoek passend gerecht
            </button>
          </form>
        </section>

        <Link
          href="/boodschappen"
          className="mt-4 block rounded-xl bg-accent px-4 py-3.5 text-center font-medium text-accent-ink transition-all duration-150 hover:-translate-y-0.5 hover:bg-accent/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:translate-y-0 active:scale-[0.99]"
        >
          Naar boodschappenlijst
        </Link>

        <details className="mt-4 rounded-xl border border-line bg-surface px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium text-ink-muted">
            Meer weekacties
          </summary>
          <div className="mt-3 flex min-w-0 flex-col gap-3">
            <p className="text-xs text-ink-muted">
              Maak alleen opnieuw als het hele voorstel niet lekker voelt. Losse
              dagen pas je sneller aan via de dag zelf.
            </p>
            <form action={regenerateCurrentWeekPlan}>
              <input type="hidden" name="householdId" value={household.id} />
              <button
                type="submit"
                className="rounded-lg border border-line bg-surface px-3 py-2 text-xs font-medium text-ink hover:border-accent hover:text-accent"
              >
                Week opnieuw plannen
              </button>
            </form>
          </div>
        </details>
      </div>

      <NavBar />
    </div>
  );
}
