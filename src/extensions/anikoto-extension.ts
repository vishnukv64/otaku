// Anikoto REST API extension wrapper.

export const ANIKOTO_LEGACY_LOCAL_API_BASE_URL = 'http://localhost:3000/api'
export const ANIKOTO_DEFAULT_API_BASE_URL = 'https://anikoto-scrap-api.vercel.app/api'
export const ANIKOTO_DEFAULT_SITE_BASE_URL = 'https://anikoto.cz'
export const ANIKOTO_DEFAULT_YOTOCHAN_BASE_URL = 'https://yotuchan.com'

interface AnikotoExtensionOptions {
  apiBaseUrl?: string
  siteBaseUrl?: string
  yotochanBaseUrl?: string
}

function normalizeApiBaseUrl(baseUrl: string): string {
  const value = baseUrl === ANIKOTO_LEGACY_LOCAL_API_BASE_URL ? ANIKOTO_DEFAULT_API_BASE_URL : baseUrl
  const trimmed = (value || ANIKOTO_DEFAULT_API_BASE_URL).replace(/\/+$/, '')
  return trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`
}

function normalizeBaseUrl(baseUrl: string, fallback: string): string {
  return (baseUrl || fallback).replace(/\/+$/, '')
}

export function createAnikotoExtension(options: string | AnikotoExtensionOptions = ANIKOTO_DEFAULT_API_BASE_URL): string {
  const opts = typeof options === 'string' ? { apiBaseUrl: options } : options
  const apiBaseUrl = JSON.stringify(normalizeApiBaseUrl(opts.apiBaseUrl || ANIKOTO_DEFAULT_API_BASE_URL))
  const siteBaseUrl = JSON.stringify(normalizeBaseUrl(opts.siteBaseUrl || ANIKOTO_DEFAULT_SITE_BASE_URL, ANIKOTO_DEFAULT_SITE_BASE_URL))
  const yotochanBaseUrl = JSON.stringify(normalizeBaseUrl(opts.yotochanBaseUrl || ANIKOTO_DEFAULT_YOTOCHAN_BASE_URL, ANIKOTO_DEFAULT_YOTOCHAN_BASE_URL))

  return `
const extensionObject = {
  id: "com.anikoto.source",
  name: "Anikoto",
  version: "1.0.0",
  type: "anime",
  language: "en",
  baseUrl: ${apiBaseUrl},
  siteBaseUrl: ${siteBaseUrl},
  yotochanBaseUrl: ${yotochanBaseUrl},

  domainQuery: function() {
    return '&anikotoBaseUrl=' + encodeURIComponent(extensionObject.siteBaseUrl) +
      '&yotochanBaseUrl=' + encodeURIComponent(extensionObject.yotochanBaseUrl);
  },

  fetchJson: function(path) {
    const url = extensionObject.baseUrl + path;
    let responseStr;
    try {
      responseStr = __fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'X-Anikoto-Base-Url': extensionObject.siteBaseUrl,
          'X-Yotochan-Base-Url': extensionObject.yotochanBaseUrl,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0'
        }
      });
    } catch (error) {
      throw new Error('Anikoto API request failed for ' + url + ': ' + (error && error.message ? error.message : String(error)));
    }

    let response;
    try {
      response = JSON.parse(responseStr);
    } catch (error) {
      throw new Error('Anikoto API returned an invalid transport envelope for ' + url);
    }

    let body;
    try {
      body = JSON.parse(response.body || '{}');
    } catch (error) {
      throw new Error('Anikoto API returned non-JSON body for ' + url);
    }

    if (response.status < 200 || response.status >= 300) {
      throw new Error('Anikoto API returned HTTP ' + response.status + ' for ' + url);
    }
    if (!body.ok) {
      throw new Error(body.message || ('Anikoto API request failed for ' + url));
    }
    return body.data;
  },

  parseYear: function(value) {
    if (!value) return null;
    const match = String(value).match(/\\b(19|20)\\d{2}\\b/);
    return match ? parseInt(match[0], 10) : null;
  },

  episodeCount: function(episodes) {
    if (!episodes) return null;
    return episodes.sub || episodes.total || null;
  },

  mapSubtitle: function(track) {
    const url = track && (track.file || track.url || track.proxyUrl);
    if (!url) return null;
    const label = track.label || track.language || 'Subtitles';
    if (String(label).toLowerCase().includes('thumbnail') || String(url).toLowerCase().includes('thumbnail')) return null;
    return { url: url, language: label, label: label };
  },

  sourceRank: function(source) {
    const url = String((source && source.m3u8) || '').toLowerCase();
    if (url.includes('kotocdn') || url.includes('mewstream') || url.includes('megaplay')) return 0;
    if (url.includes('watching.onl') || url.includes('vidwish.live')) return 10;
    return 5;
  },

  search: (query, page) => {
    const data = extensionObject.fetchJson('/search?keyword=' + encodeURIComponent(query) + extensionObject.domainQuery());
    const results = Array.isArray(data) ? data : (data && Array.isArray(data.results) ? data.results : []);
    return {
      results: results.map(item => ({
        id: item.slug || item.id,
        title: item.title,
        cover_url: item.image || null,
        year: extensionObject.parseYear(item.date),
        rating: typeof item.score === 'number' ? item.score : null,
        available_episodes: extensionObject.episodeCount(item.episodes) || item.totalEpisodes || null,
        media_type: item.type || null,
        genres: [],
        native_name: item.titleJp || null,
        title_synonyms: Array.isArray(item.alternativeTitles) ? item.alternativeTitles : []
      })).filter(item => item.id && item.title),
      has_next_page: false
    };
  },

  getDetails: (id) => {
    const data = extensionObject.fetchJson('/anime/' + encodeURIComponent(id) + '?' + extensionObject.domainQuery().slice(1));
    const episodeList = data && data.episodes && Array.isArray(data.episodes.episodes)
      ? data.episodes.episodes
      : [];

    const episodes = episodeList.map((episode, index) => {
      const number = parseFloat(episode.number || String(index + 1));
      return {
        id: id + '::' + String(episode.number || index + 1),
        number: isNaN(number) ? index + 1 : number,
        title: episode.title || ('Episode ' + String(episode.number || index + 1)),
        thumbnail: data.image || null
      };
    }).sort((a, b) => a.number - b.number);

    return {
      id: data.slug || id,
      title: data.title,
      english_name: null,
      native_name: data.titleJp || null,
      title_synonyms: data.alternativeTitles || [],
      cover_url: data.image || null,
      trailer_url: null,
      description: data.synopsis || 'No description available',
      genres: data.genres || [],
      status: data.status || null,
      year: extensionObject.parseYear(data.premiered || data.aired),
      rating: typeof data.malScore === 'number' ? data.malScore : null,
      episodes: episodes,
      type: data.type || null,
      season: null,
      episode_duration: null,
      episode_count: data.episodeCount || episodes.length || null,
      aired_start: null,
      last_update_end: null,
      broadcast_interval: null
    };
  },

  getSources: (episodeId) => {
    try {
      const parts = String(episodeId || '').split('::');
      const slug = parts[0];
      const episodeNumber = parts[1];
      if (!slug || !episodeNumber) return { sources: [], subtitles: [] };

      const data = extensionObject.fetchJson('/watch/' + encodeURIComponent(slug) + '?ep=' + encodeURIComponent(episodeNumber) + '&stream=false' + extensionObject.domainQuery());
      const apiSources = (Array.isArray(data.sources) ? data.sources : [])
        .slice()
        .sort((a, b) => extensionObject.sourceRank(a) - extensionObject.sourceRank(b));
      const sources = [];
      const subtitles = [];

      for (const source of apiSources) {
        if (!source || !source.m3u8) continue;
        const sourceSubs = Array.isArray(source.tracks)
          ? source.tracks.map(extensionObject.mapSubtitle).filter(Boolean)
          : [];
        for (const sub of sourceSubs) subtitles.push(sub);
        sources.push({
          url: source.m3u8,
          quality: 'Auto',
          type: 'hls',
          server: source.server || 'Anikoto',
          referrer: source.referer || undefined,
          audio_type: source.type || undefined,
          subtitles: sourceSubs
        });
      }

      return { sources: sources, subtitles: subtitles };
    } catch (error) {
      try { __log('[Anikoto] getSources failed: ' + (error && error.message ? error.message : String(error))); } catch (_) {}
      return { sources: [], subtitles: [] };
    }
  }
};
`
}

export const ANIKOTO_EXTENSION = createAnikotoExtension()
