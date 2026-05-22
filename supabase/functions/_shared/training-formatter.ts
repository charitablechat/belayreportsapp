import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";
import { dedupeTrainingPhotos } from "./dedupe-training-photos.ts";
export { dedupeTrainingPhotos } from "./dedupe-training-photos.ts";

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
  photos: any[];
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
    { data: profile },
    { data: photos }
  ] = await Promise.all([
    supabase.from('training_delivery_approaches').select('*').eq('training_id', trainingId).order('created_at'),
    supabase.from('training_operating_systems').select('*').eq('training_id', trainingId).order('created_at'),
    supabase.from('training_immediate_attention').select('*').eq('training_id', trainingId).order('created_at'),
    supabase.from('training_verifiable_items').select('*').eq('training_id', trainingId).order('created_at'),
    supabase.from('training_systems_in_place').select('*').eq('training_id', trainingId).order('created_at'),
    supabase.from('training_summary').select('*').eq('training_id', trainingId).maybeSingle(),
    supabase.from('profiles').select('first_name, last_name, acct_number').eq('id', training.inspector_id).maybeSingle(),
    supabase.from('training_photos').select('*').eq('training_id', trainingId).is('deleted_at', null).order('display_order')
  ]);

  return {
    training,
    approaches: approaches || [],
    systems: systems || [],
    attention: attention || [],
    verifiable: verifiable || [],
    systemsInPlace: systemsInPlace || [],
    summary: summary || null,
    profile: profile || null,
    photos: dedupeTrainingPhotos(photos || [])
  };
}

// dedupeTrainingPhotos: see ./dedupe-training-photos.ts (re-exported above).


// Helper function to parse trainee names into an array
export function parseTraineeNames(traineeNamesStr: string | null): string[] {
  if (!traineeNamesStr) return [];
  
  const text = stripHtml(traineeNamesStr);
  if (!text || text === 'N/A') return [];
  
  // Split by common delimiters: newlines, commas, or multiple spaces between names
  // First try newlines
  let names = text.split(/\n/).map(n => n.trim()).filter(Boolean);
  
  // If only one result, try commas
  if (names.length <= 1) {
    names = text.split(/,/).map(n => n.trim()).filter(Boolean);
  }
  
  // If still only one result and it contains multiple capitalized words, 
  // try to split by detecting name patterns (e.g., "John Smith Jane Doe")
  if (names.length === 1 && names[0].length > 20) {
    // Try to split on patterns like "FirstName LastName" followed by another "FirstName"
    // Look for lowercase letter followed by space and uppercase letter as a name boundary
    const namePattern = /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/g;
    const matches = names[0].match(namePattern);
    if (matches && matches.length > 1) {
      names = matches.map(n => n.trim()).filter(Boolean);
    }
  }
  
  return names;
}

// Helper function to parse text content into a bullet list array
// Handles various formats: HTML lists, line breaks, sentences ending with periods
// ALWAYS splits sentences into individual bullets for consistent report formatting
export function parseTextToList(textContent: string | null | undefined): string[] {
  if (!textContent) return [];
  
  // Convert block-level HTML boundaries to newlines BEFORE stripping tags
  // This preserves the line structure from the rich text editor (TipTap stores each line as <p>)
  let preprocessed = textContent
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n');
  
  let text = stripHtml(preprocessed);
  if (!text || text === 'N/A') return [];
  
  // Normalize spacing after sentence-ending punctuation
  text = text.replace(/([.!?])([A-Z])/g, '$1 $2');
  
  // First, try splitting by newlines (most common for bullet-style content)
  let items = text.split(/\n/).map(item => item.trim()).filter(Boolean);
  
  // If we only got one item, ALWAYS try splitting by sentences (removed 100-char threshold)
  // This ensures every sentence becomes its own bullet point
  if (items.length === 1) {
    // Split on period/exclamation/question followed by space and capital letter
    const sentencePattern = /(?<=[.!?])\s+(?=[A-Z])/;
    const sentences = items[0].split(sentencePattern).map(s => s.trim()).filter(Boolean);
    if (sentences.length > 1) {
      items = sentences;
    }
  }
  
  // Clean up each item - remove leading bullets/dashes/numbers if present
  items = items.map(item => {
    return item
      .replace(/^[\-•●○◦▪▸►]\s*/, '') // Remove bullet characters
      .replace(/^\d+[.)]\s*/, '') // Remove numbered list markers
      .trim();
  }).filter(Boolean);
  
  return items;
}

// Content formatters - returns structured data ready for rendering
export interface FormattedContent {
  facilityInfo: {
    organization: string;
    startDate: string;
    endDate: string;
    trainerOfRecord: string;
    traineeNames: string;
    traineeNamesList: string[];
  };
  standardsText: string;
  deliveryApproaches: string[];
  operatingSystems: Array<{ name: string; description?: string }>;
  immediateAttention: string[];
  verifiableItems: string[];
  systemsInPlace: string[];
  summary: {
    observations?: string;
    observationsList: string[];
    recommendations?: string;
    recommendationsList: string[];
    personSubmitting?: string;
    submissionDate?: string;
  };
  disclaimer: string;
}

export function formatTrainingContent(data: TrainingData): FormattedContent {
  const traineeNamesList = parseTraineeNames(data.training.trainee_names);
  
  return {
    facilityInfo: {
      organization: stripHtml(data.training.organization) || 'N/A',
      startDate: formatDate(data.training.start_date),
      endDate: formatDate(data.training.end_date),
      trainerOfRecord: stripHtml(data.training.trainer_of_record) || 'N/A',
      traineeNames: stripHtml(data.training.trainee_names) || 'N/A',
      traineeNamesList: traineeNamesList
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
      observationsList: parseTextToList(data.summary?.observations),
      recommendations: data.summary?.recommendations ? stripHtml(data.summary.recommendations) : undefined,
      recommendationsList: parseTextToList(data.summary?.recommendations),
      personSubmitting: data.summary?.person_submitting ? stripHtml(data.summary.person_submitting) : undefined,
      submissionDate: data.summary?.submission_date ? formatDate(data.summary.submission_date) : undefined
    },
    disclaimer: 'This training report documents the systems and procedures covered during the training session. It is the responsibility of the facility to implement and maintain proper operational procedures, conduct regular inspections, and ensure all staff are appropriately trained and certified.'
  };
}
