import { useState, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Upload, FileText, CheckCircle, AlertCircle, X } from "lucide-react";

interface UploadResult {
  totalRows: number;
  inserted: number;
  errors: number;
  errorDetails?: Array<{ row: number; keyword?: string; error: string }>;
}

export function CSVUploadComponent() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploadPeriod, setUploadPeriod] = useState<string>("");
  const [keywordType, setKeywordType] = useState<string>("regular");
  const [uploadResults, setUploadResults] = useState<Array<{ filename: string; result: UploadResult }>>([]);
  const [isDragOver, setIsDragOver] = useState(false);

  const uploadMutation = useMutation({
    mutationFn: async ({ file, period, type }: { file: File; period: string; type: string }) => {
      const formData = new FormData();
      formData.append("csvFile", file);
      formData.append("uploadPeriod", period);
      formData.append("keywordType", type);

      const response = await fetch("/api/admin/keywords/upload-csv-simple", {
        method: "POST",
        body: formData,
        credentials: "include"
      });

      if (!response.ok) {
        throw new Error(`Upload failed: ${response.statusText}`);
      }

      return response.json();
    },
    onSuccess: (data, variables) => {
      setUploadResults(prev => [...prev, { 
        filename: variables.file.name, 
        result: data.results 
      }]);
      
      toast({
        title: "Upload Successful!",
        description: `${variables.file.name}: ${data.results.inserted} keywords uploaded`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Upload Failed",
        description: error.message || "Failed to upload CSV file",
        variant: "destructive",
      });
    },
  });

  const handleFileSelect = (files: FileList | null) => {
    if (!files) return;
    
    const supportedFiles = Array.from(files).filter(file => 
      file.name.endsWith('.csv') || 
      file.name.endsWith('.xlsx') || 
      file.name.endsWith('.xls') ||
      file.type === 'text/csv' ||
      file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      file.type === 'application/vnd.ms-excel'
    );
    
    if (supportedFiles.length === 0) {
      toast({
        title: "Invalid File Type",
        description: "Please select CSV or Excel files only",
        variant: "destructive",
      });
      return;
    }

    setSelectedFiles(supportedFiles);
    setUploadResults([]); // Clear previous results
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    handleFileSelect(e.dataTransfer.files);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleUploadAll = async () => {
    if (selectedFiles.length === 0) {
      toast({
        title: "No Files Selected",
        description: "Please select CSV or Excel files to upload",
        variant: "destructive",
      });
      return;
    }

    if (!uploadPeriod) {
      toast({
        title: "Upload Period Required",
        description: "Please specify the upload period (e.g., 2025-05)",
        variant: "destructive",
      });
      return;
    }

    setUploadResults([]);

    // Upload files one by one
    for (const file of selectedFiles) {
      await uploadMutation.mutateAsync({
        file,
        period: uploadPeriod,
        type: keywordType
      });
    }
  };

  const removeFile = (index: number) => {
    setSelectedFiles(files => files.filter((_, i) => i !== index));
  };

  const clearAll = () => {
    setSelectedFiles([]);
    setUploadResults([]);
    setUploadPeriod("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Upload className="h-5 w-5" />
          CSV & Excel Keyword Upload
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Upload Configuration */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="upload-period">Upload Period</Label>
            <Input
              id="upload-period"
              type="text"
              placeholder="e.g., 2025-05"
              value={uploadPeriod}
              onChange={(e) => setUploadPeriod(e.target.value)}
              data-testid="input-upload-period"
            />
            <p className="text-sm text-muted-foreground mt-1">
              Format: YYYY-MM (matches your filename)
            </p>
          </div>
          
          <div>
            <Label htmlFor="keyword-type">Keyword Type</Label>
            <Select value={keywordType} onValueChange={setKeywordType}>
              <SelectTrigger data-testid="select-keyword-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="regular">Regular Keywords</SelectItem>
                <SelectItem value="hpk">High-Potential Keywords (HPK)</SelectItem>
                <SelectItem value="rising">Rising Keywords (RK)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* File Naming Guide */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h4 className="font-semibold text-blue-800 mb-2">
            {keywordType === 'regular' && 'Regular Keywords File Naming'}
            {keywordType === 'hpk' && 'High-Potential Keywords (HPK) File Naming'}
            {keywordType === 'rising' && 'Rising Keywords (RK) File Naming'}
          </h4>
          <div className="text-sm text-blue-700 space-y-1">
            {keywordType === 'regular' && (
              <>
                <p>• Format: <code className="bg-blue-100 px-1 rounded">YYYY-MM.csv</code> or <code className="bg-blue-100 px-1 rounded">YYYY-MM.xlsx</code></p>
                <p>• Examples: <code className="bg-blue-100 px-1 rounded">2025-05.xlsx</code>, <code className="bg-blue-100 px-1 rounded">2025-06.csv</code>, <code className="bg-blue-100 px-1 rounded">2025-07.csv</code>, <code className="bg-blue-100 px-1 rounded">2025-08.csv</code></p>
                <p>• Contains standard keyword data with search volume, category, and performance metrics</p>
              </>
            )}
            {keywordType === 'hpk' && (
              <>
                <p>• Format: <code className="bg-blue-100 px-1 rounded">HPK-YYYYMMDD.csv</code> (weekly data)</p>
                <p>• Examples: <code className="bg-blue-100 px-1 rounded">HPK-20250714.csv</code>, <code className="bg-blue-100 px-1 rounded">HPK-20251025.csv</code></p>
                <p>• Contains weekly high-potential keyword data with 5 specific columns</p>
              </>
            )}
            {keywordType === 'rising' && (
              <>
                <p>• Format: <code className="bg-blue-100 px-1 rounded">RK-YYYYMM.csv</code></p>
                <p>• Examples: <code className="bg-blue-100 px-1 rounded">RK-202508.csv</code>, <code className="bg-blue-100 px-1 rounded">RK-202512.csv</code></p>
                <p>• Contains rising keyword data with rank information</p>
              </>
            )}
          </div>
        </div>

        {/* File Drop Zone */}
        <div
          className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
            isDragOver 
              ? "border-primary bg-primary/5" 
              : "border-muted-foreground/25 hover:border-muted-foreground/50"
          }`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          data-testid="drop-zone"
        >
          <FileText className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
          <p className="text-lg font-medium mb-2">Drop CSV or Excel files here</p>
          <p className="text-muted-foreground mb-4">Supports .csv, .xlsx, and .xls files</p>
          <Button
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            data-testid="button-browse-files"
          >
            Browse Files
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={(e) => handleFileSelect(e.target.files)}
          />
        </div>

        {/* Selected Files */}
        {selectedFiles.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-medium">Selected Files ({selectedFiles.length})</h3>
              <Button variant="ghost" size="sm" onClick={clearAll} data-testid="button-clear-all">
                <X className="h-4 w-4 mr-1" />
                Clear All
              </Button>
            </div>
            
            <div className="space-y-2 max-h-40 overflow-y-auto">
              {selectedFiles.map((file, index) => (
                <div key={index} className="flex items-center justify-between p-2 bg-muted rounded">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    <span className="text-sm font-medium">{file.name}</span>
                    <span className="text-xs text-muted-foreground">
                      ({(file.size / 1024).toFixed(1)} KB)
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeFile(index)}
                    data-testid={`button-remove-file-${index}`}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Upload Button */}
        <div className="flex gap-2">
          <Button
            onClick={handleUploadAll}
            disabled={selectedFiles.length === 0 || !uploadPeriod || uploadMutation.isPending}
            className="flex-1"
            data-testid="button-upload-all"
          >
            {uploadMutation.isPending ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                Uploading...
              </>
            ) : (
              <>
                <Upload className="h-4 w-4 mr-2" />
                Upload All Files
              </>
            )}
          </Button>
        </div>

        {/* Upload Progress/Results */}
        {uploadMutation.isPending && (
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Uploading files...</span>
            </div>
            <Progress value={50} className="w-full" />
          </div>
        )}

        {/* Upload Results */}
        {uploadResults.length > 0 && (
          <div className="space-y-3">
            <h3 className="font-medium">Upload Results</h3>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {uploadResults.map((result, index) => (
                <div key={index} className="p-3 border rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-sm">{result.filename}</span>
                    {result.result.errors === 0 ? (
                      <CheckCircle className="h-5 w-5 text-green-500" />
                    ) : (
                      <AlertCircle className="h-5 w-5 text-yellow-500" />
                    )}
                  </div>
                  
                  <div className="grid grid-cols-3 gap-2 text-sm text-muted-foreground">
                    <div>Total: {result.result.totalRows}</div>
                    <div className="text-green-600">Inserted: {result.result.inserted}</div>
                    <div className="text-red-600">Errors: {result.result.errors}</div>
                  </div>

                  {result.result.errorDetails && result.result.errorDetails.length > 0 && (
                    <div className="mt-2 p-2 bg-red-50 rounded text-xs">
                      <p className="font-medium text-red-800">First few errors:</p>
                      {result.result.errorDetails.slice(0, 3).map((error, i) => (
                        <p key={i} className="text-red-700">
                          Row {error.row}: {error.error}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}