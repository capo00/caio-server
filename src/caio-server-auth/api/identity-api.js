import identityDao from "../dao/identity-dao.js";
import Identity from "../abl/identity.js";

// Editing identities and handing out roles is the one privilege that is the same in every
// project on this stack, so the profile is fixed here rather than configurable: only
// `authorities` may touch identities. (It used to say "owner" -- a profile no app defines.)
const ADMIN_PROFILE = "authorities";

// Not UuAppDataTypes: `.exact(...)` doesn't actually work (the package has no default
// export, and `.exact`/`.arrayOf` don't exist on it either -- this module used to import
// it and never ran because of that). Plain validators, same fix as binary-api.js.
function requireId({ dtoIn }) {
  if (typeof dtoIn?.id !== "string" || !dtoIn.id) {
    throw new Error("dtoIn.id is required and must be a non-empty string");
  }
  return dtoIn;
}

// The bcrypt hash and the password-reset token have no business reaching a browser,
// not even an admin's.
function stripSecrets({ password, resetTokenHash, resetTokenExpireTime, ...rest }) {
  return rest;
}

const identityApi = {
  "identity/search": {
    method: "get",
    auth: true,
    fn: async ({ dtoIn }) => {
      const itemList = await Identity.search(dtoIn?.query);
      return { itemList };
    },
  },

  "identity/list": {
    method: "get",
    auth: true,
    fn: async ({ dtoIn }) => {
      const itemList = await Identity.list(dtoIn ?? {});
      return { itemList };
    },
  },

  "identity/get": {
    method: "get",
    fn: ({ dtoIn, identity }) => Identity.get(dtoIn ?? {}, identity),
  },

  // Admin-only variant of identity/list: Identity.list()/.get() deliberately strip
  // everything but display fields (name/photo), so a directory lookup never leaks
  // e-mail or profileList to another signed-in user. A back-office table (e.g.
  // caio_propertyman's home page) needs the rest -- email, profileList,
  // registrationType, provider ids, sys.cts/mts -- so this reads the dao directly
  // instead of going through Identity's public-data getters. Only the bcrypt hash is
  // withheld; there is no reason for it to ever reach a browser.
  "identity/adminList": {
    method: "get",
    auth: [ADMIN_PROFILE],
    fn: async () => {
      const itemList = await identityDao.list();
      return { itemList: itemList.map(stripSecrets) };
    },
  },

  // Raw field update: the client sends back whatever it edited (e.g. in a JSON view),
  // no per-field validation. `password` is dropped unconditionally -- it must stay a
  // bcrypt hash produced by register/login, never a plaintext value pasted into an
  // admin textarea.
  "identity/update": {
    method: "post",
    auth: [ADMIN_PROFILE],
    validator: requireId,
    fn: async ({ dtoIn }) => {
      const { id, password, ...data } = dtoIn;
      const updated = await identityDao.update({ id, ...data });
      return stripSecrets(updated);
    },
  },
};

export default identityApi;
