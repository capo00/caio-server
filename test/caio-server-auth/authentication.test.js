jest.mock("jsonwebtoken");
jest.mock("../../src/caio-server-auth/config/config", () => ({
  token: { jwtSecret: "test-secret" },
  ERROR_PREFIX: "caio-server-auth/",
}));

const jwt = require("jsonwebtoken");

// We need a fresh module for each test to reset cookieNames
let authentication, registerCookieName;

beforeEach(() => {
  jest.clearAllMocks();
  jest.resetModules();

  jest.mock("jsonwebtoken");
  jest.mock("../../src/caio-server-auth/config/config", () => ({
    token: { jwtSecret: "test-secret" },
    ERROR_PREFIX: "caio-server-auth/",
  }));

  const mod = require("../../src/caio-server-auth/api/authentication");
  authentication = mod;
  registerCookieName = mod.registerCookieName;
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
  it("should set req.identity and call next for valid token", async () => {
    const jwt = require("jsonwebtoken");
    const identityData = { identity: "1-1-1", name: "John" };
    jwt.verify.mockReturnValue(identityData);

    const { req, res, next } = createMockReqRes({ token: "valid-jwt" });
    await authentication(req, res, next);

    expect(req.identity).toEqual(identityData);
    expect(next).toHaveBeenCalled();
  });

  it("should return 401 when no cookie present", async () => {
    const { req, res, next } = createMockReqRes({});
    await authentication(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: "caio-server-auth/unauthenticated" }),
      })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("should return 401 when token is invalid", async () => {
    const jwt = require("jsonwebtoken");
    jwt.verify.mockImplementation(() => { throw new Error("invalid token"); });

    const { req, res, next } = createMockReqRes({ token: "bad-jwt" });
    await authentication(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("should try registered cookie names and use first valid one", async () => {
    const jwt = require("jsonwebtoken");
    registerCookieName("token_tenant1");

    jwt.verify.mockImplementation((token) => {
      if (token === "tenant1-jwt") return { identity: "t1" };
      throw new Error("invalid");
    });

    const { req, res, next } = createMockReqRes({
      token: "bad-default",
      token_tenant1: "tenant1-jwt",
    });
    await authentication(req, res, next);

    expect(req.identity).toEqual({ identity: "t1" });
    expect(next).toHaveBeenCalled();
  });
});

describe("registerCookieName", () => {
  it("should not add duplicate names", () => {
    registerCookieName("token_x");
    registerCookieName("token_x");

    const jwt = require("jsonwebtoken");
    jwt.verify.mockImplementation(() => { throw new Error("invalid"); });

    const { req, res, next } = createMockReqRes({ token_x: "jwt" });
    authentication(req, res, next);

    // verify is called once for default "token" (missing in cookies -> skip) and once for "token_x"
    expect(jwt.verify).toHaveBeenCalledTimes(1);
  });
});
