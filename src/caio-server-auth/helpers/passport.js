const GoogleStrategy = require("passport-google-oauth20").Strategy;
const passport = require("passport");
const DefaultIdentity = require("../abl/identity");
const Config = require("../config/config");

module.exports = {
  init(prefixPath = "", identity = DefaultIdentity, strategyName = "google") {
    passport.use(
      strategyName,
      new GoogleStrategy(
        {
          clientID: Config.google.clientId,
          clientSecret: Config.google.clientSecret,
          callbackURL: prefixPath + "/" + Config.google.callbackUc,
        },
        async (accessToken, refreshToken, profile, done) => {
          try {
            let found = await identity.findByGoogleId(profile.id);
            if (found) {
              done(null, found);
            } else {
              found = await identity.create({
                email: profile.emails[0].value,
                name: profile.displayName,
                firstName: profile.name.givenName,
                surname: profile.name.familyName,
                photo: profile.photos[0]?.value,
                registrationType: "google",
                googleId: profile.id,
              });
              done(null, found);
            }
          } catch (err) {
            console.error("Unexpected error during working with Identity.", err);
            done(err, null);
          }
        }
      )
    );

    passport.serializeUser((user, done) => done(null, user.id));
    passport.deserializeUser((id, done) => {
      identity.get(id).then((user) => done(null, user)).catch((err) => done(err, null));
    });
  }
}
