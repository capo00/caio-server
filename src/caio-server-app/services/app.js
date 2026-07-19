const path = require("path");
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");

const dotenv = require("dotenv");

if (process.env.NODE_ENV === "development") {
  dotenv.config({ path: `.env.${process.env.NODE_ENV}` });
} else {
  dotenv.config();
}

const Auth = require("../../caio-server-auth");
const Config = require("../config/config");
const Command = require("./command");

const App = {
  init({ api = {}, publicPath = path.resolve(__dirname, "../../../../public"), authList } = {}) {
    const app = express();

    // Middleware
    app.use(cors());

    // cookies for auth
    app.use(cookieParser());

    // path to static folder, where are also assets
    app.use(express.static(publicPath));

    Auth.init(app);
    if (authList) authList.forEach(cfg => Auth.init(app, cfg));

    // Define your api here
    Command.createCommands(app, api, { publicPath });

    // All other GET requests not handled before will return our React app
    app.get("/*splat", (req, res) => {
      res.sendFile(path.resolve(publicPath, "index.html"));
    });

    // Start the server
    app.listen(Config.port, () => {
      console.log(`Server is running on port ${Config.port}`);
    });

    return app;
  }
}

module.exports = App;
