// haho.moe extension: fallback provider for restricted titles the hstream provider
// does not carry (used by watch.tsx only when hstream finds no match). Server-rendered
// site; search/episode lists are scraped from HTML. The episode page embeds
// /embed?v=<token>, whose <source> tags are plain MP4 (~480p) tokenized URLs that
// need only a Referer. Resolve at play time: tokens are short-lived.
//
// Ids: series = slug, episode = "{slug}::{n}" (same shape as the other slug providers).

export const HAHO_EXTENSION = String.raw`
const extensionObject = {
  id: "com.haho.source",
  name: "haho.moe",
  version: "1.0.0",
  type: "anime",
  language: "en",
  baseUrl: "https://haho.moe",
  referer: "https://haho.moe/",
  ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',

  get: function(url, referer) {
    const response = JSON.parse(__fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'text/html', 'Referer': referer || extensionObject.referer, 'User-Agent': extensionObject.ua }
    }));
    if (response.status < 200 || response.status >= 300) {
      throw new Error('haho returned HTTP ' + response.status + ' for ' + url);
    }
    return response.body || '';
  },

  decode: function(text) {
    return String(text || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  },

  search: (query, page) => {
    const p = page || 1;
    const html = extensionObject.get(extensionObject.baseUrl + '/anime?q=' + encodeURIComponent(query) + (p > 1 ? '&page=' + p : ''));
    const re = /<a href="https:\/\/haho\.moe\/anime\/([a-z0-9]+)"[^>]*?title="([^"]*)"[^>]*>(?:\s*<img[^>]*?src="([^"]+)")?/g;
    const results = [];
    const seen = {};
    let m;
    while ((m = re.exec(html)) !== null) {
      if (seen[m[1]]) continue;
      seen[m[1]] = true;
      results.push({
        id: m[1],
        title: extensionObject.decode(m[2]),
        cover_url: m[3] || null,
        year: null,
        rating: null,
        available_episodes: null,
        media_type: 'OVA',
        genres: [],
        native_name: null,
        title_synonyms: []
      });
    }
    return { results: results.filter(r => r.id && r.title), has_next_page: html.indexOf('page=' + (p + 1)) >= 0 };
  },

  getDetails: (id) => {
    const html = extensionObject.get(extensionObject.baseUrl + '/anime/' + id);
    const h1 = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
    const og = function(name) {
      const m = html.match(new RegExp('property="og:' + name + '" content="([^"]*)"'));
      return m ? extensionObject.decode(m[1]) : null;
    };
    const re = /href="https:\/\/haho\.moe\/anime\/([a-z0-9]+)\/(\d+)"/g;
    const numbers = {};
    let m;
    while ((m = re.exec(html)) !== null) if (m[1] === id) numbers[m[2]] = true;
    const episodes = Object.keys(numbers).map(Number).sort((a, b) => a - b).map(n => ({
      id: id + '::' + n,
      number: n,
      title: 'Episode ' + n,
      thumbnail: null
    }));
    if (!episodes.length) throw new Error('haho: no episodes found for ' + id);
    const title = h1 ? extensionObject.decode(h1[1]).trim() : id;
    return {
      id: id,
      title: title,
      english_name: title,
      native_name: null,
      title_synonyms: [],
      cover_url: og('image'),
      trailer_url: null,
      description: og('description') || 'No description available',
      genres: [],
      status: null,
      year: null,
      rating: null,
      episodes: episodes,
      type: 'OVA',
      season: null,
      episode_duration: null,
      audio_locales: ['ja-JP'],
      banner_url: og('image'),
      start_date: null,
      end_date: null,
      broadcast: null,
      episode_count: episodes.length,
      aired_start: null,
      last_update_end: null,
      broadcast_interval: null
    };
  },

  getSources: (episodeId) => {
    try {
      const parts = String(episodeId || '').split('::');
      if (!parts[0] || !parts[1]) return { sources: [], subtitles: [] };
      const pageUrl = extensionObject.baseUrl + '/anime/' + parts[0] + '/' + parts[1];
      const embed = extensionObject.get(pageUrl).match(/<iframe[^>]+src="(https:\/\/haho\.moe\/embed\?v=[^"]+)"/);
      if (!embed) return { sources: [], subtitles: [] };
      const html = extensionObject.get(extensionObject.decode(embed[1]), pageUrl);
      const re = /<source[^>]+src="([^"]+)"[^>]*title="(\d+)p"[^>]*>/g;
      const sources = [];
      let m;
      // Only tokenized links are direct files; the others are HTML watch pages.
      while ((m = re.exec(html)) !== null) {
        if (m[1].indexOf('download_token=') < 0) continue;
        sources.push({
          url: extensionObject.decode(m[1]),
          quality: m[2] + 'p',
          type: 'mp4',
          server: 'haho',
          resolution: Number(m[2]),
          referrer: extensionObject.referer,
          audio_type: 'sub',
          audio_locale: 'ja-JP',
          subtitles: []
        });
      }
      sources.sort((a, b) => b.resolution - a.resolution);
      return { sources: sources, subtitles: [] };
    } catch (error) {
      try { __log('[haho] getSources failed: ' + (error && error.message ? error.message : String(error))); } catch (_) {}
      return { sources: [], subtitles: [] };
    }
  }
};
`
