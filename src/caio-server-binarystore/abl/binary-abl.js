import multer from "multer";
import dao from "../dao/binary-dao.js";
import { Crud, Error as CoreError } from "../../caio-server-core/index.js";
import StorageAbl from "./storage-abl.js";
import Config from "../config/config.js";

class PayloadTooLargeError extends CoreError {
  constructor(msg, opts) {
    super(msg, { status: 413, code: "caio-server-binarystore/payloadTooLarge", ...opts });
  }
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Config.maxFileSizeMB * 1024 * 1024, files: Config.maxFiles },
});

class BinaryAbl extends Crud {

  constructor() {
    super("sys/binary", dao);
  }

  async create(data) {
    const { file, name, ...restParams } = data;

    let storageFile;
    try {
      storageFile = await StorageAbl.create(file);

      const binaryData = await this.dao.create({
        name: name ?? file.originalname,
        objectName: storageFile.objectName,
        uri: storageFile.uri,
        size: file.size,
        mimeType: file.mimetype,
        ...restParams,
      });

      return this._getData(binaryData);
    } catch (e) {
      if (storageFile) {
        try {
          await StorageAbl.delete(storageFile.objectName);
        } catch (e) {
          console.error("Binary object cannot be deleted from storage after failed create", storageFile.objectName, e);
        }
      }
      throw new Crud.Error.CreateFailed(this.name, e);
    }
  }

  async update(data) {
    const { id, file, name, sys, ...updatedParams } = data;
    try {
      const binary = await this._get(id);

      // A content update never overwrites the existing object in place: it uploads under a new
      // objectName, only switches the metadata pointer once the DB write succeeds, and only then
      // removes the old object. That keeps a failed dao.update() from leaving either a corrupted
      // object (partial overwrite) or metadata pointing at content that was never written -- and,
      // as a side effect, gives every update a fresh uri so no browser/CDN cache can serve the
      // previous content (docs/binary.md, N10 / R4).
      let newStorageFile;
      if (file) {
        newStorageFile = await StorageAbl.create(file);
        updatedParams.objectName = newStorageFile.objectName;
        updatedParams.uri = newStorageFile.uri;
        updatedParams.size = file.size;
        updatedParams.mimeType = file.mimetype;
      }

      if (name) updatedParams.name = name;

      let binaryData;
      try {
        binaryData = await this.dao.update({ ...binary, ...updatedParams });
      } catch (e) {
        if (newStorageFile) {
          try {
            await StorageAbl.delete(newStorageFile.objectName);
          } catch (e) {
            console.error("Binary object cannot be deleted from storage after failed update", newStorageFile.objectName, e);
          }
        }
        throw e;
      }

      if (newStorageFile && binary.objectName) {
        try {
          await StorageAbl.delete(binary.objectName);
        } catch (e) {
          console.error("Old binary object cannot be deleted from storage after update", binary.objectName, e);
        }
      }

      return this._getData(binaryData);
    } catch (e) {
      throw new Crud.Error.UpdateFailed(this.name, e);
    }
  }

  async delete(id) {
    try {
      const binary = await this._get(id) || {};

      if (binary.objectName) {
        try {
          await StorageAbl.delete(binary.objectName);
        } catch (e) {
          console.error("Binary object cannot be deleted from storage", binary.objectName, e);
        }
      }

      await this.dao.delete(id);
    } catch (e) {
      throw new Crud.Error.DeleteFailed(this.name, e);
    }
  }

  async deleteMany(idList) {
    try {
      const items = await this.dao.listByIdList(idList);

      await Promise.all(
        items
          .filter((item) => item.objectName)
          .map((item) =>
            StorageAbl.delete(item.objectName).catch((e) => {
              console.error("Binary object cannot be deleted from storage", item.objectName, e);
            }),
          ),
      );

      await this.dao.deleteMany(idList);
    } catch (e) {
      throw new Crud.Error.DeleteManyFailed(this.name, e);
    }
  }

  async parseFormDataRequest(req, res) {
    try {
      await new Promise((resolve, reject) => upload.any()(req, res, (err) => err ? reject(err) : resolve()));
    } catch (e) {
      if (e.code === "LIMIT_FILE_SIZE" || e.code === "LIMIT_FILE_COUNT") {
        throw new PayloadTooLargeError(
          `Upload exceeds the configured limit (${Config.maxFileSizeMB} MB / ${Config.maxFiles} files).`,
          { cause: e }
        );
      }
      throw e;
    }
  }

  _getData({ objectName, ...data }) {
    return data;
  }
}

export default new BinaryAbl();
