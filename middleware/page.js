
var _ = require('lodash');
var async = require('async');
var keystone = require('keystone');
var importer = keystone.importer(process.cwd() + '/routes');
var Page = keystone.list('Page');

var getPageId = function(path){
  return function(callback){
    var pageId = Page.paths.byPath[path];
    callback(pageId ? null : 'Could not find page id', pageId);
  };
};

var getPage = function(id, callback){
  Page.model.findById(id, function(err, page){
    callback(page ? null : 'Could not find page', page);
  });
};

var getView = function(page, callback){
  var views = importer('./views');
  var viewSlug = keystone.utils.slug(page.template);
  var view = views[viewSlug];
  callback(view ? null : 'Could not find view', {
    page: page,
    view: view,
  });
};

exports = module.exports = function(req, res, next){
  var parts = _.without(req.path.split('/'), '');
  var path = '/' + parts.join('/') + '/';

  async.waterfall([
    getPageId(path),
    getPage,
    getView,
  ], function(err, data){
    if(err){
      next();
    }else{
      res.locals.page = data.page;
      data.view(req, res, next);
    }
  });

};
