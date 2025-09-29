import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest } from "@/lib/queryClient";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Trash2, Upload, Plus, LogOut, Settings, FileText, Download, Database, Info, RefreshCw, TestTube, AlertCircle, CheckCircle } from "lucide-react";
import Papa from "papaparse";
import { CSVUploadComponent } from "@/components/csv-upload";



interface Keyword {
  id: string;
  keyword: string;
  searchVolume: number;
  productClickScore: string;
  skuSalesScore: string | null;
  availableProducts: number;
  averagePrice: string;
  ctrScore: string;
  ctorScore: string;
  categoryId: string | null;
  uploadPeriod?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export default function AdminPage() {
  const { user, isAuthenticated, isAdmin } = useAuth();
  const { toast } = useToast();


  
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedUploadPeriod, setSelectedUploadPeriod] = useState<string>("");
  const [uploadResult, setUploadResult] = useState<any>(null);
  
  // HPK upload state
  const [hpkFile, setHpkFile] = useState<File | null>(null);
  const hpkFileInputRef = useRef<HTMLInputElement>(null);
  const [hpkUploadResult, setHpkUploadResult] = useState<any>(null);
  
  // RK upload state
  const [rkFile, setRkFile] = useState<File | null>(null);
  const rkFileInputRef = useRef<HTMLInputElement>(null);
  const [rkUploadResult, setRkUploadResult] = useState<any>(null);

  // Upload management state
  interface Upload {
    period: string;
    count: number;
    type: 'regular' | 'hpk' | 'rk';
  }
  const [deletingUpload, setDeletingUpload] = useState<string | null>(null);

  // Redirect if not authenticated or not admin - but wait for auth to load
  useEffect(() => {
    if (!user && !isAuthenticated) {
      window.location.href = "/admin-login";
      return;
    }
    
    // Only show access denied if we have a user but they're not admin
    if (user && isAuthenticated && !isAdmin) {
      toast({
        title: "Access Denied",
        description: "You need admin privileges to access this page.",
        variant: "destructive",
      });
      return;
    }
  }, [user, isAuthenticated, isAdmin, toast]);



  // Fetch keywords with upload period filtering
  const { data: keywords = [], isLoading: keywordsLoading } = useQuery<Keyword[]>({
    queryKey: ["/api/admin/keywords", selectedUploadPeriod],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedUploadPeriod) {
        params.append('uploadPeriod', selectedUploadPeriod);
      }
      const url = `/api/admin/keywords${params.toString() ? `?${params}` : ''}`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error('Failed to fetch keywords');
      }
      return response.json();
    },
    enabled: isAuthenticated && isAdmin,
  });

  // Get unique upload periods for filtering
  const { data: uploadPeriods = [] } = useQuery<string[]>({
    queryKey: ["/api/admin/upload-periods"],
    queryFn: async (): Promise<string[]> => {
      const response = await fetch('/api/admin/keywords?limit=1000');
      if (!response.ok) throw new Error('Failed to fetch keywords');
      const allKeywords: Keyword[] = await response.json();
      const periods = Array.from(new Set(
        allKeywords
          .filter((k) => k.uploadPeriod)
          .map((k) => k.uploadPeriod!)
      )).sort().reverse();
      return periods as string[];
    },
    enabled: isAuthenticated && isAdmin,
  });

  // Fetch all uploads for management
  const { data: uploads = [], isLoading: uploadsLoading, refetch: refetchUploads } = useQuery<Upload[]>({
    queryKey: ["/api/admin/uploads"],
    enabled: isAuthenticated && isAdmin,
  });





  // Delete keyword mutation
  const deleteKeywordMutation = useMutation({
    mutationFn: async (keywordId: string) => {
      return apiRequest(`/api/admin/keywords/${keywordId}`, "DELETE");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/keywords"] });
      toast({
        title: "Keyword Deleted",
        description: "Keyword has been deleted successfully.",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete keyword",
        variant: "destructive",
      });
    },
  });

  // CSV Upload mutation
  const uploadCsvMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('csvFile', file);
      
      const response = await fetch('/api/admin/keywords/upload-csv', {
        method: 'POST',
        body: formData,
        // Add timeout for large files (5 minutes)
        signal: AbortSignal.timeout(5 * 60 * 1000)
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to upload CSV');
      }
      
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/keywords"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/upload-periods"] });
      setUploadResult(data);
      
      if (data.imported > 0) {
        toast({
          title: "CSV Upload Successful",
          description: `Successfully imported ${data.imported.toLocaleString()} keywords from CSV file.`,
        });
      } else {
        toast({
          title: "CSV Upload Issues",
          description: `No keywords were imported. Please check the file format and data.`,
          variant: "destructive",
        });
      }
      
      setCsvFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    },
    onError: (error) => {
      setUploadResult(null);
      toast({
        title: "CSV Upload Failed",
        description: error.message || "Failed to upload CSV file",
        variant: "destructive",
      });
    },
  });

  // HPK Upload mutation
  const uploadHpkMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('hpkFile', file);
      
      const response = await fetch('/api/admin/keywords/upload-hpk', {
        method: 'POST',
        body: formData,
        signal: AbortSignal.timeout(5 * 60 * 1000)
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to upload HPK file');
      }
      
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/keywords"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/upload-periods"] });
      setHpkUploadResult(data);
      
      if (data.imported > 0) {
        toast({
          title: "HPK Upload Successful",
          description: `Successfully imported ${data.imported.toLocaleString()} high-potential keywords.`,
        });
      } else {
        toast({
          title: "HPK Upload Issues", 
          description: `No keywords were imported. Please check the file format and data.`,
          variant: "destructive",
        });
      }
      
      setHpkFile(null);
      if (hpkFileInputRef.current) {
        hpkFileInputRef.current.value = '';
      }
    },
    onError: (error) => {
      setHpkUploadResult(null);
      toast({
        title: "HPK Upload Failed",
        description: error.message || "Failed to upload HPK file",
        variant: "destructive",
      });
    },
  });

  // RK Upload mutation
  const uploadRkMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('rkFile', file);
      
      const response = await fetch('/api/admin/keywords/upload-rk', {
        method: 'POST',
        body: formData,
        signal: AbortSignal.timeout(5 * 60 * 1000)
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to upload RK file');
      }
      
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/keywords"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/upload-periods"] });
      setRkUploadResult(data);
      
      if (data.imported > 0) {
        toast({
          title: "RK Upload Successful",
          description: `Successfully imported ${data.imported.toLocaleString()} rising keywords.`,
        });
      } else {
        toast({
          title: "RK Upload Issues", 
          description: `No keywords were imported. Please check the file format and data.`,
          variant: "destructive",
        });
      }
      
      setRkFile(null);
      if (rkFileInputRef.current) {
        rkFileInputRef.current.value = '';
      }
    },
    onError: (error) => {
      setRkUploadResult(null);
      toast({
        title: "RK Upload Failed",
        description: error.message || "Failed to upload RK file",
        variant: "destructive",
      });
    },
  });

  // Delete upload mutation
  const deleteUploadMutation = useMutation({
    mutationFn: async ({ period, type }: { period: string; type: string }) => {
      return apiRequest(`/api/admin/uploads/${period}/${type}`, "DELETE");
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/uploads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/keywords"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/upload-periods"] });
      refetchUploads();
      setDeletingUpload(null);
      
      toast({
        title: "Upload Deleted",
        description: (data as any)?.message || "Upload deleted successfully",
      });
    },
    onError: (error) => {
      setDeletingUpload(null);
      toast({
        title: "Delete Failed",
        description: error.message || "Failed to delete upload",
        variant: "destructive",
      });
    },
  });





  const handleDeleteKeyword = (keywordId: string) => {
    if (confirm("Are you sure you want to delete this keyword?")) {
      deleteKeywordMutation.mutate(keywordId);
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && file.type === 'text/csv') {
      setCsvFile(file);
    } else {
      toast({
        title: "Invalid File",
        description: "Please select a valid CSV file.",
        variant: "destructive",
      });
    }
  };

  const handleCsvUpload = () => {
    if (!csvFile) {
      toast({
        title: "No File Selected",
        description: "Please select a CSV file to upload.",
        variant: "destructive",
      });
      return;
    }
    uploadCsvMutation.mutate(csvFile);
  };

  const handleHpkFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && file.type === 'text/csv') {
      // Validate HPK filename format
      const filename = file.name.toLowerCase();
      if (!filename.startsWith('hpk-') || !filename.endsWith('.csv')) {
        toast({
          title: "Invalid HPK File Name",
          description: "HPK files must follow the format: HPK-YYYYMM.csv (e.g., HPK-202508.csv)",
          variant: "destructive",
        });
        return;
      }
      setHpkFile(file);
    } else {
      toast({
        title: "Invalid File",
        description: "Please select a valid CSV file.",
        variant: "destructive",
      });
    }
  };

  const handleHpkUpload = () => {
    if (!hpkFile) {
      toast({
        title: "No HPK File Selected",
        description: "Please select an HPK file to upload.",
        variant: "destructive",
      });
      return;
    }
    uploadHpkMutation.mutate(hpkFile);
  };

  const handleRkFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && file.type === 'text/csv') {
      // Validate RK filename format
      const filename = file.name.toLowerCase();
      if (!filename.startsWith('rk-') || !filename.endsWith('.csv')) {
        toast({
          title: "Invalid RK File Name",
          description: "RK files must follow the format: RK-YYYYMM.csv (e.g., RK-202508.csv)",
          variant: "destructive",
        });
        return;
      }
      setRkFile(file);
    } else {
      toast({
        title: "Invalid File",
        description: "Please select a valid CSV file.",
        variant: "destructive",
      });
    }
  };

  const handleRkUpload = () => {
    if (!rkFile) {
      toast({
        title: "No RK File Selected",
        description: "Please select an RK file to upload.",
        variant: "destructive",
      });
      return;
    }
    uploadRkMutation.mutate(rkFile);
  };

  const handleDeleteUpload = (period: string, type: string) => {
    if (confirm(`Are you sure you want to delete all ${type.toUpperCase()} keywords from period ${period}? This action cannot be undone.`)) {
      setDeletingUpload(`${period}-${type}`);
      deleteUploadMutation.mutate({ period, type });
    }
  };

  const downloadSampleCsv = () => {
    const headers = [
      'Category',
      'Sub Category 1',
      'Sub Category 2',
      'Rank',
      'Keyword',
      'Search volume',
      'Product click score',
      'SKU sales score',
      'Available products',
      'Avg. price',
      'CTR score',
      'CTOR score'
    ];
    
    const sampleData = [
      [
        'Electronics',
        'Audio',
        'Earbuds',
        '1',
        'wireless earbuds',
        '15000',
        '8.5',
        '7.8',
        '250',
        '49.99',
        '7.2',
        '6.8'
      ],
      [
        'Accessories',
        'Phone',
        'Cases',
        '2',
        'phone case',
        '8500',
        '7.3',
        '6.9',
        '180',
        '24.99',
        '6.9',
        '7.1'
      ]
    ];

    const csvContent = [headers, ...sampleData]
      .map(row => row.map(field => `"${field}"`).join(','))
      .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', 'keywords_sample.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Show different states based on auth status
  if (!user || !isAuthenticated) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading admin panel...</p>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">Access Restricted</h1>
          <p className="text-muted-foreground mb-6">Admin privileges required</p>
          <Button onClick={() => window.location.href = "/admin-login"}>
            Sign In
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
      <header className="border-b bg-white/80 backdrop-blur-sm">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Settings className="h-8 w-8 text-blue-600" />
              <div>
                <h1 className="text-2xl font-bold">Rankster Admin</h1>
                <p className="text-sm text-muted-foreground">Data Management Dashboard</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <p className="text-sm font-medium">{user?.firstName} {user?.lastName}</p>
                <p className="text-xs text-muted-foreground">{user?.email}</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => window.location.href = "/"}>
                Back to Site
              </Button>
              <Button variant="outline" size="sm" onClick={async () => {
                await apiRequest("/api/admin/logout", "POST");
                queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
                window.location.href = "/admin-login";
              }}>
                <LogOut className="h-4 w-4 mr-2" />
                Sign Out
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-6 py-8">
        <Tabs defaultValue="statistics" className="space-y-6">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="statistics">Usage Statistics</TabsTrigger>
            <TabsTrigger value="csv-upload">CSV Upload</TabsTrigger>
            <TabsTrigger value="uploads">Uploads</TabsTrigger>
          </TabsList>

          <TabsContent value="statistics" className="space-y-6">
            <div className="grid gap-6">
              {/* Overview Stats */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Database className="h-5 w-5 text-blue-600" />
                    Usage Overview (Last 30 Days)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <UsageOverview />
                </CardContent>
              </Card>

              {/* Beehiiv Sync Tools */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <RefreshCw className="h-5 w-5 text-orange-600" />
                    Beehiiv Newsletter Sync
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Sync local newsletter subscribers with Beehiiv. Use this if you notice discrepancies between local and Beehiiv subscriber counts.
                  </p>
                </CardHeader>
                <CardContent>
                  <BeehiivSyncTools />
                </CardContent>
              </Card>

              {/* Daily Stats */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    Daily Usage Statistics
                    <Tooltip>
                      <TooltipTrigger>
                        <Info className="h-4 w-4 text-gray-500 hover:text-blue-600" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Daily breakdown of user sessions, unique visitors, activities, and email addresses over time</p>
                      </TooltipContent>
                    </Tooltip>
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    View daily usage patterns including sessions, unique users, and activities
                  </p>
                </CardHeader>
                <CardContent>
                  <DailyUsageStats />
                </CardContent>
              </Card>

              {/* Weekly Stats */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    Weekly Usage Statistics
                    <Tooltip>
                      <TooltipTrigger>
                        <Info className="h-4 w-4 text-gray-500 hover:text-blue-600" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Weekly aggregated user sessions, unique visitors, and activity counts grouped by week starting date</p>
                      </TooltipContent>
                    </Tooltip>
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Weekly aggregated usage data with user email addresses
                  </p>
                </CardHeader>
                <CardContent>
                  <WeeklyUsageStats />
                </CardContent>
              </Card>

              {/* Monthly Stats */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    Monthly Usage Statistics
                    <Tooltip>
                      <TooltipTrigger>
                        <Info className="h-4 w-4 text-gray-500 hover:text-blue-600" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Monthly aggregated statistics showing user engagement trends, sessions, and activity patterns over time</p>
                      </TooltipContent>
                    </Tooltip>
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Monthly usage trends and user engagement data
                  </p>
                </CardHeader>
                <CardContent>
                  <MonthlyUsageStats />
                </CardContent>
              </Card>

              {/* Activity Breakdown */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    Activity Breakdown
                    <Tooltip>
                      <TooltipTrigger>
                        <Info className="h-4 w-4 text-gray-500 hover:text-blue-600" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Categories of user activities (page views, searches, logins, uploads) and their frequency counts</p>
                      </TooltipContent>
                    </Tooltip>
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Different types of user activities and their frequency
                  </p>
                </CardHeader>
                <CardContent>
                  <ActivityBreakdown />
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="csv-upload" className="space-y-6">
            <CSVUploadComponent />
          </TabsContent>
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="2025-08">August 2025</SelectItem>
                              <SelectItem value="2025-07">July 2025</SelectItem>
                              <SelectItem value="2025-06">June 2025</SelectItem>
                              <SelectItem value="2025-05">May 2025</SelectItem>
                              <SelectItem value="2025-04">April 2025</SelectItem>
                              <SelectItem value="2025-03">March 2025</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        
                        <div className="flex gap-2 justify-center">
                          <Button
                            onClick={handleCsvUpload}
                            disabled={uploadCsvMutation.isPending || !selectedUploadPeriod}
                            className="flex items-center gap-2"
                            data-testid="button-upload-csv"
                          >
                            {uploadCsvMutation.isPending ? (
                              <>
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                                Processing file...
                              </>
                            ) : (
                              <>
                                <Upload className="h-4 w-4" />
                                Upload File
                              </>
                            )}
                          </Button>
                          
                          <Button
                            variant="outline"
                            onClick={() => {
                              setCsvFile(null);
                              setSelectedUploadPeriod("");
                              if (fileInputRef.current) {
                                fileInputRef.current.value = '';
                              }
                            }}
                            disabled={uploadCsvMutation.isPending}
                            data-testid="button-clear-csv"
                          >
                            Clear
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <Button
                        variant="outline"
                        onClick={() => fileInputRef.current?.click()}
                        className="flex items-center gap-2"
                        data-testid="button-select-csv"
                      >
                        <Upload className="h-4 w-4" />
                        Choose File
                      </Button>
                    )}
                  </div>
                </div>
                
                {uploadResult && (
                  <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="font-semibold text-blue-800">Upload Results</h4>
                    </div>
                    <div className="text-sm text-blue-700 space-y-2">
                      <p><strong>Processed:</strong> {uploadResult.processed} rows</p>
                      <p><strong>Imported:</strong> {uploadResult.imported} keywords</p>
                      <p><strong>Skipped:</strong> {uploadResult.skipped} rows</p>
                      {uploadResult.errors && uploadResult.errors.length > 0 && (
                        <details className="mt-3">
                          <summary className="cursor-pointer text-red-700 font-medium">
                            View Issues ({uploadResult.errors.length})
                          </summary>
                          <div className="mt-2 bg-white p-3 rounded border max-h-32 overflow-y-auto">
                            <ul className="text-red-600 text-xs space-y-1">
                              {uploadResult.errors.slice(0, 10).map((error: string, index: number) => (
                                <li key={index} className="font-mono">{error}</li>
                              ))}
                              {uploadResult.errors.length > 10 && (
                                <li className="text-gray-600 italic">
                                  ... and {uploadResult.errors.length - 10} more issues
                                </li>
                              )}
                            </ul>
                          </div>
                        </details>
                      )}
                    </div>
                    <div className="mt-3">
                      <button
                        onClick={() => setUploadResult(null)}
                        className="text-sm text-gray-600 hover:text-gray-800 underline"
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="hpk-upload" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Upload className="h-5 w-5" />
                  HPK File Upload
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Upload High-Potential Keyword (HPK) files with weekly data naming convention: HPK-YYYYMMDD.csv
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <h4 className="font-semibold text-blue-800 mb-2">HPK File Naming Convention</h4>
                  <ul className="text-sm text-blue-700 space-y-1">
                    <li>• Files must start with "HPK-" followed by year, month, and day</li>
                    <li>• Format: <code className="bg-blue-100 px-1 rounded">HPK-YYYYMMDD.csv</code></li>
                    <li>• Example: <code className="bg-blue-100 px-1 rounded">HPK-20250714.csv</code> for July 14, 2025</li>
                    <li>• Example: <code className="bg-blue-100 px-1 rounded">HPK-20251025.csv</code> for October 25, 2025</li>
                    <li>• Contains weekly HPK data with 5 specific columns</li>
                  </ul>
                </div>
                
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-6">
                  <input
                    type="file"
                    ref={hpkFileInputRef}
                    accept=".csv"
                    onChange={handleHpkFileSelect}
                    className="hidden"
                    data-testid="input-hpk-file"
                  />
                  
                  <div className="text-center">
                    <FileText className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                    <h3 className="text-lg font-medium mb-2">Select HPK File</h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      Upload an HPK CSV file with high-potential keyword data.
                    </p>
                    
                    {hpkFile ? (
                      <div className="space-y-4">
                        <div className="bg-green-50 border border-green-200 rounded-md p-3">
                          <p className="text-sm font-medium text-green-800">
                            Selected HPK file: {hpkFile.name}
                          </p>
                          <p className="text-xs text-green-600">
                            Size: {(hpkFile.size / 1024).toFixed(2)} KB
                          </p>
                        </div>
                        
                        <div className="flex gap-2 justify-center">
                          <Button
                            onClick={handleHpkUpload}
                            disabled={uploadHpkMutation.isPending}
                            className="flex items-center gap-2"
                            data-testid="button-upload-hpk"
                          >
                            {uploadHpkMutation.isPending ? (
                              <>
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                                Processing HPK file...
                              </>
                            ) : (
                              <>
                                <Upload className="h-4 w-4" />
                                Upload HPK File
                              </>
                            )}
                          </Button>
                          
                          <Button
                            variant="outline"
                            onClick={() => {
                              setHpkFile(null);
                              if (hpkFileInputRef.current) {
                                hpkFileInputRef.current.value = '';
                              }
                            }}
                            disabled={uploadHpkMutation.isPending}
                            data-testid="button-clear-hpk"
                          >
                            Clear
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <Button
                        variant="outline"
                        onClick={() => hpkFileInputRef.current?.click()}
                        className="flex items-center gap-2"
                        data-testid="button-select-hpk"
                      >
                        <Upload className="h-4 w-4" />
                        Choose HPK File
                      </Button>
                    )}
                  </div>
                </div>
                
                {hpkUploadResult && (
                  <div className={`p-4 rounded-lg border ${
                    hpkUploadResult.imported > 0 
                      ? 'bg-green-50 border-green-200' 
                      : 'bg-red-50 border-red-200'
                  }`}>
                    <div className="flex items-center mb-2">
                      {hpkUploadResult.imported > 0 ? (
                        <div className="flex items-center text-green-800">
                          <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                          </svg>
                          <span className="font-semibold">HPK Upload Successful!</span>
                        </div>
                      ) : (
                        <div className="flex items-center text-red-800">
                          <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                          </svg>
                          <span className="font-semibold">HPK Upload Issues Found</span>
                        </div>
                      )}
                    </div>
                    <p className={hpkUploadResult.imported > 0 ? 'text-green-800' : 'text-red-800'}>
                      <strong>{hpkUploadResult.imported.toLocaleString()}</strong> high-potential keywords imported successfully out of <strong>{hpkUploadResult.total.toLocaleString()}</strong> total records.
                    </p>
                    {hpkUploadResult.errors && hpkUploadResult.errors.length > 0 && (
                      <div className="mt-3">
                        <p className="text-red-800 font-semibold mb-2">Issues found:</p>
                        <div className="bg-white p-3 rounded border max-h-40 overflow-y-auto">
                          <ul className="text-red-700 text-sm space-y-1">
                            {hpkUploadResult.errors.map((error: string, index: number) => (
                              <li key={index} className="font-mono text-xs">{error}</li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    )}
                    {hpkUploadResult.imported > 0 && (
                      <div className="mt-3 text-green-700 text-sm">
                        High-potential keywords are now available for search and marked with HPK status.
                      </div>
                    )}
                    <div className="mt-3">
                      <button
                        onClick={() => setHpkUploadResult(null)}
                        className="text-sm text-gray-600 hover:text-gray-800 underline"
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                )}
                
                <div className="text-xs text-muted-foreground">
                  <p><strong>HPK File Format:</strong></p>
                  <p>Same CSV format as regular keyword files, but these will be marked as high-potential keywords for the "High-potential keyword" search metric.</p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="rk-upload" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Upload className="h-5 w-5" />
                  RK File Upload
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Upload Rising Keyword (RK) files with naming convention: RK-YYYYMM.csv
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                  <h4 className="font-semibold text-purple-800 mb-2">RK File Naming Convention</h4>
                  <ul className="text-sm text-purple-700 space-y-1">
                    <li>• Files must start with "RK-" followed by year and month</li>
                    <li>• Format: <code className="bg-purple-100 px-1 rounded">RK-YYYYMM.csv</code></li>
                    <li>• Example: <code className="bg-purple-100 px-1 rounded">RK-202508.csv</code> for August 2025</li>
                    <li>• Example: <code className="bg-purple-100 px-1 rounded">RK-202512.csv</code> for December 2025</li>
                  </ul>
                </div>
                
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-6">
                  <input
                    type="file"
                    ref={rkFileInputRef}
                    accept=".csv"
                    onChange={handleRkFileSelect}
                    className="hidden"
                    data-testid="input-rk-file"
                  />
                  
                  <div className="text-center">
                    <FileText className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                    <h3 className="text-lg font-medium mb-2">Select RK File</h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      Upload an RK CSV file with rising keyword data.
                    </p>
                    
                    {rkFile ? (
                      <div className="space-y-4">
                        <div className="bg-green-50 border border-green-200 rounded-md p-3">
                          <p className="text-sm font-medium text-green-800">
                            Selected RK file: {rkFile.name}
                          </p>
                          <p className="text-xs text-green-600">
                            Size: {(rkFile.size / 1024).toFixed(2)} KB
                          </p>
                        </div>
                        
                        <div className="flex gap-2 justify-center">
                          <Button
                            onClick={handleRkUpload}
                            disabled={uploadRkMutation.isPending}
                            className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700"
                            data-testid="button-upload-rk"
                          >
                            {uploadRkMutation.isPending ? (
                              <>
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                                Uploading RK...
                              </>
                            ) : (
                              <>
                                <Upload className="h-4 w-4" />
                                Upload RK File
                              </>
                            )}
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => {
                              setRkFile(null);
                              if (rkFileInputRef.current) {
                                rkFileInputRef.current.value = '';
                              }
                            }}
                            data-testid="button-clear-rk"
                          >
                            Clear
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <Button
                        variant="outline"
                        onClick={() => rkFileInputRef.current?.click()}
                        className="border-dashed border-2 px-8 py-6"
                        data-testid="button-select-rk-file"
                      >
                        <FileText className="h-5 w-5 mr-2" />
                        Choose RK File
                      </Button>
                    )}
                  </div>
                </div>

                {rkUploadResult && (
                  <div className={`p-4 rounded-lg border ${rkUploadResult.imported > 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                    <div className="flex items-center gap-2 mb-2">
                      {rkUploadResult.imported > 0 ? (
                        <div className="flex items-center text-green-800">
                          <span className="font-semibold">RK Upload Successful</span>
                        </div>
                      ) : (
                        <div className="flex items-center text-red-800">
                          <span className="font-semibold">RK Upload Issues Found</span>
                        </div>
                      )}
                    </div>
                    <p className={rkUploadResult.imported > 0 ? 'text-green-800' : 'text-red-800'}>
                      <strong>{rkUploadResult.imported.toLocaleString()}</strong> rising keywords imported successfully out of <strong>{rkUploadResult.total.toLocaleString()}</strong> total records.
                    </p>
                    {rkUploadResult.errors && rkUploadResult.errors.length > 0 && (
                      <div className="mt-3">
                        <p className="text-red-800 font-semibold mb-2">Issues found:</p>
                        <div className="bg-white p-3 rounded border max-h-40 overflow-y-auto">
                          <ul className="text-red-700 text-sm space-y-1">
                            {rkUploadResult.errors.map((error: string, index: number) => (
                              <li key={index} className="font-mono text-xs">{error}</li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    )}
                    {rkUploadResult.imported > 0 && (
                      <div className="mt-3 text-green-700 text-sm">
                        Rising keywords are now available for search and marked with RK status.
                      </div>
                    )}
                    <div className="mt-3">
                      <button
                        onClick={() => setRkUploadResult(null)}
                        className="text-sm text-gray-600 hover:text-gray-800 underline"
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                )}
                
                <div className="text-xs text-muted-foreground">
                  <p><strong>RK File Format:</strong></p>
                  <p>RK files contain 10 columns: Category, Rank, Keyword, Search volume, Product click score, SKU sales score, Available products, Avg. price, CTR score, CTOR score. These will be marked as rising keywords for the "Rising keyword" search metric.</p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>



          <TabsContent value="uploads" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Database className="h-5 w-5" />
                  Upload Management
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  View and manage all uploaded keyword data by period and type
                </p>
              </CardHeader>
              <CardContent>
                {uploadsLoading ? (
                  <div className="text-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
                    <p className="text-muted-foreground">Loading uploads...</p>
                  </div>
                ) : uploads.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    No uploads found. Upload some keyword data to get started.
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {uploads.map((upload) => (
                        <Card key={`${upload.period}-${upload.type}`} className="relative">
                          <CardContent className="p-4">
                            <div className="flex items-start justify-between">
                              <div className="space-y-2">
                                <div className="flex items-center gap-2">
                                  <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                                    upload.type === 'regular' ? 'bg-blue-100 text-blue-800' :
                                    upload.type === 'hpk' ? 'bg-green-100 text-green-800' :
                                    'bg-purple-100 text-purple-800'
                                  }`}>
                                    {upload.type.toUpperCase()}
                                  </span>
                                </div>
                                <h3 className="font-semibold text-lg">{upload.period}</h3>
                                <p className="text-sm text-muted-foreground">
                                  {upload.count.toLocaleString()} keywords
                                </p>
                              </div>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleDeleteUpload(upload.period, upload.type)}
                                disabled={deletingUpload === `${upload.period}-${upload.type}` || deleteUploadMutation.isPending}
                                className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                data-testid={`button-delete-upload-${upload.period}-${upload.type}`}
                              >
                                {deletingUpload === `${upload.period}-${upload.type}` ? (
                                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-red-600"></div>
                                ) : (
                                  <Trash2 className="h-4 w-4" />
                                )}
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

// Usage Statistics Components
function UsageOverview() {
  const { data: overview, isLoading } = useQuery({
    queryKey: ["/api/admin/stats/overview"],
    enabled: true,
  });

  if (isLoading) {
    return <div className="animate-pulse h-32 bg-gray-100 rounded"></div>;
  }

  const stats = overview as any;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <div className="bg-blue-50 p-4 rounded-lg">
        <div className="flex items-center gap-2 mb-2">
          <h3 className="text-sm font-medium text-blue-800">Total Sessions</h3>
          <Tooltip>
            <TooltipTrigger>
              <Info className="h-3 w-3 text-blue-600 hover:text-blue-800" />
            </TooltipTrigger>
            <TooltipContent>
              <p>Number of individual user visits to the application during the time period</p>
            </TooltipContent>
          </Tooltip>
        </div>
        <p className="text-2xl font-bold text-blue-900" data-testid="total-sessions">
          {stats?.totalSessions || 0}
        </p>
      </div>
      <div className="bg-green-50 p-4 rounded-lg">
        <div className="flex items-center gap-2 mb-2">
          <h3 className="text-sm font-medium text-green-800">Unique Users</h3>
          <Tooltip>
            <TooltipTrigger>
              <Info className="h-3 w-3 text-green-600 hover:text-green-800" />
            </TooltipTrigger>
            <TooltipContent>
              <p>Number of distinct individuals who have visited the application, counted by unique user ID</p>
            </TooltipContent>
          </Tooltip>
        </div>
        <p className="text-2xl font-bold text-green-900" data-testid="total-users">
          {stats?.totalUniqueUsers || 0}
        </p>
      </div>
      <div className="bg-purple-50 p-4 rounded-lg">
        <div className="flex items-center gap-2 mb-2">
          <h3 className="text-sm font-medium text-purple-800">Total Activities</h3>
          <Tooltip>
            <TooltipTrigger>
              <Info className="h-3 w-3 text-purple-600 hover:text-purple-800" />
            </TooltipTrigger>
            <TooltipContent>
              <p>Total count of user actions including page views, searches, logins, and uploads</p>
            </TooltipContent>
          </Tooltip>
        </div>
        <p className="text-2xl font-bold text-purple-900" data-testid="total-activities">
          {stats?.totalActivities || 0}
        </p>
      </div>
      <div className="bg-yellow-50 p-4 rounded-lg">
        <div className="flex items-center gap-2 mb-2">
          <h3 className="text-sm font-medium text-yellow-800">Registered Emails</h3>
          <Tooltip>
            <TooltipTrigger>
              <Info className="h-3 w-3 text-yellow-600 hover:text-yellow-800" />
            </TooltipTrigger>
            <TooltipContent>
              <p>Number of email addresses that have been registered or used in the application</p>
            </TooltipContent>
          </Tooltip>
        </div>
        <p className="text-2xl font-bold text-yellow-900" data-testid="total-emails">
          {stats?.uniqueEmails?.length || 0}
        </p>
      </div>
    </div>
  );
}

function DailyUsageStats() {
  const { data: dailyStats, isLoading } = useQuery({
    queryKey: ["/api/admin/stats/daily"],
    enabled: true,
  });

  if (isLoading) {
    return <div className="animate-pulse h-48 bg-gray-100 rounded"></div>;
  }

  const stats = (dailyStats as any[]) || [];

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Sessions</TableHead>
              <TableHead>Unique Users</TableHead>
              <TableHead>Activities</TableHead>
              <TableHead>Email Addresses</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {stats.slice(0, 10).map((day: any, index: number) => (
              <TableRow key={day.date} data-testid={`daily-row-${index}`}>
                <TableCell className="font-medium">{day.date}</TableCell>
                <TableCell>{day.sessions}</TableCell>
                <TableCell>{day.uniqueUsers}</TableCell>
                <TableCell>{day.activities}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {day.emails?.slice(0, 3).map((email: string, emailIndex: number) => (
                      <Badge key={emailIndex} variant="secondary" className="text-xs">
                        {email}
                      </Badge>
                    ))}
                    {day.emails?.length > 3 && (
                      <Badge variant="outline" className="text-xs">
                        +{day.emails.length - 3}
                      </Badge>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function WeeklyUsageStats() {
  const { data: weeklyStats, isLoading } = useQuery({
    queryKey: ["/api/admin/stats/weekly"],
    enabled: true,
  });

  if (isLoading) {
    return <div className="animate-pulse h-48 bg-gray-100 rounded"></div>;
  }

  const stats = (weeklyStats as any[]) || [];

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Week Starting</TableHead>
              <TableHead>Sessions</TableHead>
              <TableHead>Unique Users</TableHead>
              <TableHead>Activities</TableHead>
              <TableHead>Email Addresses</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {stats.slice(0, 8).map((week: any, index: number) => (
              <TableRow key={week.week} data-testid={`weekly-row-${index}`}>
                <TableCell className="font-medium">{week.week}</TableCell>
                <TableCell>{week.sessions}</TableCell>
                <TableCell>{week.uniqueUsers}</TableCell>
                <TableCell>{week.activities}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {week.emails?.slice(0, 3).map((email: string, emailIndex: number) => (
                      <Badge key={emailIndex} variant="secondary" className="text-xs">
                        {email}
                      </Badge>
                    ))}
                    {week.emails?.length > 3 && (
                      <Badge variant="outline" className="text-xs">
                        +{week.emails.length - 3}
                      </Badge>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function MonthlyUsageStats() {
  const { data: monthlyStats, isLoading } = useQuery({
    queryKey: ["/api/admin/stats/monthly"],
    enabled: true,
  });

  if (isLoading) {
    return <div className="animate-pulse h-48 bg-gray-100 rounded"></div>;
  }

  const stats = (monthlyStats as any[]) || [];

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Month</TableHead>
              <TableHead>Sessions</TableHead>
              <TableHead>Unique Users</TableHead>
              <TableHead>Activities</TableHead>
              <TableHead>Email Addresses</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {stats.slice(0, 12).map((month: any, index: number) => (
              <TableRow key={month.month} data-testid={`monthly-row-${index}`}>
                <TableCell className="font-medium">{month.month}</TableCell>
                <TableCell>{month.sessions}</TableCell>
                <TableCell>{month.uniqueUsers}</TableCell>
                <TableCell>{month.activities}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {month.emails?.slice(0, 3).map((email: string, emailIndex: number) => (
                      <Badge key={emailIndex} variant="secondary" className="text-xs">
                        {email}
                      </Badge>
                    ))}
                    {month.emails?.length > 3 && (
                      <Badge variant="outline" className="text-xs">
                        +{month.emails.length - 3}
                      </Badge>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function ActivityBreakdown() {
  const { data: activities, isLoading } = useQuery({
    queryKey: ["/api/admin/stats/activities"],
    enabled: true,
  });

  if (isLoading) {
    return <div className="animate-pulse h-48 bg-gray-100 rounded"></div>;
  }

  const stats = (activities as any[]) || [];

  return (
    <div className="space-y-4">
      <div className="grid gap-4">
        {stats.map((activity: any, index: number) => (
          <div 
            key={activity.activityType} 
            className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
            data-testid={`activity-${index}`}
          >
            <div>
              <h4 className="font-medium capitalize">
                {activity.activityType.replace(/_/g, ' ')}
              </h4>
              <p className="text-sm text-gray-600">Activity Type</p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-blue-600">{activity.count}</p>
              <p className="text-sm text-gray-600">Total Count</p>
            </div>
          </div>
        ))}
        
        {stats.length === 0 && (
          <div className="text-center py-8 text-gray-500">
            No activity data available yet. Start using the app to see statistics.
          </div>
        )}
      </div>
    </div>
  );
}

function BeehiivSyncTools() {
  const [isTestingSync, setIsTestingSync] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [testEmail, setTestEmail] = useState('test@example.com');
  const [syncResult, setSyncResult] = useState<any>(null);
  const [testResult, setTestResult] = useState<any>(null);

  const { toast } = useToast();

  const handleTestSync = async () => {
    if (!testEmail) {
      toast({
        title: "Error",
        description: "Please enter a test email address",
        variant: "destructive",
      });
      return;
    }

    setIsTestingSync(true);
    setTestResult(null);

    try {
      const response = await fetch('/api/admin/test-beehiiv', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: testEmail }),
      });

      const result = await response.json();
      setTestResult(result);

      if (result.success) {
        toast({
          title: "Test Successful",
          description: `Successfully added ${testEmail} to Beehiiv newsletter`,
        });
      } else {
        toast({
          title: "Test Failed",
          description: result.error || "Unknown error occurred",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error('Test error:', error);
      toast({
        title: "Test Failed",
        description: "Network error occurred",
        variant: "destructive",
      });
    } finally {
      setIsTestingSync(false);
    }
  };

  const handleFullSync = async () => {
    setIsSyncing(true);
    setSyncResult(null);

    try {
      const response = await fetch('/api/admin/sync-beehiiv', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const result = await response.json();
      setSyncResult(result);

      if (result.results?.success > 0) {
        toast({
          title: "Sync Completed",
          description: `Successfully synced ${result.results.success} out of ${result.results.total} subscribers`,
        });
      } else {
        toast({
          title: "Sync Issues",
          description: "No subscribers were successfully synced. Check the details below.",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error('Sync error:', error);
      toast({
        title: "Sync Failed",
        description: "Network error occurred during sync",
        variant: "destructive",
      });
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Test Integration */}
      <div className="border rounded-lg p-4 bg-blue-50">
        <div className="flex items-center gap-2 mb-3">
          <TestTube className="h-4 w-4 text-blue-600" />
          <h3 className="font-medium text-blue-900">Test Beehiiv Integration</h3>
        </div>
        <p className="text-sm text-blue-700 mb-4">
          Test the Beehiiv API connection with a specific email address to ensure the integration is working correctly.
        </p>
        <div className="flex gap-2 mb-3">
          <Input
            type="email"
            placeholder="test@example.com"
            value={testEmail}
            onChange={(e) => setTestEmail(e.target.value)}
            className="flex-1"
            data-testid="input-test-email"
          />
          <Button
            onClick={handleTestSync}
            disabled={isTestingSync || !testEmail}
            data-testid="button-test-beehiiv"
          >
            {isTestingSync ? (
              <>
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                Testing...
              </>
            ) : (
              <>
                <TestTube className="h-4 w-4 mr-2" />
                Test Integration
              </>
            )}
          </Button>
        </div>
        
        {testResult && (
          <div className={`mt-3 p-3 rounded ${testResult.success ? 'bg-green-100 border border-green-200' : 'bg-red-100 border border-red-200'}`}>
            <div className="flex items-center gap-2 mb-2">
              {testResult.success ? (
                <CheckCircle className="h-4 w-4 text-green-600" />
              ) : (
                <AlertCircle className="h-4 w-4 text-red-600" />
              )}
              <span className={`font-medium ${testResult.success ? 'text-green-900' : 'text-red-900'}`}>
                {testResult.success ? 'Test Successful' : 'Test Failed'}
              </span>
            </div>
            {testResult.error && (
              <p className="text-sm text-red-700">{testResult.error}</p>
            )}
            {testResult.statusCode && (
              <p className="text-sm text-gray-600">Status Code: {testResult.statusCode}</p>
            )}
          </div>
        )}
      </div>

      {/* Full Sync */}
      <div className="border rounded-lg p-4 bg-orange-50">
        <div className="flex items-center gap-2 mb-3">
          <RefreshCw className="h-4 w-4 text-orange-600" />
          <h3 className="font-medium text-orange-900">Sync All Subscribers</h3>
        </div>
        <p className="text-sm text-orange-700 mb-4">
          Sync all local newsletter subscribers to Beehiiv. This will attempt to add all 75 local subscribers to Beehiiv with the "tiktok shop keyword signup" tag.
        </p>
        <Button
          onClick={handleFullSync}
          disabled={isSyncing}
          variant="outline"
          className="border-orange-300 text-orange-700 hover:bg-orange-100"
          data-testid="button-sync-all"
        >
          {isSyncing ? (
            <>
              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              Syncing All Subscribers...
            </>
          ) : (
            <>
              <RefreshCw className="h-4 w-4 mr-2" />
              Sync All Subscribers
            </>
          )}
        </Button>

        {syncResult && (
          <div className="mt-4 p-4 bg-white border rounded">
            <h4 className="font-medium mb-3">Sync Results</h4>
            <div className="grid grid-cols-3 gap-4 mb-4">
              <div className="text-center">
                <p className="text-2xl font-bold text-blue-600">{syncResult.results?.total || 0}</p>
                <p className="text-sm text-gray-600">Total Processed</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-green-600">{syncResult.results?.success || 0}</p>
                <p className="text-sm text-gray-600">Successful</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-red-600">{syncResult.results?.failed || 0}</p>
                <p className="text-sm text-gray-600">Failed</p>
              </div>
            </div>
            
            {syncResult.results?.errors && syncResult.results.errors.length > 0 && (
              <div className="mt-4">
                <h5 className="font-medium text-red-900 mb-2">Failed Subscribers ({syncResult.results.errors.length})</h5>
                <div className="max-h-32 overflow-y-auto space-y-2">
                  {syncResult.results.errors.slice(0, 10).map((error: any, index: number) => (
                    <div key={index} className="text-sm bg-red-50 p-2 rounded">
                      <span className="font-medium">{error.email}:</span> {error.error}
                      {error.statusCode && <span className="text-gray-600"> (Status: {error.statusCode})</span>}
                    </div>
                  ))}
                  {syncResult.results.errors.length > 10 && (
                    <div className="text-sm text-gray-600">
                      ... and {syncResult.results.errors.length - 10} more errors
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}