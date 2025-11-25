import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jsPDF } from "https://esm.sh/jspdf@2.5.2";
import "https://esm.sh/jspdf-autotable@3.8.2";

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
      throw new Error('No authorization header');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    
    if (userError || !user) {
      throw new Error('Unauthorized');
    }

    const { trainingId } = await req.json();
    
    if (!trainingId) {
      throw new Error('Training ID is required');
    }

    // Fetch training data
    const { data: training, error: trainingError } = await supabaseAdmin
      .from('trainings')
      .select('*')
      .eq('id', trainingId)
      .single();

    if (trainingError) throw trainingError;

    // Authorization check
    if (training.inspector_id !== user.id) {
      const { data: roles } = await supabaseAdmin
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id);
      
      const isSuperAdmin = roles?.some(r => r.role === 'super_admin');
      if (!isSuperAdmin) {
        throw new Error('Unauthorized to generate this report');
      }
    }

    // Fetch all related data
    const [
      { data: deliveryApproaches },
      { data: operatingSystems },
      { data: immediateAttention },
      { data: verifiableItems },
      { data: systemsInPlace },
      { data: summary },
      { data: photos },
      { data: profile }
    ] = await Promise.all([
      supabaseAdmin.from('training_delivery_approaches').select('*').eq('training_id', trainingId),
      supabaseAdmin.from('training_operating_systems').select('*').eq('training_id', trainingId),
      supabaseAdmin.from('training_immediate_attention').select('*').eq('training_id', trainingId),
      supabaseAdmin.from('training_verifiable_items').select('*').eq('training_id', trainingId),
      supabaseAdmin.from('training_systems_in_place').select('*').eq('training_id', trainingId),
      supabaseAdmin.from('training_summary').select('*').eq('training_id', trainingId).single(),
      supabaseAdmin.from('training_photos').select('*').eq('training_id', trainingId),
      supabaseAdmin.from('profiles').select('first_name, last_name, acct_number').eq('id', training.inspector_id).single()
    ]);

    // Format dates
    const formatDate = (dateStr: string) => {
      const date = new Date(dateStr);
      return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    };

    // Strip HTML tags and decode entities
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
      if (profile?.acct_number) {
        doc.text(`ACCT #: ${profile.acct_number}`, pageWidth / 2, pageHeight - 5, { align: 'center' });
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
    doc.text('Training Report', pageWidth / 2, 25, { align: 'center' });
    
    yPos = 45;
    doc.setTextColor(0, 0, 0);

    // Training Information Section
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(30, 64, 175);
    doc.text('Training Information', margin, yPos);
    yPos += 8;
    
    doc.setDrawColor(203, 213, 225);
    doc.line(margin, yPos, pageWidth - margin, yPos);
    yPos += 8;

    // Create info table
    const infoData: any[] = [
      ['Training Site', stripHtml(training.organization) || 'N/A'],
      ['Start Date', formatDate(training.start_date)],
      ['End Date', formatDate(training.end_date)],
      ['Trainer(s) of Record', stripHtml(training.trainer_of_record) || 'N/A']
    ];

    doc.autoTable({
      startY: yPos,
      head: [],
      body: infoData,
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

    // Trainee Names
    if (training.trainee_names) {
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.text('Trainee Names:', margin, yPos);
      yPos += 6;
      
      doc.setFont('helvetica', 'normal');
      const traineeLines = doc.splitTextToSize(stripHtml(training.trainee_names), contentWidth);
      traineeLines.forEach((line: string) => {
        doc.text(line, margin, yPos);
        yPos += 5;
      });
      yPos += 8;
    }

    // Standards Box
    doc.setFillColor(219, 234, 254);
    const standardsText = 'Rope Works Inc. completed a site visit for training and operations on the above date(s). LISTED BELOW are the operating systems on your site we trained or reviewed in accordance with Rope Works Inc. operational procedures and the Association for Challenge Course Technology (ACCT) operational and training standards. Standards applied include ANSI/ACCT 03-2016 and ANSI/ACCT 03-2019.';
    const standardsLines = doc.splitTextToSize(standardsText, contentWidth - 10);
    const boxHeight = (standardsLines.length * 4.5) + 10;
    
    doc.roundedRect(margin - 5, yPos - 5, contentWidth + 10, boxHeight, 3, 3, 'F');
    doc.setFontSize(9);
    doc.setTextColor(30, 64, 175);
    standardsLines.forEach((line: string, index: number) => {
      doc.text(line, margin, yPos + (index * 4.5));
    });
    yPos += boxHeight + 5;
    doc.setTextColor(0, 0, 0);

    // Delivery Approach Section
    if (deliveryApproaches && deliveryApproaches.length > 0) {
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 64, 175);
      doc.text('Delivery Approach', margin, yPos);
      yPos += 8;
      doc.setDrawColor(203, 213, 225);
      doc.line(margin, yPos, pageWidth - margin, yPos);
      yPos += 5;
      
      const approachData = deliveryApproaches.map((a: any) => ['☑ ' + stripHtml(a.approach)]);
      
      doc.autoTable({
        startY: yPos,
        head: [],
        body: approachData,
        theme: 'striped',
        styles: {
          fontSize: 10,
          cellPadding: 3,
          textColor: [0, 0, 0]
        },
        alternateRowStyles: {
          fillColor: [248, 250, 252]
        },
        margin: { left: margin, right: margin }
      });

      yPos = doc.lastAutoTable.finalY + 10;
    }

    // Operating Systems Section
    if (operatingSystems && operatingSystems.length > 0) {
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 64, 175);
      doc.text('Operating Systems', margin, yPos);
      yPos += 8;
      doc.setDrawColor(203, 213, 225);
      doc.line(margin, yPos, pageWidth - margin, yPos);
      yPos += 5;
      
      const systemsData = operatingSystems.map((s: any) => {
        const text = s.other_description ? stripHtml(s.system_name) : stripHtml(s.system_name);
        const desc = stripHtml(s.other_description) || '';
        return ['☑ ' + text, desc];
      });
      
      doc.autoTable({
        startY: yPos,
        head: [],
        body: systemsData,
        theme: 'striped',
        styles: {
          fontSize: 10,
          cellPadding: 3,
          textColor: [0, 0, 0]
        },
        columnStyles: {
          0: { cellWidth: 80 },
          1: { cellWidth: 'auto' }
        },
        alternateRowStyles: {
          fillColor: [248, 250, 252]
        },
        margin: { left: margin, right: margin }
      });

      yPos = doc.lastAutoTable.finalY + 10;
    }

    // Verifiable Items Section
    if (verifiableItems && verifiableItems.length > 0) {
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 64, 175);
      doc.text('Verifiable Items During Training', margin, yPos);
      yPos += 8;
      doc.setDrawColor(203, 213, 225);
      doc.line(margin, yPos, pageWidth - margin, yPos);
      yPos += 8;
      
      doc.setFontSize(9);
      doc.setTextColor(100, 116, 139);
      doc.setFont('helvetica', 'italic');
      doc.text('CHECK ONLY THOSE THAT WERE VERIFIABLE AND IN PLACE DURING TRAINING.', margin, yPos);
      yPos += 5;
      
      const itemsData = verifiableItems.map((v: any) => ['☑ ' + stripHtml(v.item)]);
      
      doc.autoTable({
        startY: yPos,
        head: [],
        body: itemsData,
        theme: 'striped',
        styles: {
          fontSize: 10,
          cellPadding: 3,
          textColor: [0, 0, 0]
        },
        alternateRowStyles: {
          fillColor: [248, 250, 252]
        },
        margin: { left: margin, right: margin }
      });

      yPos = doc.lastAutoTable.finalY + 10;
    }

    // Systems in Place Section
    if (systemsInPlace && systemsInPlace.length > 0) {
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 64, 175);
      doc.text('Systems in Place', margin, yPos);
      yPos += 8;
      doc.setDrawColor(203, 213, 225);
      doc.line(margin, yPos, pageWidth - margin, yPos);
      yPos += 5;
      
      const systemsData = systemsInPlace.map((s: any) => ['☑ ' + stripHtml(s.system_item)]);
      
      doc.autoTable({
        startY: yPos,
        head: [],
        body: systemsData,
        theme: 'striped',
        styles: {
          fontSize: 10,
          cellPadding: 3,
          textColor: [0, 0, 0]
        },
        alternateRowStyles: {
          fillColor: [248, 250, 252]
        },
        margin: { left: margin, right: margin }
      });

      yPos = doc.lastAutoTable.finalY + 10;
    }

    // Immediate Attention Section
    if (immediateAttention && immediateAttention.length > 0) {
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(211, 47, 47);
      doc.text('⚠ Immediate Attention', margin, yPos);
      yPos += 8;
      doc.setDrawColor(211, 47, 47);
      doc.line(margin, yPos, pageWidth - margin, yPos);
      yPos += 5;
      
      const attentionData = immediateAttention.map((i: any) => ['⚠ ' + stripHtml(i.item)]);
      
      doc.autoTable({
        startY: yPos,
        head: [],
        body: attentionData,
        theme: 'striped',
        styles: {
          fontSize: 10,
          cellPadding: 3,
          textColor: [211, 47, 47]
        },
        alternateRowStyles: {
          fillColor: [254, 242, 242]
        },
        margin: { left: margin, right: margin }
      });

      yPos = doc.lastAutoTable.finalY + 10;
      doc.setTextColor(0, 0, 0);
    }

    // Training Summary Section
    if (summary) {
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 64, 175);
      doc.text('Training Summary', margin, yPos);
      yPos += 8;
      doc.setDrawColor(203, 213, 225);
      doc.line(margin, yPos, pageWidth - margin, yPos);
      yPos += 8;

      if (summary.observations) {
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(0, 0, 0);
        doc.text('Training Observations', margin, yPos);
        yPos += 6;
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        const obsLines = doc.splitTextToSize(stripHtml(summary.observations), contentWidth);
        obsLines.forEach((line: string) => {
          if (yPos > pageHeight - 40) {
            doc.addPage();
            yPos = margin;
          }
          doc.text(line, margin, yPos);
          yPos += 5;
        });
        yPos += 8;
      }

      if (summary.recommendations) {
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.text('Training Recommendations', margin, yPos);
        yPos += 6;
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        const recLines = doc.splitTextToSize(stripHtml(summary.recommendations), contentWidth);
        recLines.forEach((line: string) => {
          if (yPos > pageHeight - 40) {
            doc.addPage();
            yPos = margin;
          }
          doc.text(line, margin, yPos);
          yPos += 5;
        });
        yPos += 8;
      }
    }

    // Report Verification Section
    if (summary?.person_submitting || summary?.submission_date) {
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 64, 175);
      doc.text('Report Verification', margin, yPos);
      yPos += 8;
      doc.setDrawColor(203, 213, 225);
      doc.line(margin, yPos, pageWidth - margin, yPos);
      yPos += 8;

      const verificationData: any[] = [];
      if (summary.person_submitting) {
        verificationData.push(['Person Submitting', stripHtml(summary.person_submitting)]);
      }
      if (summary.submission_date) {
        verificationData.push(['Submission Date', formatDate(summary.submission_date)]);
      }

      doc.autoTable({
        startY: yPos,
        head: [],
        body: verificationData,
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

    // Disclaimer Box
    if (yPos > pageHeight - 60) {
      doc.addPage();
      yPos = margin;
    }
    
    doc.setFillColor(254, 243, 199);
    const disclaimerText = 'This training report documents the systems and procedures covered during the training session. It is the responsibility of the facility to implement and maintain proper operational procedures, conduct regular inspections, and ensure all staff are appropriately trained and certified.';
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

    // Generate PDF buffer
    const pdfBytes = doc.output('arraybuffer');
    const fileName = `training-report-${trainingId}-${Date.now()}.pdf`;
    const filePath = `training-reports/${fileName}`;

    // Upload to Supabase Storage
    const { error: uploadError } = await supabaseAdmin.storage
      .from('inspection-reports')
      .upload(filePath, pdfBytes, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadError) throw uploadError;

    // Create signed URL
    const { data: urlData } = await supabaseAdmin.storage
      .from('inspection-reports')
      .createSignedUrl(filePath, 60 * 60 * 24 * 7); // 7 days

    // Save report record
    await supabaseAdmin.from('training_reports').insert({
      training_id: trainingId,
      pdf_url: urlData?.signedUrl || '',
      generated_by: user.id,
      file_size_bytes: pdfBytes.byteLength,
      metadata: {
        generator: 'generate-training-pdf',
        format: 'pdf',
        sections_included: {
          delivery_approaches: deliveryApproaches?.length || 0,
          operating_systems: operatingSystems?.length || 0,
          immediate_attention: immediateAttention?.length || 0,
          verifiable_items: verifiableItems?.length || 0,
          systems_in_place: systemsInPlace?.length || 0,
          has_summary: !!summary,
          photo_count: photos?.length || 0
        }
      }
    });

    return new Response(
      JSON.stringify({
        success: true,
        signedUrl: urlData?.signedUrl,
        message: 'Training report generated successfully'
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      }
    );

  } catch (error) {
    console.error('Error generating training PDF:', error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Failed to generate training report'
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400
      }
    );
  }
});
