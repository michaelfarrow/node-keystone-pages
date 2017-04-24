var NodeCache = require('node-cache')

module.exports = {
  paths: new NodeCache(),
  pages: new NodeCache({
    useClones: false
  })
}
