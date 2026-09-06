jest.mock("../../src/caio-server-binarystore/abl/binary-abl", () => ({
  __esModule: true,
  default: {
    list: jest.fn().mockResolvedValue([]),
    listPage: jest.fn().mockResolvedValue({ itemList: [], pageInfo: { pageIndex: 0, pageSize: 1000, total: 0 } }),
    get: jest.fn().mockResolvedValue({}),
    create: jest.fn().mockResolvedValue({}),
    update: jest.fn().mockResolvedValue({}),
    delete: jest.fn().mockResolvedValue(),
    deleteMany: jest.fn().mockResolvedValue(),
  },
}));

import createApi from "../../src/caio-server-binarystore/api/binary-api.js";
import Binary from "../../src/caio-server-binarystore/abl/binary-abl.js";

const GALLERY_EDITOR = { identity: "2-2-1", profileList: ["galleryEditor"] };
const OPERATIVE = { identity: "1-1-1", profileList: ["operatives"] };

function createTestApi() {
  return createApi({
    collectionMap: {
      // public to read, one role to write
      gallery: { write: { profileList: ["galleryEditor", "operatives"] } },
      // nobody but operatives, reading included
      sys: { read: { profileList: ["operatives"] }, write: { profileList: ["operatives"] } },
      // named people regardless of role
      file: { write: { identityList: ["1-1-1"] } },
      // app decides
      custom: { write: { authorize: jest.fn(async ({ dtoIn }) => dtoIn.magic === true) } },
    },
  });
}

describe("BinaryStore createApi", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Binary.get.mockResolvedValue({ id: "b1", collection: "gallery" });
  });

  it("registers the five afkbratcice use-cases plus deleteMany for the bulk-delete button", () => {
    const api = createTestApi();
    expect(Object.keys(api)).toEqual([
      "binary/list", "binary/get", "binary/create", "binary/update", "binary/delete", "binary/deleteMany",
    ]);
  });

  describe("collection stated in dtoIn (list, create)", () => {
    it("lets an anonymous caller read a collection with no read rule", async () => {
      const api = createTestApi();
      await expect(api["binary/list"].auth({ dtoIn: { collection: "gallery" }, identity: null })).resolves.toBe(true);
    });

    it("refuses an anonymous caller on a collection that restricts reading", async () => {
      const api = createTestApi();
      await expect(api["binary/list"].auth({ dtoIn: { collection: "sys" }, identity: null })).resolves.toBe(false);
    });

    it("matches a profile from the collection's write rule", async () => {
      const api = createTestApi();
      await expect(
        api["binary/create"].auth({ dtoIn: { collection: "gallery" }, identity: GALLERY_EDITOR }),
      ).resolves.toBe(true);
    });

    it("keeps a role out of a collection it does not own", async () => {
      const api = createTestApi();
      await expect(
        api["binary/create"].auth({ dtoIn: { collection: "sys" }, identity: GALLERY_EDITOR }),
      ).resolves.toBe(false);
    });

    it("supports naming identities instead of roles", async () => {
      const api = createTestApi();
      await expect(api["binary/create"].auth({ dtoIn: { collection: "file" }, identity: OPERATIVE })).resolves.toBe(true);
      await expect(
        api["binary/create"].auth({ dtoIn: { collection: "file" }, identity: GALLERY_EDITOR }),
      ).resolves.toBe(false);
    });

    it("hands the decision to a custom authorize fn", async () => {
      const api = createTestApi();
      await expect(
        api["binary/create"].auth({ dtoIn: { collection: "custom", magic: true }, identity: OPERATIVE }),
      ).resolves.toBe(true);
      await expect(
        api["binary/create"].auth({ dtoIn: { collection: "custom" }, identity: OPERATIVE }),
      ).resolves.toBe(false);
    });

    it("rejects an unknown collection with a 400 rather than a silent pass", async () => {
      const api = createTestApi();
      await expect(
        api["binary/create"].auth({ dtoIn: { collection: "nope" }, identity: OPERATIVE }),
      ).rejects.toMatchObject({ status: 400, code: "caio-server-binarystore/unknownCollection" });
    });

    it("requires collection in dtoIn for list and create", () => {
      const api = createTestApi();
      expect(() => api["binary/list"].validator({ dtoIn: {} })).toThrow(/collection is required/);
      expect(() => api["binary/create"].validator({ dtoIn: {} })).toThrow(/collection is required/);
    });
  });

  describe("collection taken from the stored record (get, update, delete)", () => {
    it("uses the record's collection, not the one the caller claims", async () => {
      const api = createTestApi();
      // caller says "gallery" (which they may write), the record is in "sys" (which they may not)
      Binary.get.mockResolvedValue({ id: "b1", collection: "sys" });
      await expect(
        api["binary/update"].auth({ dtoIn: { id: "b1", collection: "gallery" }, identity: GALLERY_EDITOR }),
      ).resolves.toBe(false);
      expect(Binary.get).toHaveBeenCalledWith("b1");
    });

    it("passes the loaded record to a custom authorize fn", async () => {
      const authorize = jest.fn(async ({ binary }) => binary.collection === "custom");
      const api = createApi({ collectionMap: { custom: { write: { authorize } } } });
      Binary.get.mockResolvedValue({ id: "b9", collection: "custom" });

      await expect(api["binary/delete"].auth({ dtoIn: { id: "b9" }, identity: OPERATIVE })).resolves.toBe(true);
      expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ binary: { id: "b9", collection: "custom" } }));
    });

    it("lets the handler answer 404 when the record is missing", async () => {
      const api = createTestApi();
      Binary.get.mockResolvedValue(null);
      await expect(api["binary/delete"].auth({ dtoIn: { id: "gone" }, identity: null })).resolves.toBe(true);
    });

    it("deleteMany refuses the whole batch when one file is out of reach", async () => {
      const api = createTestApi();
      Binary.get.mockImplementation(async (id) => ({ id, collection: id === "b2" ? "sys" : "gallery" }));
      await expect(
        api["binary/deleteMany"].auth({ dtoIn: { idList: ["b1", "b2"] }, identity: GALLERY_EDITOR }),
      ).resolves.toBe(false);
    });

    it("deleteMany passes when every file is in reach", async () => {
      const api = createTestApi();
      Binary.get.mockImplementation(async (id) => ({ id, collection: "gallery" }));
      await expect(
        api["binary/deleteMany"].auth({ dtoIn: { idList: ["b1", "b2"] }, identity: GALLERY_EDITOR }),
      ).resolves.toBe(true);
    });
  });

  describe("handlers", () => {
    // Seznam jde přes `listPage`, ne `list`: `UiElements.Crud` bez `pageInfo.total` neví,
    // jestli má načíst druhou stránku, takže tahle jediná list operace total potřebuje.
    it("list passes the filter through and returns itemList with pageInfo", async () => {
      const api = createTestApi();
      const pageInfo = { pageIndex: 0, pageSize: 1000, total: 1 };
      Binary.listPage.mockResolvedValue({ itemList: [{ id: "b1" }], pageInfo });
      const dtoOut = await api["binary/list"].fn({ dtoIn: { collection: "gallery", refId: "g1" } });
      expect(Binary.listPage).toHaveBeenCalledWith({ collection: "gallery", refId: "g1" });
      expect(dtoOut).toEqual({ itemList: [{ id: "b1" }], pageInfo });
    });

    it("create hands the whole dtoIn to the abl", async () => {
      const api = createTestApi();
      const dtoIn = { collection: "gallery", refId: "g1", file: {}, name: "a.jpg" };
      await api["binary/create"].fn({ dtoIn });
      expect(Binary.create).toHaveBeenCalledWith(dtoIn);
    });
  });
});
