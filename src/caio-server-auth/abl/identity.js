const bcrypt = require('bcryptjs');
const jwt = require("jsonwebtoken");
const Config = require("../config/config");
const { Error } = require("../../caio-server-core");
const defaultIdentityDao = require("../dao/identity-dao");

const CODE_PREFIX = "caio-server-auth/identity";

function generateNumId(text) {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    n += text.codePointAt(i);
  }
  let numText = n + "";
  let i = 0;
  while (numText.length > 3 && i < 100) {
    const halfI = Math.round(numText.length / 2);
    const num1 = +numText.substring(0, halfI);
    const num2 = +numText.substring(halfI, numText.length);
    numText = (num1 + num2) + "";
    i++;
  }
  return numText;
}

const generateId = (email, time) => [generateNumId(email), generateNumId(time), "1"].join("-");

function createIdentity(identityDao, collectionName = "sys_identity") {
  const Identity = {
    async create(identity) {
      if (identity.password) {
        const salt = await bcrypt.genSalt(10);
        identity.password = await bcrypt.hash(identity.password, salt);
      }

      const cts = new Date().toISOString();
      const newUser = { identity: generateId(identity.email, cts), ...identity };
      return await identityDao.create(newUser);
    },

    async get({id, identity}, sessionIdentity) {
      const data = id ? await identityDao.getById(id) : await identityDao.getByIdentity(identity);
      if (!data) {
        throw new Error.DoesNotExists("Identity not found", { codePrefix: CODE_PREFIX });
      }
      return sessionIdentity?.identity === data.identity ? data : Identity._getPublicData(data);
    },

    async search(query) {
      const itemList = await identityDao.search(query);
      return itemList.map(Identity._getPublicData);
    },

    async list(dtoIn = {}) {
      let itemList;
      if (dtoIn.identityList) {
        itemList = await identityDao.listbyIdentityList(dtoIn.identityList);
      } else if (dtoIn.idList) {
        itemList = await identityDao.listByIdList(dtoIn.idList);
      } else {
        itemList = await identityDao.list(dtoIn.pageInfo);
      }
      return itemList.map(Identity._getPublicData);
    },

    findByEmail(email) {
      return identityDao.findOne({ email });
    },

    findByGoogleId(googleId) {
      return identityDao.findOne({ googleId });
    },

    matchPassword(inputPassword, storedPassword) {
      return bcrypt.compare(inputPassword, storedPassword);
    },

    createToken(identity) {
      return jwt.sign({ ...Identity.getBasicData(identity), authSchema: collectionName }, Config.token.jwtSecret, { expiresIn: Config.token.jwtLifetime })
    },

    getBasicData({ identity, firstName, surname, name, email, photo, profileList }) {
      return { identity, firstName, surname, name, email, photo, profileList };
    },

    _getPublicData(data) {
      const { identity, firstName, surname, name, photo } = Identity.getBasicData(data);
      return { identity, firstName, surname, name, photo };
    }
  };

  return Identity;
}

module.exports = createIdentity(defaultIdentityDao, "sys_identity");
module.exports.createIdentity = createIdentity;
