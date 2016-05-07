
var _ = require('lodash');
var async = require('async');
var keystone = require('keystone');
var importer = keystone.importer(process.cwd() + '/routes');
var Page = keystone.list('Page');

var getPageId = function(path){
  return function(callback){
    var parts = _.without(path.split('/'), '');
    var pageId = Page.paths.byPath[path];
    var full = true;

    if(!pageId){
      while(parts.length > 0 && !pageId){
        parts.pop();
        pageId = Page.paths.byPath['/' + parts.join('/') + '/'];
        if(pageId) full = false;
      }
    }

    callback(pageId ? null : 'Could not find page id', {
      full: full,
      id: pageId,
    });
  };
};

var getPage = function(info, callback){
  Page.model.findById(info.id, function(err, page){
    info.page = page;
    callback(page ? null : 'Could not find page', info);
  });
};

var getView = function(info, callback){
  var views = importer('./views');
  var viewSlug = keystone.utils.slug(info.page.template);
  var view = views[viewSlug];
  info.view = view;
  callback(view ? null : 'Could not find view', info);
};

exports = module.exports = function(req, res, next){
  var parts = _.without(req.path.split('/'), '');
  var path = '/' + parts.join('/') + '/';

  async.waterfall([
    getPageId(path),
    getPage,
    getView,
  ], function(err, info){
    if(err){
      next();
    }else{
      res.locals.path = {
        full: path,
        parts: parts,
      };
      res.locals.page = info.page;
      res.locals.pageFullMatch = info.full;
      info.view(req, res, next);
    }
  });

};
