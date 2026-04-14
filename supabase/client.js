// ============================================================
// SUPABASE CLIENT - Substitui firebase/services-config.js
// ============================================================
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase-config.js';

const { createClient } = supabase; // via CDN global

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    storage: localStorage
  }
});

// Helper: pega sessão atual
export async function getSession() {
  const { data: { session } } = await sb.auth.getSession();
  return session;
}

// Helper: pega user logado
export async function getCurrentUser() {
  const session = await getSession();
  return session?.user ?? null;
}

// Helper: retorna perfil do usuário da tabela users
export async function getUserProfile(userId) {
  const { data, error } = await sb
    .from('users')
    .select('*')
    .eq('id', userId)
    .single();
  if (error) throw error;
  return data;
}

export default sb;
