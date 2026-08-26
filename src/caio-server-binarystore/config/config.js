const Config = {
  bucketName: process.env.GCS_BUCKET_NAME,
  maxFileSizeMB: Number(process.env.BINARY_MAX_FILE_SIZE_MB) || 25,
  maxFiles: Number(process.env.BINARY_MAX_FILES) || 20,
  ERROR_PREFIX: "caio-server-binarystore/",
};

export default Config;
