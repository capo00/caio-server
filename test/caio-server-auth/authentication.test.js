// A fresh module per test, so the cookie -> dao registry starts empty every time.
let authentication, registerCookieName, resolveIdentity, getByIdentity;

function loadModule() {
  jest.resetModules();

  jest.doMock("jsonwebtoken");
  jest.doMock("../../src/caio-server-auth/config/config", () => ({
    token: { jwtSecret: "test-secret" },
    ERROR_PREFIX: "caio-server-auth/",
  }));

  getByIdentity = jest.fn();
  jest.doMock("../../src/caio-server-auth/dao/identity-dao", () => ({
    __esModule: true,
    default: { getByIdentity: (...args) => getByIdentity(...args) },
    IdentityDao: class {},
  }));

  const mod = require("../../src/caio-server-auth/api/authentication");
  authentication = mod.default || mod;
  registerCookieName = mod.registerCookieName;
  resolveIdentity = mod.resolveIdentity;
  return require("jsonwebtoken");
}

let jwt;

beforeEach(() => {
  jest.clearAllMocks();
  jwt = loadModule();
});

function createMockReqRes(cookies = {}) {
  const req = { cookies };
  const res = {
    status: jest.fn(function () { return this; }),
    json: jest.fn(),
  };
  const next = jest.fn();
  return { req, res, next };
}

describe("authentication middleware", () => {
  it("loads the identity from the database, not from the token", async () => {
    jwt.verify.mockReturnValue({ identity: "1-1-1", authSchema: "sys_identity" });
    getByIdentity.mockResolvedValue({ id: "abc", identity: "1-1-1", name: "John", profileList: ["operatives"] });

    const { req, res, next } = createMockReqRes({ token: "valid-jwt" });
    await authentication(req, res, next);

    expect(getByIdentity).toHaveBeenCalledWith("1-1-1");
    expect(req.identity).toMatchObject({ identity: "1-1-1", name: "John", profileList: ["operatives"] });
    expect(next).toHaveBeenCalled();
  });

  // The whole point of the change: a signature is the only thing that protected the roles
  // baked into the token, so one leaked JWT_SECRET was a free `authorities`.
  it("ignores profileList carried in the token and uses the stored one", async () => {
    jwt.verify.mockReturnValue({ identity: "2-2-2", profileList: ["authorities"] });
    getByIdentity.mockResolvedValue({ identity: "2-2-2", profileList: ["members"] });

    const { req, res, next } = createMockReqRes({ token: "forged-jwt" });
    await authentication(req, res, next);

    expect(req.identity.profileList).toEqual(["members"]);
    expect(next).toHaveBeenCalled();
  });

  // Deleted account (or an identity code that never existed) must stop working at once,
  // not when the token happens to expire.
  it("refuses a token whose identity is not in the database", async () => {
    jwt.verify.mockReturnValue({ identity: "9-9-9" });
    getByIdentity.mockResolvedValue(null);

    const { req, res, next } = createMockReqRes({ token: "valid-jwt" });
    await authentication(req, res, next);

    expect(req.identity).toBeNull();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("never puts the password hash or the reset token into the request", async () => {
    jwt.verify.mockReturnValue({ identity: "1-1-1" });
    getByIdentity.mockResolvedValue({
      identity: "1-1-1",
      password: "$2b$10$hash",
      resetTokenHash: "hash",
      resetTokenExpireTime: "2026-01-01",
      profileList: [],
    });

    const { req, res, next } = createMockReqRes({ token: "valid-jwt" });
    await authentication(req, res, next);

    expect(req.identity).not.toHaveProperty("password");
    expect(req.identity).not.toHaveProperty("resetTokenHash");
    expect(req.identity).not.toHaveProperty("resetTokenExpireTime");
    // ...but the fact that a password exists survives: getAuthMethodList() derives
    // "can sign in with a password" from it, and GET /auth would otherwise tell the UI
    // the account has no password login.
    expect(req.identity.hasPassword).toBe(true);
  });

  it("reports hasPassword false for a provider-only account", async () => {
    jwt.verify.mockReturnValue({ identity: "3-3-3" });
    getByIdentity.mockResolvedValue({ identity: "3-3-3", googleId: "g1", profileList: [] });

    const { req, res, next } = createMockReqRes({ token: "valid-jwt" });
    await authentication(req, res, next);

    expect(req.identity.hasPassword).toBe(false);
  });

  // A database outage must look like "not signed in", never like a signed-in user with
  // no roles that some `auth` rule might wave through.
  it("treats a failing database lookup as not authenticated", async () => {
    jwt.verify.mockReturnValue({ identity: "1-1-1" });
    getByIdentity.mockRejectedValue(new Error("connection refused"));
    const consoleSpy = jest.spyOn(console, "error").mockImplementation();

    const { req, res, next } = createMockReqRes({ token: "valid-jwt" });
    await authentication(req, res, next);

    expect(req.identity).toBeNull();
    expect(res.status).toHaveBeenCalledWith(401);
    consoleSpy.mockRestore();
  });

  it("should return 401 when no cookie present", async () => {
    const { req, res, next } = createMockReqRes({});
    await authentication(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: "caio-server-auth/unauthenticated" }),
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("should return 401 when token is invalid", async () => {
    jwt.verify.mockImplementation(() => { throw new Error("invalid token"); });

    const { req, res, next } = createMockReqRes({ token: "bad-jwt" });
    await authentication(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("should try registered cookie names and use first valid one", async () => {
    const tenantDao = { getByIdentity: jest.fn().mockResolvedValue({ identity: "t1", profileList: [] }) };
    registerCookieName("token_tenant1", tenantDao);

    jwt.verify.mockImplementation((token) => {
      if (token === "tenant1-jwt") return { identity: "t1" };
      throw new Error("invalid");
    });

    const { req, res, next } = createMockReqRes({ token: "bad-default", token_tenant1: "tenant1-jwt" });
    await authentication(req, res, next);

    // The tenant's own collection was asked, not the default one.
    expect(tenantDao.getByIdentity).toHaveBeenCalledWith("t1");
    expect(getByIdentity).not.toHaveBeenCalled();
    expect(req.identity).toMatchObject({ identity: "t1" });
    expect(next).toHaveBeenCalled();
  });
});

describe("resolveIdentity", () => {
  it("passes an anonymous request through with identity null", async () => {
    const { req, res, next } = createMockReqRes({});
    await resolveIdentity(req, res, next);

    expect(req.identity).toBeNull();
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("does not touch the database for a request without a cookie", async () => {
    const { req, res, next } = createMockReqRes({});
    await resolveIdentity(req, res, next);

    expect(getByIdentity).not.toHaveBeenCalled();
  });
});

describe("registerCookieName", () => {
  it("should not add duplicate names", async () => {
    registerCookieName("token_x");
    registerCookieName("token_x");

    jwt.verify.mockImplementation(() => { throw new Error("invalid"); });

    const { req, res, next } = createMockReqRes({ token_x: "jwt" });
    await authentication(req, res, next);

    // once for "token_x"; the default "token" is missing from the cookies and skipped
    expect(jwt.verify).toHaveBeenCalledTimes(1);
  });
});
