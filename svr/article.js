/*!@preserve
* OurJS     : Free Blog Engine, Forum System, Website Template and CMS Platform based on Node.JS
* Copyright : Kris Zhang <kris.newghost@gmail.com>
* Homepage  : http://code.ourjs.com
* Project   : https://github.com/newghost/ourjs
* License   : BSD
*/

var fs              = require('fs')
  , path            = require('path')
  , redblade        = require('redblade')
  , Root            = require('./root')
  , config          = global.CONFIG

/*
分页
*/
var getPagination = function(config, pagerFormat) {
  var interval = 5
    , curPager = config.pager || 0
    , maxPager = config.count / config.pageSize | 0
    , startPos = curPager - (interval / 2 | 0)


  maxPager - startPos < interval && (startPos = maxPager - interval)
  startPos < 1 && (startPos = 1)

  var pagination  = ''
    , paginations = []


  var addPage = function(pager) {
    paginations.push(
      pagerFormat.format(pager, curPager == pager ? 'class="active"' : '', (pager + 1))
    )
  }

  addPage(0)
  startPos > 1 && paginations.push('<li><a>…</a></li>')
  for (var i = 0; startPos < maxPager && i < 5; i++, startPos++) {
    addPage(startPos)
  }
  startPos < maxPager && paginations.push('<li><a>…</a></li>')
  maxPager > 0 && addPage(maxPager)

  pagination = '<ul class="len{0}" style="table-layout:fixed">{1}</ul>'.format(paginations.length, paginations.join(''))

  return pagination
}



//handle: /templatename/category/pagenumber, etc: /home/all/0, /home, /json/all/0
var showListHandler = function(req, res, url) {
  var params      = app.parseUrl('/:tmpl/:keyword/:pagerNumber', url || req.url)
    , tmpl        = params.tmpl || 'home'
    , keyword     = params.keyword  || ''
    , pageNumber  = parseInt(params.pagerNumber) || 0
    , pageSize    = 24
    , user        = req.session.get('user') || {}


  var where = { isPublic: 1 }

  /*
  有keyword的全部放到keyword中，不需要是公开的： isPublic = 1
  */
  if (keyword) {
    delete where.isPublic
    where.keyword = keyword
  } else {
    /*
    当地址是 /new　时，显示最新未审核的文章: isPublic = 0
    根据schema "isPublic" : "index('public', return this.pubTime || +new Date())"
    会自动在redis中添加索引 zadd isPublic:0 [时间权重如：1448377366038] [article ID]
    */
    where.isPublic = tmpl == 'new' ? 0 : 1
  }

  redblade.select('article', where, function(err, articles, count) {
    if (err) {
      res.send(err.toString())
      return
    }

    tmpl.indexOf('rss') > -1 && res.type('xml')

    //new和home使用同一个view
    var tmplate = tmpl == 'new' ? 'home' : tmpl

    res.render(tmplate + ".tmpl", {
        articles    : articles
      , keyword     : keyword
      , nextPage    : '/' + tmpl + '/' + keyword + '/' + (pageNumber + 1)
      , pagination  : getPagination({
            pageSize  : pageSize
          , pager     : pageNumber
          , count     : count
        }, '<li {1}><a href="/' + tmpl + '/' + keyword + '/{0}">{2}</a></li>')
    })

  }, { from: pageNumber * pageSize, to: (pageNumber + 1) * pageSize, desc: true })
}


//handle detail.tmpl: content of article
var showDetailHandler = function(req, res) {
  var tmpl  = req.url.split('/')[1]     //get the template name
    , id    = req.params.id             //get the object id
    , key   = 'article:' + id
    , user  = req.session.get('user') || {}

  if (id) {
    //直接访问原文地址前访问量+1，方便做排行榜，只取跳转url即可
    if (tmpl == 'redirect') {
      redblade.client.hget(key, 'url', function(err, url) {
        if (url) {
          redblade.client.hincrby(key, 'visitNum', 1)
          res.redirect(url)
        } else {
          res.send('不存在的文章')
        }
      })
      return
    }

    //Does it existing in the Articles?
    redblade.client.hgetall(key, function(err, article) {
      if (article) {
        redblade.client.hincrby(key, 'visitNum', 1)
        redblade.client.hgetall('user:' + article.poster, function(err, posterInfo) {
          res.render(tmpl + ".tmpl", {
              article : article
            , poster  : posterInfo || {}
          })
        })
      } else {
        res.send('没有找到文章')
      }
    })
  } else {
    res.send('参数不完整')
  }
}

//127.0.0.1/ or 127.0.0.1/home/category/pagernumber
app.get(['/home', '/rss', '/new'], showListHandler)

//redirect访问量+1，防止直接跳转无法计数
app.get(['/article/:id', '/redirect/:id'], showDetailHandler)



/*
投资日历: 填充模块数据
*/
app.use(function(req, res) {
  var url = req.url

  //默认首页
  if ( url == '/' || url.indexOf('/?') == 0 ) {
    var currDate  = +new Date() - 432000000 
      , nextDate  = currDate    + 3024000000     //未来30天 30 * 24 * 60 * 60 * 1000

    redblade.client.zrangebyscore('hold_time', currDate, nextDate, function(err, ids) {
      if (err || ids.length < 1) {
        res.model.eventArticles = []
        req.filter.next()
        return
      }

      redblade.select('article', ids, function(err, articles) {
        for (var i = 0; i < articles.length; i++) {
          Root.setDateField(articles[i], 'holdTime')
        }

        res.model.eventArticles = articles
        req.filter.next()
      })
    })
  } else {
    req.filter.next()
  }
})


/*
门户头条数据填充
*/
app.use(function(req, res) {
  var url   = req.url

  //默认首页
  if ( url == '/' || url.indexOf('/?') == 0 ) {
    var pageSize = 23

    redblade.select('article', { poster: 'sina' }, function(err, articlesSina) {
      redblade.select('article', { poster: 'sohu' }, function(err, articlesSohu) {
        redblade.select('article', { poster: '163' }, function(err, articles163) {
          res.model.articlesSina  = articlesSina  || []
          res.model.articles163   = articles163   || []
          res.model.articlesSohu  = articlesSohu  || []
          req.filter.next()
        }, { from: 0, to: pageSize, desc: true })
      }, { from: 0, to: pageSize, desc: true })
    }, { from: 0, to: pageSize, desc: true })
  } else {
    req.filter.next()
  }
})


/*
新闻联播数据填充
*/
app.use(function(req, res) {
  var url   = req.url

  if ( url == '/' || url.indexOf('/?') == 0 ) {
    res.model.articleCCTV = {}

    //提取单个文章使用原生方法
    redblade.client.zrevrange('user_article:cctv', 0, 0, function(err, ids) {
      var id = ids[0]

      if (err || !id) {
        console.error(err)
        req.filter.next()
        return
      }

      redblade.client.hgetall('article:' + id, function(err, article) {
        if (err) {
          console.error(err)
          req.filter.next()
          return
        }

        res.model.articleCCTV = article || {}
        req.filter.next()
      })
    })
  } else {
    req.filter.next()
  }
})






module.exports = {
    showListHandler : showListHandler
  , getPagination   : getPagination
}