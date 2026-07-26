const Config = {
  mongodbUri: process.env.MONGODB_URI,
  publicFolderId: process.env.GOOGLE_DISK_PUBLIC_FOLDER_ID,
  ERROR_PREFIX: "caio-server-binarystore/",
};

export default Config;
