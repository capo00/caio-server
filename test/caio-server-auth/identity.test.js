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
  ERROR_PREFIX: "caio-server-auth/",
}));

jest.mock("../../src/caio-server-auth/dao/identity-dao", () => ({}));

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { createIdentity } = require("../../src/caio-server-auth/abl/identity");

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
      });
      expect(data).not.toHaveProperty("password");
      expect(data).not.toHaveProperty("googleId");
    });
  });
});
