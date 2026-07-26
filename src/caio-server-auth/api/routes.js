import express from "express";
import jwt from "jsonwebtoken";
import passport from "passport";
import DefaultIdentity from "../abl/identity.js";
import Config from "../config/config.js";
import fs from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const IS_PROD = process.env.NODE_ENV === "production";

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

    router.post("/register", async (req, res) => {
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

    router.post("/login", async (req, res) => {
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

    return router;
  }
};

export default Routes;
