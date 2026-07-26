import os from "os";
import dao from "../dao/binary-dao.js";
import multer from "multer";
import { Crud, Error as CoreError } from "../../caio-server-core/index.js";
import GoogleFileAbl from "./google-file-abl.js";

const storage = multer.diskStorage({
  destination: os.tmpdir(),
  filename: (req, file, callback) => callback(null, `${file.originalname}`)
});

const upload = multer({ storage });

class BinaryAbl extends Crud {

  constructor() {
    super("sys/binary", dao);
  }


  async create(data) {
    const { file, name, ...restParams } = data;

    let gFile;
    try {
      gFile = await GoogleFileAbl.create(file);

      const binaryData = await this.dao.create({
        name: name ?? gFile.name,
        gFileId: gFile.id,
        size: file.size,
        mimeType: file.mimetype,
        ...restParams,
      });

      return this._getData({ ...binaryData, uri: gFile.uri });
    } catch (e) {
      if (gFile) {
        try {
          await GoogleFileAbl.delete(gFile.id);
        } catch (e) {
          console.error("Binary cannot be deleted from GoogleFile", gFile.id, gFile.uri);
        }
      }
      throw new Crud.Error.CreateFailed(this.name, e);
    }
  }

  async update(data) {
    const { id, file, name, sys, ...updatedParams } = data;
    try {
      const binary = await this._get(id);

      let uri;
      if (file) {
        // Update file metadata or content
        const gFile = await GoogleFileAbl.update(binary.gFileId, file);
        updatedParams.size = file.size;
        updatedParams.mimeType = file.mimetype;
        uri = gFile.uri;
      }

      if (name) updatedParams.name = name;

      const binaryData = await this.dao.update({
        ...binary,
        ...updatedParams,
      });

      return this._getData({ ...binaryData, uri });
    } catch (e) {
      throw new Crud.Error.UpdateFailed(this.name, e);
    }
  }

  async delete(id) {
    try {
      const { gFileId } = await this._get(id) || {};

      if (gFileId) {
        await GoogleFileAbl.delete(gFileId);
        await this.dao.delete(id);
      }
    } catch (e) {
      throw new Crud.Error.DeleteFailed(this.name, e);
    }
  }

  parseFormDataRequest(req) {
    return new Promise((resolve, reject) => upload.any()(req, null, (err) => err ? reject(err) : resolve()));
  }

  _getData(object) {
    const { gFileId, ...data } = object;
    return {
      ...data,
      uri: data.uri || GoogleFileAbl.getUri(gFileId),
    };
  }
}

export default new BinaryAbl();
