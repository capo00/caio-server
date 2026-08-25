import passport from "passport";
import DefaultIdentity from "../abl/identity.js";
import { PROVIDERS, getProviderList, getMissingEnvKeys, isConfigured } from "./providers.js";

/**
 * Registers a passport strategy for every provider whose credentials are in the
 * environment, and only for those -- a provider without credentials is simply not
 * offered (see providers.js).
 *
 * The verify callback does nothing but hand the profile to
 * Identity.loginWithProvider(), which is where pairing an existing account with a
 * provider lives, so every provider behaves the same way.
 */
const Passport = {
  init(prefixPath = "", identity = DefaultIdentity, strategyName = "google") {
    for (const [name, provider] of Object.entries(PROVIDERS)) {
      if (!isConfigured(name)) {
        console.log(
          `[caio-server-auth] ${name} sign-in is off, missing: ${getMissingEnvKeys(name).join(", ")}`,
        );
        continue;
      }

      passport.use(
        Passport.strategyName(name, strategyName),
        provider.createStrategy(
          { ...provider.credentials(), callbackURL: prefixPath + "/" + provider.callbackUc },
          async (accessToken, refreshToken, profile, done) => {
            try {
              done(null, await identity.loginWithProvider({ provider: name, ...provider.mapProfile(profile) }));
            } catch (err) {
              console.error("Unexpected error during working with Identity.", err);
              done(err, null);
            }
          },
        ),
      );
    }

    if (!getProviderList().length) {
      console.log("[caio-server-auth] no provider sign-in configured, e-mail and password only");
    }

    passport.serializeUser((user, done) => done(null, user.id));
    passport.deserializeUser((id, done) => {
      identity.get(id).then((user) => done(null, user)).catch((err) => done(err, null));
    });
  },

  /**
   * Auth.init() passes a strategy name that carries the identity collection for
   * multi-tenant setups ("google" or "google-<collection>"); every provider gets the
   * same suffix so the strategies of one tenant stay together.
   */
  strategyName(provider, baseName = "google") {
    const suffix = baseName.startsWith("google-") ? baseName.slice("google-".length) : null;
    return suffix ? `${provider}-${suffix}` : provider;
  },
};

export default Passport;
