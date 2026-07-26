import Error from "./error.js";

const ERROR_CODE_PREFIX = "caio-server";
const CrudError = {
  DoesNotExists: class extends Error.DoesNotExists {
    constructor(name, e, opts) {
      const codePrefix = [ERROR_CODE_PREFIX, name].join("/");
      super(`Object ${name} does not exist`, { cause: e, codePrefix, ...opts });
    }
  },

  CreateFailed: class extends Error.Failed {
    constructor(name, e, opts) {
      const code = [ERROR_CODE_PREFIX, name, "createFailed"].join("/");
      super(`Creating of ${name} was failed`, { cause: e, code, ...opts });
    }
  },

  CreateManyFailed: class extends Error.Failed {
    constructor(name, e, opts) {
      const code = [ERROR_CODE_PREFIX, name, "createManyFailed"].join("/");
      super(`Creating many of ${name} was failed`, { cause: e, code, ...opts });
    }
  },

  UpdateFailed: class extends Error.Failed {
    constructor(name, e, opts) {
      const code = [ERROR_CODE_PREFIX, name, "updateFailed"].join("/");
      super(`Updating of ${name} was failed`, { cause: e, code, ...opts });
    }
  },

  DeleteFailed: class extends Error.Failed {
    constructor(name, e, opts) {
      const code = [ERROR_CODE_PREFIX, name, "deleteFailed"].join("/");
      super(`Deleting of ${name} was failed`, { cause: e, code, ...opts });
    }
  },

  DeleteManyFailed: class extends Error.Failed {
    constructor(name, e, opts) {
      const code = [ERROR_CODE_PREFIX, name, "deleteManyFailed"].join("/");
      super(`Deleting many of ${name} was failed`, { cause: e, code, ...opts });
    }
  },
}

class Crud {

  constructor(name, dao) {
    this.name = name;
    this.dao = dao;
  }

  async list({ pageInfo, idList }) {
    let dtoOut;
    if (idList) {
      dtoOut = (await this.dao.listByIdList(idList)).map(this._getData);
    } else {
      dtoOut = (await this.dao.list(pageInfo)).map(this._getData);
    }
    return dtoOut;
  }

  async get(id) {
    return this._getData(await this._get(id));
  }

  async create(data) {
    try {
      return this._getData(await this.dao.create(data));
    } catch (e) {
      throw new CrudError.CreateFailed(this.name, e);
    }
  }

  async createMany(data) {
    try {
      const daoDtoOut = await this.dao.createMany(data);
      return daoDtoOut.map((item) => this._getData(item));
    } catch (e) {
      throw new CrudError.CreateManyFailed(this.name, e);
    }
  }

  async update(data, { merge = true } = {}) {
    try {
      let newData = data;
      if (merge) {
        const item = await this._get(data.id);
        newData = { ...item, ...data };
      }

      return this._getData(await this.dao.update(newData));
    } catch (e) {
      throw new CrudError.UpdateFailed(this.name, e);
    }
  }

  async delete(id) {
    try {
      return await this.dao.delete(id);
    } catch (e) {
      throw new CrudError.DeleteFailed(this.name, e);
    }
  }

  async deleteMany(idList) {
    try {
      return await this.dao.deleteMany(idList);
    } catch (e) {
      throw new CrudError.DeleteManyFailed(this.name, e);
    }
  }

  async _get(id) {
    try {
      return await this.dao.get(id);
    } catch (e) {
      throw new CrudError.DoesNotExists(this.name, e);
    }
  }

  _getData({ _id, ...object }) {
    return object;
  }
}

Crud.Error = CrudError;

export default Crud;
