import Link from "next/link";
import {
  Menu,
  CheckCircle2,
  ClipboardCheck,
  Search,
  ShoppingBasket,
  Sparkles,
} from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireCurrentHousehold } from "@/lib/auth";
import { getHouseholdMealParticipantsByDay } from "@/lib/household";
import { ensureMealPlan, getReasonsForPlan } from "@/lib/mealPlan";
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
  setLooseMealForDay,
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
  const mealPlan = await ensureMealPlan(household.id, weekStart);
  if (!mealPlan) {
    throw new Error("Weekplanning kon niet worden geladen.");
  }
  const [reasons, participantsByDay, learningPrompts] = await Promise.all([
    getReasonsForPlan(household.id, weekStart),
    getHouseholdMealParticipantsByDay(household.id),
    getPendingLearningPrompts(household.id, household.maxSmartQuestionsPerSession),
  ]);
  const shoppingList = await prisma.shoppingList.findUnique({
    where: { mealPlanId: mealPlan.id },
    select: { id: true, status: true },
  });
  const reviewCount = shoppingList
    ? await prisma.shoppingListLine.count({ where: { shoppingListId: shoppingList.id, needsReview: true } })
    : 0;
  const mealVariantIds = mealPlan.entries.map((entry) => entry.recipeVariantId);
  const mealCategoryIds = [...new Set(mealPlan.entries.map((entry) => entry.recipeVariant.recipe.category))];
  const mealIngredientIds = [
    ...new Set(
      mealPlan.entries.flatMap((entry) =>
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

  const entryByDay = new Map(mealPlan.entries.map((e) => [e.dayOfWeek, e]));
  const greetingName = household.persons[0]?.name ?? household.name;
  const todayIndex = new Date().getDay();
  const defaultWishDayKey = DAY_KEYS[(todayIndex + 6) % 7] ?? "monday";
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
      subjectId: { in: mealPlan.entries.map((e) => e.recipeVariantId) },
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
        <h1 className="mb-1 text-[1.65rem] font-semibold leading-tight text-ink">
          Goedemorgen, {greetingName}
        </h1>
        <p className="mb-5 text-[15px] text-ink-muted">
          Dit is jullie week. Corrigeer alleen wat niet klopt, dan regel ik de rest.
        </p>

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

        <section className="mb-5 rounded-xl border border-line bg-surface p-4">
          <p className="mb-2 text-sm font-semibold text-ink">Toch ergens anders zin in?</p>
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

      <div className="px-6 pb-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">
              {formatWeekRange(weekStart)}
            </p>
            <h2 className="text-lg font-semibold text-ink">Jullie weekmenu</h2>
          </div>
          <span className="text-xs text-ink-muted">{mealPlan.entries.length} maaltijden</span>
        </div>
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
                  className="shrink-0 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink-muted transition-colors hover:border-accent/60 hover:bg-surface-2 hover:text-accent"
                >
                  Wissel
                </a>
              </div>

              {reason && (
                <details className="ml-14 rounded-lg bg-surface-2 px-3 py-2">
                  <summary className="cursor-pointer text-xs font-medium text-ink-muted">
                    Waarom dit?
                  </summary>
                  <p className="mt-2 text-xs text-ink-muted">{reason}</p>
                </details>
              )}

              <details className="ml-14 rounded-lg border border-line bg-surface-2 px-3 py-2">
                <summary className="cursor-pointer text-xs font-medium text-ink-muted">
                  Losse maaltijd invullen
                </summary>
                <form action={setLooseMealForDay} className="mt-3 grid gap-2">
                  <input type="hidden" name="householdId" value={household.id} />
                  <input type="hidden" name="dayKey" value={dayKey} />
                  <input
                    name="title"
                    defaultValue={recipe?.properties.includes("losse_maaltijd") ? recipe.title : ""}
                    placeholder="Bijv. Airfryeravond"
                    className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                  />
                  <textarea
                    name="lineText"
                    rows={5}
                    defaultValue={recipe?.properties.includes("losse_maaltijd") ? recipe.instructions.join("\n") : ""}
                    placeholder={"Patatjes\nKai: frikandel\nLynn: kaasstengels\nJurgen en Ellen: Carrero\nEllen: mini kaassouffle"}
                    className="min-h-28 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                  />
                  <button
                    type="submit"
                    className="w-fit rounded-lg bg-accent px-3 py-2 text-xs font-medium text-accent-ink transition-all duration-150 hover:-translate-y-0.5 hover:bg-accent/90 active:translate-y-0 active:scale-[0.98]"
                  >
                    Zet op deze dag
                  </button>
                </form>
              </details>

              {entry && participants.length > 0 && (
                <details className="ml-14 rounded-lg border border-line bg-surface-2 px-3 py-2">
                  <summary className="cursor-pointer text-xs font-medium text-ink-muted">
                    Voorkeuren aanpassen
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
          className="mt-6 block rounded-xl bg-accent px-4 py-3.5 text-center font-medium text-accent-ink transition-all duration-150 hover:-translate-y-0.5 hover:bg-accent/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:translate-y-0 active:scale-[0.99]"
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
