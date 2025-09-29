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
import { LogOut, Settings, Database, Upload } from "lucide-react";
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

  // Fetch stats
  const { data: monthlyStats = [] } = useQuery({
    queryKey: ["/api/admin/stats/monthly"],
    enabled: isAuthenticated && isAdmin,
  });

  const { data: dailyStats = [] } = useQuery({
    queryKey: ["/api/admin/stats/daily"],
    enabled: isAuthenticated && isAdmin,
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
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="statistics">Statistics</TabsTrigger>
            <TabsTrigger value="csv-upload">CSV Upload</TabsTrigger>
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
                        {keywords.length.toLocaleString()}
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
                      Showing first 100 keywords. Total: {keywords.length.toLocaleString()}
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