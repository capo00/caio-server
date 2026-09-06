import jwt from "jsonwebtoken";
import Config from "../config/config.js";

const cookieNames = ["token"];

function registerCookieName(name) {
  if (!cookieNames.includes(name)) cookieNames.push(name);
}

function readIdentity(req) {
  for (const name of cookieNames) {
    const token = req.cookies?.[name];
    if (token) {
      try {
        return jwt.verify(token, Config.token.jwtSecret);
      } catch (error) {
        // try next cookie
      }
    }
  }
  return null;
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
  if (!req.identity) req.identity = readIdentity(req);
  next();
}

async function authentication(req, res, next) {
  if (!req.identity) req.identity = readIdentity(req);

  if (!req.identity) {
    return res.status(401).json({ error: { code: Config.ERROR_PREFIX + "unauthenticated", message: "Not authenticated" } });
  }

  next();
}

export { registerCookieName, resolveIdentity };
export default authentication;
