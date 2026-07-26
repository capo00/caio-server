import UuAppDataTypes from "uu_appdatatypesg02";
import Identity from "../abl/identity.js";

const identityApi = {
  "identity/search": {
    method: "get",
    auth: true,
    validator: UuAppDataTypes.exact({
      query: UuAppDataTypes.string,
    }),
    fn: async ({ dtoIn, identity }) => {
      const itemList = await Identity.search(dtoIn.query, identity);
      return { itemList };
    },
  },

  "identity/list": {
    method: "get",
    auth: true,
    validator: UuAppDataTypes.exact({
      idList: UuAppDataTypes.arrayOf(UuAppDataTypes.string),
      identityList: UuAppDataTypes.arrayOf(UuAppDataTypes.string),
    }),
    fn: async ({ dtoIn }) => {
      const itemList = await Identity.list(dtoIn);
      return { itemList };
    },
  },

  "identity/get": {
    method: "get",
    validator: UuAppDataTypes.exact({
      id: UuAppDataTypes.string,
      identity: UuAppDataTypes.string,
    }),
    fn: ({ dtoIn, identity }) => {
      return Identity.get(dtoIn, identity);
    },
  },
};

export default identityApi;
