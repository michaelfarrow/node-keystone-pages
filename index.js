
var _ = require('lodash');

var pages = {};

pages.init = function(keystone, options){

  options = _.defaults(options, {}); // for later... maybe...

  require('./models/Page');
  keystone.pre('routes', require('./middleware/loadPaths'));
  keystone.pre('routes', require('./middleware/page'));
}

module.exports = pages;
