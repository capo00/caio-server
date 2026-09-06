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
      // Every read that is not "by id" goes through a collection, and usually also
      // through the record the file belongs to.
      super.createIndex({ collection: 1, refId: 1 }),
    ]);
  }

  /**
   * Lists one collection, optionally narrowed to the record the files belong to.
   * `collection` and `refId` are BinaryStore's own fields, so it is safe to let a
   * client filter by them -- app-specific fields are not exposed this way.
   */
  listByCollection({ collection, refId }, pageInfo) {
    const filter = { collection };
    if (refId) filter.refId = refId;
    return this.find(filter, pageInfo, { "sys.cts": -1 });
  }
}

export default new BinaryDao();
