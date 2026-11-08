// KickAssAnime (kaa.lt) extension. Plain JSON API; streams are HLS on
// hls.krussdomi.com, played with a krussdomi.com Referer/Origin. Subtitles live in the player
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
  // API calls need a kaa.lt Referer; the stream CDN only serves segments to
  // its player's origin (krussdomi.com), which the manifest host also accepts.
  referer: "https://kaa.lt/",
  streamReferer: "https://krussdomi.com/",

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

  thumbnail: function(image) {
    const key = image && (image.sm || image.hq);
    return key ? extensionObject.baseUrl + '/image/thumbnail/' + key + '.webp' : null;
  },

  // All ja-JP episodes. The API pages by episode range: ?ep=N returns the
  // page containing episode N plus the list of every page's episode numbers.
  banner: function(image) {
    const key = image && (image.hq || image.sm);
    return key ? extensionObject.baseUrl + '/image/banner/' + key + '.webp' : null;
  },

  // Audio locales KAA offers for a show; ja-JP (sub) always first.
  locales: function(show) {
    const list = Array.isArray(show && show.locales) ? show.locales.filter(l => typeof l === 'string') : [];
    const rest = list.filter(l => l !== 'ja-JP');
    return list.length ? (list.indexOf('ja-JP') >= 0 ? ['ja-JP'] : []).concat(rest) : ['ja-JP'];
  },

  episodes: function(slug, lang) {
    const path = extensionObject.showPath(slug) + '/episodes?lang=' + (lang || 'ja-JP') + '&ep=';
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
  episodeSlug: function(slug, number, lang) {
    const target = Number(number);
    const path = extensionObject.showPath(slug) + '/episodes?lang=' + (lang || 'ja-JP') + '&ep=';
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
    if (!list.length && (!lang || lang === 'ja-JP')) {
      const show = extensionObject.api(extensionObject.showPath(slug)) || {};
      const match = String(show.watch_uri || '').match(/\/(ep-[\d.]+-[a-f0-9]+)$/i);
      if (match) return match[1];
    }
    return null;
  },

  // The player page's serialized props carry the stream's real manifest URL
  // (it differs per server: hls.krussdomi.com, bl.krussdomi.com, ...) and its
  // subtitle tracks.
  player: function(playerUrl) {
    let html;
    try {
      html = extensionObject.request(playerUrl, { accept: 'text/html' });
    } catch (error) {
      try { __log('[KAA] player page failed: ' + (error && error.message ? error.message : String(error))); } catch (_) {}
      return { manifest: null, previewVtt: null, subtitles: [] };
    }
    const props = html.replace(/&quot;/g, '"').replace(/&amp;/g, '&');
    const manifest = props.match(/"manifest":\[0,"([^"]+)"\]/);
    const re = /\{"language":\[0,"([^"]*)"\],"name":\[0,"([^"]*)"\],"src":\[0,"([^"]+)"\]\}/g;
    const subtitles = [];
    let m;
    while ((m = re.exec(props)) !== null) {
      subtitles.push({ url: m[3], language: m[1] || m[2], label: m[2] || m[1] });
    }
    const preview = props.match(/"thumbnails":\[0,"([^"]+\.vtt[^"]*)"\]/);
    return {
      previewVtt: preview ? preview[1] : null,
      manifest: manifest ? (manifest[1].indexOf('//') === 0 ? 'https:' + manifest[1] : manifest[1]) : null,
      subtitles: subtitles
    };
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
        native_name: item.title_original || null,
        title_synonyms: item.title_en ? [item.title_en] : []
      })).filter(item => item.id && item.title),
      has_next_page: (data.maxPage || 1) > (page || 1)
    };
  },

  // Broadcast day/time (UTC, verified against Frieren: Fri 23:00 JST = 14:00) live on the episode endpoint.
  broadcast: function(slug) {
    try {
      const list = extensionObject.episodes(slug);
      const last = list[list.length - 1];
      if (!last) return null;
      const ep = extensionObject.api(extensionObject.showPath(slug) + '/episode/' + encodeURIComponent('ep-' + last.episode_string + '-' + last.slug)) || {};
      return ep.broadcast_day && ep.broadcast_time ? { day: ep.broadcast_day, time: ep.broadcast_time } : null;
    } catch (e) { return null; }
  },

  getDetails: (id) => {
    const show = extensionObject.api(extensionObject.showPath(id)) || {};
    const list = extensionObject.episodes(id);
    const episodes = list.map(ep => ({
      id: id + '::' + ep.episode_number,
      number: Number(ep.episode_number),
      title: ep.title || ('Episode ' + ep.episode_string),
      thumbnail: extensionObject.thumbnail(ep.thumbnail),
      duration: ep.duration_ms ? Math.round(ep.duration_ms / 1000) : null
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
      age_rating: show.rating || null,
      audio_locales: extensionObject.locales(show),
      banner_url: extensionObject.banner(show.banner),
      start_date: show.start_date || null,
      end_date: show.end_date || null,
      broadcast: extensionObject.broadcast(id),
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

      const show = extensionObject.api(extensionObject.showPath(slug)) || {};
      const sources = [];
      const subtitles = [];
      for (const locale of extensionObject.locales(show)) {
        const epSlug = extensionObject.episodeSlug(slug, number, locale);
        if (!epSlug) continue;
        let data;
        try { data = extensionObject.api(extensionObject.showPath(slug) + '/episode/' + encodeURIComponent(epSlug)) || {}; } catch (e) { continue; }
        const servers = Array.isArray(data.servers) ? data.servers : [];
        const dub = locale !== 'ja-JP';
        for (const server of servers) {
          const src = String((server && server.src) || '');
          if (!src || /[?&]type=dash/.test(src)) continue;
          const player = extensionObject.player(src);
          if (!player.manifest) continue;
          if (!dub && !subtitles.length) for (const sub of player.subtitles) subtitles.push(sub);
          sources.push({
            url: player.manifest,
            quality: 'Auto',
            type: 'hls',
            server: server.name || 'KAA',
            referrer: extensionObject.streamReferer,
            audio_type: dub ? 'dub' : 'sub',
            audio_locale: locale,
            episode_synopsis: data.episode_synopsis || null,
            subtitles: player.subtitles,
            preview_vtt: player.previewVtt
          });
        }
      }
      return { sources: sources, subtitles: subtitles };
    } catch (error) {
      try { __log('[KAA] getSources failed: ' + (error && error.message ? error.message : String(error))); } catch (_) {}
      return { sources: [], subtitles: [] };
    }
  }
};
`
