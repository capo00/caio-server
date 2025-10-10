const path = require("path");
const express = require('express');
const cors = require('cors');
const cookieParser = require("cookie-parser");
require('dotenv').config();

const OcAuth = require("oc_app-auth");
const Config = require('../config/config');
const Command = require("./command");

const App = {
  init({ api = {}, publicPath = path.resolve(__dirname, "../../../../public") } = {}) {
    const app = express();

    // Middleware
    app.use(cors());

    // cookies for auth
    app.use(cookieParser());

    // path to static folder, where are also assets
    app.use(express.static(publicPath));

    OcAuth.init(app);

    // Define your api here
    Command.createCommands(app, api);

    // All other GET requests not handled before will return our React app
    app.get("*", (req, res) => {
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