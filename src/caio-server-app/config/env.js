import dotenv from "dotenv";

const env = process.env.NODE_ENV || "development";

if (env === "development") {
  dotenv.config({ path: `.env.${env}` });
} else {
  dotenv.config();
}
