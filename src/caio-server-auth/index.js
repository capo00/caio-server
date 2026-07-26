import Passport from "./helpers/passport.js";
import Routes from "./api/routes.js";
import authentication, { registerCookieName } from "./api/authentication.js";
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
};

export default Authentication;
