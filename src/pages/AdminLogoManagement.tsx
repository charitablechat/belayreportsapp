import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Upload, Image as ImageIcon, Loader2 } from 'lucide-react';
import { useRequireSuperAdmin } from '@/hooks/useRequireSuperAdmin';

export default function AdminLogoManagement() {
  const navigate = useNavigate();
  const { loading: authLoading } = useRequireSuperAdmin();
  
  const [ropeWorksFile, setRopeWorksFile] = useState<File | null>(null);
  const [acctFile, setAcctFile] = useState<File | null>(null);
  const [ropeWorksPreview, setRopeWorksPreview] = useState<string>('');
  const [acctPreview, setAcctPreview] = useState<string>('');
  const [uploading, setUploading] = useState(false);
  const [currentLogos, setCurrentLogos] = useState<{ ropeWorks: string; acct: string }>({ ropeWorks: '', acct: '' });

  useEffect(() => {
    loadCurrentLogos();
  }, []);

  const loadCurrentLogos = async () => {
    try {
      const { data: ropeWorksData } = supabase.storage
        .from('pdf-templates')
        .getPublicUrl('rope-works-logo-embedded.png');
      
      const { data: acctData } = supabase.storage
        .from('pdf-templates')
        .getPublicUrl('acct-logo-embedded.png');

      setCurrentLogos({
        ropeWorks: ropeWorksData.publicUrl + '?t=' + Date.now(),
        acct: acctData.publicUrl + '?t=' + Date.now()
      });
    } catch (error) {
      console.error('Error loading current logos:', error);
    }
  };

  const handleFileChange = (file: File | null, type: 'ropeWorks' | 'acct') => {
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file');
      return;
    }

    // Validate file size (max 2MB)
    if (file.size > 2 * 1024 * 1024) {
      toast.error('File size must be less than 2MB');
      return;
    }

    // Create preview
    const reader = new FileReader();
    reader.onloadend = () => {
      if (type === 'ropeWorks') {
        setRopeWorksFile(file);
        setRopeWorksPreview(reader.result as string);
      } else {
        setAcctFile(file);
        setAcctPreview(reader.result as string);
      }
    };
    reader.readAsDataURL(file);
  };

  const uploadLogo = async (file: File, fileName: string) => {
    const { error } = await supabase.storage
      .from('pdf-templates')
      .upload(fileName, file, {
        contentType: file.type,
        upsert: true // Overwrite existing file
      });

    if (error) throw error;
  };

  const handleUpload = async () => {
    if (!ropeWorksFile && !acctFile) {
      toast.error('Please select at least one logo to upload');
      return;
    }

    setUploading(true);
    try {
      const uploadPromises = [];

      if (ropeWorksFile) {
        uploadPromises.push(uploadLogo(ropeWorksFile, 'rope-works-logo-embedded.png'));
      }

      if (acctFile) {
        uploadPromises.push(uploadLogo(acctFile, 'acct-logo-embedded.png'));
      }

      await Promise.all(uploadPromises);

      toast.success('Logos updated successfully! Changes will appear in new reports.');
      
      // Clear selections and reload current logos
      setRopeWorksFile(null);
      setAcctFile(null);
      setRopeWorksPreview('');
      setAcctPreview('');
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

      <div className="grid md:grid-cols-2 gap-6 mb-6">
        {/* Current Logos */}
        <Card>
          <CardHeader>
            <CardTitle>Current Rope Works Logo</CardTitle>
            <CardDescription>Currently used in all reports</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-center p-6 bg-muted rounded-lg min-h-[200px]">
              {currentLogos.ropeWorks ? (
                <img 
                  src={currentLogos.ropeWorks} 
                  alt="Rope Works Logo" 
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

      {/* Upload New Logos */}
      <Card>
        <CardHeader>
          <CardTitle>Upload New Logos</CardTitle>
          <CardDescription>
            Select new logo files to update. Accepted formats: PNG, JPG, WEBP (max 2MB)
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid md:grid-cols-2 gap-6">
            {/* Rope Works Upload */}
            <div className="space-y-4">
              <Label htmlFor="rope-works-upload">Rope Works Logo</Label>
              <Input
                id="rope-works-upload"
                type="file"
                accept="image/*"
                onChange={(e) => handleFileChange(e.target.files?.[0] || null, 'ropeWorks')}
                disabled={uploading}
              />
              {ropeWorksPreview && (
                <div className="p-4 bg-muted rounded-lg">
                  <p className="text-sm text-muted-foreground mb-2">Preview:</p>
                  <img 
                    src={ropeWorksPreview} 
                    alt="Preview" 
                    className="max-h-[150px] object-contain mx-auto"
                  />
                </div>
              )}
            </div>

            {/* ACCT Upload */}
            <div className="space-y-4">
              <Label htmlFor="acct-upload">ACCT Accredited Vendor Logo</Label>
              <Input
                id="acct-upload"
                type="file"
                accept="image/*"
                onChange={(e) => handleFileChange(e.target.files?.[0] || null, 'acct')}
                disabled={uploading}
              />
              {acctPreview && (
                <div className="p-4 bg-muted rounded-lg">
                  <p className="text-sm text-muted-foreground mb-2">Preview:</p>
                  <img 
                    src={acctPreview} 
                    alt="Preview" 
                    className="max-h-[150px] object-contain mx-auto"
                  />
                </div>
              )}
            </div>
          </div>

          <div className="flex gap-4">
            <Button 
              onClick={handleUpload} 
              disabled={uploading || (!ropeWorksFile && !acctFile)}
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
              disabled={uploading}
            >
              Back to Admin
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
