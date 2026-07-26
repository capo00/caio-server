import DaoError from "../../src/caio-server-dao/dao-error.js";

describe("DaoError", () => {
  it("should set message and prefixed code", () => {
    const err = new DaoError("insert failed", "create/invalidSys");
    expect(err.message).toBe("insert failed");
    expect(err.code).toBe("caio-server-dao/create/invalidSys");
    expect(err).toBeInstanceOf(Error);
  });

  it("should not set code when code is falsy", () => {
    const err = new DaoError("some error");
    expect(err.message).toBe("some error");
    expect(err.code).toBeUndefined();
  });

  it("should not set code for empty string", () => {
    const err = new DaoError("error", "");
    expect(err.code).toBeUndefined();
  });
});
