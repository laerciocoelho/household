export type PeriodShift = 'morning' | 'afternoon' | 'night' | 'anytime';
export type RecurrenceRule = 'none' | 'daily' | 'weekly' | 'biweekly' | 'monthly';
export type TaskStatus = 'pending' | 'completed' | 'pending_approval';
export type TaskPriority = 'low' | 'normal' | 'high';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';
export type ActivityAction =
  | 'created'
  | 'updated'
  | 'completed'
  | 'uncompleted'
  | 'deletion_requested'
  | 'edit_requested'
  | 'deleted'
  | 'rejected'
  | 'cancelled';

export type PreferredView = 'today' | 'week' | 'month';

export interface Household {
  id: string;
  name: string;
  invite_code: string;
  require_mutual_approval_for_delete: boolean;
  created_at: string;
}

export interface HouseholdMember {
  id: string;
  household_id: string;
  user_id: string;
  display_name: string;
  color_hex: string;
  icon_name: string;
  preferred_view: PreferredView;
  is_owner: boolean;
  created_at: string;
}

export interface Task {
  id: string;
  household_id: string;
  title: string;
  description: string | null;
  assigned_to: string | null; // null = Ambos
  period_shift: PeriodShift;
  due_date: string; // 'yyyy-MM-dd'
  due_time: string | null; // 'HH:mm:ss' (opcional)
  recurrence_rule: RecurrenceRule;
  priority: TaskPriority;
  is_personal: boolean; // somente o criador cria/vê/edita
  requires_approval: boolean; // ajuste/exclusão exigem aprovação do parceiro
  pending_action: 'edit' | 'delete' | null;
  pending_by: string | null;
  status: TaskStatus;
  completed_at: string | null;
  version: number;
  locked_by: string | null;
  locked_until: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type TaskInput = Pick<
  Task,
  'title' | 'description' | 'assigned_to' | 'period_shift' | 'due_date' | 'due_time'
  | 'recurrence_rule' | 'priority' | 'requires_approval' | 'is_personal'
>;

export interface ApprovalRequest {
  id: string;
  household_id: string;
  entity_type: 'task_delete' | 'task_edit';
  entity_id: string;
  action_type: 'delete' | 'update';
  proposed_payload: {
    title?: string;
    previous_status?: TaskStatus;
    patch?: Partial<TaskInput>;
    changes?: FieldChange[];
  } | null;
  request_note: string | null;
  decision_note: string | null;
  requested_by: string;
  status: ApprovalStatus;
  created_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
}

export interface FieldChange {
  field: string;
  from: unknown;
  to: unknown;
}

export interface ActivityDetails {
  changes?: FieldChange[];
  request_note?: string | null;
  decision_note?: string | null;
  task_date?: string | null; // data de atribuição da tarefa (due_date)
  task_time?: string | null;
}

export interface ActivityLog {
  id: string;
  household_id: string;
  member_id: string | null;
  entity_type: string;
  entity_id: string;
  action: ActivityAction;
  summary: string;
  details: ActivityDetails | null;
  created_at: string;
}

/** Mensagens trafegadas no canal Realtime do lar */
export interface LockPayload {
  taskId: string;
  memberId: string;
  lockedAt: number; // epoch ms
}

export interface PresenceState {
  memberId: string;
  editingTaskId: string | null;
  onlineAt: number;
}
