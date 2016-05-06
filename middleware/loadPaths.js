
var keystone = require('keystone');
var Page = keystone.list('Page');

/**
Load all page paths into the global keystone options.
*/
exports = module.exports = function(req, res, next) {
  Page.cachePaths(next);
};
