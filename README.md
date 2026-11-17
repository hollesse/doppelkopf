# doppelkopf

**Doppelkopf in 5 Minuten** – eine Kurzanleitung für das Kartenspiel Doppelkopf, auf Englisch und Deutsch.
Aufgebaut wie [shithead-rules](https://github.com/hollesse/shithead-rules): statische Seiten, gebaut mit
[Eleventy](https://www.11ty.dev/). Jede Sprache ist eine eigene, fertig gerenderte Seite (`/`, `/de/`), die
Regeln sind also auch ohne JavaScript lesbar. JavaScript ergänzt nur das Übungsquiz, QR-Code und
Teilen-Buttons und merkt sich die gewählte Sprache.

## Inhalt der Seite

Aufbau (48 Karten, Austeilen) · Teams (Re und Kontra) · Trumpf und Fehl · Ein Stich (bedienen, wer gewinnt) ·
Augen zählen · Quiz „Sticht das?“ · Ansagen (Re/Kontra, keine 90 … schwarz) · Abrechnung mit Sonderpunkten
(Fuchs, Karlchen, Doppelkopf) und Beispiel · Hochzeit und Soli · Hausregeln · Strategien · Spickzettel · Teilen.

Die Regeln gibt es in zwei Varianten: mit Neunen (48 Karten, `/`, `/de/`) und ohne Neunen (40 Karten,
`/ohne-neunen/`, `/de/ohne-neunen/`); ein Umschalter oben auf der Seite wechselt zwischen beiden.

Dazu eine Spielseite (`/play/`, `/de/play/`): Doppelkopf gegen drei Bots, direkt im Browser, auch offline,
wahlweise mit oder ohne Neunen.

Grundlage sind die Turnierspielregeln des Deutschen Doppelkopf-Verbands, vereinfacht. Verbreitete
Abweichungen stehen im Abschnitt „Hausregeln“.

## Entwickeln

```sh
npm install
npm start        # Dev-Server mit Live-Reload: http://localhost:8080/doppelkopf/
npm run check    # prüft die Übersetzungen (läuft auch bei jedem Build)
npm run build    # schreibt die Seite nach _site/
npm test         # Playwright-Tests gegen das gebaute _site/ (vorher npm run build)
```

Beim ersten Mal ggf. den Browser installieren: `npx playwright install chromium`.

## Aufbau

| Pfad | Inhalt |
| --- | --- |
| `src/_includes/rules.njk` | Die Regelseite selbst, für beide Varianten |
| `src/index.njk` | Regeln mit Neunen, einmal pro Sprache |
| `src/ohne-neunen.njk` | Regeln ohne Neunen (`/ohne-neunen/`, `/de/ohne-neunen/`) |
| `src/play.njk` | Spielseite gegen Bots (`/play/`, `/de/play/`) |
| `src/_includes/layouts/base.njk` | Gemeinsamer Rahmen: Kopf, `hreflang`, Skripte |
| `src/_includes/langmenu.njk` | Sprachmenü, verlinkt auf dieselbe Seite in jeder Sprache |
| `src/_includes/card.njk` | Makros für die Spielkarten-Grafiken |
| `src/_includes/redirect.njk` | Nur Startseite: leitet auf die gemerkte bzw. Browsersprache weiter |
| `src/_data/languages.js` | Liste der Sprachen (Reihenfolge im Menü, Flagge, Fallback-Kette) |
| `src/_data/i18n/*.json` | Texte pro Sprache: Quiz unter `quiz`, Spielseite unter `game`, Kartenbuchstaben unter `ranks`, abweichende Texte ohne Neunen unter `noNines` |
| `src/_data/site.js` | Öffentliche URL und Pfad-Präfix |
| `src/_data/fonts.js` | Welche Schriften, Schnitte und Zeichensätze ausgeliefert werden |
| `src/fonts.11ty.js` | Erzeugt `/assets/fonts.css` aus den `@fontsource`-Paketen |
| `src/assets/` | Stylesheet, JavaScript und Icons, werden unverändert kopiert |
| `src/assets/site.js` | Auf jeder Seite: Sprachmenü, Service Worker |
| `src/assets/rules.js` | Quiz, QR-Code, Teilen |
| `src/assets/game/` | Spiel: `engine.js` (Regeln), `bots.js` (Computergegner), `ui.js` (Oberfläche), `fx.js` (Animationen), `game.css` |
| `src/sw.js` | Service Worker (Vorlage), siehe „Offline“ |
| `src/manifest.webmanifest` | Web-App-Manifest, macht die Seite installierbar |
| `scripts/check-i18n.js` | Prüft die Übersetzungen, siehe unten |
| `tests/site.spec.js` | Playwright-Tests: beide Sprachen, Weiterleitung, ohne JavaScript, Quiz, Teilen, Offline |
| `tests/play.spec.js` | Spielseite: beide Sprachen, komplette Partien über die Oberfläche, Ansagen, Solo, Layout |
| `tests/engine.spec.js` | Spielregeln und Abrechnung ohne Browser, inklusive Tausender simulierter Partien |
| `tests/bots.spec.js` | Die Bots in typischen Situationen: halten sie die Konventionen ein? |
| `scripts/arena.mjs` | Lässt zwei Bot-Stufen fair gegeneinander spielen (`npm run arena`) |
| `tests/serve.js` | Kleiner Server, der `_site/` unter dem Pages-Pfad ausliefert |

## Gegen Bots spielen

Du spielst mit drei Bots, die Spielseite läuft komplett im Browser, ohne Server, auch offline.

- **Regeln** wie auf der Regelseite: 48 Karten mit Neunen, bei zwei gleichen Karten gewinnt die erste
  (auch bei den Dullen), Ansagen Re/Kontra bis schwarz mit den Fristen von dort, Hochzeit (wer zuerst in
  den ersten drei Stichen einen Stich holt, wird Partner; sonst allein), stilles Solo, Damen-, Buben-,
  Farbsoli und Fleischlos, Sonderpunkte im Normalspiel, Soli zählen dreifach. Haben beide Parteien
  eine Absage nicht geschafft, gewinnt keiner. Hausregeln (Armut, Schweinchen usw.) gibt es nicht.
- `engine.js` enthält nur die Regeln, ohne Oberfläche, und lässt sich so in Node testen und simulieren.
  `knownParties()` liefert, was ein Spieler über die Parteien wissen kann (eigene Karten, gespielte
  Kreuz-Damen, Ansagen, Abzählen). Danach richten sich die Bots und die Re/Kontra-Abzeichen am Tisch.
- `bots.js` hat zwei Stufen:
  - **Normal** spielt nach den Konventionen von der Regelseite, damit man seine Karten lesen kann
    wie die eines Menschen: Re spielt Trumpf an, Kontra Fehl; ein Re-Spieler legt die Kreuz-Dame,
    sobald sie einen Stich holt; Fehl-Asse beim ersten Durchgang (schwarze vor Herz), keine zweite
    Runde Herz; geschmiert wird nur ein Stich, den der Partner sicher hat (Fuchs zuerst); gestochen
    mit mindestens einem Buben, solange noch jemand überstechen kann; Re/Kontra früh mit gutem Blatt,
    Soli nur mit klaren Blättern. Die Bots wissen nur, was ein Mensch am Tisch wissen kann, und deuten
    Anspiele als Hinweis („spielt Trumpf an, ist wohl Re“).
  - **Stark** spielt genauso, denkt aber vor jeder Karte voraus: Es würfelt mehrere Verteilungen der
    verdeckten Karten aus, die zu allem Gesehenen passen (wer welche Farbe nicht bedienen konnte, wer
    eine Kreuz-Dame haben muss oder keine haben kann), spielt das Spiel für jede mögliche Karte im Kopf
    mit Normal-Bots zu Ende und nimmt die Karte mit dem besten Durchschnitt. Das Verfahren heißt
    „Perfect Information Monte Carlo“; für Doppelkopf beschrieben von Sievers und Helmert
    ([KI 2015](https://ai.dmi.unibas.ch/papers/sievers-helmert-ki2015.pdf)). Budget: 160 Durchläufe pro
    Zug, gleiche Karten zählen einmal; ein Zug dauert am Rechner meist 30–100 ms.
- **Messen statt raten:** `npm run arena -- normal strong 150` lässt zwei Stufen gegeneinander
  antreten, fair: Jede Kartenverteilung wird zweimal gespielt, mit vertauschten Plätzen. Stand bei
  Einführung: Stark holt gegen Normal 0,45 ± 0,35 Punkte pro Spiel und Platz mehr. Die Ansage-Schwellen
  (`TUNING` in `bots.js`) sind so gewählt, dass Ansagen die meisten Punkte bringen (unter vier
  Normal-Bots: 0,9 Ansagen pro Spiel, 77 % davon gewonnen). Mit den Konventionen ist im Schnitt nach
  dem 4,6. Stich klar, wer zu wem gehört (vorher 6,7).
- **Ablauf:** Vor jedem Spiel fragt die Seite „Gesund oder Vorbehalt?“. Karte antippen und nochmal
  antippen (oder „Legen“) spielt sie; nicht erlaubte Karten sind abgedunkelt und erklären beim Antippen,
  was zu bedienen ist. Der Ansage-Knopf erscheint, solange deine nächste Ansage erlaubt ist.
- **Spielstand:** Nach jedem Spiel zeigt die Seite Augen, die einzelnen Spielpunkte und den laufenden
  Stand aller vier Spieler. Die Statistik (Spiele, Siege, Punkte pro Stufe) steht nur im
  `localStorage` des Geräts (`game-stats`).
- **Layout** wie bei Shithead: Während einer Partie füllt der Tisch genau einen Bildschirm, alle Bereiche
  haben feste Höhen, die Kartengröße richtet sich nach der Bildschirmhöhe. Ein Test prüft auf
  320 × 568 und einem Tablet, dass sich zwischen den Zügen nichts verschiebt.

## Ohne Neunen

- **Regeln:** `ohne-neunen.njk` rendert dieselbe Seite (`_includes/rules.njk`) mit `nines = false`. Die
  Kartenbilder lassen dann die Neunen weg, die Texte kommen aus `noNines` in der i18n-Datei: Dort stehen
  nur die Texte, die sich ändern (40 Karten, 10 pro Person, 24 Trümpfe, Fehlfarben mit 6 bzw. 4 Karten,
  Ansagen bis 9 Karten usw.), alles andere kommt aus den normalen Texten. Das Quiz spielt dort ohne Neunen.
  Der Spiel-Link dort öffnet die Spielseite mit `?nines=0`, also mit „Ohne Neunen“ vorausgewählt.
- **Spiel:** `createGame({ nines: false })` teilt 40 Karten aus, 10 pro Person; die Ansage-Fristen
  richten sich nach der Kartenzahl (Re/Kontra bis 9 Karten), die Punktgrenzen bleiben, denn die
  Neunen zählen 0 Augen. Die Bots verwenden dieselben Schwellen: Ohne Neunen sind es weniger Karten,
  aber mehr davon Trumpf, und die Ansagen treffen genauso oft (gemessen: ~0,9 pro Spiel, ~78 % gewonnen).

## Kartenbuchstaben

Auf deutschen Karten steht B (Bube) und D (Dame), auf englischen J und Q. Die Buchstaben kommen aus
`ranks` in der jeweiligen i18n-Datei, sowohl für die Grafiken auf der Seite als auch für das Quiz.

## Quiz „Sticht das?“

Eine Karte ist ausgespielt, du legst eine dazu: Gewinnt deine Karte? Bewertet wird nach den Regeln des
normalen Spiels (Trumpfreihe, Fehlfarben, bei zwei gleichen Karten gewinnt die erste). Gut die Hälfte der
Aufgaben hat dieselbe Farbe bzw. zweimal Trumpf, damit die interessanten Fälle oft vorkommen. Ein Test spielt
40 Runden mit festem Zufall durch und prüft gegen eine unabhängig aufgeschriebene Version der Regeln.

## Keine externen Ressourcen

Die Seite lädt nichts von fremden Servern (kein Google Fonts, kein CDN):

- **Schriften** kommen aus den npm-Paketen `@fontsource/atkinson-hyperlegible` und `@fontsource/archivo-black`
  (beide SIL Open Font License 1.1). Ausgeliefert werden nur die in `src/_data/fonts.js` gelisteten
  Schnitte und Zeichensätze.
- **QR-Code** erzeugt `qrcode-generator` (MIT), kopiert nach `/assets/qrcode.js`.

Ein Test stellt sicher, dass das so bleibt.

## Offline

Nach dem ersten Besuch funktioniert die ganze Seite ohne Netz, inklusive beider Sprachen, Quiz und
QR-Code. Dafür speichert ein Service Worker alle Dateien der Seite:

- `eleventy.config.js` schreibt nach jedem Build `_site/sw.js` aus der Vorlage `src/sw.js` und
  trägt die Liste aller Dateien und einen Hash über ihren Inhalt ein. Ändert sich etwas, bekommt
  der nächste Besuch eine neue Version und der alte Speicher wird gelöscht.
- Seiten kommen zuerst aus dem Netz (Updates sind sofort da), nur offline aus dem Speicher.
  CSS, JavaScript, Schriften und Icons kommen aus dem Speicher.
- Über das Manifest lässt sich die Seite auf den Homescreen legen.

Beim Entwickeln mit `npm start` ist der Service Worker auch aktiv: Geänderte CSS- oder JS-Dateien
erscheinen deshalb erst nach einem zweiten Neuladen (oder in den DevTools „Update on reload“ aktivieren).

## Sprachen

Englisch ist Standard und liegt unter `/`, Deutsch unter `/de/`. Wer mit deutscher Browsersprache
auf `/` kommt, wird nach `/de/` weitergeleitet; eine im Menü gewählte Sprache wird gemerkt und hat Vorrang.

**Neue Sprache:** `src/_data/i18n/<code>.json` anlegen und eine Zeile in `src/_data/languages.js` ergänzen.
Fehlende Texte kommen aus den `fallback`-Sprachen und zuletzt aus Englisch.

**Prüfung:** `npm run check` (Teil von `npm run build`) bricht mit einer Liste der Probleme ab, wenn
- ein Text fehlt, also weder in der Sprache selbst noch in einer ihrer Fallback-Sprachen steht und deshalb auf Englisch erscheinen würde,
- ein Text leer ist oder nicht in Englisch vorkommt (Tippfehler, Überbleibsel),
- Platzhalter wie `{mine}` oder `{led}` oder die HTML-Tags von Englisch abweichen oder Tags nicht geschlossen sind,
- ein Link auf einen `#abschnitt` zeigt, den es auf der Seite nicht gibt,
- `languages.js` und die JSON-Dateien nicht zusammenpassen.

## Deployment

`.github/workflows/ci.yml` baut die Seite und führt die Tests bei jedem Pull Request und Push aus.
Nur auf `main` und nur wenn die Tests grün sind, wird sie auf GitHub Pages veröffentlicht
(`https://hollesse.github.io/doppelkopf/`). Schlägt ein Test fehl, liegen Report und Screenshots als
Artefakt `playwright-report` am Workflow-Lauf. Einmalig nötig: *Settings → Pages → Build and deployment →
Source: GitHub Actions*. Für eine eigene Domain `src/_data/site.js` anpassen.
