// AllAnime Manga Extension Code
// This will be loaded into the extension system for manga

export const ALLANIME_MANGA_EXTENSION = `
const extensionObject = {
  id: "com.allanime.manga",
  name: "AllAnime Manga",
  version: "1.0.0",
  type: "manga",
  language: "en",
  baseUrl: "https://api.allanime.day",

  search: (query, page) => {
    // Use the correct manga search query hash
    const variables = {
      search: {
        query: query,
        isManga: true
      },
      limit: 26,
      page: page || 1,
      translationType: "sub",
      countryOrigin: "ALL"
    };

    const extensions = {
      persistedQuery: {
        version: 1,
        sha256Hash: "3a4b7e9ef62953484a05dd40f35b35b118ad2ff3d5e72d2add79bcaa663271e7"
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
      const mangas = data?.data?.mangas?.edges || [];

      const results = mangas.map(manga => {
        let coverUrl = null;
        if (manga.thumbnail) {
          if (manga.thumbnail.startsWith('http://') || manga.thumbnail.startsWith('https://')) {
            coverUrl = manga.thumbnail;
          } else {
            coverUrl = \`https://wp.youtube-anime.com/aln.youtube-anime.com/\${manga.thumbnail}\`;
          }
        }

        return {
          id: manga._id,
          title: manga.englishName || manga.name,
          coverUrl: coverUrl,
          description: manga.description || '',
          year: manga.airedStart?.year || null,
          status: manga.status || 'Unknown',
          rating: manga.score ? parseFloat(manga.score) : null,
          genres: manga.genres || []
        };
      });

      return { results: results, hasNextPage: mangas.length >= 26 };
    } catch (error) {
      console.error('Manga search failed:', error);
      return { results: [], hasNextPage: false };
    }
  },

  discover: (page, sortType, genres) => {
    // If genres are provided, use persisted query with genre filter and isManga: true
    if (genres && genres.length > 0) {
      const variables = {
        search: {
          allowAdult: typeof __allowAdult !== 'undefined' ? __allowAdult : false,
          allowUnknown: false,
          genres: genres,
          isManga: true
        },
        limit: 26,
        page: page || 1,
        translationType: "sub",
        countryOrigin: "ALL"
      };

      const extensions = {
        persistedQuery: {
          version: 1,
          sha256Hash: "3a4b7e9ef62953484a05dd40f35b35b118ad2ff3d5e72d2add79bcaa663271e7"
        }
      };

      const url = \`https://api.allanime.day/api?variables=\${encodeURIComponent(JSON.stringify(variables))}&extensions=\${encodeURIComponent(JSON.stringify(extensions))}\`;

      console.log('[MangaExtension] Discover with genres:', genres);

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
        const mangas = data?.data?.mangas?.edges || [];

        console.log('[MangaExtension] Genre search returned', mangas.length, 'results');

        const results = mangas.map(manga => {
          let coverUrl = null;
          if (manga.thumbnail) {
            if (manga.thumbnail.startsWith('http://') || manga.thumbnail.startsWith('https://')) {
              coverUrl = manga.thumbnail;
            } else {
              coverUrl = \`https://wp.youtube-anime.com/aln.youtube-anime.com/\${manga.thumbnail}\`;
            }
          }

          return {
            id: manga._id,
            title: manga.englishName || manga.name,
            coverUrl: coverUrl,
            description: manga.description || '',
            year: manga.airedStart?.year || null,
            status: manga.status || 'Unknown',
            rating: manga.score ? parseFloat(manga.score) : null,
            genres: manga.genres || []
          };
        });

        return { results: results, hasNextPage: mangas.length >= 26 };
      } catch (error) {
        console.error('Manga genre search failed:', error);
        return { results: [], hasNextPage: false };
      }
    }

    // Use the popular query with type: "manga"
    // For 'score' sortType: use dateRange 30 to get monthly popular, then sort by score
    // For other sortTypes: use dateRange 1 for daily trending
    const dateRange = sortType === 'score' ? 30 : 1;

    const variables = {
      type: "manga",
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

      let results = recommendations.map((rec) => {
        const manga = rec.anyCard;

        let coverUrl = null;
        if (manga.thumbnail) {
          if (manga.thumbnail.startsWith('http://') || manga.thumbnail.startsWith('https://')) {
            coverUrl = manga.thumbnail;
          } else {
            coverUrl = \`https://wp.youtube-anime.com/aln.youtube-anime.com/\${manga.thumbnail}\`;
          }
        }

        return {
          id: manga._id,
          title: manga.englishName || manga.name,
          coverUrl: coverUrl,
          description: manga.description || '',
          year: manga.airedStart?.year || null,
          status: manga.status || 'Unknown',
          rating: manga.score ? parseFloat(manga.score) : null,
          genres: manga.genres || []
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
      console.error('Manga discover failed:', error);
      return {
        results: [],
        hasNextPage: false
      };
    }
  },

  getDetails: (id) => {
    // Use the correct persisted query for manga details
    // Note: allowAdult must match NSFW settings - if manga is adult and allowAdult is false, API returns null
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
        sha256Hash: "90024aeae9c1a4d3ace0473871dd1902e47fbcb8781ccbcd8ad81f8bb1f313ee"
      }
    };

    const url = \`https://api.allanime.day/api?variables=\${encodeURIComponent(JSON.stringify(variables))}&extensions=\${encodeURIComponent(JSON.stringify(extensions))}\`;

    console.log('[MangaExtension] getDetails for ID:', id, 'allowAdult:', allowAdult);

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
      const manga = data?.data?.manga;

      if (!manga) {
        console.error('[MangaExtension] Manga not found in response. This can happen if:',
          '1) The manga ID is invalid',
          '2) The manga is adult content and NSFW filter is enabled (allowAdult:', allowAdult, ')');
        throw new Error(allowAdult ? 'Manga not found' : 'Manga not found (may be adult content - try disabling NSFW filter)');
      }

      // Handle thumbnail URL
      let coverUrl = null;
      if (manga.thumbnail) {
        if (manga.thumbnail.startsWith('http://') || manga.thumbnail.startsWith('https://')) {
          coverUrl = manga.thumbnail;
        } else {
          coverUrl = \`https://wp.youtube-anime.com/aln.youtube-anime.com/\${manga.thumbnail}\`;
        }
      }

      // Parse chapters from availableChaptersDetail
      const chapterDetail = manga.availableChaptersDetail || {};
      const subChapters = chapterDetail.sub || [];

      const chapters = subChapters.map(chNum => ({
        id: \`\${id}-\${chNum}\`,
        number: parseFloat(chNum),
        title: \`Chapter \${chNum}\`,
        thumbnail: coverUrl
      }));

      // Sort chapters by number (ascending)
      chapters.sort((a, b) => a.number - b.number);

      return {
        id: manga._id,
        title: manga.name,
        english_name: manga.englishName || null,
        native_name: manga.nativeName || null,
        coverUrl: coverUrl,
        description: manga.description || 'No description available',
        genres: manga.genres || [],
        status: manga.status || 'Unknown',
        year: manga.airedStart?.year || null,
        rating: manga.score ? parseFloat(manga.score) : null,
        chapters: chapters,
        type: manga.type || null,
        totalChapters: chapters.length
      };
    } catch (error) {
      console.error('Failed to get manga details:', error);
      throw error;
    }
  },

  getChapterImages: (chapterId) => {
    // Parse chapter ID: format is "mangaId-chapterNum"
    const parts = chapterId.split('-');
    const mangaId = parts.slice(0, -1).join('-');
    const chapterString = parts[parts.length - 1];

    // Use the correct persisted query format with limit/offset
    const variables = {
      mangaId: mangaId,
      translationType: "sub",
      chapterString: chapterString,
      limit: 1000,
      offset: 0
    };

    const extensions = {
      persistedQuery: {
        version: 1,
        sha256Hash: "4a048654fbac31f11e201ac8bd34d748b514c28d2781b674d057d064282e620e"
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

      // Response structure: data.chapterPages.edges[0].pictureUrls
      const edges = data?.data?.chapterPages?.edges;

      if (!edges || edges.length === 0) {
        console.error('No chapter pages found in response');
        return { images: [], totalPages: 0, title: \`Chapter \${chapterString}\` };
      }

      // Get the first edge (usually there's only one source)
      const chapterData = edges[0];
      const pictureUrls = chapterData.pictureUrls || [];
      const pictureUrlHead = chapterData.pictureUrlHead || '';

      // Build full URLs for each page
      const images = pictureUrls.map((pic, index) => {
        let imgUrl = pic.url;

        // If URL is relative, prepend the head
        if (imgUrl && !imgUrl.startsWith('http://') && !imgUrl.startsWith('https://')) {
          imgUrl = pictureUrlHead + imgUrl;
        }

        return {
          url: imgUrl || '',
          page: pic.num !== undefined ? pic.num + 1 : index + 1,
          width: null,
          height: null
        };
      }).filter(img => img.url);

      // Sort by page number to ensure correct order
      images.sort((a, b) => a.page - b.page);

      return {
        images: images,
        totalPages: images.length,
        title: \`Chapter \${chapterString}\`
      };
    } catch (error) {
      console.error('Failed to get chapter images:', error);
      return { images: [], totalPages: 0, title: \`Chapter \${chapterString}\` };
    }
  },

  getTags: (page) => {
    const variables = {
      search: { format: "manga" },
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
          count: tag.mangaCount || tag.animeCount || 0,
          thumbnail: tag.sampleManga?.thumbnail || tag.sampleAnime?.thumbnail || null
        };

        if (tag.tagType === 'studio') {
          studios.push(item);
        } else {
          genres.push(item);
        }
      });

      // Sort by count (descending)
      genres.sort((a, b) => b.count - a.count);
      studios.sort((a, b) => b.count - a.count);

      return {
        genres: genres,
        studios: studios,
        hasNextPage: edges.length >= 50
      };
    } catch (error) {
      console.error('Failed to get manga tags:', error);
      return { genres: [], studios: [], hasNextPage: false };
    }
  }
};
`
