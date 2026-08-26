import Binary from "../abl/binary-abl.js";

/** { profileList } -> auth as a profile array; { authorize } -> auth as a custom async fn; nothing -> no auth. */
function toAuth(useCaseConfig) {
  if (!useCaseConfig) return undefined;
  if (useCaseConfig.authorize) return useCaseConfig.authorize;
  if (useCaseConfig.profileList) return useCaseConfig.profileList;
  return true;
}

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

/**
 * Use-case names and behavior match afkbratcice's server/api/binary-api.js so the client
 * (UiElements.CrudContext.create("binary")) works unmodified (docs/binary.md, R1).
 */
function createApi({ list, get, create, update, delete: del, deleteMany } = {}) {
  return {
    "binary/list": {
      method: "get",
      auth: toAuth(list),
      fn: async ({ dtoIn }) => {
        const itemList = await Binary.list(dtoIn ?? {});
        return { itemList };
      },
    },

    "binary/get": {
      method: "get",
      auth: toAuth(get),
      validator: requireId,
      fn: ({ dtoIn }) => Binary.get(dtoIn.id),
    },

    "binary/create": {
      method: "post",
      auth: toAuth(create) ?? true,
      fn: ({ dtoIn }) => Binary.create(dtoIn),
    },

    "binary/update": {
      method: "post",
      auth: toAuth(update) ?? true,
      fn: ({ dtoIn }) => Binary.update(dtoIn),
    },

    "binary/delete": {
      method: "post",
      auth: toAuth(del) ?? true,
      validator: requireId,
      fn: ({ dtoIn }) => Binary.delete(dtoIn.id),
    },

    // Same auth as delete unless the app configures it separately -- it is the same
    // operation, just batched (docs/binary.md, phase 4: CrudContext's bulk-delete button
    // always calls this use-case).
    "binary/deleteMany": {
      method: "post",
      auth: toAuth(deleteMany) ?? toAuth(del) ?? true,
      validator: requireIdList,
      fn: ({ dtoIn }) => Binary.deleteMany(dtoIn.idList),
    },
  };
}

export default createApi;
