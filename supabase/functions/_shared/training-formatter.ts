import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

// Types
export interface TrainingData {
  training: any;
  approaches: any[];
  systems: any[];
  attention: any[];
  verifiable: any[];
  systemsInPlace: any[];
  summary: any;
  profile: any;
}

// Utility functions
export const stripHtml = (html: string | null): string => {
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

export const formatDate = (dateStr: string | null): string => {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });
};

// Data fetching
export async function fetchTrainingData(
  trainingId: string,
  supabase: any
): Promise<TrainingData> {
  // Fetch training data
  const { data: training, error: trainingError } = await supabase
    .from('trainings')
    .select('*')
    .eq('id', trainingId)
    .single();

  if (trainingError) throw trainingError;

  // Fetch all related data
  const [
    { data: approaches },
    { data: systems },
    { data: attention },
    { data: verifiable },
    { data: systemsInPlace },
    { data: summary },
    { data: profile }
  ] = await Promise.all([
    supabase.from('training_delivery_approaches').select('*').eq('training_id', trainingId),
    supabase.from('training_operating_systems').select('*').eq('training_id', trainingId),
    supabase.from('training_immediate_attention').select('*').eq('training_id', trainingId),
    supabase.from('training_verifiable_items').select('*').eq('training_id', trainingId),
    supabase.from('training_systems_in_place').select('*').eq('training_id', trainingId),
    supabase.from('training_summary').select('*').eq('training_id', trainingId).maybeSingle(),
    supabase.from('profiles').select('first_name, last_name, acct_number').eq('id', training.inspector_id).maybeSingle()
  ]);

  return {
    training,
    approaches: approaches || [],
    systems: systems || [],
    attention: attention || [],
    verifiable: verifiable || [],
    systemsInPlace: systemsInPlace || [],
    summary: summary || null,
    profile: profile || null
  };
}

// Content formatters - returns structured data ready for rendering
export interface FormattedContent {
  facilityInfo: {
    organization: string;
    startDate: string;
    endDate: string;
    trainerOfRecord: string;
    traineeNames: string;
  };
  standardsText: string;
  deliveryApproaches: string[];
  operatingSystems: Array<{ name: string; description?: string }>;
  immediateAttention: string[];
  verifiableItems: string[];
  systemsInPlace: string[];
  summary: {
    observations?: string;
    recommendations?: string;
    personSubmitting?: string;
    submissionDate?: string;
  };
  disclaimer: string;
}

export function formatTrainingContent(data: TrainingData): FormattedContent {
  return {
    facilityInfo: {
      organization: stripHtml(data.training.organization) || 'N/A',
      startDate: formatDate(data.training.start_date),
      endDate: formatDate(data.training.end_date),
      trainerOfRecord: stripHtml(data.training.trainer_of_record) || 'N/A',
      traineeNames: stripHtml(data.training.trainee_names) || 'N/A'
    },
    standardsText: 'Rope Works Inc. completed a site visit for training and operations on the above date(s). LISTED BELOW are the operating systems on your site we trained or reviewed in accordance with Rope Works Inc. operational procedures and the Association for Challenge Course Technology (ACCT) operational and training standards. Standards applied include ANSI/ACCT 03-2016 and ANSI/ACCT 03-2019.',
    deliveryApproaches: data.approaches.map(a => stripHtml(a.approach)),
    operatingSystems: data.systems.map(s => ({
      name: stripHtml(s.system_name),
      description: s.other_description ? stripHtml(s.other_description) : undefined
    })),
    immediateAttention: data.attention.map(i => stripHtml(i.item)),
    verifiableItems: data.verifiable.map(v => stripHtml(v.item)),
    systemsInPlace: data.systemsInPlace.map(s => stripHtml(s.system_item)),
    summary: {
      observations: data.summary?.observations ? stripHtml(data.summary.observations) : undefined,
      recommendations: data.summary?.recommendations ? stripHtml(data.summary.recommendations) : undefined,
      personSubmitting: data.summary?.person_submitting ? stripHtml(data.summary.person_submitting) : undefined,
      submissionDate: data.summary?.submission_date ? formatDate(data.summary.submission_date) : undefined
    },
    disclaimer: 'This training report documents the systems and procedures covered during the training session. It is the responsibility of the facility to implement and maintain proper operational procedures, conduct regular inspections, and ensure all staff are appropriately trained and certified.'
  };
}
