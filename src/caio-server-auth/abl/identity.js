import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import Config from "../config/config.js";
import { Error } from "../../caio-server-core/index.js";
import defaultIdentityDao from "../dao/identity-dao.js";

const CODE_PREFIX = "caio-server-auth/identity";

function generateNumId(text) {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    n += text.codePointAt(i);
  }
  let numText = n + "";
  let i = 0;
  while (numText.length > 3 && i < 100) {
    const halfI = Math.round(numText.length / 2);
    const num1 = +numText.substring(0, halfI);
    const num2 = +numText.substring(halfI, numText.length);
    numText = (num1 + num2) + "";
    i++;
  }
  return numText;
}

const generateId = (email, time, sequence = 1) => [generateNumId(email), generateNumId(time), sequence].join("-");

// generateNumId() folds any string into at most three digits, so the identity code is
// far from unique: the same e-mail within the same second produces the same code, and
// even different e-mails collide often enough to matter. The code is under a unique
// index, so a collision means a failed registration -- hence the third segment is used
// for what it looks like it was meant for and bumped until the insert goes through.
const MAX_ID_ATTEMPTS = 50;

function isDuplicateIdentityCode(e) {
  return e?.code === 11000 && (e.keyPattern?.identity !== undefined || /index: identity_1/.test(e.errmsg ?? e.message ?? ""));
}

// Which document field holds which provider's user id. One identity carries all of
// them, so that signing in with Google, Facebook or a password lands on the same
// account (see docs/auth.md, 5.1).
const PROVIDER_FIELDS = {
  google: "googleId",
  facebook: "facebookId",
};

function providerField(provider) {
  const field = PROVIDER_FIELDS[provider];
  // Note: `Error` here is caio-server-core's AppError, not the global one.
  if (!field) throw new Error.Failed(`Unknown identity provider "${provider}"`, { code: CODE_PREFIX + "/unknownProvider" });
  return field;
}

const emailPattern = new RegExp(Config.emailPatternSource);
const passwordPattern = new RegExp(Config.password.patternSource, Config.password.patternFlags);

function createIdentity(identityDao, collectionName = "sys_identity") {
  const Identity = {
    async create(identity) {
      if (identity.password) {
        const salt = await bcrypt.genSalt(10);
        identity.password = await bcrypt.hash(identity.password, salt);
      }

      const cts = new Date().toISOString();
      // Facebook may hand over an account with no e-mail at all (docs/auth.md, R4),
      // and generateId() over undefined would throw, so the provider id stands in as
      // the seed. It only feeds the readable identity code, nothing is looked up by it.
      const seed = identity.email || identity.googleId || identity.facebookId || cts;

      for (let sequence = 1; sequence <= MAX_ID_ATTEMPTS; sequence++) {
        try {
          return await identityDao.create({ identity: generateId(seed, cts, sequence), ...identity });
        } catch (e) {
          if (!isDuplicateIdentityCode(e)) throw e;
        }
      }

      throw new Error.Failed(`Could not generate a free identity code after ${MAX_ID_ATTEMPTS} attempts`, {
        code: CODE_PREFIX + "/identityCodeExhausted",
      });
    },

    async get({id, identity}, sessionIdentity) {
      const data = id ? await identityDao.getById(id) : await identityDao.getByIdentity(identity);
      if (!data) {
        throw new Error.DoesNotExists("Identity not found", { codePrefix: CODE_PREFIX });
      }
      return sessionIdentity?.identity === data.identity ? data : Identity._getPublicData(data);
    },

    async search(query) {
      const itemList = await identityDao.search(query);
      return itemList.map(Identity._getPublicData);
    },

    async list(dtoIn = {}) {
      let itemList;
      if (dtoIn.identityList) {
        itemList = await identityDao.listbyIdentityList(dtoIn.identityList);
      } else if (dtoIn.idList) {
        itemList = await identityDao.listByIdList(dtoIn.idList);
      } else {
        itemList = await identityDao.list(dtoIn.pageInfo);
      }
      return itemList.map(Identity._getPublicData);
    },

    findByEmail(email) {
      return identityDao.findOne({ email });
    },

    findByGoogleId(googleId) {
      return identityDao.findOne({ googleId });
    },

    findByProviderId(provider, providerId) {
      return identityDao.findOne({ [providerField(provider)]: providerId });
    },

    /**
     * Signs in through an identity provider, mapping it onto an existing account
     * whenever that can be done safely (docs/auth.md, 5.1):
     *
     * 1. known provider id -> that identity;
     * 2. otherwise an identity with the same e-mail -> store the provider id on it,
     *    so the account is from now on reachable both ways. Only for an e-mail the
     *    provider vouches for: with an unverified one, anyone who sets a foreign
     *    address at some provider would take over the account;
     * 3. otherwise a new identity.
     */
    async loginWithProvider({ provider, providerId, email, emailVerified = false, data = {} }) {
      const field = providerField(provider);

      const byProvider = await Identity.findByProviderId(provider, providerId);
      if (byProvider) return byProvider;

      const byEmail = email ? await Identity.findByEmail(email) : null;

      if (byEmail) {
        if (emailVerified) return await identityDao.update({ id: byEmail.id, [field]: providerId });

        // The e-mail is taken and this provider does not vouch for it. Pairing would
        // hand over somebody else's account, and a second identity with the same
        // e-mail is exactly what the unique index is there to prevent -- so the only
        // honest answer is to refuse and say which ways in do work.
        throw new Error.Failed(
          `E-mail is already used by another identity and ${provider} did not verify it, sign in with: ${Identity.getAuthMethodList(byEmail).join(", ")}`,
          { code: CODE_PREFIX + "/emailNotVerified", status: 409 },
        );
      }

      return await Identity.create({ ...data, email, registrationType: provider, [field]: providerId });
    },

    /** What the account can be signed in with -- for the UI, not for authorization. */
    getAuthMethodList(data = {}) {
      const list = Object.entries(PROVIDER_FIELDS)
        .filter(([, field]) => data[field])
        .map(([provider]) => provider);
      if (data.password) list.unshift("password");
      return list;
    },

    isEmailValid(email) {
      return typeof email === "string" && emailPattern.test(email);
    },

    /** @returns null when the password is fine, otherwise a reason for the client. */
    checkPassword(password) {
      const { minLength, maxBytes } = Config.password;

      if (typeof password !== "string" || password.length < minLength) {
        return { code: "passwordTooShort", message: `Password must be at least ${minLength} characters long` };
      }
      // bcrypt truncates at 72 bytes, so anything longer is only pretending to be stronger.
      if (Buffer.byteLength(password, "utf8") > maxBytes) {
        return { code: "passwordTooLong", message: `Password must be at most ${maxBytes} bytes long` };
      }
      if (!passwordPattern.test(password)) {
        return {
          code: "passwordTooSimple",
          message: "Password must contain a lower-case letter, an upper-case letter and a digit",
        };
      }
      return null;
    },

    matchPassword(inputPassword, storedPassword) {
      return bcrypt.compare(inputPassword, storedPassword);
    },

    createToken(identity) {
      return jwt.sign({ ...Identity.getBasicData(identity), authSchema: collectionName }, Config.token.jwtSecret, { expiresIn: Config.token.jwtLifetime })
    },

    getBasicData(data) {
      const { identity, firstName, surname, name, email, photo, profileList } = data;
      // authMethodList tells the UI what the account can be signed in with. It is
      // derived, never stored, so it cannot drift from the fields it describes.
      return {
        identity, firstName, surname, name, email, photo, profileList,
        authMethodList: Identity.getAuthMethodList(data),
      };
    },

    _getPublicData(data) {
      const { identity, firstName, surname, name, photo } = Identity.getBasicData(data);
      return { identity, firstName, surname, name, photo };
    }
  };

  return Identity;
}

export { createIdentity };
export default createIdentity(defaultIdentityDao, "sys_identity");
