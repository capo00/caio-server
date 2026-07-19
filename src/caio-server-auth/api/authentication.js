const jwt = require("jsonwebtoken");
const Config = require("../config/config");

const cookieNames = ["token"];

function registerCookieName(name) {
  if (!cookieNames.includes(name)) cookieNames.push(name);
}

async function authentication(req, res, next) {
  let identity = null;

  for (const name of cookieNames) {
    const token = req.cookies[name];
    if (token) {
      try {
        identity = jwt.verify(token, Config.token.jwtSecret);
        break;
      } catch (error) {
        // try next cookie
      }
    }
  }

  if (!identity) {
    return res.status(401).json({ error: { code: Config.ERROR_PREFIX + "unauthenticated", message: "Not authenticated" } });
  }

  req.identity = identity;
  next();
}

module.exports = authentication;
module.exports.registerCookieName = registerCookieName;
