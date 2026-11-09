import { useState, useEffect } from "react";
import { Search, Filter, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BrowseItem } from "@/components/BrowseItem";
import { useApp } from "@/context/AppContext";

const categories = ["All", "Physics", "Chemistry", "Biology", "Mathematics", "Astronomy", "Tutorials", "Science"];

const formatPublishedDate = (dateString: string): string => {
  try {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    }).format(date);
  } catch (error) {
    console.error('Error formatting date:', error);
    return '';
  }
};

interface YouTubeVideo {
  id: {
    videoId: string;
  };
  snippet: {
    title: string;
    description: string;
    thumbnails: {
      medium: {
        url: string;
      };
    };
    channelTitle: string;
    publishedAt: string;
  };
  statistics?: {
    viewCount: string;
    likeCount: string;
  };
}

const mockVideos = [
  {
    id: "1",
    title: "Understanding the Doppler Effect - Physics Explained",
    description: "A comprehensive visual explanation of how sound and light waves change frequency based on relative motion between source and observer.",
    duration: "12:34",
    category: "Physics",
    views: "1.2M",
    url: "https://youtube.com/watch?v=example1",
  },
  {
    id: "2",
    title: "Wave Mechanics and Sound Propagation",
    description: "Learn how waves travel through different mediums and why the Doppler effect occurs in everyday situations.",
    duration: "8:45",
    category: "Physics",
    views: "890K",
    url: "https://youtube.com/watch?v=example2",
  },
  {
    id: "3",
    title: "DNA Replication Process Animated",
    description: "Watch the complete process of DNA replication unfold in this detailed molecular animation.",
    duration: "15:22",
    category: "Biology",
    views: "2.1M",
    url: "https://youtube.com/watch?v=example3",
  },
  {
    id: "4",
    title: "Chemical Bonding Visualized",
    description: "Understand ionic, covalent, and metallic bonds through beautiful 3D visualizations.",
    duration: "10:15",
    category: "Chemistry",
    views: "1.5M",
    url: "https://youtube.com/watch?v=example4",
  },
  {
    id: "5",
    title: "Black Holes: A Visual Journey",
    description: "Explore the mysteries of black holes, event horizons, and gravitational effects on spacetime.",
    duration: "18:30",
    category: "Astronomy",
    views: "3.4M",
    url: "https://youtube.com/watch?v=example5",
  },
  {
    id: "6",
    title: "Calculus Fundamentals Animated",
    description: "Master derivatives and integrals through intuitive visual explanations and animations.",
    duration: "22:10",
    category: "Mathematics",
    views: "980K",
    url: "https://youtube.com/watch?v=example6",
  },
  {
    id: "7",
    title: "Photosynthesis: The Complete Process",
    description: "Follow the journey of a photon as it powers the creation of glucose in plant cells.",
    duration: "14:05",
    category: "Biology",
    views: "1.8M",
    url: "https://youtube.com/watch?v=example7",
  },
  {
    id: "8",
    title: "Quantum Mechanics for Beginners",
    description: "Demystifying wave-particle duality, superposition, and quantum entanglement.",
    duration: "25:40",
    category: "Physics",
    views: "4.2M",
    url: "https://youtube.com/watch?v=example8",
  },
];

export default function Browse() {
  const { currentPrompt } = useApp();
  const [searchQuery, setSearchQuery] = useState(currentPrompt || "");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [videos, setVideos] = useState<YouTubeVideo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchVideos = async () => {
      if (!searchQuery.trim()) {
        setVideos([]);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const response = await fetch(
          `/api/browse?q=${encodeURIComponent(searchQuery.trim())}&category=${encodeURIComponent(selectedCategory)}`
        );

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || errorData.message || "Failed to fetch videos");
        }

        const data = await response.json();
        setVideos(data.items || []);
        if (data.message && (!data.items || data.items.length === 0)) {
          setError(data.message);
        }
      } catch (err) {
        console.error("Error fetching videos:", err);
        setError(err instanceof Error ? err.message : "Failed to load videos. Please try again later.");
      } finally {
        setLoading(false);
      }
    };

    // Add debounce to prevent too many API calls
    const timer = setTimeout(() => {
      if (searchQuery.trim()) {
        fetchVideos();
      } else {
        setVideos([]);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [searchQuery, selectedCategory]);
  
  const filteredVideos = selectedCategory === 'All' 
    ? videos 
    : videos.filter(video => 
        video.snippet.title.toLowerCase().includes(selectedCategory.toLowerCase()) ||
        video.snippet.description.toLowerCase().includes(selectedCategory.toLowerCase())
      );

  return (
    <div className="min-h-full p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Browse Videos</h1>
          <p className="text-muted-foreground mt-1">
            Discover educational content related to your interests
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search for topics..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
              data-testid="input-search-browse"
            />
          </div>
          <Button variant="outline" className="sm:w-auto">
            <Filter className="w-4 h-4 mr-2" />
            Filters
          </Button>
        </div>

        <div className="flex flex-wrap gap-2">
          {categories.map((category) => (
            <Button
              key={category}
              variant={selectedCategory === category ? "default" : "outline"}
              size="sm"
              onClick={() => setSelectedCategory(category)}
              data-testid={`filter-${category.toLowerCase()}`}
            >
              {category}
            </Button>
          ))}
        </div>

        <div className="space-y-4">
          {loading ? (
            <div className="flex justify-center items-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <span className="ml-2">Loading videos...</span>
            </div>
          ) : error ? (
            <div className="text-center py-12 text-destructive">
              <p>{error}</p>
              <Button
                variant="ghost"
                onClick={() => window.location.reload()}
                className="mt-2"
              >
                Retry
              </Button>
            </div>
          ) : filteredVideos.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredVideos.map((video) => (
                <div key={video.id.videoId} className="rounded-lg overflow-hidden shadow-md hover:shadow-lg transition-shadow">
                  <div className="relative pt-[56.25%] bg-muted">
                    <img
                      src={video.snippet.thumbnails.medium.url}
                      alt={video.snippet.title}
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                    <div className="absolute bottom-2 right-2 bg-black/75 text-white text-xs px-2 py-1 rounded">
                      {formatPublishedDate(video.snippet.publishedAt)}
                    </div>
                  </div>
                  <div className="p-4">
                    <h3 className="font-medium line-clamp-2 mb-1">{video.snippet.title}</h3>
                    <p className="text-sm text-muted-foreground mb-2 line-clamp-2">
                      {video.snippet.channelTitle}
                    </p>
                    <p className="text-xs text-muted-foreground line-clamp-2">
                      {video.snippet.description}
                    </p>
                    <a
                      href={`https://www.youtube.com/watch?v=${video.id.videoId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-3 inline-block text-sm font-medium text-primary hover:underline"
                    >
                      Watch on YouTube →
                    </a>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12">
              <p className="text-muted-foreground">
                {searchQuery 
                  ? "No videos found matching your search." 
                  : "Enter a search term to find educational videos."}
              </p>
              {searchQuery && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setSearchQuery("");
                    setSelectedCategory("All");
                  }}
                  className="mt-2"
                >
                  Clear search
                </Button>
              )}
            </div>
          )}
        </div>

        {filteredVideos.length > 0 && (
          <div className="text-center pt-4 border-t border-border">
            <p className="text-sm text-muted-foreground">
              Showing {filteredVideos.length} {filteredVideos.length === 1 ? 'video' : 'videos'}
              {searchQuery && ` for "${searchQuery}"`}
              {selectedCategory !== 'All' && ` in ${selectedCategory}`}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
