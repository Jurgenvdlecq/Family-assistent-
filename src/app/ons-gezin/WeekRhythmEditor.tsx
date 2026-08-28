import { DAY_KEYS, DAY_LABELS, DAY_ENUM, type DayKey } from "@/lib/week";
import { DAY_PROFILES, DAY_PROFILE_KEYS } from "@/domain/meal-planning/dayProfiles";
import { WEEK_PARITIES, type WeekParity } from "@/domain/week/isoWeek";
import { saveDayPresence, saveMealDayRule } from "./weekRhythmActions";

const PARITY_LABELS: Record<WeekParity, string> = {
  EVERY: "Elke week",
  ODD: "Oneven weken",
  EVEN: "Even weken",
};

export interface WeekRhythmRule {
  dayOfWeek: string;
  weekParity: WeekParity;
  profileKey: string;
  mealTemplateId: string | null;
}

export interface WeekRhythmPerson {
  id: string;
  name: string;
  defaultPresent: boolean;
  presenceOverrides: { dayOfWeek: string; weekParity: WeekParity; present: boolean }[];
}

export interface WeekRhythmTemplate {
  id: string;
  name: string;
}

function ruleFor(rules: WeekRhythmRule[], dayKey: DayKey, parity: WeekParity) {
  return rules.find((rule) => rule.dayOfWeek === DAY_ENUM[dayKey] && rule.weekParity === parity) ?? null;
}

/**
 * Eet deze persoon mee op deze weekdag in deze weeksoort?
 *
 * Zelfde volgorde als in de planner (`isPersonPresentOnDate`), maar dan zonder
 * datum: eerst de regel voor déze weeksoort, dan die voor elke week, dan de
 * standaard. Zo laat het formulier precies zien wat er daadwerkelijk gaat
 * gelden — niet wat er toevallig in de tabel staat.
 */
function isPresent(person: WeekRhythmPerson, dayKey: DayKey, parity: WeekParity) {
  const forDay = person.presenceOverrides.filter((override) => override.dayOfWeek === DAY_ENUM[dayKey]);
  return (
    forDay.find((override) => override.weekParity === parity)?.present ??
    (parity === "EVERY" ? undefined : forDay.find((override) => override.weekParity === "EVERY")?.present) ??
    person.defaultPresent
  );
}

function DayParityBlock({
  householdId,
  dayKey,
  parity,
  rules,
  persons,
  templates,
}: {
  householdId: string;
  dayKey: DayKey;
  parity: WeekParity;
  rules: WeekRhythmRule[];
  persons: WeekRhythmPerson[];
  templates: WeekRhythmTemplate[];
}) {
  const rule = ruleFor(rules, dayKey, parity);
  const presentCount = persons.filter((person) => isPresent(person, dayKey, parity)).length;

  return (
    <div className="rounded-lg border border-line bg-bg p-3">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
        {PARITY_LABELS[parity]} · {presentCount} {presentCount === 1 ? "eter" : "eters"}
      </p>

      <form action={saveMealDayRule} className="flex flex-col gap-2">
        <input type="hidden" name="householdId" value={householdId} />
        <input type="hidden" name="dayKey" value={dayKey} />
        <input type="hidden" name="weekParity" value={parity} />

        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          Soort avond
          <select
            name="profileKey"
            defaultValue={rule?.profileKey ?? ""}
            className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
          >
            <option value="">Geen voorkeur — laat de app kiezen</option>
            {DAY_PROFILE_KEYS.map((key) => (
              <option key={key} value={key}>
                {DAY_PROFILES[key].label}
              </option>
            ))}
          </select>
        </label>

        {templates.length > 0 && (
          <label className="flex flex-col gap-1 text-xs text-ink-muted">
            Samengestelde maaltijd
            <select
              name="mealTemplateId"
              defaultValue={rule?.mealTemplateId ?? ""}
              className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
            >
              <option value="">Geen — kies een gerecht</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <button
          type="submit"
          className="self-start rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink hover:opacity-90"
        >
          Bewaar deze avond
        </button>
      </form>

      <form action={saveDayPresence} className="mt-3 border-t border-line pt-3">
        <input type="hidden" name="householdId" value={householdId} />
        <input type="hidden" name="dayKey" value={dayKey} />
        <input type="hidden" name="weekParity" value={parity} />
        <p className="mb-1.5 text-xs text-ink-muted">Wie eet er mee?</p>
        <div className="flex flex-wrap gap-2">
          {persons.map((person) => (
            <label
              key={person.id}
              className="flex items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink"
            >
              <input
                type="checkbox"
                name="presentPersonId"
                value={person.id}
                defaultChecked={isPresent(person, dayKey, parity)}
                className="accent-[var(--color-accent,currentColor)]"
              />
              {person.name}
            </label>
          ))}
        </div>
        <button
          type="submit"
          className="mt-2 rounded-md border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface-2"
        >
          Bewaar wie er mee-eet
        </button>
      </form>
    </div>
  );
}

/**
 * Het weekritme: per weekdag wat voor soort avond het is en wie er mee-eet,
 * eventueel verschillend in oneven en even weken.
 *
 * Bewust één keer invullen en daarna niets meer: dit scherm bestaat juist
 * zodat de gebruiker niet elke week opnieuw hoeft aan te geven wie er
 * mee-eet en wat voor maaltijd erbij past.
 *
 * De oneven/even-blokken staan achter een eigen uitklap: de meeste dagen zijn
 * elke week hetzelfde, en drie identieke blokken per dag zou het scherm
 * onleesbaar maken voor het geval dat het gewoon niet wisselt.
 */
export default function WeekRhythmEditor({
  householdId,
  rules,
  persons,
  templates,
}: {
  householdId: string;
  rules: WeekRhythmRule[];
  persons: WeekRhythmPerson[];
  templates: WeekRhythmTemplate[];
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <p className="text-xs text-ink-muted">
        Vul dit één keer in. Daarna stelt de app elke week zelf een passende week voor, en hoef je alleen nog te
        veranderen wat niet klopt.
      </p>

      {DAY_KEYS.map((dayKey) => {
        const hasParityRules = WEEK_PARITIES.some(
          (parity) => parity !== "EVERY" && ruleFor(rules, dayKey, parity) !== null
        );
        const hasParityPresence = persons.some((person) =>
          person.presenceOverrides.some(
            (override) => override.dayOfWeek === DAY_ENUM[dayKey] && override.weekParity !== "EVERY"
          )
        );
        const everyWeekRule = ruleFor(rules, dayKey, "EVERY");

        return (
          <details
            key={dayKey}
            id={`ritme-${dayKey}`}
            className="min-w-0 scroll-mt-6 rounded-xl border border-line bg-surface p-3"
          >
            <summary className="cursor-pointer text-sm font-medium text-ink">
              {DAY_LABELS[dayKey]}
              <span className="ml-2 text-xs font-normal text-ink-faint">
                {everyWeekRule ? DAY_PROFILES[everyWeekRule.profileKey]?.label ?? "Eigen instelling" : "Geen voorkeur"}
                {hasParityRules || hasParityPresence ? " · wisselt per week" : ""}
              </span>
            </summary>

            <div className="mt-3 flex flex-col gap-3">
              <DayParityBlock
                householdId={householdId}
                dayKey={dayKey}
                parity="EVERY"
                rules={rules}
                persons={persons}
                templates={templates}
              />

              <details open={hasParityRules || hasParityPresence}>
                <summary className="cursor-pointer text-xs text-ink-muted">
                  Wisselt deze dag per week? (oneven / even)
                </summary>
                <div className="mt-2 flex flex-col gap-3">
                  {(["ODD", "EVEN"] as const).map((parity) => (
                    <DayParityBlock
                      key={parity}
                      householdId={householdId}
                      dayKey={dayKey}
                      parity={parity}
                      rules={rules}
                      persons={persons}
                      templates={templates}
                    />
                  ))}
                </div>
              </details>
            </div>
          </details>
        );
      })}
    </div>
  );
}
