import Link from "next/link";
import { ChevronLeft, LogOut, Heart, ShoppingBag, Sparkles, Trash2 } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireCurrentHousehold } from "@/lib/auth";
import type { DayKey } from "@/lib/week";
import { CATEGORY_LABELS } from "@/lib/categoryStyle";
import { accessibleRecipeWhere } from "@/lib/recipeScope";
import {
  PRODUCT_CHOICE_LABELS,
  PRODUCT_CHOICE_PREFERENCES,
  productChoicePreferenceFromDeliveryPreference,
} from "@/domain/product-matching/productChoicePreference";
import NavBar from "@/components/NavBar";
import AddPersonForm from "./AddPersonForm";
import DayRecipePreferencesManager from "./DayRecipePreferencesManager";
import LearnedPatternsPanel from "./LearnedPatternsPanel";
import PersonalPreferencesManager, { labelPersonalPreferenceSubject } from "./PersonalPreferencesManager";
import PersonPreferencesCard from "./PersonPreferencesCard";
import PicnicConnection from "./PicnicConnection";
import PicnicDeliveryPreferenceForm from "./PicnicDeliveryPreferenceForm";
import PlanningStyleEditor from "./PlanningStyleEditor";
import PushNotificationSettings from "./PushNotificationSettings";
import WeeklyRhythmEditor from "./WeeklyRhythmEditor";
import { getNotificationPreferences } from "@/lib/notifications";
import {
  forgetProductPreference,
  logout,
  updateCredentials,
  updateHouseholdCategoryPreference,
  updateProductChoicePreference,
} from "./actions";

// Leest live gezinsdata — nooit statisch prerenderen.
export const dynamic = "force-dynamic";

const STANCE_LABELS: Record<string, string> = {
  LIKED: "Lekker",
  SOMETIMES: "Soms",
  RATHER_NOT: "Liever niet",
  NEVER: "Nooit",
  UNKNOWN: "Onbekend",
};

const CATEGORY_STANCE_OPTIONS = [
  { value: "LIKED", label: "Favoriet" },
  { value: "SOMETIMES", label: "Oké" },
  { value: "RATHER_NOT", label: "Liever niet" },
  { value: "UNKNOWN", label: "Geen voorkeur" },
] as const;

const ERROR_STATUS_MESSAGES: Record<string, string> = {
  "username-taken": "Deze gebruikersnaam is al in gebruik door een ander huishouden. Kies een andere.",
  "credentials-invalid": "Kies een gebruikersnaam van minimaal 3 tekens en een wachtwoord van minimaal 6 tekens.",
};

const STATUS_MESSAGES: Record<string, string> = {
  "person-added": "Gezinslid toegevoegd.",
  "person-updated": "Profiel opgeslagen.",
  "presence-updated": "Aanwezigheid bijgewerkt.",
  "rhythm-updated": "Dagritme opgeslagen.",
  "planning-style-updated": "Planningsstijl opgeslagen.",
  "product-preference-updated": "Productkeuze-instelling opgeslagen.",
  "category-preference-updated": "Voorkeur opgeslagen.",
  "product-preference-forgotten": "Onthouden productkeuze vergeten.",
  "personal-preference-updated": "Voorkeur opgeslagen.",
  "personal-preference-deleted": "Voorkeur verwijderd.",
  "day-recipe-preference-updated": "Dagoptie opgeslagen.",
  "day-recipe-preference-deleted": "Dagoptie verwijderd.",
  "learned-pattern-dismissed": "Geleerd patroon vergeten.",
  "credentials-updated": "Inloggegevens opgeslagen.",
  "picnic-connected": "Picnic gekoppeld.",
  "picnic-2fa-needed": "Verificatiecode verstuurd — check je telefoon.",
  "picnic-2fa-cancelled": "Koppelpoging geannuleerd.",
  "picnic-disconnected": "Picnic-account losgekoppeld.",
  "picnic-delivery-preference-updated": "Bezorgvoorkeur opgeslagen.",
  "picnic-delivery-preference-removed": "Bezorgvoorkeur verwijderd.",
};

export default async function OnsGezinPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const params = await searchParams;
  const statusMessage = params.status ? STATUS_MESSAGES[params.status] : undefined;
  const errorMessage = params.status ? ERROR_STATUS_MESSAGES[params.status] : undefined;
  const currentHousehold = await requireCurrentHousehold();
  const household = await prisma.household.findUniqueOrThrow({
    where: { id: currentHousehold.id },
    include: {
      persons: {
        include: { presenceOverrides: { orderBy: { dayOfWeek: "asc" } } },
        orderBy: { createdAt: "asc" },
      },
      picnicDeliveryPreference: true,
    },
  });

  const preferences = await prisma.preference.findMany({
    where: { ownerType: "HOUSEHOLD", ownerId: household.id },
  });
  const notificationPreferences = Object.fromEntries(await getNotificationPreferences(household.id));
  const personIds = household.persons.map((person) => person.id);
  const personalPreferences = await prisma.preference.findMany({
    where: {
      ownerType: "PERSON",
      ownerId: { in: personIds },
      subjectType: { in: ["RECIPE_VARIANT", "RECIPE_CATEGORY", "INGREDIENT"] },
    },
    orderBy: { updatedAt: "desc" },
  });
  const [personalVariants, personalIngredients] = await Promise.all([
    prisma.recipeVariant.findMany({
      where: {
        id: {
          in: personalPreferences
            .filter((preference) => preference.subjectType === "RECIPE_VARIANT")
            .map((preference) => preference.subjectId),
        },
        recipe: accessibleRecipeWhere(household.id),
      },
      include: { recipe: true },
    }),
    prisma.ingredient.findMany({
      where: {
        id: {
          in: personalPreferences
            .filter((preference) => preference.subjectType === "INGREDIENT")
            .map((preference) => preference.subjectId),
        },
      },
    }),
  ]);
  const personNameById = new Map(household.persons.map((person) => [person.id, person.name]));
  const personalVariantLabelById = new Map(
    personalVariants.map((variant) => [variant.id, variant.recipe.title])
  );
  const personalIngredientLabelById = new Map(
    personalIngredients.map((ingredient) => [ingredient.id, ingredient.name])
  );
  const personalPreferenceItems = personalPreferences.map((preference) => ({
    id: preference.id,
    personId: preference.ownerId,
    personName: personNameById.get(preference.ownerId) ?? "Onbekend gezinslid",
    subjectType: preference.subjectType,
    subjectId: preference.subjectId,
    subjectLabel: labelPersonalPreferenceSubject(preference, {
      variants: personalVariantLabelById,
      ingredients: personalIngredientLabelById,
    }),
    stance: preference.stance,
  }));

  const categoryStanceById = new Map(
    preferences
      .filter((p) => p.subjectType === "RECIPE_CATEGORY")
      .map((preference) => [preference.subjectId, preference.stance])
  );

  const productPreferences = await prisma.householdProductPreference.findMany({
    where: { householdId: household.id },
    include: { ingredient: true, product: true },
    orderBy: { lastChosenAt: "desc" },
  });

  const variantPrefs = preferences
    .filter((p) => p.subjectType === "RECIPE_VARIANT" && p.source === "INFERRED")
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 10);
  const learnedVariants = await prisma.recipeVariant.findMany({
    where: {
      id: { in: variantPrefs.map((p) => p.subjectId) },
      recipe: accessibleRecipeWhere(household.id),
    },
    include: { recipe: true },
  });
  const stanceByVariantId = new Map(variantPrefs.map((p) => [p.subjectId, p.stance]));

  const rhythm = (household.weeklyRhythm ?? {}) as Partial<Record<DayKey, "busy" | "quiet">>;
  const productChoicePreference = productChoicePreferenceFromDeliveryPreference(household.deliveryPreference);

  return (
    <div className="mx-auto flex min-h-screen w-full min-w-0 max-w-2xl flex-col pb-[calc(6rem+env(safe-area-inset-bottom))]">
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
        {statusMessage && (
          <p className="mb-4 rounded-lg border border-tag-green-ink/20 bg-tag-green-bg px-3 py-2 text-sm font-medium text-tag-green-ink">
            {statusMessage}
          </p>
        )}
        {errorMessage && (
          <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
            {errorMessage}
          </p>
        )}
        <p className="mb-6 text-[15px] text-ink-muted">
          Ik leer steeds beter wat bij jullie past.
        </p>

        <h2 className="mb-3 text-sm font-semibold text-ink">Gezinsleden</h2>
        <div className="mb-8 grid gap-3">
          {household.persons.map((person) => (
            <PersonPreferencesCard
              key={person.id}
              householdId={household.id}
              person={{
                id: person.id,
                name: person.name,
                role: person.role,
                hardRestrictions: Array.isArray(person.hardRestrictions)
                  ? (person.hardRestrictions as string[])
                  : [],
                defaultPresent: person.defaultPresent,
                portionMultiplier: person.portionMultiplier,
                presenceOverrides: person.presenceOverrides,
              }}
            />
          ))}
          <AddPersonForm householdId={household.id} />
        </div>

        <PersonalPreferencesManager householdId={household.id} preferences={personalPreferenceItems} />

        <LearnedPatternsPanel householdId={household.id} />

        <details className="mb-8 min-w-0 rounded-xl border border-line bg-surface p-4">
          <summary className="cursor-pointer font-medium text-ink">Jullie vaste gerechten per dag</summary>
          <div className="mt-4">
            <DayRecipePreferencesManager householdId={household.id} />
          </div>
        </details>

        <h2 className="mb-3 text-sm font-semibold text-ink">Picnic</h2>
        <PicnicConnection
          householdId={household.id}
          connected={Boolean(household.picnicAuthToken)}
          pendingTwoFactor={Boolean(household.picnicPendingAuthToken)}
          status={params.status}
        />

        <details className="mb-8 mt-4 min-w-0 rounded-xl border border-line bg-surface p-4">
          <summary className="cursor-pointer font-medium text-ink">Gewenst bezorgmoment</summary>
          <div className="mt-4">
            <PicnicDeliveryPreferenceForm
              householdId={household.id}
              preference={household.picnicDeliveryPreference}
              picnicConnected={Boolean(household.picnicAuthToken)}
            />
          </div>
        </details>

        <h2 className="mb-3 mt-8 text-sm font-semibold text-ink">Meldingen</h2>
        <div className="mb-8 min-w-0 rounded-xl border border-line bg-surface p-4">
          <p className="mb-3 text-sm text-ink-muted">
            Ik stuur hoogstens één rustige herinnering per dag, alleen tussen 08:00 en 21:00, en
            nooit twee keer over hetzelfde.
          </p>
          <PushNotificationSettings
            householdId={household.id}
            vapidPublicKey={process.env.WEB_PUSH_PUBLIC_KEY ?? null}
            initialPreferences={notificationPreferences}
          />
        </div>

        <details className="mb-8 min-w-0 rounded-xl border border-line bg-surface p-4">
          <summary className="flex cursor-pointer items-center gap-2 font-medium text-ink">
            <Heart size={16} className="text-tag-pink-ink" />
            Favorieten en eetstijl
          </summary>
          <div className="mt-4">
            <p className="mb-3 text-sm text-ink-muted">
              Dit stuurt welke gerechten ik eerder voorstel. Je kunt dit altijd aanpassen.
            </p>
            <div className="grid gap-3">
              {Object.entries(CATEGORY_LABELS).map(([category, label]) => {
                const currentStance = categoryStanceById.get(category) ?? "UNKNOWN";
                return (
                  <div key={category} className="grid gap-2 rounded-lg border border-line p-3">
                    <p className="text-sm font-medium text-ink">{label}</p>
                    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                      {CATEGORY_STANCE_OPTIONS.map((option) => (
                        <form key={option.value} action={updateHouseholdCategoryPreference}>
                          <input type="hidden" name="householdId" value={household.id} />
                          <input type="hidden" name="category" value={category} />
                          <input type="hidden" name="stance" value={option.value} />
                          <button
                            type="submit"
                            className={`w-full rounded-md border px-2 py-1.5 text-xs font-medium transition-colors hover:border-accent/70 hover:bg-surface-2 ${
                              currentStance === option.value
                                ? "border-accent bg-accent/10 text-accent"
                                : "border-line text-ink-muted"
                            }`}
                          >
                            {option.label}
                          </button>
                        </form>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </details>

        <details className="mb-8 min-w-0 rounded-xl border border-line bg-surface p-4">
          <summary className="flex cursor-pointer items-center gap-2 font-medium text-ink">
            <ShoppingBag size={16} className="text-tag-blue-ink" />
            Onthouden Picnic-producten
            <span className="text-xs font-normal text-ink-faint">
              {productPreferences.length === 0 ? "nog niets" : `${productPreferences.length}`}
            </span>
          </summary>
          <div className="mt-4">
            <p className="mb-3 text-sm text-ink-muted">
              Deze producten gebruik ik automatisch opnieuw bij dezelfde ingrediënten.
            </p>
            {productPreferences.length === 0 ? (
              <p className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-ink-muted">
                Nog niets onthouden. Dit groeit vanzelf wanneer je producten bevestigt op Controle.
              </p>
            ) : (
              <div className="flex min-w-0 flex-col divide-y divide-line rounded-lg border border-line">
                {productPreferences.map((preference) => (
                  <div key={preference.id} className="flex min-w-0 items-center justify-between gap-3 p-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">{preference.ingredient.name}</p>
                      <p className="truncate text-xs text-ink-muted">
                        {preference.product.name}
                        {preference.product.packageSize ? ` · ${preference.product.packageSize}` : ""}
                        {` · ${preference.timesChosen}x gekozen`}
                      </p>
                    </div>
                    <form action={forgetProductPreference} className="shrink-0">
                      <input type="hidden" name="householdId" value={household.id} />
                      <input type="hidden" name="preferenceId" value={preference.id} />
                      <button
                        type="submit"
                        aria-label={`${preference.product.name} vergeten`}
                        title="Niet meer onthouden"
                        className="rounded-lg border border-line p-2 text-ink-faint transition-colors hover:border-red-300 hover:bg-red-50 hover:text-red-700"
                      >
                        <Trash2 size={14} />
                      </button>
                    </form>
                  </div>
                ))}
              </div>
            )}
          </div>
        </details>

        <details className="mb-8 min-w-0 rounded-xl border border-line bg-surface p-4">
          <summary className="cursor-pointer font-medium text-ink">Productkeuze</summary>
          <form action={updateProductChoicePreference} className="mt-4">
            <input type="hidden" name="householdId" value={household.id} />
            <p className="mb-3 text-sm text-ink-muted">
              Als er nog geen vaste productvoorkeur is, gebruik ik deze voorkeur om kandidaten te rangschikken.
            </p>
            <div className="grid gap-2">
              {PRODUCT_CHOICE_PREFERENCES.map((preference) => (
                <label
                  key={preference}
                  className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm transition-colors hover:border-accent/70 hover:bg-surface-2 ${
                    productChoicePreference === preference ? "border-accent bg-accent/10" : "border-line"
                  }`}
                >
                  <input
                    type="radio"
                    name="productChoicePreference"
                    value={preference}
                    defaultChecked={productChoicePreference === preference}
                    className="mt-0.5 h-4 w-4 accent-accent"
                  />
                  <span className="min-w-0">
                    <span className="block font-medium text-ink">{PRODUCT_CHOICE_LABELS[preference]}</span>
                    <span className="block text-xs text-ink-faint">
                      {preference === "LOW_PRICE"
                        ? "Bij twijfel liever een voordeliger product."
                        : preference === "KNOWN_PACKAGE"
                          ? "Bij twijfel liever een product waarvan de verpakking goed te berekenen is."
                          : "Eerst eerdere keuzes, daarna beschikbaarheid, verpakking en lichte prijs-tiebreak."}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            <button type="submit" className="mt-3 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-ink hover:bg-accent/90">
              Productkeuze opslaan
            </button>
          </form>
        </details>

        <details className="mb-8 min-w-0 rounded-xl border border-line bg-surface p-4">
          <summary className="cursor-pointer font-medium text-ink">Jullie weekritme</summary>
          <div className="mt-4">
            <WeeklyRhythmEditor householdId={household.id} initialRhythm={rhythm} />
          </div>
        </details>

        <details className="mb-8 min-w-0 rounded-xl border border-line bg-surface p-4">
          <summary className="cursor-pointer font-medium text-ink">Planningsstijl</summary>
          <p className="mt-2 text-sm text-ink-muted">Hoeveel nieuwe gerechten wil je per week zien?</p>
          <div className="mt-4">
            <PlanningStyleEditor householdId={household.id} initialPlanningStyle={household.planningStyle} />
          </div>
        </details>

        <details className="mb-8 min-w-0 rounded-xl border border-line bg-surface p-4">
          <summary className="cursor-pointer font-medium text-ink">Inloggegevens</summary>
          <form action={updateCredentials} className="mt-4 flex min-w-0 flex-col gap-2">
            <input type="hidden" name="householdId" value={household.id} />
            <p className="mb-1 text-sm text-ink-muted">
              Gebruik deze gebruikersnaam en dit wachtwoord om dit huishouden op een ander apparaat te openen.
            </p>
            <input
              type="text"
              name="username"
              minLength={3}
              required
              autoComplete="username"
              placeholder={household.username ? "Nieuwe gebruikersnaam" : "Gebruikersnaam instellen"}
              className="min-w-0 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
            />
            <input
              type="password"
              name="password"
              minLength={6}
              required
              autoComplete="new-password"
              placeholder={household.username ? "Nieuw wachtwoord" : "Wachtwoord instellen"}
              className="min-w-0 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
            />
            <button
              type="submit"
              className="mt-1 w-fit shrink-0 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-ink"
            >
              Opslaan
            </button>
          </form>
        </details>

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
