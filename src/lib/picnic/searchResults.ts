// Picnic's zoek-API geeft een diep geneste "pagina"-boomstructuur terug
// (dezelfde PML-tree als de officiële app gebruikt), geen platte lijst.
// Deze twee functies zijn een directe TypeScript-poort van
// `find_nodes_by_content` / `_extract_search_results` uit python-picnic-api2
// (Apache-2.0), zodat het zoekresultaat wél als eenvoudige lijst terugkomt.

type JsonRecord = Record<string, unknown>;

function isPlainObject(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDictIncluded(nodeDict: JsonRecord, filterDict: JsonRecord): boolean {
  for (const key of Object.keys(filterDict)) {
    if (!(key in nodeDict)) return false;
    const filterValue = filterDict[key];
    const nodeValue = nodeDict[key];
    if (isPlainObject(filterValue) && isPlainObject(nodeValue)) {
      if (!isDictIncluded(nodeValue, filterValue)) return false;
    } else if (filterValue !== null && nodeValue !== filterValue) {
      return false;
    }
  }
  return true;
}

function findNodesByContent(
  node: unknown,
  filter: JsonRecord,
  maxNodes = 10,
  acc: JsonRecord[] = []
): JsonRecord[] {
  if (acc.length >= maxNodes) return acc;

  if (isPlainObject(node)) {
    if (isDictIncluded(node, filter)) acc.push(node);
    for (const value of Object.values(node)) {
      if (isPlainObject(value)) {
        findNodesByContent(value, filter, maxNodes, acc);
      } else if (Array.isArray(value)) {
        for (const item of value) {
          if (isPlainObject(item)) findNodesByContent(item, filter, maxNodes, acc);
        }
      }
    }
  }

  return acc;
}

const SOLE_ARTICLE_ID_PATTERN = /"sole_article_id":"(\w+)"/;

export interface PicnicSearchResultItem {
  id?: string;
  name?: string;
  display_price?: number;
  price?: number;
  unit_quantity?: string;
  unit_quantity_sub?: string;
  image_id?: string;
  max_count?: number;
  sole_article_id?: string | null;
}

export function extractSearchResults(rawResults: unknown): PicnicSearchResultItem[] {
  const body = isPlainObject(rawResults) ? (rawResults.body as JsonRecord | undefined) : undefined;
  const child = body && isPlainObject(body.child) ? body.child : {};
  const nodes = findNodesByContent(child, { type: "SELLING_UNIT_TILE", sellingUnit: {} });

  return nodes.map((node) => {
    const sellingUnit = isPlainObject(node.sellingUnit) ? node.sellingUnit : {};
    const match = JSON.stringify(node).match(SOLE_ARTICLE_ID_PATTERN);
    return { ...sellingUnit, sole_article_id: match ? match[1] : null };
  });
}
