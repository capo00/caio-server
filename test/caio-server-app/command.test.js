jest.mock("../../src/caio-server-auth/index.js", () => ({
  __esModule: true,
  default: { authentication: jest.fn((req, res, next) => next()) },
}));

jest.mock("../../src/caio-server-binarystore/index.js", () => ({
  __esModule: true,
  default: { Binary: { parseFormDataRequest: jest.fn() } },
}));

jest.mock("../../src/caio-server-core/index.js", () => {
  const AppError = require("../../src/caio-server-core/error.js").default;
  return { __esModule: true, Error: AppError, Crud: require("../../src/caio-server-core/crud.js").default };
});

import Command from "../../src/caio-server-app/services/command.js";
import CaioServerAuth from "../../src/caio-server-auth/index.js";
import CaioServerBinaryStore from "../../src/caio-server-binarystore/index.js";
import { Error as AppError } from "../../src/caio-server-core/index.js";

function createMockApp() {
  const routes = {};
  const app = {
    use: jest.fn(),
    get: jest.fn((path, ...handlers) => { routes[`GET ${path}`] = handlers; }),
    post: jest.fn((path, ...handlers) => { routes[`POST ${path}`] = handlers; }),
    _routes: routes,
  };
  return app;
}

function createMockReqRes(overrides = {}) {
  const req = {
    query: {},
    body: undefined,
    headers: {},
    cookies: {},
    identity: null,
    is: jest.fn(() => null),
    ...overrides,
  };
  const res = {
    json: jest.fn(),
    send: jest.fn(),
    status: jest.fn(function () { return this; }),
    cookie: jest.fn(),
    clearCookie: jest.fn(),
  };
  const next = jest.fn();
  return { req, res, next };
}

describe("Command.createCommands", () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = createMockApp();
  });

  it("should register sys/health endpoint", async () => {
    Command.createCommands(app, {}, { publicPath: "/public" });
    expect(app.get).toHaveBeenCalledWith("/sys/health", expect.any(Function));

    const handler = app._routes["GET /sys/health"][0];
    const { req, res } = createMockReqRes();
    await handler(req, res, jest.fn());
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ version: expect.anything() }));
  });

  it("should register custom use case", () => {
    Command.createCommands(app, {
      "player/list": { method: "get", fn: jest.fn() },
    }, { publicPath: "/public" });
    expect(app.get).toHaveBeenCalledWith("/player/list", expect.any(Function));
  });

  it("should add authentication middleware when auth=true", () => {
    Command.createCommands(app, {
      "player/get": { method: "get", auth: true, fn: jest.fn() },
    }, { publicPath: "/public" });
    const handlers = app._routes["GET /player/get"];
    expect(handlers).toHaveLength(2);
    expect(handlers[0]).toBe(CaioServerAuth.authentication);
  });

  it("should add authentication + authorization when auth is array", () => {
    Command.createCommands(app, {
      "player/create": { method: "post", auth: ["Admin"], fn: jest.fn() },
    }, { publicPath: "/public" });
    const handlers = app._routes["POST /player/create"];
    expect(handlers).toHaveLength(3);
    expect(handlers[0]).toBe(CaioServerAuth.authentication);
  });

  describe("handler", () => {
    it("should pass dtoIn from query to fn and respond with dtoOut", async () => {
      const fn = jest.fn().mockResolvedValue({ name: "John" });
      Command.createCommands(app, {
        "player/get": { method: "get", fn },
      }, { publicPath: "/pub" });

      const handler = app._routes["GET /player/get"][0];
      const { req, res, next } = createMockReqRes({ query: { id: "1" } });
      await handler(req, res, next);
      expect(fn).toHaveBeenCalledWith(expect.objectContaining({ dtoIn: { id: "1" } }));
      expect(res.json).toHaveBeenCalledWith({ name: "John" });
    });

    it("should respond with {} when fn returns null", async () => {
      const fn = jest.fn().mockResolvedValue(null);
      Command.createCommands(app, {
        "player/get": { method: "get", fn },
      }, { publicPath: "/pub" });

      const handler = app._routes["GET /player/get"][0];
      const { req, res, next } = createMockReqRes();
      await handler(req, res, next);
      expect(res.json).toHaveBeenCalledWith({});
    });

    it("should not send response when fn returns false", async () => {
      const fn = jest.fn().mockResolvedValue(false);
      Command.createCommands(app, {
        "player/get": { method: "get", fn },
      }, { publicPath: "/pub" });

      const handler = app._routes["GET /player/get"][0];
      const { req, res, next } = createMockReqRes();
      await handler(req, res, next);
      expect(res.json).not.toHaveBeenCalled();
    });

    it("should handle AppError with status and toObject", async () => {
      const fn = jest.fn().mockRejectedValue(new AppError("not found", { status: 404, code: "x" }));
      Command.createCommands(app, {
        "player/get": { method: "get", fn },
      }, { publicPath: "/pub" });

      const handler = app._routes["GET /player/get"][0];
      const { req, res, next } = createMockReqRes();
      const consoleSpy = jest.spyOn(console, "error").mockImplementation();
      await handler(req, res, next);
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.send).toHaveBeenCalledWith(expect.objectContaining({ code: "x" }));
      consoleSpy.mockRestore();
    });

    it("should handle unexpected error with 500", async () => {
      const fn = jest.fn().mockRejectedValue(new TypeError("oops"));
      Command.createCommands(app, {
        "player/get": { method: "get", fn },
      }, { publicPath: "/pub" });

      const handler = app._routes["GET /player/get"][0];
      const { req, res, next } = createMockReqRes();
      const consoleSpy = jest.spyOn(console, "error").mockImplementation();
      await handler(req, res, next);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.send).toHaveBeenCalledWith(expect.objectContaining({ message: "Unexpected exception" }));
      consoleSpy.mockRestore();
    });
  });

  describe("getDtoIn", () => {
    it("should merge body into query for POST with JSON content type", async () => {
      const fn = jest.fn().mockResolvedValue({});
      Command.createCommands(app, {
        "player/create": { method: "post", fn },
      }, { publicPath: "/pub" });

      const handler = app._routes["POST /player/create"][0];
      const { req, res, next } = createMockReqRes({
        query: { extra: "q" },
        body: { name: "John" },
        is: jest.fn((type) => type === "application/json" ? "application/json" : null),
      });
      await handler(req, res, next);
      expect(fn).toHaveBeenCalledWith(
        expect.objectContaining({ dtoIn: { extra: "q", name: "John" } })
      );
    });

    it("should parse JSON strings in dtoIn values", async () => {
      const fn = jest.fn().mockResolvedValue({});
      Command.createCommands(app, {
        "player/list": { method: "get", fn },
      }, { publicPath: "/pub" });

      const handler = app._routes["GET /player/list"][0];
      const { req, res, next } = createMockReqRes({
        query: { filter: '{"league":"I"}', plain: "text" },
      });
      await handler(req, res, next);
      expect(fn).toHaveBeenCalledWith(
        expect.objectContaining({ dtoIn: { filter: { league: "I" }, plain: "text" } })
      );
    });

    it("should handle multipart/form-data", async () => {
      CaioServerBinaryStore.Binary.parseFormDataRequest.mockResolvedValue();
      const fn = jest.fn().mockResolvedValue({});
      Command.createCommands(app, {
        "binary/create": { method: "post", fn },
      }, { publicPath: "/pub" });

      const handler = app._routes["POST /binary/create"][0];
      const { req, res, next } = createMockReqRes({
        headers: { "content-type": "multipart/form-data; boundary=---" },
        files: [{ fieldname: "file", originalname: "test.jpg" }],
        body: { name: "photo" },
      });
      await handler(req, res, next);
      expect(CaioServerBinaryStore.Binary.parseFormDataRequest).toHaveBeenCalledWith(req);
    });

    it("should call validator and use its result", async () => {
      const validator = jest.fn(({ dtoIn }) => ({ ...dtoIn, validated: true }));
      const fn = jest.fn().mockResolvedValue({});
      Command.createCommands(app, {
        "player/create": { method: "post", fn, validator },
      }, { publicPath: "/pub" });

      const handler = app._routes["POST /player/create"][0];
      const { req, res, next } = createMockReqRes({ query: { name: "John" } });
      await handler(req, res, next);
      expect(validator).toHaveBeenCalledWith({ dtoIn: { name: "John" } }, "dtoIn");
    });
  });

  describe("authorization", () => {
    it("should allow matching profile", async () => {
      Command.createCommands(app, {
        "admin/do": { method: "post", auth: ["Admin"], fn: jest.fn().mockResolvedValue({}) },
      }, { publicPath: "/pub" });

      const handlers = app._routes["POST /admin/do"];
      const authorizationMiddleware = handlers[1];
      const { req, res, next } = createMockReqRes();
      req.identity = { identity: "1-1-1", profileList: ["Admin", "User"] };
      authorizationMiddleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });

    it("should reject when profile does not match", async () => {
      Command.createCommands(app, {
        "admin/do": { method: "post", auth: ["Admin"], fn: jest.fn() },
      }, { publicPath: "/pub" });

      const handlers = app._routes["POST /admin/do"];
      const authorizationMiddleware = handlers[1];
      const { req, res, next } = createMockReqRes();
      req.identity = { identity: "1-1-1", profileList: ["User"] };
      authorizationMiddleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it("should reject when no identity", () => {
      Command.createCommands(app, {
        "admin/do": { method: "post", auth: ["Admin"], fn: jest.fn() },
      }, { publicPath: "/pub" });

      const handlers = app._routes["POST /admin/do"];
      const authorizationMiddleware = handlers[1];
      const { req, res, next } = createMockReqRes();
      authorizationMiddleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({ data: { identity: "0-0", profileList: [] } }),
        })
      );
    });
  });
});
