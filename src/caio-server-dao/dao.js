import { mongo, ObjectId } from "./helpers/mongo.js";
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

function convertToId(obj) {
  let result;
  if (obj.constructor === Array) {
    result = obj.map((element) => {
      if (element.hasOwnProperty("_id")) {
        element.id = element._id;
        delete element._id;
      }
      return element;
    });
  } else {
    if (obj.hasOwnProperty("_id")) {
      obj.id = obj._id;
      delete obj._id;
    }
    result = obj;
  }
  return result;
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
    this._connectionsMap = {};

    if (this.uri) {
      try {
        this._initMongo();
        this.createIndexes?.();
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

  async create(data) {
    if (data.sys) throw new DaoError("Key 'sys' is reserved in each dao object " + JSON.stringify(data), "create/invalidSys");
    const newData = createData(data);
    await this._exec(() => this.coll.insertOne(newData));
    return convertToId(newData);
  }

  async createMany(dataList) {
    const newDataList = dataList.map((data) => createData(data));
    const { insertedIds } = await this._exec(() => this.coll.insertMany(newDataList));
    return newDataList.map((data, i) => ({ id: insertedIds[i], ...data }));
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
      this._connectionsMap[this.uri] ??= await this.client.connect();
    } catch (e) {
      // Not configured at all is a setup problem, not an outage -- the Atlas hint would only mislead.
      if (this.uri) console.error("Cannot connect to mongo. Check https://cloud.mongodb.com/v2/648433fc6d28c3603ac3dd22#/clusters if database is running.", e);
      throw e;
    }
    return await callback();
  }
}

export default Dao;
