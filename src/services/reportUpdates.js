// The signed-in person's own report statuses for Activity (migration 20270397). Before that migration is live the
// function doesn't exist: no rows, never an error on the screen. Rows via utils/reportUpdates.js.
import { supabase } from './supabase';
import { isMissingFunction } from './myProfile';
import { reportUpdateItems } from '../utils/reportUpdates';

export async function getMyReportUpdates() {
  const { data, error } = await supabase.rpc('get_my_report_updates');
  if (isMissingFunction(error)) return [];
  if (error) throw error;
  return reportUpdateItems(data);
}
