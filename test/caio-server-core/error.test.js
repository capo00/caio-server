import AppError from "../../src/caio-server-core/error.js";

describe("AppError", () => {
  it("should set default status to 500", () => {
    const err = new AppError("something failed");
    expect(err.message).toBe("something failed");
    expect(err.status).toBe(500);
    expect(err).toBeInstanceOf(Error);
  });

  it("should store code, paramMap, dtoOut, cause", () => {
    const cause = new Error("root cause");
    const err = new AppError("fail", {
      code: "app/entity/fail",
      paramMap: { id: "123" },
      dtoOut: { partial: true },
      cause,
    });
    expect(err.code).toBe("app/entity/fail");
    expect(err.paramMap).toEqual({ id: "123" });
    expect(err.dtoOut).toEqual({ partial: true });
    expect(err.cause).toBe(cause);
  });

  it("should allow message override via opts.message", () => {
    const err = new AppError("original", { message: "overridden" });
    expect(err.message).toBe("overridden");
  });

  it("should allow custom status", () => {
    const err = new AppError("bad", { status: 403 });
    expect(err.status).toBe(403);
  });

  describe("toObject", () => {
    it("should return plain object without cause", () => {
      const err = new AppError("fail", { code: "x", paramMap: { a: 1 }, dtoOut: { b: 2 } });
      expect(err.toObject()).toEqual({
        message: "fail",
        code: "x",
        paramMap: { a: 1 },
        dtoOut: { b: 2 },
      });
    });

    it("should include cause.toObject() when cause has it", () => {
      const cause = new AppError("inner", { code: "inner/code" });
      const err = new AppError("outer", { cause });
      const obj = err.toObject();
      expect(obj.cause).toEqual(cause.toObject());
    });

    it("should fall back to cause.message when cause has no toObject", () => {
      const cause = new Error("native error");
      const err = new AppError("outer", { cause });
      expect(err.toObject().cause).toEqual({ message: "native error" });
    });
  });
});

describe("AppError.DoesNotExists", () => {
  it("should set status 404 and build code from codePrefix", () => {
    const err = new AppError.DoesNotExists("not found", { codePrefix: "myApp/player" });
    expect(err.status).toBe(404);
    expect(err.code).toBe("myApp/player/doesNotExist");
    expect(err.message).toBe("not found");
    expect(err).toBeInstanceOf(AppError);
  });

  it("should work without options", () => {
    const err = new AppError.DoesNotExists("gone");
    expect(err.status).toBe(404);
    expect(err.code).toBe("undefined/doesNotExist");
  });
});

describe("AppError.Failed", () => {
  it("should set status 500", () => {
    const err = new AppError.Failed("operation failed");
    expect(err.status).toBe(500);
    expect(err.message).toBe("operation failed");
    expect(err).toBeInstanceOf(AppError);
  });

  it("should allow overriding status via opts", () => {
    const err = new AppError.Failed("fail", { status: 503 });
    expect(err.status).toBe(503);
  });

  it("should pass cause through", () => {
    const cause = new Error("root");
    const err = new AppError.Failed("fail", { cause });
    expect(err.cause).toBe(cause);
  });
});
