import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.0";
import { PDFDocument, rgb, StandardFonts } from "https://esm.sh/pdf-lib@1.17.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const authHeader = req.headers.get('Authorization')!;
    
    const supabaseClient = createClient(supabaseUrl, supabaseServiceKey);
    
    // Verify user authentication
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { inspectionId, regenerate } = await req.json();

    console.log('Generating PDF for inspection:', inspectionId);

    // Fetch inspection data
    const { data: inspection, error: inspError } = await supabaseClient
      .from('inspections')
      .select('*')
      .eq('id', inspectionId)
      .single();

    if (inspError || !inspection) {
      return new Response(JSON.stringify({ error: 'Inspection not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Verify access - user must be inspector or super admin
    const { data: roles } = await supabaseClient
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id);
    
    const isSuperAdmin = roles?.some(r => r.role === 'super_admin');
    const isInspector = inspection.inspector_id === user.id;

    if (!isSuperAdmin && !isInspector) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check if PDF already exists
    if (!regenerate) {
      const { data: existingReport } = await supabaseClient
        .from('inspection_reports')
        .select('pdf_url')
        .eq('inspection_id', inspectionId)
        .order('generated_at', { ascending: false })
        .limit(1)
        .single();

      if (existingReport) {
        const { data: signedUrl } = await supabaseClient.storage
          .from('inspection-reports')
          .createSignedUrl(existingReport.pdf_url.split('/').pop()!, 900);
        
        return new Response(JSON.stringify({ pdfUrl: signedUrl?.signedUrl || '' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // Fetch all related data
    const [systemsRes, ziplinesRes, equipmentRes, standardsRes, summaryRes, photosRes, profileRes] = await Promise.all([
      supabaseClient.from('inspection_systems').select('*').eq('inspection_id', inspectionId),
      supabaseClient.from('inspection_ziplines').select('*').eq('inspection_id', inspectionId),
      supabaseClient.from('inspection_equipment').select('*').eq('inspection_id', inspectionId),
      supabaseClient.from('inspection_standards').select('*').eq('inspection_id', inspectionId),
      supabaseClient.from('inspection_summary').select('*').eq('inspection_id', inspectionId).single(),
      supabaseClient.from('inspection_photos').select('*').eq('inspection_id', inspectionId),
      supabaseClient.from('profiles').select('first_name, last_name').eq('id', inspection.inspector_id).single(),
    ]);

    const systems = systemsRes.data || [];
    const ziplines = ziplinesRes.data || [];
    const equipment = equipmentRes.data || [];
    const standards = standardsRes.data || [];
    const summary = summaryRes.data || { repairs_performed: '', critical_actions: '', future_considerations: '', next_inspection_date: null };
    const photos = photosRes.data || [];
    const profile = profileRes.data;

    // Create PDF
    const pdfDoc = await PDFDocument.create();
    const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const pageWidth = 612; // 8.5 inches
    const pageHeight = 792; // 11 inches
    const margin = 54; // 0.75 inches
    
    // Helper functions
    const addPage = () => pdfDoc.addPage([pageWidth, pageHeight]);
    
    const drawText = (page: any, text: string, x: number, y: number, options: any = {}) => {
      page.drawText(text, {
        x,
        y,
        size: options.size || 10,
        font: options.bold ? helveticaBold : helveticaFont,
        color: options.color || rgb(0, 0, 0),
        maxWidth: options.maxWidth || (pageWidth - 2 * margin),
      });
    };

    const formatDate = (date: string | null) => {
      if (!date) return 'N/A';
      return new Date(date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    };

    const getResultColor = (result: string) => {
      const r = result.toLowerCase();
      if (r.includes('pass') && !r.includes('provision')) return rgb(0.06, 0.73, 0.51);
      if (r.includes('provision')) return rgb(0.96, 0.62, 0.03);
      if (r.includes('fail')) return rgb(0.94, 0.27, 0.27);
      return rgb(0.42, 0.45, 0.50);
    };

    // PAGE 1: COVER PAGE
    let page = addPage();
    let yPos = pageHeight - 150;

    drawText(page, 'INSPECTION REPORT', pageWidth / 2 - 120, yPos, { size: 24, bold: true });
    yPos -= 30;
    drawText(page, 'Challenge Course, Adventure Park & Canopy/Zip Line Tour', pageWidth / 2 - 200, yPos, { size: 12 });
    
    yPos -= 80;
    drawText(page, inspection.organization, pageWidth / 2 - (inspection.organization.length * 4), yPos, { size: 20, bold: true });
    yPos -= 40;
    drawText(page, inspection.location, pageWidth / 2 - (inspection.location.length * 3), yPos, { size: 14 });
    
    yPos -= 60;
    drawText(page, `Inspection Date: ${formatDate(inspection.inspection_date)}`, pageWidth / 2 - 120, yPos, { size: 12 });
    yPos -= 25;
    const inspectorName = profile ? `${profile.first_name || ''} ${profile.last_name || ''}`.trim() : 'Unknown';
    drawText(page, `Inspector: ${inspectorName}`, pageWidth / 2 - 80, yPos, { size: 12 });
    yPos -= 25;
    drawText(page, `Report Generated: ${new Date().toLocaleDateString()}`, pageWidth / 2 - 100, yPos, { size: 10, color: rgb(0.5, 0.5, 0.5) });

    // PAGE 2: INSPECTION DETAILS
    page = addPage();
    yPos = pageHeight - margin - 30;
    
    drawText(page, 'FACILITY INFORMATION', margin, yPos, { size: 16, bold: true });
    yPos -= 30;
    
    const details = [
      ['Organization:', inspection.organization],
      ['Location:', inspection.location],
      ['Onsite Contact:', inspection.onsite_contact || 'N/A'],
      ['Inspection Date:', formatDate(inspection.inspection_date)],
      ['Previous Inspector:', inspection.previous_inspector || 'N/A'],
      ['Previous Inspection:', formatDate(inspection.previous_inspection_date)],
      ['Course History:', inspection.course_history || 'N/A'],
      ['GPS Coordinates:', inspection.latitude && inspection.longitude ? `${inspection.latitude}, ${inspection.longitude}` : 'N/A'],
    ];

    details.forEach(([label, value]) => {
      drawText(page, label, margin, yPos, { size: 10, bold: true });
      drawText(page, value, margin + 150, yPos, { size: 10 });
      yPos -= 20;
    });

    yPos -= 20;
    drawText(page, 'INSPECTOR INFORMATION', margin, yPos, { size: 16, bold: true });
    yPos -= 30;
    drawText(page, 'Name:', margin, yPos, { size: 10, bold: true });
    drawText(page, inspectorName, margin + 150, yPos, { size: 10 });

    // PAGE 3: SYSTEMS & ZIPLINES
    page = addPage();
    yPos = pageHeight - margin - 30;
    
    drawText(page, 'OPERATING SYSTEMS', margin, yPos, { size: 16, bold: true });
    yPos -= 30;

    if (systems.length > 0) {
      // Table headers
      page.drawRectangle({ x: margin, y: yPos - 15, width: pageWidth - 2 * margin, height: 20, borderColor: rgb(0, 0, 0), borderWidth: 1 });
      drawText(page, 'System Name', margin + 5, yPos - 10, { size: 9, bold: true });
      drawText(page, 'Result', margin + 250, yPos - 10, { size: 9, bold: true });
      drawText(page, 'Comments', margin + 350, yPos - 10, { size: 9, bold: true });
      yPos -= 20;

      systems.forEach((sys) => {
        if (yPos < margin + 40) {
          page = addPage();
          yPos = pageHeight - margin - 30;
        }
        
        page.drawRectangle({ x: margin, y: yPos - 15, width: pageWidth - 2 * margin, height: 20, borderColor: rgb(0.8, 0.8, 0.8), borderWidth: 0.5 });
        drawText(page, sys.system_name, margin + 5, yPos - 10, { size: 8 });
        drawText(page, sys.result, margin + 250, yPos - 10, { size: 8, color: getResultColor(sys.result) });
        const comments = sys.comments ? (sys.comments.length > 30 ? sys.comments.substring(0, 27) + '...' : sys.comments) : 'N/A';
        drawText(page, comments, margin + 350, yPos - 10, { size: 8 });
        yPos -= 20;
      });
    } else {
      drawText(page, 'No operating systems recorded', margin, yPos, { size: 10, color: rgb(0.5, 0.5, 0.5) });
      yPos -= 20;
    }

    yPos -= 30;
    if (yPos < margin + 100) {
      page = addPage();
      yPos = pageHeight - margin - 30;
    }

    drawText(page, 'ZIPLINES', margin, yPos, { size: 16, bold: true });
    yPos -= 30;

    if (ziplines.length > 0) {
      ziplines.forEach((zip) => {
        if (yPos < margin + 60) {
          page = addPage();
          yPos = pageHeight - margin - 30;
        }

        page.drawRectangle({ x: margin, y: yPos - 45, width: pageWidth - 2 * margin, height: 50, borderColor: rgb(0, 0, 0), borderWidth: 1 });
        drawText(page, zip.zipline_name, margin + 5, yPos - 10, { size: 10, bold: true });
        yPos -= 15;
        
        const zipDetails = [
          `Cable: ${zip.cable_type || 'N/A'} (${zip.cable_length || 'N/A'}m)`,
          `Tensions: Load ${zip.load_tension || 'N/A'} / Unload ${zip.unload_tension || 'N/A'}`,
          `Results: Cable ${zip.cable_result || 'N/A'}, Brake ${zip.braking_result || 'N/A'}, EAD ${zip.ead_result || 'N/A'}`,
        ];
        
        zipDetails.forEach((detail) => {
          drawText(page, detail, margin + 5, yPos - 10, { size: 8 });
          yPos -= 12;
        });
        
        yPos -= 25;
      });
    } else {
      drawText(page, 'No ziplines recorded', margin, yPos, { size: 10, color: rgb(0.5, 0.5, 0.5) });
      yPos -= 20;
    }

    // PAGE: EQUIPMENT
    page = addPage();
    yPos = pageHeight - margin - 30;
    
    drawText(page, 'EQUIPMENT INSPECTION', margin, yPos, { size: 16, bold: true });
    yPos -= 30;

    if (equipment.length > 0) {
      // Group by category
      const categories = [...new Set(equipment.map(e => e.equipment_category))];
      
      categories.forEach((category) => {
        if (yPos < margin + 60) {
          page = addPage();
          yPos = pageHeight - margin - 30;
        }

        drawText(page, category, margin, yPos, { size: 12, bold: true });
        yPos -= 20;

        const categoryEquip = equipment.filter(e => e.equipment_category === category);
        categoryEquip.forEach((eq) => {
          if (yPos < margin + 30) {
            page = addPage();
            yPos = pageHeight - margin - 30;
          }

          page.drawRectangle({ x: margin, y: yPos - 15, width: pageWidth - 2 * margin, height: 20, borderColor: rgb(0.8, 0.8, 0.8), borderWidth: 0.5 });
          drawText(page, eq.equipment_type, margin + 5, yPos - 10, { size: 8 });
          drawText(page, `${eq.quantity || 'N/A'} (${eq.production_year || 'N/A'})`, margin + 250, yPos - 10, { size: 8 });
          drawText(page, eq.result, margin + 350, yPos - 10, { size: 8, color: getResultColor(eq.result) });
          yPos -= 20;
        });
        yPos -= 10;
      });
    } else {
      drawText(page, 'No equipment recorded', margin, yPos, { size: 10, color: rgb(0.5, 0.5, 0.5) });
    }

    // PAGE: STANDARDS
    page = addPage();
    yPos = pageHeight - margin - 30;
    
    drawText(page, 'STANDARDS & DOCUMENTATION', margin, yPos, { size: 16, bold: true });
    yPos -= 30;

    if (standards.length > 0) {
      standards.forEach((std) => {
        if (yPos < margin + 30) {
          page = addPage();
          yPos = pageHeight - margin - 30;
        }

        const status = std.has_documentation ? 'YES' : 'NO';
        const color = std.has_documentation ? rgb(0.06, 0.73, 0.51) : rgb(0.94, 0.27, 0.27);
        
        // Draw colored box for status
        page.drawRectangle({
          x: margin,
          y: yPos - 12,
          width: 30,
          height: 14,
          color: color,
        });
        
        // Draw status text in white
        drawText(page, status, margin + 3, yPos - 8, { size: 8, color: rgb(1, 1, 1), bold: true });
        
        // Draw standard name
        drawText(page, std.standard_name, margin + 40, yPos, { size: 10 });
        yPos -= 15;
        if (std.comments) {
          drawText(page, `  ${std.comments}`, margin + 40, yPos, { size: 8, color: rgb(0.5, 0.5, 0.5) });
          yPos -= 15;
        }
        yPos -= 5;
      });
    } else {
      drawText(page, 'No standards compliance recorded', margin, yPos, { size: 10, color: rgb(0.5, 0.5, 0.5) });
    }

    // PAGE: SUMMARY
    page = addPage();
    yPos = pageHeight - margin - 30;
    
    drawText(page, 'INSPECTION SUMMARY', margin, yPos, { size: 16, bold: true });
    yPos -= 30;

    // Repairs Performed
    drawText(page, 'Repairs & Alterations Performed:', margin, yPos, { size: 12, bold: true });
    yPos -= 20;
    const repairs = summary.repairs_performed || 'None recorded';
    const repairLines = repairs.match(/.{1,90}/g) || [repairs];
    repairLines.forEach((line: string) => {
      if (yPos < margin + 20) {
        page = addPage();
        yPos = pageHeight - margin - 30;
      }
      drawText(page, line, margin, yPos, { size: 9 });
      yPos -= 12;
    });

    yPos -= 20;
    if (yPos < margin + 100) {
      page = addPage();
      yPos = pageHeight - margin - 30;
    }

    // Critical Actions
    drawText(page, 'Critical Actions Required:', margin, yPos, { size: 12, bold: true, color: rgb(0.94, 0.27, 0.27) });
    yPos -= 20;
    page.drawRectangle({ x: margin, y: yPos - 60, width: pageWidth - 2 * margin, height: 65, borderColor: rgb(0.94, 0.27, 0.27), borderWidth: 2 });
    const critical = summary.critical_actions || 'None';
    const criticalLines = critical.match(/.{1,90}/g) || [critical];
    criticalLines.forEach((line: string) => {
      drawText(page, line, margin + 5, yPos - 10, { size: 9 });
      yPos -= 12;
    });
    yPos -= 60;

    // Future Considerations
    if (yPos < margin + 60) {
      page = addPage();
      yPos = pageHeight - margin - 30;
    }
    drawText(page, 'Future Considerations:', margin, yPos, { size: 12, bold: true });
    yPos -= 20;
    const future = summary.future_considerations || 'None noted';
    const futureLines = future.match(/.{1,90}/g) || [future];
    futureLines.forEach((line: string) => {
      if (yPos < margin + 20) {
        page = addPage();
        yPos = pageHeight - margin - 30;
      }
      drawText(page, line, margin, yPos, { size: 9 });
      yPos -= 12;
    });

    yPos -= 20;
    drawText(page, `Next Inspection Date: ${formatDate(summary.next_inspection_date)}`, margin, yPos, { size: 11, bold: true });

    // Add page numbers
    const pages = pdfDoc.getPages();
    pages.forEach((p, i) => {
      p.drawText(`Page ${i + 1} of ${pages.length}`, {
        x: pageWidth / 2 - 30,
        y: 20,
        size: 9,
        font: helveticaFont,
        color: rgb(0.5, 0.5, 0.5),
      });
    });

    // Save PDF
    const pdfBytes = await pdfDoc.save();
    
    // Upload to storage
    const fileName = `${inspectionId}_${Date.now()}.pdf`;
    const { error: uploadError } = await supabaseClient.storage
      .from('inspection-reports')
      .upload(fileName, pdfBytes, {
        contentType: 'application/pdf',
        upsert: false,
      });

    if (uploadError) {
      console.error('Upload error:', uploadError);
      throw uploadError;
    }

    // Create metadata record
    const { error: recordError } = await supabaseClient
      .from('inspection_reports')
      .insert({
        inspection_id: inspectionId,
        pdf_url: fileName,
        file_size_bytes: pdfBytes.length,
        generated_by: user.id,
      });

    if (recordError) {
      console.error('Record error:', recordError);
    }

    console.log('PDF generated successfully:', fileName);

    // Convert PDF bytes to base64 for transfer
    const base64Pdf = btoa(String.fromCharCode(...new Uint8Array(pdfBytes)));

    return new Response(
      JSON.stringify({ 
        pdfData: base64Pdf,
        fileName,
        fileSize: pdfBytes.length,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('Error generating PDF:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});