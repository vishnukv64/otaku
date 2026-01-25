/**
 * AllAnime Extension
 *
 * Real anime source using AllAnime GraphQL API
 * Based on ani-cli implementation
 */

const extensionObject = {
  id: "com.allanime.source",
  name: "AllAnime",
  version: "1.0.0",
  type: "anime",
  language: "en",
  baseUrl: "https://api.allanime.day",

  // Helper: Hex decode for provider URLs (from ani-cli)
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

  /**
   * Search for anime
   */
  search: (query, page) => {
    const searchQuery = `
      query(
        $search: SearchInput
        $limit: Int
        $page: Int
        $translationType: VaildTranslationTypeEnumType
        $countryOrigin: VaildCountryOriginEnumType
      ) {
        shows(
          search: $search
          limit: $limit
          page: $page
          translationType: $translationType
          countryOrigin: $countryOrigin
        ) {
          edges {
            _id
            name
            thumbnail
            availableEpisodes
            description
            status
            score
            season
            __typename
          }
        }
      }
    `;

    const variables = {
      search: {
        allowAdult: false,
        allowUnknown: false,
        query: query
      },
      limit: 40,
      page: page,
      translationType: "sub",
      countryOrigin: "ALL"
    };

    const url = `https://api.allanime.day/api?variables=${encodeURIComponent(JSON.stringify(variables))}&query=${encodeURIComponent(searchQuery)}`;

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
        // Thumbnail can be a full URL or a path - handle both cases
        let coverUrl = null;
        if (show.thumbnail) {
          if (show.thumbnail.startsWith('http://') || show.thumbnail.startsWith('https://')) {
            coverUrl = show.thumbnail;
          } else {
            coverUrl = `https://wp.youtube-anime.com/aln.youtube-anime.com/${show.thumbnail}`;
          }
        }

        return {
          id: show._id,
          title: show.name,
          coverUrl: coverUrl,
          description: show.description || '',
          year: show.season?.year || null,
          status: show.status || 'Unknown',
          rating: show.score ? parseFloat(show.score) : null
        };
      });

      return {
        results: results,
        hasNextPage: shows.length >= 40
      };
    } catch (error) {
      console.error('Search failed:', error);
      return {
        results: [],
        hasNextPage: false
      };
    }
  },

  /**
   * Discover anime with filters
   * Uses AllAnime's persisted query for popular anime
   */
  discover: (page, sortType, genres) => {
    // Use the persisted query for popular anime (queryPopular)
    // dateRange: 1 = daily (trending/recently updated), 30 = monthly (top rated)
    const dateRange = sortType === 'score' ? 30 : 1;

    const variables = {
      type: "anime",
      size: 20,
      dateRange: dateRange,
      page: page || 1,
      allowAdult: false,
      allowUnknown: false
    };

    const extensions = {
      persistedQuery: {
        version: 1,
        sha256Hash: "1fc9651b0d4c3b9dfd2fa6e1d50b8f4d11ce37f988c23b8ee20f82159f7c1147"
      }
    };

    const url = `https://api.allanime.day/api?variables=${encodeURIComponent(JSON.stringify(variables))}&extensions=${encodeURIComponent(JSON.stringify(extensions))}`;

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

      // Debug: log first result to see what fields are available
      if (recommendations.length > 0) {
        console.log('First anyCard:', JSON.stringify(recommendations[0].anyCard, null, 2));
      }

      const results = recommendations.map((rec, index) => {
        const show = rec.anyCard;

        // Debug: log available fields for first item
        if (index === 0) {
          console.log('Available show fields:', Object.keys(show));
          console.log('show.score:', show.score);
          console.log('show.status:', show.status);
          console.log('show.airedStart:', JSON.stringify(show.airedStart));
          console.log('show.season:', JSON.stringify(show.season));
          console.log('show.availableEpisodes:', show.availableEpisodes);
        }

        // Thumbnail can be a full URL or a path - handle both cases
        let coverUrl = null;
        if (show.thumbnail) {
          if (show.thumbnail.startsWith('http://') || show.thumbnail.startsWith('https://')) {
            coverUrl = show.thumbnail;
          } else {
            coverUrl = `https://wp.youtube-anime.com/aln.youtube-anime.com/${show.thumbnail}`;
          }
        }

        return {
          id: show._id,
          title: show.englishName || show.name,
          coverUrl: coverUrl,
          description: show.description || '',
          year: show.airedStart?.year || null,
          status: show.status || 'Unknown',
          rating: show.score ? parseFloat(show.score) : null
        };
      });

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

  /**
   * Get detailed anime information
   */
  getDetails: (id) => {
    // First get episode list
    const episodesQuery = `
      query ($showId: String!) {
        show(_id: $showId) {
          _id
          name
          thumbnail
          description
          status
          score
          season
          availableEpisodes
          availableEpisodesDetail
        }
      }
    `;

    const variables = { showId: id };
    const url = `https://api.allanime.day/api?variables=${encodeURIComponent(JSON.stringify(variables))}&query=${encodeURIComponent(episodesQuery)}`;

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
        throw new Error('Anime not found');
      }

      // Parse available episodes (sub episodes from availableEpisodesDetail)
      const episodeDetail = show.availableEpisodesDetail || {};
      const subEpisodes = episodeDetail.sub || [];

      // Handle thumbnail URL (can be full URL or path)
      let coverUrl = null;
      if (show.thumbnail) {
        if (show.thumbnail.startsWith('http://') || show.thumbnail.startsWith('https://')) {
          coverUrl = show.thumbnail;
        } else {
          coverUrl = `https://wp.youtube-anime.com/aln.youtube-anime.com/${show.thumbnail}`;
        }
      }

      const episodes = subEpisodes.map(epNum => ({
        id: `${id}-${epNum}`,
        number: parseFloat(epNum),
        title: `Episode ${epNum}`,
        thumbnail: coverUrl
      }));

      return {
        id: show._id,
        title: show.name,
        coverUrl: coverUrl,
        description: show.description || 'No description available',
        genres: [],
        status: show.status || 'Unknown',
        year: show.season?.year || null,
        rating: show.score ? parseFloat(show.score) : null,
        episodes: episodes
      };
    } catch (error) {
      console.error('Failed to get details:', error);
      throw error;
    }
  },

  /**
   * Get video sources for an episode
   */
  getSources: (episodeId) => {
    // Parse episodeId format: "animeId-episodeNumber"
    const parts = episodeId.split('-');
    const showId = parts.slice(0, -1).join('-');
    const episodeString = parts[parts.length - 1];

    const sourcesQuery = `
      query(
        $showId: String!
        $translationType: VaildTranslationTypeEnumType!
        $episodeString: String!
      ) {
        episode(
          showId: $showId
          translationType: $translationType
          episodeString: $episodeString
        ) {
          episodeString
          sourceUrls
        }
      }
    `;

    const variables = {
      showId: showId,
      translationType: "sub",
      episodeString: episodeString
    };

    const url = `https://api.allanime.day/api?variables=${encodeURIComponent(JSON.stringify(variables))}&query=${encodeURIComponent(sourcesQuery)}`;

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

      // Process each source
      for (const source of sourceUrls) {
        if (source.sourceUrl) {
          const decodedUrl = extensionObject.hexDecode(source.sourceUrl);

          // Add clock.json endpoint for provider URLs
          const providerUrl = decodedUrl.includes('--')
            ? decodedUrl.split('--')[0] + '/clock.json'
            : decodedUrl + '/clock.json';

          sources.push({
            url: providerUrl,
            quality: source.sourceName || 'Default',
            type: 'hls'
          });
        }
      }

      return {
        sources: sources.length > 0 ? sources : [
          {
            url: 'https://example.com/fallback.m3u8',
            quality: 'No sources available',
            type: 'hls'
          }
        ],
        subtitles: []
      };
    } catch (error) {
      console.error('Failed to get sources:', error);
      return {
        sources: [{
          url: 'https://example.com/error.m3u8',
          quality: 'Error',
          type: 'hls'
        }],
        subtitles: []
      };
    }
  }
};
