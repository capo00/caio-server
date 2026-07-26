import "../config/env.js";
import path from "path";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { fileURLToPath } from "url";
import Auth from "../../caio-server-auth/index.js";
import Config from "../config/config.js";
import Command from "./command.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const App = {
  init({ api = {}, publicPath = path.resolve(__dirname, "../../../../public"), authList } = {}) {
    const app = express();

    app.use(cors());
    app.use(cookieParser());
    app.use(express.static(publicPath));

    Auth.init(app);
    if (authList) authList.forEach(cfg => Auth.init(app, cfg));

    Command.createCommands(app, api, { publicPath });

    app.get("/*splat", (req, res) => {
      res.sendFile(path.resolve(publicPath, "index.html"));
    });

    app.listen(Config.port, () => {
      console.log(`Server is running on port ${Config.port}`);
    });

    return app;
  }
};

export default App;
