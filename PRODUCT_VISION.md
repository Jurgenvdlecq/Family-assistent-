# Product Vision: Family Assistant

Dit document is het productkompas voor de Family Assistant. Gebruik het bij
elke nieuwe featurebeslissing, UX-aanpassing en datamodelkeuze. De app moet
niet steeds uitgebreider worden; hij moet steeds behulpzamer, slimmer en
makkelijker worden.

## Kernbelofte

**De app leert wat jullie eten en regelt de boodschappen.**

De gebruiker opent de app, logt in als huishouden, krijgt een passend
weekmenu voorgesteld, corrigeert waar nodig, en bevestigt uiteindelijk een
boodschappenlijst. De app leert uit normaal gebruik, zodat de gebruiker na
een paar weken steeds minder hoeft te kiezen, corrigeren en controleren.

## Doelgroep

De app is voor ieder huishouden dat minder wil nadenken over eten en
boodschappen:

- eenpersoonshuishoudens;
- stellen;
- gezinnen;
- samengestelde huishoudens;
- huishoudens met wisselende aanwezigheid of dieetwensen.

Gezinnen zijn de belangrijkste stresstest: zodra meerdere personen,
voorkeuren, porties, drukke dagen en productkeuzes meespelen, moet het
systeem nog steeds rustig en begrijpelijk blijven.

## Wat De App Wel En Niet Is

De app is:

- een zelflerende gezins- en boodschappenassistent;
- een weekmenu-assistent;
- een boodschappenvoorbereider;
- een voorkeuren- en patroonleerlaag per huishouden;
- een systeem dat onzekerheid expliciet maakt.

De app is niet:

- een recepten-database als hoofdproduct;
- een administratiepakket voor ingredienten;
- een tool waarin de gebruiker alles handmatig moet configureren;
- een systeem dat ongemerkt bestelt;
- een app die klakkeloos elk patroon als waarheid behandelt.

Beheerfuncties mogen bestaan, maar ze zijn secundair. Normaal gebruik moet de
belangrijkste leerbron zijn.

## Productprincipes

1. **De app stelt voor, de gebruiker corrigeert.**
   De startpositie is een voorstel, geen leeg formulier.

2. **De app leert voorzichtig.**
   Een enkele actie is een signaal, geen waarheid. Herhaling leidt tot een
   vraag of zachte conclusie.

3. **De app vraagt waarom bij patroonbreuk.**
   Als iets herhaald wordt vervangen, afgewezen of aangepast, moet de app
   vragen wat er niet klopt.

4. **Maximaal twee slimme vragen per sessie.**
   Buiten onboarding mag de app leren, maar niet zeuren.

5. **Stilte is feedback.**
   Als een weekmenu blijft staan en wordt bevestigd, telt dat als "goed
   genoeg". Niet als favoriet, wel als positief signaal.

6. **Hard is hard, zacht is zacht.**
   Allergie, dieet en expliciet "nooit" blokkeren. Zachte voorkeuren sturen
   score en uitleg, maar blokkeren niet automatisch.

7. **De app legt kort uit.**
   Bijvoorbeeld: "Snel gerecht, past bij maandag, eerder goed bevonden."

8. **Variatie mag soms minder perfect zijn.**
   Een goede week is niet zeven keer veilig. De app balanceert passend,
   praktisch, lekker en gevarieerd.

9. **Personalisatie is huishoud-specifiek.**
   Algemene slimme basis is gedeeld. Echte voorkeuren, patronen en
   productkeuzes horen bij een huishouden of persoon.

10. **Nooit bestellen zonder bevestiging.**
    Ook als alle producten vertrouwd zijn, moet de gebruiker expliciet
    bevestigen voordat iets naar Picnic gaat.

## De Leerlagen

De app leert op vier niveaus.

### 1. Expliciete Harde Informatie

Deze informatie moet betrouwbaar zijn en mag de app vroeg vragen:

- allergieen;
- dieet;
- ingredienten of producten die nooit mogen;
- aantal personen;
- porties;
- wie meestal mee-eet;
- harde persoonlijke beperkingen.

Deze informatie mag direct invloed hebben op filtering.

### 2. Expliciete Zachte Voorkeuren

Deze informatie is richtinggevend:

- favoriete keukens of categorieen;
- gewenste variatie;
- veilige versus avontuurlijke planning;
- drukke dagen;
- vaste boodschappen;
- voorkeur voor snelle, normale of uitgebreide gerechten.

Zachte voorkeuren mogen score en uitleg sturen, maar moeten niet te snel
hard worden.

### 3. Gedrag

De app leert uit wat de gebruiker doet:

- gerechten accepteren;
- gerechten vervangen;
- gerechten opnieuw kiezen;
- weekmenu bevestigen zonder wijzigingen;
- producten als standaard kiezen;
- producten alleen deze keer gebruiken;
- boodschappenregels verwijderen of aanpassen;
- nieuwe gerechten accepteren of afwijzen.

Gedrag is een signaal met onzekerheid. Het wordt sterker door herhaling.

### 4. Waarom-Signalen

Dit zijn de belangrijkste leersignalen. De app moet bij relevante momenten
korte vragen stellen zoals:

- Niet lekker;
- Wel lekker, maar nu geen zin;
- Te vaak gehad;
- Kost te veel tijd vandaag;
- Past niet bij wie mee-eet;
- Product klopt niet;
- Alleen deze keer;
- Voortaan altijd;
- Nooit meer.

Waarom-signalen maken onderscheid tussen smaak, context en praktische noodzaak.

## De Drie-Keer-Regel

Als de app hetzelfde type voorstel herhaald doet en de gebruiker corrigeert
het drie keer, vraagt de app waarom voordat hij een patroon aanneemt.

Voorbeeld:

- De app stelt drie keer pasta op maandag voor.
- De gebruiker vervangt dit drie keer.
- De app vraagt: "Ik merk dat pasta op maandag niet blijft staan. Wat klopt
  er niet?"

Mogelijke antwoorden:

- Niet lekker;
- Te vaak pasta;
- Maandag moet juist sneller;
- Maandag eten andere mensen mee;
- Gewoon toeval.

De app moet dit soort vragen spaarzaam gebruiken en maximaal twee slimme
vragen per sessie stellen.

## Tijd En Gedoe

De app gebruikt simpele, menselijke kooklabels. Minuten zijn minder belangrijk
dan mentale belasting.

- **Snel**
  Ongeveer tot 20-25 minuten actieve tijd, weinig snijwerk, weinig keuzes,
  geschikt voor drukke dagen.

- **Normaal**
  Ongeveer 25-45 minuten of een gewone doordeweekse maaltijd met wat
  voorbereiding.

- **Uitgebreid**
  Meer dan 45 minuten, veel stappen, meerdere onderdelen, of bewust koken.

De app moet uiteindelijk leren of een huishouden een dag als snel, normaal of
uitgebreid behandelt. Dat is persoonlijk.

## Algemene Slimme Basis Versus Personalisatie

### Algemene Slimme Basis

Deze basis geldt voor alle huishoudens:

- drukke dagen vragen meestal minder gedoe;
- recente herhaling is meestal minder wenselijk;
- een week moet enige variatie hebben;
- een nieuw gerecht is een experiment;
- een onbekend product of onbekende verpakking vraagt controle;
- "AVG" betekent grofweg aardappel/vlees-of-alternatief/groente;
- "snel" betekent weinig tijd en weinig mentale belasting;
- Picnic is de eerste boodschappenprovider, maar de boodschappenlijst moet
  provider-neutraal blijven.

### Huishoud-Personalisatie

Deze informatie hoort bij een specifiek huishouden:

- vaste boodschappen;
- standaardproducten;
- weekritme;
- porties;
- aanwezigheid;
- favoriete categorieen;
- geaccepteerde gerechten;
- afgewezen producten;
- hoe belangrijk gezondheid, variatie en gemak zijn.

### Persoons-Personalisatie

Deze informatie hoort bij een persoon:

- harde beperkingen;
- portiegrootte;
- aanwezigheid;
- persoonlijke favorieten;
- persoonlijke afkeur;
- ingredienten die iemand nooit wil.

Planning is huishouden-first, maar harde persoonlijke blokkades winnen altijd.

## Onboarding

Onboarding moet twee routes hebben.

### Snel Starten

Voor gebruikers die direct willen beginnen:

- 3-5 vragen;
- veilige eerste planning;
- meer leren via normaal gebruik.

Voorbeelden:

- Hoeveel mensen eten meestal mee?
- Zijn er harde beperkingen of allergieen?
- Welke dagen zijn vaak druk?
- Wil je veilig beginnen of nieuwe suggesties proberen?
- Zijn er vaste boodschappen die bijna altijd terugkomen?

### Beter Afstemmen

Voor gebruikers die minder correcties in de eerste weken willen:

- 8-12 lichte vragen;
- nog steeds als gesprek, niet als administratie;
- meer over ritme, smaak, boodschappen en producten.

De gebruiker moet later altijd kunnen aanvullen. Onboarding is een start, geen
verplichting om alles in te vullen.

## Eerste Week

Een nieuw huishouden mag niet met een leeg scherm beginnen. De eerste week
moet zo werken:

1. Korte onboarding.
2. De app maakt een veilige voorbeeldweek.
3. De gebruiker kan per dag makkelijk vervangen.
4. De app vraagt hooguit enkele waarom-vragen.
5. De app maakt een boodschappenlijst.
6. De gebruiker bevestigt altijd voordat er iets naar Picnic gaat.

Volledig automatisch zonder input is kwetsbaar. Volledig leeg is te veel werk.
De juiste start is: een redelijk voorstel dat makkelijk te corrigeren is.

## Nieuwe Gerechten

De app mag een echte assistent zijn en nieuwe gerechten voorstellen, niet
alleen kiezen uit bekende recepten.

Regels:

- De app mag nieuwe gerechten voorstellen op basis van vrije tekst of context.
- Nieuwe gerechten worden niet meteen vaste kennis.
- Een nieuw gerecht wordt pas opgeslagen of gepromoveerd na acceptatie,
  bereiding of positieve feedback.
- De app mag verrassen, maar niet de hele week gokken.
- Een goede standaard is maximaal een klein aantal nieuwe/probeer-gerechten
  per week, tenzij het huishouden anders kiest.

Voorbeeld:

Gebruiker: "We hebben trek in AVG met kip en sperziebonen."

De app:

- zoekt eerst passende bestaande gerechten;
- stelt eventueel een nieuw gerecht voor;
- toont kort waarom;
- vraagt na acceptatie of het recept bewaard mag worden.

## Gerechten Delen

Niet elk huishoudrecept mag automatisch bij andere huishoudens terechtkomen.
Dat zou de globale kwaliteit snel vervuilen.

Het systeem kent daarom drie lagen:

1. **Globale receptenbasis**
   Door de app of beheerder samengestelde basisrecepten.

2. **Huishoudrecepten**
   Prive recepten van een huishouden.

3. **Gepromoveerde community-recepten**
   Recepten die door veel huishoudens gebruikt of positief beoordeeld zijn en
   daarna gecontroleerd/gepromoveerd worden.

Standaard is een nieuw recept prive. Delen is nooit automatisch.

## Hoofdflow

De app moet aanvoelen als een begeleide flow:

1. **Week**
   Compact weekmenu, status, volgende stap, slimme korte acties.

2. **Aanpassen**
   Vervang een gerecht, typ waar je zin in hebt, of kies uit enkele passende
   suggesties.

3. **Aanvullen**
   Vaste boodschappen, voorraadcheck, extra producten.

4. **Controle**
   Alleen twijfelgevallen, productkeuzes en hoeveelheden. Vertrouwde keuzes
   blijven rustig op de achtergrond.

5. **Bevestigen**
   De gebruiker bevestigt expliciet voordat Picnic wordt gevuld.

6. **Leren**
   De app stelt korte vragen na relevante acties en verwerkt stil accepteren
   als positief signaal.

## Schermprincipes

### Week

Het startscherm is geen beheerpagina. Het moet direct antwoord geven op:

- Wat eten we?
- Wat moet ik nog doen?
- Wat wordt straks besteld?
- Waar kan ik snel iets aanpassen?

### Aanpassen

De gebruiker moet kunnen zeggen:

- "Doe iets snels."
- "We willen AVG met kip."
- "Geen pasta vandaag."
- "Iets met sperziebonen."

De app vertaalt dit naar tags, ingredienten, context en persoonlijke
voorkeuren.

### Aanvullen

Vaste boodschappen en voorraad moeten samengevat worden:

- "18 vaste boodschappen staan klaar."
- "3 voorraaditems vragen aandacht."
- "Bekijk en pas aan" in plaats van alles open tonen.

### Controle

Controle toont uitzonderingen eerst:

- niet gevonden;
- onbekende verpakking;
- nieuw product;
- afwijking van standaard;
- hoeveelheid onzeker.

Vertrouwde keuzes hoeven niet prominent in beeld.

### Beheer

Recepten, ingredienten en producten mogen beheerd worden, maar niet als
hoofdroute. Beheer hoort achter "Meer", "Geavanceerd" of een gerichte
"Bewerk"-actie.

## Boodschappenproviders

Voor nu is Picnic de enige actieve provider.

De productvisie blijft breder:

- de boodschappenlijst zelf moet provider-neutraal zijn;
- Picnic is de eerste implementatie;
- later kunnen andere supermarkten of alleen een exporteerbare lijst volgen.

Nooit provider-specifieke aannames diep in algemene planningslogica stoppen.

## Succescriteria

Na ongeveer vier weken gebruik moet gelden:

- minimaal 80% van het voorgestelde weekmenu blijft staan;
- de gebruiker besteedt minder tijd aan weekmenu en boodschappen;
- de boodschappenlijst heeft vooral uitzonderingen nodig, geen volledige
  handmatige controle;
- de app kan kort uitleggen waarom gerechten gekozen zijn;
- de app stelt weinig, maar nuttige vragen;
- het huishouden voelt dat de app "ons begrijpt".

## Niet Nu

Deze onderwerpen zijn waardevol, maar niet de eerste focus:

- budgetoptimalisatie;
- aanbiedingen;
- calorieen of voedingsschema's;
- uitgebreide meal prep;
- automatisch bestellen zonder bevestiging;
- publieke receptenmarktplaats zonder curatie;
- volledig AI-gedreven planning zonder deterministische basis.

## Roadmap Vanaf Deze Visie

1. **Datamodel toetsen aan visie**
   Controleer of globale basisdata, huishouden-data, persoon-data en
   leersignalen scherp genoeg gescheiden zijn.

2. **UX terugbrengen naar assistent-flow**
   Startscherm, volgende stap, compacte week, beheer secundair.

3. **Onboarding ontwerpen**
   Snel starten en beter afstemmen.

4. **Waarom-signalen bouwen**
   Correcties en herhaalde vervangingen vertalen naar korte leervragen.

5. **Slimme wens-invoer bouwen**
   Vrije tekst zoals "AVG met kip en sperziebonen" vertalen naar suggesties.

6. **Aanvullen en controle versimpelen**
   Vertrouwde keuzes verbergen, uitzonderingen prominent tonen.

7. **Nieuwe gerechten gecontroleerd introduceren**
   Assistentvoorstellen tijdelijk houden en pas opslaan na acceptatie.

## Beslisregel Voor Nieuwe Features

Elke nieuwe feature moet door deze vragen heen:

1. Maakt dit de app makkelijker, of alleen uitgebreider?
2. Leert de app hierdoor beter wat het huishouden echt bedoelt?
3. Is dit algemene intelligentie of huishouden-personalisatie?
4. Vraagt dit de gebruiker op het juiste moment om informatie?
5. Kan de app onzekerheid uitleggen in gewone taal?
6. Blijft beheer secundair?
7. Komt dit dichter bij: "de app leert wat jullie eten en regelt de
   boodschappen"?

Als het antwoord op meerdere vragen nee is, hoort de feature niet in de
hoofdflow.
