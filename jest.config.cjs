module.exports = {
  testMatch: ["<rootDir>/test/**/*.test.js"],
  collectCoverageFrom: ["src/**/*.js", "!src/index.js"],
  transform: {
    "\\.[jt]sx?$": "babel-jest",
  },
  transformIgnorePatterns: ["/node_modules/(?!caio-)"],
};
