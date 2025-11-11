// Helper types for Supabase query results
// This file provides type-safe helpers to work around Supabase type inference issues

import type { Database } from '@/types/database';

// Extract table row types
export type Project = Database['public']['Tables']['projects']['Row'];
export type ProjectMember = Database['public']['Tables']['project_members']['Row'];
export type Recording = Database['public']['Tables']['recordings']['Row'];
export type Analysis = Database['public']['Tables']['analyses']['Row'];

// Insert types
export type ProjectInsert = Database['public']['Tables']['projects']['Insert'];
export type ProjectMemberInsert = Database['public']['Tables']['project_members']['Insert'];
export type RecordingInsert = Database['public']['Tables']['recordings']['Insert'];
export type AnalysisInsert = Database['public']['Tables']['analyses']['Insert'];

// Helper function to safely extract properties from Supabase responses
export function hasProperty<T extends object, K extends PropertyKey>(
  obj: T,
  key: K
): obj is T & Record<K, unknown> {
  return key in obj;
}
