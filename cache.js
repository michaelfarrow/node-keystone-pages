var NodeCache = require('node-cache')

module.exports = {
  paths: new NodeCache({
    stdTTL: 30
  }),
  pages: new NodeCache({
    useClones: false,
    stdTTL: 30
  })
}
