import crypto from "crypto";
import { Storage } from "@google-cloud/storage";
import Config from "../config/config.js";
import { getExtension, buildContentDisposition } from "../helpers/file-name.js";

// ADC: on App Engine this is the instance service account, locally it is either
// `gcloud auth application-default login` or an explicit GOOGLE_APPLICATION_CREDENTIALS
// key file. No keyFilename literal here on purpose (docs/binary.md, R3).
const storage = new Storage();

function bucket() {
  return storage.bucket(Config.bucketName);
}

class StorageAbl {
  /**
   * `name` is the name the browser should save the file under; it rides along as
   * Content-Disposition metadata on the object, since the public uri points straight at
   * storage.googleapis.com and there is no server in that path to add a header later.
   *
   * The object name keeps the extension too. That is not what makes the download work -- the
   * header does -- but it keeps the bucket browsable in the GCS console, where a wall of bare
   * UUIDs tells you nothing about what is in it.
   */
  static async create(file, name) {
    const objectName = crypto.randomUUID() + getExtension(file);
    await bucket().file(objectName).save(file.buffer, {
      contentType: file.mimetype,
      contentDisposition: buildContentDisposition(name),
    });
    return { objectName, uri: StorageAbl.getUri(objectName) };
  }

  /**
   * Renaming a binary without replacing its content still has to reach the storage object,
   * otherwise the table would show the new name while the browser kept saving the file under
   * the old one.
   */
  static async setName(objectName, name) {
    await bucket().file(objectName).setMetadata({ contentDisposition: buildContentDisposition(name) });
  }

  static async delete(objectName) {
    await bucket().file(objectName).delete();
  }

  static getUri(objectName) {
    return `https://storage.googleapis.com/${Config.bucketName}/${objectName}`;
  }
}

export default StorageAbl;
