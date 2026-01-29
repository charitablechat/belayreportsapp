import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jsPDF } from "https://esm.sh/jspdf@2.5.2";
import "https://esm.sh/jspdf-autotable@3.8.2";
import { checkRateLimit, createRateLimitResponse } from "../_shared/rate-limiter.ts";

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

    // Rate limiting: 10 PDF generations per user per hour
    const rateLimit = checkRateLimit(`pdf:inspection:${user.id}`, {
      maxRequests: 10,
      windowMs: 60 * 60 * 1000 // 1 hour
    });

    if (!rateLimit.allowed) {
      console.warn(`[Rate Limit] User ${user.id} exceeded PDF generation limit`);
      return createRateLimitResponse(rateLimit.resetAt, corsHeaders);
    }

    console.log(`[Rate Limit] User ${user.id} - ${rateLimit.remaining} requests remaining`);

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
      { data: summary, error: summaryError }
    ] = await Promise.all([
      supabase.from('inspections').select('*').eq('id', inspectionId).single(),
      supabase.from('inspection_systems').select('*').eq('inspection_id', inspectionId),
      supabase.from('inspection_ziplines').select('*').eq('inspection_id', inspectionId),
      supabase.from('inspection_equipment').select('*').eq('inspection_id', inspectionId),
      supabase.from('inspection_standards').select('*').eq('inspection_id', inspectionId),
      supabase.from('inspection_summary').select('*').eq('inspection_id', inspectionId).maybeSingle()
    ]);

    if (inspectionError) throw inspectionError;

    // Authorization check
    const isSuperAdmin = await supabase.from('user_roles').select('role').eq('user_id', user.id).eq('role', 'super_admin').single();
    if (!isSuperAdmin.data && inspection.inspector_id !== user.id) {
      throw new Error('Unauthorized to generate this report');
    }

    // Fetch the inspector profile using the inspection's inspector_id (not current user)
    const { data: inspectorProfile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', inspection.inspector_id)
      .maybeSingle();

    // Helper functions
    const formatDate = (dateStr: string | null) => {
      if (!dateStr) return 'N/A';
      const date = new Date(dateStr);
      return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    };

    const stripHtml = (html: string | null) => {
      if (!html) return '';
      let text = html.replace(/<[^>]*>/g, '');
      text = text.replace(/&amp;/g, '&');
      text = text.replace(/&lt;/g, '<');
      text = text.replace(/&gt;/g, '>');
      text = text.replace(/&quot;/g, '"');
      text = text.replace(/&#39;/g, "'");
      text = text.replace(/&nbsp;/g, ' ');
      text = text.replace(/&apos;/g, "'");
      text = text.replace(/&copy;/g, '©');
      text = text.replace(/&reg;/g, '®');
      text = text.replace(/&trade;/g, '™');
      return text.trim();
    };

    // Format comments as bullet points for PDF
    const formatCommentsForPdf = (comments: string | null): string => {
      if (!comments) return '-';
      const text = stripHtml(comments);
      if (!text || text === '-') return '-';
      
      // Split by newlines
      const lines = text.split(/\n/).map(l => l.trim()).filter(Boolean);
      
      if (lines.length <= 1) {
        return text;
      }
      
      // Format as bullet list
      return lines.map(line => {
        // Remove existing bullet characters
        const cleaned = line.replace(/^[\-•●○◦▪▸►]\s*/, '').replace(/^\d+[.)]\s*/, '').trim();
        return `• ${cleaned}`;
      }).join('\n');
    };

    const inspectorName = `${inspectorProfile?.first_name || ''} ${inspectorProfile?.last_name || ''}`.trim() || 'Inspector';

    console.log('Creating PDF document with jsPDF...');

    // Create PDF
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    }) as any;

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 20;
    const contentWidth = pageWidth - (2 * margin);
    let yPos = margin;

    // Add footer to all pages
    const addFooter = () => {
      const currentPage = doc.internal.getCurrentPageInfo().pageNumber;
      const totalPages = doc.internal.getNumberOfPages();
      
      doc.setFontSize(9);
      doc.setTextColor(100, 116, 139);
      doc.text('Rope Works Inc. - ACCT Accredited Vendor', pageWidth / 2, pageHeight - 15, { align: 'center' });
      doc.text(`Page ${currentPage} of ${totalPages}`, pageWidth / 2, pageHeight - 10, { align: 'center' });
      if (inspectorProfile?.acct_number) {
        doc.text(`ACCT #: ${inspectorProfile.acct_number}`, pageWidth / 2, pageHeight - 5, { align: 'center' });
      }
    };

    // Fetch logo and convert to base64
    let logoBase64 = '';
    try {
      const logoResponse = await fetch('https://ssgzcgvygnsrqalisshx.supabase.co/storage/v1/object/public/pdf-templates/rope-works-logo.png');
      if (logoResponse.ok) {
        const logoBlob = await logoResponse.arrayBuffer();
        const logoArray = new Uint8Array(logoBlob);
        const binary = logoArray.reduce((acc, byte) => acc + String.fromCharCode(byte), '');
        logoBase64 = btoa(binary);
      }
    } catch (error) {
      console.error('Failed to load logo:', error);
    }

    // Header - only on first page
    doc.setFillColor(30, 64, 175);
    doc.rect(0, 0, pageWidth, 35, 'F');
    
    // Add logo if available
    if (logoBase64) {
      try {
        doc.addImage(`data:image/png;base64,${logoBase64}`, 'PNG', margin, 8, 20, 20);
      } catch (error) {
        console.error('Failed to add logo to PDF:', error);
      }
    }
    
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(24);
    doc.setFont('helvetica', 'bold');
    doc.text('ROPE WORKS INC.', pageWidth / 2, 15, { align: 'center' });
    doc.setFontSize(16);
    doc.setFont('helvetica', 'normal');
    doc.text('Challenge Course Inspection Report', pageWidth / 2, 25, { align: 'center' });
    
    yPos = 45;
    doc.setTextColor(0, 0, 0);

    // Facility Information Section
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(30, 64, 175);
    doc.text('Facility Information', margin, yPos);
    yPos += 8;
    
    doc.setDrawColor(203, 213, 225);
    doc.line(margin, yPos, pageWidth - margin, yPos);
    yPos += 8;

    // Create facility info table
    const facilityData: any[] = [
      ['Facility Name', stripHtml(inspection.organization) || 'N/A'],
      ['Location', stripHtml(inspection.location) || 'N/A'],
      ['Onsite Contact', stripHtml(inspection.onsite_contact) || 'N/A'],
      ['Inspection Date', formatDate(inspection.inspection_date)],
      ['Inspector', inspectorName],
      ['Previous Inspection', `${formatDate(inspection.previous_inspection_date)} by ${stripHtml(inspection.previous_inspector) || 'N/A'}`]
    ];

    doc.autoTable({
      startY: yPos,
      head: [],
      body: facilityData,
      theme: 'plain',
      styles: {
        fontSize: 10,
        cellPadding: 2,
        lineColor: [240, 240, 240],
        lineWidth: 0.1
      },
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: 50 },
        1: { fontStyle: 'normal' }
      },
      margin: { left: margin, right: margin }
    });

    yPos = doc.lastAutoTable.finalY + 10;

    // Course History
    if (inspection.course_history) {
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 64, 175);
      doc.text('Course History', margin, yPos);
      yPos += 6;
      
      doc.setFontSize(10);
      doc.setTextColor(0, 0, 0);
      doc.setFont('helvetica', 'normal');
      const historyLines = doc.splitTextToSize(stripHtml(inspection.course_history), contentWidth);
      historyLines.forEach((line: string) => {
        if (yPos > pageHeight - 40) {
          doc.addPage();
          yPos = margin;
        }
        doc.text(line, margin, yPos);
        yPos += 5;
      });
      yPos += 8;
    }

    // ACCT Standards Box
    doc.setFillColor(219, 234, 254);
    const standardsText = 'This inspection was conducted in accordance with Association for Challenge Course Technology (ACCT) Standards (ANSI/ACCT 03-2016 and ANSI/ACCT 03-2019) and industry best practices.';
    const standardsLines = doc.splitTextToSize(standardsText, contentWidth - 10);
    const boxHeight = (standardsLines.length * 4.5) + 10;
    
    doc.roundedRect(margin - 5, yPos - 5, contentWidth + 10, boxHeight, 3, 3, 'F');
    doc.setFontSize(9);
    doc.setTextColor(30, 64, 175);
    standardsLines.forEach((line: string, index: number) => {
      doc.text(line, margin, yPos + (index * 4.5));
    });
    yPos += boxHeight + 10;
    doc.setTextColor(0, 0, 0);

    // Operating Systems Section
    if (systems && systems.length > 0) {
      if (yPos > pageHeight - 80) {
        doc.addPage();
        yPos = margin;
      }
      
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 64, 175);
      doc.text('Operating Systems', margin, yPos);
      yPos += 8;
      doc.setDrawColor(203, 213, 225);
      doc.line(margin, yPos, pageWidth - margin, yPos);
      yPos += 5;

      doc.autoTable({
        startY: yPos,
        head: [['System Name', 'Result', 'Comments']],
        body: systems.map(sys => [
          stripHtml(sys.system_name || sys.name) || 'N/A',
          sys.result || 'N/A',
          formatCommentsForPdf(sys.comments)
        ]),
        styles: { fontSize: 9, cellPadding: 3, textColor: [0, 0, 0] },
        headStyles: { fillColor: [30, 64, 175], textColor: [255, 255, 255], fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        columnStyles: {
          0: { cellWidth: 50 },
          1: { cellWidth: 30 },
          2: { cellWidth: 'auto' }
        },
        didParseCell: function (data: any) {
          if (data.section === 'body' && data.column.index === 1) {
            const result = data.cell.raw;
            if (result === 'Pass') data.cell.styles.textColor = [34, 139, 34];
            else if (result === 'Fail') data.cell.styles.textColor = [211, 47, 47];
            else data.cell.styles.textColor = [255, 140, 0];
            data.cell.styles.fontStyle = 'bold';
          }
        },
        margin: { left: margin, right: margin }
      });

      yPos = doc.lastAutoTable.finalY + 10;
    }

    // Ziplines Section
    if (ziplines && ziplines.length > 0) {
      if (yPos > pageHeight - 80) {
        doc.addPage();
        yPos = margin;
      }
      
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 64, 175);
      doc.text('Ziplines', margin, yPos);
      yPos += 8;
      doc.setDrawColor(203, 213, 225);
      doc.line(margin, yPos, pageWidth - margin, yPos);
      yPos += 5;

      doc.autoTable({
        startY: yPos,
        head: [['Name', 'Cable', 'Length', 'Braking', 'EAD', 'Result', 'Comments']],
        body: ziplines.map(zip => [
          stripHtml(zip.zipline_name) || 'N/A',
          stripHtml(zip.cable_type) || 'N/A',
          zip.cable_length ? `${zip.cable_length}ft` : 'N/A',
          stripHtml(zip.braking_system) || 'N/A',
          stripHtml(zip.ead_system) || 'N/A',
          zip.result || 'N/A',
          formatCommentsForPdf(zip.comments)
        ]),
        styles: { fontSize: 8, cellPadding: 2, textColor: [0, 0, 0] },
        headStyles: { fillColor: [30, 64, 175], textColor: [255, 255, 255], fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        columnStyles: {
          0: { cellWidth: 25 },
          1: { cellWidth: 20 },
          2: { cellWidth: 15 },
          3: { cellWidth: 20 },
          4: { cellWidth: 15 },
          5: { cellWidth: 18 },
          6: { cellWidth: 'auto' }
        },
        didParseCell: function (data: any) {
          if (data.section === 'body' && data.column.index === 5) {
            const result = data.cell.raw;
            if (result === 'Pass') data.cell.styles.textColor = [34, 139, 34];
            else if (result === 'Fail') data.cell.styles.textColor = [211, 47, 47];
            else data.cell.styles.textColor = [255, 140, 0];
            data.cell.styles.fontStyle = 'bold';
          }
        },
        margin: { left: margin, right: margin }
      });

      yPos = doc.lastAutoTable.finalY + 10;
    }

    // Equipment Section
    if (equipment && equipment.length > 0) {
      if (yPos > pageHeight - 80) {
        doc.addPage();
        yPos = margin;
      }
      
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 64, 175);
      doc.text('Equipment', margin, yPos);
      yPos += 8;
      doc.setDrawColor(203, 213, 225);
      doc.line(margin, yPos, pageWidth - margin, yPos);
      yPos += 8;

      const categories = ['PPE', 'Hardware', 'Software', 'Belay Devices'];
      
      for (const category of categories) {
        const items = equipment.filter(e => e.equipment_category === category);
        if (items.length === 0) continue;

        if (yPos > pageHeight - 60) {
          doc.addPage();
          yPos = margin;
        }
        
        doc.setFontSize(12);
        doc.setTextColor(30, 64, 175);
        doc.setFont('helvetica', 'bold');
        doc.text(category, margin, yPos);
        yPos += 6;

        doc.autoTable({
          startY: yPos,
          head: [['Type', 'Qty', 'Year', 'Result', 'Comments']],
          body: items.map(eq => [
            stripHtml(eq.equipment_type) || 'N/A',
            eq.quantity?.toString() || 'N/A',
            eq.production_year?.toString() || 'N/A',
            eq.result || 'N/A',
            formatCommentsForPdf(eq.comments)
          ]),
          styles: { fontSize: 9, cellPadding: 2, textColor: [0, 0, 0] },
          headStyles: { fillColor: [30, 64, 175], textColor: [255, 255, 255], fontStyle: 'bold' },
          alternateRowStyles: { fillColor: [248, 250, 252] },
          columnStyles: {
            0: { cellWidth: 40 },
            1: { cellWidth: 15 },
            2: { cellWidth: 15 },
            3: { cellWidth: 25 },
            4: { cellWidth: 'auto' }
          },
          didParseCell: function (data: any) {
            if (data.section === 'body' && data.column.index === 3) {
              const result = data.cell.raw;
              if (result === 'Pass') data.cell.styles.textColor = [34, 139, 34];
              else if (result === 'Fail') data.cell.styles.textColor = [211, 47, 47];
              else data.cell.styles.textColor = [255, 140, 0];
              data.cell.styles.fontStyle = 'bold';
            }
          },
          margin: { left: margin, right: margin }
        });

        yPos = doc.lastAutoTable.finalY + 8;
      }
    }

    // Standards Section
    if (standards && standards.length > 0) {
      if (yPos > pageHeight - 80) {
        doc.addPage();
        yPos = margin;
      }
      
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 64, 175);
      doc.text('Standards Compliance', margin, yPos);
      yPos += 8;
      doc.setDrawColor(203, 213, 225);
      doc.line(margin, yPos, pageWidth - margin, yPos);
      yPos += 5;

      doc.autoTable({
        startY: yPos,
        head: [['Standard', 'Documentation', 'Comments']],
        body: standards.map(std => [
          stripHtml(std.standard_name) || 'N/A',
          std.has_documentation === true ? 'Yes' : (std.has_documentation === false ? 'No' : '-'),
          stripHtml(std.comments) || '-'
        ]),
        styles: { fontSize: 9, cellPadding: 3, textColor: [0, 0, 0] },
        headStyles: { fillColor: [30, 64, 175], textColor: [255, 255, 255], fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        columnStyles: {
          0: { cellWidth: 80 },
          1: { cellWidth: 35 },
          2: { cellWidth: 'auto' }
        },
        margin: { left: margin, right: margin }
      });

      yPos = doc.lastAutoTable.finalY + 10;
    }

    // Summary Section
    if (summary) {
      if (yPos > pageHeight - 80) {
        doc.addPage();
        yPos = margin;
      }
      
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 64, 175);
      doc.text('Summary', margin, yPos);
      yPos += 8;
      doc.setDrawColor(203, 213, 225);
      doc.line(margin, yPos, pageWidth - margin, yPos);
      yPos += 8;

      if (summary.critical_actions) {
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(211, 47, 47);
        doc.text('⚠ Critical Actions Required', margin, yPos);
        yPos += 6;
        doc.setFontSize(10);
        doc.setTextColor(0, 0, 0);
        doc.setFont('helvetica', 'normal');
        const criticalLines = doc.splitTextToSize(stripHtml(summary.critical_actions), contentWidth);
        criticalLines.forEach((line: string) => {
          if (yPos > pageHeight - 40) {
            doc.addPage();
            yPos = margin;
          }
          doc.text(line, margin, yPos);
          yPos += 5;
        });
        yPos += 8;
      }

      if (summary.repairs_performed) {
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(0, 0, 0);
        doc.text('Repairs Performed', margin, yPos);
        yPos += 6;
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        const repairLines = doc.splitTextToSize(stripHtml(summary.repairs_performed), contentWidth);
        repairLines.forEach((line: string) => {
          if (yPos > pageHeight - 40) {
            doc.addPage();
            yPos = margin;
          }
          doc.text(line, margin, yPos);
          yPos += 5;
        });
        yPos += 8;
      }

      if (summary.future_considerations) {
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.text('Future Considerations', margin, yPos);
        yPos += 6;
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        const futureLines = doc.splitTextToSize(stripHtml(summary.future_considerations), contentWidth);
        futureLines.forEach((line: string) => {
          if (yPos > pageHeight - 40) {
            doc.addPage();
            yPos = margin;
          }
          doc.text(line, margin, yPos);
          yPos += 5;
        });
        yPos += 8;
      }

      if (summary.next_inspection_date) {
        const nextInspectionData = [['Next Inspection Due', formatDate(summary.next_inspection_date)]];
        
        doc.autoTable({
          startY: yPos,
          head: [],
          body: nextInspectionData,
          theme: 'plain',
          styles: {
            fontSize: 10,
            cellPadding: 2
          },
          columnStyles: {
            0: { fontStyle: 'bold', cellWidth: 50 },
            1: { fontStyle: 'normal' }
          },
          margin: { left: margin, right: margin }
        });

        yPos = doc.lastAutoTable.finalY + 10;
      }
    }

    // Disclaimer Box
    if (yPos > pageHeight - 60) {
      doc.addPage();
      yPos = margin;
    }
    
    doc.setFillColor(254, 243, 199);
    const disclaimerText = 'This inspection report is based on visual observation and testing of the equipment and facilities at the time of inspection. The inspector makes no warranty, expressed or implied, that all defects have been discovered or that no defects exist other than those noted. This report does not constitute approval or acceptance of the facilities for any particular use.';
    const disclaimerLines = doc.splitTextToSize(disclaimerText, contentWidth - 10);
    const disclaimerHeight = (disclaimerLines.length * 4) + 16;
    
    doc.roundedRect(margin - 5, yPos - 5, contentWidth + 10, disclaimerHeight, 3, 3, 'F');
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(146, 64, 14);
    doc.text('DISCLAIMER', margin, yPos);
    yPos += 6;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(0, 0, 0);
    disclaimerLines.forEach((line: string, index: number) => {
      doc.text(line, margin, yPos + (index * 4));
    });

    // Add footers to all pages
    const totalPages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      addFooter();
    }

    console.log('PDF generated, converting to bytes...');

    // Get PDF as ArrayBuffer
    const pdfBytes = doc.output('arraybuffer');
    const pdfUint8Array = new Uint8Array(pdfBytes);

    console.log('Uploading to storage...');

    // Upload to storage
    const fileName = `inspection-${inspection.organization?.replace(/[^a-z0-9]/gi, '_')}-${Date.now()}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from('inspection-reports')
      .upload(fileName, pdfUint8Array, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadError) throw uploadError;

    // Create signed URL
    const { data: signedUrlData, error: signedUrlError } = await supabase.storage
      .from('inspection-reports')
      .createSignedUrl(fileName, 3600);

    if (signedUrlError) throw signedUrlError;

    // Use upsert to prevent race condition duplicates
    // The unique constraint on inspection_id ensures only one report per inspection
    // The database trigger automatically increments version on updates
    const { error: upsertError } = await supabase
      .from('inspection_reports')
      .upsert({
        inspection_id: inspectionId,
        pdf_url: fileName,
        generated_by: user.id,
        file_size_bytes: pdfUint8Array.length,
        version: 1, // Will be auto-incremented by trigger on updates
        generated_at: new Date().toISOString(),
        metadata: {
          generator: 'generate-inspection-pdf',
          format: 'pdf'
        }
      }, { 
        onConflict: 'inspection_id',
        ignoreDuplicates: false 
      });

    if (upsertError) {
      console.error('Failed to upsert inspection report:', upsertError);
      throw new Error('Failed to save inspection report');
    }
    
    console.log('Inspection report upserted successfully');

    return new Response(
      JSON.stringify({
        success: true,
        url: signedUrlData.signedUrl
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('Error generating inspection report:', error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500
      }
    );
  }
});
