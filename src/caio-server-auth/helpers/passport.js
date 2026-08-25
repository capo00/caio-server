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
            // Pairing an existing account with this provider is the ABL's job, so that
            // Google and Facebook cannot drift apart -- see Identity.loginWithProvider
            // and docs/auth.md, 5.1.
            const found = await identity.loginWithProvider({
              provider: "google",
              providerId: profile.id,
              email: profile.emails?.[0]?.value,
              // Google says so in the id token; without it the e-mail must not be
              // used to claim an existing identity.
              emailVerified: profile._json?.email_verified ?? profile.emails?.[0]?.verified ?? false,
              data: {
                name: profile.displayName,
                firstName: profile.name?.givenName,
                surname: profile.name?.familyName,
                photo: profile.photos?.[0]?.value,
              },
            });
            done(null, found);
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
