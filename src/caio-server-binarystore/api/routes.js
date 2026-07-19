const express = require("express");
const BinaryAbl = require("../abl/binary-abl");

const router = express.Router();

router.post("/create", BinaryAbl.create);

module.exports = router;
