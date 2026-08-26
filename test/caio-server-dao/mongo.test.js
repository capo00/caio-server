jest.mock("mongodb", () => ({
  MongoClient: jest.fn(function MongoClient(uri) {
    this.uri = uri;
    this.connect = jest.fn();
  }),
  ObjectId: function ObjectId(id) { this._id = id; },
}));

import { mongo, connect } from "../../src/caio-server-dao/helpers/mongo.js";

// Every test uses its own uri: mongo.js caches clients/connect promises at module level (by
// design -- one client per uri, shared across every Dao instance), so a distinct uri per test is
// what keeps the tests isolated from each other, not resetting the module.
describe("helpers/mongo", () => {
  describe("mongo(uri)", () => {
    it("returns the same client instance for the same uri", () => {
      expect(mongo("mongodb://a")).toBe(mongo("mongodb://a"));
    });

    it("returns different client instances for different uris", () => {
      expect(mongo("mongodb://b1")).not.toBe(mongo("mongodb://b2"));
    });
  });

  describe("connect(uri)", () => {
    it("calls client.connect() only once across sequential calls", async () => {
      const client = mongo("mongodb://sequential");
      client.connect.mockResolvedValue(true);

      await connect("mongodb://sequential");
      await connect("mongodb://sequential");

      expect(client.connect).toHaveBeenCalledTimes(1);
    });

    it("calls client.connect() only once for concurrent calls started before the first resolves", async () => {
      const client = mongo("mongodb://concurrent");
      let resolveConnect;
      client.connect.mockReturnValue(new Promise((resolve) => { resolveConnect = resolve; }));

      // Both start before either awaits -- this is exactly the shape that raced before the fix
      // (a Google login's IdentityDao and a binary/list request's BinaryDao, sharing one client).
      const p1 = connect("mongodb://concurrent");
      const p2 = connect("mongodb://concurrent");
      resolveConnect(true);
      await Promise.all([p1, p2]);

      expect(client.connect).toHaveBeenCalledTimes(1);
    });

    it("does not cache a rejection -- a later call retries", async () => {
      const client = mongo("mongodb://retry");
      client.connect.mockRejectedValueOnce(new Error("down")).mockResolvedValueOnce(true);

      await expect(connect("mongodb://retry")).rejects.toThrow("down");
      await expect(connect("mongodb://retry")).resolves.toBe(true);

      expect(client.connect).toHaveBeenCalledTimes(2);
    });
  });
});
