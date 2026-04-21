// Mangakakalot Extension Code
// HTML-scraping manga source for the Mangakakalot family.
// Uses mangakakalot.fan because mangakakalot.gg is currently Cloudflare-blocked
// for Otaku's non-browser runtime.

export const MANGAKAKALOT_EXTENSION = String.raw`
const extensionObject = {
  id: "com.mangakakalot.source",
  name: "Mangakakalot",
  version: "1.0.0",
  type: "manga",
  language: "en",
  baseUrl: "https://www.mangakakalot.fan",

  _HEADERS: {
    'Referer': 'https://www.mangakakalot.fan/',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
  },

  _decodeHtml: function(input) {
    if (!input) return '';
    return String(input)
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&#x27;/gi, "'")
      .replace(/&#x2F;/gi, '/')
      .replace(/&#(\d+);/g, function(_, code) {
        var num = parseInt(code, 10);
        return isNaN(num) ? _ : String.fromCharCode(num);
      });
  },

  _stripTags: function(input) {
    if (!input) return '';
    return extensionObject._decodeHtml(
      String(input)
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    );
  },

  _normalizeQuery: function(query) {
    return String(query || '')
      .toLowerCase()
      .replace(/[!@%^*()+\-=<>?\/,.:;'"&#\[\]~$_\s]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '');
  },

  _isChallengePage: function(body) {
    var text = String(body || '');
    return /cf-browser-verification|cf_chl_|cf-mitigated|<title>Just a moment\.\.\.<\/title>|<title>Attention Required! \| Cloudflare<\/title>/i.test(text);
  },

  _absoluteUrl: function(url) {
    if (!url) return null;
    var value = String(url).trim();
    if (!value) return null;
    if (/^https?:\/\//i.test(value)) return value;
    if (value.startsWith('//')) return 'https:' + value;
    if (value.startsWith('/')) return extensionObject.baseUrl + value;
    return extensionObject.baseUrl + '/' + value.replace(/^\/+/, '');
  },

  _get: function(urlOrPath) {
    var url = /^https?:\/\//i.test(String(urlOrPath || ''))
      ? String(urlOrPath)
      : extensionObject._absoluteUrl(urlOrPath);

    var response = JSON.parse(__fetch(url, {
      method: 'GET',
      headers: extensionObject._HEADERS
    }));

    if (response.status < 200 || response.status >= 300 || !response.body) {
      throw new Error('Request failed (' + response.status + ') for ' + url);
    }

    if (extensionObject._isChallengePage(response.body)) {
      throw new Error('Mangakakalot blocked the request with an anti-bot challenge');
    }

    return response.body;
  },

  _getJson: function(urlOrPath) {
    var body = extensionObject._get(urlOrPath);
    try {
      return JSON.parse(body);
    } catch (error) {
      throw new Error('Response was not valid JSON');
    }
  },

  _extractSlugFromUrl: function(url) {
    var match = String(url || '').match(/\/manga\/([^/?#]+)/i);
    return match ? decodeURIComponent(match[1]) : '';
  },

  _extractTitleFromBlock: function(block) {
    var titleMatch = block.match(/<h3[^>]*class="[^"]*story_name[^"]*"[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/i)
      || block.match(/<h3[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/i)
      || block.match(/title="([^"]+)"/i)
      || block.match(/alt="([^"\n]+)"?/i);
    return titleMatch ? extensionObject._stripTags(titleMatch[1]) : '';
  },

  _extractSearchResults: function(html) {
    var results = [];
    var seen = {};
    var itemRegex = /<div[^>]*class="[^"]*(?:story_item|list-story-item|content-genres-item|search-story-item|list-comic-item-wrap)[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]*class="[^"]*(?:story_item|list-story-item|content-genres-item|search-story-item|list-comic-item-wrap)[^"]*"|$)/gi;
    var match;

    while ((match = itemRegex.exec(html)) !== null) {
      var block = match[1];
      var hrefMatch = block.match(/href="([^"]*\/manga\/[^"#?]+)"/i);
      var title = extensionObject._extractTitleFromBlock(block);
      if (!hrefMatch || !title) continue;

      var slug = extensionObject._extractSlugFromUrl(hrefMatch[1]);
      if (!slug || seen[slug]) continue;
      seen[slug] = true;

      var imageMatch = block.match(/<(?:img)[^>]+(?:data-src|src)="([^"]+)"/i);
      var chapterMatch = block.match(/(?:list-story-item-wrap-chapter|chapter-item|item_chapter)"[^>]*>([\s\S]*?)</i);
      var descriptionMatch = block.match(/<p[^>]*class="[^"]*(?:description|content|story_item_description)[^"]*"[^>]*>([\s\S]*?)<\/p>/i);

      results.push({
        id: slug,
        title: title,
        coverUrl: imageMatch ? extensionObject._absoluteUrl(imageMatch[1]) : null,
        description: descriptionMatch ? extensionObject._stripTags(descriptionMatch[1]) : undefined,
        status: chapterMatch ? extensionObject._stripTags(chapterMatch[1]) : undefined,
        genres: []
      });
    }

    return results;
  },

  _hasNextPage: function(html) {
    return /(?:page_select|page-select|page-blue)[\s\S]*?<a[^>]+href=/i.test(String(html || ''));
  },

  _extractSection: function(html, patterns) {
    for (var i = 0; i < patterns.length; i += 1) {
      var match = html.match(patterns[i]);
      if (match) return match[1];
    }
    return '';
  },

  _extractLinkTexts: function(html) {
    var values = [];
    var seen = {};
    var linkRegex = /<a[^>]*>([\s\S]*?)<\/a>/gi;
    var match;
    while ((match = linkRegex.exec(String(html || ''))) !== null) {
      var text = extensionObject._stripTags(match[1]);
      if (!text || seen[text]) continue;
      seen[text] = true;
      values.push(text);
    }
    return values;
  },

  _extractJsArray: function(html, name) {
    var regex = new RegExp('var\\s+' + name + '\\s*=\\s*(\\[[\\s\\S]*?\\]);', 'i');
    var match = regex.exec(String(html || ''));
    if (!match) return [];
    try {
      var parsed = JSON.parse(match[1]);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  },

  _buildChapterPath: function(mangaSlug, chapter) {
    if (!chapter) return '';
    if (chapter.chapter_path) return chapter.chapter_path;
    if (chapter.path) return chapter.path;
    if (chapter.chapter_slug) return '/manga/' + encodeURIComponent(mangaSlug) + '/' + String(chapter.chapter_slug).replace(/^\/+/, '');
    return '';
  },

  _extractChapterRows: function(html) {
    var rows = [];
    var rowRegex = /<(?:div[^>]*class="[^"]*row[^"]*"|li[^>]*class="[^"]*row-content-chapter[^"]*")[^>]*>([\s\S]*?)(?=<div[^>]*class="[^"]*row[^"]*"|<li[^>]*class="[^"]*row-content-chapter[^"]*"|$)/gi;
    var match;
    while ((match = rowRegex.exec(html)) !== null) {
      rows.push(match[1]);
    }
    return rows;
  },

  search: function(query, page) {
    if (!query || !String(query).trim()) {
      return { results: [], hasNextPage: false };
    }

    try {
      var normalized = extensionObject._normalizeQuery(query);
      var html = extensionObject._get('/search/story/' + normalized + '?page=' + (page || 1));
      return {
        results: extensionObject._extractSearchResults(html),
        hasNextPage: extensionObject._hasNextPage(html)
      };
    } catch (error) {
      console.error('[Mangakakalot] search failed:', error);
      return { results: [], hasNextPage: false };
    }
  },

  discover: function(page, sortType, genres) {
    var targetPage = page || 1;
    var genreList = Array.isArray(genres) ? genres.filter(Boolean) : [];
    var sort = String(sortType || '').toLowerCase();
    var path = '';

    if (genreList.length > 0) {
      var genreSlug = String(genreList[0]).replace(/^\/+|\/+$/g, '');
      var order = sort === 'score' ? 'topview' : (sort === 'az' ? 'az' : 'latest');
      path = '/genre/' + genreSlug + '?type=' + order + '&page=' + targetPage;
    } else if (sort === 'score') {
      path = '/manga-list/hot-manga?page=' + targetPage;
    } else {
      path = '/manga-list/latest-manga?page=' + targetPage;
    }

    try {
      var html = extensionObject._get(path);
      return {
        results: extensionObject._extractSearchResults(html),
        hasNextPage: extensionObject._hasNextPage(html)
      };
    } catch (error) {
      console.error('[Mangakakalot] discover failed:', error);
      return { results: [], hasNextPage: false };
    }
  },

  getDetails: function(id) {
    var slug = String(id || '').replace(/^\/+|\/+$/g, '');
    var html = extensionObject._get('/manga/' + slug);

    var title = extensionObject._stripTags(extensionObject._extractSection(html, [
      /<div[^>]*class="[^"]*manga-info-top[^"]*"[^>]*>[\s\S]*?<h1[^>]*>([\s\S]*?)<\/h1>/i,
      /<div[^>]*class="[^"]*panel-story-info[^"]*"[^>]*>[\s\S]*?<h1[^>]*>([\s\S]*?)<\/h1>/i,
      /<h1[^>]*>([\s\S]*?)<\/h1>/i
    ]));

    var coverUrl = extensionObject._absoluteUrl(extensionObject._extractSection(html, [
      /<div[^>]*class="[^"]*manga-info-pic[^"]*"[^>]*>[\s\S]*?<img[^>]+(?:data-src|src)="([^"]+)"/i,
      /<span[^>]*class="[^"]*info-image[^"]*"[^>]*>[\s\S]*?<img[^>]+(?:data-src|src)="([^"]+)"/i
    ]));

    var authorSection = extensionObject._extractSection(html, [
      /<li[^>]*>\s*Author\(s\)\s*:[\s\S]*?<\/li>/i,
      /<td[^>]*>\s*Author\(s\)\s*<\/td>[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>/i
    ]);
    var authors = extensionObject._extractLinkTexts(authorSection);

    var genreSection = extensionObject._extractSection(html, [
      /<li[^>]*>\s*Genres\s*:[\s\S]*?<\/li>/i,
      /<td[^>]*>\s*Genres\s*<\/td>[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>/i,
      /<div[^>]*class="[^"]*genres-wrap[^"]*"[^>]*>[\s\S]*?<div[^>]*class="[^"]*genre-list[^"]*"[^>]*>([\s\S]*?)<\/div>/i
    ]);
    var genres = extensionObject._extractLinkTexts(genreSection);

    var statusText = extensionObject._stripTags(extensionObject._extractSection(html, [
      /<li[^>]*>\s*Status\s*:\s*([\s\S]*?)<\/li>/i,
      /<td[^>]*>\s*Status\s*<\/td>[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>/i
    ]));

    var description = extensionObject._stripTags(extensionObject._extractSection(html, [
      /<div[^>]*id="noidungm"[^>]*>([\s\S]*?)<\/div>/i,
      /<div[^>]*id="contentBox"[^>]*>([\s\S]*?)<\/div>/i,
      /<div[^>]*id="panel-story-info-description"[^>]*>([\s\S]*?)<\/div>/i
    ]));

    if (title && description.toLowerCase().startsWith(title.toLowerCase() + ' summary:')) {
      description = description.slice(title.length + 9).trim();
    }

    var chapters = [];
    try {
      var api = extensionObject._getJson('/api/manga/' + slug + '/chapters?limit=-1');
      var rawChapters = (api && api.data && api.data.chapters) || [];
      chapters = rawChapters.map(function(chapter) {
        var chapterNum = parseFloat(chapter.chapter_num);
        return {
          id: extensionObject._buildChapterPath(slug, chapter),
          number: isNaN(chapterNum) ? 0 : chapterNum,
          title: chapter.chapter_name || null,
          releaseDate: chapter.updated_at || null
        };
      }).filter(function(chapter) {
        return !!chapter.id;
      });
    } catch (_) {
      var rows = extensionObject._extractChapterRows(html);
      chapters = rows.map(function(row) {
        var hrefMatch = row.match(/href="([^"]+)"/i);
        var chapterText = hrefMatch ? extensionObject._stripTags(row) : '';
        var chapterNumberMatch = chapterText.match(/chapter\s+([\d.]+)/i);
        return {
          id: hrefMatch ? extensionObject._extractSection(hrefMatch[1], [/(\/manga\/[^"]+)/i]) || hrefMatch[1] : '',
          number: chapterNumberMatch ? parseFloat(chapterNumberMatch[1]) : 0,
          title: chapterText || null
        };
      }).filter(function(chapter) {
        return !!chapter.id;
      });
    }

    chapters.sort(function(a, b) {
      return a.number - b.number;
    });

    return {
      id: slug,
      title: title || slug,
      english_name: null,
      native_name: null,
      coverUrl: coverUrl,
      description: description || null,
      genres: genres,
      status: statusText || null,
      year: null,
      rating: null,
      chapters: chapters,
      type: 'manga',
      totalChapters: chapters.length,
      authors: authors.length ? authors : null,
      background: null
    };
  },

  getChapterImages: function(chapterId) {
    try {
      var path = String(chapterId || '').trim();
      if (!path) {
        return { images: [], totalPages: 0, title: null };
      }

      if (!path.startsWith('/')) {
        path = '/' + path.replace(/^\/+/, '');
      }

      var html = extensionObject._get(path);
      var cdns = extensionObject._extractJsArray(html, 'cdns');
      var backupImages = extensionObject._extractJsArray(html, 'backupImage');
      var chapterImages = extensionObject._extractJsArray(html, 'chapterImages');
      var base = cdns[0] || backupImages[0] || '';

      if (base && base.charAt(base.length - 1) !== '/') {
        base += '/';
      }

      var images = chapterImages.map(function(entry, index) {
        var url = String(entry || '').trim();
        if (!url) return null;
        if (!/^https?:\/\//i.test(url)) {
          url = base + url.replace(/^\/+/, '');
        }
        return {
          url: url,
          page: index + 1,
          width: null,
          height: null
        };
      }).filter(Boolean);

      if (images.length === 0) {
        var fallback = [];
        var imgRegex = /<(?:img)[^>]+(?:data-src|src)="([^"]+)"[^>]*>/gi;
        var imgMatch;
        while ((imgMatch = imgRegex.exec(html)) !== null) {
          var imgUrl = String(imgMatch[1] || '').trim();
          if (!imgUrl || /loading|avatar|logo/i.test(imgUrl)) continue;
          fallback.push({
            url: extensionObject._absoluteUrl(imgUrl),
            page: fallback.length + 1,
            width: null,
            height: null
          });
        }
        images = fallback.filter(function(image) { return !!image.url; });
      }

      var titleMatch = path.match(/\/([^/?#]+)$/);
      return {
        images: images,
        totalPages: images.length,
        title: titleMatch ? extensionObject._decodeHtml(titleMatch[1].replace(/-/g, ' ')) : null
      };
    } catch (error) {
      console.error('[Mangakakalot] getChapterImages failed:', error);
      return { images: [], totalPages: 0, title: null };
    }
  },

  getTags: function() {
    try {
      var html = extensionObject._get('/manga-list/hot-manga');
      var seen = {};
      var genres = [];
      var nextId = 1;
      var regex = /href="\/genre\/([^"]+)"[^>]*>([^<]+)<\/a>/gi;
      var match;
      while ((match = regex.exec(html)) !== null) {
        var slug = String(match[1] || '').trim();
        var name = extensionObject._decodeHtml(String(match[2] || '').trim().replace(/\s+Manga$/i, ''));
        if (!slug || !name || seen[slug]) continue;
        seen[slug] = true;
        genres.push({
          id: nextId++,
          name: name,
          slug: slug,
          count: 0,
          thumbnail: null
        });
      }

      return {
        genres: genres,
        studios: [],
        hasNextPage: false
      };
    } catch (error) {
      console.error('[Mangakakalot] getTags failed:', error);
      return { genres: [], studios: [], hasNextPage: false };
    }
  }
};
`
