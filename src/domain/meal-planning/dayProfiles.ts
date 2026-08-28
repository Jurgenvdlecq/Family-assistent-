import type { MealTag } from "@/domain/meal-tags/mealTags";

/**
 * Dagprofielen: wat voor soort maaltijd past er op een bepaalde avond.
 *
 * Bewust een register in code en geen enum en geen tabel.
 *
 * - **Geen enum**: dan zou elk nieuw profiel een databasemigratie zijn,
 *   terwijl een profiel niets anders is dan een naam voor een bundel
 *   scoringscriteria.
 * - **Geen tabel**: er is (nog) geen scherm waarin een huishouden zijn eigen
 *   profiel samenstelt. Een lege beheertabel bouwen zou een belofte zijn die
 *   nergens wordt ingelost. Kiezen uit deze lijst kan wél — dat is precies
 *   wat een dagregel doet.
 *
 * De criteria leunen op de bestaande `MEAL_TAGS`, zodat een profiel gebruikt
 * wat de app al over een gerecht weet in plaats van een tweede,
 * parallelle beschrijving van hetzelfde.
 */
export interface DayProfileDefinition {
  key: string;
  /** Zoals het in de app getoond wordt. */
  label: string;
  /** Eén zin die uitlegt wanneer je dit kiest. */
  description: string;
  /** Eigenschappen die op deze avond juist gewenst zijn. */
  desiredTags: MealTag[];
  /** Eigenschappen die hier minder passen. Nooit een harde uitsluiting. */
  avoidTags: MealTag[];
  /**
   * Er eten alleen volwassenen mee. Kindgerichte gerechten scoren dan wat
   * lager — niet omdat ze fout zijn, maar omdat ze gekozen zouden worden
   * voor iemand die er niet is.
   */
  adultOnly: boolean;
  /**
   * De maaltijd op deze dag ligt vast en mag niet automatisch variëren.
   * De planner slaat de scoring dan over.
   */
  fixed: boolean;
  /** Mogen gezinsleden op deze avond verschillende dingen eten? (werkpakket D) */
  allowSplitMeal: boolean;
  /** Mag een gerecht ingrediënten bevatten die je elders haalt? (werkpakket D) */
  allowExternalIngredients: boolean;
  /** Geef voorrang aan maaltijden die volledig via Picnic te bestellen zijn. */
  preferPicnicComplete: boolean;
}

function profile(
  key: string,
  label: string,
  description: string,
  overrides: Partial<Omit<DayProfileDefinition, "key" | "label" | "description">>
): DayProfileDefinition {
  return {
    key,
    label,
    description,
    desiredTags: [],
    avoidTags: [],
    adultOnly: false,
    fixed: false,
    allowSplitMeal: false,
    allowExternalIngredients: true,
    preferPicnicComplete: false,
    ...overrides,
  };
}

const PROFILE_LIST: DayProfileDefinition[] = [
  profile(
    "BUSY_EARLY_REHEATABLE",
    "Druk, vroeg eten",
    "Er moet vroeg gegeten worden en niet iedereen is tegelijk thuis — makkelijk en op te warmen.",
    {
      desiredTags: ["FAST", "LOW_EFFORT", "LEFTOVER_FRIENDLY", "KID_FRIENDLY"],
      // NORMAL_EFFORT komt van een "vers koken"-variant — precies wat er op
      // een avond met twee trainingen niet in past.
      avoidTags: ["EXTENSIVE", "NORMAL_EFFORT"],
    }
  ),
  profile("FAMILY_AVG_ROTATION", "Aardappel, groente, vlees", "De vertrouwde AVG-avond, met afwisseling in de onderdelen.", {
    desiredTags: ["AVG", "KID_FRIENDLY"],
    avoidTags: ["EXTENSIVE"],
    preferPicnicComplete: true,
  }),
  profile("ADULT_RICE_CHICKEN", "Rijst met kip", "Een rijstgerecht voor twee volwassenen, met variatie in de rest.", {
    desiredTags: ["RICE", "CHICKEN"],
    adultOnly: true,
  }),
  profile(
    "ADULT_TAKEAWAY_REPLACEMENT",
    "In plaats van bestellen",
    "Aantrekkelijk en snel klaar, bedoeld als alternatief voor eten bestellen.",
    {
      desiredTags: ["FAST", "LOW_EFFORT", "WORLD_FOOD", "COMFORT"],
      avoidTags: ["EXTENSIVE", "NORMAL_EFFORT"],
      adultOnly: true,
      allowSplitMeal: true,
      preferPicnicComplete: true,
    }
  ),
  profile("ADULT_EASY", "Makkelijk, met z'n tweeën", "Een eenvoudige maaltijd voor twee volwassenen.", {
    desiredTags: ["LOW_EFFORT", "HEALTHY"],
    avoidTags: ["EXTENSIVE"],
    adultOnly: true,
  }),
  profile("FAMILY_EASY", "Makkelijk, met het gezin", "Iets simpels waar iedereen blij van wordt.", {
    desiredTags: ["LOW_EFFORT", "KID_FRIENDLY", "COMFORT"],
    avoidTags: ["EXTENSIVE", "NORMAL_EFFORT"],
    allowSplitMeal: true,
  }),
  profile("ADULT_FLEX", "Vrij invullen", "Geen vast idee — iets makkelijks, en iedereen mag iets anders.", {
    desiredTags: ["LOW_EFFORT"],
    adultOnly: true,
    allowSplitMeal: true,
  }),
  profile("FIXED", "Vaste maaltijd", "Deze avond ligt vast en varieert niet vanzelf.", {
    fixed: true,
  }),
];

export const DAY_PROFILES: Record<string, DayProfileDefinition> = Object.fromEntries(
  PROFILE_LIST.map((definition) => [definition.key, definition])
);

export const DAY_PROFILE_KEYS = PROFILE_LIST.map((definition) => definition.key);

/** `null` bij een onbekende sleutel — de planner valt dan terug op gewone scoring. */
export function dayProfile(key: string | null | undefined): DayProfileDefinition | null {
  if (!key) return null;
  return DAY_PROFILES[key] ?? null;
}

export function isDayProfileKey(value: unknown): value is string {
  return typeof value === "string" && value in DAY_PROFILES;
}
