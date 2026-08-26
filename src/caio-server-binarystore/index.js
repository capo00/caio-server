import createApi from "./api/binary-api.js";
import { isConfigured } from "./helpers/config.js";
import { Binary } from "./abl/index.js";

const BinaryStore = {
  isConfigured,
  createApi,
  Binary,
};

export default BinaryStore;
