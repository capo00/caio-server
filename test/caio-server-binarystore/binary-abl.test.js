jest.mock("multer", () => {
  const uploadAny = jest.fn();
  const multerInstance = { any: () => uploadAny };
  const multerFn = jest.fn(() => multerInstance);
  multerFn.diskStorage = jest.fn();
  multerFn._uploadAny = uploadAny;
  return multerFn;
});

jest.mock("../../src/caio-server-binarystore/dao/binary-dao", () => ({
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  get: jest.fn(),
  list: jest.fn(),
  listByIdList: jest.fn(),
  findOne: jest.fn(),
}));

jest.mock("../../src/caio-server-binarystore/abl/google-file-abl", () => ({
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  getUri: jest.fn((id) => `https://drive.google.com/uc?id=${id}`),
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
  mongodbUri: "mongodb://test",
  publicFolderId: "folder123",
  ERROR_PREFIX: "caio-server-binarystore/",
}));

import BinaryAbl from "../../src/caio-server-binarystore/abl/binary-abl.js";
import GoogleFileAbl from "../../src/caio-server-binarystore/abl/google-file-abl.js";
import dao from "../../src/caio-server-binarystore/dao/binary-dao.js";
import multer from "multer";
import Crud from "../../src/caio-server-core/crud.js";

describe("BinaryAbl", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("create", () => {
    it("should upload to Google Drive and create in dao", async () => {
      const file = { size: 1024, mimetype: "image/jpeg" };
      GoogleFileAbl.create.mockResolvedValue({ id: "g1", name: "photo.jpg", uri: "https://drive/g1" });
      dao.create.mockResolvedValue({ _id: "db1", name: "photo.jpg", gFileId: "g1", size: 1024, mimeType: "image/jpeg" });

      const result = await BinaryAbl.create({ file, name: "custom.jpg" });

      expect(GoogleFileAbl.create).toHaveBeenCalledWith(file);
      expect(dao.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: "custom.jpg", gFileId: "g1", size: 1024 })
      );
      expect(result).toHaveProperty("uri");
      expect(result).not.toHaveProperty("gFileId");
    });

    it("should use Google file name when name not provided", async () => {
      const file = { size: 512, mimetype: "text/plain" };
      GoogleFileAbl.create.mockResolvedValue({ id: "g2", name: "original.txt", uri: "https://drive/g2" });
      dao.create.mockResolvedValue({ _id: "db2", name: "original.txt", gFileId: "g2" });

      await BinaryAbl.create({ file });

      expect(dao.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: "original.txt" })
      );
    });

    it("should rollback Google file on dao error", async () => {
      const file = { size: 100, mimetype: "image/png" };
      GoogleFileAbl.create.mockResolvedValue({ id: "g3", name: "img.png", uri: "https://drive/g3" });
      dao.create.mockRejectedValue(new Error("dao error"));

      await expect(BinaryAbl.create({ file })).rejects.toThrow(Crud.Error.CreateFailed);
      expect(GoogleFileAbl.delete).toHaveBeenCalledWith("g3");
    });

    it("should still throw CreateFailed if Google rollback also fails", async () => {
      const file = { size: 100, mimetype: "image/png" };
      GoogleFileAbl.create.mockResolvedValue({ id: "g4", name: "img.png", uri: "uri" });
      dao.create.mockRejectedValue(new Error("dao error"));
      GoogleFileAbl.delete.mockRejectedValue(new Error("google delete failed"));
      const consoleSpy = jest.spyOn(console, "error").mockImplementation();

      await expect(BinaryAbl.create({ file })).rejects.toThrow(Crud.Error.CreateFailed);
      consoleSpy.mockRestore();
    });

    it("should throw CreateFailed when Google upload fails (no rollback needed)", async () => {
      GoogleFileAbl.create.mockRejectedValue(new Error("upload failed"));

      await expect(BinaryAbl.create({ file: {} })).rejects.toThrow(Crud.Error.CreateFailed);
      expect(GoogleFileAbl.delete).not.toHaveBeenCalled();
    });
  });

  describe("update", () => {
    it("should update file on Google and in dao", async () => {
      const file = { size: 2048, mimetype: "image/png" };
      dao.get.mockResolvedValue({ id: "db1", gFileId: "g1", name: "old.jpg" });
      GoogleFileAbl.update.mockResolvedValue({ uri: "https://drive/g1-new" });
      dao.update.mockResolvedValue({ _id: "db1", name: "new.png", gFileId: "g1", size: 2048 });

      const result = await BinaryAbl.update({ id: "db1", file, name: "new.png" });

      expect(GoogleFileAbl.update).toHaveBeenCalledWith("g1", file);
      expect(dao.update).toHaveBeenCalledWith(
        expect.objectContaining({ name: "new.png", size: 2048 })
      );
      expect(result).not.toHaveProperty("gFileId");
    });

    it("should update metadata only without file", async () => {
      dao.get.mockResolvedValue({ id: "db1", gFileId: "g1", name: "old.jpg" });
      dao.update.mockResolvedValue({ _id: "db1", name: "renamed.jpg", gFileId: "g1" });

      await BinaryAbl.update({ id: "db1", name: "renamed.jpg" });

      expect(GoogleFileAbl.update).not.toHaveBeenCalled();
    });

    it("should throw UpdateFailed on error", async () => {
      dao.get.mockRejectedValue(new Error("not found"));
      await expect(BinaryAbl.update({ id: "bad" })).rejects.toThrow(Crud.Error.UpdateFailed);
    });
  });

  describe("delete", () => {
    it("should delete from Google and dao", async () => {
      dao.get.mockResolvedValue({ gFileId: "g1" });
      GoogleFileAbl.delete.mockResolvedValue();
      dao.delete.mockResolvedValue();

      await BinaryAbl.delete("db1");

      expect(GoogleFileAbl.delete).toHaveBeenCalledWith("g1");
      expect(dao.delete).toHaveBeenCalledWith("db1");
    });

    it("should skip deletion when no gFileId", async () => {
      dao.get.mockResolvedValue({});

      await BinaryAbl.delete("db1");

      expect(GoogleFileAbl.delete).not.toHaveBeenCalled();
      expect(dao.delete).not.toHaveBeenCalled();
    });

    it("should throw DeleteFailed on error", async () => {
      dao.get.mockRejectedValue(new Error("not found"));
      await expect(BinaryAbl.delete("bad")).rejects.toThrow(Crud.Error.DeleteFailed);
    });
  });

  describe("_getData", () => {
    it("should strip gFileId and add uri", () => {
      const result = BinaryAbl._getData({ gFileId: "g1", name: "test.jpg", size: 100 });
      expect(result).not.toHaveProperty("gFileId");
      expect(result).toHaveProperty("uri", "https://drive.google.com/uc?id=g1");
      expect(result).toHaveProperty("name", "test.jpg");
    });

    it("should preserve existing uri", () => {
      const result = BinaryAbl._getData({ gFileId: "g1", uri: "custom-uri" });
      expect(result.uri).toBe("custom-uri");
    });
  });

  describe("parseFormDataRequest", () => {
    it("should resolve on successful parse", async () => {
      multer._uploadAny.mockImplementation((req, res, cb) => cb(null));
      await expect(BinaryAbl.parseFormDataRequest({})).resolves.toBeUndefined();
    });

    it("should reject on multer error", async () => {
      multer._uploadAny.mockImplementation((req, res, cb) => cb(new Error("too large")));
      await expect(BinaryAbl.parseFormDataRequest({})).rejects.toThrow("too large");
    });
  });
});
