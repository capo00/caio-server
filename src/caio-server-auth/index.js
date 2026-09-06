import Passport from "./helpers/passport.js";
import Routes from "./api/routes.js";
import authentication, { registerCookieName, resolveIdentity } from "./api/authentication.js";
import identityApi from "./api/identity-api.js";
import { IdentityDao } from "./dao/identity-dao.js";
import { createIdentity } from "./abl/identity.js";

const Authentication = {
  init(app, { prefixPath = "/auth", collectionName } = {}) {
    let identity;
    let strategyName = "google";
    let cookieName = "token";

    if (collectionName) {
      const dao = new IdentityDao(collectionName);
      identity = createIdentity(dao, collectionName);
      strategyName = "google-" + collectionName;
      cookieName = "token_" + collectionName;
      registerCookieName(cookieName);
    }

    Passport.init(prefixPath, identity, strategyName);
    app.use(prefixPath, Routes.init(prefixPath, identity, strategyName, cookieName));
  },

  authentication,

  // Non-rejecting counterpart of `authentication`: fills req.identity when there is a
  // valid cookie and lets everything through. Command.createCommands() puts it in front
  // of every use-case, public ones included.
  resolveIdentity,

  // Same convention as BinaryStore.createApi(): the appka decides whether to merge
  // this into its `api` map (it uses the default "sys_identity" collection, so it is
  // only meaningful for apps that don't run a custom `collectionName`).
  createApi: () => identityApi,
};

export default Authentication;
