import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb, PDFPage } from "https://esm.sh/pdf-lib@1.17.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Missing authorization header');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      throw new Error('Unauthorized');
    }

    const { inspectionId } = await req.json();

    if (!inspectionId) {
      throw new Error('Inspection ID is required');
    }

    console.log('Fetching inspection data for:', inspectionId);

    // Fetch all data in parallel
    const [
      { data: inspection, error: inspectionError },
      { data: systems, error: systemsError },
      { data: ziplines, error: ziplinesError },
      { data: equipment, error: equipmentError },
      { data: standards, error: standardsError },
      { data: summary, error: summaryError },
      { data: inspectorProfile, error: profileError }
    ] = await Promise.all([
      supabase.from('inspections').select('*').eq('id', inspectionId).single(),
      supabase.from('inspection_systems').select('*').eq('inspection_id', inspectionId),
      supabase.from('inspection_ziplines').select('*').eq('inspection_id', inspectionId),
      supabase.from('inspection_equipment').select('*').eq('inspection_id', inspectionId),
      supabase.from('inspection_standards').select('*').eq('inspection_id', inspectionId),
      supabase.from('inspection_summary').select('*').eq('inspection_id', inspectionId).maybeSingle(),
      supabase.from('profiles').select('*').eq('id', user.id).single()
    ]);

    if (inspectionError) throw inspectionError;

    // Authorization check
    const isSuperAdmin = await supabase.from('user_roles').select('role').eq('user_id', user.id).eq('role', 'super_admin').single();
    if (!isSuperAdmin.data && inspection.inspector_id !== user.id) {
      throw new Error('Unauthorized to generate this report');
    }

    console.log('Loading PDF template from storage...');

    // Load the template from storage
    const { data: templateData, error: downloadError } = await supabase.storage
      .from('pdf-templates')
      .download('inspection-template.pdf');
    
    if (downloadError || !templateData) {
      console.error('Template not found in storage:', downloadError);
      throw new Error(
        'PDF template not found. Please upload the template first by going to the Super Admin Dashboard and clicking "Upload PDF Template".'
      );
    }
    
    const templateBytes = await templateData.arrayBuffer();
    console.log('Template loaded from storage successfully');
    
    const pdfDoc = await PDFDocument.load(templateBytes);
    const pages = pdfDoc.getPages();
    const firstPage = pages[0];
    
    // Embed fonts
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    
    console.log('Drawing inspection data on PDF template');

    // Helper to format date
    const formatDate = (dateString: string | null | undefined) => {
      if (!dateString) return '';
      const date = new Date(dateString);
      return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    };

    // Helper to draw text with wrapping and newline handling
    const drawText = (page: PDFPage, text: string, x: number, y: number, options: any = {}) => {
      if (!text) return y;
      const { maxWidth = 500, fontSize = 10, font: textFont = font, lineHeight = 12 } = options;
      
      // Clean text - remove null bytes and other problematic characters
      const cleanedText = text.replace(/\0/g, '').replace(/\r/g, '');
      
      // Split by newlines first to preserve intentional line breaks
      const paragraphs = cleanedText.split('\n');
      let currentY = y;
      
      for (const paragraph of paragraphs) {
        if (!paragraph.trim()) {
          // Empty line - just add spacing
          currentY -= lineHeight;
          continue;
        }
        
        // Word wrap each paragraph
        const words = paragraph.split(' ');
        let line = '';
        
        for (const word of words) {
          const testLine = line + (line ? ' ' : '') + word;
          const width = textFont.widthOfTextAtSize(testLine, fontSize);
          
          if (width > maxWidth && line) {
            page.drawText(line, { x, y: currentY, size: fontSize, font: textFont, color: rgb(0, 0, 0) });
            line = word;
            currentY -= lineHeight;
          } else {
            line = testLine;
          }
        }
        
        if (line) {
          page.drawText(line, { x, y: currentY, size: fontSize, font: textFont, color: rgb(0, 0, 0) });
          currentY -= lineHeight;
        }
      }
      
      return currentY;
    };

    // Get inspector name
    const inspectorName = inspectorProfile 
      ? `${inspectorProfile.first_name || ''} ${inspectorProfile.last_name || ''}`.trim() || 'Inspector'
      : 'Inspector';

    const pageHeight = firstPage.getHeight();
    let currentY = pageHeight - 100;

    // Header Section (adjust coordinates based on your template)
    firstPage.drawText('INSPECTION REPORT', { x: 200, y: currentY, size: 18, font: boldFont, color: rgb(0, 0, 0) });
    currentY -= 30;

    // Facility Information
    firstPage.drawText('Facility:', { x: 50, y: currentY, size: 11, font: boldFont, color: rgb(0, 0, 0) });
    firstPage.drawText(inspection.organization || '', { x: 120, y: currentY, size: 10, font, color: rgb(0, 0, 0) });
    currentY -= 15;

    firstPage.drawText('Location:', { x: 50, y: currentY, size: 11, font: boldFont, color: rgb(0, 0, 0) });
    firstPage.drawText(inspection.location || '', { x: 120, y: currentY, size: 10, font, color: rgb(0, 0, 0) });
    currentY -= 15;

    firstPage.drawText('Date:', { x: 50, y: currentY, size: 11, font: boldFont, color: rgb(0, 0, 0) });
    firstPage.drawText(formatDate(inspection.inspection_date), { x: 120, y: currentY, size: 10, font, color: rgb(0, 0, 0) });
    currentY -= 15;

    firstPage.drawText('Inspector:', { x: 50, y: currentY, size: 11, font: boldFont, color: rgb(0, 0, 0) });
    firstPage.drawText(inspectorName, { x: 120, y: currentY, size: 10, font, color: rgb(0, 0, 0) });
    currentY -= 15;

    if (inspection.onsite_contact) {
      firstPage.drawText('Contact:', { x: 50, y: currentY, size: 11, font: boldFont, color: rgb(0, 0, 0) });
      firstPage.drawText(inspection.onsite_contact, { x: 120, y: currentY, size: 10, font, color: rgb(0, 0, 0) });
      currentY -= 15;
    }

    if (inspection.previous_inspection_date || inspection.previous_inspector) {
      currentY -= 10;
      firstPage.drawText('Previous Inspection:', { x: 50, y: currentY, size: 11, font: boldFont, color: rgb(0, 0, 0) });
      currentY -= 15;
      if (inspection.previous_inspection_date) {
        firstPage.drawText(`Date: ${formatDate(inspection.previous_inspection_date)}`, { x: 70, y: currentY, size: 9, font, color: rgb(0, 0, 0) });
        currentY -= 12;
      }
      if (inspection.previous_inspector) {
        firstPage.drawText(`Inspector: ${inspection.previous_inspector}`, { x: 70, y: currentY, size: 9, font, color: rgb(0, 0, 0) });
        currentY -= 12;
      }
    }

    // Course History
    if (inspection.course_history) {
      currentY -= 10;
      firstPage.drawText('Course History:', { x: 50, y: currentY, size: 11, font: boldFont, color: rgb(0, 0, 0) });
      currentY -= 15;
      currentY = drawText(firstPage, inspection.course_history, 70, currentY, { maxWidth: 450, fontSize: 9 });
    }

    // Add new page if needed
    const addPageIfNeeded = () => {
      if (currentY < 100) {
        const newPage = pdfDoc.addPage([595.28, 841.89]); // A4 size
        currentY = newPage.getHeight() - 50;
        return newPage;
      }
      return firstPage;
    };

    let activePage = addPageIfNeeded();

    // Operating Systems
    if (systems && systems.length > 0) {
      currentY -= 20;
      activePage = addPageIfNeeded();
      activePage.drawText('OPERATING SYSTEMS', { x: 50, y: currentY, size: 12, font: boldFont, color: rgb(0, 0, 0) });
      currentY -= 20;

      systems.forEach((system, index) => {
        activePage = addPageIfNeeded();
        activePage.drawText(`${index + 1}. ${system.system_name || 'Unnamed'}`, { x: 60, y: currentY, size: 10, font: boldFont, color: rgb(0, 0, 0) });
        currentY -= 14;
        activePage.drawText(`Result: ${system.result || 'N/A'}`, { x: 70, y: currentY, size: 9, font, color: rgb(0, 0, 0) });
        currentY -= 12;
        if (system.comments) {
          currentY = drawText(activePage, `Comments: ${system.comments}`, 70, currentY, { maxWidth: 450, fontSize: 9 });
        }
        currentY -= 10;
      });
    }

    // Ziplines
    if (ziplines && ziplines.length > 0) {
      currentY -= 20;
      activePage = addPageIfNeeded();
      activePage.drawText('ZIPLINES', { x: 50, y: currentY, size: 12, font: boldFont, color: rgb(0, 0, 0) });
      currentY -= 20;

      ziplines.forEach((zipline, index) => {
        activePage = addPageIfNeeded();
        activePage.drawText(`${index + 1}. ${zipline.zipline_name || 'Unnamed'}`, { x: 60, y: currentY, size: 10, font: boldFont, color: rgb(0, 0, 0) });
        currentY -= 14;
        
        if (zipline.cable_type) {
          activePage.drawText(`Cable Type: ${zipline.cable_type}`, { x: 70, y: currentY, size: 9, font, color: rgb(0, 0, 0) });
          currentY -= 12;
        }
        if (zipline.cable_length) {
          activePage.drawText(`Cable Length: ${zipline.cable_length}ft`, { x: 70, y: currentY, size: 9, font, color: rgb(0, 0, 0) });
          currentY -= 12;
        }
        activePage.drawText(`Result: ${zipline.result || 'N/A'}`, { x: 70, y: currentY, size: 9, font, color: rgb(0, 0, 0) });
        currentY -= 12;
        
        if (zipline.comments) {
          currentY = drawText(activePage, `Comments: ${zipline.comments}`, 70, currentY, { maxWidth: 450, fontSize: 9 });
        }
        currentY -= 10;
      });
    }

    // Equipment
    if (equipment && equipment.length > 0) {
      currentY -= 20;
      activePage = addPageIfNeeded();
      activePage.drawText('EQUIPMENT', { x: 50, y: currentY, size: 12, font: boldFont, color: rgb(0, 0, 0) });
      currentY -= 20;

      equipment.forEach((item, index) => {
        activePage = addPageIfNeeded();
        activePage.drawText(`${index + 1}. ${item.equipment_type || 'Unnamed'}`, { x: 60, y: currentY, size: 10, font: boldFont, color: rgb(0, 0, 0) });
        currentY -= 14;
        
        activePage.drawText(`Category: ${item.equipment_category || 'N/A'}`, { x: 70, y: currentY, size: 9, font, color: rgb(0, 0, 0) });
        currentY -= 12;
        
        if (item.quantity) {
          activePage.drawText(`Quantity: ${item.quantity}`, { x: 70, y: currentY, size: 9, font, color: rgb(0, 0, 0) });
          currentY -= 12;
        }
        if (item.production_year) {
          activePage.drawText(`Year: ${item.production_year}`, { x: 70, y: currentY, size: 9, font, color: rgb(0, 0, 0) });
          currentY -= 12;
        }
        
        activePage.drawText(`Result: ${item.result || 'N/A'}`, { x: 70, y: currentY, size: 9, font, color: rgb(0, 0, 0) });
        currentY -= 12;
        
        if (item.comments) {
          currentY = drawText(activePage, `Comments: ${item.comments}`, 70, currentY, { maxWidth: 450, fontSize: 9 });
        }
        currentY -= 10;
      });
    }

    // Standards
    if (standards && standards.length > 0) {
      currentY -= 20;
      activePage = addPageIfNeeded();
      activePage.drawText('STANDARDS', { x: 50, y: currentY, size: 12, font: boldFont, color: rgb(0, 0, 0) });
      currentY -= 20;

      standards.forEach((standard, index) => {
        activePage = addPageIfNeeded();
        activePage.drawText(`${index + 1}. ${standard.standard_name || 'Unnamed'}`, { x: 60, y: currentY, size: 10, font: boldFont, color: rgb(0, 0, 0) });
        currentY -= 14;
        
        activePage.drawText(`Documentation: ${standard.has_documentation ? 'Yes' : 'No'}`, { x: 70, y: currentY, size: 9, font, color: rgb(0, 0, 0) });
        currentY -= 12;
        
        if (standard.comments) {
          currentY = drawText(activePage, `Comments: ${standard.comments}`, 70, currentY, { maxWidth: 450, fontSize: 9 });
        }
        currentY -= 10;
      });
    }

    // Summary
    if (summary) {
      currentY -= 20;
      activePage = addPageIfNeeded();
      activePage.drawText('INSPECTION SUMMARY', { x: 50, y: currentY, size: 12, font: boldFont, color: rgb(0, 0, 0) });
      currentY -= 20;

      if (summary.repairs_performed) {
        activePage.drawText('Repairs Performed:', { x: 60, y: currentY, size: 10, font: boldFont, color: rgb(0, 0, 0) });
        currentY -= 14;
        currentY = drawText(activePage, summary.repairs_performed, 70, currentY, { maxWidth: 450, fontSize: 9 });
        currentY -= 10;
      }

      if (summary.critical_actions) {
        activePage = addPageIfNeeded();
        activePage.drawText('Critical Actions:', { x: 60, y: currentY, size: 10, font: boldFont, color: rgb(0, 0, 0) });
        currentY -= 14;
        currentY = drawText(activePage, summary.critical_actions, 70, currentY, { maxWidth: 450, fontSize: 9 });
        currentY -= 10;
      }

      if (summary.future_considerations) {
        activePage = addPageIfNeeded();
        activePage.drawText('Future Considerations:', { x: 60, y: currentY, size: 10, font: boldFont, color: rgb(0, 0, 0) });
        currentY -= 14;
        currentY = drawText(activePage, summary.future_considerations, 70, currentY, { maxWidth: 450, fontSize: 9 });
        currentY -= 10;
      }

      if (summary.next_inspection_date) {
        activePage = addPageIfNeeded();
        activePage.drawText('Next Inspection Date:', { x: 60, y: currentY, size: 10, font: boldFont, color: rgb(0, 0, 0) });
        activePage.drawText(formatDate(summary.next_inspection_date), { x: 200, y: currentY, size: 10, font, color: rgb(0, 0, 0) });
        currentY -= 14;
      }
    }

    const pdfBytes = await pdfDoc.save();

    console.log('PDF generated, uploading to storage...');

    // Upload to storage
    const fileName = `inspection-${inspectionId}-${Date.now()}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from('inspection-reports')
      .upload(fileName, pdfBytes, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadError) throw uploadError;

    // Create signed URL for secure access (expires in 1 hour)
    const { data: signedUrlData, error: signedUrlError } = await supabase.storage
      .from('inspection-reports')
      .createSignedUrl(fileName, 3600);

    if (signedUrlError) throw signedUrlError;
    const signedUrl = signedUrlData.signedUrl;

    // Save to database
    const { data: reportData, error: reportError } = await supabase
      .from('inspection_reports')
      .insert({
        inspection_id: inspectionId,
        pdf_url: fileName,
        generated_by: user.id,
        file_size_bytes: pdfBytes.length
      })
      .select()
      .single();

    if (reportError) throw reportError;

    console.log('Report saved successfully');

    return new Response(
      JSON.stringify({ pdfUrl: signedUrl }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    );

  } catch (error) {
    console.error('Error generating PDF:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500 
      }
    );
  }
});

