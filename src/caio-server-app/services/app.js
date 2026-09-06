import "../config/env.js";
import path from "path";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import Auth from "../../caio-server-auth/index.js";
import Config from "../config/config.js";
import Command from "./command.js";

const App = {
  init({ api = {}, publicPath = path.resolve(process.cwd(), "public"), authList, middlewareList = [] } = {}) {
    const app = express();

    app.use(cors());
    app.use(cookieParser());
    app.use(express.static(publicPath));

    Auth.init(app);
    if (authList) authList.forEach(cfg => Auth.init(app, cfg));

    // App middleware runs after the framework's own and before the use-cases and the SPA
    // fallback. That position is the point: legacy URL redirects have to answer paths
    // that would otherwise be swallowed by the fallback, and an app cannot register
    // anything there itself -- init() owns the order.
    middlewareList.forEach((middleware) => app.use(middleware));

    Command.createCommands(app, api, { publicPath });

    // SPA fallback. Only for paths that can be a client route -- anything with a
    // file extension that express.static did not answer is a missing file, and
    // returning index.html for it would report status 200 with HTML in place of
    // the asset, which hides the problem (a missing library file then "loads"
    // fine while the page silently misbehaves). Falling through to express'
    // default handler gives a real 404 instead.
    app.get("/*splat", (req, res, next) => {
      if (path.extname(req.path)) return next();
      res.sendFile(path.resolve(publicPath, "index.html"));
    });

    app.listen(Config.port, () => {
      console.log(`Server is running on port ${Config.port}`);
    });

    return app;
  }
};

export default App;
