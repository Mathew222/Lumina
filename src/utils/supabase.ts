import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const supabase = supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey)
    : null;

/**
 * Saves a translated summary to the Supabase summaries table.
 */
export async function saveSummaryToSupabase(
    sessionId: string,
    originalTranscript: string,
    summaryText: string,
    language: string
) {
    if (!supabase) {
        console.warn('Supabase is not configured. Skipping saving summary to Supabase.');
        return null;
    }

    try {
        const { data, error } = await supabase
            .from('summaries')
            .insert([
                {
                    session_id: sessionId,
                    transcript: originalTranscript,
                    summary: summaryText,
                    language: language,
                    created_at: new Date().toISOString()
                }
            ])
            .select();

        if (error) {
            console.error('Supabase error saving summary:', error);
            throw error;
        }

        return data;
    } catch (err) {
        console.error('Failed to save summary to Supabase:', err);
        return null;
    }
}
