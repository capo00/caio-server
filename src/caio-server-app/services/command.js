import express from "express";
import CaioServerAuth from "../../caio-server-auth/index.js";
import CaioServerBinaryStore from "../../caio-server-binarystore/index.js";
import { Error as CoreError } from "../../caio-server-core/index.js";

function authorization(profiles) {
  return (req, res, next) => {
    const identity = req.identity;

    if (identity?.profileList && profiles.some((profile) => identity.profileList.includes(profile))) {
      next();
    } else {
      return res.status(401).json({
        error: {
          code: "unauthorized",
          message: "Logged in user is not authorized.",
          data: { identity: identity?.identity ?? "0-0", profileList: identity?.profileList ?? [] },
        }
      });
    }
  };
}

async function getDtoIn(req, validator, res, method, uc) {
  let dtoIn;

  if (req.headers["content-type"]?.includes("multipart/form-data")) {
    await CaioServerBinaryStore.Binary.parseFormDataRequest(req);
    dtoIn = {};
    req.files.forEach(file => dtoIn[file.fieldname] = file);
    dtoIn = { ...dtoIn, ...req.body };
  } else {
    dtoIn = req.query; // for GET
    if (req.body && req.is("application/json")) dtoIn = { ...dtoIn, ...req.body };
  }

  for (let k in dtoIn) {
    if (dtoIn[k] && typeof dtoIn[k] === "string" && /^[{\[]/.test(dtoIn[k])) {
      try {
        dtoIn[k] = JSON.parse(dtoIn[k]);
      } catch (e) {
        // nothing
      }
    }
  }

  if (validator) {
    try {
      dtoIn = validator({ dtoIn }, "dtoIn");
    } catch (e) {
      console.error(`[${new Date().toISOString()}](${method}) /${uc} Validator exception. dtoIn = `, dtoIn, e);
      res.status(400).send({ message: "Validator exception", error: e });
    }
  }

  return dtoIn;
}

const Command = {
  createCommands(app, api, { publicPath }) {
    const apis = {
      "sys/health": {
        method: "get",
        fn: async () => {
          return {
            version: process.env.npm_package_version,
          };
        }
      },
      ...api,
    }

    app.use(express.json());

    for (let uc in apis) {
      const { method, fn, auth, validator } = apis[uc];

      const call = async (req, res, next) => {
        const dtoIn = await getDtoIn(req, validator, res, method, uc);
        const identity = req.identity;

        try {
          const dtoOut = await fn({ dtoIn, identity, req, res, method, useCase: uc, next, publicPath });

          if (dtoOut !== false) res.json(dtoOut == null ? {} : dtoOut);
        } catch (e) {
          if (e instanceof CoreError) {
            console.error(`[${new Date().toISOString()}](${method}) /${uc} Expected exception. dtoIn = `, dtoIn, e);
            res.status(e.status || 500).send(e.toObject());
          } else {
            console.error(`[${new Date().toISOString()}](${method}) /${uc} Unexpected exception. dtoIn = `, dtoIn, e);
            res.status(500).send({ message: "Unexpected exception", error: e });
          }
        }
      };

      const calls = [call];
      if (auth) {
        if (Array.isArray(auth)) calls.unshift(authorization(auth));
        calls.unshift(CaioServerAuth.authentication);
      }

      app[method]("/" + uc, ...calls);
    }
  }
}

export default Command;
