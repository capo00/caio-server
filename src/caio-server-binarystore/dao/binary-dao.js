import { Dao } from "../../caio-server-dao/index.js";

class BinaryDao extends Dao {
  constructor() {
    super("sys_binary");
  }

  // Returned (not awaited here) so the base Dao constructor's own safety net catches a
  // rejection instead of it becoming an unhandled one -- see Dao's constructor.
  createIndexes() {
    return Promise.all([
      super.createIndex({ objectName: 1 }, { unique: true }),
      super.createIndex({ size: 1 }),
      super.createIndex({ mimeType: 1 }),
      super.createIndex({ "sys.mts": 1 }),
    ]);
  }
}

export default new BinaryDao();
