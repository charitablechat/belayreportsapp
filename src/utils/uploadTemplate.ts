import { supabase } from "@/integrations/supabase/client";

export async function uploadPdfTemplate() {
  try {
    // Fetch the PDF from public folder
    const response = await fetch('/inspection-template.pdf');
    if (!response.ok) {
      throw new Error(`Failed to fetch template: ${response.status}`);
    }

    // Convert to base64
    const blob = await response.blob();
    const arrayBuffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);

    // Call the edge function to upload
    const { data, error } = await supabase.functions.invoke('upload-template', {
      body: { templateBase64: base64 }
    });

    if (error) throw error;

    return data;
  } catch (error) {
    console.error('Error uploading template:', error);
    throw error;
  }
}
