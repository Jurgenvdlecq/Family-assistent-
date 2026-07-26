import Link from "next/link";
import { ChevronLeft, ChevronRight, SlidersHorizontal, Heart, Sparkles } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireCurrentHousehold } from "@/lib/auth";
import { getMealPlanForWeek } from "@/lib/mealPlan";
import { getHouseholdHardRestrictions } from "@/lib/household";
import { recipeConflictsWithRestrictions } from "@/lib/dietaryRestrictions";
import { DAY_KEYS, DAY_ENUM, DAY_LABELS, getCurrentWeekStart, type DayKey } from "@/lib/week";
import { CATEGORY_GRADIENT, STATUS_LABELS, statusTone } from "@/lib/categoryStyle";
import NavBar from "@/components/NavBar";
import Tag from "@/components/Tag";
import { replaceMealPlanEntry } from "./actions";

// Leest live weekplanning + voorkeuren — nooit statisch prerenderen.
export const dynamic = "force-dynamic";

const DIRECTIONS = [
  { key: "all", label: "Alle suggesties" },
  { key: "favorites", label: "Favorieten" },
  { key: "quick", label: "Snel & makkelijk" },
] as const;

const VARIANT_INCLUDE = {
  recipe: { include: { ingredients: { include: { ingredient: true } } } },
} as const;

type VariantWithRecipe = Awaited<
  ReturnType<typeof prisma.recipeVariant.findMany<{ include: typeof VARIANT_INCLUDE }>>
>[number];

export default async function GerechtenPage({
  searchParams,
}: {
  searchParams: Promise<{ day?: string; direction?: string }>;
}) {
  const params = await searchParams;

  const household = await requireCurrentHousehold();

  const dayKey: DayKey = (DAY_KEYS as readonly string[]).includes(params.day ?? "")
    ? (params.day as DayKey)
    : "monday";
  const direction = params.direction ?? "all";

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

  const [allVariants, hardRestrictions] = await Promise.all([
    prisma.recipeVariant.findMany({ include: VARIANT_INCLUDE }),
    getHouseholdHardRestrictions(household.id),
  ]);

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
      )
  );

  let filtered = variants;
  if (direction === "favorites") {
    filtered = variants.filter(
      (v) => preferredCategories.has(v.recipe.category) || likedVariantIds.has(v.id)
    );
  } else if (direction === "quick") {
    filtered = variants.filter(
      (v) => v.variantType === "FAST" || v.recipe.category === "QUICK_AND_EASY"
    );
  }
  filtered = filtered
    .filter((v) => v.id !== currentEntry?.recipeVariantId)
    .sort((a, b) => (confidenceByVariantId.get(b.id) ?? 0.5) - (confidenceByVariantId.get(a.id) ?? 0.5))
    .slice(0, 12);

  const newSuggestions = filtered.filter(
    (v) => v.recipe.status === "FOUND" || v.recipe.status === "ADAPTED"
  );
  const favorites = filtered.filter((v) => v.recipe.status === "SAFE_CHOICE");
  const rest = filtered.filter((v) => !newSuggestions.includes(v) && !favorites.includes(v));

  return (
    <div className="mx-auto flex min-h-screen w-full min-w-0 max-w-2xl flex-col pb-24">
      <header className="flex items-center justify-between px-6 pt-6 pb-2">
        <Link href="/" aria-label="Terug naar Jouw week" className="text-ink-muted">
          <ChevronLeft size={22} />
        </Link>
        <span className="text-sm font-semibold">Gerechten</span>
        <SlidersHorizontal size={18} className="text-ink-muted" />
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

        <div className="mb-6 flex flex-wrap gap-2">
          {DIRECTIONS.map((d) => (
            <a
              key={d.key}
              href={`/gerechten?day=${dayKey}&direction=${d.key}`}
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
      </div>

      <div className="flex min-w-0 flex-col gap-8 px-6">
        {filtered.length === 0 && (
          <p className="text-sm text-ink-muted">Geen andere gerechten gevonden in deze richting.</p>
        )}

        {direction === "all" && newSuggestions.length > 0 && (
          <RecipeSection
            title="Nieuwe suggesties voor jullie"
            icon={<Sparkles size={16} className="text-tag-purple-ink" />}
            variants={newSuggestions}
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
            household={household.id}
            dayKey={dayKey}
            weekStart={weekStart}
          />
        )}

        {(direction !== "all" || rest.length > 0) && (
          <RecipeSection
            title={direction === "all" ? "Meer opties" : DIRECTIONS.find((d) => d.key === direction)!.label}
            variants={direction === "all" ? rest : filtered}
            household={household.id}
            dayKey={dayKey}
            weekStart={weekStart}
          />
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
  household,
  dayKey,
  weekStart,
}: {
  title: string;
  icon?: React.ReactNode;
  variants: VariantWithRecipe[];
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
          const gradient = CATEGORY_GRADIENT[variant.recipe.category];
          return (
            <form key={variant.id} action={replaceMealPlanEntry}>
              <input type="hidden" name="householdId" value={household} />
              <input type="hidden" name="dayKey" value={dayKey} />
              <input type="hidden" name="recipeVariantId" value={variant.id} />
              <input type="hidden" name="weekStart" value={weekStart.toISOString()} />
              <button
                type="submit"
                className="flex w-full min-w-0 items-center gap-3 rounded-xl border border-line bg-surface p-3 text-left transition-colors hover:border-accent/50"
              >
                <div className={`h-14 w-14 shrink-0 rounded-lg bg-gradient-to-br ${gradient}`} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-ink">{variant.recipe.title}</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {statusLabel && <Tag tone={statusTone(variant.recipe.status)}>{statusLabel}</Tag>}
                    {variant.recipe.properties.slice(0, 2).map((p) => (
                      <span key={p} className="text-[11px] whitespace-nowrap text-ink-faint">
                        {p.replace(/_/g, " ")}
                      </span>
                    ))}
                  </div>
                </div>
                <ChevronRight size={18} className="shrink-0 text-ink-faint" />
              </button>
            </form>
          );
        })}
      </div>
    </section>
  );
}
