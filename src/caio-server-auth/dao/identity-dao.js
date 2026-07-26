import Dao from "./dao.js";

class IdentityDao extends Dao {
  constructor(collectionName = "sys_identity") {
    super(collectionName);
  }

  createIndexes() {
    super.createIndex({ identity: 1 }, { unique: true });
    super.createIndex({ email: 1, password: 1 }, { unique: true });
    super.createIndex({ name: 1 });
  }

  async search(query) {
    if (!query) return [];
    const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    return this.find({ $or: [{ name: regex }, { identity: regex }] }, { pageSize: 20 });
  }

  async listbyIdentityList(identityList) {
    return this.find({ identity: { $in: identityList } });
  }

  async getByIdentity(identity) {
    return this.findOne({ identity });
  }
}

export { IdentityDao };
export default new IdentityDao();
