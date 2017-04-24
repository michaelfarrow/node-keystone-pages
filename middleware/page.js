var _ = require('lodash')
var async = require('async')
var keystone = require('keystone')
var importer = keystone.importer(process.cwd() + '/routes')
var Page = keystone.list('Page')
var fs = require('fs')
var cache = require('../cache').pages

var defaultView = function (slug) {
  return function (req, res) {
    var path = keystone.get('views')
    var ext = keystone.get('view engine')

    var templatePath = __dirname + '/../../../' + path + '/' + slug + '.' + ext

    fs.stat(templatePath, function (err, stat) {
      if (err == null) {
        var view = new keystone.View(req, res)
        var locals = res.locals
        view.render(slug)
      } else if (err.code == 'ENOENT') {
        res.status(500).send('Could not find view')
      } else {
        res.status(500).send('Error: ' + err.code)
      }
    })
  }
}

var getPageId = function (path) {
  return function (callback) {
    var parts = _.without(path.split('/'), '')
    var pageId = Page.paths.byPath[path]
    var full = true

    if (!pageId) {
      while(parts.length > 0 && !pageId){
        parts.pop()
        pageId = Page.paths.byPath['/' + parts.join('/') + '/']
        if (pageId) full = false
      }
    }

    callback(pageId ? null : 'Could not find page id', {
      full: full,
      id: pageId
    })
  }
}

var getPage = function (info, callback) {
  var cacheId = info.id.toString()
  cache.get(cacheId, function (err, page) {
    if (err) return callback(err)
    if (!page) {
      Page.model.findById(info.id, function (err, page) {
        info.page = page
        cache.set(cacheId, page, function (err) {
          if (err) return callback(err)
          callback(page ? null : 'Could not find page', info)
        })
      })
    } else {
      info.page = page
      callback(null, info)
    }
  })
}

var getView = function (info, callback) {
  var views = importer('./views')
  var viewSlug = keystone.utils.slug(info.page.template)
  var view = views[viewSlug]
  info.view = view ? view : defaultView(viewSlug)
  callback(null, info)
}

exports = module.exports = function (req, res, next) {
  var parts = _.without(req.path.split('/'), '')
  var path = '/' + parts.join('/') + '/'

  async.waterfall([
    getPageId(path),
    getPage,
    getView
  ], function (err, info) {
    if (err) {
      next()
    }else {
      res.locals.path = {
        full: path,
        parts: parts
      }
      res.locals.page = info.page
      res.locals.pageFullMatch = info.full
      info.view(req, res, next)
    }
  })
}
