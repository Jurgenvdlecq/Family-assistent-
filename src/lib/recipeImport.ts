import dns from "node:dns/promises";

export interface ExtractedRecipe {
  title: string;
  ingredientLines: string[];
  instructions: string[];
}

const HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&lt;": "<",
  "&gt;": ">",
  "&nbsp;": " ",
};

function decodeCommonHtmlEntities(value: string): string {
  return value.replace(/&(amp|quot|#39|apos|lt|gt|nbsp);/g, (match) => HTML_ENTITIES[match] ?? match);
}

function collectJsonLdBlocks(html: string): unknown[] {
  const blocks: unknown[] = [];
  const scriptRegex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = scriptRegex.exec(html)) !== null) {
    try {
      blocks.push(JSON.parse(match[1].trim()));
    } catch {
      // Ongeldige/afgekapte JSON-LD-blokken worden overgeslagen, geen harde fout.
    }
  }
  return blocks;
}

function isRecipeType(value: unknown): boolean {
  if (typeof value === "string") return value.toLowerCase() === "recipe";
  if (Array.isArray(value)) return value.some(isRecipeType);
  return false;
}

function findRecipeNode(value: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > 6 || value === null || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findRecipeNode(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  const node = value as Record<string, unknown>;
  if (isRecipeType(node["@type"])) return node;
  if ("@graph" in node) return findRecipeNode(node["@graph"], depth + 1);
  return null;
}

function toStringArray(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      if (typeof item === "string") return [item];
      if (item && typeof item === "object") {
        const obj = item as Record<string, unknown>;
        if (typeof obj.text === "string") return [obj.text];
        if (Array.isArray(obj.itemListElement)) return toStringArray(obj.itemListElement);
      }
      return [];
    });
  }
  return [];
}

/**
 * Leest de schema.org/Recipe-data (JSON-LD) die de meeste receptensites al
 * standaard meeleveren voor Google's receptresultaten — geen HTML-scraping
 * van losse tekst, alleen deze machineleesbare, door de site zelf bedoelde
 * data. Geeft `null` terug als een pagina dit niet heeft; er wordt bewust
 * niet geraden op basis van vrije tekst.
 */
export function extractRecipeFromHtml(html: string): ExtractedRecipe | null {
  for (const block of collectJsonLdBlocks(html)) {
    const node = findRecipeNode(block);
    if (!node) continue;

    const title = typeof node.name === "string" ? decodeCommonHtmlEntities(node.name).trim() : "";
    const ingredientLines = toStringArray(node.recipeIngredient ?? node.ingredients)
      .map((line) => decodeCommonHtmlEntities(line).trim())
      .filter(Boolean);
    const instructions = toStringArray(node.recipeInstructions)
      .map((line) => decodeCommonHtmlEntities(line).trim())
      .filter(Boolean);

    if (title && ingredientLines.length > 0) {
      return { title, ingredientLines, instructions };
    }
  }
  return null;
}

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === "::1" || normalized === "::") return true;
  if (normalized.startsWith("fe80:") || normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (normalized.startsWith("::ffff:")) {
    const mapped = normalized.slice("::ffff:".length);
    if (mapped.includes(".")) return isPrivateIPv4(mapped);
  }
  return false;
}

/** Geëxporteerd voor tests — bepaalt of een opgelost IP-adres intern/privé is (SSRF-bescherming). */
export function isDisallowedAddress(ip: string): boolean {
  return ip.includes(":") ? isPrivateIPv6(ip) : isPrivateIPv4(ip);
}

type LookupFn = (hostname: string, options: { all: true }) => Promise<Array<{ address: string; family: number }>>;

/**
 * Staat alleen http(s)-links toe die naar een publiek adres wijzen — blokkeert
 * localhost, private ranges (10.x/172.16-31.x/192.168.x) en link-local
 * (169.254.x, inclusief het bekende cloud-metadata-adres 169.254.169.254).
 * Voorkomt dat de server via een kwaadaardige link zichzelf of interne
 * diensten benadert (SSRF) — bewust géén volledige DNS-rebinding-bescherming
 * (het opgeloste IP wordt niet vastgepind voor de daadwerkelijke fetch),
 * geaccepteerde beperking voor een kleinschalige huishoud-app.
 */
export async function assertPubliclyReachableUrl(rawUrl: string, lookup: LookupFn = dns.lookup): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Dit is geen geldige link.");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Alleen http(s)-links worden ondersteund.");
  }

  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".local")) {
    throw new Error("Deze link wijst niet naar een normale website.");
  }

  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    throw new Error("Kon deze link niet vinden op internet.");
  }

  if (addresses.length === 0 || addresses.some((entry) => isDisallowedAddress(entry.address))) {
    throw new Error("Deze link wijst niet naar een normale website.");
  }

  return url;
}

type FetchFn = typeof fetch;

/**
 * Haalt de pagina op en herhaalt de SSRF-check bij elke doorverwijzing —
 * een publieke link die intern doorstuurt zou anders alsnog de bescherming
 * in `assertPubliclyReachableUrl` omzeilen.
 */
export async function fetchRecipePageHtml(
  startUrl: URL,
  options: { lookup?: LookupFn; fetchImpl?: FetchFn } = {}
): Promise<string> {
  const lookup = options.lookup ?? dns.lookup;
  const fetchImpl = options.fetchImpl ?? fetch;

  let currentUrl = startUrl;
  for (let hop = 0; hop < 5; hop += 1) {
    const response = await fetchImpl(currentUrl, {
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; FamilyAssistantRecipeImport/1.0)",
        Accept: "text/html",
      },
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Kon de pagina niet ophalen (ongeldige doorverwijzing).");
      currentUrl = await assertPubliclyReachableUrl(new URL(location, currentUrl).toString(), lookup);
      continue;
    }

    if (!response.ok) {
      throw new Error(`Kon de pagina niet ophalen (status ${response.status}).`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) {
      throw new Error("Deze link lijkt geen webpagina met een recept te zijn.");
    }

    return response.text();
  }

  throw new Error("Te veel doorverwijzingen bij het ophalen van deze link.");
}
