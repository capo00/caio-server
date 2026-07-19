const { mongo, ObjectId } = require("./helpers/mongo");
const Config = require("./config/config");
const DaoError = require("./dao-error");

const DEFAULT_PAGE_SIZE = 1000;

function convertId(object) {
  // eslint-disable-next-line no-prototype-builtins
  if (object.hasOwnProperty("_id")) {
    delete object.id;
    // eslint-disable-next-line no-prototype-builtins
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
      // eslint-disable-next-line no-prototype-builtins
      if (element.hasOwnProperty("_id")) {
        element.id = element._id;
        delete element._id;
      }
      return element;
    });
  } else {
    // eslint-disable-next-line no-prototype-builtins
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
  return {
    ...data,
    sys: {
      cts,
      mts: cts,
    }
  };
}

class Dao {
  constructor(collectionName, { uri = Config.mongodbUri } = {}) {
    this.uri = uri;
    this.client = mongo(uri);
    this.db = this.client.db();
    this.coll = this.db.collection(collectionName);

    this._connectionsMap = {};

    this.createIndexes?.();
  }

  async createIndex(keys, opts) {
    return await this.coll.createIndex(keys, opts);
  }

  find(filter = {}, { pageSize = DEFAULT_PAGE_SIZE, pageIndex } = {}, sort = {}, projection = {}) {
    return this._exec(() => this._find(filter, { projection }, sort, pageIndex ? pageIndex * pageSize : 0, pageSize));
  }

  findOne(filter = {}, projection = {}, sort = {}) {
    return this._exec(() => this._find(filter, { projection }, sort, 0, 1)).then((result) => result.length < 1 ? null : result[0]);
  }

  list(pageInfo) {
    return this.find(undefined, pageInfo);
  }

  listByIdList(idList) {
    return this.find({ _id: { $in: idList.map((id) => new ObjectId(id)) } });
  }

  get(id) {
    return this.findOne({ id });
  }

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

  async delete(id) {
    await this._exec(() => this.coll.deleteOne(convertId({ id })));
  }

  async deleteMany(idList) {
    await this._exec(() => this.coll.deleteMany({ _id: { $in: idList.map((id) => new ObjectId(id)) } }));
  }

  async deleteByFilter(filter) {
    await this._exec(() => this.coll.deleteMany(filter));
  }

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
      console.error("Cannot connect to mongo. Check https://cloud.mongodb.com/v2/648433fc6d28c3603ac3dd22#/clusters if database is running.", e);
      throw e;
    }

    return await callback();
  }
}

module.exports = Dao;
