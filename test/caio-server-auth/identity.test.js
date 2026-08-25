jest.mock("bcryptjs", () => ({
  genSalt: jest.fn().mockResolvedValue("salt"),
  hash: jest.fn().mockResolvedValue("hashedPassword"),
  compare: jest.fn(),
}));

jest.mock("jsonwebtoken", () => ({
  sign: jest.fn().mockReturnValue("jwt-token"),
}));

jest.mock("../../src/caio-server-auth/config/config", () => ({
  token: { jwtSecret: "test-secret", jwtLifetime: "1d" },
  password: {
    minLength: 10,
    maxBytes: 72,
    patternSource: "(?=.*\\p{Ll})(?=.*\\p{Lu})(?=.*\\d)",
    patternFlags: "u",
  },
  emailPatternSource: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$",
  ERROR_PREFIX: "caio-server-auth/",
}));

jest.mock("../../src/caio-server-auth/dao/identity-dao", () => ({}));

import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { createIdentity } from "../../src/caio-server-auth/abl/identity.js";

function createMockDao() {
  return {
    create: jest.fn(),
    getById: jest.fn(),
    getByIdentity: jest.fn(),
    search: jest.fn(),
    list: jest.fn(),
    listByIdList: jest.fn(),
    listbyIdentityList: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
  };
}

describe("Identity", () => {
  let dao;
  let Identity;

  beforeEach(() => {
    jest.clearAllMocks();
    dao = createMockDao();
    Identity = createIdentity(dao, "sys_identity");
  });

  describe("create", () => {
    it("should hash password and generate identity id", async () => {
      dao.create.mockImplementation((data) => Promise.resolve({ _id: "x", ...data }));

      const result = await Identity.create({
        email: "john@test.com",
        password: "secret",
        firstName: "John",
        surname: "Doe",
      });

      expect(bcrypt.genSalt).toHaveBeenCalledWith(10);
      expect(bcrypt.hash).toHaveBeenCalledWith("secret", "salt");
      expect(dao.create).toHaveBeenCalledWith(
        expect.objectContaining({
          identity: expect.any(String),
          email: "john@test.com",
          password: "hashedPassword",
        })
      );
      expect(result).toHaveProperty("identity");
    });

    it("should skip hashing when no password", async () => {
      dao.create.mockImplementation((data) => Promise.resolve(data));

      await Identity.create({ email: "google@test.com" });

      expect(bcrypt.genSalt).not.toHaveBeenCalled();
      expect(bcrypt.hash).not.toHaveBeenCalled();
    });
  });

  describe("get", () => {
    const fullData = {
      identity: "1-2-1",
      firstName: "John",
      surname: "Doe",
      name: "John Doe",
      email: "john@test.com",
      photo: "url",
      profileList: ["User"],
      password: "hashed",
    };

    it("should return full data for own identity", async () => {
      dao.getByIdentity.mockResolvedValue(fullData);
      const result = await Identity.get(
        { identity: "1-2-1" },
        { identity: "1-2-1" }
      );
      expect(result).toEqual(fullData);
    });

    it("should return public data for other identity", async () => {
      dao.getByIdentity.mockResolvedValue(fullData);
      const result = await Identity.get(
        { identity: "1-2-1" },
        { identity: "9-9-1" }
      );
      expect(result).not.toHaveProperty("email");
      expect(result).not.toHaveProperty("password");
      expect(result).not.toHaveProperty("profileList");
      expect(result).toHaveProperty("identity", "1-2-1");
      expect(result).toHaveProperty("name", "John Doe");
    });

    it("should use getById when id is provided", async () => {
      dao.getById.mockResolvedValue(fullData);
      await Identity.get({ id: "abc" }, { identity: "1-2-1" });
      expect(dao.getById).toHaveBeenCalledWith("abc");
    });

    it("should throw DoesNotExists when not found", async () => {
      dao.getByIdentity.mockResolvedValue(null);
      await expect(Identity.get({ identity: "x" }, {})).rejects.toThrow("Identity not found");
    });
  });

  describe("search", () => {
    it("should return public data from search results", async () => {
      dao.search.mockResolvedValue([
        { identity: "1-1-1", name: "John", firstName: "John", surname: "Doe", photo: null, email: "j@t.com" },
      ]);
      const result = await Identity.search("John");
      expect(result[0]).not.toHaveProperty("email");
      expect(result[0]).toHaveProperty("name", "John");
    });
  });

  describe("list", () => {
    const items = [
      { identity: "1-1-1", name: "A", firstName: "A", surname: "B", photo: null, email: "a@b.com" },
    ];

    it("should use listbyIdentityList when identityList provided", async () => {
      dao.listbyIdentityList.mockResolvedValue(items);
      await Identity.list({ identityList: ["1-1-1"] });
      expect(dao.listbyIdentityList).toHaveBeenCalledWith(["1-1-1"]);
    });

    it("should use listByIdList when idList provided", async () => {
      dao.listByIdList.mockResolvedValue(items);
      await Identity.list({ idList: ["abc"] });
      expect(dao.listByIdList).toHaveBeenCalledWith(["abc"]);
    });

    it("should use list with pageInfo when no lists provided", async () => {
      dao.list.mockResolvedValue(items);
      await Identity.list({ pageInfo: { pageSize: 10 } });
      expect(dao.list).toHaveBeenCalledWith({ pageSize: 10 });
    });

    it("should use list with default when called with no args", async () => {
      dao.list.mockResolvedValue([]);
      await Identity.list();
      expect(dao.list).toHaveBeenCalledWith(undefined);
    });
  });

  describe("findByEmail", () => {
    it("should delegate to dao.findOne", async () => {
      dao.findOne.mockResolvedValue({ email: "j@t.com" });
      const result = await Identity.findByEmail("j@t.com");
      expect(dao.findOne).toHaveBeenCalledWith({ email: "j@t.com" });
      expect(result).toHaveProperty("email", "j@t.com");
    });
  });

  describe("findByGoogleId", () => {
    it("should delegate to dao.findOne", async () => {
      dao.findOne.mockResolvedValue({ googleId: "g123" });
      await Identity.findByGoogleId("g123");
      expect(dao.findOne).toHaveBeenCalledWith({ googleId: "g123" });
    });
  });

  describe("matchPassword", () => {
    it("should delegate to bcrypt.compare", async () => {
      bcrypt.compare.mockResolvedValue(true);
      const result = await Identity.matchPassword("plain", "hashed");
      expect(bcrypt.compare).toHaveBeenCalledWith("plain", "hashed");
      expect(result).toBe(true);
    });
  });

  describe("createToken", () => {
    it("should sign JWT with basic data and config", () => {
      const identity = {
        identity: "1-1-1",
        firstName: "John",
        surname: "Doe",
        name: "John Doe",
        email: "j@t.com",
        photo: null,
        profileList: ["User"],
      };
      const token = Identity.createToken(identity);
      expect(jwt.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          identity: "1-1-1",
          email: "j@t.com",
          authSchema: "sys_identity",
        }),
        "test-secret",
        { expiresIn: "1d" }
      );
      expect(token).toBe("jwt-token");
    });
  });

  describe("getBasicData", () => {
    it("should return subset of identity fields", () => {
      const data = Identity.getBasicData({
        identity: "1-1-1",
        firstName: "J",
        surname: "D",
        name: "J D",
        email: "j@d.com",
        photo: "url",
        profileList: ["U"],
        password: "secret",
        googleId: "g1",
      });
      expect(data).toEqual({
        identity: "1-1-1",
        firstName: "J",
        surname: "D",
        name: "J D",
        email: "j@d.com",
        photo: "url",
        profileList: ["U"],
        // Derived from password/googleId/facebookId, so the UI knows what to offer
        // without those fields having to leave the server.
        authMethodList: ["password", "google"],
      });
      expect(data).not.toHaveProperty("password");
      expect(data).not.toHaveProperty("googleId");
    });
  });

  describe("create: identity code collisions", () => {
    function duplicateCodeError() {
      return Object.assign(new Error("E11000 duplicate key"), { code: 11000, keyPattern: { identity: 1 } });
    }

    it("should bump the last segment until the code is free", async () => {
      // generateNumId() folds a string into three digits, so the same e-mail in the
      // same second produces the same code -- and the code is uniquely indexed.
      dao.create
        .mockRejectedValueOnce(duplicateCodeError())
        .mockRejectedValueOnce(duplicateCodeError())
        .mockImplementation((data) => Promise.resolve(data));

      const result = await Identity.create({ email: "john@test.com" });

      expect(dao.create).toHaveBeenCalledTimes(3);
      expect(result.identity).toMatch(/-3$/);
      const codes = dao.create.mock.calls.map(([data]) => data.identity);
      expect(new Set(codes).size).toBe(3);
    });

    it("should give up with a clear error instead of looping", async () => {
      dao.create.mockRejectedValue(duplicateCodeError());

      await expect(Identity.create({ email: "john@test.com" })).rejects.toThrow(/identity code/i);
      expect(dao.create).toHaveBeenCalledTimes(50);
    });

    it("should pass any other database error straight on", async () => {
      dao.create.mockRejectedValue(Object.assign(new Error("no space left"), { code: 28 }));

      await expect(Identity.create({ email: "john@test.com" })).rejects.toThrow("no space left");
      expect(dao.create).toHaveBeenCalledTimes(1);
    });
  });

  describe("getAuthMethodList", () => {
    it.each([
      [{}, []],
      [{ password: "hash" }, ["password"]],
      [{ googleId: "g1" }, ["google"]],
      [{ facebookId: "f1" }, ["facebook"]],
      [{ password: "hash", googleId: "g1", facebookId: "f1" }, ["password", "google", "facebook"]],
    ])("should derive %j into %j", (data, expected) => {
      expect(Identity.getAuthMethodList(data)).toEqual(expected);
    });
  });

  describe("isEmailValid", () => {
    it.each(["j@d.com", "a.b+c@sub.example.co.uk"])("should accept %s", (email) => {
      expect(Identity.isEmailValid(email)).toBe(true);
    });

    it.each(["", "nope", "a@b", "a b@c.com", undefined, null, 42])("should reject %p", (email) => {
      expect(Identity.isEmailValid(email)).toBe(false);
    });
  });

  describe("checkPassword", () => {
    it("should accept a password that meets the rules", () => {
      expect(Identity.checkPassword("Heslo12345")).toBeNull();
    });

    it.each([
      ["Krat1kA", "passwordTooShort"],
      [undefined, "passwordTooShort"],
      ["hesloheslo1", "passwordTooSimple"],
      ["HESLOHESLO1", "passwordTooSimple"],
      ["HesloHesloHeslo", "passwordTooSimple"],
    ])("should reject %p as %s", (password, code) => {
      expect(Identity.checkPassword(password)).toEqual(expect.objectContaining({ code }));
    });

    it("should reject a password over 72 bytes, counting bytes and not characters", () => {
      // 40 two-byte characters = 80 bytes, which bcrypt would silently cut at 72.
      const accented = "Á1a" + "ě".repeat(40);
      expect(accented.length).toBeLessThan(72);
      expect(Identity.checkPassword(accented)).toEqual(expect.objectContaining({ code: "passwordTooLong" }));
    });
  });

  describe("loginWithProvider", () => {
    it("should return the identity the provider id already points at", async () => {
      const existing = { id: "x", identity: "1-1-1", googleId: "g1" };
      dao.findOne.mockResolvedValue(existing);

      const result = await Identity.loginWithProvider({ provider: "google", providerId: "g1" });

      expect(dao.findOne).toHaveBeenCalledWith({ googleId: "g1" });
      expect(result).toBe(existing);
      expect(dao.create).not.toHaveBeenCalled();
      expect(dao.update).not.toHaveBeenCalled();
    });

    it("should map a verified e-mail onto the existing identity", async () => {
      const byEmail = { id: "x", identity: "1-1-1", email: "j@d.com", password: "hash" };
      dao.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(byEmail);
      dao.update.mockResolvedValue({ ...byEmail, facebookId: "f1" });

      const result = await Identity.loginWithProvider({
        provider: "facebook",
        providerId: "f1",
        email: "j@d.com",
        emailVerified: true,
      });

      expect(dao.update).toHaveBeenCalledWith({ id: "x", facebookId: "f1" });
      expect(result.facebookId).toBe("f1");
      expect(dao.create).not.toHaveBeenCalled();
    });

    it("should refuse an unverified e-mail that belongs to someone already", async () => {
      // Pairing would hand over a foreign account, and a second identity with the same
      // e-mail is what the unique index exists to prevent -- so this has to be refused.
      dao.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "x", identity: "1-1-1", password: "hash" });

      await expect(
        Identity.loginWithProvider({ provider: "google", providerId: "g1", email: "j@d.com", emailVerified: false }),
      ).rejects.toMatchObject({ code: "caio-server-auth/identity/emailNotVerified", status: 409 });

      expect(dao.update).not.toHaveBeenCalled();
      expect(dao.create).not.toHaveBeenCalled();
    });

    it("should create an identity for an unverified e-mail nobody uses yet", async () => {
      dao.findOne.mockResolvedValue(null);
      dao.create.mockImplementation((data) => Promise.resolve(data));

      const result = await Identity.loginWithProvider({
        provider: "google",
        providerId: "g1",
        email: "fresh@d.com",
        emailVerified: false,
      });

      expect(result).toEqual(
        expect.objectContaining({ googleId: "g1", email: "fresh@d.com", registrationType: "google" }),
      );
    });

    it("should create an identity when nothing matches", async () => {
      dao.findOne.mockResolvedValue(null);
      dao.create.mockImplementation((data) => Promise.resolve(data));

      const result = await Identity.loginWithProvider({
        provider: "facebook",
        providerId: "f1",
        email: undefined,
        data: { name: "No Mail" },
      });

      // Facebook does not always hand over an e-mail; the identity code then seeds
      // off the provider id instead of throwing.
      expect(result.identity).toMatch(/^\d+-\d+-1$/);
      expect(result.facebookId).toBe("f1");
    });

    it("should refuse an unknown provider", async () => {
      await expect(Identity.loginWithProvider({ provider: "twitter", providerId: "t1" })).rejects.toThrow(
        /Unknown identity provider/,
      );
    });
  });
});
