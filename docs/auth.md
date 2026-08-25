# Login: Facebook a jméno/heslo — plán

Stav: **krok 0 a fáze 1 hotové (2026-08-25)**, před sebou fáze 2 (Facebook), 3 (přihlašovací stránka) a 4.

Zadání (úkol #3 z 2026-08-24): *„login budu potřebovat rozšířit o fb a o username a heslo“*.
Jméno/heslo na serveru po kroku 0 a fázi 1 **funguje a je použitelné** (nálezy N1–N4, N8, N9 vyřešené),
chybí mu ale UI; Facebook chybí celý.

---

## 1. Dnešní stav

### Server (`caio-server-auth`)

`Authentication.init(app, { prefixPath = "/auth", collectionName })` mountuje router:

| Route | Metoda | Stav |
|---|---|---|
| `/auth` | GET | funguje — vrátí identitu z JWT cookie, nebo `{ identity: null }` |
| `/auth/register` | POST | funguje; validuje e-mail i heslo a vrací jen basic data (fáze 1) |
| `/auth/login` | POST | funguje; vrací jen basic data, identita bez hesla dá 400 (fáze 1) |
| `/auth/logout` | POST | funguje — smaže cookie |
| `/auth/google` | GET | funguje — `passport.authenticate("google")` s `callbackURL` odvozeným z `Referer` |
| `/auth/google/callback` | GET | funguje — nastaví cookie a vrátí `assets/callback.html`, který přes `postMessage` pošle identitu do openera a zavře popup |

Identita je jeden dokument v kolekci `sys_identity` (nebo `<collectionName>`):

```
{ identity: "123-456-1", email, name, firstName, surname, photo, password?, googleId?,
  registrationType?, profileList?, sys: { cts, mts } }
```

- **JWT** v httpOnly cookie `token` (nebo `token_<collectionName>`), payload = `getBasicData()` + `authSchema`.
- **Heslo** hashuje `bcryptjs` v `Identity.create()`.
- **Google** identity zakládá strategie v `helpers/passport.js` (`findByGoogleId` → jinak `create`).
- **Autentizace** use-cases dělá middleware `Authentication.authentication` (zkusí všechny registrované cookie názvy).

### Klient (`caio-ui-auth`)

- `SessionProvider` drží `{ identity, state, login(), logout() }`. `login()` umí **jen Google** a **jen popupem** (`window.open("/auth/google")`), identitu čeká z `postMessage`.
- `Unauthenticated` má tlačítko *Přihlásit se* (volá `login()`) a *Registrovat se*, které je `disabled` a v `onClick` volá **neexistující `register()`** (N5).
- Žádná komponenta pro jméno/heslo, žádné volání `/auth/login` ani `/auth/register`.

---

## 2. Nálezy

Označení N = nález; **N1 je zadaný první krok**, ostatní jsou to, co po cestě stojí v cestě.

### N1 — `express.json()` se registruje až po auth routách (**blokující**)

`App.init()` volá `Auth.init(app)` (→ `app.use(prefixPath, Routes.init(...))`) a **teprve pak**
`Command.createCommands()`, kde je `app.use(express.json())`. Middleware v Expressu běží v pořadí
registrace, takže na auth routách žádný body parser není a `req.body` je `undefined`.

Reprodukováno na `app-v1` (2026-08-25):

```
POST /auth/login    → 500  TypeError: Cannot destructure property 'email' of 'req.body' as it is undefined.
POST /auth/register → 500  TypeError: Cannot destructure property 'firstName' of 'req.body' as it is undefined.
GET  /auth          → 200  {"identity":null}
```

Přidané zjištění: to 500 vrací **default error handler Expressu se stack trace a absolutními
cestami** ve výpisu (v produkci by je vypnul `NODE_ENV=production`, ale i tak je to HTML místo
JSONu, který klient čeká).

### N2 — `/login` a `/register` vrací celý dokument identity včetně hashe hesla

`res.json({ identity: found })` posílá `found` tak, jak přišel z DB — tedy i `password`
(bcrypt hash) a `sys`. Zbytek modulu na to má `Identity.getBasicData()` / `_getPublicData()`.
Než se jméno/heslo pustí do provozu, musí to jít přes ně.

### N3 — `/login` na identitě bez hesla spadne na 500 místo „Invalid credentials“

Identita založená Googlem nemá pole `password`, takže `bcrypt.compare(password, undefined)`
skončí výjimkou → 500. Správně má být stejná odpověď jako u špatného hesla (a nesmí prozradit,
že účet existuje, jen se přihlašuje jinak).

### N4 — unikátní index `{ email: 1, password: 1 }` nechrání to, co má

`IdentityDao.createIndexes()` má unikátní index nad **párem** email + heslo, takže dva účty se
stejným e-mailem a jiným heslem projdou. Zároveň to blokuje dvě identity bez hesla se stejným
e-mailem (dvě OAuth registrace) — to jsou přesně obrácené záruky, než by člověk chtěl. Souvisí
s rozhodnutím R1 (linkování účtů).

### N5 — `Unauthenticated` volá neexistující `register()`

V `caio-ui/src/caio-ui-auth/unauthenticated.jsx` je v `actionList` `onClick: () => register()`,
ale `register` není nikde definované ani importované. Dnes to nespadne jen proto, že to tlačítko
je `disabled: true`.

### N6 — chybějící credentials shodí start (známý problém, sem patří)

`Passport.init()` registruje `GoogleStrategy` bezpodmínečně a `new GoogleStrategy({clientID: ""})`
hodí `TypeError: OAuth2Strategy requires a clientID option`. Přidání Facebooku tuhle vlastnost
zdvojnásobí, pokud se to nezmění na „registruj strategii jen když má credentials“.

### N8 — kód identity koliduje, registrace na tom padá (**našlo se ve fázi 1**)

`generateNumId()` složí řetězec na nejvýš tři číslice, takže stejný e-mail ve stejné sekundě dá
stejný `identity` kód, a ten je pod unikátním indexem. Rozbor a oprava jsou v kapitole 4,
*Fáze 1: hotovo*.

### N9 — R1 vs. nepotvrzený e-mail (**našlo se ve fázi 1**)

Nepotvrzený e-mail od providera, který už nějaká identita má, nejde ani spárovat (převzetí účtu),
ani z něj založit druhou identitu (unikátní index z N4). Řešení a jeho důsledek jsou v kapitole 4,
*Fáze 1: hotovo*.

### N7 — drobnosti

- `assets/callback.html` má v `<title>` natvrdo *AFK Bratčice login*.
- `/login` ani `/register` nemají žádnou validaci (formát e-mailu, minimální heslo) a chybové
  odpovědi nejdou přes obálku `{ error: { code, message } }`, kterou používá zbytek serveru.
- Žádné omezení počtu pokusů o přihlášení.
- `registrationType` plní jen Google (`"google"`), registrace heslem ho nenastavuje.

---

## 3. Krok 0: oprava N1
**Hotovo 2026-08-25.** Implementováno podle varianty (A) v `api/routes.js`: `parseJson`
(`express.json({ limit: "10kb" })`) na `/register` a `/login`, plus error handler routeru, který
z odmítnutého těla dělá `400 caio-server-auth/invalidJson`, resp. `413 caio-server-auth/bodyTooLarge`
místo HTML se stack trace. Testy v `test/caio-server-auth/routes.test.js` rozšířené (mock
`express` umí `json()` a `use()`, handler se v testech bere jako **poslední** v řadě, nové bloky
*body parsing* a *parser errors*) — celá suita 132 testů zelená.

Ověřeno na `app-v1` proti lokálnímu Mongu:

| Požadavek | Před | Po |
|---|---|---|
| `POST /auth/register` s tělem | 500 HTML `TypeError` | **201** + identita + cookie |
| `POST /auth/login` správné heslo | 500 HTML `TypeError` | **200** + cookie |
| `POST /auth/login` špatné heslo | 500 HTML `TypeError` | **400** `Invalid credentials` |
| nevalidní JSON | 500 HTML se stack trace | **400** `{ error: { code: "…/invalidJson" } }` |
| tělo > 10 kB | 500 (bcrypt nad megabajtem) | **413** `{ error: { code: "…/bodyTooLarge" } }` |
| `GET /auth` s cookie → `POST /auth/logout` → `GET /auth` | — | identita → `{}` → `null` |

Odpověď z `/register` a `/login` přitom obsahuje **bcrypt hash hesla** — N2 už není teorie,
je vidět v tom výpisu. Proto se jméno/heslo nesmí zapnout v UI dřív než fáze 1.

Pozor při testování na tomhle stroji: na `:8080` se nakupilo šest procesů `server/index.js`
z předchozích sessions a Windows je přes SO_REUSEADDR nechá poslouchat na jednom portu
současně — první měření tak vracelo starý kód. Testovat na vlastním portu (`PORT=3998`),
nebo si nejdřív uklidit procesy.


Cíl: `POST /auth/login` a `/auth/register` dostanou naparsované `req.body`, aniž by se to rozbilo
appkám, které si `Auth.init()` volají samy na vlastní `app`.

**Navržená varianta (A): parser přímo na těch dvou routách v `api/routes.js`.**

```javascript
const parseJson = express.json({ limit: "10kb" });
router.post("/register", parseJson, async (req, res) => { ... });
router.post("/login", parseJson, async (req, res) => { ... });
```

Proč takhle:

- Modul je **samonosný** — funguje i bez `App.init()`, což README nabízí jako veřejné API.
- Je to **jediný** parser na dané cestě. `body-parser@2` už neskipuje podle `req._body`
  (`lib/read.js` kontroluje jen `onFinished.isFinished(req)` a `hasBody(req)`), takže druhý
  parser nad už přečteným streamem přečte prázdno a `req.body` **přepíše na `{}`**. Dva parsery
  na jedné cestě jsou tedy aktivní past, ne neškodná duplicita — dnes to nevadí jen proto, že
  globální parser z `command.js` je registrovaný později a k auth routám se nedostane.
- `limit` drží nesmyslně velké tělo mimo bcrypt.

Zvažované alternativy:

- **(B) `app.use(express.json())` v `App.init()` před `Auth.init()`** a vyhodit ho z
  `command.js`. Architektonicky čistší (jeden parser pro celou appku), ale rozbije samostatné
  použití `Auth.init()` a je to změna chování pro všechny existující routy najednou.
- **(C) parser uvnitř routeru** (`router.use(express.json())`). Skoro totéž jako A, ale běží i na
  routách, které tělo nečtou.

Součástí kroku 0 dál:

- **error handler routeru** pro nevalidní JSON: `SyntaxError` z parseru dnes propadne na HTML 500
  se stack trace, má z toho být `400` s obálkou `{ error: { code, message } }`.
- **testy**: `test/caio-server-auth/routes.test.js` mockuje `express` jako `{ Router: () => router }`,
  takže volání `express.json()` v modulu ten mock rozbije — mock musí dostat `json: () => mw` a
  test na registraci parseru. Do testů přidat případ „POST /login s tělem projde parserem“.
- **ověření na `app-v1`**: `curl -X POST /auth/register` a `/auth/login` musí vrátit JSON
  (`201` / `400 Invalid credentials`), ne 500 s HTML.

Krok 0 **nezahrnuje** N2–N4 — ty jsou fáze 1, ale bez nich se jméno/heslo nesmí zapnout v UI.

---

## 4. Fáze úkolu #3

**Fáze 1 — jméno/heslo na serveru použitelné**

1. N2: odpovědi `/login` i `/register` přes `Identity.getBasicData()`.
2. N3: chybějící `password` → stejná odpověď jako špatné heslo.
3. Validace vstupu (e-mail, minimální délka hesla) a chybové odpovědi v obálce `{ error: … }`.
4. N4: index podle rozhodnutí R1.
5. `registrationType: "password"` u registrace heslem.

### Fáze 1: hotovo 2026-08-25

Co se změnilo:

- **N2** — `/register` i `/login` odpovídají `Identity.getBasicData()`, ne dokumentem z DB.
  Hash hesla ani `sys` už z serveru nevypadnou.
- **N3** — `/login` na identitě bez hesla (registrovaná providerem) vrací `400
  invalidCredentials`, ne 500 z `bcrypt.compare(x, undefined)`. Odpověď je záměrně stejná jako
  u špatného hesla, aby `/login` nebyl způsob, jak zjišťovat, které účty existují.
- **Validace** — `Identity.isEmailValid()` a `Identity.checkPassword()` podle 5.3
  (10–72 bajtů, malé + velké písmeno + číslice); pravidla jsou v `config/config.js` jako
  `patternSource`, aby je fáze 3 mohla poslat přihlašovací stránce. Všechny chyby v obálce
  `{ error: { code, message } }`.
- **N4** — index je unikátní partial `{ email: 1 }` (`$type: "string"`), přidané partial indexy
  na `googleId` a `facebookId`, a zaniklý `email_1_password_1` se při startu smaže.
  `createIndexes()` je async a chyby jen loguje — konstruktor `Dao` ho nečeká, takže reject by
  byl unhandled.
- **R1** — párování je v `Identity.loginWithProvider()`, `helpers/passport.js` ho jen volá
  (aby Google a Facebook nemohly začít dělat každý něco jiného). `getAuthMethodList()` odvozuje
  z `password`/`googleId`/`facebookId`, co jde k účtu použít, a jde v `getBasicData()` klientovi
  jako `authMethodList`.
- **registrace heslem** dostává `registrationType: "password"`.
- **R4 částečně** — `create()` už nespadne na identitě bez e-mailu: seed pro kód identity je
  `email || googleId || facebookId || cts`.

**Dva nálezy, které se objevily až proti živé DB** — unit testy s mockovaným daem je minout musely:

**N8 — kód identity koliduje a registrace na tom padá.** `generateNumId()` složí libovolný
řetězec na nejvýš tři číslice, takže `generateId(email, cts)` dá pro **stejný e-mail ve stejné
sekundě stejný kód** — a `identity` je pod unikátním indexem, takže druhá registrace skončí
`E11000 … index: identity_1`. Prostor je ~10⁶ kombinací, takže při několika tisících identit je
kolize i mezi různými e-maily pravděpodobná. `create()` teď třetí segment kódu (ten, co byl vždy
`1`) inkrementuje, dokud insert neprojde, a po 50 pokusech to vzdá čitelnou chybou.

**N9 — R1 a „nepárovat nepotvrzený e-mail“ si odporují.** Když provider pošle **nepotvrzený**
e-mail, který už nějaká identita má, nesmí se párovat (převzetí účtu) — ale ani se nedá založit
druhá identita, protože přesně to unikátní index z N4 zakazuje. Řešení: **odmítnout přihlášení**
s `409 caio-server-auth/identity/emailNotVerified` a vyjmenovat, čím se k tomu účtu dá dostat —
stejná logika jako u registrace heslem na existující e-mail. Kdyby to mělo být jinak (třeba
založit účet bez e-mailu), je to rozhodnutí k přehodnocení R1/R2.

Zbytek se nezměnil: **N6** (strategie se registruje i bez credentials a shodí start) je pořád
otevřený, patří do fáze 2. A ta chyba z N9 dnes v popupu skončí jako HTML 500 z Expressu —
callback musí umět zobrazit hlášku, což je fáze 3.

**Ověřeno.** `npm test`: 11 suit, **170 testů** zelených (nové bloky pro validaci hesla, párování,
kolize kódu identity a indexy `IdentityDao`). Proti `app-v1` a lokálnímu Mongu:

| Případ | Výsledek |
|---|---|
| krátké heslo / bez velkého písmena | `400 passwordTooShort` / `400 passwordTooSimple` |
| nevalidní e-mail | `400 invalidEmail` (bez dotazu do DB) |
| registrace OK | `201`, v odpovědi **žádný hash**, `authMethodList: ["password"]` |
| druhá registrace na stejný e-mail | `400 identityExists` + „sign in with: password“ |
| login správně / špatně | `200` bez hashe / `400 invalidCredentials` |
| login heslem na identitu jen s `googleId` | `400 invalidCredentials` (dřív 500) |
| registrace heslem na e-mail, co má jen Google | `400 identityExists` + „sign in with: google“ |
| Google login na e-mail existující password identity | **stejná** identita, doplněný `googleId`, heslo zachované, 1 dokument, `authMethodList: ["password","google"]` |
| druhé přihlášení stejným `googleId` | tatáž identita, bez zápisu |
| nepotvrzený e-mail cizí identity | `409 emailNotVerified`, dokument nepřidán |
| indexy | `{email:1}` unique + partial `$type: string`, `email_1_password_1` smazaný |
| duplicitní e-mail vložený přímo do DB | zablokovaný (`11000`) |
| dvě identity bez e-mailu | povolené |

Testovací dokumenty jsou z dev DB smazané.

**Fáze 2 — Facebook**

1. Závislost `passport-facebook`, `Config.facebook = { appId, appSecret, callbackUc }` z env.
2. `helpers/passport.js`: `FacebookStrategy` se stejným párováním jako Google (`findByFacebookId`
   → jinak `create`), `profileFields: ["id", "displayName", "photos", "email"]`.
3. **Facebook nemusí vrátit e-mail** (uživatel ho může mít skrytý nebo se registroval telefonem).
   `Identity.create()` dnes staví `identity` z e-mailu (`generateId(identity.email, cts)`) →
   na `undefined` spadne. Potřebuje fallback (viz R4).
4. Routy `/auth/facebook` a `/auth/facebook/callback` podle vzoru Google, včetně `callbackURL`
   odvozeného z `Referer`.
5. N6: strategii registrovat jen když má credentials, a při chybějících logovat, ne padat.

**Fáze 3 — přihlašovací stránka (`caio-ui`) + její doprava (`caio-devkit`)** — tok je v 5.2

1. `caio-server`: `GET /auth/config` → `{ providerList, password: { minLength, pattern } }`,
   aby stránka věděla, co nabídnout a co validovat.
2. `caio-ui/static/login/`: `login.html`, `login.css`, `login.js` — bez uu5 a bez Reactu.
   Tlačítka *Google* / *Facebook* (podle `providerList`), formulář jméno+heslo s přepnutím na
   registraci, validace podle 5.3, hlášky ze serverových chyb, `postMessage` do openera
   a `window.close()`; bez openera `location.href = "/"`.
3. `caio-devkit`: plugin nakopíruje `node_modules/caio-ui/static/login/*` do `public/`
   a doplní do stránky `name` a `theme_color` z `assets/meta/manifest.json`. Existující
   `public/login.html` v appce nepřepisuje, aby si šla udělat vlastní.
4. `caio-ui` `SessionProvider`: `login()` otevře popup na `/login.html` (dnes `/auth/google`).
   `loginWithPassword` / `register` v provideru **nejsou potřeba** — volá je ta stránka; provider
   jen dál poslouchá `postMessage`.
5. `Unauthenticated`: tlačítko *Přihlásit se* otevře popup; smazat mrtvé *Registrovat se*
   volající neexistující `register()` (N5) — registrace je teď v popupu.

**Fáze 4 — ověření na `app-v1` + dokumentace**

1. Home route: přihlášení Googlem, Facebookem a heslem, výpis přihlášeného, odhlášení.
2. README `caio-server` (sekce *Authentication*) a `caio-ui` — nové routy, env a klientské API.
3. Až bude login mimo popup (viz R3), zrušit iOS výjimku u manifestu
   (`caio-devkit/src/vite/plugins/pwa.js`, důvod v `caio-devkit/docs/pwa.md`, R4).

---

## 5. Otevřená rozhodnutí

| # | Otázka | Návrh |
|---|---|---|
| R1 | **Jeden účet, nebo víc?** Když se stejný e-mail přihlásí Googlem, Facebookem a přes heslo — je to jedna identita s `googleId`/`facebookId`, nebo tři samostatné? | **ROZHODNUTO 2026-08-25: jedna identita**, párovat automaticky, kde to jde. Pravidla a jediný směr, který automaticky nejde, jsou v kapitole 5.1. |
| R2 | **Registrace heslem otevřená komukoliv?** A má se e-mail potvrzovat odkazem? | **ROZHODNUTO: zatím otevřená, bez potvrzování; ověření e-mailem do budoucna.** Do té doby platí varianta (a) z 5.1 — registrace heslem na e-mail, který už identitu má, se odmítne s návodem. |
| R3 | **OAuth popupem, nebo redirectem?** | **ROZHODNUTO: popup s výběrem** (Google / Facebook / jméno+heslo / registrace), a jeho obsahem je **samostatná HTML stránka z `caio-ui`**, ne routa SPA. Detail v 5.2. iOS výjimka u PWA manifestu zůstává v platnosti. |
| R4 | **Facebook bez e-mailu** — odmítnout, nebo založit identitu bez e-mailu? | **ROZHODNUTO: založit bez e-mailu**, `identity` generovat z `facebookId`. E-mail je povinný až tam, kde ho appka potřebuje. |
| R5 | **Kdo dodá Facebook App ID/Secret** a na jaké domény? | Postup, jak je získat, je v kapitole 7. Do env pak `FACEBOOK_APP_ID` / `FACEBOOK_APP_SECRET`; bez nich se strategie neregistruje (N6). |
| R6 | **Kde bydlí formulář** — přímo v `Unauthenticated`, nebo samostatná komponenta? | **ROZHODNUTO: samostatná** — a podle upřesnění R3 je to ta HTML stránka (bez uu5), ne uu5 komponenta. `Unauthenticated` zůstane jen tlačítko, které popup otevře. |
| R7 | **Pravidla na heslo a omezení pokusů.** | **ROZHODNUTO: minimální délka + regulární výraz na povinné druhy znaků**, hodnoty potvrzené (10–72 znaků, malé + velké písmeno + číslice) — viz 5.3. Rate limiting zůstává mimo rozsah — bez něj je `/auth/login` otevřený brute force. |

### 5.1 R1: jedna identita, párovaná podle e-mailu

Jeden dokument v `sys_identity` nese všechny způsoby přihlášení: `googleId`, `facebookId`
a `password` vedle sebe. `registrationType` zůstává informací o tom, **čím** účet vznikl;
co všechno k němu jde použít, se odvodí z přítomnosti těch tří polí (a dá se poslat klientovi
jako `authMethodList`, aby UI vědělo, co nabídnout).

Párování při přihlášení přes IdP (Google, Facebook) — v tomhle pořadí:

1. `findByProviderId` (`googleId`, resp. `facebookId`) → nalezeno, hotovo.
2. jinak `findByEmail(profile.email)` → **nalezeno = doplnit chybějící `googleId`/`facebookId`
   do existující identity** (to je to automatické namapování) a přihlásit.
3. jinak založit novou identitu.

Podmínka u bodu 2: e-mail musí být od IdP **potvrzený** — u Googlu `profile._json.email_verified`,
u Facebooku vrací API jen potvrzené adresy. Bez potvrzení se párovat nesmí: kdokoliv, kdo si
u nějakého IdP nastaví cizí e-mail, by tím převzal existující účet.

**Jeden směr automaticky nejde: registrace heslem na e-mail, který už identitu má.** Tady žádný
IdP vlastnictví e-mailu nedokládá — kdo zadá cizí e-mail a heslo, dostane přístup k cizímu účtu.
Možnosti:

- **(a) odmítnout s návodem** — „účet už existuje, přihlas se Googlem/Facebookem“ (a nastavení
  hesla řešit později v profilu, kde už je uživatel autentizovaný). Nic navíc to nepotřebuje.
- **(b) potvrzovat e-mail odkazem** a po potvrzení heslo k účtu doplnit. Předpokládá odesílání
  e-mailů, které stack neumí — a je to tedy fakticky rozhodnutí R2.

Návrh: **(a)** teď, **(b)** až kdyby padlo rozhodnutí posílat e-maily.

Důsledky do dat a kódu:

- **Index** (N4): `{ email: 1 }` unikátní **partial** (`{ email: { $exists: true, $type: "string" } }`,
  aby identity bez e-mailu z Facebooku neblokovaly jedna druhou — viz R4), a zrušit dnešní
  unikátní `{ email: 1, password: 1 }`.
- **Existující data**: pokud v nějaké kolekci už dvě identity se stejným e-mailem jsou (dnešní
  index to dovolil), vytvoření unikátního indexu selže. Před nasazením to projít skriptem
  a duplicity slít ručně — u `app-v1` a rozdělaných appek je to prázdná množina, u ostrých dat
  je to samostatný krok.
- **`Identity.create()`** dostane `authMethodList` derivaci a `findByFacebookId`; párovací logika
  patří do `abl/identity.js`, ne do dvou kopií v `helpers/passport.js`.

### 5.2 R3 + R6: `/login` je samostatná HTML stránka z `caio-ui`

**Rozhodnuto 2026-08-25:** popup neotevírá routu SPA, ale **samostatnou HTML stránku jen pro
přihlášení a registraci**, kterou dodává `caio-ui`. Tím se z popupu vypadne celá appka —
žádné uu5 knihovny, žádný React, jen HTML + kousek vanilla JS a CSS.

Tok:

1. `SessionProvider.login()` udělá `window.open("/login.html", …)` — stejná geometrie okna jako dnes.
2. Stránka nabídne *Google*, *Facebook* a formulář jméno+heslo s přepnutím na registraci.
3. **Google / Facebook**: stránka se naviguje na `/auth/google`, resp. `/auth/facebook`.
   `window.opener` navigaci v tom samém okně přežije, takže `assets/callback.html` pošle identitu
   přes `postMessage` do appky a popup zavře — beze změny proti dnešku.
4. **Jméno+heslo / registrace**: `fetch("/auth/login" | "/auth/register")`, server nastaví cookie
   a vrátí identitu; stránka ji sama pošle přes
   `window.opener.postMessage({ type: "auth", identity }, window.location.origin)` a zavře se.
5. Bez `window.opener` (stránka otevřená přímo v tabu) se po úspěchu udělá `location.href = "/"`,
   aby to nebyla slepá ulička.

**Proč `/login.html` a ne `/login`:** SPA fallback v `caio-server` posílá `index.html` na každou
cestu **bez přípony**, takže `GET /login` by vrátil appku, ne tuhle stránku. Přípona ji nechá
obsloužit `express.static` a nevyžaduje žádnou serverovou výjimku. (Varianta `/login/` s
`index.html` uvnitř by fungovala taky, ale závisí na lomítku na konci.)

Kde ta stránka bydlí a jak se dostane do buildu:

- **zdroj**: `caio-ui/static/login/` (`login.html`, `login.css`, `login.js`). `caio-ui` dnes žádnou
  statiku nemá — je to jen zdrojové JS/JSX — takže tohle je pro něj nová kategorie obsahu.
- **do outputu ji dostane devkit**, stejně jako kopíruje uu5 knihovny a PWA assety: plugin
  vezme `node_modules/caio-ui/static/login/*` a nakopíruje do `public/`. Appka tím nemá co řešit.
- **jméno a barvy** si stránka nemá kde vymyslet, a devkit už kvůli PWA hlavičce čte
  `client/public/assets/meta/manifest.json` (`name`, `theme_color`) — při kopii je do stránky
  doplní. Appka, která chce vlastní vzhled, si `public/login.html` přepíše vlastní kopií
  (plugin existující soubor nepřepisuje).
- **co se ověřuje na serveru zůstává na serveru**: stránka potřebuje vědět, která pravidla na
  heslo platí (5.3) a **které providery vůbec jsou nakonfigurované** (podle N6 se strategie bez
  credentials neregistruje, takže tlačítko *Facebook* nesmí svítit, když FB appka neexistuje).
  Na to přidat `GET /auth/config` → `{ providerList: ["google"], password: { minLength, pattern } }`
  a stránku podle toho vykreslit. Jinak by se to muselo psát dvakrát.

Co z toho plyne pro R6: „samostatná komponenta“ **není** uu5 komponenta —
`caio-ui-auth` nebude mít `Login.jsx`, ale právě tu stránku. V `Unauthenticated` zůstane jen
tlačítko, které popup otevře.

### 5.3 R7: pravidla na heslo

Potvrzeno 2026-08-25:

- **délka 10–72 znaků.** Horní hranice není kosmetika: `bcrypt` bere jen prvních **72 bajtů**
  a zbytek mlčky zahodí, takže heslo delší než to je matoucí, ne bezpečnější. (Bajty, ne znaky —
  háčky a čárky jsou v UTF-8 dva bajty.)
- **povinné druhy znaků**: malé písmeno, velké písmeno, číslice —
  `/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/`. Speciální znak jako povinný **ne**: u délky 10+ přidává
  spíš zapomenutá hesla než bezpečnost.
- Validace na **serveru** (jediné vynucení) a na přihlašovací stránce kvůli hlášce u pole;
  pravidlo je konstanta v `caio-server-auth/config` a stránka si ho bere z `GET /auth/config`
  (5.2), aby neexistovalo dvakrát.

---

## 6. Jak se to ověří

- `npm test` v `caio-server` (jest) — nové testy pro parser, `getBasicData` v odpovědích a
  identitu bez hesla.
- `app-v1` + `curl`: `register` → `201` s identitou **bez** `password`, `login` se správným
  i špatným heslem, `login` na Google identitě, `GET /auth` po přihlášení, `logout`.
- Prohlížeč (headless Chrome přes CDP, stejně jako u PWA): otevřít `/login.html` a projít
  všechny tři cesty přihlášení i registraci a odhlášení, sledovat konzoli. Ověřit i to, že
  `GET /login` (bez přípony) vrací appku, ne stránku — a že popup po úspěchu zavře sám sebe.
- Facebook: přihlášení proti FB appce v test režimu, plus případ „účet bez e-mailu“.
- Párování podle R1: registrace heslem → přihlášení Googlem na stejný e-mail musí skončit
  v **téže** identitě s doplněným `googleId` (ne druhým účtem), pak totéž Facebookem; a naopak
  registrace heslem na e-mail, který už identitu má, musí být odmítnutá s návodem.

---

## 7. R5: jak získat Facebook App ID a App Secret

Konzole Mety se překresluje po pár měsících, takže ber názvy položek jako vodítko, ne jako
klikací návod — logika kroků drží.

1. **Účet vývojáře.** Přihlas se na [developers.facebook.com](https://developers.facebook.com)
   svým FB účtem a projdi registraci do programu pro vývojáře (potvrzení telefonu / e-mailu).
2. **Nová appka.** *My Apps* → *Create app*. Zeptá se na use case — vyber ten o **přihlašování
   uživatelů Facebookem** (dnes „Authenticate and request data from users with Facebook Login“).
   Vyplň jméno appky a kontaktní e-mail; business portfolio můžeš přeskočit.
3. **Přidej produkt Facebook Login** (pokud ho use case nepřidal sám) — v levém menu
   *Products* / *Add product* → *Facebook Login* → *Set up*, platforma **Web**.
4. **Redirect URI.** *Products → Facebook Login → Settings* → sekce *Client OAuth Settings* →
   **Valid OAuth Redirect URIs**. Sem patří celá callback URL, **přesně**, včetně schématu
   a cesty — Strict Mode vyžaduje shodu na znak, jen `state` se ignoruje:

   ```
   https://<tvoje-domena>/auth/facebook/callback
   ```

   Pro lokální vývoj zkus `http://localhost:8080/auth/facebook/callback`. Meta má od 2018
   zapnuté *Enforce HTTPS* pro OAuth redirecty a jestli konzole `http://localhost` v development
   režimu pustí, jsem neověřil — dokumentace to nikde neříká. Když ji odmítne, jsou dvě cesty:
   HTTPS tunel na lokální port (cloudflared, ngrok — jeho URL se pak zapíše sem i do
   `.env.development`), nebo Facebook testovat až na nasazené appce a lokálně jen Google a heslo.
5. **App ID a App Secret.** *App settings → Basic*: **App ID** je vidět, **App Secret** se
   odkryje po *Show* a zadání hesla k FB účtu. Secret nikdy nesmí jít do klientského kódu ani
   do gitu — patří jen do `.env` na serveru.
6. **Env appky:**

   ```
   FACEBOOK_APP_ID=…
   FACEBOOK_APP_SECRET=…
   ```

7. **Kdo se smí přihlásit.** Dokud je appka v režimu *Development*, přihlásí se jen její
   administrátoři, vývojáři a testeři (*App roles* → *Roles*) — na vývoj to stačí a nic se
   nereviduje. Pro veřejný provoz je potřeba appku přepnout do *Live*, což chce vyplněnou URL
   zásad ochrany osobních údajů a u citlivějších oprávnění i App Review. Pro `email` a
   `public_profile` review potřeba není.
8. **Kontrola.** Po vyplnění env restartuj server a v logu ověř, že se strategie zaregistrovala
   (bez credentials se podle N6 registrovat nemá). Pak `GET /auth/facebook` musí přesměrovat na
   `facebook.com`, ne skončit chybou.

Zdroje: [Facebook Login — Security](https://developers.facebook.com/docs/facebook-login/security),
[Manually Build a Login Flow](https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow/),
[Strict URI Matching](https://developers.facebook.com/blog/post/2017/12/18/strict-uri-matching/),
[Requiring HTTPS for Facebook Login](https://developers.facebook.com/blog/post/2018/06/08/enforce-https-facebook-login/).
