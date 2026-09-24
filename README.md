# Scentlinq Klantkaart (PWA)

Een installeerbare web-app (PWA) die de bestaande **Klantkaart.xlsx** (SharePoint › Sales › Prospects)
en het Teams-kanaal **Sales › Prospects** samenbrengt in één mobiele sales- & service-app.
De app werkt offline. Met een Microsoft 365-koppeling leest en schrijft hij rechtstreeks in het werkboek,
zodat Excel en Teams de centrale bron blijven.

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

## Hoe de data werkt

- **Zonder koppeling** staat alles lokaal in de browser (per apparaat). Importeer Klantkaart.xlsx
  via *Meer › Klantkaart.xlsx importeren*. Nieuwe bezoeken kopieer je via *Dag afsluiten* naar
  het tabblad Verbruik. Maak regelmatig een back-up (.xlsx).
- **Met Microsoft 365-koppeling**:
  - klanten komen uit **Blad1**, bezoeken uit **Verbruik**, afstanden uit **Afstanden**
  - een nieuw bezoek komt op de eerstvolgende vrije regel in **Verbruik** (A=datum, B=klantnr.,
    D=ml, E=opmerking, F=geur, G=instellingen; de formule in kolom C blijft staan)
  - nieuwe klanten komen op de eerste vrije regel in **Blad1** (A–F). De formules in G–L rekenen door
  - pipeline, activiteiten en klantprofielen komen in nieuwe tabbladen **CRM_Deals**,
    **CRM_Activiteiten** en **CRM_Klantprofiel** (die maakt de app zelf aan)
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
| `js/app.js` | Schermen, dialogen, router |
| `js/store.js` | Lokale opslag, parsing van het werkboek, statistieken/classificatie, navulvoorspelling, calculator |
| `js/planner.js` | Dagplanner en Google Maps-route |
| `js/graph.js`, `js/auth-page.js`, `auth.html` | Microsoft 365-aanmelding (OAuth2 + PKCE) en Graph Excel-API |
| `js/excel.js` | Import/back-up (SheetJS) en exports (Verbruik-regels, My Maps CSV) |
| `js/geo.js` | Coördinaten per plaats via OpenStreetMap Nominatim, voor betere routes |
| `sw.js`, `manifest.webmanifest`, `icons/` | PWA: offline cache en installatie |
| `teams/` | Teams-app manifest en iconen |
| `vendor/` | SheetJS 0.18.5 en Microsoft Teams JS SDK 2.x |

Na het wijzigen van bestanden: verhoog `CACHE` in `sw.js`, zodat geïnstalleerde apps de nieuwe versie ophalen.
