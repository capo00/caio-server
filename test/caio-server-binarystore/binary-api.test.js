jest.mock("../../src/caio-server-binarystore/abl/binary-abl", () => ({
  __esModule: true,
  default: {
    list: jest.fn().mockResolvedValue([]),
    get: jest.fn().mockResolvedValue({}),
    create: jest.fn().mockResolvedValue({}),
    update: jest.fn().mockResolvedValue({}),
    delete: jest.fn().mockResolvedValue(),
  },
}));

import createApi from "../../src/caio-server-binarystore/api/binary-api.js";
import Binary from "../../src/caio-server-binarystore/abl/binary-abl.js";

describe("BinaryStore createApi", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("registers the five binary use-cases with the same names as afkbratcice", () => {
    const api = createApi();
    expect(Object.keys(api)).toEqual([
      "binary/list", "binary/get", "binary/create", "binary/update", "binary/delete",
    ]);
  });

  it("defaults list/get to no auth", () => {
    const api = createApi();
    expect(api["binary/list"].auth).toBeUndefined();
    expect(api["binary/get"].auth).toBeUndefined();
  });

  it("defaults create/update/delete to requiring a login when not configured", () => {
    const api = createApi();
    expect(api["binary/create"].auth).toBe(true);
    expect(api["binary/update"].auth).toBe(true);
    expect(api["binary/delete"].auth).toBe(true);
  });

  it("maps { profileList } to auth as a profile array", () => {
    const api = createApi({ create: { profileList: ["operatives"] } });
    expect(api["binary/create"].auth).toEqual(["operatives"]);
  });

  it("maps { authorize } to auth as the custom async fn, taking priority over profileList", () => {
    const authorize = async () => true;
    const api = createApi({ delete: { authorize, profileList: ["admin"] } });
    expect(api["binary/delete"].auth).toBe(authorize);
  });

  it("requires an id for get/delete", () => {
    const api = createApi();
    expect(() => api["binary/get"].validator({ dtoIn: {} })).toThrow();
    expect(() => api["binary/delete"].validator({ dtoIn: { id: "" } })).toThrow();
    expect(api["binary/get"].validator({ dtoIn: { id: "abc" } })).toEqual({ id: "abc" });
  });

  it("delegates to Binary abl", async () => {
    const api = createApi();
    await api["binary/get"].fn({ dtoIn: { id: "abc" } });
    expect(Binary.get).toHaveBeenCalledWith("abc");

    await api["binary/delete"].fn({ dtoIn: { id: "abc" } });
    expect(Binary.delete).toHaveBeenCalledWith("abc");

    await api["binary/list"].fn({ dtoIn: undefined });
    expect(Binary.list).toHaveBeenCalledWith({});
  });
});
