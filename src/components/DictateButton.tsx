"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Mic, Square } from "lucide-react";

/**
 * Je lijstje inspreken in plaats van intikken.
 *
 * De aanleiding is de winkel: je bedenkt daar wat je nodig hebt, en dan is
 * tikken op een telefoon met een mandje in je andere hand het probleem.
 *
 * Twee dingen die deze knop bewust *niet* doet:
 *
 * - Hij verschijnt niet als de browser geen spraakherkenning heeft. Een knop
 *   die je kunt indrukken en die dan niets doet is erger dan geen knop; op een
 *   telefoon zonder ondersteuning staat de microfoon van het toetsenbord er
 *   trouwens gewoon nog, en die werkt in ditzelfde tekstvak.
 * - Hij verstuurt niets zelf. Wat je inspreekt komt in het tekstvak te staan,
 *   je leest het na, en jíj drukt op zoeken. Spraakherkenning verstaat je
 *   geregeld verkeerd, en dan wil je dat zien vóór er producten in je mandje
 *   belanden — niet erna.
 *
 * De herkenning zelf gebeurt door de browser (op iOS en Android betekent dat:
 * bij Apple respectievelijk Google). Daarom staat dat er ook bij.
 */

/**
 * De browserkant van spraakherkenning is nooit gestandaardiseerd geraakt: er
 * is `SpeechRecognition` en de oudere `webkitSpeechRecognition`, en TypeScript
 * kent geen van beide. Dit is het stukje dat we er werkelijk van gebruiken.
 */
interface SpeechResultAlternative {
  transcript: string;
}
interface SpeechResult {
  0: SpeechResultAlternative;
  isFinal: boolean;
}
interface SpeechResultList {
  length: number;
  [index: number]: SpeechResult;
}
interface SpeechEvent {
  resultIndex: number;
  results: SpeechResultList;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((event: SpeechEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function speechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const candidate = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return candidate.SpeechRecognition ?? candidate.webkitSpeechRecognition ?? null;
}

/**
 * Wat er misging, in gewone taal.
 *
 * "not-allowed" is verreweg de meest voorkomende en heeft een concrete
 * oplossing; de rest vatten we samen zonder te doen alsof we het precies
 * weten.
 */
function describeError(error: string): string {
  if (error === "not-allowed" || error === "service-not-allowed") {
    return "Geen toegang tot de microfoon. Sta dat toe in je browserinstellingen, of tik het gewoon in.";
  }
  if (error === "no-speech") return "Ik hoorde niets. Probeer het nog eens.";
  return "Het luisteren ging mis. Tik het anders in — dat werkt precies hetzelfde.";
}

/**
 * Of deze browser spraakherkenning heeft, gelezen op de manier die React
 * daarvoor bedoeld heeft.
 *
 * Op de server bestaat `window` niet, dus daar is het antwoord altijd "nee" —
 * en zonder die aparte server-momentopname zou het eerste renderen anders zijn
 * dan het tweede. Dit verandert nooit tijdens het gebruik, dus er valt niets
 * te abonneren.
 */
const NEVER_CHANGES = () => () => {};
const supportedNow = () => speechRecognitionConstructor() !== null;
const supportedOnServer = () => false;

export default function DictateButton({
  targetId,
  spokenFlagId,
}: {
  targetId: string;
  spokenFlagId?: string;
}) {
  const supported = useSyncExternalStore(NEVER_CHANGES, supportedNow, supportedOnServer);
  const [listening, setListening] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  // Stoppen met luisteren zodra dit scherm verdwijnt; een microfoon die
  // doorloopt terwijl je iets anders doet is precies wat niemand wil.
  useEffect(() => () => recognitionRef.current?.stop(), []);

  if (!supported) return null;

  function appendToField(text: string) {
    const field = document.getElementById(targetId) as HTMLTextAreaElement | null;
    if (!field) return;
    const trimmed = text.trim();
    if (!trimmed) return;
    // Met een komma ertussen, want dat is precies waarop de lijst gesplitst
    // wordt. Zonder scheidingsteken zou alles wat je na een adempauze zegt aan
    // het vorige product vastplakken.
    const existing = field.value.trim();
    field.value = existing ? `${existing}, ${trimmed}` : trimmed;
    // Zodat React en de browser meekrijgen dat dit veld veranderd is.
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.focus();
    markAsSpoken();
  }

  /**
   * Vertellen dat deze tekst gesproken is.
   *
   * Wie praat zegt geen komma's: "melk brood hagelslag" komt er als één zin
   * uit. De app mag daar zelf regels van maken, maar alléén hier — iemand die
   * "drinkyoghurt framboos" intikt bedoelt één product, en dat mag niet uit
   * elkaar getrokken worden. Dit veldje is dat onderscheid.
   */
  function markAsSpoken() {
    if (!spokenFlagId) return;
    const flag = document.getElementById(spokenFlagId) as HTMLInputElement | null;
    if (flag) flag.value = "1";
  }

  function stop() {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setListening(false);
  }

  function start() {
    const Recognition = speechRecognitionConstructor();
    if (!Recognition) return;

    setProblem(null);
    const recognition = new Recognition();
    recognition.lang = "nl-NL";
    // Doorluisteren tot je zelf stopt: een boodschappenlijstje bestaat uit
    // meerdere stukjes met stiltes ertussen, en na elke stilte opnieuw moeten
    // tikken maakt het langzamer dan gewoon typen.
    recognition.continuous = true;
    // Alleen wat de browser als definitief beschouwt. Tussenresultaten zouden
    // half verstane woorden in het veld zetten die daarna weer veranderen.
    recognition.interimResults = false;

    recognition.onresult = (event) => {
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result.isFinal) appendToField(result[0].transcript);
      }
    };
    recognition.onerror = (event) => {
      setProblem(describeError(event.error));
      setListening(false);
      recognitionRef.current = null;
    };
    recognition.onend = () => {
      setListening(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  }

  return (
    <div className="grid gap-1">
      <button
        type="button"
        onClick={listening ? stop : start}
        aria-pressed={listening}
        className={`flex w-fit items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
          listening
            ? "border-tag-amber-ink/30 bg-tag-amber-bg text-tag-amber-ink"
            : "border-line text-ink hover:bg-surface-2"
        }`}
      >
        {listening ? <Square size={15} /> : <Mic size={15} />}
        {listening ? "Luisteren — tik om te stoppen" : "Spreek je lijstje in"}
      </button>
      {listening && (
        <p className="text-[11px] text-ink-muted">
          Noem gerust je hele lijstje achter elkaar — de app knipt het zelf in losse producten.
          Alles komt hierboven te staan; je zoekt zelf pas als het klopt.
        </p>
      )}
      {problem && <p className="text-[11px] text-tag-amber-ink">{problem}</p>}
      {!listening && !problem && (
        <p className="text-[11px] text-ink-faint">
          Je browser doet de herkenning — op een iPhone is dat Apple, op Android Google.
        </p>
      )}
    </div>
  );
}
