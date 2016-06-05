
var keystone = require('keystone');
var Types = keystone.Field.Types;
var _ = require('lodash');
var async = require('async');

/**
LIST OPTIONS
- maps title to name.
- autokey setup for slug from title, unique false as there may be multiple slugs
  but with different parents, so this validation is done manually. Also not fixed
  as we only need to set the slug automatically on creation, we need to allow a
  user to change it manually later.
- sortable within the context of another page, when the page has child pages.
- drilldown as parent so you can see the parent page in the header
*/

var Page = new keystone.List('Page', _.defaults(
  keystone.get('template options') || {},
  {
    track: true,
    map: { name: 'title' },
    autokey: { from: 'title', path: 'slug', unique: false, fixed: true },
    sortable: true,
    sortContext: 'Page:children',
    drilldown: 'parent',
    defaultColumns: 'title, template, parent',
  }
));

// Default templates, will be extended on init
Page.templateFields = _.defaults(
  keystone.get('templates') || {},
  { 'default': [] }
);

// Global path cache
Page.paths = {};

/**
WATCH FUNCTIONS
Update certain values in response to others updating.
*/

Page.watch = {
  // Enforce slug formatting
  updateSlug: function(){
    return keystone.utils.slug(this.slug);
  },
};

/**
VALIDATION FUNCTIONS
*/

// Only allow one slug per set of child pages
Page.schema.pre('save', function(next) {
  Page.model.findOne()
    .where('_id').ne(this._id)
    .where('slug', this.slug)
    .where('parent', this.parent || null)
    .exec(function(err, page){
      next(page ? Error('Slug must be unique') : null);
    });
});

// Check for circular dependencies
Page.schema.pre('save', function(next) {
  var page = this;

  if(this._id.equals(this.parent)){
    next(Error('Page cannot be a child of itself'));
  }else if(this.parent){
    Page.model.findById(this.parent, function(err, parent){
      Page.hasParent(parent, page._id, function(has){
        if(has){
          next(Error('Circular parent path detected'));
        }else{
          next();
        }
      });
    });
  }else{
    next();
  }
});

// Custom validation
Page.schema.pre('save', function(next) {
  var functions = keystone.get('templates validation');

  if(functions && functions[this.template]){
    functions[this.template].bind(this)(function(err){
      next(err ? Error(err) : null);
    });
  }else{
    next();
  }
});

/**
LIST FUNCTIONS
*/

Page.processFieldGroup = function(fields, template){
  template = template.toLowerCase();

  if(_.isNull(fields) || _.keys(fields).length == 0){
    fields = [];
  }else if(!_.isArray(fields)){
    fields = [fields];
  }

  if(fields.length > 0)
    Page.add(Page.processField(keystone.utils.titlecase(template), template));

  _.each(fields, function(fieldGroup){
    fieldGroup = Page.processField(fieldGroup, template);

    var wrap = {};

    if(!fieldGroup.heading)
      wrap[template] = fieldGroup;
    else
      wrap = fieldGroup;

    Page.add(wrap);
  });
};

// Processes a single field object, adds dependsOn and label.
// Will accept object of key, field pairs, heading as a string or heading as an object
Page.processField = function(fieldGroup, template, parent){
  if(!fieldGroup.heading && !_.isString(fieldGroup)){
    _.each(fieldGroup, function(field, key){
      var path = parent ? parent + '.' + key : key;

      if(!field.type){
        field = Page.processField(field, template, path);
      }else{
        field.dependsOn = { template: template };
        if(!field.label)
          field.label = keystone.utils.keyToLabel(path);
      }
    });
  }else{
    // Heading
    if(_.isString(fieldGroup))
      fieldGroup = { heading: fieldGroup };
    fieldGroup.dependsOn = { template: template };
  }
  return fieldGroup;
};

// Resursively parse and return page paths for specified page
Page.getPathParts = function(pages, page){
  var parts = [ page.slug ];
  if(page.parent){
    var parent = _.find(pages, { _id: page.parent });
    if(parent)
      parts = _.concat(Page.getPathParts(pages, parent), parts);
  }
  return parts;
};

// Store paths in cache, for later reference
Page.cachePaths = function(callback){
  Page.model.find()
    .select('slug title parent')
    .exec(function(err, pages){
      var paths = {
        byPage: {},
        byPath: {},
      };
      _.each(pages, function(page){
        var parts = Page.getPathParts(pages, page);
        var fullPath = '/' + parts.join('/') + '/';
        paths.byPage[page._id] = {
          parts: parts,
          full: fullPath,
        };
        paths.byPath[fullPath] = page._id;
      });
      Page.paths = paths;
      callback();
    });
};

// Crawls up the page hierarchy looking for a particular page.
// Used to avoid circular parent dependencies.
Page.hasParent = function(page, search, callback){
  if(page.parent){
    Page.model.findById(page.parent, function(err, parent){
      if(parent){
        if(parent._id.equals(search)){
          callback(true);
        }else{
          Page.hasParent(parent, search, callback);
        }
      }else{
        callback(false);
      }
    });
  }else{
    callback(false);
  }
};

// Loads page children recursively.
// Assigns them to the model.children and passes them to the callback.
Page.loadChildren = function(page, callback){
  Page.model.find()
    .where('parent', page._id)
    .sort('sortOrder')
    .exec(function(err, pages){
      page.children = pages;
      async.each(page.children, Page.loadChildren, function(){
        callback(page.children || []);
      });
    });
};

// Check fields object to make sure paths/relationships don't exist, throw error if any do exist
// Accepts an array of paths, which can be obtained using the Page.dotNotation function
Page.checkPaths = function(paths, objName){
  objName = objName ? objName : 'Path';
  _.each(paths, function(path){
    if(Page.schema.path(path) || Page.relationships[path] || _.has(Page.schema.tree, path))
      throw Error(objName + ' "' + path + '" cannot be set, path already exists');
  });
};

// Converts and object to dot notation, disired conditions provided by comparator function
Page.dotNotation = function(obj, comparator){
  comparator = comparator ? comparator : function(v){
    return !_.isPlainObject(v);
  };
  if(_.isArray(obj)){
    var newObj = {};
    _.each(obj, function(group){
      _.each(group, function(field, path){
        newObj[path] = field;
      });
    });
    obj = newObj;
  }
  var processObj = function(res, v, k){
    if(comparator(v)){
      res[k] = v;
    }else if(_.isPlainObject(v)){
      var newObj = _.transform(v, function(res, v, k2){
        res[k + '.' + k2] = v;
      });
      _.assign(res, _.transform(newObj, processObj));
    }
  };

  return _.transform(obj, processObj);
};

/**
RELATIONSHIP DEFINITIONS
*/

Page.relationship({ label: 'Children', path: 'children', ref: 'Page', refPath: 'parent' });

/**
COMMON FIELDS - HEADER
*/

Page.templateOptions = _.map(
  _.keys(Page.templateFields).sort(),
  function(option){
    return {
      label: keystone.utils.titlecase(option),
      value: option,
    };
  }
);

Page.headerFields = keystone.get('templates global') || {};
Page.add(_.merge(
  {
    title: { type: Types.Text, required: true, initial: true },
    slug: { type: Types.Text, watch: true, value: Page.watch.updateSlug },
    parent: { type: Types.Relationship, ref: 'Page', initial: true },
    template: { type: Types.Select, initial: true, options: Page.templateOptions, default: 'default' },
  }, Page.headerFields
));

/**
CUSTOM FIELDS
*/

// Loop through configured fields and add them to the model schema.
// Fields are wrapped in an object with the template name as a key,
// eliminating the need for unique field names.
Page.checkPaths(_.keys(Page.templateFields), 'Template');
_.each(Page.templateFields, Page.processFieldGroup);

/**
COMMON FIELDS - FOOTER
*/

Page.footerFields = keystone.get('templates global footer') || {};
Page.footerFields = _.isArray(Page.footerFields) ? Page.footerFields : [Page.footerFields]
var footerFieldsFilered = _.filter(Page.footerFields, function(v){
  return !_.has(v, 'heading') && !_.isString(v);
});
var footerFieldsParsedAll = _.keys(Page.dotNotation(footerFieldsFilered, function(v){
  return _.has(v, 'type');
}));
var footerFieldsParsedOneLevel = _.keys(Page.dotNotation(footerFieldsFilered, function(v){
  return _.isPlainObject(v);
}));
Page.checkPaths(footerFieldsParsedAll, 'Footer path');
Page.checkPaths(footerFieldsParsedOneLevel, 'Footer path');
Page.add.apply(Page, Page.footerFields);

/**
VIRTUAL ACCESSORS
*/

// Allows easy lookup of wrapped fields.
// Instead of accessing page.Home.headerImage, access page.fields.headerImage
// Instead of accessing page._.Contact.shopAddress.format(), access page.fields._.shopAddress.format()
Page.schema.virtual('fields').get(function(){
  var fields = this[this.template] || {};
  fields._ = this._[this.template] || {};
  return fields;
});

// Uses the path cache to return the full page of the page, parents included.
Page.schema.virtual('path').get(function(){
  var paths = Page.paths;
  return paths.byPage[this._id] ? paths.byPage[this._id] : '/';
});

// Add custom virtual accessors
// Accepts dot notation object of function values
Page.virtuals = keystone.get('template virtuals');
if(Page.virtuals){
  Page.checkPaths(_.keys(Page.virtuals));
  _.each(Page.virtuals, function(f, p){
    Page.schema.virtual(p).get(f);
  });
}

/**
MODEL FUNCTIONS
*/

// Fetch children of model
Page.schema.methods.getChildren = function(callback){
  Page.loadChildren(this, callback);
};

// Add custom methods
Page.methods = keystone.get('template methods');
if(Page.methods){
  var methods = Page.schema.methods;
  Page.checkPaths(_.keys(Page.methods), 'Instance method');
  _.each(Page.methods, function(f, p){
    var name = keystone.utils.camelcase(p.replace('.', '_'), true);
    // add method
    methods[name] = f;
    // add virtual so we can access it through fields virtual
    Page.schema.virtual(p).get(function(){
      return this[name].bind(this);
    });
  });
}

/**
EXTRA CONFIGURATION
Any other configuration not covered by the keystone.set options can be handled
by¡ providing a function to keystone.set('templates custom', [function]).
BEWARE! No checks are made so you better know what you're doing!
*/
var customConfigration = keystone.get('templates custom');
if(_.isFunction(customConfigration)){
  customConfigration(Page);
}

/**
REGISTER MODEL & EXPORT
We export the model because we may need to extend it later
*/
Page.register();
exports = module.exports = Page;
