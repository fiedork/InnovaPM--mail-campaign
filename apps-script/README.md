# Backend Google Apps Script

1. Użyj prywatnego Google Sheet powiązanego z tym projektem Apps Script.
2. Kod `Code.gs` oraz manifest `appsscript.json` publikuj przez `clasp`.
3. W **Project Settings → Script Properties** dodaj:
   - `HMAC_SECRET` o tej samej wartości co `APPS_SCRIPT_HMAC_SECRET` w aplikacji Next.js;
   - `TRACKING_BASE_URL` z wartością `https://innovapm-mail-campaign.netlify.app/api/track/open`.
4. Uruchom ręcznie `configureProject()`, aby zapisać `SPREADSHEET_ID`, utworzyć zakładki i przejść autoryzację.
5. Uruchom `installTriggers()`, aby utworzyć kolejkę co 5 minut i monitoring odpowiedzi co 15 minut.
6. Wdróż jako **Web app**, wykonując jako właściciel i zezwalając na wywołanie
endpointu bez logowania Google. Dostęp chroni HMAC, timestamp i jednorazowy
nonce; sam panel Next.js pozostaje prywatny.

Przy pierwszym żądaniu po aktualizacji backend automatycznie wykonuje
idempotentną migrację starszych wiadomości do tabeli `Recipients`. Jednoznaczne
rekordy są naprawiane, a serie z konfliktem odbiorców wracają do kontroli.
7. URL wdrożenia wpisz jako `APPS_SCRIPT_URL`.

Wysyłka jest domyślnie w trybie `dry-run`. Przejście na live wymaga:

- aktywnego konta `krzysztof.fiedorowicz@innova.pm`,
- albo konta Google z adresem `krzysztof.fiedorowicz@innova.pm` skonfigurowanym jako zweryfikowany alias „Wyślij pocztę jako”;
- kompletnego wyboru odbiorców,
- zatwierdzenia kampanii,
- ręcznej zmiany `dryRun` na `false`.

Śledzenie otwarć działa wyłącznie w trybie `LIVE`. Jest wskaźnikiem orientacyjnym:
blokowanie obrazów i mechanizmy proxy klientów pocztowych mogą zaniżać lub zawyżać wynik.
