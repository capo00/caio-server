jest.mock("jsonwebtoken");
jest.mock("passport");
jest.mock("fs");

jest.mock("../../src/caio-server-auth/config/config", () => ({
  token: { jwtSecret: "test-secret", jwtLifetime: "1d" },
  google: { callbackUc: "google/callback" },
  ERROR_PREFIX: "caio-server-auth/",
}));

jest.mock("../../src/caio-server-auth/abl/identity", () => ({}));

const jwt = require("jsonwebtoken");
const Routes = require("../../src/caio-server-auth/api/routes");

function createMockIdentity() {
  return {
    findByEmail: jest.fn(),
    create: jest.fn(),
    createToken: jest.fn().mockReturnValue("new-jwt"),
    matchPassword: jest.fn(),
    getBasicData: jest.fn((d) => ({ identity: d.identity, name: d.name })),
  };
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

// Intercept express.Router to capture route registrations
jest.mock("express", () => {
  const routes = [];
  const router = {
    _routes: routes,
    get: jest.fn((path, ...handlers) => routes.push({ method: "get", path, handlers })),
    post: jest.fn((path, ...handlers) => routes.push({ method: "post", path, handlers })),
  };
  return { Router: () => router };
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

    identity = createMockIdentity();
    router = Routes.init("/auth", identity, "google", "token");
  });

  describe("GET /", () => {
    it("should return identity from valid token", async () => {
      const identityData = { identity: "1-1-1", name: "John" };
      jwt.verify.mockReturnValue(identityData);

      const handlers = getRouteHandler(router, "get", "/");
      const { req, res } = createMockReqRes({ cookies: { token: "valid-jwt" } });
      await handlers[0](req, res);

      expect(res.json).toHaveBeenCalledWith({ identity: identityData });
    });

    it("should return null identity for invalid token", async () => {
      jwt.verify.mockImplementation(() => { throw new Error("expired"); });

      const handlers = getRouteHandler(router, "get", "/");
      const { req, res } = createMockReqRes({ cookies: { token: "bad-jwt" } });
      await handlers[0](req, res);

      expect(res.json).toHaveBeenCalledWith({ identity: null });
    });

    it("should return null identity when no cookie", async () => {
      const handlers = getRouteHandler(router, "get", "/");
      const { req, res } = createMockReqRes();
      await handlers[0](req, res);

      expect(res.json).toHaveBeenCalledWith({ identity: null });
    });
  });

  describe("POST /register", () => {
    it("should register new identity and return 201", async () => {
      identity.findByEmail.mockResolvedValue(null);
      const newUser = { identity: "1-1-1", name: "John Doe", email: "j@t.com" };
      identity.create.mockResolvedValue(newUser);

      const handlers = getRouteHandler(router, "post", "/register");
      const { req, res } = createMockReqRes({
        body: { firstName: "John", surname: "Doe", email: "j@t.com", password: "secret" },
      });
      await handlers[0](req, res);

      expect(identity.create).toHaveBeenCalledWith(
        expect.objectContaining({ email: "j@t.com", firstName: "John" })
      );
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.cookie).toHaveBeenCalledWith("token", "new-jwt", expect.any(Object));
    });

    it("should return 400 when email already exists", async () => {
      identity.findByEmail.mockResolvedValue({ identity: "existing" });

      const handlers = getRouteHandler(router, "post", "/register");
      const { req, res } = createMockReqRes({
        body: { email: "existing@t.com" },
      });
      await handlers[0](req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ message: "Identity already exists" });
    });

    it("should return 500 on unexpected error", async () => {
      identity.findByEmail.mockRejectedValue(new Error("db error"));
      const consoleSpy = jest.spyOn(console, "error").mockImplementation();

      const handlers = getRouteHandler(router, "post", "/register");
      const { req, res } = createMockReqRes({ body: { email: "j@t.com" } });
      await handlers[0](req, res);

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

      const handlers = getRouteHandler(router, "post", "/login");
      const { req, res } = createMockReqRes({
        body: { email: "j@t.com", password: "secret" },
      });
      await handlers[0](req, res);

      expect(res.json).toHaveBeenCalledWith({ identity: found });
      expect(res.cookie).toHaveBeenCalledWith("token", "new-jwt", expect.any(Object));
    });

    it("should return 400 when email not found", async () => {
      identity.findByEmail.mockResolvedValue(null);

      const handlers = getRouteHandler(router, "post", "/login");
      const { req, res } = createMockReqRes({
        body: { email: "nobody@t.com", password: "x" },
      });
      await handlers[0](req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ message: "Invalid credentials" });
    });

    it("should return 400 when password does not match", async () => {
      identity.findByEmail.mockResolvedValue({ password: "hashed" });
      identity.matchPassword.mockResolvedValue(false);

      const handlers = getRouteHandler(router, "post", "/login");
      const { req, res } = createMockReqRes({
        body: { email: "j@t.com", password: "wrong" },
      });
      await handlers[0](req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ message: "Invalid credentials" });
    });

    it("should return 500 on unexpected error", async () => {
      identity.findByEmail.mockRejectedValue(new Error("db error"));
      const consoleSpy = jest.spyOn(console, "error").mockImplementation();

      const handlers = getRouteHandler(router, "post", "/login");
      const { req, res } = createMockReqRes({
        body: { email: "j@t.com", password: "x" },
      });
      await handlers[0](req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      consoleSpy.mockRestore();
    });
  });

  describe("POST /logout", () => {
    it("should clear cookie and return empty object", async () => {
      const handlers = getRouteHandler(router, "post", "/logout");
      const { req, res } = createMockReqRes();
      await handlers[0](req, res);

      expect(res.clearCookie).toHaveBeenCalledWith("token", expect.any(Object));
      expect(res.json).toHaveBeenCalledWith({});
    });
  });
});
