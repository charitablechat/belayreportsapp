import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jsPDF } from "https://esm.sh/jspdf@2.5.2";
import "https://esm.sh/jspdf-autotable@3.8.2";
import { fetchTrainingData, formatTrainingContent } from "../_shared/training-formatter.ts";
import { checkRateLimit, createRateLimitResponse } from "../_shared/rate-limiter.ts";
import { arrayBufferToBase64 } from "../_shared/report-layout.ts";


import { corsHeaders } from "../_shared/cors.ts";
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
    
    // Check if caller is using the service role key (internal/backup calls)
    const token = authHeader.replace('Bearer ', '');
    const isServiceRole = token === supabaseServiceKey;

    let user: any = null;
    if (isServiceRole) {
      console.log('[Auth] Service-role caller — skipping user auth and rate limiting');
    } else {
      const { data: { user: authUser }, error: userError } = await supabaseAdmin.auth.getUser(token);
      if (userError || !authUser) {
        throw new Error('Unauthorized');
      }
      user = authUser;

      // Rate limiting: 10 PDF generations per user per hour
      const rateLimit = checkRateLimit(`pdf:training:${user.id}`, {
        maxRequests: 10,
        windowMs: 60 * 60 * 1000 // 1 hour
      });

      if (!rateLimit.allowed) {
        console.warn(`[Rate Limit] User ${user.id} exceeded PDF generation limit`);
        return createRateLimitResponse(rateLimit.resetAt, corsHeaders);
      }

      console.log(`[Rate Limit] User ${user.id} - ${rateLimit.remaining} requests remaining`);
    }

    const { trainingId } = await req.json();
    
    if (!trainingId) {
      throw new Error('Training ID is required');
    }

    // Fetch training data using shared formatter
    const trainingData = await fetchTrainingData(trainingId, supabaseAdmin);
    
    // Authorization check (skip for service-role callers)
    if (!isServiceRole) {
      if (trainingData.training.inspector_id !== user.id) {
        const { data: roles } = await supabaseAdmin
          .from('user_roles')
          .select('role')
          .eq('user_id', user.id);
        
        const isSuperAdmin = roles?.some(r => r.role === 'admin');
        if (!isSuperAdmin) {
          throw new Error('Unauthorized to generate this report');
        }
      }
    }

    // Format content using shared formatter
    const content = formatTrainingContent(trainingData);

    // Fetch and add Unicode-compatible font
    let customFontLoaded = false;
    let fontData = '';
    try {
      const fontUrl = 'https://fonts.gstatic.com/s/roboto/v30/KFOmCnqEu92Fr1Mu4mxK.woff';
      const fontResponse = await fetch(fontUrl);
      if (fontResponse.ok) {
        const fontBlob = await fontResponse.arrayBuffer();
        fontData = arrayBufferToBase64(fontBlob);
        
        console.log('Custom font loaded successfully');
        customFontLoaded = true;
      }
    } catch (error) {
      console.error('Failed to load custom font, using default:', error);
    }

    // Create PDF
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    }) as any;

    // Add custom font if loaded
    if (customFontLoaded && fontData) {
      try {
        doc.addFileToVFS('Roboto-Regular.ttf', fontData);
        doc.addFont('Roboto-Regular.ttf', 'Roboto', 'normal');
        doc.setFont('Roboto');
        console.log('Roboto font set as default');
      } catch (error) {
        console.error('Failed to add font to PDF:', error);
        doc.setFont('helvetica'); // Fallback
      }
    } else {
      doc.setFont('helvetica');
    }

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 20;
    const contentWidth = pageWidth - (2 * margin);
    let yPos = margin;
    const footerZone = 30; // reserve 30mm at bottom for footer

    // Helper: check if we need a new page before drawing content
    const checkPageBreak = (neededHeight: number) => {
      if (yPos + neededHeight > pageHeight - footerZone) {
        doc.addPage();
        yPos = margin;
      }
    };

    // Add footer to all pages
    const addFooter = () => {
      const currentPage = doc.internal.getCurrentPageInfo().pageNumber;
      const totalPages = doc.internal.getNumberOfPages();
      
      doc.setFontSize(9);
      doc.setTextColor(100, 116, 139);
      doc.text('Rope Works Inc. - ACCT Accredited Vendor', pageWidth / 2, pageHeight - 12, { align: 'center' });
      if (trainingData.profile?.acct_number) {
        doc.text(`ACCT #: ${trainingData.profile.acct_number}`, pageWidth / 2, pageHeight - 7, { align: 'center' });
      }
    };

    // Fetch logo and convert to base64
    let logoBase64 = '';
    try {
      // L4 / PDF logos: derive base URL from env (project-ref rotation safety)
      const _supabaseUrl = Deno.env.get('SUPABASE_URL') ?? 'https://ssgzcgvygnsrqalisshx.supabase.co';
      const logoResponse = await fetch(`${_supabaseUrl}/storage/v1/object/public/pdf-templates/rope-works-logo.png`);
      if (logoResponse.ok) {
        const logoBlob = await logoResponse.arrayBuffer();
        logoBase64 = arrayBufferToBase64(logoBlob);
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
      ['Training Site', content.facilityInfo.organization],
      ['Start Date', content.facilityInfo.startDate],
      ['End Date', content.facilityInfo.endDate],
      ['Trainer(s) of Record', content.facilityInfo.trainerOfRecord]
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
    if (content.facilityInfo.traineeNames !== 'N/A') {
      const traineeLines = doc.splitTextToSize(content.facilityInfo.traineeNames, contentWidth);
      checkPageBreak(6 + (traineeLines.length * 5) + 8);
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.text('Trainee Names:', margin, yPos);
      yPos += 6;
      
      doc.setFont('helvetica', 'normal');
      traineeLines.forEach((line: string) => {
        checkPageBreak(5);
        doc.text(line, margin, yPos);
        yPos += 5;
      });
      yPos += 8;
    }

    // Standards Box
    const standardsLines = doc.splitTextToSize(content.standardsText, contentWidth - 10);
    const boxHeight = (standardsLines.length * 4.5) + 10;
    checkPageBreak(boxHeight + 5);
    doc.setFillColor(219, 234, 254);
    
    doc.roundedRect(margin - 5, yPos - 5, contentWidth + 10, boxHeight, 3, 3, 'F');
    doc.setFontSize(9);
    doc.setTextColor(30, 64, 175);
    standardsLines.forEach((line: string, index: number) => {
      doc.text(line, margin, yPos + (index * 4.5));
    });
    yPos += boxHeight + 5;
    doc.setTextColor(0, 0, 0);

    // Delivery Approach Section
    if (content.deliveryApproaches.length > 0) {
      checkPageBreak(25);
      doc.setFontSize(14);
      doc.setDrawColor(203, 213, 225);
      doc.line(margin, yPos, pageWidth - margin, yPos);
      yPos += 5;
      
      const approachData = content.deliveryApproaches.map((approach: string) => ['☑ ' + approach]);
      
      doc.autoTable({
        startY: yPos,
        head: [],
        body: approachData,
        theme: 'striped',
        styles: {
          font: customFontLoaded ? 'Roboto' : 'helvetica',
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
    if (content.operatingSystems.length > 0) {
      checkPageBreak(25);
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 64, 175);
      doc.text('Operating Systems', margin, yPos);
      yPos += 8;
      doc.setDrawColor(203, 213, 225);
      doc.line(margin, yPos, pageWidth - margin, yPos);
      yPos += 5;
      
      const systemsData = content.operatingSystems.map((sys: any) => {
        return ['☑ ' + sys.name, sys.description || ''];
      });
      
      doc.autoTable({
        startY: yPos,
        head: [],
        body: systemsData,
        theme: 'striped',
        styles: {
          font: customFontLoaded ? 'Roboto' : 'helvetica',
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
    if (content.verifiableItems.length > 0) {
      checkPageBreak(30);
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
      
      const itemsData = content.verifiableItems.map((item: string) => ['☑ ' + item]);
      
      doc.autoTable({
        startY: yPos,
        head: [],
        body: itemsData,
        theme: 'striped',
        styles: {
          font: customFontLoaded ? 'Roboto' : 'helvetica',
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
    if (content.systemsInPlace.length > 0) {
      checkPageBreak(25);
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 64, 175);
      doc.text('Systems in Place', margin, yPos);
      yPos += 8;
      doc.setDrawColor(203, 213, 225);
      doc.line(margin, yPos, pageWidth - margin, yPos);
      yPos += 5;
      
      const systemsData = content.systemsInPlace.map((item: string) => ['☑ ' + item]);
      
      doc.autoTable({
        startY: yPos,
        head: [],
        body: systemsData,
        theme: 'striped',
        styles: {
          font: customFontLoaded ? 'Roboto' : 'helvetica',
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
    if (content.immediateAttention.length > 0) {
      checkPageBreak(25);
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(211, 47, 47);
      doc.text('⚠ Immediate Attention', margin, yPos);
      yPos += 8;
      doc.setDrawColor(211, 47, 47);
      doc.line(margin, yPos, pageWidth - margin, yPos);
      yPos += 5;
      
      const attentionData = content.immediateAttention.map((item: string) => ['⚠ ' + item]);
      
      doc.autoTable({
        startY: yPos,
        head: [],
        body: attentionData,
        theme: 'striped',
        styles: {
          font: customFontLoaded ? 'Roboto' : 'helvetica',
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
    if (content.summary.observationsList.length > 0 || content.summary.recommendationsList.length > 0) {
      checkPageBreak(25);
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 64, 175);
      doc.text('Training Summary', margin, yPos);
      yPos += 8;
      doc.setDrawColor(203, 213, 225);
      doc.line(margin, yPos, pageWidth - margin, yPos);
      yPos += 8;

      if (content.summary.observationsList.length > 0) {
        checkPageBreak(20);
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(0, 0, 0);
        doc.text('Training Observations', margin, yPos);
        yPos += 6;

        // Use autoTable for consistent bullet formatting - each sentence as its own bullet
        const observationData = content.summary.observationsList.map((item: string) => ['• ' + item]);

        doc.autoTable({
          startY: yPos,
          head: [],
          body: observationData,
          theme: 'plain',
          styles: {
            font: customFontLoaded ? 'Roboto' : 'helvetica',
            fontSize: 10,
            cellPadding: 3,
            textColor: [0, 0, 0]
          },
          margin: { left: margin, right: margin }
        });

        yPos = doc.lastAutoTable.finalY + 8;
      }

      if (content.summary.recommendationsList.length > 0) {
        checkPageBreak(20);
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(0, 0, 0);
        doc.text('Training Recommendations', margin, yPos);
        yPos += 6;

        // Use autoTable for consistent bullet formatting - each sentence as its own bullet
        const recommendationData = content.summary.recommendationsList.map((item: string) => ['• ' + item]);

        doc.autoTable({
          startY: yPos,
          head: [],
          body: recommendationData,
          theme: 'plain',
          styles: {
            font: customFontLoaded ? 'Roboto' : 'helvetica',
            fontSize: 10,
            cellPadding: 3,
            textColor: [0, 0, 0]
          },
          margin: { left: margin, right: margin }
        });

        yPos = doc.lastAutoTable.finalY + 8;
      }
    }

    // Report Verification Section
    if (content.summary.personSubmitting || content.summary.submissionDate) {
      checkPageBreak(30);
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 64, 175);
      doc.text('Report Verification', margin, yPos);
      yPos += 8;
      doc.setDrawColor(203, 213, 225);
      doc.line(margin, yPos, pageWidth - margin, yPos);
      yPos += 8;

      const verificationData: any[] = [];
      if (content.summary.personSubmitting) {
        verificationData.push(['Person Submitting', content.summary.personSubmitting]);
      }
      if (content.summary.submissionDate) {
        verificationData.push(['Submission Date', content.summary.submissionDate]);
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

    // Training Photos Section
    if (trainingData.photos && trainingData.photos.length > 0) {
      doc.addPage();
      yPos = margin;
      
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 64, 175);
      doc.text('Training Photos', margin, yPos);
      yPos += 8;
      doc.setDrawColor(203, 213, 225);
      doc.line(margin, yPos, pageWidth - margin, yPos);
      yPos += 10;

      for (const photo of trainingData.photos) {
        try {
          const { data: urlData } = await supabaseAdmin.storage
            .from('training-photos')
            .createSignedUrl(photo.photo_url, 60 * 60);
          
          if (urlData?.signedUrl) {
            const imgResponse = await fetch(urlData.signedUrl);
            if (imgResponse.ok) {
              const imgBlob = await imgResponse.arrayBuffer();
              const imgArray = new Uint8Array(imgBlob);

              // HEIC magic-byte detection — skip mislabeled files
              if (imgArray.length >= 12) {
                const decoder = new TextDecoder('ascii');
                const ftypTag = decoder.decode(imgArray.slice(4, 8));
                if (ftypTag === 'ftyp') {
                  const brand = decoder.decode(imgArray.slice(8, 12)).toLowerCase();
                  if (brand === 'heic' || brand === 'heis' || brand === 'mif1') {
                    console.warn(`[training-pdf] Skipping HEIC photo (mislabeled): ${photo.photo_url}`);
                    continue;
                  }
                }
              }

              const imgBase64 = arrayBufferToBase64(imgBlob);
              
              // Detect image format from magic bytes
              let imgFormat: 'JPEG' | 'PNG' = 'JPEG';
              if (imgArray[0] === 0x89 && imgArray[1] === 0x50 &&
                  imgArray[2] === 0x4E && imgArray[3] === 0x47) {
                imgFormat = 'PNG';
              }

              const maxW = 80; // mm
              const maxH = 60; // mm
              let imgWidth = maxW;
              let imgHeight = maxH;

              let jpegW = 0, jpegH = 0;

              if (imgFormat === 'PNG' && imgArray.length > 24) {
                // PNG IHDR: width at bytes 16-19, height at bytes 20-23 (big-endian)
                jpegW = (imgArray[16] << 24) | (imgArray[17] << 16) | (imgArray[18] << 8) | imgArray[19];
                jpegH = (imgArray[20] << 24) | (imgArray[21] << 16) | (imgArray[22] << 8) | imgArray[23];
              } else {
                // Parse JPEG dimensions from SOF marker (works in Deno without DOM)
                for (let i = 0; i < imgArray.length - 9; i++) {
                  if (imgArray[i] === 0xFF && (imgArray[i + 1] === 0xC0 || imgArray[i + 1] === 0xC2)) {
                    jpegH = (imgArray[i + 5] << 8) | imgArray[i + 6];
                    jpegW = (imgArray[i + 7] << 8) | imgArray[i + 8];
                    break;
                  }
                }
              }

              if (jpegW > 0 && jpegH > 0) {
                const ratio = Math.min(maxW / jpegW, maxH / jpegH);
                imgWidth = jpegW * ratio;
                imgHeight = jpegH * ratio;
                console.log(`Photo sized (${imgFormat}): ${jpegW}x${jpegH}px → ${imgWidth.toFixed(1)}x${imgHeight.toFixed(1)}mm`);
              } else {
                console.warn(`Could not parse ${imgFormat} dimensions, using defaults`);
              }
              
              checkPageBreak(imgHeight + 20);
              
              const mimeType = imgFormat === 'PNG' ? 'image/png' : 'image/jpeg';
              try {
                doc.addImage(`data:${mimeType};base64,${imgBase64}`, imgFormat, margin, yPos, imgWidth, imgHeight);
                yPos += imgHeight + 5;
              } catch (imgErr) {
                console.error('Failed to add photo to PDF:', imgErr);
              }
              
              if (photo.caption) {
                checkPageBreak(10);
                doc.setFontSize(9);
                doc.setFont('helvetica', 'normal');
                doc.setTextColor(100, 116, 139);
                doc.text(photo.caption, margin, yPos);
                yPos += 10;
              } else {
                yPos += 5;
              }
            }
          }
        } catch (e) {
          console.error('Failed to fetch photo for PDF:', e);
        }
      }
      doc.setTextColor(0, 0, 0);
    }

    // Disclaimer Box
    const disclaimerLines = doc.splitTextToSize(content.disclaimer, contentWidth - 10);
    const disclaimerHeight = (disclaimerLines.length * 4.5) + 16;
    checkPageBreak(disclaimerHeight + 10);
    
    doc.setFillColor(254, 243, 199);
    doc.roundedRect(margin - 5, yPos - 5, contentWidth + 10, disclaimerHeight, 3, 3, 'F');
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(146, 64, 14);
    doc.text('DISCLAIMER', margin, yPos);
    yPos += 6;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(0, 0, 0);
    disclaimerLines.forEach((line: string, index: number) => {
      doc.text(line, margin, yPos + (index * 4.5));
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
      .createSignedUrl(filePath, 60 * 60 * 24); // 24 hours

    const reportMetadata = {
      generator: 'generate-training-pdf',
      format: 'pdf',
      sections_included: {
        delivery_approaches: content.deliveryApproaches.length,
        operating_systems: content.operatingSystems.length,
        immediate_attention: content.immediateAttention.length,
        verifiable_items: content.verifiableItems.length,
        systems_in_place: content.systemsInPlace.length,
        has_summary: !!(content.summary.observations || content.summary.recommendations),
        photo_count: trainingData.photos?.length || 0
      }
    };

    // Use upsert to prevent race condition duplicates
    // The unique constraint on training_id ensures only one report per training
    // The database trigger automatically increments version on updates
    const { error: upsertError } = await supabaseAdmin
      .from('training_reports')
      .upsert({
        training_id: trainingId,
        pdf_url: urlData?.signedUrl || '',
        generated_by: user?.id || null,
        file_size_bytes: pdfBytes.byteLength,
        version: 1, // Will be auto-incremented by trigger on updates
        generated_at: new Date().toISOString(),
        metadata: reportMetadata
      }, { 
        onConflict: 'training_id',
        ignoreDuplicates: false 
      });

    if (upsertError) {
      console.error('Failed to upsert training report:', upsertError);
      throw new Error('Failed to save training report');
    }
    
    console.log('Training report upserted successfully');

    return new Response(
      JSON.stringify({
        success: true,
        pdfUrl: urlData?.signedUrl,
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
