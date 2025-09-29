import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest } from "@/lib/queryClient";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { LogOut, Settings, Database, Upload, ArrowLeft, Trash2, Calendar, File } from "lucide-react";
import { CSVUploadComponent } from "@/components/csv-upload";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

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

interface UploadInfo {
  uploadPeriod: string;
  uploadType: 'Regular' | 'HPK' | 'RK';
  totalKeywords: number;
  uniqueKeywords: number;
  firstUploaded: string;
  lastUploaded: string;
}

export default function AdminPage() {
  const { user, isAuthenticated, isAdmin } = useAuth();
  const { toast } = useToast();

  // Redirect if not authenticated or not admin
  useEffect(() => {
    if (!user && !isAuthenticated) {
      window.location.href = "/admin-login";
      return;
    }
    
    if (user && isAuthenticated && !isAdmin) {
      toast({
        title: "Access Denied",
        description: "You need admin privileges to access this page.",
        variant: "destructive",
      });
      return;
    }
  }, [user, isAuthenticated, isAdmin, toast]);

  // Fetch keywords
  const { data: keywords = [], isLoading: keywordsLoading } = useQuery<Keyword[]>({
    queryKey: ["/api/admin/keywords"],
    queryFn: async () => {
      const response = await fetch('/api/admin/keywords?limit=100');
      if (!response.ok) {
        throw new Error('Failed to fetch keywords');
      }
      return response.json();
    },
    enabled: isAuthenticated && isAdmin,
  });

  // Fetch total keyword count
  const { data: keywordCount } = useQuery<{ totalKeywords: number }>({
    queryKey: ["/api/admin/keywords/count"],
    enabled: isAuthenticated && isAdmin,
  });

  // Fetch stats
  const { data: monthlyStats = [] } = useQuery<any[]>({
    queryKey: ["/api/admin/stats/monthly"],
    enabled: isAuthenticated && isAdmin,
  });

  const { data: dailyStats = [] } = useQuery<any[]>({
    queryKey: ["/api/admin/stats/daily"],
    enabled: isAuthenticated && isAdmin,
  });

  // Fetch uploads
  const { data: uploads = [], isLoading: uploadsLoading, refetch: refetchUploads } = useQuery<UploadInfo[]>({
    queryKey: ["/api/admin/uploads"],
    enabled: isAuthenticated && isAdmin,
  });

  // Delete upload mutation
  const deleteUploadMutation = useMutation({
    mutationFn: async ({ uploadPeriod, uploadType }: { uploadPeriod: string; uploadType: string }) => {
      return apiRequest(`/api/admin/uploads/${uploadPeriod}/${uploadType}`, "DELETE");
    },
    onSuccess: (data: any) => {
      toast({
        title: "Upload Deleted",
        description: data?.message || "Upload successfully deleted.",
      });
      // Refresh uploads list and invalidate related caches
      refetchUploads();
      queryClient.invalidateQueries({ queryKey: ["/api/admin/keywords"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/keywords/count"] });
      queryClient.invalidateQueries({ queryKey: ["/api/search"] });
      queryClient.invalidateQueries({ queryKey: ["/api/categories"] });
    },
    onError: (error: any) => {
      toast({
        title: "Delete Failed",
        description: error.message || "Failed to delete upload.",
        variant: "destructive",
      });
    },
  });

  // Logout functionality
  const logoutMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("/api/admin/logout", "POST");
    },
    onSuccess: () => {
      toast({
        title: "Logged Out",
        description: "Successfully logged out of admin panel.",
      });
      window.location.href = "/admin-login";
    },
  });

  // Don't render anything if not authenticated
  if (!user || !isAuthenticated || !isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">Checking access...</h1>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Header */}
      <header className="bg-white shadow-md border-b">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                <Settings className="h-6 w-6 text-blue-600" />
                <h1 className="text-2xl font-bold text-gray-800">Rankster Admin</h1>
              </div>
              <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                Administrator
              </Badge>
            </div>
            
            <div className="flex items-center space-x-4">
              <span className="text-sm text-gray-600">
                Welcome, {user?.firstName || 'Admin'}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.location.href = '/'}
                data-testid="button-back-to-app"
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to App
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => logoutMutation.mutate()}
                disabled={logoutMutation.isPending}
                data-testid="button-logout"
              >
                <LogOut className="h-4 w-4 mr-2" />
                Logout
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="container mx-auto px-6 py-8">
        <Tabs defaultValue="statistics" className="space-y-6">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="statistics">Statistics</TabsTrigger>
            <TabsTrigger value="csv-upload">CSV Upload</TabsTrigger>
            <TabsTrigger value="upload-management">Upload Management</TabsTrigger>
            <TabsTrigger value="keywords">Keywords</TabsTrigger>
          </TabsList>

          {/* Statistics Tab */}
          <TabsContent value="statistics" className="space-y-6">
            <div className="grid gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Overview Statistics</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="text-center p-4 bg-blue-50 rounded-lg">
                      <h3 className="text-2xl font-bold text-blue-600">
                        {keywordCount?.totalKeywords?.toLocaleString() || "0"}
                      </h3>
                      <p className="text-sm text-gray-600">Total Keywords</p>
                    </div>
                    <div className="text-center p-4 bg-green-50 rounded-lg">
                      <h3 className="text-2xl font-bold text-green-600">
                        {monthlyStats.length}
                      </h3>
                      <p className="text-sm text-gray-600">Monthly Reports</p>
                    </div>
                    <div className="text-center p-4 bg-purple-50 rounded-lg">
                      <h3 className="text-2xl font-bold text-purple-600">
                        {dailyStats.length}
                      </h3>
                      <p className="text-sm text-gray-600">Daily Activities</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* CSV Upload Tab */}
          <TabsContent value="csv-upload" className="space-y-6">
            <CSVUploadComponent />
          </TabsContent>

          {/* Upload Management Tab */}
          <TabsContent value="upload-management" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <File className="h-5 w-5" />
                  Upload Management
                </CardTitle>
              </CardHeader>
              <CardContent>
                {uploadsLoading ? (
                  <div className="text-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
                    <p className="text-muted-foreground">Loading uploads...</p>
                  </div>
                ) : uploads.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Upload className="h-12 w-12 mx-auto mb-4 text-gray-400" />
                    <p>No uploads found.</p>
                    <p className="text-sm">Upload some CSV files to get started!</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                      Manage your uploaded keyword datasets. Deleting an upload will permanently remove all associated keywords from the database.
                    </p>
                    <div className="border rounded-md">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Upload Period</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>Total Keywords</TableHead>
                            <TableHead>Unique Keywords</TableHead>
                            <TableHead>Upload Date</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {uploads.map((upload) => (
                            <TableRow key={`${upload.uploadPeriod}-${upload.uploadType}`}>
                              <TableCell className="font-medium">
                                <div className="flex items-center gap-2">
                                  <Calendar className="h-4 w-4" />
                                  {upload.uploadPeriod}
                                </div>
                              </TableCell>
                              <TableCell>
                                <Badge 
                                  variant={upload.uploadType === 'Regular' ? 'default' : upload.uploadType === 'HPK' ? 'secondary' : 'outline'}
                                  className="text-xs"
                                >
                                  {upload.uploadType}
                                </Badge>
                              </TableCell>
                              <TableCell>{upload.totalKeywords.toLocaleString()}</TableCell>
                              <TableCell>{upload.uniqueKeywords.toLocaleString()}</TableCell>
                              <TableCell>
                                {new Date(upload.firstUploaded).toLocaleDateString()}
                              </TableCell>
                              <TableCell className="text-right">
                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                      data-testid={`button-delete-upload-${upload.uploadPeriod}-${upload.uploadType}`}
                                    >
                                      <Trash2 className="h-4 w-4 mr-2" />
                                      Delete
                                    </Button>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent>
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>Delete Upload</AlertDialogTitle>
                                      <AlertDialogDescription>
                                        Are you sure you want to delete the <strong>{upload.uploadType}</strong> upload for <strong>{upload.uploadPeriod}</strong>?
                                        <br /><br />
                                        This will permanently remove <strong>{upload.totalKeywords.toLocaleString()}</strong> keywords from the database and cannot be undone.
                                      </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
                                      <AlertDialogAction
                                        onClick={() => deleteUploadMutation.mutate({ 
                                          uploadPeriod: upload.uploadPeriod, 
                                          uploadType: upload.uploadType 
                                        })}
                                        disabled={deleteUploadMutation.isPending}
                                        className="bg-red-600 hover:bg-red-700"
                                        data-testid="button-confirm-delete"
                                      >
                                        {deleteUploadMutation.isPending ? "Deleting..." : "Delete Upload"}
                                      </AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Keywords Management Tab */}
          <TabsContent value="keywords" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Database className="h-5 w-5" />
                  Keywords Management
                </CardTitle>
              </CardHeader>
              <CardContent>
                {keywordsLoading ? (
                  <div className="text-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
                    <p className="text-muted-foreground">Loading keywords...</p>
                  </div>
                ) : keywords.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Upload className="h-12 w-12 mx-auto mb-4 text-gray-400" />
                    <p>No keywords found.</p>
                    <p className="text-sm">Upload some CSV files to get started!</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                      Showing first {Math.min(keywords.length, 100)} of {keywordCount?.totalKeywords?.toLocaleString() || keywords.length} total keywords
                    </p>
                    <div className="border rounded-md">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Keyword</TableHead>
                            <TableHead>Search Volume</TableHead>
                            <TableHead>Category</TableHead>
                            <TableHead>Upload Period</TableHead>
                            <TableHead>Type</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {keywords.slice(0, 50).map((keyword) => (
                            <TableRow key={keyword.id}>
                              <TableCell className="font-medium max-w-xs truncate">
                                {keyword.keyword}
                              </TableCell>
                              <TableCell>{keyword.searchVolume.toLocaleString()}</TableCell>
                              <TableCell className="max-w-xs truncate">
                                {keyword.categoryId || 'No category'}
                              </TableCell>
                              <TableCell>{keyword.uploadPeriod || 'N/A'}</TableCell>
                              <TableCell>
                                <Badge variant="outline" className="text-xs">
                                  Regular
                                </Badge>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
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