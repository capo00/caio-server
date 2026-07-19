const DaoError = require("../../src/caio-server-dao/dao-error");

let mockCollection;
let mockDb;
let mockClient;

jest.mock("../../src/caio-server-dao/helpers/mongo", () => {
  mockCollection = {
    createIndex: jest.fn(),
    insertOne: jest.fn(),
    insertMany: jest.fn(),
    updateOne: jest.fn(),
    deleteOne: jest.fn(),
    deleteMany: jest.fn(),
    find: jest.fn(),
  };
  mockDb = { collection: jest.fn(() => mockCollection) };
  mockClient = { db: jest.fn(() => mockDb), connect: jest.fn() };

  return {
    mongo: jest.fn(() => mockClient),
    ObjectId: function ObjectId(id) { this._id = id; this.toString = () => `ObjectId(${id})`; },
  };
});

jest.mock("../../src/caio-server-dao/config/config", () => ({
  mongodbUri: "mongodb://test:27017/testdb",
}));

const Dao = require("../../src/caio-server-dao/dao");

function mockFindChain(results) {
  const chain = {
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    toArray: jest.fn().mockResolvedValue(results),
  };
  mockCollection.find.mockReturnValue(chain);
  return chain;
}

describe("Dao", () => {
  let dao;

  beforeEach(() => {
    jest.clearAllMocks();
    mockClient.connect.mockResolvedValue(true);
    dao = new Dao("testCollection");
  });

  it("should initialize collection", () => {
    expect(mockDb.collection).toHaveBeenCalledWith("testCollection");
  });

  it("should call createIndexes if subclass defines it", () => {
    const createIndexes = jest.fn();
    class TestDao extends Dao {
      createIndexes() { createIndexes(); }
    }
    new TestDao("test");
    expect(createIndexes).toHaveBeenCalled();
  });

  describe("createIndex", () => {
    it("should delegate to collection.createIndex", async () => {
      mockCollection.createIndex.mockResolvedValue("idx");
      const result = await dao.createIndex({ name: 1 }, { unique: true });
      expect(mockCollection.createIndex).toHaveBeenCalledWith({ name: 1 }, { unique: true });
      expect(result).toBe("idx");
    });
  });

  describe("create", () => {
    it("should add sys timestamps and return object with id", async () => {
      mockCollection.insertOne.mockResolvedValue({ insertedId: "abc" });
      const result = await dao.create({ name: "John" });
      expect(result).toHaveProperty("name", "John");
      expect(result).toHaveProperty("sys");
      expect(result.sys).toHaveProperty("cts");
      expect(result.sys).toHaveProperty("mts");
      expect(result.sys.cts).toBe(result.sys.mts);
    });

    it("should throw DaoError when data contains sys key", async () => {
      await expect(dao.create({ sys: { cts: "x" } })).rejects.toThrow(DaoError);
      await expect(dao.create({ sys: { cts: "x" } })).rejects.toThrow("Key 'sys' is reserved");
    });
  });

  describe("createMany", () => {
    it("should insert multiple and return array with ids", async () => {
      mockCollection.insertMany.mockResolvedValue({ insertedIds: { 0: "id1", 1: "id2" } });
      const result = await dao.createMany([{ name: "A" }, { name: "B" }]);
      expect(result).toHaveLength(2);
      expect(result[0]).toHaveProperty("id", "id1");
      expect(result[0]).toHaveProperty("name", "A");
      expect(result[0]).toHaveProperty("sys");
    });
  });

  describe("find", () => {
    it("should apply default pageSize of 1000", async () => {
      const chain = mockFindChain([]);
      await dao.find();
      expect(chain.limit).toHaveBeenCalledWith(1000);
      expect(chain.skip).toHaveBeenCalledWith(0);
    });

    it("should calculate skip from pageIndex and pageSize", async () => {
      const chain = mockFindChain([]);
      await dao.find({}, { pageSize: 10, pageIndex: 2 });
      expect(chain.skip).toHaveBeenCalledWith(20);
      expect(chain.limit).toHaveBeenCalledWith(10);
    });

    it("should convert _id to id in results", async () => {
      mockFindChain([{ _id: "abc", name: "John" }]);
      const result = await dao.find();
      expect(result[0]).toHaveProperty("id", "abc");
      expect(result[0]).not.toHaveProperty("_id");
    });
  });

  describe("findOne", () => {
    it("should return first result", async () => {
      mockFindChain([{ _id: "x", name: "John" }]);
      const result = await dao.findOne({ name: "John" });
      expect(result).toHaveProperty("id", "x");
    });

    it("should return null when no results", async () => {
      mockFindChain([]);
      const result = await dao.findOne({ name: "Nobody" });
      expect(result).toBeNull();
    });
  });

  describe("get", () => {
    it("should find by id", async () => {
      mockFindChain([{ _id: "x", name: "John" }]);
      const result = await dao.get("x");
      expect(result).toHaveProperty("name", "John");
    });

    it("should return null when not found", async () => {
      mockFindChain([]);
      const result = await dao.get("nonexistent");
      expect(result).toBeNull();
    });
  });

  describe("update", () => {
    it("should strip sys, set sys.mts, and return updated object", async () => {
      mockCollection.updateOne.mockResolvedValue({ modifiedCount: 1 });
      mockFindChain([{ _id: "1", name: "Updated", sys: { cts: "old", mts: "new" } }]);

      const result = await dao.update({ id: "1", name: "Updated", sys: { cts: "old" } });

      const updateCall = mockCollection.updateOne.mock.calls[0];
      const $set = updateCall[1].$set;
      expect($set.sys).toBeUndefined();
      expect($set["sys.mts"]).toBeDefined();
      expect($set.name).toBe("Updated");
    });
  });

  describe("delete", () => {
    it("should call deleteOne with converted id", async () => {
      mockCollection.deleteOne.mockResolvedValue({ deletedCount: 1 });
      await dao.delete("abc");
      expect(mockCollection.deleteOne).toHaveBeenCalledTimes(1);
      const arg = mockCollection.deleteOne.mock.calls[0][0];
      expect(arg._id).toBeDefined();
    });
  });

  describe("deleteMany", () => {
    it("should call deleteMany with ObjectId array", async () => {
      mockCollection.deleteMany.mockResolvedValue({ deletedCount: 2 });
      await dao.deleteMany(["a", "b"]);
      expect(mockCollection.deleteMany).toHaveBeenCalledTimes(1);
      const arg = mockCollection.deleteMany.mock.calls[0][0];
      expect(arg._id.$in).toHaveLength(2);
    });
  });

  describe("deleteByFilter", () => {
    it("should call deleteMany with raw filter", async () => {
      mockCollection.deleteMany.mockResolvedValue({ deletedCount: 1 });
      await dao.deleteByFilter({ status: "inactive" });
      expect(mockCollection.deleteMany).toHaveBeenCalledWith({ status: "inactive" });
    });
  });

  describe("_exec", () => {
    it("should cache connection", async () => {
      mockFindChain([]);
      await dao.find();
      await dao.find();
      expect(mockClient.connect).toHaveBeenCalledTimes(1);
    });

    it("should throw on connection error", async () => {
      const freshDao = new Dao("test2");
      freshDao._connectionsMap = {};
      mockClient.connect.mockRejectedValueOnce(new Error("connection refused"));
      const consoleSpy = jest.spyOn(console, "error").mockImplementation();
      await expect(freshDao.find()).rejects.toThrow("connection refused");
      consoleSpy.mockRestore();
    });
  });
});
