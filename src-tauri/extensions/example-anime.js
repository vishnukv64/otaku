/**
 * Example Anime Extension
 *
 * Demonstrates how to create a basic anime source extension.
 * This is a mock extension that returns sample data for testing.
 */

const extensionObject = {
  // Extension metadata
  id: "com.example.anime",
  name: "Example Anime Source",
  version: "1.0.0",
  type: "anime",
  language: "en",
  baseUrl: "https://example.com",

  /**
   * Search for anime
   * @param {string} query - Search query
   * @param {number} page - Page number (1-indexed)
   * @returns {Promise<{results: Array, hasNextPage: boolean}>}
   */
  search: async (query, page) => {
    // In a real extension, this would make an HTTP request to the anime source
    // For this example, we return mock data

    console.log(`Searching for "${query}" (page ${page})`);

    // Mock search results
    const results = [
      {
        id: "anime-1",
        title: `${query} - Result 1`,
        coverUrl: "https://via.placeholder.com/300x400",
        description: "A great anime about adventures and friendship.",
        year: 2024,
        status: "Ongoing"
      },
      {
        id: "anime-2",
        title: `${query} - Result 2`,
        coverUrl: "https://via.placeholder.com/300x400",
        description: "An epic story of heroes saving the world.",
        year: 2023,
        status: "Completed"
      },
      {
        id: "anime-3",
        title: `${query} - Result 3`,
        coverUrl: "https://via.placeholder.com/300x400",
        description: "A slice-of-life comedy about everyday moments.",
        year: 2024,
        status: "Ongoing"
      }
    ];

    return {
      results: results,
      hasNextPage: page < 5 // Mock pagination
    };
  },

  /**
   * Get detailed information about an anime
   * @param {string} id - Anime ID
   * @returns {Promise<Object>} Detailed anime information
   */
  getDetails: async (id) => {
    console.log(`Getting details for anime: ${id}`);

    // Mock anime details
    return {
      id: id,
      title: "Example Anime Title",
      coverUrl: "https://via.placeholder.com/300x400",
      description: "This is a detailed description of the anime. It tells the story of brave heroes on an epic quest to save their world from destruction. Along the way, they learn valuable lessons about friendship, courage, and never giving up.",
      genres: ["Action", "Adventure", "Fantasy"],
      status: "Ongoing",
      year: 2024,
      rating: 8.5,
      episodes: [
        {
          id: "ep-1",
          number: 1,
          title: "The Beginning",
          thumbnail: "https://via.placeholder.com/320x180"
        },
        {
          id: "ep-2",
          number: 2,
          title: "New Allies",
          thumbnail: "https://via.placeholder.com/320x180"
        },
        {
          id: "ep-3",
          number: 3,
          title: "First Battle",
          thumbnail: "https://via.placeholder.com/320x180"
        },
        {
          id: "ep-4",
          number: 4,
          title: "The Plot Thickens",
          thumbnail: "https://via.placeholder.com/320x180"
        },
        {
          id: "ep-5",
          number: 5,
          title: "Betrayal",
          thumbnail: "https://via.placeholder.com/320x180"
        }
      ]
    };
  },

  /**
   * Get video sources for an episode
   * @param {string} episodeId - Episode ID
   * @returns {Promise<{sources: Array, subtitles: Array}>}
   */
  getSources: async (episodeId) => {
    console.log(`Getting sources for episode: ${episodeId}`);

    // Mock video sources
    // In a real extension, this would extract video URLs from the anime source website
    return {
      sources: [
        {
          url: "https://example.com/video/1080p.m3u8",
          quality: "1080p",
          type: "hls"
        },
        {
          url: "https://example.com/video/720p.m3u8",
          quality: "720p",
          type: "hls"
        },
        {
          url: "https://example.com/video/480p.m3u8",
          quality: "480p",
          type: "hls"
        }
      ],
      subtitles: [
        {
          url: "https://example.com/subs/en.vtt",
          language: "en",
          label: "English"
        },
        {
          url: "https://example.com/subs/es.vtt",
          language: "es",
          label: "Spanish"
        }
      ]
    };
  }
};
