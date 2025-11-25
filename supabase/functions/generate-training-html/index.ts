import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const stripHtml = (html: string) => {
  if (!html) return '';
  let text = html.replace(/<[^>]*>/g, '');
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&apos;/g, "'");
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&copy;/g, '©');
  text = text.replace(/&reg;/g, '®');
  text = text.replace(/&trade;/g, '™');
  return text.trim();
};

const formatDate = (dateStr: string) => {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { trainingId } = await req.json();

    if (!trainingId) {
      throw new Error('Training ID is required');
    }

    // Fetch training data
    const { data: training, error: trainingError } = await supabase
      .from('trainings')
      .select('*')
      .eq('id', trainingId)
      .single();

    if (trainingError) throw trainingError;

    // Fetch related data
    const [approachesRes, systemsRes, attentionRes, verifiableRes, systemsInPlaceRes, summaryRes] = await Promise.all([
      supabase.from('training_delivery_approaches').select('*').eq('training_id', trainingId),
      supabase.from('training_operating_systems').select('*').eq('training_id', trainingId),
      supabase.from('training_immediate_attention').select('*').eq('training_id', trainingId),
      supabase.from('training_verifiable_items').select('*').eq('training_id', trainingId),
      supabase.from('training_systems_in_place').select('*').eq('training_id', trainingId),
      supabase.from('training_summary').select('*').eq('training_id', trainingId).single()
    ]);

    const approaches = approachesRes.data || [];
    const systems = systemsRes.data || [];
    const attention = attentionRes.data || [];
    const verifiable = verifiableRes.data || [];
    const systemsInPlace = systemsInPlaceRes.data || [];
    const summary = summaryRes.data || null;

    // Generate HTML
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Training Report - ${stripHtml(training.organization)}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      line-height: 1.6;
      color: #333;
      background: #f5f5f5;
      padding: 20px;
    }
    .container {
      max-width: 1000px;
      margin: 0 auto;
      background: white;
      padding: 40px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    }
    .header {
      text-align: center;
      border-bottom: 3px solid #1e40af;
      padding-bottom: 20px;
      margin-bottom: 30px;
    }
    .logo {
      max-width: 200px;
      margin-bottom: 15px;
    }
    h1 {
      color: #1e40af;
      font-size: 32px;
      margin-bottom: 10px;
    }
    .subtitle {
      color: #64748b;
      font-size: 14px;
    }
    .section {
      margin-bottom: 30px;
    }
    .section-title {
      background: #1e40af;
      color: white;
      padding: 12px 20px;
      font-size: 18px;
      font-weight: 600;
      margin-bottom: 15px;
      border-radius: 4px;
    }
    .info-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 15px;
      margin-bottom: 15px;
    }
    .info-item {
      padding: 10px;
      background: #f8fafc;
      border-left: 3px solid #1e40af;
    }
    .info-label {
      font-weight: 600;
      color: #475569;
      font-size: 13px;
      margin-bottom: 4px;
    }
    .info-value {
      color: #1e293b;
    }
    ul {
      list-style: none;
      padding-left: 0;
    }
    li {
      padding: 8px 12px;
      margin-bottom: 6px;
      background: #f8fafc;
      border-left: 3px solid #3b82f6;
      border-radius: 2px;
    }
    .text-content {
      padding: 15px;
      background: #f8fafc;
      border-radius: 4px;
      white-space: pre-wrap;
      line-height: 1.8;
    }
    .footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 2px solid #e2e8f0;
      text-align: center;
      color: #64748b;
      font-size: 12px;
    }
    @media print {
      body {
        background: white;
        padding: 0;
      }
      .container {
        box-shadow: none;
        padding: 20px;
      }
    }
    @media (max-width: 768px) {
      .info-grid {
        grid-template-columns: 1fr;
      }
      .container {
        padding: 20px;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <img src="https://ssgzcgvygnsrqalisshx.supabase.co/storage/v1/object/public/pdf-templates/rope-works-logo.png" alt="Rope Works Logo" class="logo">
      <h1>Training Report</h1>
      <div class="subtitle">Professional Training Documentation</div>
    </div>

    <div class="section">
      <div class="section-title">Facility Information</div>
      <div class="info-grid">
        <div class="info-item">
          <div class="info-label">Organization</div>
          <div class="info-value">${stripHtml(training.organization)}</div>
        </div>
        <div class="info-item">
          <div class="info-label">Training Dates</div>
          <div class="info-value">${formatDate(training.start_date)} - ${formatDate(training.end_date)}</div>
        </div>
        <div class="info-item">
          <div class="info-label">Trainer of Record</div>
          <div class="info-value">${stripHtml(training.trainer_of_record || 'N/A')}</div>
        </div>
        <div class="info-item">
          <div class="info-label">Trainee Names</div>
          <div class="info-value">${stripHtml(training.trainee_names || 'N/A')}</div>
        </div>
      </div>
    </div>

    ${approaches.length > 0 ? `
    <div class="section">
      <div class="section-title">Delivery Approach</div>
      <ul>
        ${approaches.map(a => `<li>${stripHtml(a.approach)}</li>`).join('')}
      </ul>
    </div>
    ` : ''}

    ${systems.length > 0 ? `
    <div class="section">
      <div class="section-title">Trained Operating Systems</div>
      <ul>
        ${systems.map(sys => `
          <li>
            <strong>${stripHtml(sys.system_name)}</strong>
            ${sys.other_description ? `<br><span style="color: #64748b;">${stripHtml(sys.other_description)}</span>` : ''}
          </li>
        `).join('')}
      </ul>
    </div>
    ` : ''}

    ${attention.length > 0 ? `
    <div class="section">
      <div class="section-title">Actions Requiring Immediate Attention</div>
      <ul>
        ${attention.map(item => `<li>${stripHtml(item.item)}</li>`).join('')}
      </ul>
    </div>
    ` : ''}

    ${verifiable.length > 0 ? `
    <div class="section">
      <div class="section-title">Items Verified During Training</div>
      <ul>
        ${verifiable.map(item => `<li>${stripHtml(item.item)}</li>`).join('')}
      </ul>
    </div>
    ` : ''}

    ${systemsInPlace.length > 0 ? `
    <div class="section">
      <div class="section-title">Systems in Place</div>
      <ul>
        ${systemsInPlace.map(item => `<li>${stripHtml(item.system_item)}</li>`).join('')}
      </ul>
    </div>
    ` : ''}

    ${summary ? `
    <div class="section">
      <div class="section-title">Summary</div>
      ${summary.observations ? `
        <div style="margin-bottom: 20px;">
          <div class="info-label" style="margin-bottom: 8px;">Observations</div>
          <div class="text-content">${stripHtml(summary.observations)}</div>
        </div>
      ` : ''}
      ${summary.recommendations ? `
        <div style="margin-bottom: 20px;">
          <div class="info-label" style="margin-bottom: 8px;">Recommendations</div>
          <div class="text-content">${stripHtml(summary.recommendations)}</div>
        </div>
      ` : ''}
      <div class="info-grid">
        ${summary.person_submitting ? `
        <div class="info-item">
          <div class="info-label">Person Submitting</div>
          <div class="info-value">${stripHtml(summary.person_submitting)}</div>
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

    <div class="footer">
      <p>Generated on ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
      <p style="margin-top: 5px;">Rope Works Training Report</p>
    </div>
  </div>
</body>
</html>`;

    return new Response(
      JSON.stringify({ html }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    console.error('Error generating HTML report:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});
