import { getCurrentHousehold } from "@/lib/auth";
import { logEvent, createCorrelationId } from "@/lib/logger";

// Sluit Fase 16 af: onverwachte fouten die alleen in de browser zichtbaar
// worden (React-renderfouten, of een server-actie/server-component-fout die
// hier alleen nog als tekst binnenkomt) belandden nooit in de gestructureerde
// server-logging — enkel als generieke Next.js-crashpagina voor de
// gebruiker. Deze route is bewust minimaal: geen validatielaag met Zod (dat
// zou overengineering zijn voor drie korte, altijd-afgeknotte tekstvelden),
// wél een harde lengtebeperking zodat een kapotte client nooit een grote
// payload kan sturen.
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(null, { status: 400 });
  }
  if (!body || typeof body !== "object") return new Response(null, { status: 400 });

  const { message, digest, path } = body as Record<string, unknown>;
  const household = await getCurrentHousehold().catch(() => null);

  logEvent({
    level: "error",
    area: "client_render",
    message: "Onverwachte fout opgevangen in de browser",
    correlationId: createCorrelationId(),
    meta: {
      householdId: household?.id,
      path: typeof path === "string" ? path.slice(0, 300) : undefined,
      digest: typeof digest === "string" ? digest.slice(0, 200) : undefined,
      errorMessage: typeof message === "string" ? message.slice(0, 500) : undefined,
    },
  });

  return new Response(null, { status: 204 });
}
