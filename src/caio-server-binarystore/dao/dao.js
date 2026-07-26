import { Dao as BaseDao } from "../../caio-server-dao/index.js";
import Config from "../config/config.js";

class Dao extends BaseDao {
  constructor(collectionName) {
    super(collectionName, { uri: Config.mongodbUri });
  }
}

export default Dao;
