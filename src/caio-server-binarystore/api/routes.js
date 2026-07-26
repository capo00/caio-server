import express from "express";
import BinaryAbl from "../abl/binary-abl.js";

const router = express.Router();
router.post("/create", BinaryAbl.create);

export default router;
