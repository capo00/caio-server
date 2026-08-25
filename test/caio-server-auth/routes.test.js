jest.mock("jsonwebtoken");
jest.mock("passport");
jest.mock("fs");

jest.mock("../../src/caio-server-auth/config/config", () => ({
  token: { jwtSecret: "test-secret", jwtLifetime: "1d" },
  google: { callbackUc: "google/callback" },
  ERROR_PREFIX: "caio-server-auth/",
}));

jest.mock("../../src/caio-server-auth/abl/identity", () => ({}));

import jwt from "jsonwebtoken";
import Routes from "../../src/caio-server-auth/api/routes.js";

function createMockIdentity() {
  return {
    findByEmail: jest.fn(),
    create: jest.fn(),
    createToken: jest.fn().mockReturnValue("new-jwt"),
    matchPassword: jest.fn(),
    getBasicData: jest.fn((d) => ({ identity: d.identity, name: d.name })),
    getAuthMethodList: jest.fn(() => []),
    isEmailValid: jest.fn(() => true),
    checkPassword: jest.fn(() => null),
  };
}

// The envelope every error on these routes is answered with.
function expectError(res, status, code) {
  expect(res.status).toHaveBeenCalledWith(status);
  expect(res.json).toHaveBeenCalledWith({
    error: expect.objectContaining({ code: "caio-server-auth/" + code }),
  });
}

function createMockReqRes(overrides = {}) {
  const req = {
    cookies: {},
    body: {},
    headers: {},
    ...overrides,
  };
  const res = {
    json: jest.fn(),
    send: jest.fn(),
    status: jest.fn(function () { return this; }),
    cookie: jest.fn(),
    clearCookie: jest.fn(),
  };
  return { req, res };
}

function getRouteHandler(router, method, path) {
  const call = router._routes.find((r) => r.method === method && r.path === path);
  return call?.handlers;
}

// The route handler is registered last; anything before it is middleware (the body parser).
function getHandler(router, method, path) {
  const handlers = getRouteHandler(router, method, path);
  return handlers?.[handlers.length - 1];
}

// Intercept express.Router to capture route registrations
jest.mock("express", () => {
  const routes = [];
  const middleware = [];
  const jsonMiddleware = jest.fn();
  // Kept outside the mock functions: the parser is created once when the module is
  // imported, and jest.clearAllMocks() in beforeEach would wipe the call record.
  const jsonOptions = [];
  const router = {
    _routes: routes,
    _middleware: middleware,
    get: jest.fn((path, ...handlers) => routes.push({ method: "get", path, handlers })),
    post: jest.fn((path, ...handlers) => routes.push({ method: "post", path, handlers })),
    use: jest.fn((...handlers) => middleware.push(...handlers)),
  };
  return {
    Router: () => router,
    json: jest.fn((options) => { jsonOptions.push(options); return jsonMiddleware; }),
    _jsonMiddleware: jsonMiddleware,
    _jsonOptions: jsonOptions,
  };
});

describe("Auth Routes", () => {
  let router;
  let identity;

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset express router routes
    const express = require("express");
    const freshRouter = express.Router();
    freshRouter._routes.length = 0;
    freshRouter._middleware.length = 0;

    identity = createMockIdentity();
    router = Routes.init("/auth", identity, "google", "token");
  });

  describe("GET /", () => {
    it("should return identity from valid token", async () => {
      const identityData = { identity: "1-1-1", name: "John" };
      jwt.verify.mockReturnValue(identityData);

      const handler = getHandler(router, "get", "/");
      const { req, res } = createMockReqRes({ cookies: { token: "valid-jwt" } });
      await handler(req, res);

      expect(res.json).toHaveBeenCalledWith({ identity: identityData });
    });

    it("should return null identity for invalid token", async () => {
      jwt.verify.mockImplementation(() => { throw new Error("expired"); });

      const handler = getHandler(router, "get", "/");
      const { req, res } = createMockReqRes({ cookies: { token: "bad-jwt" } });
      await handler(req, res);

      expect(res.json).toHaveBeenCalledWith({ identity: null });
    });

    it("should return null identity when no cookie", async () => {
      const handler = getHandler(router, "get", "/");
      const { req, res } = createMockReqRes();
      await handler(req, res);

      expect(res.json).toHaveBeenCalledWith({ identity: null });
    });
  });

  describe("POST /register", () => {
    it("should register new identity and return 201", async () => {
      identity.findByEmail.mockResolvedValue(null);
      const newUser = { identity: "1-1-1", name: "John Doe", email: "j@t.com", password: "bcrypt-hash" };
      identity.create.mockResolvedValue(newUser);

      const handler = getHandler(router, "post", "/register");
      const { req, res } = createMockReqRes({
        body: { firstName: "John", surname: "Doe", email: "j@t.com", password: "Heslo12345" },
      });
      await handler(req, res);

      expect(identity.create).toHaveBeenCalledWith(
        expect.objectContaining({ email: "j@t.com", firstName: "John", registrationType: "password" })
      );
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.cookie).toHaveBeenCalledWith("token", "new-jwt", expect.any(Object));
      // Basic data only -- the document carries the bcrypt hash.
      expect(res.json).toHaveBeenCalledWith({ identity: { identity: "1-1-1", name: "John Doe" } });
    });

    it("should return 400 when email already exists, naming the ways in", async () => {
      identity.findByEmail.mockResolvedValue({ identity: "existing", googleId: "g-1" });
      identity.getAuthMethodList.mockReturnValue(["google"]);

      const handler = getHandler(router, "post", "/register");
      const { req, res } = createMockReqRes({
        body: { email: "existing@t.com", password: "Heslo12345" },
      });
      await handler(req, res);

      expectError(res, 400, "identityExists");
      expect(res.json.mock.calls[0][0].error.message).toContain("google");
      expect(identity.create).not.toHaveBeenCalled();
    });

    it("should reject an invalid e-mail before touching the database", async () => {
      identity.isEmailValid.mockReturnValue(false);

      const handler = getHandler(router, "post", "/register");
      const { req, res } = createMockReqRes({ body: { email: "not-an-email", password: "Heslo12345" } });
      await handler(req, res);

      expectError(res, 400, "invalidEmail");
      expect(identity.findByEmail).not.toHaveBeenCalled();
    });

    it("should reject a password the rules turn down", async () => {
      identity.checkPassword.mockReturnValue({ code: "passwordTooShort", message: "too short" });

      const handler = getHandler(router, "post", "/register");
      const { req, res } = createMockReqRes({ body: { email: "j@t.com", password: "x" } });
      await handler(req, res);

      expectError(res, 400, "passwordTooShort");
      expect(identity.findByEmail).not.toHaveBeenCalled();
    });

    it("should return 500 on unexpected error", async () => {
      identity.findByEmail.mockRejectedValue(new Error("db error"));
      const consoleSpy = jest.spyOn(console, "error").mockImplementation();

      const handler = getHandler(router, "post", "/register");
      const { req, res } = createMockReqRes({ body: { email: "j@t.com" } });
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({ code: "caio-server-auth/unexpected" }),
        })
      );
      consoleSpy.mockRestore();
    });
  });

  describe("POST /login", () => {
    it("should login and set cookie on valid credentials", async () => {
      const found = { identity: "1-1-1", password: "hashed", name: "John" };
      identity.findByEmail.mockResolvedValue(found);
      identity.matchPassword.mockResolvedValue(true);

      const handler = getHandler(router, "post", "/login");
      const { req, res } = createMockReqRes({
        body: { email: "j@t.com", password: "secret" },
      });
      await handler(req, res);

      // Basic data only -- the document carries the bcrypt hash.
      expect(res.json).toHaveBeenCalledWith({ identity: { identity: "1-1-1", name: "John" } });
      expect(res.cookie).toHaveBeenCalledWith("token", "new-jwt", expect.any(Object));
    });

    it("should return 400 when email not found", async () => {
      identity.findByEmail.mockResolvedValue(null);

      const handler = getHandler(router, "post", "/login");
      const { req, res } = createMockReqRes({
        body: { email: "nobody@t.com", password: "x" },
      });
      await handler(req, res);

      expectError(res, 400, "invalidCredentials");
    });

    it("should return 400, not 500, for an identity that has no password", async () => {
      // Signed up through a provider: bcrypt.compare(password, undefined) would throw,
      // and the answer must not give away that the account exists either.
      identity.findByEmail.mockResolvedValue({ identity: "1-1-1", googleId: "g-1" });

      const handler = getHandler(router, "post", "/login");
      const { req, res } = createMockReqRes({ body: { email: "j@t.com", password: "Heslo12345" } });
      await handler(req, res);

      expectError(res, 400, "invalidCredentials");
      expect(identity.matchPassword).not.toHaveBeenCalled();
    });

    it("should return 400 when password does not match", async () => {
      identity.findByEmail.mockResolvedValue({ password: "hashed" });
      identity.matchPassword.mockResolvedValue(false);

      const handler = getHandler(router, "post", "/login");
      const { req, res } = createMockReqRes({
        body: { email: "j@t.com", password: "wrong" },
      });
      await handler(req, res);

      expectError(res, 400, "invalidCredentials");
    });

    it("should return 500 on unexpected error", async () => {
      identity.findByEmail.mockRejectedValue(new Error("db error"));
      const consoleSpy = jest.spyOn(console, "error").mockImplementation();

      const handler = getHandler(router, "post", "/login");
      const { req, res } = createMockReqRes({
        body: { email: "j@t.com", password: "x" },
      });
      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      consoleSpy.mockRestore();
    });
  });

  describe("POST /logout", () => {
    it("should clear cookie and return empty object", async () => {
      const handler = getHandler(router, "post", "/logout");
      const { req, res } = createMockReqRes();
      await handler(req, res);

      expect(res.clearCookie).toHaveBeenCalledWith("token", expect.any(Object));
      expect(res.json).toHaveBeenCalledWith({});
    });
  });
  // App.init() mounts these routes before it registers a global express.json(), so
  // without a parser of their own req.body is undefined and both routes answered
  // every request with a TypeError.
  describe("body parsing", () => {
    it("should put a json parser in front of /register and /login", () => {
      const express = require("express");

      for (const path of ["/register", "/login"]) {
        const handlers = getRouteHandler(router, "post", path);
        expect(handlers.length).toBe(2);
        expect(handlers[0]).toBe(express._jsonMiddleware);
      }
      expect(express._jsonOptions[0]).toEqual(expect.objectContaining({ limit: "10kb" }));
    });

    it("should not parse a body on routes that have none", () => {
      for (const [method, path] of [["get", "/"], ["post", "/logout"]]) {
        expect(getRouteHandler(router, method, path).length).toBe(1);
      }
    });
  });

  describe("parser errors", () => {
    function getErrorHandler() {
      const express = require("express");
      return express.Router()._middleware.find((mw) => mw.length === 4);
    }

    it("should answer malformed JSON with 400 instead of an HTML stack trace", () => {
      const { req, res } = createMockReqRes();
      const next = jest.fn();
      const err = Object.assign(new SyntaxError("Unexpected token }"), { status: 400 });

      getErrorHandler()(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: { code: "caio-server-auth/invalidJson", message: "Request body is not valid JSON" },
      });
      expect(next).not.toHaveBeenCalled();
    });

    it("should answer an oversized body with 413", () => {
      const { req, res } = createMockReqRes();
      const next = jest.fn();

      getErrorHandler()({ type: "entity.too.large" }, req, res, next);

      expect(res.status).toHaveBeenCalledWith(413);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.objectContaining({ code: "caio-server-auth/bodyTooLarge" }) })
      );
    });

    it("should pass any other error on", () => {
      const { req, res } = createMockReqRes();
      const next = jest.fn();
      const err = new Error("something else");

      getErrorHandler()(err, req, res, next);

      expect(next).toHaveBeenCalledWith(err);
      expect(res.status).not.toHaveBeenCalled();
    });
  });
});
