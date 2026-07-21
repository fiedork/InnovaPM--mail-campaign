# InnovaPM Mail Campaign

Lekka, prywatna aplikacja do zarządzania kampanią D0 / D+3 / D+6 dla InnovaPM.

## Zakres

- jednoplikiowy import serii, kontaktów i spersonalizowanych treści z XLSX/CSV;
- ręczne dodawanie, edycja na liście i usuwanie kontaktów;
- podgląd i edycja listy firm należących do kampanii;
- podgląd, edycja i zapis spersonalizowanej sekwencji D0 / D+3 / D+6 dla każdej firmy;
- edytowalna stopka HTML z izolowanym podglądem i tekstową wersją awaryjną wiadomości;
- status każdej serii: wysłane, otwarte, odpowiedzi i bounce;
- status bieżącej serii bezpośrednio przy kontakcie;
- tworzenie nowej serii lub przypisanie do istniejącej z listy kontaktów;
- bezpieczne usuwanie pustych serii i archiwizacja serii z historią wysyłki;
- jeden aktywny odbiorca na firmę i kampanię;
- person-first tabela odbiorców z przypisaniem, edycją i usuwaniem z serii;
- kontrola gotowości blokująca akceptację bez odbiorców lub kompletnych treści;
- akceptacja, start, pauza, wznowienie i anulowanie kampanii;
- automatyczne cofnięcie do ponownej akceptacji po zmianie treści lub odbiorcy;
- limit 20 wiadomości dziennie, dni robocze, okno 09:00–15:00 `Europe/Warsaw`;
- wysyłka i threading przez Advanced Gmail API;
- `dry-run`, suppression list, wykrywanie odpowiedzi, autoresponderów i bounce;
- HMAC, blokada powtórzeń, audit log i blokada równoległej kolejki.

## Workflow

1. Dodaj kontakty ręcznie lub przez import.
2. Utwórz serię z jednego pliku albo przypisz kontakt do nowej serii.
3. Sprawdź osoby w zakładce `Odbiorcy`.
4. Uzupełnij i zapisz trzy wiadomości dla każdej osoby w `Sekwencji`.
5. Przejdź przez `Szkic → Do akceptacji → Gotowa → Uruchomiona`.
6. Monitoruj wysłane wiadomości, otwarcia, odpowiedzi i odbicia.

Domyślne limity, okno wysyłki i tryb testowy dotyczą nowych serii. Każda
seria przechowuje własną kopię tych ustawień. Zmiana globalnej stopki wymaga
ponownej akceptacji serii, ponieważ wpływa na finalną treść wiadomości.

## Architektura

- `src/app` — panel Next.js 16 i Route Handlers.
- `src/lib` — domena, walidacja, importer XLSX/CSV oraz klient HMAC.
- `apps-script` — backend Google Apps Script i model danych Google Sheet.

Google Sheet zawiera zakładki: `Campaigns`, `Companies`, `Contacts`,
`Recipients`, `Messages`, `Events`, `Suppression`, `Settings`.

## Format importu serii

Jeden wiersz oznacza jednego odbiorcę w konkretnej serii. Wymagane dane:

- `Seria` (opcjonalna; bez niej nazwą serii jest nazwa pliku),
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
