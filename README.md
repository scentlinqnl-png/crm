# Scentlinq Klantkaart (PWA)

Een installeerbare web-app (PWA) die de bestaande **Klantkaart.xlsx** (SharePoint › Sales › Prospects)
en het Teams-kanaal **Sales › Prospects** samenbrengt in één mobiele sales- & service-app.
De app werkt offline. Met een Microsoft 365-koppeling leest en schrijft hij rechtstreeks in het werkboek,
zodat Excel en Teams de centrale bron blijven.

## Standalone

De app werkt **helemaal zelfstandig**: geen Excel, geen Microsoft 365 en geen server nodig.
Je begint met je eerste klant (of met voorbeeldgegevens) en alles wordt op het apparaat bewaard.
Afstanden vanaf de startplaats rekent de app zelf uit op basis van de plaatsnaam.

- **Back-up**: *Meer › Back-up maken* maakt een `.json`-bestand. Bewaar het bijvoorbeeld in OneDrive.
  Met *Back-up terugzetten* zet je alles over naar een nieuwe telefoon of computer.
  Het startscherm herinnert je eraan als je laatste back-up ouder is dan een week.
- **Let op**: zonder koppeling staan de gegevens op één apparaat en zien collega's elkaars bezoeken niet.
- **Optioneel**: je bestaande Klantkaart.xlsx eenmalig inlezen, exporteren naar Excel, of blijvend koppelen
  met Microsoft 365 (zie verderop). Claude-planning werkt ook standalone, met een eigen API-sleutel.

## Wat zit erin

| Scherm | Functie |
|---|---|
| **Vandaag** | KPI's (bezoeken/week, verbruik/maand, open pipeline, gewonnen), route van vandaag, activiteiten (te laat / vandaag / binnenkort), klanten die bijna een navulling nodig hebben, klanten die aandacht nodig hebben |
| **Klanten** | Zoeken, filteren op sector, classificatie (Weinig/Normaal/Veel), nooit bezocht, navullen, open deal |
| **Klantkaart** | Bellen, navigeren, bezoek loggen, inplannen · statistieken zoals Blad1 · profiel & geur-DNA · keten/multi-locatie · navulvoorspelling · deals · volgende stappen · tijdlijn |
| **Bezoek** | Datum, verbruik (ml), geur, instellingen, opmerking. Geur en instellingen worden van het vorige bezoek overgenomen. Vervolgbezoek meteen inplannen |
| **Pipeline** | Kanbanbord per fase met dealwaarde, slepen tussen fases, gewonnen/verloren, filter per sector. ⚠️ bij deals zonder volgende activiteit |
| **Planning** | Dagvoorstel (4–6 bezoeken, 09:00–18:00, start Bergen op Zoom, 45 min per bezoek). Houdt rekening met navulmoment, tijd sinds laatste bezoek, classificatie "Weinig" en clustering. Export naar Google Maps-route en Google My Maps (CSV) |
| **Dag afsluiten** | Bezochte klanten van de planning afvinken en verbruik invullen. Zonder koppeling: kant-en-klare regels om in het tabblad Verbruik te plakken |
| **Offerte** | Systeem (kopen of lease) + serviceabonnement, af te drukken als PDF, op te slaan als deal |
| **Meer** | Excel importeren, back-up, Microsoft 365-koppeling, voorkeuren, systemen/prijzen, sectoren, fases, coördinaten ophalen |

### Ideeën uit Pipedrive
- Visuele pipeline met fases en waarde per kolom
- Elke deal hoort een **volgende activiteit** te hebben: na een afgeronde activiteit vraagt de app meteen om de volgende stap
- Activiteitenlijst met *te laat / vandaag / binnenkort*
- Doelen en KPI's op het startscherm, tijdlijn per klant

### Uit het Scentlinq 360°-concept
- **Sector-pipelines**: Hospitality & Hotels, Retail & Showrooms, Zorg & Luchtvaart, … (instelbaar)
- **Multi-locatie**: klanten koppelen aan een keten/hoofdaccount; de klantkaart toont de andere vestigingen
- **Geur-DNA**: geurprofiel, gewenste sfeer, contactpersoon
- **Ruimte- & systeemcalculator**: L×B×H of m³ + luchtcirculatie → systeemadvies en intensiteit.
  *De systemen en prijzen zijn voorbeelden; zet de echte productspecificaties in Meer › Systemen.*
- **Proefplaatsing-tracker**: een afgeronde proefplaatsing maakt automatisch een reminder
  "Feedback ophalen" na 7 dagen
- **Voorspellend navulbeheer**: verbruik per dag wordt berekend uit de Verbruik-historie
  (ml tussen eerste en laatste bezoek ÷ aantal dagen). Samen met de flaconinhoud (standaard 500 ml,
  per klant aan te passen) geeft dat de verwachte leeg-datum. Die klanten komen op het startscherm
  en krijgen voorrang in de dagplanning
- **Offerte**: hardware (koop/lease) + terugkerend serviceabonnement

Nog niet gebouwd (vervolgstappen): partner-/distributeursdashboard, meertalige content library,
SDS/certificaten automatisch bij de offerte, koppeling met field-service-software, looptijd-
(vernevelingsuren) i.p.v. ml als basis voor navullen.

## Service & helpdesk

Tabblad **Service** (voor het Helpdesk-team):
- **Tickets**: storing, navulling, onderhoud, installatie, verwijdering of vraag, met prioriteit
  (spoed/hoog/normaal/laag), status (nieuw → ingepland → onderweg → opgelost) en een ticketnummer (T-0001).
  Een ticket kan aan een geplaatst systeem gekoppeld worden.
- **Navulling voorspeld**: klanten die volgens hun verbruik binnenkort leeg zijn krijgen met één tik een navulticket.
- **Agenda**: weekoverzicht van ingeplande tickets (met uren werk en salesbezoeken per dag) en een lijst van
  tickets die nog niet zijn ingepland.
- **Route**: de helpdeskroute per dag. Tickets per klant samengevoegd, volgorde geoptimaliseerd, tijden op basis
  van de duur per ticket. Open in Google Maps, zet de tijden terug in de tickets, markeer "onderweg" en rond af.
  Bij afronden van een navulling/onderhoud leg je meteen het verbruik vast; het onderhoud van het systeem wordt bijgewerkt.

## Uitgebreide CRM

Op de klantkaart:
- **Status en labels**: Prospect, Proefplaatsing, Klant, Oud-klant (of automatisch) en eigen labels.
- **Contactpersonen**: meerdere per klant, met functie, telefoon, e-mail en primair aanspreekpunt.
- **Contracten**: serviceabonnement, lease, huur of koop, met bedrag per maand en eenmalig, looptijd en opzegtermijn.
- **Geplaatste systemen**: systeem, serienummer, plek in het pand, geur, plaatsingsdatum, laatste onderhoud en status.
- **Service**: open tickets van de klant; afgeronde tickets staan in de tijdlijn.

**Rapportage** (Meer › Rapportage): MRR/ARR, contracten die binnen 60 dagen aflopen, pipelineconversie,
gewonnen dealwaarde en verbruik per maand, cijfers per sector, klanten per status en servicecijfers
(open tickets per type, gemiddelde doorlooptijd, nieuwe tickets per maand).

## Servicerapport, offertes, voorraad en import

- **Ticket afronden**: foto's maken of kiezen, handtekening van de klant op het scherm, gebruikt materiaal
  uit de voorraad, en direct een **PDF-servicerapport** (delen via mail/WhatsApp/Teams of downloaden).
  Foto's en handtekeningen staan op het apparaat (IndexedDB) en gaan mee in de back-up; ze worden niet naar Excel gesynchroniseerd.
- **Terugkerend onderhoud**: geef een systeem een interval (3/6/12 maanden); de app maakt 14 dagen vooraf een onderhoudsticket.
- **Offertes**: opslaan met nummer (O-0001), als PDF versturen, en bij akkoord automatisch contract,
  systemen (gepland) en installatieticket aanmaken. Na de installatie worden de systemen actief.
- **Voorraadbeheer** (Service › Voorraad of Meer › Voorraadbeheer):
  - artikelen met artikelnummer, categorie, leverancier, inkoop-/verkoopprijs, minimum, busminimum en bestelaantal;
  - voorraad per locatie (standaard Magazijn en Bus, zelf uit te breiden) en de voorraadwaarde;
  - mutaties: ontvangst, verbruik (automatisch bij tickets, van de locatie van het apparaat), overboeking, correctie en retour;
  - bestelvoorstel per leverancier, inkooporders (B-0001) met PDF-bestelbon; bij ontvangst automatisch inboeken;
  - bus aanvullen vanuit het magazijn en voorraadtelling met correcties.
- **Import** (Meer › Importeren): klanten, contactpersonen, contracten en systemen uit CSV of Excel,
  met automatische kolomkoppeling en voorbeeld. Bestaande klanten worden bijgewerkt.
- **Claude**: naast de salesdag plant Claude ook de helpdeskdag (Service › Route) en maakt een
  briefing per klant (klantkaart › Briefing).

## Plan met Claude

In **Planning** staat de kaart *✨ Plan met Claude*. Typ in gewone taal wat je wilt, bijvoorbeeld
"Richting Rotterdam, eerste afspraak niet vóór 10:00, Hotel X moet erin". Claude krijgt per klant
naam, plaats, afstand, dagen sinds het laatste bezoek, classificatie, navulmoment, sector en open
deals/activiteiten mee (geen adressen of telefoonnummers) en kiest de klanten, de vertrektijd en een reden per klant.
De app berekent daarna zelf de volgorde en de tijden. Je kunt stops weghalen en de dag opslaan zoals altijd.

Koppelen (Meer › Claude), kies één van twee:
- **API-sleutel**: maak een sleutel aan op [platform.claude.com](https://platform.claude.com) en plak die in de app.
  De sleutel wordt alleen op dat apparaat bewaard. Handig voor één gebruiker.
- **Proxy (aanbevolen voor meerdere collega's)**: zet `proxy/cloudflare-worker.js` op een Cloudflare Worker
  met de secrets `ANTHROPIC_API_KEY` en `ALLOWED_ORIGIN`, en vul de Worker-URL in bij *proxy-URL*.
  De sleutel staat dan niet op de telefoons.

Model: `claude-opus-5` met adaptief denken en een vast JSON-antwoordformaat. Een planning kost enkele centen.
Zonder internet werkt dit niet; de gewone dagplanner werkt wel offline.

## Hoe de data werkt

- **Zonder koppeling** staat alles lokaal in de browser (per apparaat). Importeer Klantkaart.xlsx
  via *Meer › Klantkaart.xlsx importeren*. Nieuwe bezoeken kopieer je via *Dag afsluiten* naar
  het tabblad Verbruik. Maak regelmatig een back-up (.xlsx).
- **Met Microsoft 365-koppeling**:
  - klanten komen uit **Blad1**, bezoeken uit **Verbruik**, afstanden uit **Afstanden**
  - een nieuw bezoek komt op de eerstvolgende vrije regel in **Verbruik** (A=datum, B=klantnr.,
    D=ml, E=opmerking, F=geur, G=instellingen; de formule in kolom C blijft staan)
  - nieuwe klanten komen op de eerste vrije regel in **Blad1** (A–F). De formules in G–L rekenen door
  - pipeline, activiteiten, klantprofielen, tickets, contactpersonen, contracten en systemen komen in
    tabbladen met de naam **CRM_…** (die maakt de app zelf aan)
  - offline gemaakte wijzigingen worden weggeschreven zodra je weer online bent

Er staan **geen klantgegevens in deze repository**. Alles komt uit je eigen werkboek.

## Installeren

### 1. Hosten (GitHub Pages)
De workflow `.github/workflows/pages.yml` publiceert de app bij elke push naar `main`.
Zet in GitHub bij *Settings › Pages* de bron op **GitHub Actions**.
De app staat dan op `https://scentlinqnl-png.github.io/crm/`.
(Voor een privé-repository heeft GitHub Pages een betaald abonnement nodig. Elke andere statische
HTTPS-host werkt ook, bijvoorbeeld Azure Static Web Apps. Een SharePoint-documentbibliotheek werkt niet als host.)

### 2. App registreren in Microsoft Entra ID (eenmalig, als beheerder)
1. [entra.microsoft.com](https://entra.microsoft.com) › *Identity › Applications › App registrations › New registration*
2. Naam: `Klantkaart`. Accounttypes: *alleen deze organisatie*
3. Redirect URI: platform **Single-page application (SPA)**, URL:
   `https://scentlinqnl-png.github.io/crm/auth.html`
   (de exacte URL staat ook in de app onder *Meer › Microsoft 365*)
4. *API permissions › Add › Microsoft Graph › Delegated*: `User.Read`, `Files.ReadWrite.All`,
   `Sites.ReadWrite.All`, `offline_access`. Klik **Grant admin consent**
5. Kopieer de **Application (client) ID** en de **Directory (tenant) ID**
6. In de app: *Meer › Microsoft 365* → client ID en tenant ID invullen, controleer
   host (`scentlinqprobenelux.sharepoint.com`), site (`/sites/Sales`) en bestand
   (`Prospects/Klantkaart.xlsx`) → **Aanmelden bij Microsoft**

> In de map Prospects staan nu ook `Klantkaart (1).xlsx` en `Klantkaart2.xlsx`. Kies één
> werkboek als bron en vul dat pad in.

### 3. Op de telefoon installeren
- **Android/Chrome**: menu › *App installeren* (of de knop in *Meer*)
- **iPhone/Safari**: deel-knop › *Zet op beginscherm*

### 4. In Microsoft Teams
- **Snel**: in het kanaal *Sales › Prospects* › `+` › **Website** › URL van de app.
- **Als eigen Teams-app** (met aanmelden binnen Teams): na deploy staat het pakket op
  `https://scentlinqnl-png.github.io/crm/klantkaart-teams.zip`. Teams › *Apps › Apps beheren ›
  Een app uploaden*. Voeg in de Entra-registratie dezelfde redirect-URI toe (staat er al).
  Gebruik je een andere host? Pas dan `teams/manifest.json` aan (`contentUrl`, `websiteUrl`, `validDomains`).

## Ontwikkelen

Geen build-stap: gewone HTML/CSS/ES-modules. Lokaal draaien:

```sh
python3 -m http.server 8080
# open http://localhost:8080
```

| Bestand | Inhoud |
|---|---|
| `index.html`, `styles.css` | Shell en opmaak (licht/donker, mobiel eerst) |
| `js/app.js` | Hoofdschermen, dialogen, router |
| `js/ui.js` | Gedeelde UI-hulpfuncties |
| `js/service.js` | Tickets, service-agenda en helpdeskroute |
| `js/media.js`, `js/report.js` | Foto's/handtekening (IndexedDB) en PDF-rapporten (jsPDF) |
| `js/quotes.js`, `js/import.js` | Offertes en CSV/Excel-import |
| `js/stock.js`, `js/voorraad.js` | Voorraadbeheer: logica en scherm |
| `js/crm.js` | Contactpersonen, contracten, systemen, klantstatus en rapportage |
| `js/store.js` | Lokale opslag, parsing van het werkboek, statistieken/classificatie, navulvoorspelling, calculator |
| `js/planner.js` | Dagplanner en Google Maps-route |
| `js/graph.js`, `js/auth-page.js`, `auth.html` | Microsoft 365-aanmelding (OAuth2 + PKCE) en Graph Excel-API |
| `js/excel.js` | Import/back-up (SheetJS) en exports (Verbruik-regels, My Maps CSV) |
| `js/claude.js` | Dagplanning door Claude (Anthropic SDK, structured output) |
| `proxy/cloudflare-worker.js` | Voorbeeldproxy zodat de API-sleutel op de server blijft |
| `js/geo.js` | Coördinaten per plaats via OpenStreetMap Nominatim, voor betere routes |
| `sw.js`, `manifest.webmanifest`, `icons/` | PWA: offline cache en installatie |
| `teams/` | Teams-app manifest en iconen |
| `vendor/` | SheetJS 0.18.5, Microsoft Teams JS SDK 2.x de Anthropic TypeScript SDK 0.128.0 (gebundeld voor de browser) en jsPDF 4.2.1 |

Na het wijzigen van bestanden: verhoog `CACHE` in `sw.js`, zodat geïnstalleerde apps de nieuwe versie ophalen.
