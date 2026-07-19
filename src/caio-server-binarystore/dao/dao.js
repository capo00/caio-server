const CaioServerDao = require("../../caio-server-dao");
const Config = require("../config/config")

class Dao extends CaioServerDao.Dao {
  constructor(collectionName) {
    super(collectionName, { uri: Config.mongodbUri });
  }
}

module.exports = Dao;
