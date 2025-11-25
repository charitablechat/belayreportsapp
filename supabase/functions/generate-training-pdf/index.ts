import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jsPDF } from "https://esm.sh/jspdf@2.5.2";

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

    // Create PDF
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 20;
    const contentWidth = pageWidth - (2 * margin);
    let yPos = margin;

    // Helper to add new page if needed
    const checkPageBreak = (neededSpace: number) => {
      if (yPos + neededSpace > pageHeight - margin) {
        doc.addPage();
        yPos = margin;
        return true;
      }
      return false;
    };

    // Helper to wrap text
    const addWrappedText = (text: string, fontSize: number, isBold = false) => {
      doc.setFontSize(fontSize);
      doc.setFont('helvetica', isBold ? 'bold' : 'normal');
      const lines = doc.splitTextToSize(text, contentWidth);
      const lineHeight = fontSize * 0.4;
      
      checkPageBreak(lines.length * lineHeight);
      
      lines.forEach((line: string) => {
        if (yPos > pageHeight - margin) {
          doc.addPage();
          yPos = margin;
        }
        doc.text(line, margin, yPos);
        yPos += lineHeight;
      });
    };

    // Header
    doc.setFillColor(30, 64, 175);
    doc.rect(0, 0, pageWidth, 35, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(24);
    doc.setFont('helvetica', 'bold');
    doc.text('ROPE WORKS INC.', pageWidth / 2, 15, { align: 'center' });
    doc.setFontSize(16);
    doc.setFont('helvetica', 'normal');
    doc.text('Training Report', pageWidth / 2, 25, { align: 'center' });
    
    yPos = 45;
    doc.setTextColor(0, 0, 0);

    // Training Information
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(30, 64, 175);
    doc.text('Training Information', margin, yPos);
    yPos += 8;
    
    doc.setDrawColor(203, 213, 225);
    doc.line(margin, yPos, pageWidth - margin, yPos);
    yPos += 8;

    doc.setFontSize(10);
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'bold');
    doc.text('Training Site:', margin, yPos);
    doc.setFont('helvetica', 'normal');
    doc.text(training.organization || 'N/A', margin + 40, yPos);
    yPos += 6;

    doc.setFont('helvetica', 'bold');
    doc.text('Start Date:', margin, yPos);
    doc.setFont('helvetica', 'normal');
    doc.text(formatDate(training.start_date), margin + 40, yPos);
    yPos += 6;

    doc.setFont('helvetica', 'bold');
    doc.text('End Date:', margin, yPos);
    doc.setFont('helvetica', 'normal');
    doc.text(formatDate(training.end_date), margin + 40, yPos);
    yPos += 6;

    doc.setFont('helvetica', 'bold');
    doc.text('Trainer(s) of Record:', margin, yPos);
    doc.setFont('helvetica', 'normal');
    doc.text(training.trainer_of_record || 'N/A', margin + 50, yPos);
    yPos += 10;

    if (training.trainee_names) {
      checkPageBreak(20);
      doc.setFont('helvetica', 'bold');
      doc.text('Trainee Names:', margin, yPos);
      yPos += 6;
      doc.setFont('helvetica', 'normal');
      const traineeLines = training.trainee_names.split('\n');
      traineeLines.forEach((line: string) => {
        checkPageBreak(5);
        doc.text(line, margin, yPos);
        yPos += 5;
      });
      yPos += 5;
    }

    // Standards Text
    checkPageBreak(30);
    doc.setFillColor(219, 234, 254);
    doc.roundedRect(margin - 5, yPos - 5, contentWidth + 10, 25, 3, 3, 'F');
    doc.setFontSize(9);
    doc.setTextColor(30, 64, 175);
    const standardsText = 'Rope Works Inc. completed a site visit for training and operations on the above date(s). LISTED BELOW are the operating systems on your site we trained or reviewed in accordance with Rope Works Inc. operational procedures and the Association for Challenge Course Technology (ACCT) operational and training standards. Standards applied include ANSI/ACCT 03-2016 and ANSI/ACCT 03-2019.';
    const standardsLines = doc.splitTextToSize(standardsText, contentWidth);
    standardsLines.forEach((line: string, index: number) => {
      doc.text(line, margin, yPos + (index * 4.5));
    });
    yPos += (standardsLines.length * 4.5) + 10;
    doc.setTextColor(0, 0, 0);

    // Delivery Approach
    if (deliveryApproaches && deliveryApproaches.length > 0) {
      checkPageBreak(20);
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 64, 175);
      doc.text('Delivery Approach', margin, yPos);
      yPos += 8;
      doc.setDrawColor(203, 213, 225);
      doc.line(margin, yPos, pageWidth - margin, yPos);
      yPos += 6;
      
      doc.setFontSize(10);
      doc.setTextColor(0, 0, 0);
      doc.setFont('helvetica', 'normal');
      deliveryApproaches.forEach((a: any) => {
        checkPageBreak(6);
        doc.text('☑ ' + a.approach, margin, yPos);
        yPos += 6;
      });
      yPos += 5;
    }

    // Operating Systems
    if (operatingSystems && operatingSystems.length > 0) {
      checkPageBreak(20);
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 64, 175);
      doc.text('Operating Systems', margin, yPos);
      yPos += 8;
      doc.setDrawColor(203, 213, 225);
      doc.line(margin, yPos, pageWidth - margin, yPos);
      yPos += 6;
      
      doc.setFontSize(10);
      doc.setTextColor(0, 0, 0);
      doc.setFont('helvetica', 'normal');
      operatingSystems.forEach((s: any) => {
        checkPageBreak(6);
        const text = s.other_description ? `${s.system_name} - ${s.other_description}` : s.system_name;
        doc.text('☑ ' + text, margin, yPos);
        yPos += 6;
      });
      yPos += 5;
    }

    // Verifiable Items
    if (verifiableItems && verifiableItems.length > 0) {
      checkPageBreak(35);
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
      yPos += 8;
      
      doc.setFontSize(10);
      doc.setTextColor(0, 0, 0);
      doc.setFont('helvetica', 'normal');
      verifiableItems.forEach((v: any) => {
        checkPageBreak(6);
        doc.text('☑ ' + v.item, margin, yPos);
        yPos += 6;
      });
      yPos += 5;
    }

    // Systems in Place
    if (systemsInPlace && systemsInPlace.length > 0) {
      checkPageBreak(25);
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 64, 175);
      doc.text('Systems in Place', margin, yPos);
      yPos += 8;
      doc.setDrawColor(203, 213, 225);
      doc.line(margin, yPos, pageWidth - margin, yPos);
      yPos += 6;
      
      doc.setFontSize(10);
      doc.setTextColor(0, 0, 0);
      doc.setFont('helvetica', 'normal');
      systemsInPlace.forEach((s: any) => {
        checkPageBreak(6);
        doc.text('☑ ' + s.system_item, margin, yPos);
        yPos += 6;
      });
      yPos += 5;
    }

    // Immediate Attention
    if (immediateAttention && immediateAttention.length > 0) {
      checkPageBreak(25);
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(211, 47, 47);
      doc.text('⚠ Immediate Attention', margin, yPos);
      yPos += 8;
      doc.setDrawColor(203, 213, 225);
      doc.line(margin, yPos, pageWidth - margin, yPos);
      yPos += 6;
      
      doc.setFontSize(10);
      doc.setTextColor(211, 47, 47);
      doc.setFont('helvetica', 'normal');
      immediateAttention.forEach((i: any) => {
        checkPageBreak(6);
        doc.text('☑ ' + i.item, margin, yPos);
        yPos += 6;
      });
      yPos += 5;
      doc.setTextColor(0, 0, 0);
    }

    // Training Summary
    if (summary) {
      checkPageBreak(20);
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 64, 175);
      doc.text('Training Summary', margin, yPos);
      yPos += 8;
      doc.setDrawColor(203, 213, 225);
      doc.line(margin, yPos, pageWidth - margin, yPos);
      yPos += 8;

      if (summary.observations) {
        checkPageBreak(15);
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(0, 0, 0);
        doc.text('Training Observations', margin, yPos);
        yPos += 8;
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        const obsLines = doc.splitTextToSize(summary.observations, contentWidth);
        obsLines.forEach((line: string) => {
          checkPageBreak(5);
          doc.text(line, margin, yPos);
          yPos += 5;
        });
        yPos += 5;
      }

      if (summary.recommendations) {
        checkPageBreak(15);
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.text('Training Recommendations', margin, yPos);
        yPos += 8;
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        const recLines = doc.splitTextToSize(summary.recommendations, contentWidth);
        recLines.forEach((line: string) => {
          checkPageBreak(5);
          doc.text(line, margin, yPos);
          yPos += 5;
        });
        yPos += 5;
      }
    }

    // Report Verification
    if (summary?.person_submitting || summary?.submission_date) {
      checkPageBreak(25);
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 64, 175);
      doc.text('Report Verification', margin, yPos);
      yPos += 8;
      doc.setDrawColor(203, 213, 225);
      doc.line(margin, yPos, pageWidth - margin, yPos);
      yPos += 8;

      doc.setFontSize(10);
      doc.setTextColor(0, 0, 0);
      if (summary.person_submitting) {
        doc.setFont('helvetica', 'bold');
        doc.text('Person Submitting:', margin, yPos);
        doc.setFont('helvetica', 'normal');
        doc.text(summary.person_submitting, margin + 45, yPos);
        yPos += 6;
      }
      if (summary.submission_date) {
        doc.setFont('helvetica', 'bold');
        doc.text('Submission Date:', margin, yPos);
        doc.setFont('helvetica', 'normal');
        doc.text(formatDate(summary.submission_date), margin + 45, yPos);
        yPos += 10;
      }
    }

    // Disclaimer
    checkPageBreak(30);
    doc.setFillColor(254, 243, 199);
    doc.roundedRect(margin - 5, yPos - 5, contentWidth + 10, 25, 3, 3, 'F');
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(146, 64, 14);
    doc.text('DISCLAIMER', margin, yPos);
    yPos += 6;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(0, 0, 0);
    const disclaimerText = 'This training report documents the systems and procedures covered during the training session. It is the responsibility of the facility to implement and maintain proper operational procedures, conduct regular inspections, and ensure all staff are appropriately trained and certified.';
    const disclaimerLines = doc.splitTextToSize(disclaimerText, contentWidth);
    disclaimerLines.forEach((line: string, index: number) => {
      doc.text(line, margin, yPos + (index * 4));
    });
    yPos += (disclaimerLines.length * 4) + 10;

    // Footer
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text('Rope Works Inc. - ACCT Accredited Vendor', pageWidth / 2, pageHeight - 15, { align: 'center' });
    doc.text(`Report Generated: ${new Date().toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' })}`, pageWidth / 2, pageHeight - 10, { align: 'center' });
    if (profile?.acct_number) {
      doc.text(`ACCT #: ${profile.acct_number}`, pageWidth / 2, pageHeight - 5, { align: 'center' });
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
