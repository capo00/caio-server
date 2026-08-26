# Úložiště souborů (`BinaryStore`) — plán

Stav: **schváleno uživatelem 2026-08-26** — R1–R7 a nálezy N1–N13 jsou zafixované (viz kap. 2 a 3
níž), začíná se implementace podle fáze 1 (kap. 4). Google Disk se z modulu odstraňuje úplně,
nezůstává jako fallback.

Zadání (úkol #4 z 2026-08-24): *„server napojit na úložiště souborů, vzor v `afkbratcice`“*.
Vzor je v `git/afkbratcice/server/libs/oc_binarystore` + `server/api/binary-api.js` a na klientu
v `client/oc_afkbratcice_maing01-hi/src/core/binary/*`.

**Změna backendu (2026-08-25):** afkbratcice ukládá obsah na **Google Drive** (přes sdílenou
osobní složku), ale to je pro `caio-server` vyloučené — Drive nesmí být úložiště. Obsah tedy
půjde do **Google Cloud Storage** (bucket ve stejném GCP projektu jako App Engine appka). Vzor
z afkbratcice zůstává platný pro **tvar API** (use-casy `binary/list|get|create|update|delete`,
`Crud` nad metadaty v Mongu) a pro **klientskou vrstvu** (`FormFile`, `Call.post` s `FormData`) —
neplatí jen pro to, kam se ukládá obsah souboru.

**Prior art (2026-08-25):** afkbratcice má na branchi `sprint` (commit `3670cbc`,
*„upgrade binary to Google bucket, because Google drive does not support service accounts“*)
hotovou migraci Drive → GCS. Potvrzuje směr (`@google-cloud/storage`, `bucket.upload()`,
`storage.googleapis.com/<bucket>/<object>` URL — je to skutečně Google Cloud Storage), ale
implementace se nekopíruje 1:1 — nese dál většinu nálezů z kapitoly 2 a dvě rozhodnutí (R3, R4)
jsou podle ní rovnou zpřesněná. Detaily a co konkrétně nepřebírat je v kapitole 8.

---

## 1. Dnešní stav

### `caio-server-binarystore`

Modul je do `caio-server` portovaný z afkbratcice 1:1 (jen CommonJS → ESM, `diff` proti
afkbratcice ukazuje pouze změněné importy a prefixy chyb) a pořád ukládá na Drive:

| Soubor | Co dělá |
|---|---|
| `index.js` | `BinaryStore.init(app, { googleDiskAuthPath, prefixPath })` + `BinaryStore.Binary` |
| `abl/binary-abl.js` | `BinaryAbl extends Crud` — `create`/`update`/`delete` nad Drive + Mongo, `parseFormDataRequest` (multer) |
| `abl/google-file-abl.js` | `create`/`update`/`delete`/`getUri` nad Google Drive API — **jde pryč, nahrazuje ho GCS ABL (kap. 3, R3)** |
| `dao/binary-dao.js` | kolekce `sys_binary`, indexy `gFileId` (unique), `size`, `mimeType`, `sys.mts` |
| `dao/dao.js` | `Dao` s URI z **vlastního** configu modulu |
| `config/config.js` | `mongodbUri`, `publicFolderId` (`GOOGLE_DISK_PUBLIC_FOLDER_ID`) — Drive-specifické, jde pryč |
| `api/routes.js` | `router.post("/create", BinaryAbl.create)` — **importovaný a nepoužitý** |

Data jednoho záznamu (co vrací `_getData`):

```
{ id, name, size, mimeType, tagList?, ...vlastní pole, uri, sys: { cts, mts } }
```

`gFileId` se z odpovědi maže a nahrazuje `uri` (Drive thumbnail odkaz) — v GCS verzi bude
analogicky `objectName` interní a `uri`/`downloadUrl` odvozené (kap. 3, R5).

Co už v `caio-server` funguje a modul se do toho může opřít:

- `Command.createCommands()` (`caio-server-app/services/command.js`) **už multipart umí** — když
  `content-type` je `multipart/form-data`, zavolá `CaioServerBinaryStore.Binary.parseFormDataRequest(req)`
  a `req.files` rozprostře do `dtoIn` podle `fieldname`. Tzn. `file` z formuláře přijde do `dtoIn.file`.
- `auth: true` / `auth: ["profil"]` v definici use-casu řeší autentizaci a autorizaci.
- `Dao` z `caio-server-dao` má od úkolu #1 lazy gettery — bez `MONGODB_URI` server nastartuje
  a operace spadne čitelnou hláškou.

### Klient (`caio-ui`)

- `UiElements.Call.post()` **už umí upload** — když je v `dtoIn` `File`, pošle `FormData`.
- `UiElements.Image` je `<img referrerPolicy="no-referrer">` — to je Drive quirk (jak Drive
  servíruje obsah); pro `storage.googleapis.com` to není potřeba, ale neškodí to nechat.
- `UiElements.CrudContext.create(entity)` generuje volání `entity/list|create|update|delete`,
  `UiElements.Crud` je tabulka + formuláře nad tím.
- `src/capo-google-disk/utils/image.js` (`Image.getUri(id, { width })`) je Drive-specifické
  (thumbnail URL) a s GCS pozbývá smysl — v novém designu není potřeba (kap. 3, R5).
- Chybí `FormFile` (v afkbratcice `core/form-file.js`) a `BinaryProvider` (`CrudContext.create("binary")`).

### Vzor v afkbratcice

Klíčové zjištění: **afkbratcice `routes.js` taky nemountuje** — v `server/index.js` je
`OcBinaryStorage` dokonce zakomentovaný a `init()` se vůbec nevolá. Endpointy vznikají jako
**use-casy v `server/api/binary-api.js`**, které volají `Abl.Binary`:

| Use case | Metoda | Auth |
|---|---|---|
| `binary/list` | GET | ne, validator `pageInfo` |
| `binary/get` | GET | ne, validator `id` |
| `binary/create` | POST | `["operatives"]` |
| `binary/update` | POST | `["operatives"]` |
| `binary/delete` | POST | `["operatives"]`, validator `id` |

Tzn. cesta pro `caio-server` je stejná jako u auth: hotové use-casy vedle modulu
(vzor `caio-server-auth/api/identity-api.js`), ne vlastní express router — to platí bez ohledu
na to, kam se ukládá obsah.

---

## 2. Nálezy

Označení N = nález. **N1 je zadání**, ostatní stojí v cestě nebo se opraví „za stejné peníze“.
Nálezy vázané čistě na Drive (dřívější N8, N9) se změnou backendu buď mizí, nebo se mění na jinou
otázku — viz poznámka u každého.

### N1 — `/binary` endpointy neexistují (**blokující**)

`BinaryStore.init(app, { googleDiskAuthPath, prefixPath = "/binary" })` z celého vstupu použije
jedinou věc: `Config.googleDiskAuthPath = googleDiskAuthPath`. `app` se nepoužije, `prefixPath` se
nikam nepropíše, `routes` je importovaný a nepoužitý. Ven vede jen `BinaryStore.Binary`, takže
soubory dneska umí nahrát jen appka, která si sama napíše use-case.

**Rozhodnuto (2026-08-26):** appka nemá volit ručně, jestli `binary/*` endpointy jsou k dispozici —
rozhoduje se to automaticky podle env, stejně jako providery v `caio-server-auth` (viz
`helpers/providers.js`). `caio-server-binarystore` dostane vlastní `helpers/config.js` s
`isConfigured()` (`true`, jen když je nastavené `GCS_BUCKET_NAME` — přihlašovací údaje řeší ADC,
viz N7, a nejdou ověřit z env stringu). Appka v `index.js`:

```js
import { BinaryStore } from "caio-server";

App.init({
  api: {
    ...healthApi,
    ...(BinaryStore.isConfigured() ? BinaryStore.createApi({ ... }) : {}),
  },
});
```

Google Disk (`google-file-abl.js`, `googleDiskAuthPath`, `GOOGLE_DISK_PUBLIC_FOLDER_ID`) se
odstraňuje celý, ne jen odpojuje — žádný fallback na Drive nezůstává.

### N2 — `routes.js` by nefungoval, ani kdyby se mountnul

`router.post("/create", BinaryAbl.create)` předává metodu ABL jako express handler:

- dostane `(req, res, next)` místo `data`, takže `const { file, name, ...rest } = data` rozebere
  request objekt,
- `this` se ztratí (metoda je předaná bez bindu), takže `this.dao` je `undefined`,
- multipart nikdo nenaparsuje (`parseFormDataRequest` se nezavolá), `req.files` neexistuje.

→ `routes.js` **smazat**, ne mountovat: nepoužitý kód láká k opravě špatné cesty.

**Rozhodnuto:** smazat (potvrzeno, žádná změna návrhu).

### N3 — modul si dělá druhé připojení do Mongo na jiný URI

`caio-server-dao/config/config.js` skládá `MONGODB_URI + "?" + (ssl v produkci) + "retryWrites=true&w=majority"`.
`caio-server-binarystore/config/config.js` bere `process.env.MONGODB_URI` **surově** a
`binarystore/dao/dao.js` s ním přebije `uri` v konstruktoru. `helpers/mongo.js` má `clientMap`
klíčovaný URI stringem → dva různé stringy = **dva `MongoClient`y a dva connection pooly**,
a ten binarystorový v produkci jede bez `ssl=true` a bez `retryWrites`. Nezávislé na Drive/GCS.

**Rozhodnuto:** zatím jedno Mongo (sdílené s `caio-server-dao`) — `binarystore/dao/dao.js` (vlastní
wrapper, který přebíjí `uri`) i `binarystore/config/config.js#mongodbUri` se mažou, `BinaryDao`
dědí přímo z `caio-server-dao`'s `Dao`. Žádná speciální práce navíc: konstruktor `Dao` už dnes bere
volitelné `{ uri }` (`caio-server-dao/dao.js:43`), takže až budoucí požadavek na víc Mongo instancí
přijde, stačí ho appce propustit přes `createApi({ mongoUri })`/config — nic v tomhle plánu tomu
nebrání.

### N4 — jméno souboru od klienta se používá jako cesta (**bezpečnost**)

```js
const storage = multer.diskStorage({
  destination: os.tmpdir(),
  filename: (req, file, callback) => callback(null, `${file.originalname}`)
});
```

`originalname` je hodnota z requestu a multer ji nesanitizuje. `../../něco` zapíše mimo `os.tmpdir()`,
dva paralelní uploady stejného jména se navzájem přepíšou.

**Se změnou na GCS tenhle nález z větší části mizí sám:** upload jde přes `multer.memoryStorage()`
(buffer v paměti) rovnou do `bucket.file(objectName).save(buffer)` — na disk se vůbec nesahá,
takže traversal do souborového systému nehrozí. `objectName` v bucketu se pořád generuje
serverem (`crypto.randomUUID()`), ne z `originalname` — ten zůstává jen jako `name` metadat,
protože GCS object names *mohou* obsahovat `/` a klientem zvolené jméno by mohlo přepsat
existující objekt nebo vytvořit matoucí "složkovou" strukturu.

**Rozhodnuto (finální řešení, ne jen návrh):** přesně tohle — `multer.memoryStorage()` +
`crypto.randomUUID()` jako `objectName`. `originalname` z requestu se nikdy nepoužije jako cesta,
jen se uloží do metadat jako `name`. Toto řešení zároveň řeší N5 (žádný temp soubor vůbec nevznikne)
a je základ pro řešení N10 (update dostává nový `objectName`, ne přepis starého).

### N5 — temp soubory se nikdy nemažou

Platí jen pro dnešní řešení (`fs.createReadStream(file.path)` čte z `os.tmpdir()`, který na App
Engine standard je RAM disk, a soubor se nikdy neuklidí). **S `multer.memoryStorage()` (viz N4)
mizí úplně** — žádný temp soubor nevzniká, buffer po requestu uklidí GC.

**Rozhodnuto:** požadavek „temp soubory mazat" je splněný designem, ne úklidovým krokem navíc —
`memoryStorage()` žádné soubory na disk nezapisuje, takže není co mazat. Pokud by v budoucnu
nějaká appka potřebovala streamovat větší soubory přes disk (limit z R6 to dnes nevyžaduje), bude
to nová práce, ne rozšíření tohoto nálezu.

### N6 — upload bez limitu velikosti

`multer({ storage })` bez `limits`. Platí i pro `memoryStorage()` — bez limitu si kdokoliv (po
autorizaci) může nechat naalokovat libovolně velký buffer v paměti instance, což je s pamětí
místo disku ještě citlivější. Fix: `limits: { fileSize, files }` s konfigurovatelným defaultem a
čitelná 413 odpověď (multer hodí `LIMIT_FILE_SIZE`, dneska by z toho byla nezachycená 500).

**Rozhodnuto:** limity jdou přes env, s rozumným defaultem, kdyby appka env nenastavila —
`BINARY_MAX_FILE_SIZE_MB` (default `25`) a `BINARY_MAX_FILES` (default `20`, zvednuto z R6).
Čtou se do `helpers/config.js` (N1) jako čísla, multer dostane `limits: { fileSize: maxFileSizeMB *
1024 * 1024, files: maxFiles }`, a `LIMIT_FILE_SIZE`/`LIMIT_FILE_COUNT` z multeru se zachytí a
namapují na čitelnou 413 (stejný `AppError`/`CoreError` vzor jako zbytek modulu, ne nezachycená
500).

### N7 — `googleDiskAuthPath` se nikde nečte

```js
// TODO path should be configurable
return auth ||= new google.auth.GoogleAuth({ keyFile: "./server/system-identity.json", scopes: SCOPES });
```

Cesta je hardcoded a relativní k `cwd`. `Config.googleDiskAuthPath` z `init()` se ignoruje.
**S GCS je řešení jednodušší:** klientská knihovna `@google-cloud/storage` bere ADC automaticky
(`new Storage()` bez parametrů) — na App Engine je to service account instance, lokálně
`GOOGLE_APPLICATION_CREDENTIALS` nebo `gcloud auth application-default login`. Explicitní
`keyFilename` zůstává jako volitelný override pro dev, ne jako jediná cesta.

**Rozhodnuto:** smazat celé — žádný `googleDiskAuthPath` parametr, žádná zmínka Google Disku v
`BinaryStore.init()`/configu. Auth je čistě `new Storage()` (ADC) + volitelný
`GOOGLE_APPLICATION_CREDENTIALS` z prostředí (R3).

### N8 — (Drive) `uri` byl thumbnail, ne soubor — s GCS odpadá

Drive verze měla `getGoogleFileUri()` vracet `https://drive.google.com/thumbnail?id=...`, což pro
PDF/zip/docx je obrázkový náhled, ne stažitelný soubor. **GCS objekt na dané URL je přímo obsah
souboru** (žádný "thumbnail" mód) — `https://storage.googleapis.com/<bucket>/<objectName>` je ten
samý byte stream, co se nahrál. Nález mizí; případný náhled/resize obrázků se řeší při uploadu
(klient zmenší přes `uu5imagingg01-tools`, R7), ne při čtení.

**Rozhodnuto:** potvrzeno — resize/náhled se řeší při uploadu na klientovi, backend obsah nijak
neupravuje ani negeneruje varianty.

### N9 — veřejnost obsahu je teď návrhová volba, ne omezení backendu

U Drive byl obsah nutně veřejný pro kohokoli s odkazem, protože jinak by šlo o proxy s ruční
sdílenou složkou. **GCS umí obojí přímočaře:**

- **veřejný bucket** (uniform bucket-level access + `roles/storage.objectViewer` pro `allUsers`)
  → stejné jako Drive dřív, URL je trvalá a přímá,
- **privátní bucket** → `getSignedUrl({ action: "read", expires })` z service accountu vygeneruje
  dočasnou URL na vyžádání (v `binary/get`), takže autorizace use-casu skutečně chrání i čtení
  obsahu, ne jen zápis metadat.

Rozhodnutí je v R4 — už to není otázka „umí to backend“, ale „co appka potřebuje“.

### N10 — nekonzistence při chybách

- `create` po selhání zápisu metadat uklidí nahraný objekt (dobře), ale `update` ne: když projde
  upload nového obsahu a spadne `dao.update`, v úložišti **už je nový obsah** a metadata mají
  starý stav. Se stejnojmenným objektem (GCS `file.save()` na existující `objectName`) je navíc
  původní obsah nenávratně přepsaný.
- `delete(id)` bez `gFileId`/`objectName` tiše neudělá nic — metadata zůstanou v Mongu navždy.

Platí stejně pro GCS jako pro Drive — je to chyba v pořadí operací, ne v backendu.

**Rozhodnuto — `update()` dostává nový `objectName`, nepřepisuje starý:**

Místo `bucket.file(binary.objectName).save(newBuffer)` (přepis na místě, nevratné) vytvoří `update`
s novým obsahem **nový** objekt pod novým `crypto.randomUUID()`, přesně jako `create`:

1. nahrát nový obsah pod nový `objectName` (starý objekt se zatím nesahá),
2. `dao.update()` přepne metadata (`objectName`, `size`, `mimeType`, `uri`) na nový objekt,
3. teprve po úspěšném kroku 2 smazat starý objekt z bucketu (best-effort — chyba se zaloguje, ale
   nehodí se appce jako chyba requestu; osiřelý objekt v bucketu je levný úklidový dluh, nekonzistentní
   metadata nejsou).

Pokud krok 1 (upload) selže, nic se nezměnilo. Pokud selže krok 2 (`dao.update`), nový objekt z kroku
1 se smaže (rollback) a stará metadata/starý objekt zůstávají platné beze změny — žádný stav, kde by
metadata ukazovala na neexistující nebo částečně napsaný obsah.

**Tohle zároveň řeší R4** (viz níž): protože se `uri` po update změní (nový `objectName` → nová URL),
odpadá stará URL z prohlížečovy/CDN cache — FE po update vždy dostane aktuální obsah, aniž by bylo
potřeba cache-busting query parametr nebo `Cache-Control: no-cache` na bucketu.

`delete(id)`: pořadí se otáčí — nejdřív se zkusí smazat objekt z bucketu (best-effort, chyba se
zaloguje, ale není to chyba requestu), pak se **vždy** smaže záznam v Mongu, i když `objectName`
chybí nebo storage-delete selhal. Priorita je konzistentní DB (žádné navždy zůstávající metadata), ne
garantovaně prázdný bucket.

### N11 — chybí čitelná kontrola konfigurace

Prázdný `GOOGLE_DISK_PUBLIC_FOLDER_ID` (nově `GCS_BUCKET_NAME`) nebo chybějící credentials se
projeví až chybou od Googlu uvnitř `create`. Vzor z úkolu #1 (`mongoConfigured` v `getHealth`)
říká, jak to má vypadat: `binaryConfigured` v health + jedna čitelná hláška při prvním použití.

**Rozhodnuto:** `getHealth` je appka vlastní (viz `app-v1/server/abl/health-abl.js` —
`mongoConfigured`/`googleAuthConfigured` tam appka skládá sama, `caio-server`'s `sys/health` je jen
`{ version }`). `BinaryStore.isConfigured()` (N1) appka zavolá ve svém `health-abl.js` a přidá
`binaryConfigured` vedle `mongoConfigured`/`googleAuthConfigured`/`facebookAuthConfigured` —
stejný vzor, žádná nová centrální infrastruktura v `caio-server` navíc.

### N12 — chybí hotové use-casy

`caio-server-auth` má `api/identity-api.js`, binarystore nic. Každá appka si `binary/*` píše sama
(afkbratcice to má ručně, i s TODO u validátorů, protože `uu_appdatatypesg02` neumí typ `file`).

**Rozhodnuto:** `api/binary-api.js` jako factory `createApi({ ... })`, use-casy `binary/list|get|
create|update|delete` ve tvaru `identity-api.js` (`{ method, auth, validator, fn }`). Napojení je
podmíněné podle N1 — appka spreadne `BinaryStore.createApi(...)` do svého `api` jen když
`BinaryStore.isConfigured()`; modul samotný o tom nerozhoduje mountováním/unmountováním routeru
(pořád žádný vlastní express router, viz R1).

### N13 — drobnosti

- `CoreError` je v `binary-abl.js` importovaný a nepoužitý.
- `Crud.list` volá `.map(this._getData)` bez bindu — u `BinaryAbl._getData` to náhodou projde
  (nepoužívá `this`), ale je to past pro každého, kdo do něj `this` přidá.
- `parseFormDataRequest(req)` volá `upload.any()(req, null, cb)` — `res` je `null`. Multer to dneska
  přežije, ale je to nedokumentovaná sázka na jeho vnitřek.
- `test/caio-server-binarystore/binary-abl.test.js` existuje a mockuje dao i Drive volání — po
  přechodu na GCS se mock přepíše na `@google-cloud/storage`, ale struktura testu (mock dao +
  mock storage klient) zůstává.

**Rozhodnuto:** promazat mrtvé importy (`CoreError` v `binary-abl.js`) a doplnit `res` do
`parseFormDataRequest(req)` → `parseFormDataRequest(req, res)`, protože volající
(`caio-server-app/services/command.js#getDtoIn`) `res` už v scope má a dnešní `upload.any()(req,
null, cb)` je nedokumentovaná sázka na multer interní chování. `Crud.list` bez bindu se neřeší —
mimo rozsah tohohle plánu.

---

## 3. Rozhodnutí (zafixováno 2026-08-26)

### R1 — API: hotové use-casy, profily per use case, prefix zatím ne

Nový `caio-server-binarystore/api/binary-api.js` jako factory. **Žádný globální
`writeProfileList`** — každý use-case (`list`/`get`/`create`/`update`/`delete`) má svoje vlastní
oprávnění (viz R2 pro přesný tvar):

```js
import { BinaryStore } from "caio-server";

App.init({
  api: {
    ...healthApi,
    ...(BinaryStore.isConfigured() && BinaryStore.createApi({
      create: { profileList: ["operatives"] },
      update: { profileList: ["operatives"] },
      delete: { profileList: ["admin"] },
      // list/get bez klíče = bez auth, viz R2/R4
    })),
  },
});
```

Use-casy `binary/list`, `binary/get`, `binary/create`, `binary/update`, `binary/delete` —
jména i chování jako afkbratcice, aby se klient (`CrudContext.create("binary")`) chytil bez úprav.
`BinaryStore.init(app, ...)` mizí celé (nikdy nepoužíval `app` ani `prefixPath` k ničemu
funkčnímu) → nahrazuje ho dvojice `isConfigured()` + `createApi()`.
**Prefix pro víc úložišť (`admin/binary/*`) se nedělá teď** — `createApi()` je navržené tak, aby šlo
doplnit později (volitelný parametr, default beze změny chování), ale dokud appka nemá druhé
úložiště, není co řešit.

### R2 — kdo smí co: profil per use case + volitelná vlastní autorizace

Každý use-case v `createApi({...})` bere buď `{ profileList }` (jako dnes — vyžaduje přihlášení a
alespoň jeden z profilů), nebo `{ authorize: async ({ dtoIn, identity, req }) => boolean }` pro
appku, která chce vlastní logiku (např. „smaž jen vlastník souboru"). Bez klíče v konfiguraci =
use-case bez auth (default pro `list`/`get`, viz R4 — veřejný bucket v1).

Tohle je **rozšíření obecného `auth` pole v use-case definici**, ne jen binarystore věc:
`caio-server-app/services/command.js#createCommands` dnes umí `auth: true` (jen přihlášený) a
`auth: [...]` (pole profilů, kontrola přes `authorization()`), ale ne funkci. Fáze 1 přidává třetí
tvar — `auth` jako `async (ctx) => boolean` — do `command.js`, takže je k dispozici i pro `identity-api.js`
a jakoukoli budoucí appku, ne jen pro binary. `binary-api.js` pak jen mapuje
`{ profileList }` → `auth: profileList`, `{ authorize }` → `auth: authorize`.

### R3 — Google Cloud Storage jako backend (nahrazuje dřívější R3 o Drive)

`abl/google-file-abl.js` se přejmenuje/přepíše na `abl/storage-abl.js` nad `@google-cloud/storage`
místo `googleapis`. Návrh rozhraní (stejné metody jako dřív, jiná implementace):

```js
import { Storage } from "@google-cloud/storage";
const storage = new Storage(); // ADC — žádný keyFile potřeba na GAE

class StorageAbl {
  static async create(file) {                 // file = multer memoryStorage file
    const objectName = crypto.randomUUID();
    const gcsFile = bucket.file(objectName);
    await gcsFile.save(file.buffer, { contentType: file.mimetype });
    return { objectName, uri: getUri(objectName) };
  }
  static async update(objectName, file) { /* save() na stejný objectName */ }
  static async delete(objectName) { await bucket.file(objectName).delete(); }
  static getUri(objectName) { return `https://storage.googleapis.com/${Config.bucketName}/${objectName}`; }
}
```

Config: `GCS_BUCKET_NAME` (env) nahrazuje `GOOGLE_DISK_PUBLIC_FOLDER_ID`; `GOOGLE_APPLICATION_CREDENTIALS`
je standardní GCP env proměnná, kterou `Storage()` čte sama — žádný vlastní `googleDiskAuthPath`
parametr už není potřeba, `BinaryStore.init()` z něj tím pádem nemusí nic brát.

**Zafixováno podle kapitoly 8:** v kódu nesmí být hardcoded `keyFilename` (afkbratcice sprint
branch to má napevno jako `"./server/system-identity.json"` — `new Storage()` bez parametrů je
default, `keyFilename`/`GOOGLE_APPLICATION_CREDENTIALS` jen jako override přes env, nikdy jako
literál v kódu). Nastavitelná cesta k dev klíči tedy jde přes env proměnnou, ne přes parametr
`init()` ani hardcoded cestu.

**Rozhodnuto:** lokální dev jede na `gcloud auth application-default login` — je to standardní GCP
dev workflow (žádný klíč na disku, žádný `.gitignore`/`.gcloudignore` risk jako v afkbratcice kap.
8). `GOOGLE_APPLICATION_CREDENTIALS` zůstává jako env override pro kdo z týmu chce místo toho JSON
klíč, ale není to postup, který dokumentujeme jako default v `caio-server/README.md`.

### R4 — veřejné vs. privátní soubory

S GCS je obojí levné (N9): **veřejný bucket** = trvalá URL, nejjednodušší na cache a CDN, ale
kdokoli s odkazem vidí obsah napořád. **Privátní bucket + signed URL** = `binary/get` vrátí
čerstvě podepsanou URL s krátkou expirací (řádově minuty/hodiny), takže autorizace use-casu
skutečně řídí i čtení — cena je o něco složitější klient (URL se nedá natrvalo cachovat) a
signed URL se musí generovat i pro `list`.
**Rozhodnuto:** v1 veřejný bucket (jednodušší, odpovídá dosavadnímu použití v afkbratcice — veřejné
přílohy klubového webu). `createApi()`/`StorageAbl` je navržené tak, aby šel privátní režim doplnit
později bez změny tvaru API (jen jiná implementace `getUri`).

**Aktuální obsah po update (upozornění z 2026-08-26):** vyřešeno v N10 — `update` nepřepisuje
existující objekt, vytvoří nový (`crypto.randomUUID()`) a `uri` se v metadatech přepne teprve po
úspěšném zápisu do Mongu. Nová `uri` = nová URL, takže žádná prohlížečová ani CDN cache nemůže
ukázat starý obsah; není potřeba cache-busting parametr ani `Cache-Control` řešení na bucketu.

**Zafixováno podle kapitoly 8, bez ohledu na výsledek téhle otázky:** přístupový model bucketu je
**Uniform bucket-level access** (IAM), ne per-object ACL. Afkbratcice sprint branch dělá veřejnost
souboru přes `bucket.upload(..., { public: true })`, což je legacy per-object ACL (`predefinedAcl:
publicRead`) a vyžaduje bucket s *Fine-grained access control* — to je jiný, staršího stylu model
a nejde kombinovat s IAM-based grantem z kapitoly 6. Uniform bucket-level access je dnešní GCP
default pro nové buckety, funguje stejně pro veřejný i privátní režim (jen jiná IAM role/grant) a
nedovolí, aby jeden objekt měl jinou viditelnost než zbytek bucketu — čitelnější provoz.

### R5 — jedno pole `uri`, žádné rozlišení thumbnail/download

Beze zbytku nahrazuje dřívější "R5 — uri vs. downloadUri": s GCS je URL vždy přímo obsah souboru
(N8), takže stačí jedno pole `uri` (u veřejného bucketu) nebo `uri` generované on-demand
(u privátního, R4). Odpadá i `capo-google-disk/utils/image.js` (Drive-specifický thumbnail
resize) — pokud appka chce menší náhled obrázku, zmenší ho **před uploadem**
(`uu5imagingg01-tools`, stejně jako to dělá `BinaryCrud.onPreSubmit` v afkbratcice), ne za běhu
při čtení.

**Rozhodnuto:** potvrzeno, jedno pole `uri`.

### R6 — limity

Návrh defaultu: `fileSize` 25 MB, `files` 5, konfigurovatelné v `init()`; whitelist mime typů
**ne** (obsah je stejně na GCS a servíruje ho Google/CDN, ne naše instance).

**Rozhodnuto:** `fileSize` 25 MB potvrzeno, `files` zvednuto z 5 na **20**. Oboje konfigurovatelné
přes env (`BINARY_MAX_FILE_SIZE_MB`, `BINARY_MAX_FILES` — viz N6), ne přes parametr `init()`/
`createApi()` — je to provozní nastavení instance, ne rozhodnutí appky za běhu. Whitelist mime typů
se nedělá.

### R7 — co doplnit do `caio-ui`

Minimum, aby appka zvládla upload: `UiElements.FormFile` (port `core/form-file.js`),
`UiElements.BinaryProvider`/`useBinary` (nad `CrudContext.create("binary")`). Export
`capo-google-disk` utilit **odpadá** (R5 — nahrazuje ho obyčejné pole `uri`, žádný
thumbnail-URL helper není potřeba); `capo-google-disk/` adresář v `caio-ui` se dá po přechodu na
GCS smazat celý. Volitelně `BinaryCrud` (hotová admin tabulka souborů z afkbratcice) — hodí se
pro `caio_propertyman` galerii. Pozor: resize obrázků před uploadem používá
`uu5imagingg01-tools`, které **v app-v1 nejsou** → nová dependency v šablonách devkitu.

**Rozhodnuto:** `BinaryCrud` patří do `caio-ui` (ne app-specifické) — appky si nemají psát admin
tabulku souborů znovu pokaždé.

---

## 4. Fáze

### Fáze 1 — server (`caio-server-binarystore`) — **hotovo 2026-08-26**

Kroky 1–10 implementované, `npm test` v `caio-server` zelený (211/211, včetně nových testů pro
`command.js`'s `auth` jako funkci, přepsaného `binary-abl.test.js` na GCS mock a nových
`binary-api.test.js`/`helpers-config.test.js`). README (`caio-server`, `caio-architecture`,
`caio-devkit`) přepsané podle kap. 7. Neověřené zůstává jen to, co vyžaduje reálný bucket a
credentials — kapitola 5, body 5–6 (stejné omezení jako u úkolu #3/Facebook).

**Nález navíc, mimo rozsah plánu, jen zaznamenáno:** `caio-server-auth/api/identity-api.js`
(nikdy nikde nepoužitý use-case modul) je nefunkční — `import UuAppDataTypes from
"uu_appdatatypesg02"` je default import z balíčku bez default exportu (SyntaxError při importu) a
`UuAppDataTypes.exact`/`.arrayOf` navíc v balíčku vůbec neexistují. Proto `binary-api.js` validátory
nepoužívají `UuAppDataTypes` vůbec (vlastní `requireId` funkce). `identity-api.js` se nikde
nepoužívá (app-v1 ho neimportuje), takže se to zatím nikde neprojevilo — oprava je mimo rozsah
tohohle úkolu.

Detail kroků, jak byly zadané:

1. N7: smazat `google-file-abl.js`, `googleDiskAuthPath`, `GOOGLE_DISK_PUBLIC_FOLDER_ID` — Google
   Disk pryč beze zbytku, žádný fallback.
2. N3: smazat `binarystore/dao/dao.js` i `mongodbUri` z configu modulu, `BinaryDao` dědí přímo
   z `caio-server-dao`'s `Dao` (jeden client, jeden URI; `{ uri }` override zůstává k dispozici
   pro budoucí víc-Mongo appky, nic dalšího se teď nedělá).
3. R3: nový `abl/storage-abl.js` nad `@google-cloud/storage`, `GCS_BUCKET_NAME` env, `new Storage()`
   bez parametrů (ADC).
4. N4 + N5 + N6: multer `memoryStorage()` s `crypto.randomUUID()` objectName, `limits` z
   `BINARY_MAX_FILE_SIZE_MB`/`BINARY_MAX_FILES` (defaulty 25 MB / 20 souborů), čitelná 413 z
   `LIMIT_FILE_SIZE`/`LIMIT_FILE_COUNT`.
5. N10: `create` nechává stávající rollback (smaže objekt při selhání `dao.create`); `update`
   přepsat na nový-objekt-pak-přepni-metadata-pak-smaž-starý (viz N10 výše); `delete` smaže
   metadata vždy, storage-delete je best-effort.
6. N1 + N11: `helpers/config.js#isConfigured()` (kontrola `GCS_BUCKET_NAME`), `BinaryStore.init()`
   mizí celý (nahrazuje ho `isConfigured()` + `createApi()`).
7. R2: rozšířit `caio-server-app/services/command.js#createCommands` — `auth` pole v use-case
   definici přijme kromě `true`/pole profilů i `async (ctx) => boolean`. Netýká se jen binary —
   `identity-api.js` a budoucí appky ho můžou použít taky.
8. N2 + N12 + R1: smazat `api/routes.js`, nový `api/binary-api.js` (`createApi({ list, get, create,
   update, delete })`, každý klíč `{ profileList }` nebo `{ authorize }`, chybějící klíč = bez auth).
9. N13: smazat nepoužitý `CoreError` import, `parseFormDataRequest(req, res)` — doplnit `res` i na
   volající straně (`command.js#getDtoIn`).
10. Testy: doplnit `test/caio-server-binarystore/` (limit velikosti, rollback při selhání `dao.
    create`/`dao.update`, `createApi` přes `App.init` supertestem jako `routes.test.js` u auth,
    `command.js` test pro nový `auth` jako funkce) a přepsat mock Drive → mock
    `@google-cloud/storage`.

### Fáze 2 — konfigurace GCP (kap. 6) a deploy

Sepsat postup (bucket, IAM role pro service account appky, ADC), zkontrolovat `.gitignore` a
`.gcloudignore` v šabloně `caio-create-app` (dev klíč, pokud se použije, se nesmí commitnout ani
nasadit).

### Fáze 3 — klient (`caio-ui`) podle R7 — **hotovo 2026-08-26**

`FormFile` (`caio-ui-elements/form-file.jsx`), `BinaryProvider`/`useBinary`
(`caio-ui-elements/binary-context.js`, `CrudContext.create("binary")`), `BinaryCrud`
(`caio-ui-elements/binary-crud.jsx`, generická admin tabulka bez app-specifických polí jako
afkbratcice `tagList` — appka s vlastními poli si postaví vlastní `Crud.generate()` config).
`capo-google-disk/` smazané celé (nikdy nebylo v `src/index.js` exportované, takže bez dopadu na
appky). `caio-ui` peerDependencies + `caio-devkit`'s scaffold šablona doplněné o
`uu5imagingg01`/`uu5imagingg01-tools` (verze `^2.0.0`, podle afkbratcice, ověřeno že existují
v registry). Nová syntaxe ověřená esbuildem (`app-v1/client/node_modules/esbuild`), reálné
vykreslení v appce je až fáze 4 (`caio-ui` nemá vlastní test/build infrastrukturu — ověřuje se
vždy přes `app-v1`).

### Fáze 4 — ověření v `app-v1` + dokumentace — **částečně hotovo 2026-08-26**

Hotovo: `app-v1` přeinstalovaný na čerstvé tarbally (`caio-server`, `caio-ui`) + nové peer
dependencies (`uu5imagingg01`, `uu5imagingg01-tools`); `server/index.js` a `health-abl.js`
zapojené (`BinaryStore.isConfigured()`/`createApi()`, `binaryConfigured` v `getHealth`);
`.env`/`.env.development` doplněné o `GCS_BUCKET_NAME=`; nový blok „5. Soubory (BinaryStore)" na
home stránce (`UiElements.BinaryCrud`, s placeholderem když `binaryConfigured` je `false`).
Ověřeno: server nastartuje, `getHealth` hlásí `binaryConfigured: false`, `binary/list` skutečně
neexistuje jako route (padá do SPA fallbacku, ne na chybu), `vite build` klienta proběhne bez
chyby a `uu5imagingg01`/`-tools` se objeví v import mapě i `public/libs/`, stránka se v prohlížeči
načte bez chyby v konzoli a blok 5 ukáže „BinaryStore není nakonfigurovaný" s odkazem na
`caio-devkit/docs/how-to-set-gcs.md`.

**Čeká na reálný bucket** (stejné omezení jako dřív u Facebooku, `docs/binary.md` kap. 5, body
5–6): skutečný upload/update/delete přes `BinaryCrud`, ověření `binary/create` 401 pro
nepřihlášeného, ověření obrázku/PDF přes `uri`. README appky s popisem bloku 5 ještě nedoplněné.
`caio-server/README.md` a **smazat známý problém** z `caio-devkit/README.md` jsou hotové už z
fáze 1 (viz commit `cb9f488`/`933acf9`).

**2026-08-26, reálný test proti opravenému Mongu (uživatel upgradoval lokální MongoDB Server ze
4.2 na 8.3, což zároveň odhalilo a umožnilo opravit pád procesu z `Dao.createIndexes()` — commit
`830a8bc`) — dva další nálezy a opravy:**

1. **`caio-ui`'s `Call.post` nikdy nestavěl absolutní URL** (`call.js`, commit `d9219a0`) —
   relativní `uri` (bez i s vedoucím lomítkem) narazí na `fetch()` patchnutý `uu5loaderg01`
   (kvůli vlastnímu module resolution), který na `POST` s relativní URL hodí `TypeError: Failed
   to construct 'URL': Invalid URL` ještě než request opustí prohlížeč — `GET` request stejným
   patchnutým fetchem projde bez problému. `CrudContext.create()` volá
   `Call.cmdPost(entity + "/create", dtoIn)` s čistě relativním řetězcem, takže tohle nebyl jen
   binary bug — cokoliv, co používá `CrudContext`'s create/update/delete (`BinaryCrud`,
   `PlayerCrud` z README příkladu, cokoliv budoucího), bylo od začátku rozbité. Opraveno stejně
   jako `get()` už dělal: `uri = new URL(uri, location.origin)` na začátku obou metod. Ověřeno
   přímo v prohlížeči (`fetch("/binary/create", {method:"POST",...})` shodí stejnou chybu,
   `fetch(new URL(...))` projde).
2. Po opravě žádosti reálně dorazí na server a `binary/create` vrátí čistou chybu: *„Could not
   load the default credentials.“* — to je přesně ADC krok z `how-to-set-gcs.md`, kapitola 7
   (`gcloud auth application-default login`), kterou je ještě potřeba udělat lokálně. Žádný
   osiřelý záznam v Mongu ani objekt v bucketu nevznikl (N10 rollback funguje).

**2026-08-26, třetí kolo — po `gcloud auth application-default login` reálný upload prošel, ale
uživatel narazil na tři další mezery a jednu chybu vzhledu, všechny opravené a ověřené end-to-end
proti reálnému bucketu:**

3. **`binary/deleteMany` neexistovalo** (`caio-server`, commit `0a65dba`) — `CrudContext`'s
   hromadné mazání (výběr řádků → tlačítko *Delete*) vždycky volá `entity/deleteMany`, ale
   `createApi()` registrovalo jen pětici z afkbratcice → 404. `BinaryAbl.deleteMany()` přidán se
   stejným vzorem jako `delete()` (best-effort úklid objektů v bucketu, `dao.deleteMany` proběhne
   vždy). Auth defaultně přebírá konfiguraci `delete`, jde nastavit i zvlášť.
4. **Delete byl schovaný v "..." menu** (`caio-ui`, commit `1a4f2f0`) — `Crud`'s `getActionList`
   dávala `update` jako vlastní viditelnou akci, ale `delete` byla vždycky uvnitř dots-menu.
   Sjednoceno: obojí je teď vlastní viditelná akce (except `compact` mód, kde jsou obě v menu,
   symetricky).
5. **Chybí odkaz na stažení u obrázků** (`caio-ui`, stejný commit) — `file` sloupec v
   `BinaryCrud` teď vždycky ukáže odkaz *Stáhnout* vedle náhledu (dřív jen u ne-obrázků).
6. **Ikony se nevykreslovaly** (`caio-devkit`, commit `0f688a0`) — `uu5g05.js` má natvrdo
   zadrátovaný požadavek na `uu_gds_svgg01-icons.min.css` bez ohledu na to, jestli appka běží v
   readable (dev) nebo minified (prod) módu. `copyTree`'s prořezávání min/non-min variant tenhle
   soubor v dev módu zahazovalo → žádná ikona (`uugds-*`) se nikde nezobrazila, bez chyby v
   konzoli. Zafixováno jako výjimka, co se kopíruje vždy.

**Ověřeno end-to-end proti reálnému bucketu (`caio-propertyman-binary`):** create (skutečný
upload, `uri` na `storage.googleapis.com`), update (přejmenování), bulk delete (`deleteMany`,
200), jednotlivý delete — všechno funguje.

**2026-08-26, čtvrté kolo — vizuální refresh po `deleteMany` doladěn (`caio-ui`, commit
`e97abfd`):** `useDataList`'s obecný list-level transform umí sloučit do lokálních dat jen
výsledek JEDNÉ položky (najde ji podle id) — `deleteMany({ idList })` do toho tvaru nesedí, takže
na rozdíl od jednotlivého `delete()` se řádek sám neodstranil, i když server (Mongo i bucket) byl
uklizený správně. Fix: po úspěšném `handlerMap.deleteMany(...)` v `crud.jsx`'s bulk-delete
handleru se zavolá `handlerMap.load(dtoIn)` (se stejným filtrem/dtoIn, co byl naposledy aktivní).
Ověřeno v prohlížeči — výběr dvou řádků, hromadné smazání, tabulka se vyprázdní okamžitě, bez
nutnosti reloadu stránky.

---

## 5. Jak se to ověří

1. **Bez konfigurace:** server nastartuje, `getHealth` hlásí `binaryConfigured: false`,
   `binary/create` vrátí čitelnou hlášku (ne 500 z GCS). Vzor je úkol #1.
2. **Bez Mongo, s bucketem:** `binary/create` spadne na DB hlášku a v bucketu po sobě nenechá
   objekt (úklid v `create` podle N10).
3. **Úklid při chybě uploadu:** simulovaný pád `dao.create` po úspěšném `bucket.file().save()` →
   objekt v bucketu se smaže (test s mockem, jako dřív N4/N5/N10, jen nad GCS mockem).
4. **Limit:** soubor nad limit → 413 s naším chybovým envelope, žádný objekt v bucketu nevznikne.
5. **Reálný GCS:** upload obrázku a PDF z `app-v1`, oba se stáhnou/zobrazí přes `uri`,
   `binary/delete` zmizí z bucketu i z Mongu.
6. **Autorizace:** nepřihlášený `binary/create` → 401.
7. **(Pokud R4 = privátní)** neplatný/expirovaný signed URL → GCS vrátí 403 přímo z
   `storage.googleapis.com`, ne z naší appky — ověřit, že expirace je nastavená rozumně krátká.

Body 5–6 potřebují reálný bucket a service account s právy na něj — to je kapitola 6 (a je to
stejné místo, kde u úkolu #3 zůstal neověřený Facebook: bez credentials to dál než k bodu 4
nejde).

---

## 6. Co je potřeba od tebe (Google Cloud Storage)

1. **Projekt na GCP** (stejný, ve kterém běží App Engine appka) → *APIs & Services* → povolit
   **Cloud Storage API** (u GAE projektů bývá zapnuté už výchozí bucketem appky, ale pro vlastní
   bucket to stojí za kontrolu).
2. **Bucket**: *Cloud Storage* → *Buckets* → *Create*. Doporučení: region stejný jako App Engine
   appka (nižší latence, žádný cross-region transfer), *Standard* storage class pro běžně
   čtené soubory. **Access control: Uniform** (dnešní default při vytváření) — **ne**
   *Fine-grained* (ta by v kódu svedla k per-object ACL jako `public: true`/`predefinedAcl`,
   viz kapitola 8 — zafixované rozhodnutí, ne jen doporučení). Uniform se dá zapnout i zpětně, ale
   ne zase vypnout, takže je lepší zvolit ho hned při založení bucketu.
3. **Přístup service accountu appky**: App Engine defaultně běží pod
   `<project-id>@appspot.gserviceaccount.com`. Tomu je potřeba na bucketu přidat roli
   (*Bucket* → *Permissions* → *Grant access*) — `roles/storage.objectAdmin` stačí (čtení, zápis,
   mazání objektů, bez správy samotného bucketu).
4. **Viditelnost obsahu (R4):**
   - **veřejný** — bucketu přidat `allUsers` s rolí `roles/storage.objectViewer` (funguje jen
     s Uniform bucket-level access z bodu 2). Pozor: GCP může u nových projektů vyžadovat
     odškrtnutí *Public access prevention* na úrovni organizace/projektu.
   - **privátní** — nic dalšího nastavovat, appka bude generovat signed URL pomocí service
     accountu (potřebuje k tomu buď `roles/iam.serviceAccountTokenCreator` na sebe sama, pokud
     běží pod stejným SA, nebo explicitní klíč — na GAE to jde i bez klíče přes
     `signBlob` IAM API).
5. Jméno bucketu (globálně unikátní, např. `<project-id>-binary`) do `GCS_BUCKET_NAME`.
6. **Billing:** Cloud Storage se účtuje projektu přímo (úložiště + operace + odchozí přenos) —
   žádná zvláštní kvóta jako u Drive service accountu, ale je dobré vědět, že to na rozdíl od
   Drive něco stojí i při malém provozu (řádově centy/měsíc pro víkendový klubový web).

---

## 7. Dopad na ostatní repa

- `caio-server/README.md` — sekci *BinaryStore* přepsat podle R1–R6 (dnešní popis
  `init(app, { prefixPath })` slibuje routy, které neexistují, a zmiňuje Drive) +
  `GCS_BUCKET_NAME`/`GOOGLE_APPLICATION_CREDENTIALS` do tabulky ENV místo
  `GOOGLE_DISK_PUBLIC_FOLDER_ID`.
- `caio-server/package.json` — `googleapis` (binarystore ho používal jen kvůli Drive; ověřit, že
  ho nepotřebuje ještě něco jiného) nahradit/doplnit `@google-cloud/storage`.
- `caio-devkit/README.md:498` — po fázi 1 smazat známý problém; `docs/vite-uu5.md:180` mluví
  o dev proxy na `/binary`, což už neplatí (dev jede na jednom originu).
- `caio-ui/README.md` — `Utils.image` (Drive thumbnail helper) je popsaný, ale nevyexportovaný;
  po R5/R7 tenhle popis z README zmizí úplně místo aby se dopisoval export.
- `caio-architecture/README.md` — řádek o `BinaryStore` (*„obsah na Google Drive“*) přepsat na
  Google Cloud Storage.

---

## 8. Prior art: afkbratcice `sprint`, commit `3670cbc`

Datum: 2025-10-27, zpráva *„Add init, upgrade binary to Google bucket, because Google drive does
not support service accounts“*. Nahradilo `abl/google-file-abl.js` (Drive) za nový
`abl/google-bucket-abl.js` (GCS); starý soubor přejmenovaný na `google-disk-abl.js` a ponechaný
v repu, i když ho už nikdo neimportuje.

### Co potvrzuje náš plán

- Backend je **skutečně Google Cloud Storage** — `@google-cloud/storage` (`^7.15.0`, oficiální
  klient), `bucket.upload(file.path, { destination, gzip, metadata: { contentType }, resumable,
  validation: "md5", public: true })`, výsledná URL `https://storage.googleapis.com/<bucket>/<name>`.
  Žádné jiné „Google úložiště" — je to ten samý produkt, se kterým počítá R3.
- Endpointy jsou stejně jako v Drive verzi ruční use-casy v `server/api/binary-api.js`
  (`binary/list|get|create|update|delete`) volané z `server/index.js` — `oc_binarystore`
  zůstává nenamountovaný modul přesně jako předtím. Potvrzuje R1 (hotové use-casy, ne router).
- Nápad „`id` = `objectName:generation`" (GCS generation number jako součást identifikátoru) je
  použitelný — stojí za zvážení pro `caio-server`, i když ho zatím nikde nevyužívají (žádné
  rollbacky na starší generation, jen skladují číslo).

### Co nepřebírat — nálezy z kapitoly 2 přetrvávají i po migraci na GCS

- **N7 v horší podobě:** `getStorage()` má hardcoded `keyFilename: "./server/system-identity.json"`
  — žádné ADC, přestože migrace byla motivovaná právě service accounty. `.gcloudignore` navíc
  neobsahuje `#!include:.gitignore` ani jinak nevylučuje `server/system-identity.json`, takže se
  privátní klíč service accountu **nahrává do GAE deploy balíčku** spolu se zdrojáky. Zafixováno
  v R3: žádný hardcoded `keyFilename` v kódu.
- **Nová chyba:** `BinaryStore.init(app, { googleDiskAuthPath })` nastaví
  `Config.googleDiskAuthPath`, ale `google-bucket-abl.js` ho vůbec nečte — configurovatelnost přes
  `init()` je jen zdání, cesta ke klíči je pořád hardcoded na jednom místě v kódu.
- **N5 přetrvává:** multer pořád píše přes `diskStorage` do `os.tmpdir()`
  (`bucket.upload(file.path, ...)` čte z disku) a soubor se po uploadu nikdy neuklidí — na GAE
  standard je `/tmp` RAM disk stejně jako u Drive verze.
- **N6 přetrvává:** žádné `limits` na multeru.
- **N10 přetrvává:** `update()` nemá rollback — když upload do bucketu projde a `dao.update`
  spadne, starý obsah je přepsaný (GCS `generation` by teoreticky umožnil verzování/rollback, ale
  nepoužívá se tak).
- **N1/N2 přetrvávají:** `api/routes.js` zůstává mrtvý, nenamountovaný a nefunkční kód beze změny.
- **Nový úklidový dluh:** starý `google-disk-abl.js` (Drive) zůstal v repu jako nepoužívaný kód po
  migraci — nikdo ho nesmazal (viz [[cleanup-scratch-artifacts]]).
- **Rozhodnutí o ACL modelu:** `public: true` v `bucket.upload()` je legacy per-object ACL
  (vyžaduje *Fine-grained access control* na bucketu) — nekombinuje se s Uniform bucket-level
  access + IAM grantem, který zafixovala kapitola 6/R4. `caio-server` jde cestou Uniform, ne touhle.

**Závěr:** branch je dobrý důkaz proveditelnosti (Drive → GCS jde a funguje v produkci), ale jako
zdroj kódu k okopírování ne — přenáší dál skoro celou kapitolu 2 nálezů. Fáze 1 v kapitole 4 tím
zůstává beze změny, jen R3 a R4/kapitola 6 jsou teď zpřesněné o to, co konkrétně nedělat.
