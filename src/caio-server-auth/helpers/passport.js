import pkg from "passport-google-oauth20";
const { Strategy: GoogleStrategy } = pkg;
import passport from "passport";
import DefaultIdentity from "../abl/identity.js";
import Config from "../config/config.js";

const Passport = {
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
};

export default Passport;
