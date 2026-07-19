const Passport = require('./helpers/passport');
const Routes = require('./api/routes');
const authentication = require("./api/authentication");
const { registerCookieName } = require("./api/authentication");
const { IdentityDao } = require('./dao/identity-dao');
const { createIdentity } = require('./abl/identity');

module.exports = {
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
}
