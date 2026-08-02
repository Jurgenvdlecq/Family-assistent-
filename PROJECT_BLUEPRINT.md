<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

> **Gearchiveerd historisch document** (WP-vervolg, "context-/tokenefficiëntie" —
> zie `WORKFLOW.md`). Dit is het oorspronkelijke, gefaseerde bouwplan waarmee
> het project begon (Fase 0 t/m 17, plus het bijbehorende rapportageformat).
> Het grootste deel is inmiddels uitgevoerd — zie `PROGRESS.md` voor de
> actuele status. Dit bestand wordt niet meer automatisch geladen en stuurt
> niet meer actief; de nog wél actieve kernregels staan voortaan beknopt in
> `AGENTS.md`. Raadpleeg dit bestand alleen voor historische context, of als
> een van de oorspronkelijke fases (bijv. Fase 9 "weekplanning slimmer
> maken", Fase 12 "UX-polish") alsnog concreet relevant wordt.

# Family Assistant — productspecificatie / blueprint

Je werkt aan deze repository:

https://github.com/Jurgenvdlecq/Family-assistent-

Dit project wordt de definitieve app. De oudere repository Picnic-besteller is alleen nog een functionele referentie:

https://github.com/Jurgenvdlecq/Picnic-besteller

## Hoofddoel

Bouw Family Assistant verder uit tot een snelle, betrouwbare, professionele en gebruiksvriendelijke gezinsassistent voor:

* weekmenuplanning;
* recepten;
* boodschappen;
* vaste boodschappen;
* voorraadcontrole;
* productmatching;
* Picnic-integratie;
* geleerde voorkeuren;
* controle vóór het vullen van het winkelmandje.

Family Assistant blijft de hoofdapplicatie.

Picnic-besteller mag alleen worden gebruikt om bestaande werkende logica, flows en business rules te begrijpen. Neem niet de oude architectuur over.

De uiteindelijke app moet:

* snel laden;
* prettig werken op mobiel;
* weinig handmatige stappen vereisen;
* duidelijke feedback geven;
* betrouwbaar omgaan met hoeveelheden en verpakkingen;
* veilig omgaan met Picnic-authenticatie;
* eenvoudig te onderhouden en uit te breiden zijn;
* professioneel ogen;
* voorbereid zijn op meerdere huishoudens en gebruikers.

## Belangrijke uitgangspunten

### Behouden uit Family Assistant

Behoud en verbeter:

* Next.js;
* React;
* TypeScript;
* Prisma;
* PostgreSQL;
* server-side verwerking;
* het huidige relationele datamodel;
* de mobiele navigatiestructuur;
* de persoonlijke, rustige uitstraling;
* het werken met huishoudens, personen, recepten en feedback;
* de huidige indeling in week, gerechten, boodschappen, controle en gezin.

### Niet overnemen uit Picnic-besteller

Neem deze technische keuzes niet over:

* GitHub als database;
* GitHub-commits als opslag;
* GitHub Issues als consumentenmelding;
* GitHub personal access tokens in de browser;
* pincodebeveiliging in frontendcode;
* één groot JavaScriptbestand;
* globale handmatig gemanipuleerde state;
* directe DOM-manipulatie;
* tekstbestanden als primair datamodel;
* stil genegeerde fouten;
* GitHub Actions als algemene applicatiebackend.

### Wel overnemen uit Picnic-besteller

Migreer de goede productlogica:

* vaste boodschappen;
* voorraadcontrole;
* extra producten;
* productmatching;
* alternatieve producten kiezen;
* geleerde productvoorkeuren;
* twijfelgevallen eerst controleren;
* expliciete bevestiging;
* Picnic-mandje vullen;
* Picnic-mandje legen;
* feedback op gerechten;
* nooit stilzwijgend of ongecontroleerd bestellen.

## Werkwijze

Werk gefaseerd en zorgvuldig.

Voer niet direct grote wijzigingen uit zonder eerst de volledige codebase te begrijpen.

### Fase 0 — Volledige analyse

Analyseer eerst de volledige repository.

Bekijk minimaal:

* projectstructuur;
* package.json;
* Prisma-schema;
* migrations;
* seeddata;
* alle pagina's;
* layouts;
* componenten;
* server actions;
* API-routes;
* services;
* lib-bestanden;
* Picnic-integratie;
* meal-planning-logica;
* boodschappenlogica;
* feedbacklogica;
* styling;
* environmentvariabelen;
* foutafhandeling;
* databasequeries;
* laadstatussen;
* mobiele interface;
* toegankelijkheid;
* bestaande documentatie.

Bekijk daarna Picnic-besteller alleen als functionele referentie.

Inventariseer daar:

* welke gebruikersflows al werken;
* welke business rules bruikbaar zijn;
* hoe productvoorkeuren worden opgeslagen;
* hoe producten worden gezocht;
* hoe alternatieven worden gekozen;
* hoe het mandje wordt gevuld;
* hoe het mandje wordt geleegd;
* hoe gerechten worden beoordeeld;
* hoe vaste boodschappen en extra producten worden verwerkt.

Maak daarna eerst een analyseverslag met:

1. huidige architectuur;
2. sterke punten;
3. technische risico's;
4. ontbrekende functionaliteit;
5. mogelijke bugs;
6. securityrisico's;
7. performanceproblemen;
8. UX-problemen;
9. migratieonderdelen uit Picnic-besteller;
10. aanbevolen volgorde van uitvoering.

Verander in deze fase nog geen code.

### Fase 1 — Architectuur en codebasis stabiliseren

Breng eerst de codebasis in een duidelijke structuur.

Gebruik bij voorkeur een indeling zoals:

```
src/
  app/
  components/
  domain/
    household/
    recipes/
    meal-planning/
    groceries/
    product-matching/
    inventory/
    feedback/
    picnic/
  application/
    services/
    commands/
    queries/
  infrastructure/
    database/
    picnic/
    notifications/
    jobs/
  lib/
  types/
```

Pas deze structuur alleen toe waar dat werkelijk nuttig is. Vermijd onnodige abstracties.

Maak duidelijke applicatieservices, bijvoorbeeld:

```
generateWeeklyMealPlan()
buildShoppingList()
calculateRequiredPackages()
matchIngredientsToProducts()
reviewProductMatches()
recordRecipeFeedback()
updateProductPreference()
transferProductsToPicnic()
clearPicnicCart()
```

Zorg dat:

* pagina's geen ingewikkelde business logic bevatten;
* UI-componenten geen databasecode bevatten;
* Picnic-code losstaat van de gebruikersinterface;
* databasequeries gecentraliseerd en herbruikbaar zijn;
* fouten centraal en consistent worden afgehandeld;
* types niet onnodig worden gedupliceerd.

Controleer ook:

* ESLint;
* TypeScript strictness;
* ongebruikte code;
* duplicatie;
* lange bestanden;
* overbodige dependencies;
* onveilige environment handling.

Maak pas wijzigingen nadat je een concreet voorstel hebt beschreven.

### Fase 2 — Database en datamodel verbeteren

Controleer het bestaande Prisma-model.

Behoud de huidige kernmodellen, maar breid ze waar nodig uit.

**Productvoorkeuren**

Maak een betrouwbaar model voor productvoorkeuren per huishouden.

Het model moet minimaal kunnen onthouden:

* householdId;
* ingredientId;
* gekozen productId of external product reference;
* gekozen merk;
* gekozen verpakking;
* afgewezen productreferenties;
* aantal keren gekozen;
* laatste keuze;
* confidence;
* handmatig of automatisch gekozen;
* eventuele reden van correctie.

Denk bijvoorbeeld aan modellen als:

```
HouseholdProductPreference
ProductMatchDecision
RejectedProductMatch
```

Gebruik betekenisvolle namen en voorkom dat alles in vrije JSON wordt opgeslagen als relationele velden geschikter zijn.

**Voorraad**

Voeg een eenvoudig voorraadmodel toe.

Ondersteun minimaal:

* product of ingrediënt;
* hoeveelheid;
* eenheid;
* status;
* laatst bijgewerkt;
* optioneel houdbaarheid;
* huishouden.

Mogelijke statussen:

* voldoende;
* bijna op;
* niet in huis;
* onbekend.

Maak voorraad in de eerste versie eenvoudig. Bouw nog geen complex magazijnsysteem.

**Boodschappenregels**

Een boodschappenregel moet onderscheid maken tussen:

* benodigde recepthoeveelheid;
* eenheid;
* reeds op voorraad;
* netto benodigd;
* gekozen winkelproduct;
* verpakkingsgrootte;
* aantal verpakkingen;
* totaal gekocht;
* verwacht overschot;
* matchstatus;
* confidence;
* handmatige controle nodig.

Voorkom dat een verpakkingstekst zoals "500 gram" alleen als ongestructureerde string wordt gebruikt wanneer berekeningen nodig zijn.

### Fase 3 — Hoeveelheden en verpakkingen betrouwbaar maken

Dit is een kritieke fase.

Bouw één centrale quantity- en package-engine.

Deze moet minimaal omgaan met:

* gram;
* kilogram;
* milliliter;
* liter;
* stuks;
* verpakkingen;
* blikken;
* zakken;
* flessen;
* decimalen;
* meerdere recepten met hetzelfde ingrediënt;
* opschalen naar aantal personen;
* voorraad aftrekken;
* afronding naar hele verpakkingen.

Voorbeeld:

```
Receptbehoefte: 900 gram penne
Voorraad: 100 gram
Netto nodig: 800 gram
Verpakking: 500 gram
Te bestellen: 2 verpakkingen
Totaal gekocht: 1.000 gram
Verwacht over: 200 gram
```

Maak dit als pure, goed testbare functies.

Schrijf unit tests voor minimaal:

* hoeveelheid kleiner dan één verpakking;
* exact één verpakking;
* iets meer dan één verpakking;
* meerdere recepten gecombineerd;
* voorraad aftrekken;
* verschillende eenheden;
* ontbrekende verpakking;
* ongeldige data;
* decimalen;
* stuksproducten.

Geen enkele pagina mag zelf verpakkingsaantallen berekenen.

### Fase 4 — Boodschappenflow verbeteren

Bouw de boodschappenflow op in duidelijke stappen.

**Stap 1: automatisch samengesteld**

Toon:

* ingrediënten uit de gekozen gerechten;
* gecombineerde hoeveelheden;
* welke gerechten een ingrediënt gebruiken;
* receptbehoefte;
* netto benodigde hoeveelheid.

**Stap 2: aanvullen**

Voeg toe:

* vaste boodschappen;
* voorraadcontrole;
* extra producten.

**Vaste boodschappen**

Gebruik het bestaande concept uit Picnic-besteller:

* gebruikelijke boodschappen staan standaard aan;
* gebruiker schakelt alleen uit wat niet nodig is;
* hoeveelheden zijn aanpasbaar;
* wijzigingen kunnen als nieuwe standaard worden onthouden.

**Voorraadcontrole**

Vraag alleen naar producten die waarschijnlijk in huis kunnen zijn.

Bijvoorbeeld:

* olie;
* boter;
* kruiden;
* rijst;
* pasta;
* bloem;
* bouillon;
* sauzen.

Laat de app eerdere antwoorden onthouden.

**Extra producten**

Maak een snelle invoer mogelijk.

Ondersteun eerst gewone invoer en bouw de interface voorbereid op natuurlijke taal, zoals:

```
2 pakken cola zero, bananen en kattenvoer
```

Parse dit alleen automatisch wanneer dat betrouwbaar kan. Toon altijd wat de app heeft begrepen voordat het wordt toegevoegd.

### Fase 5 — Productmatching bouwen

Bouw productmatching als een afzonderlijk domein.

Een match moet minimaal rekening houden met:

* naam van ingrediënt;
* synoniemen;
* merkvoorkeur;
* productvoorkeur uit eerdere keuzes;
* verpakking;
* benodigde hoeveelheid;
* beschikbaarheid;
* prijs;
* afgewezen producten;
* categorie;
* eventuele dieetbeperkingen.

Geef iedere match:

* een score;
* een confidence;
* een reden;
* een status.

Mogelijke statussen:

```
MATCHED_TRUSTED
MATCHED_REVIEW_REQUIRED
NOT_FOUND
MANUALLY_SELECTED
UNAVAILABLE
```

Maak de score uitlegbaar.

Voorbeeld:

```
Gekozen omdat dit product:
- eerder 4 keer is gekozen;
- de juiste verpakking heeft;
- momenteel beschikbaar is;
- niet op de afwijslijst staat.
```

Gebruik geen ondoorzichtige willekeur.

### Fase 6 — Controlepagina opnieuw opbouwen

De controlepagina is een kernonderdeel.

Toon standaard eerst alleen:

**Aandacht nodig**

* twijfelachtige matches;
* nieuwe producten;
* onvoldoende verpakkingen;
* niet gevonden producten;
* producten met groot overschot;
* producten die afwijken van eerdere voorkeuren;
* niet-beschikbare voorkeursproducten.

Per regel toon je minimaal:

* ingrediënt;
* netto benodigde hoeveelheid;
* gekozen product;
* merk;
* verpakking;
* aantal verpakkingen;
* totaal gekocht;
* overschot;
* prijs;
* reden van keuze;
* confidence.

Acties:

* goedkeuren;
* ander product kiezen;
* aantal aanpassen;
* verwijderen;
* voorkeur onthouden;
* alleen deze week gebruiken.

**Vertrouwde keuzes**

Plaats automatisch goedgekeurde producten in een ingeklapte sectie.

Bijvoorbeeld:

```
28 vertrouwde keuzes
```

Laat de gebruiker deze wel openen en aanpassen.

**Niet gevonden**

Toon een aparte sectie met:

* opnieuw zoeken;
* handmatig product kiezen;
* zonder product doorgaan;
* van lijst verwijderen.

Gebruik niet alleen een algemene boodschap als "alles is automatisch goedgekeurd". Laat de gebruiker altijd kunnen begrijpen wat er is gekozen.

### Fase 7 — Picnic-integratie professionaliseren

De Picnic-integratie moet volledig server-side blijven.

Nooit:

* wachtwoord opslaan;
* token naar de browser sturen;
* authenticatiegegevens loggen;
* gevoelige data in client state zetten.

Maak een duidelijke Picnic-client of adapter:

```
PicnicClient
PicnicProductSearchService
PicnicCartService
PicnicAuthService
```

Ondersteun minimaal:

* geldige sessie controleren;
* producten zoeken;
* productdetails ophalen;
* beschikbaarheid controleren;
* mandje ophalen;
* product toevoegen;
* productaantal aanpassen;
* product verwijderen;
* mandje legen.

Bouw degelijke foutafhandeling voor:

* verlopen token;
* niet beschikbaar product;
* gewijzigd product-ID;
* time-out;
* rate limit;
* Picnic API gewijzigd;
* gedeeltelijk gevulde winkelwagen;
* netwerkfout.

Toon gebruikersvriendelijke meldingen.

Voorbeelden:

```
Je Picnic-sessie is verlopen. Koppel je account opnieuw.
3 producten konden niet worden toegevoegd. De overige 25 staan wel in je mandje.
```

Maak toevoeging aan het mandje idempotent waar mogelijk. Voorkom dubbele producten wanneer de gebruiker twee keer op dezelfde knop drukt.

### Fase 8 — Bevestigingsflow

Er mag nooit stilzwijgend een bestelling worden geplaatst.

Maak een duidelijke bevestigingsstap met:

* totaal aantal producten;
* verwacht totaalbedrag;
* producten met wijzigingen;
* producten die niet beschikbaar zijn;
* afwijkingen van voorkeuren;
* tijdstip laatste prijscontrole;
* knop om Picnic te openen;
* knop om producten in het mandje te plaatsen.

Belangrijk:

Family Assistant mag het winkelmandje vullen, maar niet zonder expliciete bevestiging definitief bestellen.

Voeg herstelopties toe:

* opnieuw proberen;
* alleen mislukte producten opnieuw toevoegen;
* mandje legen;
* lijst opnieuw opbouwen.

### Fase 9 — Weekplanning slimmer maken

De huidige planner kiest na filtering nog te willekeurig.

Vervang dit door een uitlegbare score.

Neem minimaal mee:

**Positieve signalen**

* voorkeur van huishouden;
* voorkeur van individuele gezinsleden;
* geschikt voor drukke dag;
* juiste bereidingstijd;
* kindvriendelijk;
* goede eerdere beoordeling;
* lang niet gegeten;
* ingrediënten deels op voorraad;
* beperkt voedseloverschot;
* past binnen weekbudget;
* goede variatie binnen de week.

**Negatieve signalen**

* recent gegeten;
* afgewezen door gezinslid;
* te lange bereidingstijd;
* te veel soortgelijke gerechten;
* te veel hetzelfde type vlees;
* veel ingrediënten nodig die niet op voorraad zijn;
* slecht beoordeeld;
* harde dieetbeperking;
* niet beschikbaar kernproduct.

Maak de score deterministic of gecontroleerd variabel.

Voorkom dat dezelfde input bij iedere page refresh een totaal ander resultaat geeft.

Sla voor iedere suggestie op:

* totale score;
* belangrijkste positieve redenen;
* belangrijkste negatieve redenen;
* confidence;
* welke regels zijn toegepast.

De uitleg voor de gebruiker moet specifiek zijn.

Niet:

```
Sluit aan bij jullie voorkeuren.
```

Wel:

```
Klaar in 20 minuten, geschikt voor jullie drukke dinsdag en Kai vond dit de vorige keer lekker.
```

### Fase 10 — Persoonlijke gezinslogica

Breid personen en huishoudens uit met praktische voorkeuren.

Ondersteun:

* wie per dag mee-eet;
* allergieën;
* harde dieetbeperkingen;
* afkeuren;
* favorieten;
* portiegrootte;
* kind of volwassene;
* maximale kooktijd per dag;
* drukke en rustige dagen;
* voorkeur voor vegetarisch;
* voorkeur voor herhaalbare gerechten;
* optioneel sport- of agenda-informatie.

Maak duidelijk onderscheid tussen:

* harde beperking;
* sterke afkeur;
* lichte voorkeur;
* favoriet.

Een allergie mag nooit worden behandeld als gewone negatieve voorkeur.

### Fase 11 — Feedbacksysteem verbeteren

Gebruik het bestaande feedbackmodel, maar maak het praktisch.

Ondersteun feedback zoals:

* lekker;
* prima;
* niet opnieuw;
* kinderen vonden het lekker;
* te veel werk;
* te duur;
* portie te klein;
* portie te groot;
* goed voor drukke dag;
* beter in weekend;
* productkeuze klopt;
* ander merk gewenst.

Voorkom dat één klik direct te grote permanente gevolgen heeft.

Bijvoorbeeld:

* één negatieve beoordeling verlaagt de score;
* meerdere negatieve beoordelingen kunnen een gerecht verbergen;
* gebruiker kan een verborgen gerecht herstellen.

Laat de app uitleggen wat hij leert.

Bijvoorbeeld:

```
Ik stel dit gerecht minder vaak voor omdat jullie het twee keer als te veel werk hebben beoordeeld.
```

### Fase 12 — UX en professionele uitstraling

Behoud de rustige uitstraling van Family Assistant.

Verbeter:

* consistente spacing;
* typografie;
* duidelijk onderscheid tussen primaire en secundaire acties;
* laadstatussen;
* foutmeldingen;
* lege states;
* bevestigingen;
* skeletons;
* mobiele touch targets;
* safe areas;
* toetsenbordgedrag;
* modals;
* toegankelijkheid;
* contrast;
* focus states;
* screenreaderlabels.

Gebruik per scherm één duidelijke primaire actie.

Voorkom:

* meerdere concurrerende hoofdbuttons;
* lange uitlegteksten;
* technische termen;
* dubbele informatie;
* herhaalde algemene redenen;
* onnodige instellingen op hoofdschermen.

Schrijf teksten alsof het een vriendelijke persoonlijke assistent is.

Niet:

```
Productmatching is uitgevoerd.
```

Wel:

```
Ik heb 28 producten voor je gevonden. Bij 3 keuzes wil ik graag dat je even meekijkt.
```

### Fase 13 — Performance

Analyseer en verbeter:

* aantal databasequeries per pagina;
* dubbele queries;
* N+1-problemen;
* caching;
* server component boundaries;
* onnodige clientcomponenten;
* grote JavaScriptbundles;
* onnodige rerenders;
* onnodige databasewrites;
* sequentiële async-acties;
* zware berekeningen tijdens page load.

Specifiek:

* voorkom onnodig schrijven naar de database bij een gewoon paginabezoek;
* gebruik transacties waar meerdere writes bij elkaar horen;
* gebruik upsert of conflict handling voor weekplannen;
* batch feedbackwrites waar mogelijk;
* voorkom race conditions bij het genereren van een weekplan;
* gebruik background jobs alleen wanneer dat echt nodig is.

Maak vóór en na belangrijke optimalisaties meetbaar:

* laadtijd;
* query-aantal;
* bundle size;
* server response time.

### Fase 14 — Security

Controleer minimaal:

* authenticatie;
* autorisatie;
* household isolation;
* server actions;
* API-routes;
* environmentvariabelen;
* tokens;
* logging;
* foutmeldingen;
* inputvalidatie;
* XSS;
* CSRF;
* SQL-injectie;
* mass assignment;
* rate limiting;
* gevoelige data in browser;
* gevoelige data in logs.

Een gebruiker mag nooit via een aangepast householdId data van een ander huishouden kunnen zien of wijzigen.

Valideer alle invoer server-side.

Gebruik eventueel Zod of een vergelijkbare compacte oplossing wanneer dit past bij de bestaande codebase.

### Fase 15 — Tests

Voeg tests toe op de belangrijkste business logic.

Minimaal unit tests voor:

* quantity conversions;
* package calculations;
* shopping-list aggregation;
* voorraad aftrekken;
* productmatch scoring;
* meal-plan scoring;
* voorkeuren;
* negatieve feedback;
* harde dieetbeperkingen;
* race-conditiongevoelige logica;
* idempotent mandje vullen.

Voeg integratietests toe voor:

* weekplan genereren;
* boodschappenlijst genereren;
* productmatch controleren;
* voorkeur opslaan;
* Picnic-fout afhandelen.

Voeg end-to-end tests toe voor de kritieke gebruikersflow:

1. onboarding;
2. weekmenu bekijken;
3. gerecht vervangen;
4. boodschappen opbouwen;
5. vaste boodschappen controleren;
6. voorraad aanpassen;
7. extra product toevoegen;
8. twijfelproduct corrigeren;
9. mandje vullen;
10. fout herstellen.

Gebruik mocks voor Picnic in tests. Tests mogen niet afhankelijk zijn van een live Picnic-account.

### Fase 16 — Monitoring en logging

Voeg gestructureerde logging toe voor:

* Picnic API-fouten;
* productmatching;
* mislukt vullen van mandje;
* verlopen sessies;
* databasefouten;
* weekplangeneratie;
* onverwachte hoeveelheidsdata.

Log nooit:

* wachtwoorden;
* volledige tokens;
* sessiecookies;
* persoonsgegevens die niet nodig zijn.

Geef iedere belangrijke operatie een correlation ID of vergelijkbare manier om fouten terug te vinden.

### Fase 17 — Migratie uit Picnic-besteller

Maak een aparte migratielijst.

Per functie uit Picnic-besteller vermeld je:

* oude bestandslocatie;
* doelgedrag;
* nieuwe locatie in Family Assistant;
* benodigde databasevelden;
* benodigde tests;
* status;
* eventuele verschillen.

Migreer functioneel, niet letterlijk.

Voorbeeld:

```
Oud:
app.js beheert standaardboodschappen in globale state.
Nieuw:
FixedGroceryService + Prisma-model + server action + React-component.
```

Migreer in deze volgorde:

1. vaste boodschappen;
2. extra producten;
3. voorraadcontrole;
4. productvoorkeuren;
5. productmatching;
6. alternatieven;
7. mandje vullen;
8. mandje legen;
9. gerechtfeedback;
10. herinneringen.

## Uitvoeringsregels

### Werk in kleine stappen

Voor iedere stap:

1. leg uit wat je gaat veranderen;
2. benoem welke bestanden worden geraakt;
3. benoem mogelijke risico's;
4. voer de wijziging uit;
5. voer linting en typecheck uit;
6. voer relevante tests uit;
7. controleer of bestaande functionaliteit blijft werken;
8. vat samen wat veranderd is.

### Houd de app werkend

Voorkom grote rewrites in één keer.

Gebruik zo nodig feature flags of tijdelijke adapters.

Verwijder oude code pas wanneer de nieuwe code:

* werkt;
* getest is;
* daadwerkelijk wordt gebruikt;
* geen regressies veroorzaakt.

### Geen schijnfunctionaliteit

Toon geen knoppen of teksten die meer beloven dan werkelijk werkt.

Wanneer een functie nog niet af is:

* verberg haar;
* markeer haar duidelijk als concept;
* of implementeer een eerlijke fallback.

### Kies eenvoud boven complexiteit

Gebruik geen ingewikkelde architectuur alleen omdat die professioneel klinkt.

Iedere abstractie moet een concreet probleem oplossen.

Vermijd:

* overengineering;
* te veel libraries;
* onnodige microservices;
* te veel generieke helpers;
* premature optimization.

## Gewenste output vóór uitvoering

Geef eerst een volledig rapport met:

### 1. Samenvatting huidige situatie

* architectuur;
* kwaliteit;
* grootste risico's;
* grootste kansen.

### 2. Gevonden problemen

Per probleem:

* ernst;
* bewijs uit code;
* gebruikersimpact;
* technische impact;
* aanbevolen oplossing.

Gebruik prioriteiten:

```
P0 — kritiek
P1 — belangrijk
P2 — verbetering
P3 — later
```

### 3. Doelarchitectuur

Beschrijf:

* mappenstructuur;
* domeinen;
* services;
* databasewijzigingen;
* Picnic-adapter;
* testingstrategie.

### 4. Migratieplan

Beschrijf exact welke onderdelen uit Picnic-besteller naar Family Assistant gaan.

### 5. Roadmap

Maak een uitvoerbare roadmap in werkpakketten.

Per werkpakket:

* doel;
* taken;
* afhankelijkheden;
* risico's;
* acceptatiecriteria;
* tests;
* verwachte gebruikersverbetering.

### 6. Eerste aanbevolen werkpakket

Kies daarna zelf het eerste werkpakket met de hoogste combinatie van:

* gebruikersimpact;
* technisch risico;
* fundamentele waarde;
* uitvoerbaarheid.

Begin nog niet automatisch aan alle fases tegelijk.

## Definitieve productrichting

Family Assistant moet uiteindelijk voelen als:

* een persoonlijke gezinsassistent;
* niet als een databasebeheerder;
* niet als een technische Picnic-tool;
* niet als een lange wizard;
* niet als een verzameling losse functies.

De gebruiker moet iedere week vooral dit ervaren:

1. de app stelt een passende week voor;
2. de gebruiker verandert alleen wat niet klopt;
3. de boodschappen worden automatisch samengesteld;
4. alleen twijfelgevallen vragen aandacht;
5. de gebruiker bevestigt;
6. de producten worden betrouwbaar in Picnic gezet;
7. de app leert van de correcties.

De beste eigenschappen van beide projecten moeten worden gecombineerd:

**Family Assistant:**
* architectuur;
* uitstraling;
* datamodel;
* persoonlijke benadering;
* uitbreidbaarheid.

**Picnic-besteller:**
* praktische winkelworkflow;
* productcontrole;
* vaste boodschappen;
* voorraad;
* productvoorkeuren;
* Picnic-mandje;
* expliciete bevestiging.

Behandel Picnic-besteller voortaan als een prototype en referentie.

Alle nieuwe structurele ontwikkeling gebeurt in Family Assistant.

Laat Claude eerst alleen de analyse, doelarchitectuur en roadmap opleveren. Daarna kun je hem per werkpakket laten uitvoeren; dat voorkomt dat hij in één grote wijziging te veel tegelijk ombouwt.
