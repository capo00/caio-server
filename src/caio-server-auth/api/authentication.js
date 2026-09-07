import jwt from "jsonwebtoken";
import Config from "../config/config.js";
import defaultIdentityDao from "../dao/identity-dao.js";

// Which dao belongs to which cookie. An app that runs `Authentication.init({ collectionName })`
// gets its own collection and its own cookie, so the identity has to be looked up in the
// collection the token was issued for -- not in whatever the default is.
const daoByCookieName = new Map([["token", defaultIdentityDao]]);

function registerCookieName(name, dao = defaultIdentityDao) {
  daoByCookieName.set(name, dao);
}

/** The signed payload, or null. Says **who** is asking -- nothing about what they may do. */
function readToken(req) {
  for (const cookieName of daoByCookieName.keys()) {
    const token = req.cookies?.[cookieName];
    if (token) {
      try {
        return { payload: jwt.verify(token, Config.token.jwtSecret), cookieName };
      } catch (error) {
        // try next cookie
      }
    }
  }
  return null;
}

/**
 * The bcrypt hash and the reset token have no business travelling with the request context.
 *
 * `hasPassword` stays behind, because `Identity.getAuthMethodList()` derives "this account
 * can be signed into with a password" from the hash being present -- without the flag,
 * `GET /auth` would tell the UI the account has no password login at all.
 */
function stripSecrets({ password, resetTokenHash, resetTokenExpireTime, ...rest }) {
  return { ...rest, hasPassword: !!password };
}

/**
 * Loads the identity **from the database** for the identity code in the token.
 *
 * The token is a proof of authentication, not a source of authorization. It used to carry
 * `profileList` and every `auth` rule in the stack read it straight from there, which means
 * the only thing standing between a visitor and `["authorities"]` was the HMAC signature --
 * one leaked `JWT_SECRET` (and the dev default really is `dev-secret`) and anyone could mint
 * themselves any role. Reading roles from the collection removes that single point of
 * failure: a forged token now has to name an identity that exists, and it gets exactly the
 * roles that identity has.
 *
 * It also makes revocation work at all. Roles baked into a token stay valid until it
 * expires, so taking a role away -- or deleting the account -- did nothing until the user
 * logged out and back in.
 *
 * The cost is one indexed `findOne` per request that carries a cookie (`identity` is
 * unique-indexed). Public requests from anonymous visitors do not pay it.
 */
async function loadIdentity(req) {
  const found = readToken(req);
  if (!found?.payload?.identity) return null;

  const dao = daoByCookieName.get(found.cookieName) ?? defaultIdentityDao;

  let record;
  try {
    record = await dao.getByIdentity(found.payload.identity);
  } catch (e) {
    // A database that is down must not look like a signed-in user.
    console.error("[caio-server-auth] cannot load identity from the database", e?.message ?? e);
    return null;
  }

  // Token for an identity that no longer exists -- deleted account, or a forgery.
  if (!record) return null;

  return { ...stripSecrets(record), authSchema: found.payload.authSchema };
}

/**
 * Populates `req.identity` when there is a valid cookie, and **never rejects**.
 *
 * Runs on every command, including public ones. Without it a public use-case could not
 * tell a signed-in caller from an anonymous one at all -- which is what a partly public
 * endpoint needs: a match list that is public but shows the departure time only to
 * members, or a binary collection whose read is open and write is not.
 */
async function resolveIdentity(req, res, next) {
  if (!req.identity) req.identity = await loadIdentity(req);
  next();
}

async function authentication(req, res, next) {
  if (!req.identity) req.identity = await loadIdentity(req);

  if (!req.identity) {
    return res.status(401).json({ error: { code: Config.ERROR_PREFIX + "unauthenticated", message: "Not authenticated" } });
  }

  next();
}

export { registerCookieName, resolveIdentity, loadIdentity };
export default authentication;
