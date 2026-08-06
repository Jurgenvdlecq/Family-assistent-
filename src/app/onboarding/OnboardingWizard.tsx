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

type Rhythm = Record<string, "busy" | "quiet">;
type OnboardingMode = "QUICK" | "DETAILED";
type PlanningStyle = "SAFE" | "BALANCED" | "ADVENTUROUS";

const PLANNING_STYLES: { value: PlanningStyle; label: string; description: string }[] = [
  { value: "SAFE", label: "Veilig", description: "Meer bekende en bewezen gerechten." },
  { value: "BALANCED", label: "Gebalanceerd", description: "Bekend genoeg, met af en toe iets nieuws." },
  { value: "ADVENTUROUS", label: "Nieuwsgierig", description: "Meer ruimte voor proberen en variatie." },
];

export default function OnboardingWizard() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [onboardingMode, setOnboardingMode] = useState<OnboardingMode>("QUICK");
  const [planningStyle, setPlanningStyle] = useState<PlanningStyle>("BALANCED");
  const [householdName, setHouseholdName] = useState("");
  const [persons, setPersons] = useState<OnboardingPersonInput[]>([
    { name: "", role: "PARENT", hardRestrictions: [] },
  ]);
  const [rhythm, setRhythm] = useState<Rhythm>(
    Object.fromEntries(DAYS.map((d) => [d.key, "quiet"])) as Rhythm
  );
  const [categories, setCategories] = useState<string[]>([]);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const totalSteps = onboardingMode === "DETAILED" ? 7 : 5;
  const finalStep = totalSteps;

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
    if (step === finalStep) return username.trim().length >= 3 && password.length >= 6;
    return true;
  }

  function goNext() {
    setError(null);
    if (!canGoNext()) {
      setError("Vul dit veld in om verder te gaan.");
      return;
    }
    setStep((s) => Math.min(s + 1, totalSteps));
  }

  function goBack() {
    setError(null);
    setStep((s) => Math.max(s - 1, 1));
  }

  function handleSubmit() {
    setError(null);
    if (password !== confirmPassword) {
      setError("Wachtwoorden komen niet overeen. Controleer beide velden.");
      return;
    }
    startTransition(async () => {
      try {
        const result = await completeOnboarding({
          householdName,
          onboardingMode,
          planningStyle,
          persons,
          weeklyRhythm: rhythm,
          preferredCategories: onboardingMode === "DETAILED" ? categories : [],
          username,
          password,
        });
        if ("error" in result) {
          setError(result.error);
          return;
        }
        router.push("/onboarding/picnic");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Er ging iets mis. Probeer het opnieuw.");
      }
    });
  }

  return (
    <div className="mx-auto flex min-h-screen w-full min-w-0 max-w-xl flex-col justify-center px-6 py-12">
      <div className="mb-8">
        <p className="mb-2 font-mono text-xs uppercase tracking-wide text-accent">
          Stap {step} van {totalSteps}
        </p>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
          <div
            className="h-full rounded-full bg-accent transition-all"
            style={{ width: `${(step / totalSteps) * 100}%` }}
          />
        </div>
      </div>

      {step === 1 && (
        <div>
          <h1 className="mb-2 text-3xl font-semibold text-ink">Welkom bij Family Assistant</h1>
          <p className="mb-8 text-ink-muted">
            Kies hoe veel je nu wilt invullen. Kort starten betekent dat de app meer leert uit jullie eerste weken.
          </p>
          <div className="grid gap-3">
            {[
              {
                value: "QUICK" as const,
                label: "Snel starten",
                description: "Een paar basisvragen, daarna maakt de app een veilige eerste week.",
              },
              {
                value: "DETAILED" as const,
                label: "Beter afstemmen",
                description: "Iets meer smaak en ritme invullen, zodat de eerste planning minder correctie nodig heeft.",
              },
            ].map((mode) => (
              <button
                key={mode.value}
                type="button"
                onClick={() => setOnboardingMode(mode.value)}
                className={`rounded-xl border p-4 text-left transition-colors ${
                  onboardingMode === mode.value
                    ? "border-accent bg-accent-soft text-accent"
                    : "border-line bg-surface text-ink hover:border-ink-faint"
                }`}
              >
                <span className="block font-semibold">{mode.label}</span>
                <span className="mt-1 block text-sm text-ink-muted">{mode.description}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {step === 2 && (
        <div>
          <h2 className="mb-2 text-2xl font-semibold text-ink">Hoe heet jullie gezin?</h2>
          <p className="mb-6 text-ink-muted">
            Dit gebruiken we om jullie planning te herkennen.
          </p>
          <input
            autoFocus
            type="text"
            value={householdName}
            onChange={(e) => setHouseholdName(e.target.value)}
            placeholder="Bijvoorbeeld: Familie Van der Lecq"
            className="w-full min-w-0 rounded-lg border border-line bg-surface px-4 py-3 text-base text-ink outline-none focus:border-accent"
          />
        </div>
      )}

      {step === 3 && (
        <div>
          <h2 className="mb-2 text-2xl font-semibold text-ink">Wie horen er bij het gezin?</h2>
          <p className="mb-6 text-ink-muted">
            Voeg gezinsleden toe. Allergieën of dingen die iemand nooit eet zijn optioneel.
          </p>
          <div className="flex flex-col gap-4">
            {persons.map((person, i) => (
              <div key={i} className="min-w-0 rounded-xl border border-line bg-surface p-4">
                <div className="mb-3 flex min-w-0 gap-2">
                  <input
                    type="text"
                    value={person.name}
                    onChange={(e) => updatePerson(i, { name: e.target.value })}
                    placeholder="Naam"
                    className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-ink outline-none focus:border-accent"
                  />
                  <select
                    value={person.role}
                    onChange={(e) =>
                      updatePerson(i, { role: e.target.value as OnboardingPersonInput["role"] })
                    }
                    className="shrink-0 rounded-lg border border-line bg-surface px-3 py-2 text-ink"
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
                      className="shrink-0 px-2 text-ink-faint hover:text-red-500"
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
                  className="w-full min-w-0 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
                />
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={addPerson}
            className="mt-4 text-sm font-medium text-accent hover:opacity-80"
          >
            + Nog een gezinslid toevoegen
          </button>
        </div>
      )}

      {step === 4 && (
        <div>
          <h2 className="mb-2 text-2xl font-semibold text-ink">Hoe ziet jullie week eruit?</h2>
          <p className="mb-6 text-ink-muted">
            Geef aan welke dagen druk zijn — daar houden we rekening mee bij de planning.
          </p>
          <div className="flex flex-col gap-2">
            {DAYS.map((day) => (
              <div key={day.key} className="flex min-w-0 items-center justify-between">
                <span className="text-sm font-medium text-ink">{day.label}</span>
                <div className="flex shrink-0 gap-1 rounded-lg bg-surface-2 p-1">
                  {(["quiet", "busy"] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setRhythm((prev) => ({ ...prev, [day.key]: value }))}
                      className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                        rhythm[day.key] === value
                          ? "bg-accent text-accent-ink"
                          : "text-ink-muted hover:text-ink"
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

      {onboardingMode === "DETAILED" && step === 5 && (
        <div>
          <h2 className="mb-2 text-2xl font-semibold text-ink">Waar houden jullie van?</h2>
          <p className="mb-6 text-ink-muted">Kies wat vaak bij jullie op tafel komt.</p>
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
                      ? "border-accent bg-accent-soft text-accent"
                      : "border-line text-ink hover:border-ink-faint"
                  }`}
                >
                  {cat.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {onboardingMode === "DETAILED" && step === 6 && (
        <div>
          <h2 className="mb-2 text-2xl font-semibold text-ink">Hoe mag de app beginnen?</h2>
          <p className="mb-6 text-ink-muted">
            Dit is geen harde regel. De app gebruikt het als startpunt en leert daarna bij.
          </p>
          <div className="grid gap-3">
            {PLANNING_STYLES.map((style) => {
              const selected = planningStyle === style.value;
              return (
                <button
                  key={style.value}
                  type="button"
                  onClick={() => setPlanningStyle(style.value)}
                  className={`rounded-xl border p-4 text-left transition-colors ${
                    selected
                      ? "border-accent bg-accent-soft text-accent"
                      : "border-line bg-surface text-ink hover:border-ink-faint"
                  }`}
                >
                  <span className="block font-semibold">{style.label}</span>
                  <span className="mt-1 block text-sm text-ink-muted">{style.description}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {step === finalStep && (
        <div>
          <h2 className="mb-2 text-2xl font-semibold text-ink">Klaar om te beginnen</h2>
          <p className="mb-6 text-ink-muted">
            Kies een gebruikersnaam en wachtwoord voor dit huishouden. Daarmee blijft jullie
            planning gescheiden van andere huishoudens op dezelfde app.
          </p>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            minLength={3}
            autoComplete="username"
            placeholder="Gebruikersnaam (minimaal 3 tekens)"
            className="mb-3 w-full min-w-0 rounded-lg border border-line bg-surface px-4 py-3 text-base text-ink outline-none focus:border-accent"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={6}
            autoComplete="new-password"
            placeholder="Wachtwoord (minimaal 6 tekens)"
            className="mb-3 w-full min-w-0 rounded-lg border border-line bg-surface px-4 py-3 text-base text-ink outline-none focus:border-accent"
          />
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
            placeholder="Bevestig wachtwoord"
            className="mb-1 w-full min-w-0 rounded-lg border border-line bg-surface px-4 py-3 text-base text-ink outline-none focus:border-accent"
          />
          <p className="mb-4 text-xs text-ink-muted">
            Bewaar dit wachtwoord goed — er is nog geen manier om het te herstellen als je het kwijtraakt.
          </p>
          <div className="mb-6 min-w-0 rounded-xl border border-line bg-surface p-4 text-sm">
            <p className="mb-1 text-ink">
              <span className="font-medium">Gezin:</span> {householdName || "—"}
            </p>
            <p className="mb-1 text-ink">
              <span className="font-medium">Gezinsleden:</span>{" "}
              {persons.filter((p) => p.name.trim()).map((p) => p.name).join(", ") || "—"}
            </p>
            <p className="text-ink">
              <span className="font-medium">Voorkeuren:</span>{" "}
              {onboardingMode === "DETAILED" && categories.length > 0
                ? categories
                    .map((c) => CATEGORIES.find((cat) => cat.value === c)?.label)
                    .join(", ")
                : onboardingMode === "QUICK"
                  ? "snel starten"
                  : "geen gekozen"}
            </p>
            <p className="mt-1 text-ink">
              <span className="font-medium">Startstijl:</span>{" "}
              {PLANNING_STYLES.find((style) => style.value === planningStyle)?.label}
            </p>
          </div>
          <div className="min-w-0 rounded-xl border border-tag-green-ink/25 bg-tag-green-bg p-4">
            <p className="mb-3 text-sm font-medium text-tag-green-ink">
              Ik denk dat ik genoeg weet voor een eerste voorstel
            </p>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isPending || (confirmPassword.length > 0 && password !== confirmPassword)}
              className="w-full rounded-lg bg-accent px-4 py-3 font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {isPending ? "Bezig..." : "Maak mijn eerste week"}
            </button>
          </div>
        </div>
      )}

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {step < finalStep && (
        <div className="mt-8 flex justify-between">
          <button
            type="button"
            onClick={goBack}
            disabled={step === 1}
            className="rounded-lg px-4 py-2 text-sm font-medium text-ink-muted hover:text-ink disabled:opacity-0"
          >
            Terug
          </button>
          <button
            type="button"
            onClick={goNext}
            className="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-accent-ink hover:opacity-90"
          >
            Volgende
          </button>
        </div>
      )}
    </div>
  );
}
