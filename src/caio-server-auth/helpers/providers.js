import googlePkg from "passport-google-oauth20";
import facebookPkg from "passport-facebook";

const { Strategy: GoogleStrategy } = googlePkg;
const { Strategy: FacebookStrategy } = facebookPkg;

/**
 * The identity providers this module can sign somebody in with.
 *
 * A provider is only offered when its credentials are in the environment: the strategy
 * is not registered, its routes answer "not configured", and /auth/config leaves it out
 * of providerList so a login page never shows a button that cannot work. Constructing a
 * strategy without credentials used to be unconditional, and
 * new GoogleStrategy({ clientID: "" }) throws "OAuth2Strategy requires a clientID
 * option" -- which kept a freshly scaffolded app from starting at all, even one with no
 * login of its own.
 *
 * `credentials()` reads the environment on each call rather than at import, because env
 * files are loaded by the app, and tests set variables as they go.
 */
export const PROVIDERS = {
  google: {
    callbackUc: "google/callback",
    scope: ["profile", "email"],
    envKeys: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
    credentials: () => ({
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
    createStrategy: (options, verify) => new GoogleStrategy(options, verify),
    /** Maps a provider profile onto what Identity.loginWithProvider() expects. */
    mapProfile: (profile) => ({
      providerId: profile.id,
      email: profile.emails?.[0]?.value,
      // Google states this in the id token. Without it the e-mail must not be used to
      // claim an existing identity.
      emailVerified: profile._json?.email_verified ?? profile.emails?.[0]?.verified ?? false,
      data: {
        name: profile.displayName,
        firstName: profile.name?.givenName,
        surname: profile.name?.familyName,
        photo: profile.photos?.[0]?.value,
      },
    }),
  },

  facebook: {
    callbackUc: "facebook/callback",
    scope: ["email"],
    // Meta's console calls them App ID and App Secret; passport calls the same two
    // clientID and clientSecret.
    envKeys: ["FACEBOOK_APP_ID", "FACEBOOK_APP_SECRET"],
    credentials: () => ({
      clientID: process.env.FACEBOOK_APP_ID,
      clientSecret: process.env.FACEBOOK_APP_SECRET,
    }),
    createStrategy: (options, verify) =>
      // Facebook hands over nothing but the id unless the fields are asked for.
      new FacebookStrategy({ ...options, profileFields: ["id", "displayName", "name", "photos", "email"] }, verify),
    mapProfile: (profile) => ({
      providerId: profile.id,
      email: profile.emails?.[0]?.value,
      // Facebook only ever returns an address the account has confirmed -- and often
      // returns none at all, which Identity.create() handles (docs/auth.md, R4).
      emailVerified: !!profile.emails?.[0]?.value,
      data: {
        name: profile.displayName,
        firstName: profile.name?.givenName,
        surname: profile.name?.familyName,
        photo: profile.photos?.[0]?.value,
      },
    }),
  },
};

/** Every provider name the module knows, configured or not. */
export function getProviderNames() {
  return Object.keys(PROVIDERS);
}

export function isConfigured(name) {
  const provider = PROVIDERS[name];
  if (!provider) return false;
  const credentials = provider.credentials();
  return Object.values(credentials).every((value) => typeof value === "string" && value.length > 0);
}

/** Providers this deployment can actually sign somebody in with. */
export function getProviderList() {
  return getProviderNames().filter(isConfigured);
}

/** Names the environment variables a provider is missing, for a log line. */
export function getMissingEnvKeys(name) {
  const provider = PROVIDERS[name];
  if (!provider) return [];
  return provider.envKeys.filter((key) => !process.env[key]);
}
