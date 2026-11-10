// hstream.moe extension (opt-in via the extendedCatalog setting). Server-rendered
// site: search and episode lists are scraped from HTML; the stream comes from a
// session-bound POST /player/api (XSRF cookie flow) and is DASH only
// (<domain>/<stream_url>/<720|1080>/manifest.mpd, fMP4 segments, no Referer check).
//
// Ids: series = slug, episode = "{slug}::{n}", the same shape KAA/Anikoto use so
// watch.tsx resolves it with the shared title resolver. Episode pages live at
// /<section>/{slug}-{n}; the section is read from search results, not hardcoded.

export const HSTREAM_EXTENSION = String.raw`
const extensionObject = {
  id: "com.hstream.source",
  name: "hstream.moe",
  version: "1.0.0",
  type: "anime",
  language: "en",
  baseUrl: "https://hstream.moe",
  referer: "https://hstream.moe/",
  qualities: [1080, 720],
  ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',

  // Returns { body, cookies } where cookies is a "name=value; ..." jar built from Set-Cookie.
  request: function(url, options) {
    const opts = options || {};
    const headers = {
      'Accept': opts.accept || 'text/html',
      'Referer': opts.referer || extensionObject.referer,
      'User-Agent': extensionObject.ua
    };
    if (opts.cookies) headers['Cookie'] = opts.cookies;
    if (opts.headers) for (const k in opts.headers) headers[k] = opts.headers[k];
    const response = JSON.parse(__fetch(url, {
      method: opts.body ? 'POST' : 'GET',
      headers: headers,
      body: opts.body
    }));
    if (response.status < 200 || response.status >= 300) {
      throw new Error('hstream returned HTTP ' + response.status + ' for ' + url);
    }
    const jar = {};
    for (const line of response.set_cookie || []) {
      const pair = String(line).split(';')[0];
      const i = pair.indexOf('=');
      if (i > 0) jar[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
    }
    return { body: response.body || '', jar: jar };
  },

  decode: function(text) {
    return String(text || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  },

  abs: function(path) {
    return !path ? null : path.indexOf('http') === 0 ? path : extensionObject.baseUrl + path;
  },

  // Path segment episode pages live under; learned from the first search result.
  section: null,

  // One entry per episode page found in a search result page: {slug, number, title, thumb}.
  parseSearch: function(html) {
    const re = /href="https:\/\/hstream\.moe\/([a-z]+)\/([a-z0-9-]+?)-(\d+)"[\s\S]{0,1500}?src="([^"]+)"[\s\S]{0,60}?alt="([^"]*)"/g;
    const out = [];
    let m;
    while ((m = re.exec(html)) !== null) {
      extensionObject.section = extensionObject.section || m[1];
      out.push({
        slug: m[2],
        number: Number(m[3]),
        title: extensionObject.decode(m[5]).replace(/\s+-\s+\d+\s*$/, ''),
        thumb: extensionObject.abs(m[4])
      });
    }
    return out;
  },

  // Episode page URL; a series search first if no search has run in this runtime.
  pageUrl: function(slug, number) {
    if (!extensionObject.section) extensionObject.searchPage(slug.replace(/-/g, ' '), 1);
    if (!extensionObject.section) throw new Error('hstream: no search results for ' + slug);
    return extensionObject.baseUrl + '/' + extensionObject.section + '/' + slug + '-' + number;
  },

  searchPage: function(query, page) {
    const url = extensionObject.baseUrl + '/search?search=' + encodeURIComponent(query) + (page > 1 ? '&page=' + page : '');
    const html = extensionObject.request(url).body;
    return { items: extensionObject.parseSearch(html), hasNext: html.indexOf('page=' + (page + 1)) >= 0 };
  },

  search: (query, page) => {
    const p = page || 1;
    const data = extensionObject.searchPage(query, p);
    const series = {};
    const results = [];
    for (const item of data.items) {
      const s = series[item.slug];
      if (s) { s.available_episodes += 1; continue; }
      const entry = {
        id: item.slug,
        title: item.title,
        cover_url: item.thumb,
        year: null,
        rating: null,
        available_episodes: 1,
        media_type: 'OVA',
        genres: [],
        native_name: null,
        title_synonyms: []
      };
      series[item.slug] = entry;
      results.push(entry);
    }
    return { results: results.filter(r => r.id && r.title), has_next_page: data.hasNext };
  },

  episodes: function(slug) {
    const query = slug.replace(/-/g, ' ');
    const found = {};
    for (let page = 1; page <= 5; page++) {
      const data = extensionObject.searchPage(query, page);
      for (const item of data.items) if (item.slug === slug) found[item.number] = item;
      if (!data.hasNext) break;
    }
    return Object.keys(found).map(Number).sort((a, b) => a - b).map(n => found[n]);
  },

  meta: function(slug, number) {
    const html = extensionObject.request(extensionObject.pageUrl(slug, number)).body;
    const og = function(name) {
      const m = html.match(new RegExp('property="og:' + name + '" content="([^"]*)"'));
      return m ? extensionObject.decode(m[1]) : null;
    };
    return { description: og('description'), image: og('image') };
  },

  getDetails: (id) => {
    const list = extensionObject.episodes(id);
    if (!list.length) throw new Error('hstream: no episodes found for ' + id);
    let meta = { description: null, image: null };
    try { meta = extensionObject.meta(id, list[0].number); } catch (e) {}
    const episodes = list.map(ep => ({
      id: id + '::' + ep.number,
      number: ep.number,
      title: 'Episode ' + ep.number,
      thumbnail: ep.thumb
    }));
    return {
      id: id,
      title: list[0].title,
      english_name: list[0].title,
      native_name: null,
      title_synonyms: [],
      cover_url: list[0].thumb || meta.image,
      trailer_url: null,
      description: meta.description || 'No description available',
      genres: [],
      status: null,
      year: null,
      rating: null,
      episodes: episodes,
      type: 'OVA',
      season: null,
      episode_duration: null,
      age_rating: 'Rx',
      audio_locales: ['ja-JP'],
      banner_url: meta.image || null,
      start_date: null,
      end_date: null,
      broadcast: null,
      episode_count: episodes.length,
      aired_start: null,
      last_update_end: null,
      broadcast_interval: null
    };
  },

  // Episode page (session + XSRF cookies, e_id) -> POST /player/api.
  player: function(slug, number) {
    const pageUrl = extensionObject.pageUrl(slug, number);
    const page = extensionObject.request(pageUrl);
    const id = page.body.match(/id="e_id"[^>]*value="(\d+)"/) || page.body.match(/value="(\d+)"[^>]*id="e_id"/);
    if (!id) throw new Error('hstream: episode id not found on ' + pageUrl);
    const cookies = Object.keys(page.jar).map(k => k + '=' + page.jar[k]).join('; ');
    const xsrf = page.jar['XSRF-TOKEN'] ? decodeURIComponent(page.jar['XSRF-TOKEN']) : '';
    const res = extensionObject.request(extensionObject.baseUrl + '/player/api', {
      body: JSON.stringify({ episode_id: id[1] }),
      accept: 'application/json',
      referer: pageUrl,
      cookies: cookies,
      headers: {
        'Content-Type': 'application/json',
        'Origin': extensionObject.baseUrl,
        'X-XSRF-TOKEN': xsrf,
        'X-Requested-With': 'XMLHttpRequest'
      }
    });
    return JSON.parse(res.body || 'null') || {};
  },

  manifestUrl: function(domain, streamUrl, height) {
    return String(domain).replace(/\/+$/, '') + '/' + streamUrl + '/' + height + '/manifest.mpd';
  },

  // First domain whose manifest answers 200 (mirrors differ in uptime).
  pickDomain: function(domains, streamUrl) {
    for (const d of domains) {
      try {
        const r = JSON.parse(__fetch(extensionObject.manifestUrl(d, streamUrl, extensionObject.qualities[0]), {
          method: 'GET',
          headers: { 'Referer': extensionObject.referer, 'User-Agent': extensionObject.ua }
        }));
        if (r.status === 200) return d;
      } catch (e) {}
    }
    return domains[0];
  },

  getSources: (episodeId) => {
    try {
      const parts = String(episodeId || '').split('::');
      if (!parts[0] || !parts[1]) return { sources: [], subtitles: [] };
      const data = extensionObject.player(parts[0], parts[1]);
      const domains = Array.isArray(data.stream_domains) ? data.stream_domains : [];
      if (!data.stream_url || !domains.length) return { sources: [], subtitles: [] };
      const domain = extensionObject.pickDomain(domains, data.stream_url);
      const subtitles = (Array.isArray(data.extra_subtitles) ? data.extra_subtitles : [])
        .map(s => ({ url: extensionObject.abs(s && (s.url || s.src || s.file)), language: (s && (s.language || s.lang)) || 'en', label: (s && (s.label || s.name || s.language)) || 'Subtitles' }))
        .filter(s => s.url);
      return {
        sources: extensionObject.qualities.map(h => ({
          url: extensionObject.manifestUrl(domain, data.stream_url, h),
          quality: h + 'p',
          type: 'dash',
          server: 'hstream',
          resolution: h,
          referrer: extensionObject.referer,
          audio_type: 'sub',
          audio_locale: 'ja-JP',
          subtitles: subtitles
        })),
        subtitles: subtitles
      };
    } catch (error) {
      try { __log('[hstream] getSources failed: ' + (error && error.message ? error.message : String(error))); } catch (_) {}
      return { sources: [], subtitles: [] };
    }
  }
};
`
