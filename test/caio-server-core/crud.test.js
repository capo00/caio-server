import Crud from "../../src/caio-server-core/crud.js";

function createMockDao() {
  return {
    list: jest.fn(),
    listByIdList: jest.fn(),
    get: jest.fn(),
    create: jest.fn(),
    createMany: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
  };
}

describe("Crud", () => {
  let dao;
  let crud;

  beforeEach(() => {
    dao = createMockDao();
    crud = new Crud("player", dao);
  });

  describe("list", () => {
    it("should use listByIdList when idList is provided", async () => {
      dao.listByIdList.mockResolvedValue([{ _id: "a1", name: "John" }]);
      const result = await crud.list({ idList: ["a1"] });
      expect(dao.listByIdList).toHaveBeenCalledWith(["a1"]);
      expect(result).toEqual([{ name: "John" }]);
    });

    it("should use list with pageInfo when no idList", async () => {
      const pageInfo = { pageSize: 10, pageIndex: 0 };
      dao.list.mockResolvedValue([{ _id: "b1", name: "Jane" }]);
      const result = await crud.list({ pageInfo });
      expect(dao.list).toHaveBeenCalledWith(pageInfo);
      expect(result).toEqual([{ name: "Jane" }]);
    });

    it("should strip _id from results", async () => {
      dao.list.mockResolvedValue([{ _id: "x", foo: "bar", nested: { a: 1 } }]);
      const result = await crud.list({});
      expect(result[0]).not.toHaveProperty("_id");
      expect(result[0]).toEqual({ foo: "bar", nested: { a: 1 } });
    });
  });

  describe("get", () => {
    it("should return item without _id", async () => {
      dao.get.mockResolvedValue({ _id: "x", name: "John" });
      const result = await crud.get("x");
      expect(result).toEqual({ name: "John" });
    });

    it("should throw DoesNotExists when dao.get fails", async () => {
      dao.get.mockRejectedValue(new Error("not found"));
      await expect(crud.get("x")).rejects.toThrow(Crud.Error.DoesNotExists);
    });
  });

  describe("create", () => {
    it("should create and return item without _id", async () => {
      dao.create.mockResolvedValue({ _id: "new", name: "John" });
      const result = await crud.create({ name: "John" });
      expect(dao.create).toHaveBeenCalledWith({ name: "John" });
      expect(result).toEqual({ name: "John" });
    });

    it("should throw CreateFailed on dao error", async () => {
      dao.create.mockRejectedValue(new Error("insert error"));
      await expect(crud.create({ name: "John" })).rejects.toThrow(Crud.Error.CreateFailed);
    });
  });

  describe("createMany", () => {
    it("should create multiple and strip _id", async () => {
      dao.createMany.mockResolvedValue([
        { _id: "1", name: "A" },
        { _id: "2", name: "B" },
      ]);
      const result = await crud.createMany([{ name: "A" }, { name: "B" }]);
      expect(result).toEqual([{ name: "A" }, { name: "B" }]);
    });

    it("should throw CreateManyFailed on dao error", async () => {
      dao.createMany.mockRejectedValue(new Error("bulk error"));
      await expect(crud.createMany([{}])).rejects.toThrow(Crud.Error.CreateManyFailed);
    });
  });

  describe("update", () => {
    it("should merge with existing data by default", async () => {
      dao.get.mockResolvedValue({ _id: "1", name: "Old", age: 30 });
      dao.update.mockResolvedValue({ _id: "1", name: "New", age: 30 });
      const result = await crud.update({ id: "1", name: "New" });
      expect(dao.update).toHaveBeenCalledWith(
        expect.objectContaining({ name: "New", age: 30 })
      );
      expect(result).toEqual({ name: "New", age: 30 });
    });

    it("should skip merge when merge=false", async () => {
      dao.update.mockResolvedValue({ _id: "1", name: "Direct" });
      const result = await crud.update({ id: "1", name: "Direct" }, { merge: false });
      expect(dao.get).not.toHaveBeenCalled();
      expect(result).toEqual({ name: "Direct" });
    });

    it("should throw UpdateFailed on dao error", async () => {
      dao.get.mockResolvedValue({ _id: "1", name: "Old" });
      dao.update.mockRejectedValue(new Error("update error"));
      await expect(crud.update({ id: "1", name: "New" })).rejects.toThrow(Crud.Error.UpdateFailed);
    });

    it("should throw UpdateFailed when item not found during merge", async () => {
      dao.get.mockRejectedValue(new Error("not found"));
      await expect(crud.update({ id: "1", name: "X" })).rejects.toThrow(Crud.Error.UpdateFailed);
    });
  });

  describe("delete", () => {
    it("should call dao.delete", async () => {
      dao.delete.mockResolvedValue(undefined);
      await crud.delete("1");
      expect(dao.delete).toHaveBeenCalledWith("1");
    });

    it("should throw DeleteFailed on dao error", async () => {
      dao.delete.mockRejectedValue(new Error("delete error"));
      await expect(crud.delete("1")).rejects.toThrow(Crud.Error.DeleteFailed);
    });
  });

  describe("deleteMany", () => {
    it("should call dao.deleteMany", async () => {
      dao.deleteMany.mockResolvedValue(undefined);
      await crud.deleteMany(["1", "2"]);
      expect(dao.deleteMany).toHaveBeenCalledWith(["1", "2"]);
    });

    it("should throw DeleteManyFailed on dao error", async () => {
      dao.deleteMany.mockRejectedValue(new Error("bulk delete error"));
      await expect(crud.deleteMany(["1"])).rejects.toThrow(Crud.Error.DeleteManyFailed);
    });
  });
});

describe("Crud.Error", () => {
  it("DoesNotExists should have 404 status and correct code", () => {
    const err = new Crud.Error.DoesNotExists("player", new Error("x"));
    expect(err.status).toBe(404);
    expect(err.code).toBe("caio-server/player/doesNotExist");
    expect(err.cause).toBeInstanceOf(Error);
  });

  it("CreateFailed should have 500 status and correct code", () => {
    const err = new Crud.Error.CreateFailed("player", new Error("x"));
    expect(err.status).toBe(500);
    expect(err.code).toBe("caio-server/player/createFailed");
  });

  it("CreateManyFailed should have correct code", () => {
    const err = new Crud.Error.CreateManyFailed("player", new Error("x"));
    expect(err.code).toBe("caio-server/player/createManyFailed");
  });

  it("UpdateFailed should have correct code", () => {
    const err = new Crud.Error.UpdateFailed("player", new Error("x"));
    expect(err.code).toBe("caio-server/player/updateFailed");
  });

  it("DeleteFailed should have correct code", () => {
    const err = new Crud.Error.DeleteFailed("player", new Error("x"));
    expect(err.code).toBe("caio-server/player/deleteFailed");
  });

  it("DeleteManyFailed should have correct code", () => {
    const err = new Crud.Error.DeleteManyFailed("player", new Error("x"));
    expect(err.code).toBe("caio-server/player/deleteManyFailed");
  });
});
