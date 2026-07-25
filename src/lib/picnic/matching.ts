// Zoektermvarianten + fuzzy-score, geïnspireerd op de aanpak in de
// referentie-implementatie (picnic_boodschappen.py): Picnic's eigen
// zoekmachine geeft vaak niets terug bij lange, samengestelde namen, dus we
// vallen terug op eenvoudigere varianten. De score zelf is een eigen,
// simpelere benadering (Dice-coëfficiënt op bigrams + woord-overlap) in
// plaats van Python's difflib.SequenceMatcher, die niet 1-op-1 overzet.

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function bigrams(text: string): string[] {
  const compact = text.replace(/\s+/g, "");
  const result: string[] = [];
  for (let i = 0; i < compact.length - 1; i++) {
    result.push(compact.slice(i, i + 2));
  }
  return result;
}

function diceCoefficient(a: string, b: string): number {
  const bigramsA = bigrams(a);
  const bigramsB = bigrams(b);
  if (bigramsA.length === 0 || bigramsB.length === 0) {
    return bigramsA.length === bigramsB.length ? 1 : 0;
  }

  const remaining = new Map<string, number>();
  for (const bg of bigramsB) remaining.set(bg, (remaining.get(bg) ?? 0) + 1);

  let matches = 0;
  for (const bg of bigramsA) {
    const count = remaining.get(bg) ?? 0;
    if (count > 0) {
      matches += 1;
      remaining.set(bg, count - 1);
    }
  }

  return (2 * matches) / (bigramsA.length + bigramsB.length);
}

export function fuzzyScore(searchTerm: string, productName: string): number {
  const normSearch = normalize(searchTerm);
  const normProduct = normalize(productName);
  const ratio = diceCoefficient(normSearch, normProduct);

  const searchWords = new Set(normSearch.split(" ").filter(Boolean));
  const productWords = new Set(normProduct.split(" ").filter(Boolean));
  let wordMatch = 0;
  if (searchWords.size > 0) {
    let overlap = 0;
    for (const w of searchWords) if (productWords.has(w)) overlap += 1;
    wordMatch = overlap / searchWords.size;
  }

  return ratio * 0.7 + wordMatch * 0.3;
}

function simplifySearchTerm(name: string): string {
  const withoutParens = name.replace(/\([^)]*\)/g, "");
  return withoutParens.replace(/\s+/g, " ").trim();
}

export function searchTermVariants(name: string): string[] {
  const variants = [name];

  const simplified = simplifySearchTerm(name);
  if (simplified && simplified !== name) variants.push(simplified);

  const words = simplified.split(" ").filter(Boolean);
  if (words.length > 3) variants.push(words.slice(0, 3).join(" "));
  if (words.length > 2) variants.push(words.slice(0, 2).join(" "));

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const v of variants) {
    if (v && !seen.has(v)) {
      seen.add(v);
      unique.push(v);
    }
  }
  return unique;
}
