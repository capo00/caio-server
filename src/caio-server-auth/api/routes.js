import express from "express";
import jwt from "jsonwebtoken";
import passport from "passport";
import DefaultIdentity from "../abl/identity.js";
import Config from "../config/config.js";
import fs from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Credentials are the only thing these routes accept, so anything larger is either a
// mistake or an attempt to make the server hash a megabyte.
const BODY_LIMIT = "10kb";

const IS_PROD = process.env.NODE_ENV === "production";

// The router carries its own body parser, because App.init() mounts these routes
// before it registers a global express.json() -- so req.body was undefined here and
// /register and /login answered every request with a TypeError. It is attached per
// route rather than to the whole router or the whole app for two reasons: Auth.init()
// has to work on an app that has no parser of its own, and there must be exactly one
// parser per path. body-parser@2 no longer skips an already parsed request (read.js
// only checks isFinished() and hasBody()), so a second parser reads the consumed
// stream as empty and overwrites req.body with {}.
const parseJson = express.json({ limit: BODY_LIMIT });

// Same envelope the rest of the server answers errors with, so a client has one shape
// to handle. These routes are plain express routes, outside the command pipeline that
// would otherwise do this.
function sendError(res, status, code, message) {
  return res.status(status).json({ error: { code: Config.ERROR_PREFIX + code, message } });
}

function getCookieOptions() {
  return {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: IS_PROD ? "strict" : "lax",
  };
}

const Routes = {
  init(prefixPath = "", identity = DefaultIdentity, strategyName = "google", cookieName = "token") {
    const router = express.Router();

    function setToken(res, token) {
      res.cookie(cookieName, token, getCookieOptions());
    }

    function removeToken(res) {
      res.clearCookie(cookieName, getCookieOptions());
    }

    router.get("/", async (req, res) => {
      const token = req.cookies[cookieName];

      let id = null;
      if (token) {
        try {
          id = jwt.verify(token, Config.token.jwtSecret);
        } catch (error) {
          //console.warn("/auth: Token is not valid", error);
        }
      }
      return res.json({ identity: id });
    });

    router.post("/register", parseJson, async (req, res) => {
      const { firstName, surname, email, password } = req.body;

      try {
        if (!identity.isEmailValid(email)) return sendError(res, 400, "invalidEmail", "E-mail is not a valid address");

        const passwordProblem = identity.checkPassword(password);
        if (passwordProblem) return sendError(res, 400, passwordProblem.code, passwordProblem.message);

        let existing = await identity.findByEmail(email);

        if (existing) {
          // One identity per e-mail (docs/auth.md, 5.1), and registering a password on
          // somebody else's address must not hand the account over: nothing here proves
          // the address belongs to whoever is asking. Signing in through a provider does
          // prove it, so that is what the message points at. Until e-mail verification
          // exists (R2), this is the one direction that cannot be mapped automatically.
          const methodList = identity.getAuthMethodList(existing);
          return sendError(
            res,
            400,
            "identityExists",
            methodList.length
              ? `Identity already exists, sign in with: ${methodList.join(", ")}`
              : "Identity already exists",
          );
        }

        existing = await identity.create({
          name: [firstName, surname].filter(Boolean).join(" "),
          firstName,
          surname,
          email,
          password,
          registrationType: "password",
        });
        setToken(res, identity.createToken(existing));

        // Never the raw document: it carries the bcrypt hash.
        res.status(201).json({ identity: identity.getBasicData(existing) });
      } catch (err) {
        console.error("/auth/register: Unexpected exception", err);
        res.status(500).json({
          error: {
            code: Config.ERROR_PREFIX + "unexpected",
            message: "Unexpected exception",
            cause: err
          }
        });
      }
    });

    router.post("/login", parseJson, async (req, res) => {
      const { email, password } = req.body;

      try {
        const found = await identity.findByEmail(email);

        // No password on the document means the account exists but is signed into
        // through a provider. bcrypt.compare(password, undefined) would throw and turn
        // that into a 500; and the answer has to be the same as for a wrong password,
        // so that /login does not become a way to ask which accounts exist.
        if (!found || !found.password || !(await identity.matchPassword(password, found.password))) {
          return sendError(res, 400, "invalidCredentials", "Invalid credentials");
        }

        setToken(res, identity.createToken(found));

        // Never the raw document: it carries the bcrypt hash.
        res.json({ identity: identity.getBasicData(found) });
      } catch (err) {
        console.error("/auth/login: Unexpected exception", err);
        res.status(500).json({
          error: {
            code: Config.ERROR_PREFIX + "unexpected",
            message: "Unexpected exception",
            cause: err
          }
        });
      }
    });

    router.post("/logout", async (req, res) => {
      removeToken(res);
      res.json({});
    });

    let callbackURL;
    router.get("/google", (req, res, next) => {
      const domain = req.headers.referer;
      const uc = prefixPath + "/" + Config.google.callbackUc;
      callbackURL = domain ? new URL(uc, domain).toString() : uc;
      return passport.authenticate(strategyName, { scope: ["profile", "email"], callbackURL })(req, res, next);
    });
    router.get(
      "/" + Config.google.callbackUc,
      (req, res, next) => {
        return passport.authenticate(strategyName, { session: false, callbackURL })(req, res, next);
      },
      (req, res) => {
        setToken(res, identity.createToken(req.user));
        fs.readFile(__dirname + "/../assets/callback.html", "utf8", (err, text) => {
          res.send(text.replace("%s", JSON.stringify(identity.getBasicData(req.user))));
        });
      }
    );

    // A body the parser rejects (malformed JSON, over the limit) would otherwise reach
    // express' default handler, which answers an HTML page -- with a stack trace outside
    // production -- to a client that asked for JSON.
    router.use((err, req, res, next) => {
      if (err?.type === "entity.too.large") {
        return sendError(res, 413, "bodyTooLarge", `Request body is over ${BODY_LIMIT}`);
      }
      if (err instanceof SyntaxError && err.status === 400) {
        return sendError(res, 400, "invalidJson", "Request body is not valid JSON");
      }
      return next(err);
    });

    return router;
  }
};

export default Routes;
