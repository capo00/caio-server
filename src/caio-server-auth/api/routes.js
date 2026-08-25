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
        let existing = await identity.findByEmail(email);

        if (existing) {
          return res.status(400).json({ message: "Identity already exists" });
        }

        existing = await identity.create({ name: [firstName, surname].join(" "), firstName, surname, email, password });
        setToken(res, identity.createToken(existing));

        res.status(201).json({ identity: existing });
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

        if (!found) {
          return res.status(400).json({ message: "Invalid credentials" });
        }

        const isMatch = await identity.matchPassword(password, found.password);

        if (!isMatch) {
          return res.status(400).json({ message: "Invalid credentials" });
        }

        setToken(res, identity.createToken(found));

        res.json({ identity: found });
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
        return res.status(413).json({
          error: { code: Config.ERROR_PREFIX + "bodyTooLarge", message: `Request body is over ${BODY_LIMIT}` },
        });
      }
      if (err instanceof SyntaxError && err.status === 400) {
        return res.status(400).json({
          error: { code: Config.ERROR_PREFIX + "invalidJson", message: "Request body is not valid JSON" },
        });
      }
      return next(err);
    });

    return router;
  }
};

export default Routes;
