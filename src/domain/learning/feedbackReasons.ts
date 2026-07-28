export const FEEDBACK_REASONS = [
  "NOT_TASTY",
  "NO_APPETITE_NOW",
  "TOO_MUCH_EFFORT",
  "TOO_REPETITIVE",
  "WRONG_DAY",
  "WRONG_PARTICIPANTS",
  "PRODUCT_WRONG",
  "ONLY_THIS_TIME",
  "ALWAYS_USE",
  "NEVER_USE",
  "COINCIDENCE",
] as const;

export type FeedbackReasonValue = (typeof FEEDBACK_REASONS)[number];

export const MEAL_REPLACEMENT_REASONS: { value: FeedbackReasonValue; label: string }[] = [
  { value: "ONLY_THIS_TIME", label: "Alleen nu iets anders" },
  { value: "NOT_TASTY", label: "Niet lekker genoeg" },
  { value: "TOO_MUCH_EFFORT", label: "Te veel werk vandaag" },
  { value: "TOO_REPETITIVE", label: "Te vaak gehad" },
  { value: "WRONG_DAY", label: "Past niet op deze dag" },
  { value: "WRONG_PARTICIPANTS", label: "Past niet bij wie mee-eet" },
  { value: "NO_APPETITE_NOW", label: "Nu geen trek in" },
];

export const MEAL_ACCEPTANCE_REASONS: { value: FeedbackReasonValue; label: string }[] = [
  { value: "ALWAYS_USE", label: "Vaker zo plannen" },
  { value: "WRONG_DAY", label: "Andere dag beter" },
  { value: "ONLY_THIS_TIME", label: "Alleen deze keer" },
  { value: "COINCIDENCE", label: "Toeval" },
];

export function parseFeedbackReason(value: FormDataEntryValue | null | undefined): FeedbackReasonValue | undefined {
  const raw = String(value ?? "");
  return FEEDBACK_REASONS.includes(raw as FeedbackReasonValue) ? (raw as FeedbackReasonValue) : undefined;
}

export function replacementPenaltyForReason(reason: FeedbackReasonValue | null | undefined): number {
  if (reason === "NOT_TASTY" || reason === "NEVER_USE") return 0.08;
  if (reason === "TOO_REPETITIVE") return 0.04;
  if (reason === "NO_APPETITE_NOW" || reason === "WRONG_DAY" || reason === "WRONG_PARTICIPANTS") return 0.02;
  if (reason === "TOO_MUCH_EFFORT" || reason === "ONLY_THIS_TIME" || reason === "COINCIDENCE") return 0;
  return 0.03;
}

export function labelFeedbackReason(reason: FeedbackReasonValue | null | undefined): string {
  return (
    MEAL_REPLACEMENT_REASONS.find((option) => option.value === reason)?.label ??
    MEAL_ACCEPTANCE_REASONS.find((option) => option.value === reason)?.label ??
    "Geen reden opgegeven"
  );
}
