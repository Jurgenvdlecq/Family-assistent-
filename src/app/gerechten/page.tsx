import Link from "next/link";
import { ChevronLeft, UtensilsCrossed, Heart, Sparkles, EyeOff } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireCurrentHousehold } from "@/lib/auth";
import { getMealPlanForWeek } from "@/lib/mealPlan";
import { getHouseholdHardRestrictionsAndParticipantsByDay } from "@/lib/household";
import { recipeConflictsWithRestrictions } from "@/lib/dietaryRestrictions";
import { accessibleRecipeWhere } from "@/lib/recipeScope";
import { DAY_KEYS, DAY_ENUM, DAY_LABELS, getCurrentWeekStart, type DayKey } from "@/lib/week";
import { STATUS_LABELS, statusTone } from "@/lib/categoryStyle";
import { normalizeMealText, parseMealWish, scoreMealWish } from "@/domain/meal-tags/mealTags";
import { MEAL_REPLACEMENT_REASONS } from "@/domain/learning/feedbackReasons";
import { dayRecipePreferenceOwnerId } from "@/domain/meal-planning/dayRecipePreferences";
import NavBar from "@/components/NavBar";
import Tag from "@/components/Tag";
import { chooseLiteralMealPlanEntry, replaceMealPlanEntry, restoreHiddenRecipeVariant } from "./actions";

// Leest live weekplanning + voorkeuren — nooit statisch prerenderen.
export const dynamic = "force-dynamic";

const STATUS_MESSAGES: Record<string, string> = {
  "recipe-restored": "Dit gerecht kan weer voorgesteld worden.",
};

const DIRECTIONS = [
  { key: "day", label: "Deze dag" },
  { key: "all", label: "Alle suggesties" },
  { key: "favorites", label: "Favorieten" },
  { key: "quick", label: "Snel & makkelijk" },
] as const;
const DIRECTION_KEYS = DIRECTIONS.map((direction) => direction.key);

const VARIANT_INCLUDE = {
  recipe: { include: { ingredients: { include: { ingredient: true } } } },
} as const;

type VariantWithRecipe = Awaited<
  ReturnType<typeof prisma.recipeVariant.findMany<{ include: typeof VARIANT_INCLUDE }>>
>[number];

function personalPreferenceScore(stances: string[]): number {
  return stances.reduce((score, stance) => {
    if (stance === "LIKED") return score + 1;
    if (stance === "SOMETIMES") return score + 0.2;
    if (stance === "RATHER_NOT") return score - 1.5;
    if (stance === "NEVER") return score - 100;
    return score;
  }, 0);
}

function dayPreferenceScore(stance: string | undefined): number {
  if (stance === "LIKED") return 8;
  if (stance === "SOMETIMES") return 4;
  if (stance === "RATHER_NOT") return -8;
  return 0;
}

function addStance(map: Map<string, string[]>, key: string, stance: string) {
  const list = map.get(key) ?? [];
  list.push(stance);
  map.set(key, list);
}

function titleSearchScore(title: string, query: string) {
  const normalizedTitle = normalizeMealText(title);
  const normalizedQuery = normalizeMealText(query);
  if (!normalizedQuery) return 0;
  if (normalizedTitle === normalizedQuery) return 200;
  if (` ${normalizedTitle} `.includes(` ${normalizedQuery} `)) return 170;
  const queryWords = normalizedQuery.split(" ").filter((word) => word.length >= 3);
  if (queryWords.length === 0) return 0;
  const matchedWords = queryWords.filter((word) => normalizedTitle.includes(word));
  if (matchedWords.length === 0) return 0;
  return 80 + matchedWords.length * 20;
}

export default async function GerechtenPage({
  searchParams,
}: {
  searchParams: Promise<{ day?: string; direction?: string; q?: string; status?: string }>;
}) {
  const params = await searchParams;

  const household = await requireCurrentHousehold();
  const statusMessage = params.status ? STATUS_MESSAGES[params.status] : undefined;

  const dayKey: DayKey = (DAY_KEYS as readonly string[]).includes(params.day ?? "")
    ? (params.day as DayKey)
    : "monday";
  const direction = DIRECTION_KEYS.includes(params.direction as (typeof DIRECTION_KEYS)[number])
    ? params.direction!
    : "all";
  const wishText = String(params.q ?? "").trim();

  const weekStart = getCurrentWeekStart();
  const mealPlan = await getMealPlanForWeek(household.id, weekStart);
  const currentEntry = mealPlan?.entries.find((e) => e.dayOfWeek === DAY_ENUM[dayKey]);

  const preferences = await prisma.preference.findMany({
    where: { ownerType: "HOUSEHOLD", ownerId: household.id },
  });
  const preferredCategories = new Set(
    preferences.filter((p) => p.subjectType === "RECIPE_CATEGORY" && p.stance === "LIKED").map((p) => p.subjectId)
  );
  const likedVariantIds = new Set(
    preferences.filter((p) => p.subjectType === "RECIPE_VARIANT" && p.stance === "LIKED").map((p) => p.subjectId)
  );
  const confidenceByVariantId = new Map(
    preferences.filter((p) => p.subjectType === "RECIPE_VARIANT").map((p) => [p.subjectId, p.confidence])
  );
  const hiddenVariantIds = new Set(
    preferences.filter((p) => p.subjectType === "RECIPE_VARIANT" && p.hiddenAt !== null).map((p) => p.subjectId)
  );

  const [allVariants, { hardRestrictionsByDay, participantsByDay }, dayRecipePreferences] = await Promise.all([
    prisma.recipeVariant.findMany({
      where: { recipe: accessibleRecipeWhere(household.id) },
      include: VARIANT_INCLUDE,
    }),
    getHouseholdHardRestrictionsAndParticipantsByDay(household.id),
    prisma.preference.findMany({
      where: {
        ownerType: "HOUSEHOLD",
        ownerId: dayRecipePreferenceOwnerId(household.id, dayKey),
        subjectType: "RECIPE_VARIANT",
      },
    }),
  ]);
  const hardRestrictions = hardRestrictionsByDay[dayKey];
  const dayPreferenceByVariantId = new Map(
    dayRecipePreferences.map((preference) => [preference.subjectId, preference])
  );
  const participants = participantsByDay[dayKey];
  const allIngredientIds = [
    ...new Set(
      allVariants.flatMap((variant) => variant.recipe.ingredients.map((ri) => ri.ingredientId))
    ),
  ];
  const allIngredients = [
    ...new Map(
      allVariants.flatMap((variant) =>
        variant.recipe.ingredients.map((ri) => [ri.ingredientId, { id: ri.ingredientId, name: ri.ingredient.name }] as const)
      )
    ).values(),
  ];
  const mealWish = parseMealWish(wishText, allIngredients);
  const allCategories = [...new Set(allVariants.map((variant) => variant.recipe.category))];
  const personalPreferences = await prisma.preference.findMany({
    where: {
      ownerType: "PERSON",
      ownerId: { in: participants.map((person) => person.id) },
      OR: [
        { subjectType: "RECIPE_VARIANT", subjectId: { in: allVariants.map((variant) => variant.id) } },
        { subjectType: "RECIPE_CATEGORY", subjectId: { in: allCategories } },
        { subjectType: "INGREDIENT", subjectId: { in: allIngredientIds } },
      ],
    },
  });
  const personalStancesByVariantId = new Map<string, string[]>();
  const personalStancesByCategory = new Map<string, string[]>();
  const personalStancesByIngredient = new Map<string, string[]>();
  for (const preference of personalPreferences) {
    if (preference.subjectType === "RECIPE_VARIANT") {
      addStance(personalStancesByVariantId, preference.subjectId, preference.stance);
    } else if (preference.subjectType === "RECIPE_CATEGORY") {
      addStance(personalStancesByCategory, preference.subjectId, preference.stance);
    } else if (preference.subjectType === "INGREDIENT") {
      addStance(personalStancesByIngredient, preference.subjectId, preference.stance);
    }
  }
  const personalStancesForVariant = (variant: VariantWithRecipe) => [
    ...(personalStancesByVariantId.get(variant.id) ?? []),
    ...(personalStancesByCategory.get(variant.recipe.category) ?? []),
    ...variant.recipe.ingredients.flatMap((ri) => personalStancesByIngredient.get(ri.ingredientId) ?? []),
  ];

  // Een onveilig gerecht mag niet eens als suggestie zichtbaar zijn — niet
  // pas bij het bevestigen ervan (sectie 10 van de Blueprint).
  const variants = allVariants.filter(
    (v) =>
      !recipeConflictsWithRestrictions(
        v.recipe.ingredients.map((ri) => ({
          category: ri.ingredient.category,
          restrictionTags: ri.ingredient.restrictionTags,
        })),
        hardRestrictions
      ) && !personalStancesForVariant(v).includes("NEVER") && !hiddenVariantIds.has(v.id)
  );
  // Fase 11: na herhaalde negatieve feedback verbergt de app een gerecht
  // echt (niet alleen lager scoren) — zichtbaar en herstelbaar in een eigen
  // sectie, nooit stilzwijgend voorgoed weg.
  const hiddenVariants = allVariants.filter((v) => hiddenVariantIds.has(v.id));

  let filtered = variants;
  if (direction === "favorites") {
    filtered = variants.filter(
      (v) => preferredCategories.has(v.recipe.category) || likedVariantIds.has(v.id)
    );
  } else if (direction === "quick") {
    filtered = variants.filter(
      (v) => v.variantType === "FAST" || v.recipe.category === "QUICK_AND_EASY"
    );
  } else if (direction === "day") {
    filtered = variants.filter((v) => {
      const preference = dayPreferenceByVariantId.get(v.id);
      return preference?.stance === "LIKED" || preference?.stance === "SOMETIMES";
    });
  }
  // "Deze dag" en "Favorieten" filteren op geleerde voorkeuren — een vers
  // huishouden heeft die nog niet, en zou dan een lege lijst zonder enige
  // "Kies"-knop te zien krijgen. Val in dat geval terug op alle gerechten
  // (de sortering hieronder weegt een eventuele daggewoonte alsnog mee).
  const usesFallbackForDay =
    direction === "day" && filtered.length === 0 && variants.length > 0;
  if (filtered.length === 0 && (direction === "day" || direction === "favorites")) {
    filtered = variants;
  }
  const wishScoresByVariantId = new Map(
    variants.map((variant) => [
      variant.id,
      scoreMealWish(
        {
          recipeCategory: variant.recipe.category,
          recipeProperties: variant.recipe.properties,
          variantType: variant.variantType,
          contextFit: variant.contextFit,
          ingredients: variant.recipe.ingredients.map((ri) => ({ id: ri.ingredientId, name: ri.ingredient.name })),
        },
        mealWish
      ),
    ])
  );
  const titleScoresByVariantId = new Map(
    variants.map((variant) => [variant.id, titleSearchScore(variant.recipe.title, wishText)])
  );
  const hasWish = mealWish.tags.length > 0 || mealWish.ingredientIds.length > 0;
  const hasExplicitSearch = normalizeMealText(wishText).length > 0;
  const literalWishIngredients = mealWish.ingredientIds
    .map((id) => allIngredients.find((ingredient) => ingredient.id === id))
    .filter((ingredient): ingredient is (typeof allIngredients)[number] => Boolean(ingredient));
  const canUseLiteralWish = literalWishIngredients.length >= 3;
  const wishLabelParts = [
    ...mealWish.tags.map((tag) => tag.toLowerCase().replaceAll("_", " ")),
    ...mealWish.ingredientIds
      .map((id) => allIngredients.find((ingredient) => ingredient.id === id)?.name.toLowerCase())
      .filter((name): name is string => Boolean(name)),
  ];
  const directionHref = (key: string) => {
    const q = new URLSearchParams({ day: dayKey, direction: key });
    if (wishText) q.set("q", wishText);
    return `/gerechten?${q.toString()}`;
  };
  if (hasExplicitSearch) {
    const matching = filtered.filter(
      (variant) =>
        (titleScoresByVariantId.get(variant.id) ?? 0) > 0 ||
        (wishScoresByVariantId.get(variant.id)?.score ?? 0) > 0
    );
    filtered = matching.length > 0 ? matching : filtered;
  }
  filtered = filtered
    .filter((v) => v.id !== currentEntry?.recipeVariantId)
    .sort(
      (a, b) =>
        (titleScoresByVariantId.get(b.id) ?? 0) - (titleScoresByVariantId.get(a.id) ?? 0) ||
        (wishScoresByVariantId.get(b.id)?.score ?? 0) - (wishScoresByVariantId.get(a.id)?.score ?? 0) ||
        dayPreferenceScore(dayPreferenceByVariantId.get(b.id)?.stance) -
          dayPreferenceScore(dayPreferenceByVariantId.get(a.id)?.stance) ||
        personalPreferenceScore(personalStancesForVariant(b)) -
          personalPreferenceScore(personalStancesForVariant(a)) ||
        (confidenceByVariantId.get(b.id) ?? 0.5) - (confidenceByVariantId.get(a.id) ?? 0.5)
    )
    .slice(0, 12);

  const newSuggestions = filtered.filter(
    (v) => v.recipe.status === "FOUND" || v.recipe.status === "ADAPTED"
  );
  const favorites = filtered.filter((v) => v.recipe.status === "SAFE_CHOICE");
  const rest = filtered.filter((v) => !newSuggestions.includes(v) && !favorites.includes(v));

  return (
    <div className="mx-auto flex min-h-screen w-full min-w-0 max-w-2xl flex-col pb-[calc(6rem+env(safe-area-inset-bottom))]">
      <header className="flex items-center justify-between px-6 pt-6 pb-2">
        <Link href="/" aria-label="Terug naar Jouw week" className="text-ink-muted">
          <ChevronLeft size={22} />
        </Link>
        <span className="text-sm font-semibold">Gerechten</span>
        <UtensilsCrossed size={18} className="text-ink-muted" />
      </header>

      <div className="px-6 pt-4">
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-accent">
          Vervangen voor {DAY_LABELS[dayKey]}
        </p>
        <h1 className="mb-1 text-[1.6rem] font-semibold leading-tight text-ink">
          Waar hebben jullie zin in?
        </h1>
        <p className="mb-5 text-[15px] text-ink-muted">
          Ik heb deze gerechten voor jullie uitgekozen.
        </p>

        {statusMessage && (
          <p className="mb-5 rounded-lg border border-tag-green-ink/20 bg-tag-green-bg px-3 py-2 text-sm font-medium text-tag-green-ink">
            {statusMessage}
          </p>
        )}

        <form action="/gerechten" className="mb-4 grid gap-2">
          <input type="hidden" name="day" value={dayKey} />
          <input type="hidden" name="direction" value={direction} />
          <input
            name="q"
            defaultValue={wishText}
            placeholder="Bijv. AVG met sperziebonen en kip"
            className="rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-ink outline-none focus:border-accent"
          />
          <button
            type="submit"
            className="w-fit rounded-lg border border-line px-3 py-2 text-xs font-medium text-ink-muted hover:border-accent hover:text-accent"
          >
            Zoek passend gerecht
          </button>
        </form>

        {hasWish && (
          <p className="mb-5 text-xs text-ink-muted">
            Ik zoek op {wishLabelParts.join(", ")}.
          </p>
        )}
        {hasExplicitSearch && !hasWish && (
          <p className="mb-5 text-xs text-ink-muted">
            Ik zoek letterlijk op receptnamen met “{wishText}”.
          </p>
        )}

        <div className="mb-6 flex flex-wrap gap-2">
          {DIRECTIONS.map((d) => (
            <a
              key={d.key}
              href={directionHref(d.key)}
              className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${
                direction === d.key
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-line text-ink-muted hover:border-ink-faint"
              }`}
            >
              {d.label}
            </a>
          ))}
        </div>

        {usesFallbackForDay && (
          <p className="mb-5 text-xs text-ink-muted">
            Ik heb nog geen voorkeur geleerd voor {DAY_LABELS[dayKey]}. Dit zijn alle suggesties —
            kies er een en ik leer wat bij deze dag past.
          </p>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-8 px-6">
        {canUseLiteralWish && (
          <form action={chooseLiteralMealPlanEntry}>
            <input type="hidden" name="householdId" value={household.id} />
            <input type="hidden" name="dayKey" value={dayKey} />
            <input type="hidden" name="weekStart" value={weekStart.toISOString()} />
            <input type="hidden" name="ingredientIds" value={literalWishIngredients.map((ingredient) => ingredient.id).join(",")} />
            <div className="rounded-xl border border-accent/35 bg-accent-soft p-4">
              <div className="mb-3 flex items-start gap-2">
                <Sparkles size={17} className="mt-0.5 shrink-0 text-accent" />
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-ink">Maak precies deze maaltijd</h2>
                  <p className="mt-1 text-sm text-ink-muted">
                    Ik kan dit direct plannen met {literalWishIngredients.map((ingredient) => ingredient.name.toLowerCase()).join(", ")}.
                    De recepten hieronder blijven alternatieven.
                  </p>
                </div>
              </div>
              <button
                type="submit"
                className="rounded-lg bg-accent px-3 py-2 text-xs font-medium text-accent-ink transition-all duration-150 hover:-translate-y-0.5 hover:bg-accent/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:translate-y-0 active:scale-[0.98]"
              >
                Kies deze combinatie
              </button>
            </div>
          </form>
        )}

        {filtered.length === 0 && (
          <p className="text-sm text-ink-muted">Geen andere gerechten gevonden in deze richting.</p>
        )}

        {direction === "all" && newSuggestions.length > 0 && (
          <RecipeSection
            title="Nieuwe suggesties voor jullie"
            icon={<Sparkles size={16} className="text-tag-purple-ink" />}
            variants={newSuggestions}
            wishScoresByVariantId={wishScoresByVariantId}
            titleScoresByVariantId={titleScoresByVariantId}
            dayPreferenceByVariantId={dayPreferenceByVariantId}
            household={household.id}
            dayKey={dayKey}
            weekStart={weekStart}
          />
        )}

        {direction === "all" && favorites.length > 0 && (
          <RecipeSection
            title="Jullie favorieten"
            icon={<Heart size={16} className="text-tag-green-ink" fill="currentColor" />}
            variants={favorites}
            wishScoresByVariantId={wishScoresByVariantId}
            titleScoresByVariantId={titleScoresByVariantId}
            dayPreferenceByVariantId={dayPreferenceByVariantId}
            household={household.id}
            dayKey={dayKey}
            weekStart={weekStart}
          />
        )}

        {(direction !== "all" || rest.length > 0) && (
          <RecipeSection
            title={direction === "all" ? "Meer opties" : DIRECTIONS.find((d) => d.key === direction)!.label}
            icon={<UtensilsCrossed size={16} className="text-ink-faint" />}
            variants={direction === "all" ? rest : filtered}
            wishScoresByVariantId={wishScoresByVariantId}
            titleScoresByVariantId={titleScoresByVariantId}
            dayPreferenceByVariantId={dayPreferenceByVariantId}
            household={household.id}
            dayKey={dayKey}
            weekStart={weekStart}
          />
        )}

        {hiddenVariants.length > 0 && (
          <details className="mb-2 min-w-0 rounded-xl border border-line bg-surface p-4">
            <summary className="flex cursor-pointer items-center gap-2 font-medium text-ink">
              <EyeOff size={16} className="text-ink-faint" />
              Verborgen gerechten
              <span className="text-xs font-normal text-ink-faint">{hiddenVariants.length}</span>
            </summary>
            <p className="mt-3 mb-3 text-xs text-ink-muted">
              Ik stel deze gerechten minder vaak voor omdat jullie ze meermaals negatief hebben
              beoordeeld. Wil je er toch weer een keer een terugzien?
            </p>
            <div className="grid gap-3">
              {hiddenVariants.map((variant) => (
                <div key={variant.id} className="flex items-center justify-between gap-3 rounded-lg border border-line p-3">
                  <p className="line-clamp-2 min-w-0 flex-1 text-sm font-medium text-ink">{variant.recipe.title}</p>
                  <form action={restoreHiddenRecipeVariant}>
                    <input type="hidden" name="householdId" value={household.id} />
                    <input type="hidden" name="recipeVariantId" value={variant.id} />
                    <input type="hidden" name="dayKey" value={dayKey} />
                    <input type="hidden" name="direction" value={direction} />
                    <button
                      type="submit"
                      className="shrink-0 rounded-lg border border-line px-3 py-2 text-xs font-medium text-ink-muted hover:border-accent hover:text-accent"
                    >
                      Toch weer tonen
                    </button>
                  </form>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>

      <NavBar />
    </div>
  );
}

function RecipeSection({
  title,
  icon,
  variants,
  wishScoresByVariantId,
  titleScoresByVariantId,
  dayPreferenceByVariantId,
  household,
  dayKey,
  weekStart,
}: {
  title: string;
  icon?: React.ReactNode;
  variants: VariantWithRecipe[];
  wishScoresByVariantId: Map<string, { score: number; reasons: string[] }>;
  titleScoresByVariantId: Map<string, number>;
  dayPreferenceByVariantId: Map<string, { stance: string }>;
  household: string;
  dayKey: DayKey;
  weekStart: Date;
}) {
  if (variants.length === 0) return null;
  return (
    <section className="min-w-0">
      <div className="mb-3 flex items-center gap-1.5">
        {icon}
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
      </div>
      <div className="flex min-w-0 flex-col gap-3">
        {variants.map((variant) => {
          const statusLabel = STATUS_LABELS[variant.recipe.status];
          const wishScore = wishScoresByVariantId.get(variant.id);
          const titleScore = titleScoresByVariantId.get(variant.id) ?? 0;
          const dayPreference = dayPreferenceByVariantId.get(variant.id);
          return (
            <form key={variant.id} action={replaceMealPlanEntry}>
              <input type="hidden" name="householdId" value={household} />
              <input type="hidden" name="dayKey" value={dayKey} />
              <input type="hidden" name="recipeVariantId" value={variant.id} />
              <input type="hidden" name="weekStart" value={weekStart.toISOString()} />
              <div className="rounded-xl border border-line bg-surface p-3 transition-colors hover:border-accent/50">
                <div className="min-w-0">
                  <p className="line-clamp-2 font-medium text-ink">{variant.recipe.title}</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {statusLabel && <Tag tone={statusTone(variant.recipe.status)}>{statusLabel}</Tag>}
                    {variant.recipe.properties.slice(0, 2).map((p) => (
                      <span key={p} className="text-[11px] whitespace-nowrap text-ink-faint">
                        {p.replace(/_/g, " ")}
                      </span>
                    ))}
                    {(dayPreference?.stance === "LIKED" || dayPreference?.stance === "SOMETIMES") && (
                      <span className="text-[11px] whitespace-nowrap text-tag-green-ink">
                        {dayPreference.stance === "LIKED" ? "vaak op deze dag" : "soms op deze dag"}
                      </span>
                    )}
                  </div>
                  {wishScore && wishScore.score > 0 && (
                    <p className="mt-1 truncate text-[11px] text-accent">
                      Past bij {wishScore.reasons.slice(0, 3).join(", ")}
                    </p>
                  )}
                  {titleScore > 0 && (
                    <p className="mt-1 truncate text-[11px] text-accent">
                      Gevonden op receptnaam
                    </p>
                  )}
                </div>
                <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
                  <select
                    name="replacementReason"
                    defaultValue="ONLY_THIS_TIME"
                    aria-label="Waarom wil je wisselen?"
                    className="min-w-0 rounded-lg border border-line bg-surface px-2 py-2 text-xs text-ink-muted"
                  >
                    {MEAL_REPLACEMENT_REASONS.map((reason) => (
                      <option key={reason.value} value={reason.value}>
                        {reason.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    className="rounded-lg bg-accent px-3 py-2 text-xs font-medium text-accent-ink transition-all duration-150 hover:-translate-y-0.5 hover:bg-accent/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:translate-y-0 active:scale-[0.98]"
                  >
                    Kies
                  </button>
                </div>
              </div>
            </form>
          );
        })}
      </div>
    </section>
  );
}
