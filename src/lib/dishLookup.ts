import { contentWords } from "@/domain/pricing/storeMatch";

/**
 * "We eten pasta pesto" — een gerecht herkennen in het snelle lijstje.
 *
 * De aanleiding staat in het verzoek: je bent al met boodschappen bezig, weet
 * nog niet wat je gaat eten, en bedenkt het ter plekke. Dan wil je niet eerst
 * een weekmenu openen; je wilt zeggen wat je eet en de ingrediënten krijgen.
 *
 * **De regel is bewust streng: alle woorden, en niets anders.** Een gedeeltelijke
 * treffer zou "pasta" laten aanzien voor "Pasta Pesto" en dan krijg je een
 * handvol ingrediënten terwijl je één pak pasta wilde. Liever geen herkenning
 * dan de verkeerde: het gewone productzoeken blijft er gewoon naast staan, dus
 * een gemiste herkenning kost je een klik, een verkeerde kost je je lijstje.
 *
 * Dezelfde `contentWords` als de productmatcher, zodat "Pasta pesto (snel)" en
 * "pasta pesto" hetzelfde betekenen.
 */

export interface DishCandidate {
  id: string;
  title: string;
}

function fingerprint(value: string): string {
  return [...new Set(contentWords(value))].sort().join(" ");
}

/**
 * De gerechten die dit huishouden mag zien, opzoekbaar op hun woorden.
 *
 * Twee gerechten kunnen op dezelfde woorden uitkomen ("Pasta pesto" en "Pesto
 * pasta"). Dan is er geen goede keuze te maken en herkennen we liever niets —
 * anders zou het van de databasevolgorde afhangen welk recept je krijgt.
 */
export function dishIndex(recipes: DishCandidate[]): Map<string, DishCandidate | null> {
  const index = new Map<string, DishCandidate | null>();
  for (const recipe of recipes) {
    const key = fingerprint(recipe.title);
    if (!key) continue;
    index.set(key, index.has(key) ? null : recipe);
  }
  return index;
}

/**
 * Het gerecht bij deze regel, of `null` als het er geen is.
 *
 * `searchTerm` en niet de ruwe regel: de lijstparser heeft daar al aanloopjes
 * als "we hebben nog" en aantallen af gehaald, en dat is precies het werk dat
 * hier anders nog een keer zou moeten gebeuren.
 */
export function findDish(searchTerm: string, index: Map<string, DishCandidate | null>): DishCandidate | null {
  return index.get(fingerprint(searchTerm)) ?? null;
}
