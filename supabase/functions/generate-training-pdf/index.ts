import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

    // Build HTML content
    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 40px; }
    .header { text-align: center; margin-bottom: 30px; border-bottom: 3px solid #1e40af; padding-bottom: 20px; }
    .logo { max-width: 200px; margin-bottom: 10px; }
    h1 { color: #1e40af; font-size: 28px; margin: 10px 0; }
    h2 { color: #1e40af; font-size: 20px; margin-top: 25px; border-bottom: 2px solid #cbd5e1; padding-bottom: 5px; }
    h3 { color: #334155; font-size: 16px; margin-top: 15px; }
    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin: 20px 0; }
    .info-item { padding: 10px; background: #f8fafc; border-left: 3px solid #1e40af; }
    .info-label { font-weight: bold; color: #475569; font-size: 12px; text-transform: uppercase; }
    .info-value { color: #1e293b; font-size: 14px; margin-top: 5px; }
    .section { margin: 25px 0; padding: 15px; border: 1px solid #e2e8f0; border-radius: 8px; }
    .checkbox-list { margin: 10px 0; }
    .checkbox-item { padding: 8px 0; border-bottom: 1px solid #f1f5f9; }
    .checkbox-item:last-child { border-bottom: none; }
    .disclaimer { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 30px 0; font-size: 13px; }
    .footer { margin-top: 40px; padding-top: 20px; border-top: 2px solid #e2e8f0; text-align: center; color: #64748b; font-size: 12px; }
    .standards-text { background: #e0f2fe; padding: 15px; border-radius: 6px; margin: 15px 0; font-size: 14px; line-height: 1.7; }
    ul { margin: 10px 0; padding-left: 25px; }
    li { margin: 5px 0; }
  </style>
</head>
<body>
  <div class="header">
    <h1>ROPE WORKS INC.</h1>
    <h2>Training Report</h2>
  </div>

  <div class="standards-text">
    Rope Works Inc. completed a site visit for training and operations on the above date(s). 
    LISTED BELOW are the operating systems on your site we trained or reviewed in accordance with 
    Rope Works Inc. operational procedures and the Association for Challenge Course Technology (ACCT) 
    operational and training standards. Standards applied include ANSI/ACCT 03-2016 and ANSI/ACCT 03-2019.
  </div>

  <div class="section">
    <h2>Training Information</h2>
    <div class="info-grid">
      <div class="info-item">
        <div class="info-label">Training Site</div>
        <div class="info-value">${training.organization || 'N/A'}</div>
      </div>
      <div class="info-item">
        <div class="info-label">Start Date</div>
        <div class="info-value">${formatDate(training.start_date)}</div>
      </div>
      <div class="info-item">
        <div class="info-label">End Date</div>
        <div class="info-value">${formatDate(training.end_date)}</div>
      </div>
      <div class="info-item">
        <div class="info-label">Trainer(s) of Record</div>
        <div class="info-value">${training.trainer_of_record || 'N/A'}</div>
      </div>
    </div>
    ${training.trainee_names ? `
      <div class="info-item" style="margin-top: 15px;">
        <div class="info-label">Trainee Names</div>
        <div class="info-value">${training.trainee_names.replace(/\n/g, '<br>')}</div>
      </div>
    ` : ''}
  </div>

  ${deliveryApproaches && deliveryApproaches.length > 0 ? `
  <div class="section">
    <h2>Delivery Approach</h2>
    <div class="checkbox-list">
      ${deliveryApproaches.map(a => `
        <div class="checkbox-item">☑ ${a.approach}</div>
      `).join('')}
    </div>
  </div>
  ` : ''}

  ${operatingSystems && operatingSystems.length > 0 ? `
  <div class="section">
    <h2>Operating Systems</h2>
    <div class="checkbox-list">
      ${operatingSystems.map(s => `
        <div class="checkbox-item">
          ☑ ${s.system_name}
          ${s.other_description ? ` - ${s.other_description}` : ''}
        </div>
      `).join('')}
    </div>
  </div>
  ` : ''}

  ${immediateAttention && immediateAttention.length > 0 ? `
  <div class="section">
    <h2>Immediate Attention</h2>
    <div class="checkbox-list">
      ${immediateAttention.map(i => `
        <div class="checkbox-item">☑ ${i.item}</div>
      `).join('')}
    </div>
  </div>
  ` : ''}

  ${verifiableItems && verifiableItems.length > 0 ? `
  <div class="section">
    <h2>Verifiable Items During Training</h2>
    <div class="checkbox-list">
      ${verifiableItems.map(v => `
        <div class="checkbox-item">☑ ${v.item}</div>
      `).join('')}
    </div>
  </div>
  ` : ''}

  ${systemsInPlace && systemsInPlace.length > 0 ? `
  <div class="section">
    <h2>Systems in Place</h2>
    <div class="checkbox-list">
      ${systemsInPlace.map(s => `
        <div class="checkbox-item">☑ ${s.system_item}</div>
      `).join('')}
    </div>
  </div>
  ` : ''}

  ${summary ? `
  <div class="section">
    <h2>Training Summary</h2>
    ${summary.observations ? `
      <h3>Training Observations</h3>
      <div>${summary.observations}</div>
    ` : ''}
    ${summary.recommendations ? `
      <h3>Training Recommendations</h3>
      <div>${summary.recommendations}</div>
    ` : ''}
    <div class="info-grid" style="margin-top: 20px;">
      ${summary.person_submitting ? `
        <div class="info-item">
          <div class="info-label">Person Submitting Form</div>
          <div class="info-value">${summary.person_submitting}</div>
        </div>
      ` : ''}
      ${summary.submission_date ? `
        <div class="info-item">
          <div class="info-label">Submission Date</div>
          <div class="info-value">${formatDate(summary.submission_date)}</div>
        </div>
      ` : ''}
    </div>
  </div>
  ` : ''}

  <div class="disclaimer">
    <strong>DISCLAIMER:</strong> This training report documents the systems and procedures covered during the training session. 
    It is the responsibility of the facility to implement and maintain proper operational procedures, conduct regular inspections, 
    and ensure all staff are appropriately trained and certified. This report does not constitute a guarantee of safety or compliance.
  </div>

  <div class="footer">
    <p><strong>Rope Works Inc.</strong></p>
    <p>ACCT Accredited Vendor</p>
    <p>Generated: ${new Date().toLocaleString()}</p>
    ${profile?.acct_number ? `<p>ACCT #: ${profile.acct_number}</p>` : ''}
  </div>
</body>
</html>
`;

    // Use a PDF generation service (placeholder - you would use an actual service)
    // For now, we'll save HTML and provide a link
    const fileName = `training-report-${trainingId}-${Date.now()}.html`;
    const filePath = `training-reports/${fileName}`;

    // Upload to Supabase Storage
    const { error: uploadError } = await supabaseAdmin.storage
      .from('inspection-reports')
      .upload(filePath, new Blob([htmlContent], { type: 'text/html' }), {
        contentType: 'text/html',
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
      file_size_bytes: new Blob([htmlContent]).size,
      metadata: {
        generator: 'generate-training-pdf',
        format: 'html',
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
