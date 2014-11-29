var _           = require('lodash');
var fs          = require('fs');
var path        = require('path');
var glob        = require('glob');
var async       = require('async');
var pad         = require('pad');
var ProgressBar = require('progress');
var exif        = require('./exif');

exports.update = function(opts, callback) {

  var metadataPath = path.join(opts.output, 'metadata.json');
  var existing = null;
  var existingDate = null;

  try {
    existing = require(metadataPath);
    existingDate = fs.statSync(metadataPath).mtime;
  } catch (ex) {
    existing = {};
    existingDate = 0;
  }

  function findFiles(callback) {
    var globOptions = {
      cwd: opts.input,
      nonull: false,
      nocase: true
    };
    glob('**/*.{jpg,jpeg,png,mp4,mov,mts}', globOptions, callback);
  }

  function pathAndDate(filePath, next) {
    var absolute = path.join(opts.input, filePath);
    fs.stat(absolute, function(err, stats) {
      next(null, {
        absolute: absolute,
        relative: filePath,
        fileDate: Math.max(stats.ctime.getTime(), stats.mtime.getTime())
      });
    });
  }

  function newer(fileInfo) {
    var found = existing[fileInfo.relative];
    if (!found) return true;
    return fileInfo.fileDate > existingDate;
  }

  function removeDeletedFiles(allFiles) {
    var existingPaths = _.keys(existing);
    var actualPaths   = _.pluck(allFiles, 'relative');
    var deleted = _.difference(existingPaths, actualPaths);
    deleted.forEach(function(key) {
      delete existing[key];
    });
    return deleted.length > 0;
  }

  function metadata(fileInfo, callback) {
    exif.read(fileInfo.absolute, function(err, exifData) {
      callback(null, {
        path: fileInfo.relative,
        fileDate: fileInfo.fileDate,
        mediaType: mediaType(fileInfo),
        exif: {
          date: exifData ? exifData.date : null,
          orientation: exifData ? exifData.orientation : null
        }
      });
    });
  }

  function mediaType(fileInfo) {
    return fileInfo.relative.match(/\.(mp4|mov|mts)$/i) ? 'video' : 'photo';
  }

  function writeToDisk() {
    fs.writeFileSync(metadataPath, JSON.stringify(existing, null, '  '));
  }

  findFiles(function(err, files) {
    var format = pad('List all files', 20) + '[:bar] :current/:total files';
    var bar = new ProgressBar(format, { total: files.length, width: 20 });
    bar.tick(files.length);
    async.map(files, pathAndDate, function (err, allFiles) {
      var deleted = removeDeletedFiles(allFiles);
      var toProcess = allFiles.filter(newer);
      var count = toProcess.length;
      if (count > 0) {
        var format = pad('Update metadata', 20) + '[:bar] :current/:total files';
        var bar = new ProgressBar(format, { total: count, width: 20 });
        async.map(toProcess, function(fileInfo, next) {
          bar.tick();
          metadata(fileInfo, next);
        }, function(err, update) {
          update.forEach(function(fileInfo) {
            existing[fileInfo.path] = _.omit(fileInfo, 'path');
          });
          writeToDisk();
          callback(null, existing);
        });
      } else {
        if (deleted) writeToDisk();
        callback(null, existing);
      }
    });
  });

};
