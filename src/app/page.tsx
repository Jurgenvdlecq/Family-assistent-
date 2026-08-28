import { redirect } from "next/navigation";

/**
 * De startpagina van de app is sinds de koerswijziging "boodschappen eerst"
 * de boodschappenlijst, niet meer het weekmenu (dat staat nu op `/week`).
 *
 * Deze route blijft bewust bestaan als vaste voordeur: bestaande bladwijzers,
 * het pictogram op een telefoonstartscherm en alle plekken in de app die na
 * inloggen of onboarding naar "/" sturen, komen zo altijd op de juiste plek
 * uit. Eén plek bepaalt dus wat "thuis" is — verandert dat ooit, dan hoeft
 * alleen deze regel mee.
 *
 * De navigatiebalk linkt rechtstreeks naar `/boodschappen`, zodat het
 * dagelijkse gebruik geen extra doorverwijzing kost.
 */
export default async function HomePage() {
  redirect("/boodschappen");
}
