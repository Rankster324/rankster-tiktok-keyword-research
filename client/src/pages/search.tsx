import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { CalendarIcon, Search, ArrowLeft, Loader, Info, ChevronUp, ChevronDown } from "lucide-react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { LoginModal } from "@/components/login-modal";
import { ContactModal } from "@/components/contact-modal";
import { queryClient } from "@/lib/queryClient";
import logoImage from "@assets/xx Logo copy_1754316878226.png";

// Keyword data from backend
interface KeywordResult {
  id: string;
  keyword: string;
  rank?: number; // RK-specific rank field
  searchVolume: number;
  productClickScore: string;
  skuSalesScore: string | null;
  availableProducts: number;
  averagePrice: string;
  ctrScore: string;
  ctorScore: string;
  categoryId: string | null;
  uploadPeriod: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// Paginated response structure
interface PaginatedKeywordResponse {
  keywords: KeywordResult[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

// Category data from backend
interface Category {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: string;
}

export default function SearchPage() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [, navigate] = useLocation();
  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const [contactModalOpen, setContactModalOpen] = useState(false);

  const openContactModal = () => setContactModalOpen(true);
  const closeContactModal = () => setContactModalOpen(false);

  // Flow state - always initialize these hooks first
  const [selectedPeriod, setSelectedPeriod] = useState<string>("");
  const [searchType, setSearchType] = useState<"keyword" | "category">("category");
  const [searchMetric, setSearchMetric] = useState<"top" | "rising" | "high-potential">("top");

  // Fetch periods for dynamic period selection based on search metric
  const { data: hpkPeriods = [] } = useQuery<{ value: string; label: string; type: 'week' }[]>({
    queryKey: ["/api/keywords/hpk-periods"],
    staleTime: 5 * 60 * 1000, // 5 minutes - longer cache to prevent flashing
    gcTime: 10 * 60 * 1000, // 10 minutes
    enabled: searchMetric === "high-potential", // Only fetch when HPK is selected
  });

  const { data: rkPeriods = [] } = useQuery<{ value: string; label: string; type: 'month' }[]>({
    queryKey: ["/api/keywords/rk-periods"],
    staleTime: 5 * 60 * 1000, // 5 minutes - longer cache to prevent flashing
    gcTime: 10 * 60 * 1000, // 10 minutes
    enabled: searchMetric === "rising", // Only fetch when RK is selected
  });

  const { data: regularPeriods = [] } = useQuery<{ value: string; label: string; type: 'month' | 'week' }[]>({
    queryKey: ["/api/keywords/regular-periods"],
    staleTime: 5 * 60 * 1000, // 5 minutes - longer cache to prevent flashing
    gcTime: 10 * 60 * 1000, // 10 minutes
    enabled: searchMetric === "top", // Only fetch when regular search is selected
  });
  
  // Available periods - filtered based on search metric and actual uploaded data
  const getAvailablePeriods = () => {
    if (searchMetric === "high-potential") {
      // Use actual HPK periods from database, fallback if no data
      return hpkPeriods.length > 0 ? hpkPeriods : [
        { value: "no-data", label: "No HPK data available", type: "week" as const }
      ];
    }
    
    if (searchMetric === "rising") {
      // Use actual RK periods from database, fallback if no data
      return rkPeriods.length > 0 ? rkPeriods : [
        { value: "no-data", label: "No rising keywords data available", type: "month" as const }
      ];
    }
    
    // Use actual regular keyword periods from database, fallback if no data
    return regularPeriods.length > 0 ? regularPeriods : [
      { value: "no-data", label: "No keyword data available", type: "month" as const }
    ];
  };

  const availablePeriods = useMemo(() => getAvailablePeriods(), [searchMetric, hpkPeriods, rkPeriods, regularPeriods]);
  
  // Simplified period selection - always select first available period when data is available
  useEffect(() => {
    const currentPeriods = searchMetric === "high-potential" ? hpkPeriods :
                          searchMetric === "rising" ? rkPeriods : regularPeriods;
    
    // Auto-select first period when data becomes available
    if (currentPeriods.length > 0 && currentPeriods[0]?.value !== "no-data") {
      const firstPeriod = currentPeriods[0].value;
      
      // Set period if none selected or switching search metrics
      if (!selectedPeriod || !currentPeriods.some(p => p.value === selectedPeriod)) {
        console.log(`Auto-selecting period: ${firstPeriod} for metric: ${searchMetric}`);
        setSelectedPeriod(firstPeriod);
        if (searchType === "category") {
          setHasSearched(true);
        }
      }
    } else if (currentPeriods.length > 0 && currentPeriods[0]?.value === "no-data") {
      // Clear period if no data available
      setSelectedPeriod("");
      setHasSearched(false);
    }
  }, [searchMetric, hpkPeriods, rkPeriods, regularPeriods, searchType]);
  
  // Search inputs
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedSubCategory, setSelectedSubCategory] = useState<string>("all-sub");
  const [selectedThirdCategory, setSelectedThirdCategory] = useState<string>("all-third");
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("");
  const [hasSearched, setHasSearched] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  
  // Multi-column sorting state (like Excel)
  const [sortCriteria, setSortCriteria] = useState<Array<{field: string; direction: "asc" | "desc"}>>([]);

  // Debounce search term for API calls - reduced for better responsiveness
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
    }, 300);

    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Fetch categories with keyword counts - force fresh data
  const { data: categoriesResponse, refetch: refetchCategories } = useQuery<{
    categories: (Category & { keywordCount: number })[];
    totalUniqueKeywords: number;
  }>({
    queryKey: ["/api/categories/with-counts", searchMetric, selectedPeriod, "v7"],
    staleTime: 0, // Force fresh data to fix count mismatch
    gcTime: 0, // No garbage collection time
    refetchOnMount: true, // Always refetch on mount
    refetchOnWindowFocus: true, // Refetch when window gains focus
    enabled: Boolean(selectedPeriod && selectedPeriod !== ""), // Only fetch when period is selected
    queryFn: async () => {
      const url = `/api/categories/with-counts?uploadPeriod=${encodeURIComponent(selectedPeriod)}&searchMetric=${encodeURIComponent(searchMetric)}&_=${Date.now()}`;
      console.log('Fetching categories from:', url);
      const response = await fetch(url, {
        cache: 'no-cache', // Force no HTTP cache
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate'
        }
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch categories with counts: ${response.status} ${response.statusText}`);
      }
      const data = await response.json();
      console.log('Categories response:', data);
      return data;
    }
  });

  // Extract categories and total from response (fallback to old format for compatibility)
  const categoriesWithCounts: (Category & { keywordCount: number })[] = categoriesResponse?.categories || (Array.isArray(categoriesResponse) ? categoriesResponse : []);
  const totalUniqueKeywords = categoriesResponse?.totalUniqueKeywords;

  // Get top-level categories (no parent) with keyword counts
  const topCategories = categoriesWithCounts.filter(cat => !cat.parentId);
  


  // Get sub-categories for selected category
  const subCategories = selectedCategory && selectedCategory !== "all"
    ? categoriesWithCounts.filter(cat => cat.parentId === selectedCategory)
    : [];

  // Get third-level categories for selected sub-category
  const thirdCategories = selectedSubCategory && selectedSubCategory !== "all-sub"
    ? categoriesWithCounts.filter(cat => cat.parentId === selectedSubCategory)
    : [];

  // Search keywords with pagination - use controlled cache refresh
  const { data: searchResponse, isLoading: isSearching } = useQuery<PaginatedKeywordResponse>({
    queryKey: ["/api/keywords/search", debouncedSearchTerm, selectedCategory, selectedSubCategory, selectedThirdCategory, selectedPeriod, searchType, searchMetric, currentPage, sortCriteria],
    enabled: Boolean(hasSearched && selectedPeriod && selectedPeriod !== "" && ((searchType === "keyword" && debouncedSearchTerm.length >= 2) || (searchType === "category"))),
    staleTime: 0, // Force fresh data to fix count mismatch
    gcTime: 1000, // Short garbage collection time
    queryFn: async () => {
      const params = new URLSearchParams();
      
      // Add pagination parameters
      params.set('page', currentPage.toString());
      params.set('limit', '20');
      
      if (searchType === "keyword" && debouncedSearchTerm) {
        params.set('query', debouncedSearchTerm);
      }
      
      // For category search, include category names for filtering
      if (searchType === "category" && selectedCategory && selectedCategory !== "all") {
        if (searchMetric === 'high-potential') {
          // For HPK data, selectedCategory is the category name directly
          params.set('category', selectedCategory);
        } else {
          // For regular data, handle hierarchical categories
          if (selectedThirdCategory && selectedThirdCategory !== "all-third") {
            const subSubCategoryName = selectedThirdCategory.split('::')[2];
            params.set('subCategory2', subSubCategoryName);
            params.set('subCategory1', selectedThirdCategory.split('::')[1]);
            params.set('category', selectedThirdCategory.split('::')[0]);
          } else if (selectedSubCategory && selectedSubCategory !== "all-sub") {
            const subCategoryName = selectedSubCategory.split('::')[1];
            params.set('subCategory1', subCategoryName);
            params.set('category', selectedSubCategory.split('::')[0]);
          } else if (selectedCategory && selectedCategory !== "all") {
            params.set('category', selectedCategory);
          }
        }
      }
      
      if (selectedPeriod) {
        params.set('uploadPeriod', selectedPeriod);
      }

      // Add search metric parameter
      params.set('searchMetric', searchMetric);

      // Add multi-column sorting parameters
      if (sortCriteria.length > 0) {
        const sortFields = sortCriteria.map(c => c.field).join(',');
        const sortDirections = sortCriteria.map(c => c.direction).join(',');
        params.set('sortFields', sortFields);
        params.set('sortDirections', sortDirections);
      }

      const url = `/api/keywords/search?${params}`;
      
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error('Failed to search keywords');
      }
      return await response.json();
    },
  });

  // Reset dependent dropdowns when parent category changes
  useEffect(() => {
    if (selectedCategory === "all") {
      setSelectedSubCategory("all-sub");
      setSelectedThirdCategory("all-third");
    } else {
      setSelectedSubCategory("all-sub");
      setSelectedThirdCategory("all-third");
    }
    // Reset pagination and trigger search when main category changes
    setCurrentPage(1);
    if (searchType === "category" && selectedPeriod) {
      setHasSearched(true);
    }
  }, [selectedCategory, searchType, selectedPeriod]);

  useEffect(() => {
    setSelectedThirdCategory("all-third");
    // Reset pagination and trigger search when sub-category changes
    setCurrentPage(1);
    if (searchType === "category" && selectedPeriod) {
      setHasSearched(true);
    }
  }, [selectedSubCategory, searchType, selectedPeriod]);

  // Trigger search when sub-subcategory changes
  useEffect(() => {
    setCurrentPage(1);
    if (searchType === "category" && selectedPeriod && selectedThirdCategory !== "all-third") {
      setHasSearched(true);
    }
  }, [selectedThirdCategory, searchType, selectedPeriod]);

  // Reset pagination and set default sorting when search metric changes
  useEffect(() => {
    setCurrentPage(1);
    
    // Set appropriate default sorting for each search metric
    if (searchMetric === 'high-potential') {
      // For HPK, prioritize Opportunity Score (skuSalesScore) descending
      setSortCriteria([{ field: 'skuSalesScore', direction: 'desc' }]);
    } else if (searchMetric === 'rising') {
      // For RK, prioritize search volume descending
      setSortCriteria([{ field: 'searchVolume', direction: 'desc' }]);
    } else {
      // For regular keywords, prioritize search volume descending
      setSortCriteria([{ field: 'searchVolume', direction: 'desc' }]);
    }
  }, [searchMetric]);

  // Reset search state when authentication changes (especially on logout)
  useEffect(() => {
    if (!isAuthenticated && !authLoading) {
      // Reset search results when user logs out
      setHasSearched(false);
      setLoginModalOpen(false); // Ensure modal is closed on logout
      setSortCriteria([]); // Reset sorting when logged out
    }
  }, [isAuthenticated, authLoading]);

  // Show loading while checking authentication - after ALL hooks are initialized
  if (authLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Loader className="h-12 w-12 animate-spin text-blue-600 mx-auto mb-4" />
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  const searchResults = searchResponse?.keywords || [];
  const pagination = searchResponse?.pagination;



  const handleSearch = () => {
    // Check if user is authenticated before allowing search
    if (!isAuthenticated) {
      setLoginModalOpen(true);
      return;
    }
    
    setCurrentPage(1);
    setHasSearched(true);
  };

  const closeLoginModal = () => setLoginModalOpen(false);
  
  const handleLoginSubmit = async (email: string) => {
    try {
      // Submit email and create account
      const response = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email }),
      });
      
      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          // Invalidate auth cache to refresh user state
          await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
          setLoginModalOpen(false);
          // Continue with the search after login
          setCurrentPage(1);
          setHasSearched(true);
        } else {
          console.error('Signup failed:', result);
        }
      } else {
        const errorData = await response.json();
        console.error('Signup failed:', errorData);
      }
    } catch (error) {
      console.error('Login error:', error);
    }
  };

  const getScoreColor = (score: string | number) => {
    const numScore = typeof score === 'string' ? parseFloat(score) : score;
    if (numScore >= 8) return "text-green-600 font-semibold";
    if (numScore >= 6) return "text-yellow-600 font-semibold";
    return "text-red-600 font-semibold";
  };

  const getVolumeColor = (volume: number) => {
    if (volume >= 100000) return "text-green-600 font-semibold";
    if (volume >= 50000) return "text-blue-600 font-semibold";
    if (volume >= 10000) return "text-yellow-600 font-semibold";
    return "text-gray-600";
  };

  // Handle multi-column sorting like Excel
  const handleSort = (field: string) => {
    setSortCriteria(prevCriteria => {
      const existingIndex = prevCriteria.findIndex(c => c.field === field);
      
      if (existingIndex !== -1) {
        // Field already exists, toggle direction or remove if asc
        const existing = prevCriteria[existingIndex];
        if (existing.direction === "desc") {
          // Change to ascending
          return prevCriteria.map((c, i) => 
            i === existingIndex ? { ...c, direction: "asc" as const } : c
          );
        } else {
          // Remove this sort criteria
          return prevCriteria.filter((_, i) => i !== existingIndex);
        }
      } else {
        // Add new sort criteria (default desc)
        return [...prevCriteria, { field, direction: "desc" as const }];
      }
    });
    
    setCurrentPage(1); // Reset to first page when sorting
    setHasSearched(true); // Trigger new search with sorting
  };

  // Get sort info for a specific field (for UI indicators)
  const getSortInfo = (field: string) => {
    const criterion = sortCriteria.find(c => c.field === field);
    if (!criterion) return { active: false, direction: null, priority: -1 };
    
    const priority = sortCriteria.findIndex(c => c.field === field) + 1;
    return { active: true, direction: criterion.direction, priority };
  };

  // Create sortable column header component with Excel-style multi-column sorting
  const SortableHeader = ({ field, children, className = "" }: { field: string; children: React.ReactNode; className?: string }) => {
    const sortInfo = getSortInfo(field);
    
    return (
      <TableHead className={cn("font-medium text-gray-700 text-sm cursor-pointer hover:bg-gray-50 select-none", className)} 
                onClick={() => handleSort(field)}
                data-testid={`column-${field}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            {children}
            {sortInfo.active && (
              <span className="text-xs bg-blue-100 text-blue-700 px-1 rounded font-medium">
                {sortInfo.priority}
              </span>
            )}
          </div>
          <div className="flex flex-col ml-1">
            <ChevronUp 
              className={cn("h-3 w-3", 
                sortInfo.active && sortInfo.direction === "asc" ? "text-blue-600" : "text-gray-300"
              )} 
            />
            <ChevronDown 
              className={cn("h-3 w-3 -mt-1", 
                sortInfo.active && sortInfo.direction === "desc" ? "text-blue-600" : "text-gray-300"
              )} 
            />
          </div>
        </div>
      </TableHead>
    );
  };

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center space-x-4">
              <Link href="/">
                <Button variant="ghost" size="sm" data-testid="button-back-home">
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back to Home
                </Button>
              </Link>
              <img 
                src={logoImage} 
                alt="Rankster Logo" 
                className="h-8 w-auto"
              />
            </div>
            <div className="text-sm text-gray-600">
              TikTok Shop Keyword Research
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Search Section */}
        <div className="bg-gradient-to-br from-teal-50 via-purple-50 to-pink-50 rounded-3xl p-2 shadow-lg mb-8 border border-gray-100">
          <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-8">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-4">
              TikTok Shop Keyword Research
            </h1>
            <p className="text-gray-600 max-w-2xl mx-auto">
              Discover untapped keywords and analyze category performance with real data
            </p>
          </div>

          <div className="max-w-4xl mx-auto space-y-8">
            {/* Search Metric Selection */}
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-teal-100 rounded-lg flex items-center justify-center">
                  <Search className="h-4 w-4 text-teal-600" />
                </div>
                <h2 className="text-lg font-bold text-gray-900">Search Metrics</h2>
              </div>

              {/* Metric Selection Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div
                  className={cn(
                    "p-6 rounded-xl border-2 cursor-pointer transition-all duration-200 hover:shadow-md",
                    searchMetric === "top"
                      ? "bg-blue-50 border-blue-300 shadow-sm"
                      : "bg-white border-gray-200 hover:border-blue-200"
                  )}
                  onClick={() => {
                    setSearchMetric("top");
                    setHasSearched(false);
                  }}
                  data-testid="card-metric-top"
                >
                  <div className="text-center space-y-3">
                    <div className="text-3xl">🔍</div>
                    <h3 className="font-semibold text-gray-900">Top Search Keywords</h3>
                    <p className="text-sm text-gray-600">Most searched terms right now.</p>
                  </div>
                </div>

                <div
                  className={cn(
                    "p-6 rounded-xl border-2 cursor-pointer transition-all duration-200 hover:shadow-md",
                    searchMetric === "rising"
                      ? "bg-purple-50 border-purple-300 shadow-sm"
                      : "bg-white border-gray-200 hover:border-purple-200"
                  )}
                  onClick={() => {
                    setSearchMetric("rising");
                    setHasSearched(false);
                  }}
                  data-testid="card-metric-rising"
                >
                  <div className="text-center space-y-3">
                    <div className="text-3xl">📈</div>
                    <h3 className="font-semibold text-gray-900">Rising Keywords</h3>
                    <p className="text-sm text-gray-600">Trending fast, sharp growth.</p>
                  </div>
                </div>

                <div
                  className={cn(
                    "p-6 rounded-xl border-2 cursor-pointer transition-all duration-200 hover:shadow-md",
                    searchMetric === "high-potential"
                      ? "bg-teal-50 border-teal-300 shadow-sm"
                      : "bg-white border-gray-200 hover:border-teal-200"
                  )}
                  onClick={() => {
                    setSearchMetric("high-potential");
                    setHasSearched(false);
                  }}
                  data-testid="card-metric-high-potential"
                >
                  <div className="text-center space-y-3">
                    <div className="text-3xl">🚀</div>
                    <h3 className="font-semibold text-gray-900">High-Potential Keywords</h3>
                    <p className="text-sm text-gray-600">Low competition, high upside.</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Step 1: Select Time Period */}
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                  <CalendarIcon className="h-4 w-4 text-blue-600" />
                </div>
                <h2 className="text-lg font-bold text-gray-900">Select Time Period</h2>
              </div>

              {/* Period Selection Dropdown */}
              <div className="relative max-w-md">
                <Select 
                  value={selectedPeriod} 
                  onValueChange={setSelectedPeriod}
                >
                  <SelectTrigger className="w-full p-3 border border-gray-200 rounded-lg" data-testid="select-time-period">
                    <SelectValue placeholder="Select time period" />
                  </SelectTrigger>
                  <SelectContent>
                    {availablePeriods.map((period) => (
                      <SelectItem key={period.value} value={period.value}>
                        {period.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Step 2: Search Method */}
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                  <Search className="h-4 w-4 text-blue-600" />
                </div>
                <h2 className="text-lg font-bold text-gray-900">Search Method</h2>
              </div>

              {/* Method Toggle */}
              <div className="flex bg-gray-100 rounded-lg p-1 max-w-md">
                <Button
                  variant={searchType === "category" ? "default" : "ghost"}
                  className={cn(
                    "flex-1 h-10 rounded-md text-sm font-medium",
                    searchType === "category"
                      ? "bg-blue-600 text-white shadow-sm"
                      : "text-gray-600 hover:text-gray-900"
                  )}
                  onClick={() => setSearchType("category")}
                  data-testid="button-search-method-categories"
                >
                  Browse Categories
                </Button>
                <Button
                  variant={searchType === "keyword" ? "default" : "ghost"}
                  className={cn(
                    "flex-1 h-10 rounded-md text-sm font-medium",
                    searchType === "keyword"
                      ? "bg-gray-200 text-gray-800"
                      : "text-gray-600 hover:text-gray-900"
                  )}
                  onClick={() => setSearchType("keyword")}
                  data-testid="button-search-method-keyword"
                >
                  Search Keyword
                </Button>
              </div>

              {/* Category Selection */}
              {searchType === "category" && (
                <div className="space-y-3 max-w-lg">
                  <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                    <SelectTrigger className="w-full p-3 border border-gray-200 rounded-lg" data-testid="select-category">
                      <SelectValue placeholder="All Categories (Browse All Keywords)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Categories ({totalUniqueKeywords || categoriesWithCounts.reduce((sum, cat) => sum + Number(cat.keywordCount), 0)} keywords)</SelectItem>
                      {categoriesWithCounts
                        .filter((category) => category.id && category.id.trim() !== '')
                        .sort((a, b) => {
                          // Sort by keyword count first (descending), then by name
                          if (b.keywordCount !== a.keywordCount) {
                            return b.keywordCount - a.keywordCount;
                          }
                          return a.name.localeCompare(b.name);
                        })
                        .map((category) => (
                        <SelectItem key={category.id} value={category.id}>
                          {category.name} ({category.keywordCount} keywords)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {subCategories.length > 0 && selectedCategory !== "all" && (
                    <Select value={selectedSubCategory} onValueChange={setSelectedSubCategory}>
                      <SelectTrigger className="w-full p-3 border border-gray-200 rounded-lg" data-testid="select-subcategory">
                        <SelectValue placeholder="All Subcategories" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all-sub">All Subcategories</SelectItem>
                        {subCategories
                          .filter((category) => category.id && category.id.trim() !== '')
                          .sort((a, b) => {
                            if (b.keywordCount !== a.keywordCount) {
                              return b.keywordCount - a.keywordCount;
                            }
                            return a.name.localeCompare(b.name);
                          })
                          .map((category) => (
                          <SelectItem key={category.id} value={category.id}>
                            {category.name} ({category.keywordCount} keywords)
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}

                  {thirdCategories.length > 0 && selectedSubCategory && selectedSubCategory !== "all-sub" && (
                    <Select value={selectedThirdCategory} onValueChange={setSelectedThirdCategory}>
                      <SelectTrigger className="w-full p-3 border border-gray-200 rounded-lg" data-testid="select-sub-subcategory">
                        <SelectValue placeholder="All Sub-subcategories" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all-third">All Sub-subcategories</SelectItem>
                        {thirdCategories
                          .filter((category) => category.id && category.id.trim() !== '')
                          .sort((a, b) => {
                            if (b.keywordCount !== a.keywordCount) {
                              return b.keywordCount - a.keywordCount;
                            }
                            return a.name.localeCompare(b.name);
                          })
                          .map((category) => (
                          <SelectItem key={category.id} value={category.id}>
                            {category.name} ({category.keywordCount} keywords)
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              )}

              {/* Keyword Input */}
              {searchType === "keyword" && (
                <div className="max-w-lg">
                  <Input
                    type="text"
                    placeholder="Enter keyword to search..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full p-3 border border-gray-200 rounded-lg"
                    data-testid="input-keyword-search"
                  />
                </div>
              )}

              {/* Search Button */}
              <Button
                onClick={handleSearch}
                disabled={!selectedPeriod || (!searchType || (searchType === "keyword" && !searchTerm.trim()))}
                className="bg-gradient-to-r from-blue-600 via-purple-600 to-blue-700 hover:from-blue-700 hover:via-purple-700 hover:to-blue-800 text-white px-8 py-3 rounded-lg font-medium"
                data-testid="button-search-categories"
              >
                {searchType === "category" && selectedCategory === "all" ? "Browse All Keywords" : 
                 searchType === "category" && selectedThirdCategory !== "all-third" ? "Search Sub-subcategory" :
                 searchType === "category" && selectedSubCategory !== "all-sub" ? "Search Subcategory" :
                 searchType === "category" ? "Search Category" : "Search Keywords"}
              </Button>
            </div>
          </div>
          </div>
        </div>



        {/* Search Results */}
        {hasSearched && (
          <div className="bg-white rounded-2xl p-8 shadow-lg">
            {isSearching ? (
              <div className="text-center py-12">
                <Loader className="h-12 w-12 animate-spin text-blue-600 mx-auto mb-4" />
                <h3 className="text-xl font-semibold text-gray-900 mb-2">
                  {searchMetric === "top" ? "🔍 " : searchMetric === "rising" ? "📈 " : "🚀 "}
                  Analyzing TikTok Shop Data
                </h3>
                <p className="text-gray-600">
                  Gathering exclusive {searchMetric === "top" ? "top search" : searchMetric === "rising" ? "rising" : "high-potential"} keyword insights...
                </p>
              </div>
            ) : searchResults.length === 0 ? (
              <div className="text-center py-12">
                <Search className="h-16 w-16 text-gray-300 mx-auto mb-4" />
                <h4 className="text-xl font-medium text-gray-900 mb-2">
                  {searchMetric === "top" ? "🔍 " : searchMetric === "rising" ? "📈 " : "🚀 "}
                  No {searchMetric === "top" ? "top search" : searchMetric === "rising" ? "rising" : "high-potential"} keywords found
                </h4>
                <p className="text-gray-500">Try adjusting your search terms or time period.</p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-8">
                  <div>
                    <h2 className="text-2xl font-bold text-gray-900">
                      {searchMetric === "top" ? "🔍 " : searchMetric === "rising" ? "📈 " : "🚀 "}
                      Search Results
                    </h2>
                    <p className="text-gray-600 mt-1">
                      {pagination ? (
                        <>
                          Showing {((pagination.page - 1) * pagination.pageSize) + 1}-{Math.min(pagination.page * pagination.pageSize, pagination.total)} of {pagination.total} keyword opportunities
                          {searchType === "category" && selectedThirdCategory !== "all-third" ? 
                            ` in ${categoriesWithCounts.find(c => c.id === selectedThirdCategory)?.name || 'selected sub-subcategory'}` :
                           searchType === "category" && selectedSubCategory !== "all-sub" ? 
                            ` in ${categoriesWithCounts.find(c => c.id === selectedSubCategory)?.name || 'selected subcategory'}` :
                           searchType === "category" && selectedCategory !== "all" ? 
                            ` in ${categoriesWithCounts.find(c => c.id === selectedCategory)?.name || 'selected category'}` :
                           searchType === "category" ? " across all categories" : ""}
                        </>
                      ) : (
                        <>
                          Found {searchResults.length} keyword opportunities
                          {searchType === "category" && selectedThirdCategory !== "all-third" ? 
                            ` in ${categoriesWithCounts.find(c => c.id === selectedThirdCategory)?.name || 'selected sub-subcategory'}` :
                           searchType === "category" && selectedSubCategory !== "all-sub" ? 
                            ` in ${categoriesWithCounts.find(c => c.id === selectedSubCategory)?.name || 'selected subcategory'}` :
                           searchType === "category" && selectedCategory !== "all" ? 
                            ` in ${categoriesWithCounts.find(c => c.id === selectedCategory)?.name || 'selected category'}` :
                           searchType === "category" ? " across all categories" : ""}
                        </>
                      )}
                    </p>
                    {sortCriteria.length > 0 && (
                      <div className="flex items-center gap-2 mt-2">
                        <span className="text-sm text-gray-500">
                          Sorted by: {sortCriteria.map((c, i) => `${c.field} (${c.direction})`).join(', ')}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSortCriteria([])}
                          className="text-xs h-6 px-2"
                          data-testid="button-clear-sort"
                        >
                          Clear Sort
                        </Button>
                      </div>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => setHasSearched(false)}
                    className="text-sm"
                    data-testid="button-new-search"
                  >
                    New Search
                  </Button>
                </div>

                {/* Results Table */}
                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-b border-gray-200">
                          {searchMetric === "high-potential" ? (
                            // HPK columns: Category, Keyword, Opportunity score, Search volume, Available products
                            <>
                              <SortableHeader field="category">
                                <div className="flex items-center gap-1">
                                  Category
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Info className="h-4 w-4 text-red-500 hover:text-red-600 cursor-help" />
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      <div className="max-w-sm text-sm">
                                        <p className="font-medium mb-2">Product Category</p>
                                        <p>The main product category this keyword belongs to, helping you understand the market segment and competition landscape.</p>
                                      </div>
                                    </TooltipContent>
                                  </Tooltip>
                                </div>
                              </SortableHeader>
                              <SortableHeader field="keyword">
                                <div className="flex items-center gap-1">
                                  Keyword
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Info className="h-4 w-4 text-red-500 hover:text-red-600 cursor-help" />
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      <div className="max-w-sm text-sm">
                                        <p className="font-medium mb-2">High-Potential Keyword</p>
                                        <p>Search terms with strong commercial potential and growth trajectory. These keywords show rising demand with good conversion opportunities.</p>
                                      </div>
                                    </TooltipContent>
                                  </Tooltip>
                                </div>
                              </SortableHeader>
                              <SortableHeader field="skuSalesScore">
                                <div className="flex items-center gap-1">
                                  Opportunity Score
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Info className="h-4 w-4 text-red-500 hover:text-red-600 cursor-help" />
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      <div className="max-w-sm text-sm">
                                        <p className="font-medium mb-2">Opportunity Score</p>
                                        <p className="mb-2">Combined metric measuring the keyword's commercial potential based on search volume, competition, and conversion trends.</p>
                                        <div className="space-y-1">
                                          <p><span className="font-medium text-green-600">High:</span> 1,000+ → exceptional opportunity</p>
                                          <p><span className="font-medium text-amber-600">Medium:</span> 500-1,000 → good potential</p>
                                          <p><span className="font-medium text-red-600">Low:</span> Below 500 → limited opportunity</p>
                                        </div>
                                      </div>
                                    </TooltipContent>
                                  </Tooltip>
                                </div>
                              </SortableHeader>
                              <SortableHeader field="searchVolume">
                                <div className="flex items-center gap-1">
                                  Search Volume
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Info className="h-4 w-4 text-red-500 hover:text-red-600 cursor-help" />
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      <div className="max-w-sm text-sm">
                                        <p className="font-medium mb-2">Weekly Search Volume</p>
                                        <p className="mb-2">Number of searches for this keyword in the selected week. Shows current demand level.</p>
                                        <div className="space-y-1">
                                          <p><span className="font-medium text-green-600">High:</span> 1,000+ weekly searches</p>
                                          <p><span className="font-medium text-amber-600">Medium:</span> 500-1,000 weekly searches</p>
                                          <p><span className="font-medium text-red-600">Low:</span> Below 500 weekly searches</p>
                                        </div>
                                      </div>
                                    </TooltipContent>
                                  </Tooltip>
                                </div>
                              </SortableHeader>
                              <SortableHeader field="availableProducts">
                                <div className="flex items-center gap-1">
                                  Available Products
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Info className="h-4 w-4 text-red-500 hover:text-red-600 cursor-help" />
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      <div className="max-w-sm text-sm">
                                        <p className="font-medium mb-2">Competition Level</p>
                                        <p className="mb-2">Number of products currently listed for this keyword. Indicates market saturation.</p>
                                        <div className="space-y-1">
                                          <p><span className="font-medium text-green-600">Low Competition:</span> Under 100 products</p>
                                          <p><span className="font-medium text-amber-600">Medium:</span> 100-500 products</p>
                                          <p><span className="font-medium text-red-600">High:</span> 500+ products</p>
                                        </div>
                                      </div>
                                    </TooltipContent>
                                  </Tooltip>
                                </div>
                              </SortableHeader>
                            </>
                          ) : searchMetric === "rising" ? (
                            // RK columns: Category, Rank, Keyword, Search Volume, Product Click Score, SKU Sales Score, Available Products, Avg. Price, CTR Score, CTOR Score
                            <>
                              <SortableHeader field="category">
                                <div className="flex items-center gap-1">
                                  Category
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Info className="h-4 w-4 text-red-500 hover:text-red-600 cursor-help" />
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      <div className="max-w-sm text-sm">
                                        <p className="font-medium mb-2">Product Category</p>
                                        <p>The main product category this keyword belongs to, helping you understand the market segment and competition landscape.</p>
                                      </div>
                                    </TooltipContent>
                                  </Tooltip>
                                </div>
                              </SortableHeader>
                              <SortableHeader field="rank">
                                <div className="flex items-center gap-1">
                                  Rank
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Info className="h-4 w-4 text-red-500 hover:text-red-600 cursor-help" />
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      <div className="max-w-sm text-sm">
                                        <p className="font-medium mb-2">Rising Keyword Rank</p>
                                        <p>Position in the rising keywords ranking for this period. Lower numbers indicate faster growth and higher momentum.</p>
                                      </div>
                                    </TooltipContent>
                                  </Tooltip>
                                </div>
                              </SortableHeader>
                              <SortableHeader field="keyword">
                                <div className="flex items-center gap-1">
                                  Keyword
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Info className="h-4 w-4 text-red-500 hover:text-red-600 cursor-help" />
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      <div className="max-w-sm text-sm">
                                        <p className="font-medium mb-2">Rising Keyword</p>
                                        <p>Search terms experiencing significant growth in popularity. These keywords are trending upward and gaining momentum on TikTok Shop.</p>
                                      </div>
                                    </TooltipContent>
                                  </Tooltip>
                                </div>
                              </SortableHeader>
                              <SortableHeader field="searchVolume">
                                <div className="flex items-center gap-1">
                                  Search Volume
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Info className="h-4 w-4 text-red-500 hover:text-red-600 cursor-help" />
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      <div className="max-w-sm text-sm">
                                        <p className="font-medium mb-2">Monthly Search Volume</p>
                                        <p className="mb-2">Number of searches for this rising keyword in the selected month. Shows current demand level.</p>
                                        <div className="space-y-1">
                                          <p><span className="font-medium text-green-600">High:</span> 5,000+ monthly searches</p>
                                          <p><span className="font-medium text-amber-600">Medium:</span> 2,000-5,000 monthly searches</p>
                                          <p><span className="font-medium text-red-600">Low:</span> Below 2,000 monthly searches</p>
                                        </div>
                                      </div>
                                    </TooltipContent>
                                  </Tooltip>
                                </div>
                              </SortableHeader>
                              <SortableHeader field="productClickScore">
                                <div className="flex items-center gap-1">
                                  Product Click Score
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Info className="h-4 w-4 text-red-500 hover:text-red-600 cursor-help" />
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      <div className="max-w-sm text-sm">
                                        <p className="font-medium mb-2">Product Click Score (Engagement)</p>
                                        <p className="mb-2">How often shoppers clicked products after searching the keyword. Shows if the search results are attractive.</p>
                                        <div className="space-y-1">
                                          <p><span className="font-medium text-green-600">Great:</span> 2,000+ → results grab attention, strong relevance.</p>
                                          <p><span className="font-medium text-amber-600">Okay:</span> 1,100–2,000 → moderate appeal, can improve.</p>
                                          <p><span className="font-medium text-red-600">Poor:</span> Below 1,100 → weak images/titles or irrelevant listings.</p>
                                        </div>
                                      </div>
                                    </TooltipContent>
                                  </Tooltip>
                                </div>
                              </SortableHeader>
                              <SortableHeader field="skuSalesScore">
                                <div className="flex items-center gap-1">
                                  SKU Sales Score
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Info className="h-4 w-4 text-red-500 hover:text-red-600 cursor-help" />
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      <div className="max-w-sm text-sm">
                                        <p className="font-medium mb-2">SKU Sales Score (Conversion)</p>
                                        <p className="mb-2">Estimated purchases after the keyword search. Measures buyer intent, not just curiosity.</p>
                                        <div className="space-y-1">
                                          <p><span className="font-medium text-green-600">Great:</span> 550+ → strong sales conversion.</p>
                                          <p><span className="font-medium text-amber-600">Okay:</span> 300–550 → some sales, room to optimise.</p>
                                          <p><span className="font-medium text-red-600">Poor:</span> Below 300 → interest without buying.</p>
                                        </div>
                                      </div>
                                    </TooltipContent>
                                  </Tooltip>
                                </div>
                              </SortableHeader>
                              <SortableHeader field="availableProducts">
                                <div className="flex items-center gap-1">
                                  Available Products
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Info className="h-4 w-4 text-red-500 hover:text-red-600 cursor-help" />
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      <div className="max-w-sm text-sm">
                                        <p className="font-medium mb-2">Competition Level</p>
                                        <p className="mb-2">Number of products currently listed for this keyword. Indicates market saturation.</p>
                                        <div className="space-y-1">
                                          <p><span className="font-medium text-green-600">Low Competition:</span> Under 100 products</p>
                                          <p><span className="font-medium text-amber-600">Medium:</span> 100-500 products</p>
                                          <p><span className="font-medium text-red-600">High:</span> 500+ products</p>
                                        </div>
                                      </div>
                                    </TooltipContent>
                                  </Tooltip>
                                </div>
                              </SortableHeader>
                              <SortableHeader field="averagePrice">
                                <div className="flex items-center gap-1">
                                  Avg. Price
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Info className="h-4 w-4 text-red-500 hover:text-red-600 cursor-help" />
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      <div className="max-w-sm text-sm">
                                        <p className="font-medium mb-2">Average Product Price</p>
                                        <p>Average price of products in search results for this keyword. Helps determine pricing strategy and market positioning.</p>
                                      </div>
                                    </TooltipContent>
                                  </Tooltip>
                                </div>
                              </SortableHeader>
                              <SortableHeader field="ctrScore">
                                <div className="flex items-center gap-1">
                                  CTR Score
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Info className="h-4 w-4 text-red-500 hover:text-red-600 cursor-help" />
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      <div className="max-w-sm text-sm">
                                        <p className="font-medium mb-2">CTR Score (Click-Through Rate)</p>
                                        <p className="mb-2">% of people who clicked a product after seeing it in search results.</p>
                                        <div className="space-y-1">
                                          <p><span className="font-medium text-green-600">Great:</span> 29%+ → highly enticing images/titles.</p>
                                          <p><span className="font-medium text-amber-600">Okay:</span> 25–29% → average, could improve with better creatives.</p>
                                          <p><span className="font-medium text-red-600">Poor:</span> Below 25% → low appeal or targeting mismatch.</p>
                                        </div>
                                      </div>
                                    </TooltipContent>
                                  </Tooltip>
                                </div>
                              </SortableHeader>
                              <SortableHeader field="ctorScore">
                                <div className="flex items-center gap-1">
                                  CTOR Score
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Info className="h-4 w-4 text-red-500 hover:text-red-600 cursor-help" />
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      <div className="max-w-sm text-sm">
                                        <p className="font-medium mb-2">CTOR Score (Click-To-Order Rate)</p>
                                        <p className="mb-2">% of clicks that led to a purchase. Shows how persuasive your product page is.</p>
                                        <div className="space-y-1">
                                          <p><span className="font-medium text-green-600">Great:</span> 5.5%+ → product page is converting well.</p>
                                          <p><span className="font-medium text-amber-600">Okay:</span> 4.5–5.5% → some conversion, but optimisations needed.</p>
                                          <p><span className="font-medium text-red-600">Poor:</span> Below 4.5% → traffic isn't buying.</p>
                                        </div>
                                      </div>
                                    </TooltipContent>
                                  </Tooltip>
                                </div>
                              </SortableHeader>
                            </>
                          ) : (
                            // Regular columns
                            <>
                              <SortableHeader field="keyword">
                                <div className="flex items-center gap-1">
                                  Keyword
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Info className="h-4 w-4 text-red-500 hover:text-red-600 cursor-help" />
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      <div className="max-w-sm text-sm">
                                        <p className="font-medium mb-2">Search Keyword</p>
                                        <p>The exact search term that customers use when looking for products on TikTok Shop. These are real search queries from actual buyers.</p>
                                      </div>
                                    </TooltipContent>
                                  </Tooltip>
                                </div>
                              </SortableHeader>
                              <SortableHeader field="searchVolume">
                                <div className="flex items-center gap-1">
                                  Search Volume
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Info className="h-4 w-4 text-red-500 hover:text-red-600 cursor-help" />
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      <div className="max-w-sm text-sm">
                                        <p className="font-medium mb-2">Search Volume (Demand)</p>
                                        <p className="mb-2">How many times buyers searched this keyword in the selected period. Higher = more potential demand.</p>
                                        <div className="space-y-1">
                                          <p><span className="font-medium text-green-600">Great:</span> 2,500+ monthly searches → large audience.</p>
                                          <p><span className="font-medium text-amber-600">Okay:</span> 1,300–2,500 → moderate interest, worth testing.</p>
                                          <p><span className="font-medium text-red-600">Poor:</span> Below 1,300 → very niche or low demand.</p>
                                        </div>
                                      </div>
                                    </TooltipContent>
                                  </Tooltip>
                                </div>
                              </SortableHeader>
                              <SortableHeader field="productClickScore">
                                <div className="flex items-center gap-1">
                                  Product Click Score
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Info className="h-4 w-4 text-red-500 hover:text-red-600 cursor-help" />
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      <div className="max-w-sm text-sm">
                                        <p className="font-medium mb-2">Product Click Score (Engagement)</p>
                                        <p className="mb-2">How often shoppers clicked products after searching the keyword. Shows if the search results are attractive.</p>
                                        <div className="space-y-1">
                                          <p><span className="font-medium text-green-600">Great:</span> 2,000+ → results grab attention, strong relevance.</p>
                                          <p><span className="font-medium text-amber-600">Okay:</span> 1,100–2,000 → moderate appeal, can improve.</p>
                                          <p><span className="font-medium text-red-600">Poor:</span> Below 1,100 → weak images/titles or irrelevant listings.</p>
                                        </div>
                                      </div>
                                    </TooltipContent>
                                  </Tooltip>
                                </div>
                              </SortableHeader>
                              <SortableHeader field="skuSalesScore">
                                <div className="flex items-center gap-1">
                                  SKU Sales Score
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Info className="h-4 w-4 text-red-500 hover:text-red-600 cursor-help" />
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      <div className="max-w-sm text-sm">
                                        <p className="font-medium mb-2">SKU Sales Score (Conversion)</p>
                                        <p className="mb-2">Estimated purchases after the keyword search. Measures buyer intent, not just curiosity.</p>
                                        <div className="space-y-1">
                                          <p><span className="font-medium text-green-600">Great:</span> 550+ → strong sales conversion.</p>
                                          <p><span className="font-medium text-amber-600">Okay:</span> 300–550 → some sales, room to optimise.</p>
                                          <p><span className="font-medium text-red-600">Poor:</span> Below 300 → interest without buying.</p>
                                        </div>
                                      </div>
                                    </TooltipContent>
                                  </Tooltip>
                                </div>
                              </SortableHeader>
                              <SortableHeader field="availableProducts">
                                <div className="flex items-center gap-1">
                                  Available Products
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Info className="h-4 w-4 text-red-500 hover:text-red-600 cursor-help" />
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      <div className="max-w-sm text-sm">
                                        <p className="font-medium mb-2">Competition Level</p>
                                        <p className="mb-2">Number of products currently listed for this keyword. Indicates market saturation.</p>
                                        <div className="space-y-1">
                                          <p><span className="font-medium text-green-600">Low Competition:</span> Under 100 products</p>
                                          <p><span className="font-medium text-amber-600">Medium:</span> 100-500 products</p>
                                          <p><span className="font-medium text-red-600">High:</span> 500+ products</p>
                                        </div>
                                      </div>
                                    </TooltipContent>
                                  </Tooltip>
                                </div>
                              </SortableHeader>
                              <SortableHeader field="averagePrice">
                                <div className="flex items-center gap-1">
                                  Avg. Price
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Info className="h-4 w-4 text-red-500 hover:text-red-600 cursor-help" />
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      <div className="max-w-sm text-sm">
                                        <p className="font-medium mb-2">Average Product Price</p>
                                        <p>Average price of products in search results for this keyword. Helps determine pricing strategy and market positioning.</p>
                                      </div>
                                    </TooltipContent>
                                  </Tooltip>
                                </div>
                              </SortableHeader>
                              <SortableHeader field="ctrScore">
                                <div className="flex items-center gap-1">
                                  CTR Score
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Info className="h-4 w-4 text-red-500 hover:text-red-600 cursor-help" />
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      <div className="max-w-sm text-sm">
                                        <p className="font-medium mb-2">CTR Score (Click-Through Rate)</p>
                                        <p className="mb-2">% of people who clicked a product after seeing it in search results.</p>
                                        <div className="space-y-1">
                                          <p><span className="font-medium text-green-600">Great:</span> 29%+ → highly enticing images/titles.</p>
                                          <p><span className="font-medium text-amber-600">Okay:</span> 25–29% → average, could improve with better creatives.</p>
                                          <p><span className="font-medium text-red-600">Poor:</span> Below 25% → low appeal or targeting mismatch.</p>
                                        </div>
                                      </div>
                                    </TooltipContent>
                                  </Tooltip>
                                </div>
                              </SortableHeader>
                              <SortableHeader field="ctorScore">
                                <div className="flex items-center gap-1">
                                  CTOR Score
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Info className="h-4 w-4 text-red-500 hover:text-red-600 cursor-help" />
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      <div className="max-w-sm text-sm">
                                        <p className="font-medium mb-2">CTOR Score (Click-To-Order Rate)</p>
                                        <p className="mb-2">% of clicks that led to a purchase. Shows how persuasive your product page is.</p>
                                        <div className="space-y-1">
                                          <p><span className="font-medium text-green-600">Great:</span> 5.5%+ → product page is converting well.</p>
                                          <p><span className="font-medium text-amber-600">Okay:</span> 4.5–5.5% → some conversion, but optimisations needed.</p>
                                          <p><span className="font-medium text-red-600">Poor:</span> Below 4.5% → traffic isn't buying.</p>
                                        </div>
                                      </div>
                                    </TooltipContent>
                                  </Tooltip>
                                </div>
                              </SortableHeader>
                            </>
                          )}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {searchResults.map((result: KeywordResult, index: number) => (
                          <TableRow 
                            key={result.id} 
                            className="border-b border-gray-100 hover:bg-gray-50"
                            data-testid={`row-keyword-${index}`}
                          >
                            {searchMetric === "high-potential" ? (
                              // HPK row: Category, Keyword, Opportunity score, Search volume, Available products
                              <>
                                <TableCell className="font-medium text-gray-900 text-sm">
                                  {(result as any).category || 'Uncategorized'}
                                </TableCell>
                                <TableCell className="font-medium text-gray-900 text-sm">
                                  {result.keyword}
                                </TableCell>
                                <TableCell className="text-sm font-medium text-orange-600">
                                  {result.skuSalesScore ? parseFloat(result.skuSalesScore).toLocaleString() : '0'}
                                </TableCell>
                                <TableCell className={cn("text-sm font-medium", getVolumeColor(result.searchVolume))}>
                                  {result.searchVolume.toLocaleString()}
                                </TableCell>
                                <TableCell className="text-sm text-gray-600">
                                  {result.availableProducts.toLocaleString()}
                                </TableCell>
                              </>
                            ) : searchMetric === "rising" ? (
                              // RK row: Category, Rank, Keyword, Search Volume, Product Click Score, SKU Sales Score, Available Products, Avg. Price, CTR Score, CTOR Score
                              <>
                                <TableCell className="font-medium text-gray-900 text-sm">
                                  {(result as any).category || 'Uncategorized'}
                                </TableCell>
                                <TableCell className="text-sm font-medium text-purple-600">
                                  {result.rank || '-'}
                                </TableCell>
                                <TableCell className="font-medium text-gray-900 text-sm">
                                  {result.keyword}
                                </TableCell>
                                <TableCell className={cn("text-sm font-medium", getVolumeColor(result.searchVolume))}>
                                  {result.searchVolume.toLocaleString()}
                                </TableCell>
                                <TableCell className="text-sm font-medium text-gray-700">
                                  {parseFloat(result.productClickScore).toLocaleString()}
                                </TableCell>
                                <TableCell className="text-sm font-medium text-orange-600">
                                  {result.skuSalesScore ? parseFloat(result.skuSalesScore).toLocaleString() : '0'}
                                </TableCell>
                                <TableCell className="text-sm text-gray-600">
                                  {result.availableProducts.toLocaleString()}
                                </TableCell>
                                <TableCell className="text-sm font-medium text-green-600">
                                  ${parseFloat(result.averagePrice).toFixed(2)}
                                </TableCell>
                                <TableCell className={cn("text-sm font-medium", getScoreColor(result.ctrScore))}>
                                  {parseFloat(result.ctrScore).toFixed(1)}
                                </TableCell>
                                <TableCell className={cn("text-sm font-medium", getScoreColor(result.ctorScore))}>
                                  {parseFloat(result.ctorScore).toFixed(1)}
                                </TableCell>
                              </>
                            ) : (
                              // Regular row
                              <>
                                <TableCell className="font-medium text-gray-900 text-sm">
                                  {result.keyword}
                                </TableCell>
                                <TableCell className={cn("text-sm font-medium", getVolumeColor(result.searchVolume))}>
                                  {result.searchVolume.toLocaleString()}
                                </TableCell>
                                <TableCell className="text-sm font-medium text-gray-700">
                                  {parseFloat(result.productClickScore).toLocaleString()}
                                </TableCell>
                                <TableCell className="text-sm font-medium text-orange-600">
                                  {result.skuSalesScore ? parseFloat(result.skuSalesScore).toLocaleString() : '0'}
                                </TableCell>
                                <TableCell className="text-sm text-gray-600">
                                  {result.availableProducts.toLocaleString()}
                                </TableCell>
                                <TableCell className="text-sm font-medium text-green-600">
                                  ${parseFloat(result.averagePrice).toFixed(2)}
                                </TableCell>
                                <TableCell className={cn("text-sm font-medium", getScoreColor(result.ctrScore))}>
                                  {parseFloat(result.ctrScore).toFixed(1)}
                                </TableCell>
                                <TableCell className={cn("text-sm font-medium", getScoreColor(result.ctorScore))}>
                                  {parseFloat(result.ctorScore).toFixed(1)}
                                </TableCell>
                              </>
                            )}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>

                {/* Pagination Controls */}
                {pagination && pagination.totalPages > 1 && (
                  <div className="mt-6 flex items-center justify-between">
                    <div className="text-sm text-gray-600">
                      Page {pagination.page} of {pagination.totalPages}
                    </div>
                    <div className="flex items-center space-x-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentPage(1)}
                        disabled={!pagination.hasPrev}
                        data-testid="button-page-first"
                      >
                        First
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentPage(currentPage - 1)}
                        disabled={!pagination.hasPrev}
                        data-testid="button-page-prev"
                      >
                        Previous
                      </Button>
                      
                      {/* Page numbers */}
                      <div className="flex items-center space-x-1">
                        {Array.from({ length: Math.min(5, pagination.totalPages) }, (_, i) => {
                          const pageNum = Math.max(1, Math.min(pagination.totalPages - 4, pagination.page - 2)) + i;
                          if (pageNum > pagination.totalPages) return null;
                          
                          return (
                            <Button
                              key={pageNum}
                              variant={pageNum === pagination.page ? "default" : "outline"}
                              size="sm"
                              onClick={() => setCurrentPage(pageNum)}
                              className={pageNum === pagination.page ? "bg-blue-600 text-white" : ""}
                              data-testid={`button-page-${pageNum}`}
                            >
                              {pageNum}
                            </Button>
                          );
                        })}
                      </div>
                      
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentPage(currentPage + 1)}
                        disabled={!pagination.hasNext}
                        data-testid="button-page-next"
                      >
                        Next
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentPage(pagination.totalPages)}
                        disabled={!pagination.hasNext}
                        data-testid="button-page-last"
                      >
                        Last
                      </Button>
                    </div>
                  </div>
                )}

                {/* Newsletter CTA */}
                <div className="mt-12 bg-gradient-to-r from-blue-50 to-purple-50 rounded-2xl p-8 text-center">
                  <h3 className="text-2xl font-bold text-gray-900 mb-4">
                    Want More Detailed Insights?
                  </h3>
                  <p className="text-gray-600 mb-6 max-w-2xl mx-auto">
                    Send us an email
                  </p>
                  <a 
                    href="mailto:paul@rankster.co"
                    className="gradient-button text-white px-8 py-3 rounded-xl font-semibold inline-block text-center no-underline" 
                    data-testid="button-contact-support"
                  >
                    Contact Support
                  </a>
                </div>

              </>
            )}
          </div>
        )}
      </div>

      {/* Login Modal */}
      <LoginModal
        open={loginModalOpen}
        onClose={closeLoginModal}
        onSubmit={handleLoginSubmit}
      />

      {/* Contact Modal */}
      <ContactModal
        open={contactModalOpen}
        onClose={closeContactModal}
      />

      </div>
    </TooltipProvider>
  );
}