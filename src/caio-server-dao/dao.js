import { mongo, connect, ObjectId } from "./helpers/mongo.js";
import Config from "./config/config.js";
import DaoError from "./dao-error.js";

const DEFAULT_PAGE_SIZE = 1000;

function convertId(object) {
  if (object.hasOwnProperty("_id")) {
    delete object.id;
  } else if (object.hasOwnProperty("id")) {
    object._id = new ObjectId(object.id);
    delete object.id;
  }
  return object;
}

// _id -> id, and **as a string**. It used to hand back the ObjectId itself, which looks
// harmless because JSON.stringify turns it into the same string over the wire -- but in
// process it silently breaks every comparison against an id that came from a client
// (`team.id === dtoIn.teamId` is false, `$in: [idFromDao]` matches nothing). Strings are
// also symmetric with the input side: get(), listByIdList() and update() all take them.
function toId(element) {
  if (element && element.hasOwnProperty("_id")) {
    element.id = String(element._id);
    delete element._id;
  }
  return element;
}

function convertToId(obj) {
  return obj?.constructor === Array ? obj.map(toId) : toId(obj);
}

function createData(data) {
  const cts = new Date().toISOString();
  return { ...data, sys: { cts, mts: cts } };
}

class Dao {
  constructor(collectionName, { uri = Config.mongodbUri } = {}) {
    this.uri = uri;
    this.collectionName = collectionName;
    this._client = null;
    this._db = null;
    this._coll = null;

    if (this.uri) {
      try {
        this._initMongo();
        // createIndexes() is fire-and-forget here -- the constructor can't await an async
        // method -- so a subclass that lets it reject (an unreachable/incompatible Mongo
        // server, e.g.) turns that into an unhandled rejection that crashes the whole
        // process, not just this collection's indexing. Catching it here makes that safe
        // for every subclass, not just ones that remember to guard it themselves.
        Promise.resolve(this.createIndexes?.()).catch((e) => {
          console.warn(`[Dao/${this.collectionName}] could not create indexes:`, e?.message ?? e);
        });
      } catch (e) {}
    }
  }

  _initMongo() {
    if (!this.uri) throw new Error(`[Dao/${this.collectionName}] MongoDB URI not configured (MONGODB_URI env var is empty)`);
    if (!this._client) {
      this._client = mongo(this.uri);
      this._db = this._client.db();
      this._coll = this._db.collection(this.collectionName);
    }
  }

  get client() { if (!this._client) this._initMongo(); return this._client; }
  get db() { if (!this._db) this._initMongo(); return this._db; }
  get coll() { if (!this._coll) this._initMongo(); return this._coll; }

  async createIndex(keys, opts) { return await this.coll.createIndex(keys, opts); }
  find(filter = {}, { pageSize = DEFAULT_PAGE_SIZE, pageIndex } = {}, sort = {}, projection = {}) {
    return this._exec(() => this._find(filter, { projection }, sort, pageIndex ? pageIndex * pageSize : 0, pageSize));
  }
  findOne(filter = {}, projection = {}, sort = {}) {
    return this._exec(() => this._find(filter, { projection }, sort, 0, 1)).then((result) => result.length < 1 ? null : result[0]);
  }
  list(pageInfo) { return this.find(undefined, pageInfo); }
  listByIdList(idList) { return this.find({ _id: { $in: idList.map((id) => new ObjectId(id)) } }); }
  get(id) { return this.findOne({ id }); }

  /**
   * Like find(), but also says how many rows the filter matches in total.
   *
   * `find()` on its own cannot support paging: a client that gets 20 rows back has no way
   * to tell "that is everything" from "that is the first of nine pages". uu5g05's
   * `useDataList` -- which is what `UiElements.Crud` runs on -- needs `pageInfo.total` to
   * decide whether to ask for the next page at all, so without it a list is one batch and
   * nothing more.
   *
   * **This is a separate method rather than a change to `find()` on purpose.** `find()` is
   * the most-used method on the whole stack and every dao in every app builds on it;
   * turning its return value from an array into an object would break all of them at once
   * for the sake of a number only list use-cases need. Callers that want paging opt in.
   *
   * The count is a second round trip to Mongo, so it is worth it for a paged list and
   * wasteful for an internal lookup -- another reason the two are separate methods.
   *
   * @returns {{ itemList: object[], pageInfo: { pageIndex: number, pageSize: number, total: number } }}
   */
  async findPage(filter = {}, { pageSize = DEFAULT_PAGE_SIZE, pageIndex = 0 } = {}, sort = {}, projection = {}) {
    // Converted once and reused: convertId() rewrites `id` to `_id` **in place**, so
    // handing the same object to two concurrent queries would mean one of them racing the
    // other's mutation.
    const mongoFilter = convertId({ ...filter });

    const [itemList, total] = await Promise.all([
      this._exec(() => this._find(mongoFilter, { projection }, sort, pageIndex * pageSize, pageSize)),
      this._exec(() => this.coll.countDocuments(mongoFilter)),
    ]);

    return { itemList, pageInfo: { pageIndex, pageSize, total } };
  }

  /** `findPage()` over the whole collection -- the paged counterpart of `list()`. */
  listPage(pageInfo) { return this.findPage(undefined, pageInfo); }

  async create(data) {
    if (data.sys) throw new DaoError("Key 'sys' is reserved in each dao object " + JSON.stringify(data), "create/invalidSys");
    const newData = createData(data);
    await this._exec(() => this.coll.insertOne(newData));
    return convertToId(newData);
  }

  async createMany(dataList) {
    const newDataList = dataList.map((data) => createData(data));
    const { insertedIds } = await this._exec(() => this.coll.insertMany(newDataList));
    // Same shape as create(): no _id, and `id` as a string. It used to spread the document
    // after `{ id: insertedIds[i] }`, which left BOTH an ObjectId `id` and the `_id` that
    // insertMany stamps onto each document -- so a caller got two keys for the same thing
    // and every comparison against an id that came from a client silently failed.
    return newDataList.map(({ _id, ...data }, i) => ({ id: String(_id ?? insertedIds[i]), ...data }));
  }

  async update(data) {
    const { id, ...restData } = data;
    delete restData.sys;
    const mts = new Date().toISOString();
    await this._exec(() => this.coll.updateOne(convertId({ id }), {
      $set: { ...restData, "sys.mts": mts },
    }));
    return await this.get(id);
  }

  async delete(id) { await this._exec(() => this.coll.deleteOne(convertId({ id }))); }
  async deleteMany(idList) { await this._exec(() => this.coll.deleteMany({ _id: { $in: idList.map((id) => new ObjectId(id)) } })); }
  async deleteByFilter(filter) { await this._exec(() => this.coll.deleteMany(filter)); }

  _find(filter, options, sort, skip, limit) {
    return this.coll
      .find(convertId(filter), options)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .toArray()
      .then(convertToId);
  }

  async _exec(callback) {
    try {
      await connect(this.uri);
    } catch (e) {
      // Not configured at all is a setup problem, not an outage -- the Atlas hint would only mislead.
      if (this.uri) console.error("Cannot connect to mongo. Check https://cloud.mongodb.com/v2/648433fc6d28c3603ac3dd22#/clusters if database is running.", e);
      throw e;
    }
    return await callback();
  }
}

export default Dao;
