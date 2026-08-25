jest.mock("../../src/caio-server-auth/config/config", () => ({ mongodbUri: "" }));

// The base Dao is replaced so nothing tries to reach MongoDB; createIndex lives on the
// prototype because IdentityDao calls it through super.
jest.mock("../../src/caio-server-dao/index.js", () => {
  class Dao {
    constructor(collectionName) {
      this.collectionName = collectionName;
      this.coll = { dropIndex: jest.fn().mockResolvedValue(undefined) };
    }
  }
  Dao.prototype.createIndex = jest.fn().mockResolvedValue("ok");
  return { Dao };
});

import { Dao as BaseDao } from "../../src/caio-server-dao/index.js";
import { IdentityDao } from "../../src/caio-server-auth/dao/identity-dao.js";

describe("IdentityDao.createIndexes", () => {
  let dao;

  beforeEach(() => {
    jest.clearAllMocks();
    BaseDao.prototype.createIndex.mockResolvedValue("ok");
    dao = new IdentityDao("sys_identity");
    dao.coll.dropIndex.mockResolvedValue(undefined);
  });

  function indexCall(keys) {
    return BaseDao.prototype.createIndex.mock.calls.find(
      ([spec]) => JSON.stringify(spec) === JSON.stringify(keys),
    );
  }

  it("should make e-mail unique, but only where there is one", async () => {
    await dao.createIndexes();

    // One identity per e-mail (Google, Facebook and a password map onto the same
    // document), and partial so that identities without an e-mail -- Facebook does not
    // always give one -- do not collide with each other.
    expect(indexCall({ email: 1 })[1]).toEqual({
      unique: true,
      partialFilterExpression: { email: { $type: "string" } },
    });
  });

  it("should index the provider ids it looks accounts up by", async () => {
    await dao.createIndexes();

    for (const field of ["googleId", "facebookId"]) {
      expect(indexCall({ [field]: 1 })).toBeDefined();
      expect(indexCall({ [field]: 1 })[1].unique).toBeUndefined();
    }
  });

  it("should drop the obsolete e-mail+password index", async () => {
    await dao.createIndexes();

    expect(dao.coll.dropIndex).toHaveBeenCalledWith("email_1_password_1");
  });

  it("should ignore the obsolete index not being there", async () => {
    dao.coll.dropIndex.mockRejectedValue(Object.assign(new Error("index not found"), { code: 27 }));
    const warn = jest.spyOn(console, "warn").mockImplementation();

    await dao.createIndexes();

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("should warn instead of rejecting when an index cannot be built", async () => {
    // Not awaited by the Dao constructor, so a rejection here would be an unhandled one
    // -- and duplicate e-mails in existing data are exactly the case that gets here.
    BaseDao.prototype.createIndex.mockRejectedValue(Object.assign(new Error("dup key"), { code: 11000 }));
    const warn = jest.spyOn(console, "warn").mockImplementation();

    await expect(dao.createIndexes()).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("duplicate e-mails"), expect.anything());
    warn.mockRestore();
  });
});
