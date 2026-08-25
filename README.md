# App Server

- based on `express`

## API

### App

#### init({ api = {}, publicPath = "../../../../public", authList })

| Param        | Desc                                                                                                                                     |
|--------------|------------------------------------------------------------------------------------------------------------------------------------------|
| `api`        | Each api is defined as `useCase` with an object with `method` as String and `fn` as function, which returns object as dtoOut of the api. |
| `publicPath` | Path is used for static files like assets and for index.html.                                                                            |
| `authList`   | Array of additional authentication configurations for multi-tenant auth. Each item is passed to `Authentication.init(app, cfg)`.          |

| fn params    | Desc                                            |
|--------------|-------------------------------------------------|
| `useCase`    | Code of the use case.                           |
| `method`     | HTTP method - `get` or `post`.                  |
| `dtoIn`      | Input data to command.                          |
| `identity`   | Authenticated user identity (from JWT cookie).  |
| `req`        | Whole object of request.                        |
| `res`        | Whole object of response.                       |
| `next`       | Express next function.                          |
| `publicPath` | Path to static files directory.                 |

Each use case in the `api` object can also define:

| Param       | Desc                                                                                                   |
|-------------|--------------------------------------------------------------------------------------------------------|
| `auth`      | Set `true` to require authentication, or pass an array of profiles (e.g. `["Admin"]`) for authorization. |
| `validator` | Validation function `(obj, key) => validatedObj`. Validates dtoIn before the handler is called.         |

```
const app = App.init({
    publicPath: path.resolve(__dirname, "public"),
    api: {
        "team/list": {
            method: "get",
            auth: true,
            
            // pattern: https://.../<useCase>?<key>=<value>
            // example: https://.../team/list?league=I
            // => useCase = "team/list", method = "get", dtoIn = { league: "I" }
            fn: async ({ useCase, method, dtoIn, identity, req, res }) => {
                return { name: "..." }; // object with some data is returned as dtoOut
            }
        },

        "team/create": {
            method: "post",
            auth: ["Admin", "Manager"],

            fn: async ({ dtoIn, identity }) => {
                return await TeamCrud.create(dtoIn);
            }
        }
    }
});
```

A built-in `sys/health` endpoint is always registered and returns `{ version }` from `package.json`.

---

### Error

Base application error class. Extends native `Error` with structured error data.

#### new Error(msg, { cause, code, paramMap, dtoOut, message, status = 500 })

| Param      | Desc                                                       |
|------------|-------------------------------------------------------------|
| `msg`      | Error message.                                              |
| `code`     | Application error code (e.g. `"myApp/entity/createFailed"`). |
| `status`   | HTTP status code. Default: `500`.                           |
| `paramMap` | Object with additional error parameters.                    |
| `dtoOut`   | Partial output data to include in error response.           |
| `cause`    | Original error that caused this one.                        |
| `message`  | Overrides `msg` if provided.                                |

#### toObject()

Returns a plain object representation of the error: `{ message, code, paramMap, dtoOut, cause }`.

#### Error.DoesNotExists(msg, { codePrefix, ...opts })

Subclass with `status: 404`. The error code is built as `codePrefix + "/doesNotExist"`.

#### Error.Failed(msg, opts)

Subclass with `status: 500`.

```
const { Error } = require("caio-server");

class PlayerError extends Error {
  constructor(msg, opts) {
    super(msg, { code: "myApp/player/failed", ...opts });
  }
}

throw new Error.DoesNotExists("Player not found", { codePrefix: "myApp/player" });
// => code: "myApp/player/doesNotExist", status: 404
```

---

### Crud

Generic CRUD business logic layer over a DAO instance. Wraps DAO calls with typed error handling.

#### new Crud(name, dao)

| Param  | Desc                                              |
|--------|---------------------------------------------------|
| `name` | Entity name used in error codes (e.g. `"player"`). |
| `dao`  | DAO instance (see `Dao`).                          |

#### Methods

| Method                            | Desc                                                                                         |
|-----------------------------------|----------------------------------------------------------------------------------------------|
| `list({ pageInfo, idList })`      | Lists items. Uses `idList` if provided, otherwise paginates with `pageInfo`.                 |
| `get(id)`                         | Gets a single item by id. Throws `Crud.Error.DoesNotExists` if not found.                   |
| `create(data)`                    | Creates an item. Throws `Crud.Error.CreateFailed` on error.                                 |
| `createMany(data)`                | Creates multiple items. Throws `Crud.Error.CreateManyFailed` on error.                      |
| `update(data, { merge = true })`  | Updates an item. With `merge: true` (default), merges with existing data before saving.      |
| `delete(id)`                      | Deletes an item by id. Throws `Crud.Error.DeleteFailed` on error.                           |
| `deleteMany(idList)`              | Deletes multiple items. Throws `Crud.Error.DeleteManyFailed` on error.                      |

#### Crud.Error

| Error class       | Status | Code suffix        |
|--------------------|--------|--------------------|
| `DoesNotExists`    | 404    | `/doesNotExist`    |
| `CreateFailed`     | 500    | `/createFailed`    |
| `CreateManyFailed` | 500    | `/createManyFailed`|
| `UpdateFailed`     | 500    | `/updateFailed`    |
| `DeleteFailed`     | 500    | `/deleteFailed`    |
| `DeleteManyFailed` | 500    | `/deleteManyFailed`|

All error codes are prefixed with `caio-server/<name>/`.

```
const { Crud, Dao } = require("caio-server");

const playerDao = new Dao("player");
const playerCrud = new Crud("player", playerDao);

// in use case handler
const player = await playerCrud.create({ firstName: "John", surname: "Doe" });
const list = await playerCrud.list({ pageInfo: { pageSize: 10, pageIndex: 0 } });
const updated = await playerCrud.update({ id: player.id, firstName: "Jane" });
await playerCrud.delete(player.id);
```

You can extend `Crud` to add custom business logic:

```
class PlayerCrud extends Crud {
  constructor() {
    super("player", playerDao);
  }

  async create(data) {
    // custom logic before create
    return await super.create(data);
  }
}
```

---

### Dao

Generic MongoDB data access object. Handles connection pooling, `id`/`_id` conversion, and automatic `sys.cts`/`sys.mts` timestamps.

#### new Dao(collectionName, { uri })

| Param            | Desc                                                                  |
|------------------|-----------------------------------------------------------------------|
| `collectionName` | MongoDB collection name.                                              |
| `uri`            | MongoDB connection string. Defaults to `MONGODB_URI` from env config. |

#### Methods

| Method                                                | Desc                                                                       |
|-------------------------------------------------------|----------------------------------------------------------------------------|
| `createIndex(keys, opts)`                             | Creates an index on the collection.                                        |
| `find(filter, { pageSize, pageIndex }, sort, projection)` | Finds documents matching filter with pagination. Default `pageSize`: 1000. |
| `findOne(filter, projection, sort)`                   | Returns first matching document or `null`.                                 |
| `list(pageInfo)`                                      | Lists all documents with optional pagination.                              |
| `listByIdList(idList)`                                | Finds documents by an array of ids.                                        |
| `get(id)`                                             | Gets a single document by `id`.                                            |
| `create(data)`                                        | Inserts a document. Adds `sys: { cts, mts }`. Key `sys` in data is reserved and throws `DaoError`. |
| `createMany(dataList)`                                | Inserts multiple documents with timestamps.                                |
| `update(data)`                                        | Updates a document by `id`. Updates `sys.mts` timestamp.                   |
| `delete(id)`                                          | Deletes a document by `id`.                                                |
| `deleteMany(idList)`                                  | Deletes multiple documents by ids.                                         |
| `deleteByFilter(filter)`                              | Deletes all documents matching filter.                                     |

```
const { Dao } = require("caio-server");

class PlayerDao extends Dao {
  constructor() {
    super("player");
  }

  createIndexes() {
    this.createIndex({ "sys.cts": -1 });
  }

  findByTeam(teamId) {
    return this.find({ teamId });
  }
}

const playerDao = new PlayerDao();
```

---

### DaoError

DAO-specific error class. Automatically prefixes error code with `caio-server-dao/`.

#### new DaoError(msg, code)

| Param | Desc                                                              |
|-------|-------------------------------------------------------------------|
| `msg` | Error message.                                                    |
| `code`| Error code suffix. Stored as `"caio-server-dao/" + code`.        |

---

### Authentication

Google OAuth 2.0 and email/password authentication module. Manages identity, JWT cookies, and provides authentication middleware.

#### Authentication.init(app, { prefixPath = "/auth", collectionName })

Mounts authentication routes on the Express app.

| Param            | Desc                                                                                               |
|------------------|----------------------------------------------------------------------------------------------------|
| `app`            | Express app instance.                                                                              |
| `prefixPath`     | URL prefix for auth routes. Default: `"/auth"`.                                                    |
| `collectionName` | Enables multi-tenant auth. Creates a separate identity collection, Passport strategy, and cookie.  |

Registered routes (relative to `prefixPath`):

| Route                       | Method | Desc                                                              |
|-----------------------------|--------|-------------------------------------------------------------------|
| `/`                         | GET    | Returns current identity from JWT cookie.                         |
| `/config`                   | GET    | What a login page needs to render itself: `{ providerList, password: { minLength, maxBytes, patternSource, patternFlags } }`. `providerList` holds only the providers this deployment has credentials for. |
| `/register`                 | POST   | Registers a new identity with `{ firstName, surname, email, password }`. Validates the e-mail and the password rule, and answers with basic data only -- never the stored hash. |
| `/login`                    | POST   | Logs in with `{ email, password }`. Sets JWT cookie, answers with basic data. |
| `/logout`                   | POST   | Clears JWT cookie.                                                |
| `/google`                   | GET    | Initiates Google OAuth flow.                                      |
| `/google/callback`          | GET    | Google OAuth callback. Sets JWT cookie and closes popup.          |
| `/facebook`                 | GET    | Initiates Facebook OAuth flow.                                    |
| `/facebook/callback`        | GET    | Facebook OAuth callback. Same as Google.                          |

Errors come back as `{ error: { code, message } }` with codes prefixed `caio-server-auth/`:
`invalidEmail`, `passwordTooShort` / `passwordTooLong` / `passwordTooSimple`, `identityExists`,
`invalidCredentials`, `invalidJson`, `bodyTooLarge`.

**One identity per e-mail.** Google, Facebook and a password all live on the same document
(`googleId`, `facebookId`, `password`), and `getBasicData()` returns an `authMethodList` derived
from them. Signing in through a provider pairs onto an existing identity by e-mail and stores the
provider id on it -- but only when the provider says the e-mail is verified, otherwise anyone able
to set a foreign address at some provider could take the account over. Two consequences worth
knowing:

- registering a password on an e-mail that already has an identity is refused (`identityExists`)
  and the message names the ways in that do work. Nothing here proves the address belongs to
  whoever is asking; until e-mail verification exists, this direction cannot be automatic.
- a provider handing over an **unverified** e-mail that already belongs to an identity is refused
  with `409 identity/emailNotVerified` rather than creating a second account.

The rationale, the decisions behind it and what is still open live in [docs/auth.md](docs/auth.md).

**A provider is only offered when it is configured.** The strategy for a provider whose
credentials are missing from the environment is not registered at all (constructing one throws,
which used to keep an app with no Google credentials from starting), the provider is left out of
`/auth/config`, and its routes answer that it is unavailable. Its routes stay registered on
purpose: an unregistered path has no extension, so it would fall through to the SPA fallback and
come back as `index.html` with status 200. Which providers exist and what each one needs is in
`caio-server-auth/helpers/providers.js`.

**A failed provider sign-in renders a page, not JSON.** The popup is looked at by a person, so
`/auth/<provider>` and its callback answer `assets/callback-error.html` with the message --
a refused pairing, a provider declining, a database outage -- instead of express' default HTML
error page with a stack trace. The page also posts `{ type: "authError", message, code }` to the
opener, so the app can stop waiting, and it stays open so the reason remains readable.

The password rule (`minLength: 10`, at most 72 bytes -- bcrypt's own limit -- one lower-case, one
upper-case, one digit) sits in `caio-server-auth/config` and is served from `/auth/config`, so a
client never has to repeat it.

#### Authentication.authentication

Express middleware that verifies the JWT cookie and attaches `req.identity`. Returns `401` if no valid token is found. Use via `auth` parameter in use case definition.

```
const { App, Authentication } = require("caio-server");

// Basic setup - automatically called by App.init()
const app = App.init({
    api: {
        "player/list": {
            method: "get",
            auth: true, // requires authentication
            fn: async ({ dtoIn, identity }) => {
                console.log(identity); // { identity: "123-456-1", name: "John", email: "..." }
                return { itemList: [] };
            }
        }
    }
});

// Multi-tenant auth - separate identity collections
const app = App.init({
    authList: [
        { prefixPath: "/auth/tenant1", collectionName: "tenant1_identity" },
        { prefixPath: "/auth/tenant2", collectionName: "tenant2_identity" },
    ],
    api: { ... }
});
```

Pre-built identity use cases are available in `caio-server-auth/api/identity-api`:

| Use case          | Method | Auth | Desc                                         |
|-------------------|--------|------|----------------------------------------------|
| `identity/search` | GET    | yes  | Searches identities by query string.         |
| `identity/list`   | GET    | yes  | Lists identities by `idList` or `identityList`. |
| `identity/get`    | GET    | no   | Gets identity by `id` or `identity` code.    |

---

### BinaryStore

Binary file storage module using Google Drive for file storage and MongoDB for metadata.

#### BinaryStore.init(app, { googleDiskAuthPath, prefixPath = "/binary" })

Initializes the binary store configuration.

| Param               | Desc                                            |
|----------------------|-------------------------------------------------|
| `app`                | Express app instance.                           |
| `googleDiskAuthPath` | Path to Google service account key file.        |
| `prefixPath`         | URL prefix for binary routes. Default: `"/binary"`. |

#### BinaryStore.Binary

Singleton instance of `BinaryAbl` (extends `Crud`). Manages file upload, update, and deletion.

| Method                      | Desc                                                                        |
|-----------------------------|-----------------------------------------------------------------------------|
| `create({ file, name, ...data })` | Uploads file to Google Drive and stores metadata in MongoDB.          |
| `update({ id, file, name, ...data })` | Updates file content and/or metadata.                             |
| `delete(id)`                | Deletes file from Google Drive and removes metadata.                        |
| `list({ pageInfo, idList })`| Lists binary metadata (inherited from `Crud`).                              |
| `get(id)`                   | Gets binary metadata by id (inherited from `Crud`).                         |
| `parseFormDataRequest(req)` | Parses multipart/form-data request. Used internally by command handler.     |

The returned data includes a `uri` field with the Google Drive file URL.

```
const { BinaryStore } = require("caio-server");

// in use case handler
const binary = await BinaryStore.Binary.create({
    file: dtoIn.file, // from multipart/form-data
    name: "photo.jpg",
});
// => { id, name, size, mimeType, uri, sys: { cts, mts } }

await BinaryStore.Binary.delete(binary.id);
```

---

## ENV

- add `.env` file next to `package.json` and configure your App:
- in development mode (`NODE_ENV=development`), the app loads `.env.development` instead

| Param                        | Desc                                                                                                                           |
|------------------------------|--------------------------------------------------------------------------------------------------------------------------------|
| NODE_ENV                     | Environment mode. Set to `development` to load `.env.development` file. Affects cookie security and MongoDB SSL.               |
| PORT                         | Port on which the server will run.<br/>Default: 8080                                                                           |
| MONGODB_URI                  | Uri of the mongo database. Required for authentication and creating identity.                                                  |
| GOOGLE_CLIENT_ID             | Google client id from Google Console -> APIs & Services -> Credentials -> OAuth. **Optional**: without it (or without the secret) Google sign-in is simply not offered -- no strategy, not in `/auth/config`, and its routes say so. |
| GOOGLE_CLIENT_SECRET         | Google secret key, generated together with the client id. Optional, see above.                                                 |
| FACEBOOK_APP_ID              | Facebook App ID from developers.facebook.com (Meta calls it App ID, passport calls it clientID). **Optional**, same rule as Google: without both values Facebook sign-in is not offered. |
| FACEBOOK_APP_SECRET          | Facebook App Secret. Optional, see above.                                                                                      |
| GOOGLE_OAUTH_URL             | Uri for log in the user.<br/>Default: https://accounts.google.com/o/oauth2/v2/auth                                             |
| GOOGLE_ACCESS_TOKEN_URL      | Uri for getting access token.<br/>Default: https://oauth2.googleapis.com/token                                                 |
| GOOGLE_TOKEN_INFO_URL        | Uri for getting info about the user.<br/>Default: https://oauth2.googleapis.com/tokeninfo                                      |
| GOOGLE_CALLBACK_UC           | Use case for callback for Google.<br/>Default: google/callback                                                                 |
| JWT_SECRET                   | Secret key for App token.<br/>Default: GOOGLE_CLIENT_SECRET                                                                    |
| JWT_LIFETIME                 | Time to live for the token.<br/>Default: 1d                                                                                    |
| GOOGLE_DISK_PUBLIC_FOLDER_ID | Google Drive folder ID for binary file uploads. Required for BinaryStore.                                                      |
