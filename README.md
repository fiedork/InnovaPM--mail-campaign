# InnovaPM Mail Campaign

Lekka, prywatna aplikacja do zarządzania kampaniami mailowymi InnovaPM z trzema seriami wiadomości w każdej kampanii.

## Zakres

- jednoplikiowy import kampanii, kontaktów i spersonalizowanych treści z XLSX/CSV;
- ręczne dodawanie, edycja na liście i usuwanie kontaktów;
- podgląd i edycja listy firm należących do kampanii;
- podgląd, edycja i zapis spersonalizowanej sekwencji D0 / D+3 / D+6 dla każdej firmy;
- biblioteka nazwanych stopek HTML z wersją domyślną, wyborem per kampania, izolowanym podglądem i tekstową wersją awaryjną wiadomości;
- status każdej kampanii: wysłane, otwarte, odpowiedzi i bounce;
- status bieżącej kampanii bezpośrednio przy kontakcie;
- tworzenie nowej kampanii lub przypisanie do istniejącej z listy kontaktów;
- bezpieczne usuwanie pustych kampanii i archiwizacja kampanii z historią wysyłki;
- jeden aktywny odbiorca na firmę i kampanię;
- person-first tabela odbiorców z przypisaniem, edycją i usuwaniem z kampanii;
- kontrola gotowości blokująca akceptację bez odbiorców lub kompletnych treści;
- akceptacja, start, pauza, wznowienie i anulowanie kampanii;
- automatyczne cofnięcie do ponownej akceptacji po zmianie treści lub odbiorcy;
- wybierana data startu kampanii, konfigurowalny limit do 40 wiadomości dziennie, dni robocze i okno 09:00–15:00 `Europe/Warsaw`;
- wysyłka przez Advanced Gmail API albo prywatny relay SMTP Hostingera;
- `dry-run`, suppression list, wykrywanie odpowiedzi, autoresponderów i bounce;
- HMAC, blokada powtórzeń, audit log i blokada równoległej kolejki.

## Workflow

1. Dodaj kontakty ręcznie lub przez import.
2. Utwórz kampanię z jednego pliku albo przypisz kontakt do nowej kampanii.
3. Sprawdź osoby w zakładce `Odbiorcy`.
4. Uzupełnij i zapisz trzy serie maili dla każdej osoby.
5. Przejdź przez `Szkic → Do akceptacji → Gotowa → Uruchomiona`.
6. Monitoruj wysłane wiadomości, otwarcia, odpowiedzi i odbicia.

Domyślne limity, okno wysyłki, tryb testowy i domyślna wersja stopki dotyczą
nowych kampanii. Każda kampania przechowuje własny wybór stopki oraz kopię
pozostałych ustawień. Zmiana treści stopki używanej przez zatwierdzoną kampanię
wymaga ponownej akceptacji, ponieważ wpływa na finalną treść wiadomości.

## Architektura

- `src/app` — panel Next.js 16 i Route Handlers.
- `src/lib` — domena, walidacja, importer XLSX/CSV oraz klient HMAC.
- `apps-script` — backend Google Apps Script i model danych Google Sheet.

Google Sheet zawiera zakładki: `Campaigns`, `Companies`, `Contacts`,
`Recipients`, `Messages`, `Events`, `Suppression`, `Settings`.

## Format importu kampanii

Jeden wiersz oznacza jednego odbiorcę w konkretnej kampanii. Wymagane dane:

- `Kampania` albo legacy `Seria` (opcjonalna; bez niej nazwą kampanii jest nazwa pliku),
- `Firma`, `Imię i nazwisko`, `Stanowisko`, `Adres e-mail`,
- `Mail 1`, `Mail 2`, `Mail 3` w formacie `Temat: ...` i treść poniżej.

Zamiast połączonych kolumn `Mail 1/2/3` można użyć par `Temat 1` +
`Treść 1`, analogicznie dla kroków 2 i 3. Opcjonalne kolumny obejmują
telefon, LinkedIn, sektor, trigger, pakiet, źródło i notatkę.

## Uruchomienie lokalne

```bash
cp .env.example .env.local
npm install
npm run dev
```

Bez ustawionych zmiennych Apps Script panel działa jako prototyp i wykonuje
lokalne podglądy importu. Nie wysyła wiadomości.

## Konfiguracja backendu

1. Wdróż zawartość `apps-script` według instrukcji w
   `apps-script/README.md`.
2. Ustaw w `.env.local`:

```text
APPS_SCRIPT_URL=https://script.google.com/macros/s/.../exec
APPS_SCRIPT_HMAC_SECRET=...
CAMPAIGN_OWNER_EMAIL=krzysztof.fiedorowicz@innova.pm
APP_ACCESS_PASSWORD=...
APP_AUTH_SECRET=...
SMTP_HOST=smtp.hostinger.com
SMTP_PORT=465
SMTP_USER=krzysztof.fiedorowicz@innova.pm
SMTP_PASS=...
SMTP_FROM_EMAIL=krzysztof.fiedorowicz@innova.pm
```

Endpoint Apps Script jest dostępny anonimowo wyłącznie dlatego, że serwer
Next.js uwierzytelnia każde żądanie podpisem HMAC, timestampem i jednorazowym
nonce. Interfejs aplikacji powinien pozostać owner-only.

## Kontrole

```bash
npm test
npm run lint
npm run build
npm audit
```

## ChatGPT Sites

Projekt jest gotowy jako niezależna aplikacja Next.js. ChatGPT Sites nie
obsługuje obecnie bezpośredniego połączenia z żywym Apps Script, dlatego Sites
może służyć jako lekki prototyp interfejsu, ale pełna wersja operacyjna wymaga
hostingu obsługującego Route Handlers i sekrety środowiskowe.
