import { Dao } from "../../caio-server-dao/index.js";

class BinaryDao extends Dao {
  constructor() {
    super("sys_binary");
  }

  createIndexes() {
    super.createIndex({ objectName: 1 }, { unique: true });
    super.createIndex({ size: 1 });
    super.createIndex({ mimeType: 1 });
    super.createIndex({ "sys.mts": 1 });
  }
}

export default new BinaryDao();
