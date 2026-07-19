function run() {
  // Set NODE_ENV to development before spawning the processes
  process.env.NODE_ENV = "development";

  const CaioServer = require("../src/index");
  CaioServer.App.init();
}

run();
