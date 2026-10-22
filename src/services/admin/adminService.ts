import type {
  AccountStatus, AuditLog, DashboardSummary, Journey, JourneyDetail, JourneyWithEmployee, Profile,
  SosAlertWithEmployee, SosDetail, SosStatus,
} from '../../types/db';
import { AppError, toAppError } from '../../utils/errors';
import { supabase } from '../supabase/client';
import { rpc, unwrap } from '../supabase/rpc';

export const ADMIN_PAGE_SIZE = 25;
const EMPLOYEE_EMBED = 'employee:profiles!journeys_employee_id_fkey(id, full_name, employee_ref)';
const SOS_EMPLOYEE_EMBED = 'employee:profiles!sos_alerts_employee_id_fkey(id, full_name, employee_ref)';

export const SOS_NEXT: Record<SosStatus, SosStatus[]> = {
  new: ['acknowledged'],
  acknowledged: ['responding', 'resolved'],
  responding: ['resolved'],
  resolved: ['closed'],
  closed: [],
};

export const getDashboardSummary = () => rpc<DashboardSummary>('admin_dashboard_summary');

export async function listMyOrganisations(): Promise<{ id: string; name: string }[]> {
  const r = await supabase.from('organisations').select('id, name').order('name');
  return unwrap(r) as { id: string; name: string }[];
}

/** Active, unexpired journeys only. Ended journeys are never returned as live. */
export async function listActiveJourneys(): Promise<JourneyWithEmployee[]> {
  const r = await supabase
    .from('journeys')
    .select(`*, ${EMPLOYEE_EMBED}`)
    .eq('status', 'active')
    .gt('expires_at', new Date().toISOString())
    .order('expires_at', { ascending: true })
    .limit(200);
  return unwrap(r) as JourneyWithEmployee[];
}

export const getJourneyDetail = (journeyId: string) =>
  rpc<JourneyDetail>('admin_get_journey_detail', { p_journey_id: journeyId });

export async function listSosAlerts(statuses: SosStatus[], page: number): Promise<SosAlertWithEmployee[]> {
  const from = page * ADMIN_PAGE_SIZE;
  const r = await supabase
    .from('sos_alerts')
    .select(`*, ${SOS_EMPLOYEE_EMBED}`)
    .in('alert_status', statuses)
    .order('created_at', { ascending: false })
    .range(from, from + ADMIN_PAGE_SIZE - 1);
  return unwrap(r) as SosAlertWithEmployee[];
}

export const getSosDetail = (alertId: string) => rpc<SosDetail>('admin_get_sos_detail', { p_alert_id: alertId });

export function updateSosStatus(alertId: string, status: SosStatus, note: string | null) {
  return rpc('update_sos_status', { p_alert_id: alertId, p_status: status, p_note: note });
}

export async function listEmployees(page: number, search: string): Promise<Profile[]> {
  const from = page * ADMIN_PAGE_SIZE;
  let q = supabase.from('profiles').select('*').eq('role', 'employee').order('full_name').range(from, from + ADMIN_PAGE_SIZE - 1);
  const term = search.trim().replace(/[%_,()]/g, '');
  if (term) q = q.or(`full_name.ilike.%${term}%,employee_ref.ilike.%${term}%`);
  return unwrap(await q) as Profile[];
}

export async function getEmployee(userId: string): Promise<Profile | null> {
  return unwrap(await supabase.from('profiles').select('*').eq('id', userId).maybeSingle()) as Profile | null;
}

/** Journey metadata for an employee. Ended journeys have no coordinates (cleared server-side). */
export async function listEmployeeJourneys(userId: string, page: number): Promise<Journey[]> {
  const from = page * ADMIN_PAGE_SIZE;
  const r = await supabase
    .from('journeys')
    .select('*')
    .eq('employee_id', userId)
    .order('created_at', { ascending: false })
    .range(from, from + ADMIN_PAGE_SIZE - 1);
  return unwrap(r) as Journey[];
}

export function setAccountStatus(userId: string, status: Exclude<AccountStatus, 'invited'>, reason: string) {
  return rpc<Profile>('admin_set_account_status', { p_user_id: userId, p_status: status, p_reason: reason });
}

export async function listAuditLogs(page: number, action?: string): Promise<AuditLog[]> {
  const from = page * ADMIN_PAGE_SIZE;
  let q = supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).range(from, from + ADMIN_PAGE_SIZE - 1);
  if (action) q = q.like('action', `${action}%`);
  return unwrap(await q) as AuditLog[];
}

export async function listFailedNotifications(page: number) {
  const from = page * ADMIN_PAGE_SIZE;
  const r = await supabase
    .from('notification_records')
    .select('id, event_type, delivery_status, attempts, last_error, created_at, recipient_id')
    .in('delivery_status', ['failed', 'skipped'])
    .order('created_at', { ascending: false })
    .range(from, from + ADMIN_PAGE_SIZE - 1);
  return unwrap(r) as {
    id: string; event_type: string; delivery_status: string; attempts: number; last_error: string | null;
    created_at: string; recipient_id: string;
  }[];
}

export async function inviteEmployee(input: { email: string; fullName: string; employeeRef?: string; organisationId: string }) {
  const { data, error } = await supabase.functions.invoke('invite-user', {
    body: {
      email: input.email,
      full_name: input.fullName,
      employee_ref: input.employeeRef || undefined,
      organisation_id: input.organisationId,
    },
  });
  if (error) {
    let code = 'UNKNOWN';
    try {
      const body = await (error as { context?: Response }).context?.json();
      code = body?.error?.code ?? code;
    } catch {
      // ignore
    }
    if (code === 'FORBIDDEN') throw new AppError('FORBIDDEN', 'You are not allowed to invite staff to this organisation.');
    if (code === 'RATE_LIMITED') throw new AppError('RATE_LIMITED', 'Daily invitation limit reached.');
    if (code === 'VALIDATION') throw new AppError('VALIDATION', 'Check the email address and name.');
    if (code === 'INVITE_FAILED') throw new AppError('VALIDATION', 'The invitation could not be created. The address may already have an account.');
    throw toAppError(error);
  }
  return data as { user_id: string; email_sent: boolean };
}
