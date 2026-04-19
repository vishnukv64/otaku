// AllAnime Extension Code
// This will be loaded into the extension system

export const ALLANIME_EXTENSION = `
const extensionObject = {
  id: "com.allanime.source",
  name: "AllAnime",
  version: "1.0.0",
  type: "anime",
  language: "en",
  baseUrl: "https://api.allanime.day",

  // Decode AllAnime's hex-encoded sourceUrl paths.
  //
  // Algorithm: for each hex byte, XOR with 56 (0x38) and cast to ASCII.
  // This is the canonical algorithm used by ani-cli, anipy-cli, and viu.
  // (The previous lookup-map approach silently dropped unmapped bytes,
  //  which broke whenever AllAnime introduced a new char in the path.)
  hexDecode: function(hexString) {
    let decoded = '';
    for (let i = 0; i < hexString.length; i += 2) {
      const byte = parseInt(hexString.substr(i, 2), 16);
      if (isNaN(byte)) continue;
      decoded += String.fromCharCode(byte ^ 56);
    }
    return decoded;
  },

  // Parse an AllAnime API response body, transparently handling the
  // encrypted 'tobeparsed' wrapper when present.
  //
  // Input: raw HTTP response body string from api.allanime.day.
  // Output: normalised JSON object with shape { data: {...} }.
  //
  // AllAnime returns either:
  //   (A) Plaintext: { data: { episode: {...} | shows: {...} | ... } }
  //   (B) Encrypted: { data: { _m: "b7", tobeparsed: "<base64-AES-GCM>" } }
  // For (B), we call the Rust-side decryptor and rewrap so downstream code
  // can keep using data.data.<...> uniformly.
  parseAllanimeBody: function(bodyStr) {
    try {
      const raw = JSON.parse(bodyStr);
      if (raw && raw.data && typeof raw.data.tobeparsed === 'string' && raw.data.tobeparsed.length > 0) {
        try {
          const decryptedJson = __decryptAllanime(raw.data.tobeparsed);
          if (decryptedJson && decryptedJson.length > 0) {
            try { __log('[AllAnime] decrypted tobeparsed: ' + decryptedJson.length + ' bytes'); } catch (_) {}
            return { data: JSON.parse(decryptedJson) };
          }
          try { __log('[AllAnime] __decryptAllanime returned empty'); } catch (_) {}
        } catch (e) {
          try { __log('[AllAnime] tobeparsed decrypt/parse failed: ' + (e && e.message ? e.message : String(e))); } catch (_) {}
        }
      }
      return raw;
    } catch (e) {
      try { __log('[AllAnime] parseAllanimeBody: body not JSON'); } catch (_) {}
      return {};
    }
  },

  // Resolve a decoded /apivtwo/clock path into actual playable URLs by
  // hitting the /clock.json endpoint. Returns an array of VideoSource-shaped
  // objects or an empty array on failure. Never throws.
  //
  // Response shape (from AllAnime /clock.json):
  //   { links: [{ link, hls, resolutionStr, fromCache, subtitles?, headers? }] }
  resolveClockJson: function(decodedPath, serverName) {
    try {
      // Transform "/apivtwo/clock?id=X" -> "/apivtwo/clock.json?id=X".
      // Using string replace of 'clock' -> 'clock.json' matches ani-cli/anipy-cli.
      const jsonPath = decodedPath.replace('/clock', '/clock.json');
      const url = 'https://allanime.day' + (jsonPath.startsWith('/') ? jsonPath : '/' + jsonPath);

      const responseStr = __fetch(url, {
        method: 'GET',
        headers: {
          'Referer': 'https://allmanga.to/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0'
        }
      });

      const response = JSON.parse(responseStr);
      if (response.status !== 200 || !response.body) {
        try { __log('[AllAnime] clock.json non-200: ' + response.status + ' for ' + url); } catch (_) {}
        return [];
      }

      let data;
      try {
        data = JSON.parse(response.body);
      } catch (e) {
        try { __log('[AllAnime] clock.json body not JSON for ' + url); } catch (_) {}
        return [];
      }

      const links = (data && data.links) || [];
      if (!Array.isArray(links) || links.length === 0) {
        try { __log('[AllAnime] clock.json returned no links for ' + serverName); } catch (_) {}
        return [];
      }

      const out = [];
      for (const l of links) {
        if (!l || typeof l.link !== 'string' || l.link.length === 0) continue;

        const isHls = l.hls === true || l.link.toLowerCase().indexOf('.m3u8') !== -1;
        const resolution = l.resolutionStr || 'Auto';

        // WixMP "repackager" URLs embed multiple resolutions in the path,
        // e.g. https://repackager.wixmp.com/.../,720p,1080p,480p,/mp4/file.mp4.urlset/...
        // Split these into individual per-resolution MP4 URLs.
        if (!isHls && l.link.indexOf('repackager.wixmp.com') !== -1 && l.link.indexOf(',/mp4') !== -1) {
          const qualities = extensionObject.expandWixmpUrl(l.link);
          if (qualities.length > 0) {
            for (const q of qualities) {
              out.push({ url: q.url, quality: q.quality, type: 'mp4', server: serverName });
            }
            continue;
          }
        }

        out.push({
          url: l.link,
          quality: resolution,
          type: isHls ? 'hls' : 'mp4',
          server: serverName
        });
      }
      return out;
    } catch (e) {
      try { __log('[AllAnime] resolveClockJson threw: ' + (e && e.message ? e.message : String(e))); } catch (_) {}
      return [];
    }
  },

  // Expand a WixMP repackager URL into individual per-quality MP4 URLs.
  // Input:  https://repackager.wixmp.com/.../,480p,720p,1080p,/mp4/file.mp4.urlset/master.m3u8
  // Output: [{ url: "https://.../720p/mp4/file.mp4", quality: "720p" }, ...]
  expandWixmpUrl: function(url) {
    try {
      const mp4Idx = url.indexOf(',/mp4/');
      if (mp4Idx < 0) return [];
      const urlsetIdx = url.indexOf('.urlset/', mp4Idx);
      if (urlsetIdx < 0) return [];
      const afterMp4 = url.substring(mp4Idx + 6, urlsetIdx);
      const filename = afterMp4.substring(0, afterMp4.lastIndexOf('.'));
      if (!filename) return [];

      let qualitiesStart = url.lastIndexOf('/', mp4Idx - 1);
      if (qualitiesStart < 0) return [];
      const prefix = url.substring(0, qualitiesStart + 1);
      const qualitiesPart = url.substring(qualitiesStart + 1, mp4Idx);
      const qualityList = qualitiesPart.split(',').filter(function(q) { return q.length > 0; });

      const results = [];
      for (const q of qualityList) {
        results.push({
          url: prefix + q + '/mp4/' + filename + '.mp4',
          quality: q
        });
      }
      return results;
    } catch (e) {
      return [];
    }
  },

  search: (query, page) => {
    // Use persisted query for richer data including lastEpisodeDate
    const variables = {
      search: { query: query },
      limit: 26,
      page: page || 1,
      translationType: "sub",
      countryOrigin: "ALL"
    };

    const extensions = {
      persistedQuery: {
        version: 1,
        sha256Hash: "06327bc10dd682e1ee7e07b6db9c16e9ad2fd56c1b769e47513128cd5c9fc77a"
      }
    };

    const url = \`https://api.allanime.day/api?variables=\${encodeURIComponent(JSON.stringify(variables))}&extensions=\${encodeURIComponent(JSON.stringify(extensions))}\`;

    try {
      const responseStr = __fetch(url, {
        method: 'GET',
        headers: {
          'Referer': 'https://allmanga.to',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0'
        }
      });

      const response = JSON.parse(responseStr);
      const data = JSON.parse(response.body);
      const shows = data?.data?.shows?.edges || [];

      // Debug: Log first show to see available fields
      if (shows.length > 0) {
        console.log('[AllAnime] search first show:', JSON.stringify(shows[0], null, 2));
      }

      const results = shows.map(show => {
        // Thumbnail can be a full URL or a path - handle both cases
        let coverUrl = null;
        if (show.thumbnail) {
          if (show.thumbnail.startsWith('http://') || show.thumbnail.startsWith('https://')) {
            coverUrl = show.thumbnail;
          } else {
            coverUrl = \`https://wp.youtube-anime.com/aln.youtube-anime.com/\${show.thumbnail}\`;
          }
        }

        // Extract latest episode info
        const latestEp = show.lastEpisodeInfo?.sub?.episodeString;
        const latestEpDate = show.lastEpisodeDate?.sub;

        return {
          id: show._id,
          title: show.englishName || show.name,
          coverUrl: coverUrl,
          description: show.description || '',
          year: show.season?.year || show.airedStart?.year || null,
          status: show.status || 'Unknown',
          rating: show.score ? parseFloat(show.score) : null,
          latestEpisode: latestEp ? parseInt(latestEp, 10) : null,
          latestEpisodeDate: latestEpDate ? {
            year: latestEpDate.year,
            month: latestEpDate.month,
            date: latestEpDate.date
          } : null,
          availableEpisodes: show.availableEpisodes?.sub || null,
          mediaType: show.type || null,
          genres: show.genres || []
        };
      });

      return { results: results, hasNextPage: shows.length >= 26 };
    } catch (error) {
      console.error('Search failed:', error);
      return { results: [], hasNextPage: false };
    }
  },

  discover: (page, sortType, genres) => {
    // If genres are provided, use the persisted query with genre search
    if (genres && genres.length > 0) {
      const variables = {
        search: { genres: genres },
        limit: 26,
        page: page || 1,
        translationType: "sub",
        countryOrigin: "ALL"
      };

      const extensions = {
        persistedQuery: {
          version: 1,
          sha256Hash: "06327bc10dd682e1ee7e07b6db9c16e9ad2fd56c1b769e47513128cd5c9fc77a"
        }
      };

      const url = \`https://api.allanime.day/api?variables=\${encodeURIComponent(JSON.stringify(variables))}&extensions=\${encodeURIComponent(JSON.stringify(extensions))}\`;

      try {
        const responseStr = __fetch(url, {
          method: 'GET',
          headers: {
            'Referer': 'https://allmanga.to',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0'
          }
        });

        const response = JSON.parse(responseStr);
        const data = JSON.parse(response.body);
        const shows = data?.data?.shows?.edges || [];

        const results = shows.map(show => {
          let coverUrl = null;
          if (show.thumbnail) {
            if (show.thumbnail.startsWith('http://') || show.thumbnail.startsWith('https://')) {
              coverUrl = show.thumbnail;
            } else {
              coverUrl = \`https://wp.youtube-anime.com/aln.youtube-anime.com/\${show.thumbnail}\`;
            }
          }

          const latestEp = show.lastEpisodeInfo?.sub?.episodeString;
          const latestEpDate = show.lastEpisodeDate?.sub;

          return {
            id: show._id,
            title: show.englishName || show.name,
            coverUrl: coverUrl,
            description: show.description || '',
            year: show.season?.year || show.airedStart?.year || null,
            status: show.status || 'Unknown',
            rating: show.score ? parseFloat(show.score) : null,
            latestEpisode: latestEp ? parseInt(latestEp, 10) : null,
            latestEpisodeDate: latestEpDate ? {
              year: latestEpDate.year,
              month: latestEpDate.month,
              date: latestEpDate.date
            } : null,
            availableEpisodes: show.availableEpisodes?.sub || null,
            mediaType: show.type || null,
            genres: show.genres || []
          };
        });

        return { results: results, hasNextPage: shows.length >= 26 };
      } catch (error) {
        console.error('Genre filter failed:', error);
        return { results: [], hasNextPage: false };
      }
    }

    // Use the persisted query for popular anime (queryPopular)
    // For 'score' sortType: use dateRange 30 to get monthly popular, then sort by score
    // For other sortTypes: use dateRange 1 for daily trending
    const dateRange = sortType === 'score' ? 30 : 1;

    const variables = {
      type: "anime",
      size: 20,
      dateRange: dateRange,
      page: page || 1,
      allowAdult: typeof __allowAdult !== 'undefined' ? __allowAdult : false,
      allowUnknown: false
    };

    const extensions = {
      persistedQuery: {
        version: 1,
        sha256Hash: "1fc9651b0d4c3b9dfd2fa6e1d50b8f4d11ce37f988c23b8ee20f82159f7c1147"
      }
    };

    const url = \`https://api.allanime.day/api?variables=\${encodeURIComponent(JSON.stringify(variables))}&extensions=\${encodeURIComponent(JSON.stringify(extensions))}\`;

    try {
      const responseStr = __fetch(url, {
        method: 'GET',
        headers: {
          'Referer': 'https://allmanga.to',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0'
        }
      });

      const response = JSON.parse(responseStr);
      const data = JSON.parse(response.body);
      const recommendations = data?.data?.queryPopular?.recommendations || [];

      // Debug: Log first recommendation to see available fields
      if (recommendations.length > 0) {
        console.log('[AllAnime] queryPopular first anyCard:', JSON.stringify(recommendations[0].anyCard, null, 2));
      }

      let results = recommendations.map((rec) => {
        const show = rec.anyCard;

        let coverUrl = null;
        if (show.thumbnail) {
          if (show.thumbnail.startsWith('http://') || show.thumbnail.startsWith('https://')) {
            coverUrl = show.thumbnail;
          } else {
            coverUrl = \`https://wp.youtube-anime.com/aln.youtube-anime.com/\${show.thumbnail}\`;
          }
        }

        // Extract latest episode info if available
        const latestEp = show.lastEpisodeInfo?.sub?.episodeString;
        const latestEpDate = show.lastEpisodeDate?.sub;

        return {
          id: show._id,
          title: show.englishName || show.name,
          coverUrl: coverUrl,
          description: show.description || '',
          year: show.airedStart?.year || null,
          status: show.status || 'Unknown',
          rating: show.score ? parseFloat(show.score) : null,
          latestEpisode: latestEp ? parseInt(latestEp, 10) : null,
          latestEpisodeDate: latestEpDate ? {
            year: latestEpDate.year,
            month: latestEpDate.month,
            date: latestEpDate.date
          } : null,
          availableEpisodes: show.availableEpisodes?.sub || null,
          mediaType: show.type || null,
          genres: show.genres || []
        };
      });

      // For 'score' sortType, sort results by rating (highest first)
      if (sortType === 'score') {
        results = results.sort((a, b) => {
          const ratingA = a.rating || 0;
          const ratingB = b.rating || 0;
          return ratingB - ratingA;
        });
      }

      return {
        results: results,
        hasNextPage: recommendations.length >= 20
      };
    } catch (error) {
      console.error('Discover failed:', error);
      return {
        results: [],
        hasNextPage: false
      };
    }
  },

  // Get anime from current season (Winter/Spring/Summer/Fall + year)
  getCurrentSeason: (page) => {
    // Calculate current season based on month
    const now = new Date();
    const month = now.getMonth();
    const year = now.getFullYear();

    let season;
    if (month >= 0 && month <= 2) season = 'Winter';
    else if (month >= 3 && month <= 5) season = 'Spring';
    else if (month >= 6 && month <= 8) season = 'Summer';
    else season = 'Fall';

    const variables = {
      search: { season: season, year: year },
      limit: 26,
      page: page || 1,
      translationType: "sub",
      countryOrigin: "ALL"
    };

    const extensions = {
      persistedQuery: {
        version: 1,
        sha256Hash: "06327bc10dd682e1ee7e07b6db9c16e9ad2fd56c1b769e47513128cd5c9fc77a"
      }
    };

    const url = \`https://api.allanime.day/api?variables=\${encodeURIComponent(JSON.stringify(variables))}&extensions=\${encodeURIComponent(JSON.stringify(extensions))}\`;

    try {
      const responseStr = __fetch(url, {
        method: 'GET',
        headers: {
          'Referer': 'https://allmanga.to',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0'
        }
      });

      const response = JSON.parse(responseStr);
      const data = JSON.parse(response.body);
      const shows = data?.data?.shows?.edges || [];

      // Debug: Log first show to see available fields for current season
      if (shows.length > 0) {
        console.log('[AllAnime] getCurrentSeason first show:', JSON.stringify(shows[0], null, 2));
      }

      const results = shows.map(show => {
        let coverUrl = null;
        if (show.thumbnail) {
          if (show.thumbnail.startsWith('http://') || show.thumbnail.startsWith('https://')) {
            coverUrl = show.thumbnail;
          } else {
            coverUrl = \`https://wp.youtube-anime.com/aln.youtube-anime.com/\${show.thumbnail}\`;
          }
        }

        const latestEp = show.lastEpisodeInfo?.sub?.episodeString;
        const latestEpDate = show.lastEpisodeDate?.sub;

        return {
          id: show._id,
          title: show.englishName || show.name,
          coverUrl: coverUrl,
          description: show.description || '',
          year: show.season?.year || show.airedStart?.year || null,
          status: show.status || 'Unknown',
          rating: show.score ? parseFloat(show.score) : null,
          latestEpisode: latestEp ? parseInt(latestEp, 10) : null,
          latestEpisodeDate: latestEpDate ? {
            year: latestEpDate.year,
            month: latestEpDate.month,
            date: latestEpDate.date
          } : null,
          availableEpisodes: show.availableEpisodes?.sub || null,
          mediaType: show.type || null,
          genres: show.genres || []
        };
      });

      return {
        results: results,
        hasNextPage: shows.length >= 26,
        season: season,
        year: year
      };
    } catch (error) {
      console.error('Get current season failed:', error);
      return { results: [], hasNextPage: false, season: season, year: year };
    }
  },

  getDetails: (id) => {
    // Use persisted query for more complete data
    // Include allowAdult setting to ensure adult content is accessible when NSFW filter is disabled
    const allowAdult = typeof __allowAdult !== 'undefined' ? __allowAdult : false;

    const variables = {
      _id: id,
      search: {
        allowAdult: allowAdult,
        allowUnknown: false
      }
    };
    const extensions = {
      persistedQuery: {
        version: 1,
        sha256Hash: "9d7439c90f203e534ca778c4901f9aa2d3ad42c06243ab2c5e6b79612af32028"
      }
    };

    console.log('[AllAnime] getDetails for ID:', id, 'allowAdult:', allowAdult);

    const url = \`https://api.allanime.day/api?variables=\${encodeURIComponent(JSON.stringify(variables))}&extensions=\${encodeURIComponent(JSON.stringify(extensions))}\`;

    try {
      const responseStr = __fetch(url, {
        method: 'GET',
        headers: {
          'Referer': 'https://allmanga.to',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0'
        }
      });

      const response = JSON.parse(responseStr);
      const data = JSON.parse(response.body);
      const show = data?.data?.show;

      if (!show) {
        // Log the actual response for debugging
        console.error('[AllAnime] getDetails failed - show is null/undefined');
        console.error('[AllAnime] Request ID:', id, 'allowAdult:', allowAdult);
        console.error('[AllAnime] Response status:', response.status);
        console.error('[AllAnime] Response errors:', data?.errors);
        throw new Error(allowAdult ? 'Anime not found' : 'Anime not found (may be adult content - try disabling NSFW filter)');
      }

      // Parse available episodes - persisted query returns different structure
      let subEpisodes = [];
      if (show.availableEpisodesDetail && show.availableEpisodesDetail.sub) {
        subEpisodes = show.availableEpisodesDetail.sub;
      } else if (show.availableEpisodes && show.availableEpisodes.sub) {
        const count = show.availableEpisodes.sub;
        subEpisodes = Array.from({ length: count }, (_, i) => String(i + 1));
      }

      // Handle thumbnail URL (can be full URL or path)
      let coverUrl = null;
      if (show.thumbnail) {
        if (show.thumbnail.startsWith('http://') || show.thumbnail.startsWith('https://')) {
          coverUrl = show.thumbnail;
        } else {
          coverUrl = \`https://wp.youtube-anime.com/aln.youtube-anime.com/\${show.thumbnail}\`;
        }
      }

      const episodes = subEpisodes.map(epNum => ({
        id: \`\${id}::\${epNum}\`,
        number: parseFloat(epNum),
        title: \`Episode \${epNum}\`,
        thumbnail: coverUrl
      }));

      // Sort episodes by number (ascending)
      episodes.sort((a, b) => a.number - b.number);

      // Log the specific fields we're interested in
      console.log('lastUpdateEnd:', show.lastUpdateEnd);
      console.log('broadcastInterval:', show.broadcastInterval);

      // Parse numeric fields with validation to prevent NaN values
      const episodeDuration = show.episodeDuration ? parseInt(show.episodeDuration, 10) : null;
      const episodeCount = show.episodeCount ? parseInt(show.episodeCount, 10) : null;
      const broadcastInterval = show.broadcastInterval ? parseInt(show.broadcastInterval, 10) : null;

      // Extract all valid YouTube video IDs from prevideos
      // Store them as comma-separated string so HeroSection can try each one
      let trailerVideoIds = null;
      if (show.prevideos && show.prevideos.length > 0) {
        const validIds = show.prevideos.filter(videoId =>
          typeof videoId === 'string' &&
          videoId.length === 11 &&
          /^[a-zA-Z0-9_-]+$/.test(videoId)
        );
        if (validIds.length > 0) {
          trailerVideoIds = validIds.join(',');
        }
      }

      return {
        id: show._id,
        title: show.name,
        english_name: show.englishName || null,
        native_name: show.nativeName || null,
        coverUrl: coverUrl,
        trailer_url: trailerVideoIds,
        description: show.description || 'No description available',
        genres: show.genres || [],
        status: show.status || 'Unknown',
        year: show.season?.year || null,
        rating: show.score ? parseFloat(show.score) : null,
        episodes: episodes,
        type: show.type || null,
        season: show.season ? {
          quarter: show.season.quarter || null,
          year: show.season.year || null
        } : null,
        episode_duration: (episodeDuration !== null && !isNaN(episodeDuration)) ? episodeDuration : null,
        episode_count: (episodeCount !== null && !isNaN(episodeCount)) ? episodeCount : null,
        aired_start: show.airedStart || null,
        last_update_end: show.lastUpdateEnd || null,
        broadcast_interval: (broadcastInterval !== null && !isNaN(broadcastInterval)) ? broadcastInterval : null
      };
    } catch (error) {
      console.error('Failed to get details:', error);
      throw error;
    }
  },

  getSources: (episodeId) => {
    try {
      try { __log('[AllAnime] getSources ENTER: ' + String(episodeId)); } catch (_) {}

      if (typeof episodeId !== 'string' || episodeId.length === 0) {
        try { __log('[AllAnime] getSources: invalid episodeId (type=' + typeof episodeId + ')'); } catch (_) {}
        return { sources: [], subtitles: [] };
      }

      const parts = episodeId.split('::');
      const showId = parts[0];
      const episodeString = parts[1];
      if (!showId || !episodeString) {
        try { __log('[AllAnime] getSources: malformed episodeId (missing showId or episodeString): ' + episodeId); } catch (_) {}
        return { sources: [], subtitles: [] };
      }

      const sourcesQuery = \`query($showId: String! $translationType: VaildTranslationTypeEnumType! $episodeString: String!) { episode(showId: $showId translationType: $translationType episodeString: $episodeString) { episodeString sourceUrls } }\`;

      const variables = { showId: showId, translationType: "sub", episodeString: episodeString };
      const url = \`https://api.allanime.day/api?variables=\${encodeURIComponent(JSON.stringify(variables))}&query=\${encodeURIComponent(sourcesQuery)}\`;

      const responseStr = __fetch(url, {
        method: 'GET',
        headers: {
          'Referer': 'https://allmanga.to',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0'
        }
      });

      const response = JSON.parse(responseStr);
      const data = extensionObject.parseAllanimeBody(response.body);
      const sourceUrls = data?.data?.episode?.sourceUrls || [];

      // Preferred streamers (by reliability/quality). Sources from these providers
      // are tried first; anything else is tried as a fallback.
      // Matches the priority list used by ani-cli and anipy-cli.
      const preferredStreamers = ['Default', 'Yt-mp4', 'S-mp4', 'Luf-mp4', 'Sak', 'Kir', 'Ak'];
      const streamerRank = (name) => {
        const idx = preferredStreamers.indexOf(name || '');
        return idx === -1 ? 999 : idx;
      };

      const sorted = sourceUrls.slice().sort((a, b) => {
        const ra = streamerRank(a.sourceName);
        const rb = streamerRank(b.sourceName);
        if (ra !== rb) return ra - rb;
        return (b.priority || 0) - (a.priority || 0);
      });

      try { __log('[AllAnime] getSources: ' + showId + '/' + episodeString + ' got ' + sorted.length + ' providers: ' + sorted.map(s => s.sourceName).join(',')); } catch (_) {}

      const sources = [];
      const subtitles = [];

      for (const source of sorted) {
        if (!source || !source.sourceUrl) {
          try { __log('[AllAnime] skip (no sourceUrl): ' + (source && source.sourceName)); } catch (_) {}
          continue;
        }

        if (source.sourceUrl.startsWith('--')) {
          const decodedPath = extensionObject.hexDecode(source.sourceUrl.substring(2));
          if (!decodedPath) {
            try { __log('[AllAnime] skip (hex decode empty): ' + source.sourceName); } catch (_) {}
            continue;
          }

          if (decodedPath.indexOf('/apivtwo/clock') !== -1) {
            const resolved = extensionObject.resolveClockJson(decodedPath, source.sourceName || 'Server');
            if (resolved.length === 0) {
              try { __log('[AllAnime] clock.json returned 0 links: ' + source.sourceName); } catch (_) {}
              continue;
            }
            for (const r of resolved) sources.push(r);
            continue;
          }

          const directUrl = (decodedPath.startsWith('http://') || decodedPath.startsWith('https://'))
            ? decodedPath
            : 'https://allanime.day' + (decodedPath.startsWith('/') ? decodedPath : '/' + decodedPath);

          sources.push({
            url: directUrl,
            quality: source.sourceName || 'Auto',
            type: directUrl.toLowerCase().indexOf('.m3u8') !== -1 ? 'hls' : 'mp4',
            server: source.sourceName || 'Server'
          });
          continue;
        }

        if (source.sourceUrl.startsWith('http://') || source.sourceUrl.startsWith('https://')) {
          if (source.type === 'iframe') {
            try { __log('[AllAnime] skip (iframe embed, not directly playable): ' + source.sourceName); } catch (_) {}
            continue;
          }

          sources.push({
            url: source.sourceUrl,
            quality: source.sourceName || 'Default',
            type: source.sourceUrl.toLowerCase().indexOf('.m3u8') !== -1 ? 'hls' : 'mp4',
            server: source.sourceName || 'Direct'
          });
          continue;
        }

        try { __log('[AllAnime] skip (unrecognized sourceUrl format): ' + source.sourceName + ' = ' + source.sourceUrl.substring(0, 40)); } catch (_) {}
      }

      try { __log('[AllAnime] getSources: resolved ' + sources.length + ' playable sources'); } catch (_) {}

      return { sources: sources, subtitles: subtitles };
    } catch (error) {
      try { __log('[AllAnime] getSources threw: ' + (error && error.message ? error.message : String(error))); } catch (_) {}
      return { sources: [], subtitles: [] };
    }
  },

  getRecommendations: () => {
    const today = new Date();
    const dateStr = today.getFullYear().toString() +
                    (today.getMonth()).toString().padStart(2, '0') +
                    today.getDate().toString().padStart(2, '0');

    const variables = {
      pageSearch: {
        type: "anime",
        allowSameShow: true,
        page: 1,
        allowAdult: typeof __allowAdult !== 'undefined' ? __allowAdult : false,
        allowUnknown: false,
        dateAgo: parseInt(dateStr)
      }
    };

    const extensions = {
      persistedQuery: {
        version: 1,
        sha256Hash: "45167ede14941284b6ffe7c1b8dd81f56a197f600e48c2c92e256c489f1563d5"
      }
    };

    const url = \`https://api.allanime.day/api?variables=\${encodeURIComponent(JSON.stringify(variables))}&extensions=\${encodeURIComponent(JSON.stringify(extensions))}\`;

    try {
      const responseStr = __fetch(url, {
        method: 'GET',
        headers: {
          'Referer': 'https://allmanga.to',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0'
        }
      });

      const response = JSON.parse(responseStr);
      const data = JSON.parse(response.body);
      const recommendations = data?.data?.queryLatestPageStatus?.recommendations || [];

      const results = recommendations.map(rec => {
        const show = rec.anyCard;

        // Handle thumbnail URL
        let coverUrl = null;
        if (show.thumbnail) {
          if (show.thumbnail.startsWith('http://') || show.thumbnail.startsWith('https://')) {
            coverUrl = show.thumbnail;
          } else {
            coverUrl = \`https://wp.youtube-anime.com/aln.youtube-anime.com/\${show.thumbnail}\`;
          }
        }

        return {
          id: show._id,
          title: show.englishName || show.name,
          coverUrl: coverUrl,
          description: '',
          year: show.airedStart?.year || null,
          status: null,
          rating: null
        };
      });

      return { results: results.slice(0, 20), hasNextPage: false };
    } catch (error) {
      console.error('Failed to get recommendations:', error);
      return { results: [], hasNextPage: false };
    }
  },

  // Get recently updated anime (sorted by most recent episode releases)
  getRecentlyUpdated: (page) => {
    const variables = {
      search: { sortBy: "Recent" },
      limit: 26,
      page: page || 1,
      translationType: "sub",
      countryOrigin: "ALL"
    };

    const extensions = {
      persistedQuery: {
        version: 1,
        sha256Hash: "06327bc10dd682e1ee7e07b6db9c16e9ad2fd56c1b769e47513128cd5c9fc77a"
      }
    };

    const url = \`https://api.allanime.day/api?variables=\${encodeURIComponent(JSON.stringify(variables))}&extensions=\${encodeURIComponent(JSON.stringify(extensions))}\`;

    try {
      const responseStr = __fetch(url, {
        method: 'GET',
        headers: {
          'Referer': 'https://allmanga.to',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0'
        }
      });

      const response = JSON.parse(responseStr);
      const data = JSON.parse(response.body);
      const shows = data?.data?.shows?.edges || [];

      // Debug: Log first show to see available fields
      if (shows.length > 0) {
        console.log('[AllAnime] getRecentlyUpdated first show:', JSON.stringify(shows[0], null, 2));
      }

      const results = shows.map(show => {
        let coverUrl = null;
        if (show.thumbnail) {
          if (show.thumbnail.startsWith('http://') || show.thumbnail.startsWith('https://')) {
            coverUrl = show.thumbnail;
          } else {
            coverUrl = \`https://wp.youtube-anime.com/aln.youtube-anime.com/\${show.thumbnail}\`;
          }
        }

        const latestEp = show.lastEpisodeInfo?.sub?.episodeString;
        const latestEpDate = show.lastEpisodeDate?.sub;

        return {
          id: show._id,
          title: show.englishName || show.name,
          coverUrl: coverUrl,
          description: show.description || '',
          year: show.season?.year || show.airedStart?.year || null,
          status: show.status || 'Releasing',
          rating: show.score ? parseFloat(show.score) : null,
          latestEpisode: latestEp ? parseInt(latestEp, 10) : null,
          latestEpisodeDate: latestEpDate ? {
            year: latestEpDate.year,
            month: latestEpDate.month,
            date: latestEpDate.date
          } : null,
          availableEpisodes: show.availableEpisodes?.sub || null,
          mediaType: show.type || null,
          genres: show.genres || []
        };
      });

      return { results: results, hasNextPage: shows.length >= 26 };
    } catch (error) {
      console.error('Get recently updated failed:', error);
      return { results: [], hasNextPage: false };
    }
  },

  getTags: (page) => {
    const variables = {
      search: { format: "anime" },
      page: page || 1,
      limit: 50
    };

    const extensions = {
      persistedQuery: {
        version: 1,
        sha256Hash: "fbd24de3aec73d35332185b621beec15396aaf8e8ae00183ddac6c19fbf8adcf"
      }
    };

    const url = \`https://api.allanime.day/api?variables=\${encodeURIComponent(JSON.stringify(variables))}&extensions=\${encodeURIComponent(JSON.stringify(extensions))}\`;

    try {
      const responseStr = __fetch(url, {
        method: 'GET',
        headers: {
          'Referer': 'https://allmanga.to',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0'
        }
      });

      const response = JSON.parse(responseStr);
      const data = JSON.parse(response.body);
      const edges = data?.data?.queryTags?.edges || [];

      const genres = [];
      const studios = [];

      edges.forEach(tag => {
        const item = {
          name: tag.name,
          slug: tag.slug,
          count: tag.animeCount || 0,
          thumbnail: tag.sampleAnime?.thumbnail || null
        };

        if (tag.tagType === 'studio') {
          studios.push(item);
        } else {
          genres.push(item);
        }
      });

      // Sort by anime count (descending)
      genres.sort((a, b) => b.count - a.count);
      studios.sort((a, b) => b.count - a.count);

      return {
        genres: genres,
        studios: studios,
        hasNextPage: edges.length >= 50
      };
    } catch (error) {
      console.error('Failed to get tags:', error);
      return { genres: [], studios: [], hasNextPage: false };
    }
  }
};
`
