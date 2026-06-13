import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Upload, Image as ImageIcon, Loader2, CheckCircle2, Info } from 'lucide-react';
import { useRequireAdmin } from '@/hooks/useRequireAdmin';
import { optimizeImage, formatFileSize, formatDimensions, LOGO_PRESETS, type OptimizedResult } from '@/lib/image-optimizer';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { AutoLogoInitializer } from '@/components/admin/AutoLogoInitializer';

export default function AdminLogoManagement() {
  const navigate = useNavigate();
  const { loading: authLoading } = useRequireAdmin();
  
  const [belayReportsFile, setRopeWorksFile] = useState<File | null>(null);
  const [acctFile, setAcctFile] = useState<File | null>(null);
  const [belayReportsPreview, setRopeWorksPreview] = useState<string>('');
  const [acctPreview, setAcctPreview] = useState<string>('');
  const [belayReportsOptimized, setRopeWorksOptimized] = useState<OptimizedResult | null>(null);
  const [acctOptimized, setAcctOptimized] = useState<OptimizedResult | null>(null);
  const [optimizing, setOptimizing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [currentLogos, setCurrentLogos] = useState<{ belayReports: string; acct: string }>({ belayReports: '', acct: '' });

  useEffect(() => {
    loadCurrentLogos();
  }, []);

  const loadCurrentLogos = async () => {
    try {
      const { data: belayReportsData } = supabase.storage
        .from('pdf-templates')
        .getPublicUrl('belay-reports-logo-embedded.png');
      
      const { data: acctData } = supabase.storage
        .from('pdf-templates')
        .getPublicUrl('acct-logo-embedded.png');

      setCurrentLogos({
        belayReports: belayReportsData.publicUrl + '?t=' + Date.now(),
        acct: acctData.publicUrl + '?t=' + Date.now()
      });
    } catch (error) {
      console.error('Error loading current logos:', error);
    }
  };

  const handleFileChange = async (file: File | null, type: 'belayReports' | 'acct') => {
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file');
      return;
    }

    // Validate file size (max 5MB for original, will be optimized)
    if (file.size > 5 * 1024 * 1024) {
      toast.error('File size must be less than 5MB');
      return;
    }

    setOptimizing(true);

    try {
      // Get the appropriate preset for this logo type
      const preset = type === 'belayReports' ? LOGO_PRESETS.belayReports : LOGO_PRESETS.acct;

      // Optimize the image
      const result = await optimizeImage(file, {
        maxWidth: preset.maxWidth,
        maxHeight: preset.maxHeight,
        quality: 0.92,
        format: 'image/png'
      });

      // Create preview from optimized blob
      const previewUrl = URL.createObjectURL(result.blob);

      if (type === 'belayReports') {
        setRopeWorksFile(file);
        setRopeWorksPreview(previewUrl);
        setRopeWorksOptimized(result);
      } else {
        setAcctFile(file);
        setAcctPreview(previewUrl);
        setAcctOptimized(result);
      }

      toast.success(`Image optimized: ${result.compressionRatio}% smaller`);
    } catch (error) {
      console.error('Optimization error:', error);
      toast.error('Failed to optimize image: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setOptimizing(false);
    }
  };

  const uploadLogo = async (blob: Blob, fileName: string) => {
    const { error } = await supabase.storage
      .from('pdf-templates')
      .upload(fileName, blob, {
        contentType: 'image/png',
        upsert: true // Overwrite existing file
      });

    if (error) throw error;
  };

  const handleUpload = async () => {
    if (!belayReportsOptimized && !acctOptimized) {
      toast.error('Please select at least one logo to upload');
      return;
    }

    setUploading(true);
    try {
      const uploadPromises = [];

      if (belayReportsOptimized) {
        uploadPromises.push(uploadLogo(belayReportsOptimized.blob, 'belay-reports-logo-embedded.png'));
      }

      if (acctOptimized) {
        uploadPromises.push(uploadLogo(acctOptimized.blob, 'acct-logo-embedded.png'));
      }

      await Promise.all(uploadPromises);

      toast.success('Logos updated successfully! Changes will appear in new reports.');
      
      // Clear selections and reload current logos
      setRopeWorksFile(null);
      setAcctFile(null);
      setRopeWorksPreview('');
      setAcctPreview('');
      setRopeWorksOptimized(null);
      setAcctOptimized(null);
      loadCurrentLogos();
    } catch (error) {
      console.error('Upload error:', error);
      toast.error('Failed to upload logos: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setUploading(false);
    }
  };

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-6xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Report Logo Management</h1>
        <p className="text-muted-foreground mt-2">
          Upload and manage logos that appear in generated PDF reports
        </p>
      </div>

      <AutoLogoInitializer />

      <div className="grid md:grid-cols-2 gap-6 mb-6">
        {/* Current Logos */}
        <Card>
          <CardHeader>
            <CardTitle>Current Belay Reports Logo</CardTitle>
            <CardDescription>Currently used in all reports</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-center p-6 bg-muted rounded-lg min-h-[200px]">
              {currentLogos.belayReports ? (
                <img 
                  src={currentLogos.belayReports} 
                  alt="Belay Reports Logo" 
                  className="max-h-[180px] object-contain"
                />
              ) : (
                <ImageIcon className="h-16 w-16 text-muted-foreground" />
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Current ACCT Logo</CardTitle>
            <CardDescription>Currently used in all reports</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-center p-6 bg-muted rounded-lg min-h-[200px]">
              {currentLogos.acct ? (
                <img 
                  src={currentLogos.acct} 
                  alt="ACCT Logo" 
                  className="max-h-[180px] object-contain"
                />
              ) : (
                <ImageIcon className="h-16 w-16 text-muted-foreground" />
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Optimal Dimensions Info */}
      <Alert className="mb-6">
        <Info className="h-4 w-4" />
        <AlertDescription>
          <strong>Optimal Dimensions:</strong> Belay Reports Logo: 300×140px | ACCT Badge: 240×120px. 
          Images will be automatically optimized and resized to these dimensions for best quality in PDF reports.
        </AlertDescription>
      </Alert>

      {/* Upload New Logos */}
      <Card>
        <CardHeader>
          <CardTitle>Upload New Logos</CardTitle>
          <CardDescription>
            Select new logo files to update. Images will be automatically optimized and resized. Accepted formats: PNG, JPG, WEBP (max 5MB)
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid md:grid-cols-2 gap-6">
            {/* Belay Reports Upload */}
            <div className="space-y-4">
              <Label htmlFor="belay-reports-upload">Belay Reports Logo</Label>
              <Input
                id="belay-reports-upload"
                type="file"
                accept="image/*,image/heic,image/heif,.heic,.heif"
                onChange={(e) => handleFileChange(e.target.files?.[0] || null, 'belayReports')}
                disabled={uploading || optimizing}
              />
              {belayReportsPreview && belayReportsOptimized && (
                <div className="space-y-3">
                  <div className="p-4 bg-muted rounded-lg">
                    <p className="text-sm text-muted-foreground mb-2">Optimized Preview:</p>
                    <img 
                      src={belayReportsPreview} 
                      alt="Preview" 
                      className="max-h-[150px] object-contain mx-auto"
                    />
                  </div>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                      <span className="font-medium">Auto-Optimized</span>
                    </div>
                    <div className="flex justify-between text-muted-foreground">
                      <span>Size:</span>
                      <span>
                        {formatFileSize(belayReportsOptimized.originalSize)} → {formatFileSize(belayReportsOptimized.optimizedSize)}
                        <Badge variant="secondary" className="ml-2">{belayReportsOptimized.compressionRatio}% smaller</Badge>
                      </span>
                    </div>
                    <div className="flex justify-between text-muted-foreground">
                      <span>Dimensions:</span>
                      <span>
                        {formatDimensions(belayReportsOptimized.originalDimensions)} → {formatDimensions(belayReportsOptimized.optimizedDimensions)}
                      </span>
                    </div>
                    {belayReportsOptimized.formatChanged && (
                      <div className="flex justify-between text-muted-foreground">
                        <span>Format:</span>
                        <span>Converted to PNG</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* ACCT Upload */}
            <div className="space-y-4">
              <Label htmlFor="acct-upload">ACCT Accredited Vendor Logo</Label>
              <Input
                id="acct-upload"
                type="file"
                accept="image/*,image/heic,image/heif,.heic,.heif"
                onChange={(e) => handleFileChange(e.target.files?.[0] || null, 'acct')}
                disabled={uploading || optimizing}
              />
              {acctPreview && acctOptimized && (
                <div className="space-y-3">
                  <div className="p-4 bg-muted rounded-lg">
                    <p className="text-sm text-muted-foreground mb-2">Optimized Preview:</p>
                    <img 
                      src={acctPreview} 
                      alt="Preview" 
                      className="max-h-[150px] object-contain mx-auto"
                    />
                  </div>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                      <span className="font-medium">Auto-Optimized</span>
                    </div>
                    <div className="flex justify-between text-muted-foreground">
                      <span>Size:</span>
                      <span>
                        {formatFileSize(acctOptimized.originalSize)} → {formatFileSize(acctOptimized.optimizedSize)}
                        <Badge variant="secondary" className="ml-2">{acctOptimized.compressionRatio}% smaller</Badge>
                      </span>
                    </div>
                    <div className="flex justify-between text-muted-foreground">
                      <span>Dimensions:</span>
                      <span>
                        {formatDimensions(acctOptimized.originalDimensions)} → {formatDimensions(acctOptimized.optimizedDimensions)}
                      </span>
                    </div>
                    {acctOptimized.formatChanged && (
                      <div className="flex justify-between text-muted-foreground">
                        <span>Format:</span>
                        <span>Converted to PNG</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {optimizing && (
            <div className="flex items-center justify-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Optimizing image...</span>
            </div>
          )}

          <div className="flex gap-4">
            <Button 
              onClick={handleUpload} 
              disabled={uploading || optimizing || (!belayReportsOptimized && !acctOptimized)}
              className="w-full md:w-auto"
            >
              {uploading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  Update Logos
                </>
              )}
            </Button>
            <Button 
              variant="outline" 
              onClick={() => navigate('/admin')}
              disabled={uploading || optimizing}
            >
              Back to Admin
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
