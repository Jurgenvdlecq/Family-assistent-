/**
 * De keuze van componenten voor een samengestelde maaltijd.
 *
 * Twee harde eisen uit de opdracht:
 * - **Deterministisch.** Geen `Math.random()`. Dezelfde invoer geeft altijd
 *   dezelfde week — anders is "waarom staat dit er?" niet te beantwoorden en
 *   levert twee keer plannen twee verschillende weken op.
 * - **Uitlegbaar.** Elke keuze komt met een reden in gewone taal ("vorige keer
 *   was het broccoli, daarom nu sperziebonen").
 */

export interface ComponentOptionLike {
  id: string;
  name: string;
  ingredientId: string;
}

export interface ComponentGroupLike {
  id: string;
  role: string;
  name: string;
  sortOrder: number;
  options: ComponentOptionLike[];
}

export interface ComponentChoice {
  group: ComponentGroupLike;
  option: ComponentOptionLike;
  /** Waarom juist deze optie, in gewone taal. Leeg als er niets te kiezen viel. */
  reason: string | null;
}

export interface ChooseComponentsInput {
  groups: ComponentGroupLike[];
  /**
   * Opties die deze week al ergens anders gekozen zijn. Zwaarste straf: twee
   * keer dezelfde groente in één week is precies wat je niet wilt.
   */
  usedThisWeek: Set<string>;
  /**
   * Wanneer een optie voor het laatst gekozen is, als volgnummer: 0 = vorige
   * keer, 1 = de keer daarvoor. Ontbreekt de optie, dan is hij al lang niet
   * geweest en scoort hij juist goed.
   */
  recencyByOptionId: Map<string, number>;
}

/** Hoe ver terug het geheugen meetelt; daarna is een optie gewoon weer nieuw. */
const RECENCY_WINDOW = 6;

function scoreOption(
  option: ComponentOptionLike,
  input: ChooseComponentsInput
): { score: number; reason: string | null } {
  if (input.usedThisWeek.has(option.id)) {
    return { score: -100, reason: null };
  }
  const recency = input.recencyByOptionId.get(option.id);
  if (recency === undefined) {
    return { score: 20, reason: `${option.name} is al een tijd niet aan de beurt geweest` };
  }
  if (recency === 0) {
    return { score: -30, reason: null };
  }
  // Hoe langer geleden, hoe hoger: 1 keer terug telt licht negatief, 5 keer
  // terug is bijna weer nieuw.
  return { score: Math.min(recency, RECENCY_WINDOW) * 3 - 12, reason: null };
}

/**
 * Kiest per component één optie.
 *
 * Groepen zonder opties leveren geen keuze op — dat is geen fout maar een
 * onvolledig sjabloon, en de aanroeper moet daar zelf iets mee (bijvoorbeeld
 * terugvallen op een gewoon recept in plaats van een halve maaltijd te tonen).
 */
export function chooseComponents(input: ChooseComponentsInput): ComponentChoice[] {
  const chosen: ComponentChoice[] = [];
  // Binnen één maaltijd mag hetzelfde ingrediënt niet twee keer gekozen
  // worden (twee groentecomponenten die allebei op broccoli uitkomen).
  const takenIngredientIds = new Set<string>();
  const usedThisWeek = new Set(input.usedThisWeek);

  for (const group of [...input.groups].sort((a, b) => a.sortOrder - b.sortOrder || a.role.localeCompare(b.role))) {
    const available = group.options.filter((option) => !takenIngredientIds.has(option.ingredientId));
    if (available.length === 0) continue;

    const ranked = available
      .map((option) => ({ option, ...scoreOption(option, { ...input, usedThisWeek }) }))
      // Gelijke score: altijd dezelfde volgorde, anders is de planning niet
      // reproduceerbaar.
      .sort((a, b) => b.score - a.score || a.option.id.localeCompare(b.option.id));

    const best = ranked[0];
    chosen.push({ group, option: best.option, reason: best.reason });
    takenIngredientIds.add(best.option.ingredientId);
    usedThisWeek.add(best.option.id);
  }

  return chosen;
}

/**
 * Eén zin die uitlegt waarom deze samenstelling gekozen is. Noemt hooguit twee
 * onderdelen: een langere opsomming leest niemand meer.
 */
export function describeComponentChoice(templateName: string, choices: ComponentChoice[]): string {
  const reasons = choices.map((choice) => choice.reason).filter((reason): reason is string => reason !== null);
  if (reasons.length === 0) {
    return `${templateName} zoals jullie dat meestal doen.`;
  }
  return `${templateName}: ${reasons.slice(0, 2).join(", ")}.`;
}
