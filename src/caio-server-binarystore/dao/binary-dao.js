const Dao = require("./dao");

class BinaryDao extends Dao {
  constructor() {
    super("sys_binary");
  }

  createIndexes() {
    super.createIndex({ gFileId: 1 }, { unique: true });
    super.createIndex({ size: 1 });
    super.createIndex({ mimeType: 1 });
    super.createIndex({ "sys.mts": 1 });
  }
}

module.exports = new BinaryDao();
