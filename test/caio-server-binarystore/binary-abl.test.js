jest.mock("multer", () => {
  const uploadAny = jest.fn();
  const multerInstance = { any: () => uploadAny };
  const multerFn = jest.fn(() => multerInstance);
  multerFn.memoryStorage = jest.fn();
  multerFn._uploadAny = uploadAny;
  return multerFn;
});

jest.mock("../../src/caio-server-binarystore/dao/binary-dao", () => ({
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  deleteMany: jest.fn(),
  get: jest.fn(),
  list: jest.fn(),
  listByIdList: jest.fn(),
  findOne: jest.fn(),
}));

jest.mock("../../src/caio-server-binarystore/abl/storage-abl", () => ({
  __esModule: true,
  default: {
    create: jest.fn(),
    delete: jest.fn(),
    setName: jest.fn(),
    getUri: jest.fn((objectName) => `https://storage.googleapis.com/test-bucket/${objectName}`),
  },
}));

jest.mock("../../src/caio-server-dao/helpers/mongo", () => ({
  mongo: jest.fn(() => ({
    db: jest.fn(() => ({
      collection: jest.fn(() => ({
        createIndex: jest.fn(),
        find: jest.fn(),
      })),
    })),
    connect: jest.fn(),
  })),
  ObjectId: jest.fn((id) => id),
}));

jest.mock("../../src/caio-server-dao/config/config", () => ({
  mongodbUri: "mongodb://test",
}));

jest.mock("../../src/caio-server-binarystore/config/config", () => ({
  bucketName: "test-bucket",
  maxFileSizeMB: 25,
  maxFiles: 20,
  ERROR_PREFIX: "caio-server-binarystore/",
}));

import BinaryAbl from "../../src/caio-server-binarystore/abl/binary-abl.js";
import StorageAbl from "../../src/caio-server-binarystore/abl/storage-abl.js";
import dao from "../../src/caio-server-binarystore/dao/binary-dao.js";
import multer from "multer";
import Crud from "../../src/caio-server-core/crud.js";

describe("BinaryAbl", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("create", () => {
    it("should upload to storage and create in dao", async () => {
      const file = { size: 1024, mimetype: "image/jpeg" };
      StorageAbl.create.mockResolvedValue({ objectName: "obj1", uri: "https://storage.googleapis.com/test-bucket/obj1" });
      dao.create.mockResolvedValue({ _id: "db1", name: "custom.jpg", objectName: "obj1", uri: "https://storage.googleapis.com/test-bucket/obj1", size: 1024, mimeType: "image/jpeg" });

      const result = await BinaryAbl.create({ file, name: "custom.jpg" });

      expect(StorageAbl.create).toHaveBeenCalledWith(file, "custom.jpg");
      expect(dao.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: "custom.jpg", objectName: "obj1", size: 1024 })
      );
      expect(result).toHaveProperty("uri");
      expect(result).not.toHaveProperty("objectName");
    });

    it("should append the missing extension to a name given without one", async () => {
      const file = { size: 1024, mimetype: "image/jpeg", originalname: "DSC_0001.jpeg" };
      StorageAbl.create.mockResolvedValue({ objectName: "obj1.jpg", uri: "uri1" });
      dao.create.mockResolvedValue({ _id: "db1", name: "Dovolená.jpg" });

      await BinaryAbl.create({ file, name: "Dovolená" });

      expect(StorageAbl.create).toHaveBeenCalledWith(file, "Dovolená.jpg");
      expect(dao.create).toHaveBeenCalledWith(expect.objectContaining({ name: "Dovolená.jpg" }));
    });

    it("should take the extension from the mime type when the uploaded name disagrees", async () => {
      // What BinaryCrud#onPreSubmit produces: the bytes were re-encoded to webp client-side and
      // the file name may still carry the extension of whatever the user originally picked.
      const file = { size: 1024, mimetype: "image/webp", originalname: "photo.jpg" };
      StorageAbl.create.mockResolvedValue({ objectName: "obj1.webp", uri: "uri1" });
      dao.create.mockResolvedValue({ _id: "db1", name: "photo.jpg.webp" });

      await BinaryAbl.create({ file });

      expect(StorageAbl.create).toHaveBeenCalledWith(file, "photo.jpg.webp");
    });

    it("should use the client's original filename when name not provided", async () => {
      const file = { size: 512, mimetype: "text/plain", originalname: "original.txt" };
      StorageAbl.create.mockResolvedValue({ objectName: "obj2", uri: "uri2" });
      dao.create.mockResolvedValue({ _id: "db2", name: "original.txt", objectName: "obj2" });

      await BinaryAbl.create({ file });

      expect(dao.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: "original.txt" })
      );
    });

    it("should rollback the storage object on dao error", async () => {
      const file = { size: 100, mimetype: "image/png" };
      StorageAbl.create.mockResolvedValue({ objectName: "obj3", uri: "uri3" });
      dao.create.mockRejectedValue(new Error("dao error"));

      await expect(BinaryAbl.create({ file })).rejects.toThrow(Crud.Error.CreateFailed);
      expect(StorageAbl.delete).toHaveBeenCalledWith("obj3");
    });

    it("should still throw CreateFailed if the rollback also fails", async () => {
      const file = { size: 100, mimetype: "image/png" };
      StorageAbl.create.mockResolvedValue({ objectName: "obj4", uri: "uri4" });
      dao.create.mockRejectedValue(new Error("dao error"));
      StorageAbl.delete.mockRejectedValue(new Error("storage delete failed"));
      const consoleSpy = jest.spyOn(console, "error").mockImplementation();

      await expect(BinaryAbl.create({ file })).rejects.toThrow(Crud.Error.CreateFailed);
      consoleSpy.mockRestore();
    });

    it("should throw CreateFailed when the upload fails (no rollback needed)", async () => {
      StorageAbl.create.mockRejectedValue(new Error("upload failed"));

      await expect(BinaryAbl.create({ file: {} })).rejects.toThrow(Crud.Error.CreateFailed);
      expect(StorageAbl.delete).not.toHaveBeenCalled();
    });
  });

  describe("update", () => {
    it("should upload new content under a new objectName, switch metadata, then delete the old object", async () => {
      const file = { size: 2048, mimetype: "image/png" };
      dao.get.mockResolvedValue({ id: "db1", objectName: "obj-old", name: "old.jpg" });
      StorageAbl.create.mockResolvedValue({ objectName: "obj-new", uri: "https://storage.googleapis.com/test-bucket/obj-new" });
      dao.update.mockResolvedValue({ _id: "db1", name: "new.png", objectName: "obj-new", size: 2048 });

      const result = await BinaryAbl.update({ id: "db1", file, name: "new.png" });

      expect(StorageAbl.create).toHaveBeenCalledWith(file, "new.png");
      expect(dao.update).toHaveBeenCalledWith(
        expect.objectContaining({ objectName: "obj-new", name: "new.png", size: 2048 })
      );
      expect(StorageAbl.delete).toHaveBeenCalledWith("obj-old");
      expect(result).not.toHaveProperty("objectName");
    });

    it("should move the extension along with replaced content when no new name is given", async () => {
      const file = { size: 2048, mimetype: "image/png", originalname: "scan.png" };
      dao.get.mockResolvedValue({ id: "db1", objectName: "obj-old", name: "old.jpg" });
      StorageAbl.create.mockResolvedValue({ objectName: "obj-new.png", uri: "uri-new" });
      dao.update.mockResolvedValue({ _id: "db1", name: "old.jpg.png" });

      await BinaryAbl.update({ id: "db1", file });

      expect(StorageAbl.create).toHaveBeenCalledWith(file, "old.jpg.png");
    });

    it("should rename the storage object without re-uploading when no file is given", async () => {
      dao.get.mockResolvedValue({ id: "db1", objectName: "obj-old", name: "old.jpg", mimeType: "image/jpeg" });
      dao.update.mockResolvedValue({ _id: "db1", name: "renamed.jpg", objectName: "obj-old" });

      await BinaryAbl.update({ id: "db1", name: "renamed.jpg" });

      expect(StorageAbl.create).not.toHaveBeenCalled();
      expect(StorageAbl.delete).not.toHaveBeenCalled();
      expect(StorageAbl.setName).toHaveBeenCalledWith("obj-old", "renamed.jpg");
    });

    it("should keep the update when the storage rename fails", async () => {
      dao.get.mockResolvedValue({ id: "db1", objectName: "obj-old", name: "old.jpg", mimeType: "image/jpeg" });
      dao.update.mockResolvedValue({ _id: "db1", name: "renamed.jpg", objectName: "obj-old" });
      StorageAbl.setName.mockRejectedValue(new Error("storage error"));
      const consoleSpy = jest.spyOn(console, "error").mockImplementation();

      await expect(BinaryAbl.update({ id: "db1", name: "renamed.jpg" })).resolves.toHaveProperty("name", "renamed.jpg");
      consoleSpy.mockRestore();
    });

    it("should not touch storage when neither the file nor the name changes", async () => {
      dao.get.mockResolvedValue({ id: "db1", objectName: "obj-old", name: "old.jpg" });
      dao.update.mockResolvedValue({ _id: "db1", name: "old.jpg", objectName: "obj-old" });

      await BinaryAbl.update({ id: "db1", someOtherField: "x" });

      expect(StorageAbl.create).not.toHaveBeenCalled();
      expect(StorageAbl.setName).not.toHaveBeenCalled();
    });

    it("should roll back the new object and keep the old one when dao.update fails", async () => {
      const file = { size: 10, mimetype: "image/png" };
      dao.get.mockResolvedValue({ id: "db1", objectName: "obj-old", name: "old.jpg" });
      StorageAbl.create.mockResolvedValue({ objectName: "obj-new", uri: "uri-new" });
      dao.update.mockRejectedValue(new Error("dao error"));

      await expect(BinaryAbl.update({ id: "db1", file })).rejects.toThrow(Crud.Error.UpdateFailed);
      expect(StorageAbl.delete).toHaveBeenCalledWith("obj-new");
      expect(StorageAbl.delete).not.toHaveBeenCalledWith("obj-old");
    });

    it("should throw UpdateFailed when the record does not exist", async () => {
      dao.get.mockRejectedValue(new Error("not found"));
      await expect(BinaryAbl.update({ id: "bad" })).rejects.toThrow(Crud.Error.UpdateFailed);
    });
  });

  describe("delete", () => {
    it("should delete from storage and dao", async () => {
      dao.get.mockResolvedValue({ objectName: "obj1" });
      StorageAbl.delete.mockResolvedValue();
      dao.delete.mockResolvedValue();

      await BinaryAbl.delete("db1");

      expect(StorageAbl.delete).toHaveBeenCalledWith("obj1");
      expect(dao.delete).toHaveBeenCalledWith("db1");
    });

    it("should still delete the dao record when there is no objectName", async () => {
      dao.get.mockResolvedValue({});

      await BinaryAbl.delete("db1");

      expect(StorageAbl.delete).not.toHaveBeenCalled();
      expect(dao.delete).toHaveBeenCalledWith("db1");
    });

    it("should still delete the dao record when storage delete fails", async () => {
      dao.get.mockResolvedValue({ objectName: "obj1" });
      StorageAbl.delete.mockRejectedValue(new Error("storage error"));
      const consoleSpy = jest.spyOn(console, "error").mockImplementation();

      await BinaryAbl.delete("db1");

      expect(dao.delete).toHaveBeenCalledWith("db1");
      consoleSpy.mockRestore();
    });

    it("should throw DeleteFailed when the dao lookup errors", async () => {
      dao.get.mockRejectedValue(new Error("not found"));
      await expect(BinaryAbl.delete("bad")).rejects.toThrow(Crud.Error.DeleteFailed);
    });
  });

  describe("deleteMany", () => {
    it("should delete every object from storage and the dao records in one call", async () => {
      dao.listByIdList.mockResolvedValue([
        { id: "1", objectName: "obj1" },
        { id: "2", objectName: "obj2" },
      ]);
      dao.deleteMany.mockResolvedValue();

      await BinaryAbl.deleteMany(["1", "2"]);

      expect(StorageAbl.delete).toHaveBeenCalledWith("obj1");
      expect(StorageAbl.delete).toHaveBeenCalledWith("obj2");
      expect(dao.deleteMany).toHaveBeenCalledWith(["1", "2"]);
    });

    it("should skip items without an objectName but still delete their dao records", async () => {
      dao.listByIdList.mockResolvedValue([{ id: "1" }]);
      dao.deleteMany.mockResolvedValue();

      await BinaryAbl.deleteMany(["1"]);

      expect(StorageAbl.delete).not.toHaveBeenCalled();
      expect(dao.deleteMany).toHaveBeenCalledWith(["1"]);
    });

    it("should still delete the dao records when a storage delete fails", async () => {
      dao.listByIdList.mockResolvedValue([{ id: "1", objectName: "obj1" }]);
      StorageAbl.delete.mockRejectedValue(new Error("storage error"));
      dao.deleteMany.mockResolvedValue();
      const consoleSpy = jest.spyOn(console, "error").mockImplementation();

      await BinaryAbl.deleteMany(["1"]);

      expect(dao.deleteMany).toHaveBeenCalledWith(["1"]);
      consoleSpy.mockRestore();
    });

    it("should throw DeleteManyFailed when the dao lookup errors", async () => {
      dao.listByIdList.mockRejectedValue(new Error("mongo down"));
      await expect(BinaryAbl.deleteMany(["1"])).rejects.toThrow(Crud.Error.DeleteManyFailed);
    });
  });

  describe("_getData", () => {
    it("should strip objectName and keep the stored uri", () => {
      const result = BinaryAbl._getData({ objectName: "obj1", name: "test.jpg", size: 100, uri: "https://storage.googleapis.com/test-bucket/obj1" });
      expect(result).not.toHaveProperty("objectName");
      expect(result).toHaveProperty("uri", "https://storage.googleapis.com/test-bucket/obj1");
      expect(result).toHaveProperty("name", "test.jpg");
    });
  });

  describe("parseFormDataRequest", () => {
    it("should resolve on successful parse", async () => {
      multer._uploadAny.mockImplementation((req, res, cb) => cb(null));
      await expect(BinaryAbl.parseFormDataRequest({}, {})).resolves.toBeUndefined();
    });

    it("should rethrow non-limit multer errors as-is", async () => {
      multer._uploadAny.mockImplementation((req, res, cb) => cb(new Error("broken request")));
      await expect(BinaryAbl.parseFormDataRequest({}, {})).rejects.toThrow("broken request");
    });

    it("should turn a file-size limit error into a readable 413", async () => {
      const limitError = new Error("File too large");
      limitError.code = "LIMIT_FILE_SIZE";
      multer._uploadAny.mockImplementation((req, res, cb) => cb(limitError));

      await expect(BinaryAbl.parseFormDataRequest({}, {})).rejects.toMatchObject({ status: 413 });
    });

    it("should turn a file-count limit error into a readable 413", async () => {
      const limitError = new Error("Too many files");
      limitError.code = "LIMIT_FILE_COUNT";
      multer._uploadAny.mockImplementation((req, res, cb) => cb(limitError));

      await expect(BinaryAbl.parseFormDataRequest({}, {})).rejects.toMatchObject({ status: 413 });
    });
  });
});
