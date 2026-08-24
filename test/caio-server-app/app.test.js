jest.mock("../../src/caio-server-auth/index.js", () => ({
  __esModule: true,
  default: { init: jest.fn() },
}));

jest.mock("../../src/caio-server-app/services/command.js", () => ({
  __esModule: true,
  default: { createCommands: jest.fn() },
}));

jest.mock("express", () => {
  const routes = {};
  const app = {
    use: jest.fn(),
    get: jest.fn((path, ...handlers) => {
      routes[`GET ${path}`] = handlers;
    }),
    listen: jest.fn(),
  };
  const express = jest.fn(() => app);
  express.static = jest.fn(() => "static-middleware");
  express.json = jest.fn(() => "json-middleware");
  express.__app = app;
  express.__routes = routes;
  return { __esModule: true, default: express };
});

jest.mock("cors", () => ({ __esModule: true, default: jest.fn(() => "cors-middleware") }));
jest.mock("cookie-parser", () => ({ __esModule: true, default: jest.fn(() => "cookie-middleware") }));

import path from "path";
import express from "express";
import App from "../../src/caio-server-app/services/app.js";

function createMockRes() {
  return { sendFile: jest.fn() };
}

describe("App.init", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    for (const key of Object.keys(express.__routes)) delete express.__routes[key];
    jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    console.log.mockRestore();
  });

  it("serves static files from <cwd>/public by default", () => {
    App.init();

    expect(express.static).toHaveBeenCalledWith(path.resolve(process.cwd(), "public"));
  });

  it("passes an explicit publicPath through to static and to the commands", () => {
    const publicPath = path.resolve("/tmp/somewhere-else");
    App.init({ publicPath });

    expect(express.static).toHaveBeenCalledWith(publicPath);
  });

  describe("SPA fallback", () => {
    let handler;

    beforeEach(() => {
      App.init({ publicPath: "/app/public" });
      [handler] = express.__routes["GET /*splat"];
    });

    it("serves index.html for a client route", () => {
      const res = createMockRes();
      const next = jest.fn();

      handler({ path: "/reservation/detail" }, res, next);

      expect(res.sendFile).toHaveBeenCalledWith(path.resolve("/app/public", "index.html"));
      expect(next).not.toHaveBeenCalled();
    });

    it("serves index.html for the root", () => {
      const res = createMockRes();
      const next = jest.fn();

      handler({ path: "/" }, res, next);

      expect(res.sendFile).toHaveBeenCalledWith(path.resolve("/app/public", "index.html"));
      expect(next).not.toHaveBeenCalled();
    });

    // Answering these with index.html would report 200 + HTML for a missing file,
    // which hides the failure instead of surfacing it as a 404.
    it.each([
      "/libs/uu5g05/1.50.8/uu5g05.min.js",
      "/libs/uu_gds_svgg01/1.36.0/uu_gds_svgg01-icons.min.css",
      "/assets/gallery/kitchen.webp",
    ])("falls through for a missing file (%s)", (missing) => {
      const res = createMockRes();
      const next = jest.fn();

      handler({ path: missing }, res, next);

      expect(res.sendFile).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
    });
  });
});
