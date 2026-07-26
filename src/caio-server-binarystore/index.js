import routes from "./api/routes.js";
import Config from "./config/config.js";
import { Binary } from "./abl/index.js";

const BinaryStore = {
  init(app, { googleDiskAuthPath, prefixPath = "/binary" } = {}) {
    Config.googleDiskAuthPath = googleDiskAuthPath;
  },
  Binary,
};

export default BinaryStore;
