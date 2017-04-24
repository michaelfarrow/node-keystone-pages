var keystone = require('keystone')
var Page = keystone.list('Page')

/**
Load all page paths into the global keystone options.
Set sortOrder to title for particular backend routes.
*/
exports = module.exports = function (req, res, next) {
  var path = req._parsedUrl.pathname.replace(/\/$/, '')

  if (path.indexOf('/keystone/api/pages') === 0 || path == '/keystone/pages') {
    Page.defaultSort = 'title'
  }else {
    Page.defaultSort = 'sortOrder'
  }

  Page.cachePaths(next)
}
