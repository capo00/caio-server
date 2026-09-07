import express from "express";
import passport from "passport";
import DefaultIdentity from "../abl/identity.js";
import { loadIdentity } from "./authentication.js";
import Config from "../config/config.js";
import Passport from "../helpers/passport.js";
import { PROVIDERS, getProviderList, isConfigured } from "../helpers/providers.js";
import Mailer from "../helpers/mailer.js";
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

    /**
     * Kdo je přihlášený — odpověď pro klienta (`UiAuth.SessionProvider`).
     *
     * Čte se **z databáze**, ne z tokenu: token nese jen identitu, protože profileList
     * v něm byl zdroj autorizace a jedno uniklé `JWT_SECRET` by znamenalo libovolnou roli
     * (viz `api/authentication.js`). Klient tím zároveň vidí roli aktuální — když správce
     * roli přidá nebo vezme, projeví se to při dalším načtení stránky, ne až po odhlášení.
     */
    router.get("/", async (req, res) => {
      const record = await loadIdentity(req);
      return res.json({ identity: record ? identity.getBasicData(record) : null });
    });

    // What the login page needs to render itself: which providers this deployment
    // actually has credentials for, and the password rule -- so the rule exists in one
    // place instead of being copied into the page (docs/auth.md, 5.2 and 5.3).
    router.get("/config", (req, res) => {
      const { minLength, maxBytes, patternSource, patternFlags } = Config.password;
      res.json({
        providerList: getProviderList(),
        password: { minLength, maxBytes, patternSource, patternFlags },
        // Same rule as providerList: a capability the deployment cannot deliver is not
        // offered, so the login page never shows a link that would dead-end.
        passwordResetEnabled: Mailer.isConfigured(),
      });
    });

    // Asks for a reset link.
    //
    // Answers 200 whatever happens -- unknown address, address that only signs in
    // through Google, mail server down. Anything else turns this into a way of asking
    // which e-mails are registered, and the person who legitimately mistyped their
    // address is no worse off for it. Failures are logged, not returned.
    router.post("/password/reset-request", parseJson, async (req, res) => {
      const { email } = req.body ?? {};

      if (!Mailer.isConfigured()) {
        return sendError(res, 400, "passwordResetDisabled", "Password reset is not configured");
      }

      try {
        const found = identity.isEmailValid(email) ? await identity.findByEmail(email) : null;

        // No password on the document means the account exists but signs in through a
        // provider; sending a reset link would add a password nobody asked for.
        if (found?.password) {
          const token = await identity.createPasswordResetToken(found);
          await Mailer.sendPasswordReset({ to: found.email, token, name: found.firstName || found.name });
        }
      } catch (err) {
        console.error("/auth/password/reset-request: Unexpected exception", err);
      }

      res.json({});
    });

    // Consumes the token and sets the new password.
    router.post("/password/reset", parseJson, async (req, res) => {
      const { token, password } = req.body ?? {};

      try {
        const problem = await identity.resetPassword(token, password);
        if (problem) return sendError(res, 400, problem.code, problem.message);

        // Deliberately no cookie: the person proved they can read the mailbox, not that
        // they are at a trusted device. They sign in with the new password.
        res.json({});
      } catch (err) {
        console.error("/auth/password/reset: Unexpected exception", err);
        res.status(500).json({
          error: { code: Config.ERROR_PREFIX + "unexpected", message: "Unexpected exception", cause: err },
        });
      }
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

    // Every provider the module knows gets its routes, whether it is configured or not:
    // an unregistered route would fall through to caio-server's SPA fallback, which
    // answers an extensionless path with index.html and status 200. A provider without
    // credentials therefore answers a page saying it is unavailable -- and it is left
    // out of /auth/config, so no login page offers it in the first place.
    const providerPaths = new Set();

    for (const [name, provider] of Object.entries(PROVIDERS)) {
      const callbackPath = "/" + provider.callbackUc;
      providerPaths.add("/" + name);
      providerPaths.add(callbackPath);

      let callbackURL;

      router.get("/" + name, (req, res, next) => {
        if (!isConfigured(name)) return sendProviderUnavailable(res, name);

        const domain = req.headers.referer;
        const uc = prefixPath + callbackPath;
        callbackURL = domain ? new URL(uc, domain).toString() : uc;
        return passport.authenticate(Passport.strategyName(name, strategyName), {
          scope: provider.scope,
          callbackURL,
        })(req, res, next);
      });

      router.get(
        callbackPath,
        (req, res, next) => {
          if (!isConfigured(name)) return sendProviderUnavailable(res, name);
          return passport.authenticate(Passport.strategyName(name, strategyName), { session: false, callbackURL })(
            req,
            res,
            next,
          );
        },
        (req, res) => {
          setToken(res, identity.createToken(req.user));
          sendPopupPage(res, 200, "callback.html", identity.getBasicData(req.user));
        },
      );
    }

    router.use((err, req, res, next) => {
      // A body the parser rejects (malformed JSON, over the limit) would otherwise reach
      // express' default handler, which answers an HTML page -- with a stack trace
      // outside production -- to a client that asked for JSON.
      if (err?.type === "entity.too.large") {
        return sendError(res, 413, "bodyTooLarge", `Request body is over ${BODY_LIMIT}`);
      }
      if (err instanceof SyntaxError && err.status === 400) {
        return sendError(res, 400, "invalidJson", "Request body is not valid JSON");
      }

      // A provider sign-in that failed is looked at by a person in a popup, not by
      // code: refusing to pair an unverified e-mail, a provider declining, a database
      // outage. Express' default HTML error page (with a stack trace, outside
      // production) is the wrong answer there -- this renders the message instead and
      // lets the opener know the popup came back empty-handed.
      if (providerPaths.has(req.path)) {
        console.error(`[caio-server-auth] ${req.path} failed`, err);
        return sendPopupPage(res, err?.status >= 400 && err.status < 600 ? err.status : 500, "callback-error.html", {
          message: err?.message || "Přihlášení se nepovedlo.",
          code: err?.code,
        });
      }

      return next(err);
    });

    return router;

    function sendProviderUnavailable(res, name) {
      return sendPopupPage(res, 404, "callback-error.html", {
        message: `Přihlášení přes ${name} není na tomto serveru nastavené.`,
        code: Config.ERROR_PREFIX + "providerNotConfigured",
      });
    }

    /**
     * Renders one of the popup pages. Both take their payload as JSON substituted for
     * %s, so nothing from a provider or an error message is ever interpolated into
     * markup.
     */
    function sendPopupPage(res, status, file, payload) {
      fs.readFile(path.join(__dirname, "..", "assets", file), "utf8", (err, text) => {
        if (err) {
          console.error(`[caio-server-auth] cannot read assets/${file}`, err);
          return res.status(500).json({ error: { code: Config.ERROR_PREFIX + "unexpected", message: "Unexpected exception" } });
        }
        res.status(status).send(text.replace("%s", JSON.stringify(payload)));
      });
    }
  }
};

export default Routes;
