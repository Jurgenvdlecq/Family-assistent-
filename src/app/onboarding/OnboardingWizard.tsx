"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { completeOnboarding, type OnboardingPersonInput } from "./actions";

const DAYS: { key: string; label: string }[] = [
  { key: "monday", label: "Maandag" },
  { key: "tuesday", label: "Dinsdag" },
  { key: "wednesday", label: "Woensdag" },
  { key: "thursday", label: "Donderdag" },
  { key: "friday", label: "Vrijdag" },
  { key: "saturday", label: "Zaterdag" },
  { key: "sunday", label: "Zondag" },
];

const CATEGORIES: { value: string; label: string }[] = [
  { value: "PASTA", label: "Pasta" },
  { value: "WRAPS", label: "Wraps" },
  { value: "RICE_DISH", label: "Rijstgerechten" },
  { value: "ALL_VEGGIE_DAY", label: "Vegetarisch (AVG)" },
  { value: "QUICK_AND_EASY", label: "Snel & makkelijk" },
  { value: "COMFORT_FOOD", label: "Comfortfood" },
  { value: "AIRFRYER", label: "Airfryer" },
  { value: "OTHER", label: "Overig" },
];

const ROLE_LABELS: Record<OnboardingPersonInput["role"], string> = {
  PARENT: "Ouder",
  CHILD: "Kind",
  OTHER: "Anders",
};

const TOTAL_STEPS = 6;

type Rhythm = Record<string, "busy" | "quiet">;

export default function OnboardingWizard() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [householdName, setHouseholdName] = useState("");
  const [persons, setPersons] = useState<OnboardingPersonInput[]>([
    { name: "", role: "PARENT", hardRestrictions: [] },
  ]);
  const [rhythm, setRhythm] = useState<Rhythm>(
    Object.fromEntries(DAYS.map((d) => [d.key, "quiet"])) as Rhythm
  );
  const [categories, setCategories] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function updatePerson(index: number, patch: Partial<OnboardingPersonInput>) {
    setPersons((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  }

  function addPerson() {
    setPersons((prev) => [...prev, { name: "", role: "CHILD", hardRestrictions: [] }]);
  }

  function removePerson(index: number) {
    setPersons((prev) => prev.filter((_, i) => i !== index));
  }

  function toggleCategory(value: string) {
    setCategories((prev) =>
      prev.includes(value) ? prev.filter((c) => c !== value) : [...prev, value]
    );
  }

  function canGoNext(): boolean {
    if (step === 2) return householdName.trim().length > 0;
    if (step === 3) return persons.some((p) => p.name.trim().length > 0);
    return true;
  }

  function goNext() {
    setError(null);
    if (!canGoNext()) {
      setError("Vul dit veld in om verder te gaan.");
      return;
    }
    setStep((s) => Math.min(s + 1, TOTAL_STEPS));
  }

  function goBack() {
    setError(null);
    setStep((s) => Math.max(s - 1, 1));
  }

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      try {
        await completeOnboarding({
          householdName,
          persons,
          weeklyRhythm: rhythm,
          preferredCategories: categories,
        });
        router.push("/");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Er ging iets mis. Probeer het opnieuw.");
      }
    });
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6 py-12">
      <div className="mb-8">
        <p className="mb-2 font-mono text-xs uppercase tracking-wide text-orange-600">
          Stap {step} van {TOTAL_STEPS}
        </p>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
          <div
            className="h-full rounded-full bg-orange-500 transition-all"
            style={{ width: `${(step / TOTAL_STEPS) * 100}%` }}
          />
        </div>
      </div>

      {step === 1 && (
        <div>
          <h1 className="mb-2 text-3xl font-semibold">Welkom bij Family Assistant</h1>
          <p className="mb-8 text-neutral-600 dark:text-neutral-400">
            Een assistent die jullie helpt met maaltijden en boodschappen.
          </p>
          <div className="grid grid-cols-2 gap-3">
            {[
              "Bedenk wat jullie eten",
              "Houd rekening met drukke dagen",
              "Boodschappen voorbereiden",
              "Leer wat bij jullie past",
            ].map((label) => (
              <div
                key={label}
                className="rounded-xl border border-neutral-200 p-4 text-sm font-medium dark:border-neutral-800"
              >
                {label}
              </div>
            ))}
          </div>
        </div>
      )}

      {step === 2 && (
        <div>
          <h2 className="mb-2 text-2xl font-semibold">Hoe heet jullie gezin?</h2>
          <p className="mb-6 text-neutral-600 dark:text-neutral-400">
            Dit gebruiken we om jullie planning te herkennen.
          </p>
          <input
            autoFocus
            type="text"
            value={householdName}
            onChange={(e) => setHouseholdName(e.target.value)}
            placeholder="Bijvoorbeeld: Familie Van der Lecq"
            className="w-full rounded-lg border border-neutral-300 px-4 py-3 text-base outline-none focus:border-orange-500 dark:border-neutral-700 dark:bg-neutral-900"
          />
        </div>
      )}

      {step === 3 && (
        <div>
          <h2 className="mb-2 text-2xl font-semibold">Wie horen er bij het gezin?</h2>
          <p className="mb-6 text-neutral-600 dark:text-neutral-400">
            Voeg gezinsleden toe. Allergieën of dingen die iemand nooit eet zijn optioneel.
          </p>
          <div className="flex flex-col gap-4">
            {persons.map((person, i) => (
              <div
                key={i}
                className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800"
              >
                <div className="mb-3 flex gap-2">
                  <input
                    type="text"
                    value={person.name}
                    onChange={(e) => updatePerson(i, { name: e.target.value })}
                    placeholder="Naam"
                    className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 outline-none focus:border-orange-500 dark:border-neutral-700 dark:bg-neutral-900"
                  />
                  <select
                    value={person.role}
                    onChange={(e) =>
                      updatePerson(i, { role: e.target.value as OnboardingPersonInput["role"] })
                    }
                    className="rounded-lg border border-neutral-300 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
                  >
                    {Object.entries(ROLE_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                  {persons.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removePerson(i)}
                      className="px-2 text-neutral-400 hover:text-red-500"
                      aria-label="Verwijder gezinslid"
                    >
                      ✕
                    </button>
                  )}
                </div>
                <input
                  type="text"
                  value={person.hardRestrictions.join(", ")}
                  onChange={(e) =>
                    updatePerson(i, {
                      hardRestrictions: e.target.value
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                  placeholder="Allergieën of uitsluitingen (optioneel, gescheiden door komma)"
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-orange-500 dark:border-neutral-700 dark:bg-neutral-900"
                />
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={addPerson}
            className="mt-4 text-sm font-medium text-orange-600 hover:text-orange-700"
          >
            + Nog een gezinslid toevoegen
          </button>
        </div>
      )}

      {step === 4 && (
        <div>
          <h2 className="mb-2 text-2xl font-semibold">Hoe ziet jullie week eruit?</h2>
          <p className="mb-6 text-neutral-600 dark:text-neutral-400">
            Geef aan welke dagen druk zijn — daar houden we rekening mee bij de planning.
          </p>
          <div className="flex flex-col gap-2">
            {DAYS.map((day) => (
              <div key={day.key} className="flex items-center justify-between">
                <span className="text-sm font-medium">{day.label}</span>
                <div className="flex gap-1 rounded-lg bg-neutral-100 p-1 dark:bg-neutral-900">
                  {(["quiet", "busy"] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setRhythm((prev) => ({ ...prev, [day.key]: value }))}
                      className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                        rhythm[day.key] === value
                          ? "bg-orange-500 text-white"
                          : "text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
                      }`}
                    >
                      {value === "busy" ? "Druk" : "Rustig"}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {step === 5 && (
        <div>
          <h2 className="mb-2 text-2xl font-semibold">Waar houden jullie van?</h2>
          <p className="mb-6 text-neutral-600 dark:text-neutral-400">
            Kies wat vaak bij jullie op tafel komt.
          </p>
          <div className="grid grid-cols-2 gap-3">
            {CATEGORIES.map((cat) => {
              const selected = categories.includes(cat.value);
              return (
                <button
                  key={cat.value}
                  type="button"
                  onClick={() => toggleCategory(cat.value)}
                  className={`rounded-xl border p-4 text-left text-sm font-medium transition-colors ${
                    selected
                      ? "border-orange-500 bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-400"
                      : "border-neutral-200 hover:border-neutral-300 dark:border-neutral-800"
                  }`}
                >
                  {cat.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {step === 6 && (
        <div>
          <h2 className="mb-2 text-2xl font-semibold">Klaar om te beginnen</h2>
          <p className="mb-6 text-neutral-600 dark:text-neutral-400">
            We hebben genoeg om een eerste voorstel te maken. Je kunt dit later altijd aanpassen
            bij &ldquo;Ons gezin&rdquo;.
          </p>
          <div className="mb-6 rounded-xl border border-neutral-200 p-4 text-sm dark:border-neutral-800">
            <p className="mb-1">
              <span className="font-medium">Gezin:</span> {householdName || "—"}
            </p>
            <p className="mb-1">
              <span className="font-medium">Gezinsleden:</span>{" "}
              {persons.filter((p) => p.name.trim()).map((p) => p.name).join(", ") || "—"}
            </p>
            <p>
              <span className="font-medium">Voorkeuren:</span>{" "}
              {categories.length > 0
                ? categories
                    .map((c) => CATEGORIES.find((cat) => cat.value === c)?.label)
                    .join(", ")
                : "geen gekozen"}
            </p>
          </div>
          <div className="rounded-xl border border-green-200 bg-green-50 p-4 dark:border-green-900 dark:bg-green-950/30">
            <p className="mb-3 text-sm font-medium text-green-800 dark:text-green-400">
              Ik denk dat ik genoeg weet voor een eerste voorstel
            </p>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isPending}
              className="w-full rounded-lg bg-orange-500 px-4 py-3 font-medium text-white transition-colors hover:bg-orange-600 disabled:opacity-50"
            >
              {isPending ? "Bezig..." : "Maak mijn eerste week"}
            </button>
          </div>
        </div>
      )}

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {step < TOTAL_STEPS && (
        <div className="mt-8 flex justify-between">
          <button
            type="button"
            onClick={goBack}
            disabled={step === 1}
            className="rounded-lg px-4 py-2 text-sm font-medium text-neutral-500 hover:text-neutral-900 disabled:opacity-0 dark:hover:text-neutral-100"
          >
            Terug
          </button>
          <button
            type="button"
            onClick={goNext}
            className="rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-white"
          >
            Volgende
          </button>
        </div>
      )}
    </div>
  );
}
