
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

var Page = new keystone.List('Page', {
  track: true,
  map: { name: 'title' },
  autokey: { from: 'title', path: 'slug', unique: false, fixed: true },
  sortable: true,
  sortContext: 'Page:children',
  drilldown: 'parent',
  defaultColumns: 'title, template, parent',
});

// Default templates, will be extended on init
Page.templateFields = _.defaults(
  keystone.get('templates') || {},
  { 'Default': [] }
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
    functions[this.template](function(err){
      next(err ? Error(err) : null);
    });
  }else{
    next();
  }
});

/**
VIRTUAL ACCESSORS
*/

// Allows easy lookup of wrapped fields.
// Instead of accessing page.Home.headerImage, access page.fields.headerImage
// Instead of accessing page._.Contact.shopAddress.format(), access page.fields._.shopAddress.format()
Page.schema.virtual('fields').get(function(){
  var fields = this[this.template];
  fields._ = this._[this.template];
  return fields;
});

// Uses the path cache to return the full page of the page, parents included.
Page.schema.virtual('path').get(function(){
  var paths = Page.paths;
  return paths.byPage[this._id] ? paths.byPage[this._id] : '/';
});

/**
MODEL FUNCTIONS
*/

// Fetch children of model
Page.schema.methods.getChildren = function(callback){
  Page.loadChildren(this, callback);
};

/**
LIST FUNCTIONS
*/

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

/**
COMMON FIELDS
*/

Page.add({
  title: { type: Types.Text, required: true, initial: true },
  slug: { type: Types.Text, watch: true, value: Page.watch.updateSlug },
  parent: { type: Types.Relationship, ref: 'Page', initial: true },
  template: { type: Types.Select, initial: true, options: _.keys(Page.templateFields), default: 'Default' },
});

/**
CUSTOM FIELDS
*/

// Loop through configured fields and add them to the model schema.
// Fields are wrapped in an object with the template name as a key,
// eliminating the need for unique field names.
_.each(Page.templateFields, function(fields, template){
  if(!_.isArray(fields))
    fields = [fields];

  if(fields.length > 0)
    Page.add(Page.processField(template, template));

  _.each(fields, function(fieldGroup){
    fieldGroup = Page.processField(fieldGroup, template);

    var wrap = {};

    if(!fieldGroup.heading)
      wrap[template] = fieldGroup;
    else
      wrap = fieldGroup;

    Page.add(wrap);
  });
});

/**
RELATIONSHIP DEFINITIONS
*/

Page.relationship({ label: 'Children', path: 'children', ref: 'Page', refPath: 'parent' });

/**
REGISTER MODEL & EXPORT
We export the model because we may need to extend it later
*/
Page.register();
exports = module.exports = Page;
