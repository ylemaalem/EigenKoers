// Publieke Supabase-instellingen. De publishable key is bedoeld voor de browser:
// alle gegevens zijn beveiligd met Row Level Security in de database.
// (Overschrijfbaar met VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY.)
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://YOUR-PROJECT-REF.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'YOUR-PUBLISHABLE-KEY';

export const IS_CONFIGURED = !SUPABASE_URL.includes('YOUR-PROJECT-REF') && !SUPABASE_PUBLISHABLE_KEY.startsWith('YOUR-');
