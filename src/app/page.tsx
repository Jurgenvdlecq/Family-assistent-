import Link from "next/link";
import {
  Menu,
  CheckCircle2,
  ClipboardCheck,
  Flame,
  Leaf,
  MoreHorizontal,
  ShoppingBasket,
  Sparkles,
  Utensils,
} from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireCurrentHousehold } from "@/lib/auth";
import { getHouseholdMealParticipantsByDay } from "@/lib/household";
import { ensureMealPlan, getMealPlanForWeek, getReasonsForPlan } from "@/lib/mealPlan";
import {
  getCurrentWeekStart,
  formatWeekRange,
  DAY_KEYS,
  DAY_LABELS,
  DAY_SHORT_LABELS,
  DAY_ENUM,
  dateForDay,
  formatDayShort,
} from "@/lib/week";
import {
  CATEGORY_LABELS,
  VARIANT_LABELS,
  STATUS_LABELS,
  statusTone,
  variantTone,
} from "@/lib/categoryStyle";
import NavBar from "@/components/NavBar";
import Tag from "@/components/Tag";
import RecipePhoto from "@/components/RecipePhoto";
import { getPendingLearningPrompts } from "@/domain/learning/patterns";
import { MEAL_REPLACEMENT_REASONS } from "@/domain/learning/feedbackReasons";
import {
  answerSmartLearningPrompt,
  dismissSmartLearningPrompt,
  regenerateCurrentWeekPlan,
  setPersonMealPreference,
  submitMealFeedback,
} from "./actions";

// Deze pagina schrijft (idempotent) naar de database bij elk bezoek
// (ensureMealPlan) — nooit statisch prerenderen tijdens de build, dat
// voert dezelfde databasecode uit met build-time state en botst met
// bestaande data.
export const dynamic = "force-dynamic";

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

function nextStepCopy(input: {
  learningPromptCount: number;
  hasShoppingList: boolean;
  reviewCount: number;
  shoppingListStatus: string | null;
}) {
  if (input.learningPromptCount > 0) {
    return {
      icon: Sparkles,
      title: "Ik heb een korte vraag",
      body: "Beantwoord maximaal twee leervragen, dan kan ik beter begrijpen waarom iets wel of niet blijft staan.",
      href: "#leervragen",
      cta: "Vraag bekijken",
    };
  }
  if (!input.hasShoppingList) {
    return {
      icon: ShoppingBasket,
      title: "Weekmenu staat klaar",
      body: "Als dit ongeveer klopt, maak ik hierna de boodschappenlijst met vaste boodschappen en voorraadcontrole.",
      href: "/boodschappen",
      cta: "Boodschappen voorbereiden",
    };
  }
  if (input.reviewCount > 0) {
    return {
      icon: ClipboardCheck,
      title: `${input.reviewCount} productkeuze${input.reviewCount === 1 ? "" : "s"} controleren`,
      body: "Er zijn nog producten, verpakkingen of hoeveelheden die ik niet stil wil aannemen.",
      href: "/controle",
      cta: "Controleren",
    };
  }
  if (input.shoppingListStatus === "REVIEWED") {
    return {
      icon: CheckCircle2,
      title: "Klaar om naar Picnic te gaan",
      body: "De lijst is gecontroleerd. Je bevestigt zelf nog voordat er iets naar Picnic gaat.",
      href: "/boodschappen",
      cta: "Naar bevestigen",
    };
  }
  return {
    icon: ClipboardCheck,
    title: "Boodschappen staan klaar",
    body: "Loop de lijst nog even na. Vertrouwde keuzes hoeven weinig aandacht te vragen.",
    href: "/boodschappen",
    cta: "Boodschappen bekijken",
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

export default async function Home() {
  const currentHousehold = await requireCurrentHousehold();
  const household = await prisma.household.findUniqueOrThrow({
    where: { id: currentHousehold.id },
    include: { persons: { orderBy: { createdAt: "asc" } } },
  });

  const weekStart = getCurrentWeekStart();
  await ensureMealPlan(household.id, weekStart);
  const [mealPlan, reasons, participantsByDay, learningPrompts] = await Promise.all([
    getMealPlanForWeek(household.id, weekStart),
    getReasonsForPlan(household.id, weekStart),
    getHouseholdMealParticipantsByDay(household.id),
    getPendingLearningPrompts(household.id, household.maxSmartQuestionsPerSession),
  ]);
  const shoppingList = await prisma.shoppingList.findUnique({
    where: { mealPlanId: mealPlan!.id },
    include: { lines: { select: { needsReview: true } } },
  });
  const mealVariantIds = mealPlan!.entries.map((entry) => entry.recipeVariantId);
  const mealCategoryIds = [...new Set(mealPlan!.entries.map((entry) => entry.recipeVariant.recipe.category))];
  const mealIngredientIds = [
    ...new Set(
      mealPlan!.entries.flatMap((entry) =>
        entry.recipeVariant.recipe.ingredients.map((ri) => ri.ingredientId)
      )
    ),
  ];
  const participantIds = [
    ...new Set(DAY_KEYS.flatMap((dayKey) => participantsByDay[dayKey].map((person) => person.id))),
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
    ])
  );

  const entryByDay = new Map(mealPlan!.entries.map((e) => [e.dayOfWeek, e]));
  const rhythm = (household.weeklyRhythm ?? {}) as Partial<Record<string, "busy" | "quiet">>;
  const busyDayCount = DAY_KEYS.filter((k) => rhythm[k] === "busy").length;
  const avgDayCount = mealPlan!.entries.filter(
    (e) => e.recipeVariant.recipe.category === "ALL_VEGGIE_DAY"
  ).length;
  const greetingName = household.persons[0]?.name ?? household.name;
  const reviewCount = shoppingList?.lines.filter((line) => line.needsReview).length ?? 0;
  const nextStep = nextStepCopy({
    learningPromptCount: learningPrompts.length,
    hasShoppingList: Boolean(shoppingList),
    reviewCount,
    shoppingListStatus: shoppingList?.status ?? null,
  });
  const NextStepIcon = nextStep.icon;

  const priorFeedback = await prisma.feedbackEvent.findMany({
    where: {
      householdId: household.id,
      subjectType: "RECIPE_VARIANT",
      subjectId: { in: mealPlan!.entries.map((e) => e.recipeVariantId) },
      eventType: "EXPLICIT_FEEDBACK",
    },
    select: { subjectId: true },
  });
  const alreadyAsked = new Set(priorFeedback.map((f) => f.subjectId));

  return (
    <div className="mx-auto flex min-h-screen w-full min-w-0 max-w-2xl flex-col pb-24">
      <header className="flex items-center justify-between px-6 pt-6 pb-2">
        <Menu size={20} className="text-ink-muted" />
        <span className="text-sm font-semibold">Jouw week</span>
        <Link href="/ons-gezin" aria-label="Gezinsinstellingen" className="text-ink-muted hover:text-ink">
          <Sparkles size={18} />
        </Link>
      </header>

      <div className="px-6 pt-4">
        <h1 className="mb-1 text-[1.7rem] font-semibold leading-tight text-ink">
          Goedemorgen, {greetingName}
        </h1>
        <p className="mb-5 text-[15px] text-ink-muted">
          Ik heb een voorstel gemaakt. Jij hoeft vooral te corrigeren wat niet klopt.
        </p>

        <section className="mb-5 rounded-xl border border-accent/30 bg-surface p-4">
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

        <section className="mb-6 rounded-xl border border-line bg-surface p-4">
          <p className="mb-3 text-sm font-semibold text-ink">Deze week {formatWeekRange(weekStart)}</p>
          <div className="grid grid-cols-3 gap-2 text-xs text-ink-muted">
            <span className="inline-flex min-w-0 items-center gap-1.5 rounded-lg bg-surface-2 px-2 py-2">
              <Utensils size={14} className="shrink-0 text-ink-faint" />
              <span className="truncate">{mealPlan!.entries.length} maaltijden</span>
            </span>
            <span className="inline-flex min-w-0 items-center gap-1.5 rounded-lg bg-surface-2 px-2 py-2">
              <Flame size={14} className="shrink-0 text-tag-amber-ink" />
              <span className="truncate">{busyDayCount} druk</span>
            </span>
            <span className="inline-flex min-w-0 items-center gap-1.5 rounded-lg bg-surface-2 px-2 py-2">
              <Leaf size={14} className="shrink-0 text-tag-green-ink" />
              <span className="truncate">{avgDayCount} AVG</span>
            </span>
          </div>
        </section>

        {learningPrompts.length > 0 && (
          <div id="leervragen" className="mb-6 grid gap-3">
            {learningPrompts.map((prompt) => (
              <div key={prompt.id} className="rounded-xl border border-line bg-surface p-4">
                <p className="mb-1 text-sm font-semibold text-ink">{prompt.title}</p>
                <p className="mb-3 text-sm text-ink-muted">{prompt.question}</p>
                <div className="grid gap-2">
                  <div className="grid grid-cols-2 gap-2">
                    {MEAL_REPLACEMENT_REASONS.slice(1, 5).map((reason) => (
                      <form key={reason.value} action={answerSmartLearningPrompt}>
                        <input type="hidden" name="householdId" value={household.id} />
                        <input type="hidden" name="promptId" value={prompt.id} />
                        <input type="hidden" name="answer" value={reason.value} />
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
                    <input type="hidden" name="householdId" value={household.id} />
                    <input type="hidden" name="promptId" value={prompt.id} />
                    <button type="submit" className="text-xs font-medium text-ink-faint hover:text-ink-muted">
                      Nu niet
                    </button>
                  </form>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex min-w-0 flex-col divide-y divide-line border-y border-line bg-surface">
        {DAY_KEYS.map((dayKey) => {
          const entry = entryByDay.get(DAY_ENUM[dayKey]);
          const recipe = entry?.recipeVariant.recipe;
          const visibleIngredients =
            recipe?.ingredients
              .filter((ri, index, list) => list.findIndex((item) => item.ingredientId === ri.ingredientId) === index)
              .slice(0, 4) ?? [];
          const reason = entry ? reasons.get(entry.recipeVariantId) : undefined;
          const participants = participantsByDay[dayKey];
          const isNew =
            entry &&
            recipe &&
            (recipe.status === "FOUND" || recipe.status === "ADAPTED") &&
            !alreadyAsked.has(entry.recipeVariantId);
          return (
            <div key={dayKey} className="flex min-w-0 flex-col gap-3 px-6 py-4">
              <div className="flex min-w-0 items-center gap-3">
                <div className="w-11 shrink-0 text-center">
                  <p className="text-[10px] font-semibold tracking-wide text-ink-faint">
                    {DAY_SHORT_LABELS[dayKey]}
                  </p>
                  <p className="text-[11px] text-ink-faint">
                    {formatDayShort(dateForDay(weekStart, dayKey))}
                  </p>
                </div>

                <RecipePhoto recipe={recipe} />

                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-ink">{recipe?.title ?? "—"}</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {entry && (
                      <Tag tone={variantTone(entry.recipeVariant.variantType)}>
                        {VARIANT_LABELS[entry.recipeVariant.variantType]}
                      </Tag>
                    )}
                    {recipe && (
                      <Tag tone={statusTone(recipe.status)}>{STATUS_LABELS[recipe.status]}</Tag>
                    )}
                  </div>
                </div>

                <a
                  href={`/gerechten?day=${dayKey}`}
                  aria-label={`Vervang ${DAY_LABELS[dayKey].toLowerCase()}`}
                  className="shrink-0 rounded-full p-2 text-ink-faint hover:bg-surface-2 hover:text-ink"
                >
                  <MoreHorizontal size={18} />
                </a>
              </div>

              {reason && (
                <p className="pl-14 text-xs text-ink-muted">{reason}</p>
              )}

              {entry && participants.length > 0 && (
                <details className="ml-14 rounded-lg border border-line bg-surface-2 px-3 py-2">
                  <summary className="cursor-pointer text-xs font-medium text-ink-muted">
                    Persoonlijke voorkeuren
                  </summary>
                  <div className="mt-3 flex min-w-0 flex-col gap-3">
                    {participants.map((person) => {
                      const currentStance = personalPreferenceByPersonAndVariant.get(
                        `${person.id}:RECIPE_VARIANT:${entry.recipeVariantId}`
                      );
                      const categoryStance = personalPreferenceByPersonAndVariant.get(
                        `${person.id}:RECIPE_CATEGORY:${recipe?.category}`
                      );
                      return (
                        <div key={person.id} className="min-w-0">
                          <p className="mb-1.5 truncate text-xs font-medium text-ink">{person.name}</p>
                          <div className="flex min-w-0 flex-col gap-2">
                            <div>
                              <p className="mb-1 text-[11px] text-ink-faint">Dit gerecht</p>
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
                                  {CATEGORY_LABELS[recipe.category] ?? recipe.category}
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
                              const ingredientStance = personalPreferenceByPersonAndVariant.get(
                                `${person.id}:INGREDIENT:${ri.ingredientId}`
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
                </details>
              )}

              {isNew && entry && (
                <div className="ml-14 flex items-center justify-between rounded-lg bg-tag-blue-bg px-3 py-2">
                  <span className="text-xs text-tag-blue-ink">
                    Nieuw gerecht — hoe was dit voor {DAY_LABELS[dayKey].toLowerCase()}?
                  </span>
                  <div className="flex gap-1.5">
                    <form action={submitMealFeedback}>
                      <input type="hidden" name="householdId" value={household.id} />
                      <input type="hidden" name="recipeVariantId" value={entry.recipeVariantId} />
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
                      <input type="hidden" name="householdId" value={household.id} />
                      <input type="hidden" name="recipeVariantId" value={entry.recipeVariantId} />
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
        <Link
          href="/boodschappen"
          className="mt-6 block rounded-xl bg-accent px-4 py-3.5 text-center font-medium text-accent-ink transition-opacity hover:opacity-90"
        >
          Naar boodschappenlijst
        </Link>

        <details className="mt-4 rounded-xl border border-line bg-surface px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium text-ink-muted">Meer weekacties</summary>
          <div className="mt-3 flex min-w-0 flex-col gap-3">
            <p className="text-xs text-ink-muted">
              Maak alleen opnieuw als het hele voorstel niet lekker voelt. Losse dagen pas je sneller aan via de dag zelf.
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
