import Link from "next/link";
import { ChevronLeft, LogOut, Heart, ShoppingBag, Sparkles } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireCurrentHousehold } from "@/lib/auth";
import type { DayKey } from "@/lib/week";
import { CATEGORY_LABELS } from "@/lib/categoryStyle";
import NavBar from "@/components/NavBar";
import AddPersonForm from "./AddPersonForm";
import WeeklyRhythmEditor from "./WeeklyRhythmEditor";
import { logout, updateAccessCode } from "./actions";

// Leest live gezinsdata — nooit statisch prerenderen.
export const dynamic = "force-dynamic";

const ROLE_LABELS: Record<string, string> = {
  PARENT: "Ouder",
  CHILD: "Kind",
  OTHER: "Anders",
};

const STANCE_LABELS: Record<string, string> = {
  LIKED: "Lekker",
  SOMETIMES: "Soms",
  RATHER_NOT: "Liever niet",
  NEVER: "Nooit",
  UNKNOWN: "Onbekend",
};

const AVATAR_TONES = [
  "bg-tag-blue-bg text-tag-blue-ink",
  "bg-tag-green-bg text-tag-green-ink",
  "bg-tag-amber-bg text-tag-amber-ink",
  "bg-tag-purple-bg text-tag-purple-ink",
  "bg-tag-pink-bg text-tag-pink-ink",
];

function avatarTone(name: string) {
  const sum = [...name].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return AVATAR_TONES[sum % AVATAR_TONES.length];
}

function initials(name: string) {
  return name.trim().slice(0, 2).toUpperCase();
}

export default async function OnsGezinPage() {
  const currentHousehold = await requireCurrentHousehold();
  const household = await prisma.household.findUniqueOrThrow({
    where: { id: currentHousehold.id },
    include: { persons: { orderBy: { createdAt: "asc" } } },
  });

  const preferences = await prisma.preference.findMany({
    where: { ownerType: "HOUSEHOLD", ownerId: household.id },
  });

  const likedCategories = preferences
    .filter((p) => p.subjectType === "RECIPE_CATEGORY" && p.stance === "LIKED")
    .map((p) => CATEGORY_LABELS[p.subjectId] ?? p.subjectId);

  const likedProductPrefs = preferences.filter(
    (p) => p.subjectType === "PRODUCT" && p.stance === "LIKED"
  );
  const likedProducts = await prisma.product.findMany({
    where: { id: { in: likedProductPrefs.map((p) => p.subjectId) } },
  });

  const variantPrefs = preferences
    .filter((p) => p.subjectType === "RECIPE_VARIANT" && p.source === "INFERRED")
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 10);
  const learnedVariants = await prisma.recipeVariant.findMany({
    where: { id: { in: variantPrefs.map((p) => p.subjectId) } },
    include: { recipe: true },
  });
  const stanceByVariantId = new Map(variantPrefs.map((p) => [p.subjectId, p.stance]));

  const rhythm = (household.weeklyRhythm ?? {}) as Partial<Record<DayKey, "busy" | "quiet">>;

  return (
    <div className="mx-auto flex min-h-screen w-full min-w-0 max-w-2xl flex-col pb-24">
      <header className="flex items-center justify-between px-6 pt-6 pb-2">
        <Link href="/" aria-label="Terug naar Jouw week" className="text-ink-muted">
          <ChevronLeft size={22} />
        </Link>
        <span className="text-sm font-semibold">Ons gezin</span>
        <form action={logout}>
          <button type="submit" aria-label="Uitloggen" title="Uitloggen" className="text-ink-muted">
            <LogOut size={18} />
          </button>
        </form>
      </header>

      <div className="min-w-0 px-6 pt-4">
        <p className="mb-6 text-[15px] text-ink-muted">
          Ik leer steeds beter wat bij jullie past.
        </p>

        <h2 className="mb-3 text-sm font-semibold text-ink">Gezinsleden</h2>
        <div className="mb-8 grid grid-cols-2 gap-3">
          {household.persons.map((person) => (
            <div key={person.id} className="min-w-0 rounded-xl border border-line bg-surface p-4">
              <div
                className={`mb-2 flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold ${avatarTone(person.name)}`}
              >
                {initials(person.name)}
              </div>
              <p className="truncate font-medium text-ink">{person.name}</p>
              <p className="text-xs text-ink-faint">{ROLE_LABELS[person.role] ?? person.role}</p>
              {Array.isArray(person.hardRestrictions) && person.hardRestrictions.length > 0 && (
                <p className="mt-1 truncate text-xs text-tag-amber-ink">
                  {(person.hardRestrictions as string[]).join(", ")}
                </p>
              )}
            </div>
          ))}
          <AddPersonForm householdId={household.id} />
        </div>

        <h2 className="mb-3 text-sm font-semibold text-ink">Jullie weekritme</h2>
        <div className="mb-8 min-w-0 rounded-xl border border-line bg-surface p-4">
          <WeeklyRhythmEditor householdId={household.id} initialRhythm={rhythm} />
        </div>

        <h2 className="mb-3 text-sm font-semibold text-ink">Toegangscode</h2>
        <form action={updateAccessCode} className="mb-8 min-w-0 rounded-xl border border-line bg-surface p-4">
          <input type="hidden" name="householdId" value={household.id} />
          <p className="mb-3 text-sm text-ink-muted">
            Gebruik deze code om dit huishouden op een ander apparaat te openen.
          </p>
          <div className="flex min-w-0 gap-2">
            <input
              type="password"
              name="accessCode"
              minLength={6}
              required
              placeholder={household.accessCodeHash ? "Nieuwe toegangscode" : "Toegangscode instellen"}
              className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
            />
            <button type="submit" className="shrink-0 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-ink">
              Opslaan
            </button>
          </div>
        </form>

        <div className="mb-8 flex min-w-0 flex-col divide-y divide-line rounded-xl border border-line bg-surface">
          <div className="flex min-w-0 items-start gap-3 p-4">
            <Heart size={18} className="mt-0.5 shrink-0 text-tag-pink-ink" />
            <div className="min-w-0">
              <p className="font-medium text-ink">Favorieten</p>
              <p className="text-sm text-ink-muted">
                {likedCategories.length > 0 ? likedCategories.join(", ") : "Nog niets gekozen"}
              </p>
            </div>
          </div>
          <div className="flex min-w-0 items-start gap-3 p-4">
            <ShoppingBag size={18} className="mt-0.5 shrink-0 text-tag-blue-ink" />
            <div className="min-w-0">
              <p className="font-medium text-ink">Vaste productvoorkeuren</p>
              <p className="text-sm text-ink-muted">
                {likedProducts.length > 0
                  ? likedProducts.map((p) => p.name).join(", ")
                  : "Nog niets geleerd — dit vult zich vanzelf via Controle"}
              </p>
            </div>
          </div>
        </div>

        <details className="mb-8 min-w-0 rounded-xl border border-line bg-surface p-4">
          <summary className="flex cursor-pointer items-center gap-2 font-medium text-ink">
            <Sparkles size={16} className="text-tag-purple-ink" />
            Wat ik heb geleerd
          </summary>
          <div className="mt-4 flex min-w-0 flex-col gap-2">
            {learnedVariants.length === 0 && (
              <p className="text-sm text-ink-muted">
                Nog niet genoeg feedback om iets te tonen — dit groeit terwijl jullie de app
                gebruiken.
              </p>
            )}
            {learnedVariants.map((variant) => (
              <div key={variant.id} className="flex min-w-0 items-center justify-between gap-3">
                <span className="min-w-0 truncate text-sm text-ink">{variant.recipe.title}</span>
                <span className="shrink-0 text-xs text-ink-faint">
                  {STANCE_LABELS[stanceByVariantId.get(variant.id) ?? "UNKNOWN"]}
                </span>
              </div>
            ))}
          </div>
        </details>
      </div>

      <NavBar />
    </div>
  );
}
