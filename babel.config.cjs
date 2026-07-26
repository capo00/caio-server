module.exports = {
  presets: [["@babel/preset-env", { targets: { node: "current" } }]],
  plugins: [
    function transformImportMeta() {
      return {
        visitor: {
          MetaProperty(path) {
            if (path.node.meta.name === "import" && path.node.property.name === "meta") {
              path.replaceWithSourceString("({ url: require('url').pathToFileURL(__filename).toString() })");
            }
          },
        },
      };
    },
  ],
};
