import Dao from "./dao.js";

class IdentityDao extends Dao {
  constructor(collectionName = "sys_identity") {
    super(collectionName);
  }

  /**
   * Not awaited by the constructor, so it must not reject: a failure here is a
   * warning, not a reason for the server not to come up.
   */
  async createIndexes() {
    try {
      await super.createIndex({ identity: 1 }, { unique: true });
      await super.createIndex({ name: 1 });

      // One identity per e-mail: Google, Facebook and a password all map onto the same
      // document (docs/auth.md, 5.1). Partial, because an identity may legitimately
      // have no e-mail -- Facebook does not always hand one over (R4) -- and a plain
      // unique index counts all those missing values as one, so only a single such
      // identity could ever exist.
      await super.createIndex(
        { email: 1 },
        { unique: true, partialFilterExpression: { email: { $type: "string" } } },
      );

      // Looked up on every provider sign-in.
      for (const field of ["googleId", "facebookId"]) {
        await super.createIndex({ [field]: 1 }, { partialFilterExpression: { [field]: { $type: "string" } } });
      }

      // The previous unique index was over the *pair* e-mail + password, which allowed
      // two accounts with the same e-mail and different passwords while blocking two
      // password-less ones -- the opposite of what it should guarantee.
      await this._dropIndexIfExists("email_1_password_1");
    } catch (e) {
      // A duplicate e-mail in existing data is the interesting case: the unique index
      // cannot be built and it has to be resolved in the data, not in code.
      const detail = e?.code === 11000 ? " -- duplicate e-mails in the collection, merge them first" : "";
      console.warn(`[IdentityDao] could not create indexes${detail}:`, e?.message ?? e);
    }
  }

  async _dropIndexIfExists(name) {
    try {
      await this.coll.dropIndex(name);
      console.log(`[IdentityDao] dropped obsolete index ${name}`);
    } catch (e) {
      // 27 = IndexNotFound, which is the normal case on every collection but an old one.
      if (e?.code !== 27) throw e;
    }
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
