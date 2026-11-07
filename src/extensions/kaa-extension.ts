// KickAssAnime (kaa.lt) extension. Plain JSON API; streams are HLS on
// hls.krussdomi.com and need a kaa.lt Referer. Subtitles live in the player
// page's serialized props, so getSources fetches that page once per server.
//
// Episode ids are "{showSlug}::{episodeNumber}", the same shape Anikoto uses,
// so watch.tsx resolves both with the shared title resolver.

export const KAA_EXTENSION = String.raw`
const extensionObject = {
  id: "com.kaa.source",
  name: "KickAssAnime",
  version: "1.0.0",
  type: "anime",
  language: "en",
  baseUrl: "https://kaa.lt",
  hlsBaseUrl: "https://hls.krussdomi.com/manifest",
  referer: "https://kaa.lt/",

  request: function(url, options) {
    const opts = options || {};
    const headers = {
      'Accept': opts.accept || 'application/json',
      'Referer': extensionObject.referer,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0'
    };
    if (opts.body) headers['Content-Type'] = 'application/json';
    const response = JSON.parse(__fetch(url, {
      method: opts.body ? 'POST' : 'GET',
      headers: headers,
      body: opts.body
    }));
    if (response.status < 200 || response.status >= 300) {
      throw new Error('KAA returned HTTP ' + response.status + ' for ' + url);
    }
    return response.body || '';
  },

  api: function(path, body) {
    const text = extensionObject.request(extensionObject.baseUrl + '/api' + path, { body: body ? JSON.stringify(body) : undefined });
    try {
      return JSON.parse(text || 'null');
    } catch (error) {
      throw new Error('KAA returned non-JSON body for ' + path);
    }
  },

  showPath: function(slug) {
    return '/show/' + encodeURIComponent(slug);
  },

  poster: function(image) {
    return image && image.hq ? extensionObject.baseUrl + '/image/poster/' + image.hq + '.webp' : null;
  },

  // All ja-JP episodes. The API pages by episode range: ?ep=N returns the
  // page containing episode N plus the list of every page's episode numbers.
  episodes: function(slug) {
    const path = extensionObject.showPath(slug) + '/episodes?lang=ja-JP&ep=';
    const first = extensionObject.api(path + '1') || {};
    const out = Array.isArray(first.result) ? first.result.slice() : [];
    const pages = Array.isArray(first.pages) ? first.pages : [];
    for (let i = 1; i < pages.length; i++) {
      const start = pages[i] && Array.isArray(pages[i].eps) ? pages[i].eps[0] : null;
      if (start == null) continue;
      const page = extensionObject.api(path + encodeURIComponent(String(start))) || {};
      if (Array.isArray(page.result)) for (const ep of page.result) out.push(ep);
    }
    return out;
  },

  // Find "ep-{n}-{hash}" for one episode, fetching only the page that holds it.
  episodeSlug: function(slug, number) {
    const target = Number(number);
    const path = extensionObject.showPath(slug) + '/episodes?lang=ja-JP&ep=';
    const first = extensionObject.api(path + '1') || {};
    let list = Array.isArray(first.result) ? first.result : [];
    let found = list.find(ep => Number(ep.episode_number) === target);
    if (!found && Array.isArray(first.pages)) {
      const page = first.pages.find(p => p && Array.isArray(p.eps) && p.eps.some(n => Number(n) === target));
      if (page && Number(page.eps[0]) !== Number(list[0] && list[0].episode_number)) {
        const data = extensionObject.api(path + encodeURIComponent(String(page.eps[0]))) || {};
        list = Array.isArray(data.result) ? data.result : [];
        found = list.find(ep => Number(ep.episode_number) === target);
      }
    }
    if (found && found.slug) return 'ep-' + found.episode_string + '-' + found.slug;

    // Movies have no episode list; the show's watch_uri points at the single episode.
    if (!list.length) {
      const show = extensionObject.api(extensionObject.showPath(slug)) || {};
      const match = String(show.watch_uri || '').match(/\/(ep-[\d.]+-[a-f0-9]+)$/i);
      if (match) return match[1];
    }
    return null;
  },

  subtitles: function(playerUrl) {
    let html;
    try {
      html = extensionObject.request(playerUrl, { accept: 'text/html' });
    } catch (error) {
      try { __log('[KAA] player page failed: ' + (error && error.message ? error.message : String(error))); } catch (_) {}
      return [];
    }
    const props = html.replace(/&quot;/g, '"').replace(/&amp;/g, '&');
    const re = /\{"language":\[0,"([^"]*)"\],"name":\[0,"([^"]*)"\],"src":\[0,"([^"]+)"\]\}/g;
    const out = [];
    let m;
    while ((m = re.exec(props)) !== null) {
      out.push({ url: m[3], language: m[1] || m[2], label: m[2] || m[1] });
    }
    return out;
  },

  search: (query, page) => {
    const data = extensionObject.api('/fsearch', { page: page || 1, query: query }) || {};
    const results = Array.isArray(data.result) ? data.result : [];
    return {
      results: results.map(item => ({
        id: item.slug,
        title: item.title,
        cover_url: extensionObject.poster(item.poster),
        year: item.year || null,
        rating: null,
        available_episodes: item.episode_count || null,
        media_type: item.type || null,
        genres: Array.isArray(item.genres) ? item.genres : [],
        native_name: null,
        title_synonyms: item.title_en ? [item.title_en] : []
      })).filter(item => item.id && item.title),
      has_next_page: (data.maxPage || 1) > (page || 1)
    };
  },

  getDetails: (id) => {
    const show = extensionObject.api(extensionObject.showPath(id)) || {};
    const list = extensionObject.episodes(id);
    const episodes = list.map(ep => ({
      id: id + '::' + ep.episode_number,
      number: Number(ep.episode_number),
      title: ep.title || ('Episode ' + ep.episode_string),
      thumbnail: null
    }));
    if (!episodes.length && show.watch_uri) {
      episodes.push({ id: id + '::1', number: 1, title: show.title_en || show.title, thumbnail: null });
    }
    return {
      id: id,
      title: show.title,
      english_name: show.title_en || null,
      native_name: show.title_original || null,
      title_synonyms: Array.isArray(show.synonyms) ? show.synonyms : [],
      cover_url: extensionObject.poster(show.poster),
      trailer_url: null,
      description: show.synopsis || 'No description available',
      genres: Array.isArray(show.genres) ? show.genres : [],
      status: show.status || null,
      year: show.year || null,
      rating: null,
      episodes: episodes,
      type: show.type || null,
      season: null,
      episode_duration: null,
      episode_count: show.episode_count || episodes.length || null,
      aired_start: null,
      last_update_end: null,
      broadcast_interval: null
    };
  },

  getSources: (episodeId) => {
    try {
      const parts = String(episodeId || '').split('::');
      const slug = parts[0];
      const number = parts[1];
      if (!slug || !number) return { sources: [], subtitles: [] };

      const epSlug = extensionObject.episodeSlug(slug, number);
      if (!epSlug) return { sources: [], subtitles: [] };

      const data = extensionObject.api(extensionObject.showPath(slug) + '/episode/' + encodeURIComponent(epSlug)) || {};
      const servers = Array.isArray(data.servers) ? data.servers : [];
      const sources = [];
      const subtitles = [];
      for (const server of servers) {
        const src = String((server && server.src) || '');
        // DASH servers (BirdStream) have no HLS manifest at this host.
        if (/[?&]type=dash\b/.test(src)) continue;
        const idMatch = src.match(/[?&]id=([^&]+)/);
        if (!idMatch) continue;
        const subs = extensionObject.subtitles(src);
        for (const sub of subs) subtitles.push(sub);
        sources.push({
          url: extensionObject.hlsBaseUrl + '/' + idMatch[1] + '/master.m3u8',
          quality: 'Auto',
          type: 'hls',
          server: server.name || 'KAA',
          referrer: extensionObject.referer,
          audio_type: 'sub',
          subtitles: subs
        });
      }
      return { sources: sources, subtitles: subtitles };
    } catch (error) {
      try { __log('[KAA] getSources failed: ' + (error && error.message ? error.message : String(error))); } catch (_) {}
      return { sources: [], subtitles: [] };
    }
  }
};
`
