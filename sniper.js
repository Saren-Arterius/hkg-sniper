#!/usr/bin/env node

var md5 = require('MD5');
var RateLimiter = require('limiter').RateLimiter;
var cheerio = require('cheerio');
var fs = require('fs');
var request = require('request');
var Promise = require('promise');
var parse = require('url').parse;

var CONFIG_FILENAME = 'snipe-config.json';
var SNIPE_LOG_FILENAME = 'sniped.json';

var config;
var sniped;
var replyLimiter = new RateLimiter(1, 15000);
var scrapLimiter = new RateLimiter(10, 'minutes');
var saveLimiter = new RateLimiter(1, 100);
var targetNames = {};

if (!String.prototype.format) {
  String.prototype.format = function () {
    var args = arguments;
    return this.replace(/{(\d+)}/g, function (match, number) {
      return typeof args[number] !== 'undefined' ? args[number] : match;
    });
  };
}

Date.prototype.yyyymmdd = function () {
  var yyyy = this.getFullYear().toString();
  var mm = (this.getMonth() + 1).toString(); // getMonth() is zero-based
  var dd = this.getDate().toString();
  return yyyy + (mm[1] ? mm : '0' + mm[0]) + (dd[1] ? dd : '0' + dd[0]); // padding
};

var apiKey2 = function (userID) {
  return md5('{0}_HKGOLDEN_{1}_$API#Android_1_2^'.format(new Date().yyyymmdd(), userID));
};

var readJSON = function (filename) {
  return Promise.denodeify(fs.readFile)(filename, 'utf8').then(JSON.parse);
};

var writeJSON = function (filename, json) {
  saveLimiter.removeTokens(1, function (err, remainingRequests) {
    if (err) {
      console.log(err);
    }
    return Promise.denodeify(fs.writeFile)(filename, JSON.stringify(json), 'utf8');
  });
};

var getRepliedTopicIDs = function (targetID) {
  return new Promise(function (fulfill, reject) {
    var options = {
      url: 'http://forum15.hkgolden.com/ProfilePage.aspx?userid={0}&type=history&page=1&yearFilter=1&filterType=all'.format(targetID),
      headers: {
        'User-Agent': 'Mozilla/5.0'
      }
    };
    var messageIDs = [];
    scrapLimiter.removeTokens(1, function (err, remainingRequests) {
      if (err) {
        console.log(err);
      }
      console.log('{0}: Fetching topicIDs'.format(targetID));
      request(options, function (error, response, body) {
        if (error) {
          reject(error);
          return;
        }
        var $ = cheerio.load(body);
        var name = $('#ctl00_ContentPlaceHolder1_lb_nickname').text();
        if (!name) {
          reject(body);
          return;
        }
        targetNames[targetID] = name;
        $('a[href^="view.aspx?type="]').each(function () {
          var messageID = parseInt(parse($(this).attr('href'), true).query.message, 10);
          if (messageIDs.indexOf(messageID) === -1) {
            messageIDs.push(messageID);
          }
        });
        fulfill(messageIDs);
      });
    });
  });
};

var logSniped = function (targetID, topicID) {
  var key = '{0}-{1}'.format(targetID, topicID);
  console.log('Logging: ' + key);
  if (sniped.indexOf(key) === -1) {
    sniped.push(key);
  }
  writeJSON(SNIPE_LOG_FILENAME, sniped);
};

var filterTopicIDs = function (topicIDs, targetID) {
  var filtered = [];
  topicIDs.forEach(function (topicID) {
    if (topicID < config.dontSnipeOlderThan) {
      return;
    }
    var key = '{0}-{1}'.format(targetID, topicID);
    if (sniped.indexOf(key) !== -1) {
      return;
    }
    filtered.push(topicID);
  });
  return filtered;
};

var snipe = function (targetID, topicID) {
  var bullet = config.snipeTargets[targetID].format(targetNames[targetID]);
  var options = {
    url: 'http://android-1-2.hkgolden.com/post.aspx',
    headers: {
      'User-Agent': 'Mozilla/5.0'
    },
    form: {
      s: apiKey2(config.sniper.id),
      user_id: config.sniper.id,
      pass: md5(config.sniper.password),
      id: topicID,
      body: bullet,
      mt: 'Y',
      returntype: 'json'
    }
  };
  replyLimiter.removeTokens(1, function (err, remainingRequests) {
    if (err) {
      console.log(err);
    }
    console.log('{0}: Sniping at topic {1}'.format(targetID, topicID));
    request(options, function (error, response, body) {
      if (error) {
        console.log(error);
        return;
      }
      var success = JSON.parse(body).success;
      if (success) {
        logSniped(targetID, topicID);
      } else {
        console.log(body);
      }
    });
  });
};

var runSniper = function () {
  for (var target in config.snipeTargets) {
    getRepliedTopicIDs(target).then(function (topicIDs) {
      filterTopicIDs(topicIDs, target).forEach(function (topicID) {
        snipe(target, topicID);
      });
    }).catch(function (err) {
      console.log(err);
    });
  }
};

readJSON(CONFIG_FILENAME).then(function (json) {
  config = json;
  return readJSON(SNIPE_LOG_FILENAME);
}).catch(function (err) {
  console.log(err);
  if (err.code === 'ENOENT') {
    sniped = [];
    writeJSON(SNIPE_LOG_FILENAME, sniped);
  }
}).then(function (json) {
  if (json) {
    sniped = json;
  }
  main();
});

var main = function () {
  runSniper();
};
