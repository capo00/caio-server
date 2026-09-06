import Binary from "../abl/binary-abl.js";
import { Error as CoreError } from "../../caio-server-core/index.js";

// Not UuAppDataTypes: identity-api.js's `UuAppDataTypes.exact(...)` doesn't actually work (the
// package has no default export, and `.exact`/`.arrayOf` don't exist on it either -- see the
// binary.md note flagged alongside this module). Plain validators until that's sorted out.
function requireId({ dtoIn }) {
  if (typeof dtoIn?.id !== "string" || !dtoIn.id) {
    throw new Error("dtoIn.id is required and must be a non-empty string");
  }
  return dtoIn;
}

function requireIdList({ dtoIn }) {
  if (!Array.isArray(dtoIn?.idList) || dtoIn.idList.length === 0) {
    throw new Error("dtoIn.idList is required and must be a non-empty array");
  }
  return dtoIn;
}

function requireCollection({ dtoIn }) {
  if (typeof dtoIn?.collection !== "string" || !dtoIn.collection) {
    throw new Error("dtoIn.collection is required and must be a non-empty string");
  }
  return dtoIn;
}

function unknownCollection(collection) {
  return new CoreError(`Unknown binary collection "${collection}"`, {
    status: 400,
    code: "caio-server-binarystore/unknownCollection",
    paramMap: { collection },
  });
}

/**
 * Evaluates one operation's rule.
 *
 * `undefined` -> no auth. `true` -> any signed-in user. `{ profileList }` -> at least one
 * matching profile. `{ identityList }` -> named identities, regardless of role.
 * `{ authorize }` -> the app decides, and gets the stored record when there is one.
 */
async function isAllowed(rule, { dtoIn, identity, req, binary }) {
  if (rule === undefined || rule === null) return true;
  if (rule === true) return Boolean(identity);
  if (!identity) return false;

  if (typeof rule === "function") return Boolean(await rule({ dtoIn, identity, req, binary }));
  if (rule.authorize) return Boolean(await rule.authorize({ dtoIn, identity, req, binary }));
  if (rule.identityList?.includes(identity.identity)) return true;
  if (rule.profileList) {
    return (identity.profileList ?? []).some((profile) => rule.profileList.includes(profile));
  }
  return false;
}

/** Per-operation rule for a collection, falling back to its `read` / `write` shorthand. */
function ruleFor(collectionConfig, operation) {
  if (!collectionConfig) return undefined;
  if (operation in collectionConfig) return collectionConfig[operation];

  const isRead = operation === "list" || operation === "get";
  // deleteMany is the same operation as delete, just batched, so it follows `write`
  // rather than needing its own entry.
  return isRead ? collectionConfig.read : collectionConfig.write;
}

/**
 * Registers the six `binary/*` use-cases the client's
 * `UiElements.CrudContext.create("binary")` expects.
 *
 * Files are grouped into named **collections** (`sys`, `article`, `gallery`, ...) and each
 * collection carries its own authorization -- one rule for all binaries is not enough: the
 * person who uploads gallery photos should not be able to replace the club logo.
 *
 * ```js
 * BinaryStore.createApi({
 *   collectionMap: {
 *     sys:     { write: { profileList: ["operatives"] } },
 *     gallery: { write: { profileList: ["galleryEditor", "operatives"] } },
 *     file:    { read: true, write: { identityList: ["1-1-1"] } },
 *   },
 * })
 * ```
 *
 * Where the collection comes from:
 * - `create` and `list` -- `dtoIn.collection` (required),
 * - `get`, `update`, `delete`, `deleteMany` -- **the stored record**, never `dtoIn`, so a
 *   caller cannot claim a collection they are allowed to write.
 */
function createApi({ collectionMap = {} } = {}) {
  function collectionConfig(collection) {
    const config = collectionMap[collection];
    if (!config) throw unknownCollection(collection);
    return config;
  }

  /** For create/list: the collection is stated in dtoIn. */
  function authByDtoIn(operation) {
    return async ({ dtoIn, identity, req }) =>
      isAllowed(ruleFor(collectionConfig(dtoIn?.collection), operation), { dtoIn, identity, req });
  }

  /**
   * For operations on existing files: load the record first, decide second. That is one
   * extra read per call, and it is the whole point -- `dtoIn` cannot be trusted to say
   * which collection a file is in.
   */
  function authByRecord(operation, getIdList = (dtoIn) => [dtoIn?.id]) {
    return async ({ dtoIn, identity, req }) => {
      const idList = getIdList(dtoIn).filter(Boolean);
      if (!idList.length) return false;

      const binaryList = await Promise.all(idList.map((id) => Binary.get(id).catch(() => null)));

      // A missing record is not an authorization answer; let the handler produce the 404.
      const existing = binaryList.filter(Boolean);
      if (!existing.length) return true;

      // Every file has to pass. Deleting "the ones you may" would silently do something
      // other than what was asked for.
      for (const binary of existing) {
        const rule = ruleFor(collectionConfig(binary.collection), operation);
        if (!(await isAllowed(rule, { dtoIn, identity, req, binary }))) return false;
      }
      return true;
    };
  }

  return {
    "binary/list": {
      method: "get",
      auth: authByDtoIn("list"),
      validator: requireCollection,
      // Vrací `pageInfo` -- `UiElements.Crud` bez `total` druhou stránku nenačte.
      fn: ({ dtoIn }) => Binary.listPage(dtoIn ?? {}),
    },

    "binary/get": {
      method: "get",
      auth: authByRecord("get"),
      validator: requireId,
      fn: ({ dtoIn }) => Binary.get(dtoIn.id),
    },

    "binary/create": {
      method: "post",
      auth: authByDtoIn("create"),
      validator: requireCollection,
      fn: ({ dtoIn }) => Binary.create(dtoIn),
    },

    "binary/update": {
      method: "post",
      auth: authByRecord("update"),
      validator: requireId,
      fn: ({ dtoIn }) => Binary.update(dtoIn),
    },

    "binary/delete": {
      method: "post",
      auth: authByRecord("delete"),
      validator: requireId,
      fn: ({ dtoIn }) => Binary.delete(dtoIn.id),
    },

    "binary/deleteMany": {
      method: "post",
      auth: authByRecord("deleteMany", (dtoIn) => dtoIn?.idList ?? []),
      validator: requireIdList,
      fn: ({ dtoIn }) => Binary.deleteMany(dtoIn.idList),
    },
  };
}

export default createApi;
