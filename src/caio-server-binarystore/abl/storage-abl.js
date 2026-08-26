import crypto from "crypto";
import { Storage } from "@google-cloud/storage";
import Config from "../config/config.js";

// ADC: on App Engine this is the instance service account, locally it is either
// `gcloud auth application-default login` or an explicit GOOGLE_APPLICATION_CREDENTIALS
// key file. No keyFilename literal here on purpose (docs/binary.md, R3).
const storage = new Storage();

function bucket() {
  return storage.bucket(Config.bucketName);
}

class StorageAbl {
  static async create(file) {
    const objectName = crypto.randomUUID();
    await bucket().file(objectName).save(file.buffer, { contentType: file.mimetype });
    return { objectName, uri: StorageAbl.getUri(objectName) };
  }

  static async delete(objectName) {
    await bucket().file(objectName).delete();
  }

  static getUri(objectName) {
    return `https://storage.googleapis.com/${Config.bucketName}/${objectName}`;
  }
}

export default StorageAbl;
