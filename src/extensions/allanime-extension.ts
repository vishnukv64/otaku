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

  hexDecode: function(hexString) {
    const decodeMap = {
      '79': 'A', '7a': 'B', '7b': 'C', '7c': 'D', '7d': 'E', '7e': 'F', '7f': 'G',
      '70': 'H', '71': 'I', '72': 'J', '73': 'K', '74': 'L', '75': 'M', '76': 'N',
      '77': 'O', '68': 'P', '69': 'Q', '6a': 'R', '6b': 'S', '6c': 'T', '6d': 'U',
      '6e': 'V', '6f': 'W', '60': 'X', '61': 'Y', '62': 'Z', '59': 'a', '5a': 'b',
      '5b': 'c', '5c': 'd', '5d': 'e', '5e': 'f', '5f': 'g', '50': 'h', '51': 'i',
      '52': 'j', '53': 'k', '54': 'l', '55': 'm', '56': 'n', '57': 'o', '48': 'p',
      '49': 'q', '4a': 'r', '4b': 's', '4c': 't', '4d': 'u', '4e': 'v', '4f': 'w',
      '40': 'x', '41': 'y', '42': 'z', '08': '0', '09': '1', '0a': '2', '0b': '3',
      '0c': '4', '0d': '5', '0e': '6', '0f': '7', '00': '8', '01': '9', '15': '-',
      '16': '.', '67': '_', '46': '~', '02': ':', '17': '/', '07': '?', '1b': '#',
      '63': '[', '65': ']', '78': '@', '19': '!', '1c': '$', '1e': '&', '10': '(',
      '11': ')', '12': '*', '13': '+', '14': ',', '03': ';', '05': '=', '1d': '%'
    };

    let decoded = '';
    for (let i = 0; i < hexString.length; i += 2) {
      const hexPair = hexString.substr(i, 2);
      decoded += decodeMap[hexPair] || '';
    }
    return decoded;
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
    const parts = episodeId.split('::');
    const showId = parts[0];
    const episodeString = parts[1];

    const sourcesQuery = \`query($showId: String! $translationType: VaildTranslationTypeEnumType! $episodeString: String!) { episode(showId: $showId translationType: $translationType episodeString: $episodeString) { episodeString sourceUrls } }\`;

    const variables = { showId: showId, translationType: "sub", episodeString: episodeString };
    const url = \`https://api.allanime.day/api?variables=\${encodeURIComponent(JSON.stringify(variables))}&query=\${encodeURIComponent(sourcesQuery)}\`;

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
      const sourceUrls = data?.data?.episode?.sourceUrls || [];
      const sources = [];

      // Sort sources by priority (higher priority first)
      const sortedSources = sourceUrls.sort((a, b) => (b.priority || 0) - (a.priority || 0));

      for (const source of sortedSources) {
        if (!source.sourceUrl) continue;

        // Skip download URLs for now - they return HTML player pages, not JSON
        // We'll rely on the hex-encoded sourceUrls instead

        // Handle hex-encoded sourceUrls (starting with --)
        if (source.sourceUrl.startsWith('--')) {
          const hexPart = source.sourceUrl.substring(2);
          const decodedPath = extensionObject.hexDecode(hexPart);

          // Check if decoded path is already a full URL or a relative path
          let baseUrl;
          if (decodedPath.startsWith('http://') || decodedPath.startsWith('https://')) {
            // Already a complete URL - use it directly (keep double slashes intact!)
            baseUrl = decodedPath;
          } else {
            // Relative path - prepend base URL
            baseUrl = 'https://blog.allanime.day' + (decodedPath.startsWith('/') ? decodedPath : '/' + decodedPath);
          }

          // Skip /apivtwo/clock URLs - they consistently return 404
          if (baseUrl.includes('/apivtwo/clock')) {
            continue;
          }

          sources.push({
            url: baseUrl,
            quality: source.sourceName || 'Auto',
            type: 'hls',
            server: source.sourceName || 'Server'
          });
        }
        // Handle plain URL sources (already decoded)
        else if (source.sourceUrl.startsWith('http://') || source.sourceUrl.startsWith('https://')) {
          // Skip iframe embeds - they're not direct video URLs
          if (source.type === 'iframe') {
            continue;
          }

          sources.push({
            url: source.sourceUrl,
            quality: source.sourceName || 'Default',
            type: 'hls',
            server: source.sourceName || 'Direct'
          });
        }
      }

      return {
        sources: sources.length > 0 ? sources : [{ url: '', quality: 'No sources', type: 'hls', server: 'None' }],
        subtitles: []
      };
    } catch (error) {
      console.error('Failed to get sources:', error);
      return { sources: [{ url: '', quality: 'Error', type: 'hls', server: 'Error' }], subtitles: [] };
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
