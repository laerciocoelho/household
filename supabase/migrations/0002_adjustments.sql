-- =====================================================================
-- 0002 - Ajustes: horário, aprovação por tarefa, ajuste com aprovação,
--        cancelamento, justificativas e logs detalhados
-- Execute no SQL Editor DEPOIS da 0001_init.sql.
-- =====================================================================

-- ---------- Colunas novas ----------
ALTER TABLE tasks
    ADD COLUMN IF NOT EXISTS due_time TIME,
    ADD COLUMN IF NOT EXISTS requires_approval BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS pending_action VARCHAR(10) CHECK (pending_action IN ('edit','delete')),
    ADD COLUMN IF NOT EXISTS pending_by UUID REFERENCES household_members(id) ON DELETE SET NULL;

-- Tarefas já existentes mantêm o comportamento anterior (configuração do lar)
UPDATE tasks t SET requires_approval = h.require_mutual_approval_for_delete
  FROM households h WHERE h.id = t.household_id;

-- Solicitações de exclusão que já estavam pendentes
UPDATE tasks t SET pending_action = 'delete', pending_by = a.requested_by
  FROM approval_requests a
 WHERE a.entity_id = t.id AND a.status = 'pending' AND t.status = 'pending_approval';

ALTER TABLE approval_requests
    ADD COLUMN IF NOT EXISTS request_note TEXT,
    ADD COLUMN IF NOT EXISTS decision_note TEXT;

ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS details JSONB;

-- ---------- Funções antigas substituídas ----------
DROP FUNCTION IF EXISTS update_task(UUID, INT, JSONB);
DROP FUNCTION IF EXISTS request_task_delete(UUID);
DROP FUNCTION IF EXISTS decide_approval(UUID, BOOLEAN);

-- ---------- Diferença entre duas versões da tarefa ----------
CREATE OR REPLACE FUNCTION task_diff(o tasks, n tasks) RETURNS JSONB
LANGUAGE sql STABLE AS $$
    SELECT COALESCE(jsonb_agg(jsonb_build_object('field', d.f, 'from', d.fr, 'to', d.t)), '[]'::jsonb)
      FROM (VALUES
        ('title',             to_jsonb(o.title),             to_jsonb(n.title)),
        ('description',       to_jsonb(o.description),       to_jsonb(n.description)),
        ('assigned_to',       to_jsonb(o.assigned_to),       to_jsonb(n.assigned_to)),
        ('period_shift',      to_jsonb(o.period_shift),      to_jsonb(n.period_shift)),
        ('due_date',          to_jsonb(o.due_date),          to_jsonb(n.due_date)),
        ('due_time',          to_jsonb(o.due_time),          to_jsonb(n.due_time)),
        ('recurrence_rule',   to_jsonb(o.recurrence_rule),   to_jsonb(n.recurrence_rule)),
        ('priority',          to_jsonb(o.priority),          to_jsonb(n.priority)),
        ('requires_approval', to_jsonb(o.requires_approval), to_jsonb(n.requires_approval))
      ) AS d(f, fr, t)
     WHERE d.fr IS DISTINCT FROM d.t;
$$;

-- ---------- Aplica um patch (interno; não exposto ao cliente) ----------
CREATE OR REPLACE FUNCTION apply_task_patch(p_task_id UUID, p_patch JSONB) RETURNS tasks
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_cur tasks; v_prop tasks; v_out tasks;
BEGIN
    SELECT * INTO v_cur FROM tasks WHERE id = p_task_id FOR UPDATE;
    v_prop := jsonb_populate_record(v_cur, p_patch);
    UPDATE tasks SET
        title = v_prop.title,
        description = v_prop.description,
        assigned_to = v_prop.assigned_to,
        period_shift = v_prop.period_shift,
        due_date = v_prop.due_date,
        due_time = v_prop.due_time,
        recurrence_rule = v_prop.recurrence_rule,
        priority = v_prop.priority,
        requires_approval = v_prop.requires_approval,
        version = version + 1
     WHERE id = p_task_id RETURNING * INTO v_out;
    RETURN v_out;
END $$;
REVOKE ALL ON FUNCTION apply_task_patch(UUID, JSONB) FROM PUBLIC, anon, authenticated;

-- ---------- Editar tarefa (direto ou via solicitação de aprovação) ----------
CREATE OR REPLACE FUNCTION update_task(
    p_task_id UUID, p_expected_version INT, p_patch JSONB, p_reason TEXT DEFAULT NULL
) RETURNS tasks
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_task tasks; v_prop tasks; v_new tasks; v_me UUID := my_member_id();
    v_changes JSONB; v_reason TEXT := NULLIF(trim(COALESCE(p_reason, '')), '');
BEGIN
    SELECT * INTO v_task FROM tasks
     WHERE id = p_task_id AND household_id = my_household_id() FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Tarefa não encontrada'; END IF;
    IF v_task.version <> p_expected_version THEN RAISE EXCEPTION 'CONFLICT'; END IF;
    IF v_task.status = 'pending_approval' THEN
        RAISE EXCEPTION 'Tarefa aguardando aprovação do parceiro(a)';
    END IF;

    v_prop := jsonb_populate_record(v_task, p_patch);
    v_changes := task_diff(v_task, v_prop);
    IF jsonb_array_length(v_changes) = 0 THEN RETURN v_task; END IF;

    IF v_task.requires_approval THEN
        UPDATE tasks SET status = 'pending_approval', pending_action = 'edit', pending_by = v_me,
                         version = version + 1
         WHERE id = p_task_id RETURNING * INTO v_new;
        INSERT INTO approval_requests(household_id, entity_type, entity_id, action_type,
                                      proposed_payload, requested_by, request_note)
        VALUES (v_task.household_id, 'task_edit', p_task_id, 'update',
                jsonb_build_object('title', v_task.title, 'previous_status', v_task.status,
                                   'patch', p_patch, 'changes', v_changes),
                v_me, v_reason);
        INSERT INTO activity_logs(household_id, member_id, entity_type, entity_id, action, summary, details)
        VALUES (v_task.household_id, v_me, 'task', p_task_id, 'edit_requested',
                'Solicitou o ajuste de "' || v_task.title || '"',
                jsonb_build_object('changes', v_changes, 'request_note', v_reason));
        RETURN v_new;
    END IF;

    v_new := apply_task_patch(p_task_id, p_patch);
    INSERT INTO activity_logs(household_id, member_id, entity_type, entity_id, action, summary, details)
    VALUES (v_new.household_id, v_me, 'task', v_new.id, 'updated',
            'Editou a tarefa "' || v_new.title || '"',
            jsonb_build_object('changes', v_changes));
    RETURN v_new;
END $$;

-- ---------- Concluir / reabrir (agora copia horário e flag na recorrência) ----------
CREATE OR REPLACE FUNCTION toggle_task_complete(
    p_task_id UUID, p_expected_version INT
) RETURNS tasks
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_task tasks; v_me UUID := my_member_id(); v_next DATE; v_done BOOLEAN;
BEGIN
    SELECT * INTO v_task FROM tasks
     WHERE id = p_task_id AND household_id = my_household_id() FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Tarefa não encontrada'; END IF;
    IF v_task.version <> p_expected_version THEN RAISE EXCEPTION 'CONFLICT'; END IF;
    IF v_task.status = 'pending_approval' THEN
        RAISE EXCEPTION 'Tarefa aguardando aprovação do parceiro(a)';
    END IF;

    v_done := v_task.status = 'pending';
    UPDATE tasks SET
        status = CASE WHEN v_done THEN 'completed' ELSE 'pending' END,
        completed_at = CASE WHEN v_done THEN now() ELSE NULL END,
        version = version + 1
     WHERE id = p_task_id RETURNING * INTO v_task;

    INSERT INTO activity_logs(household_id, member_id, entity_type, entity_id, action, summary)
    VALUES (v_task.household_id, v_me, 'task', v_task.id,
            CASE WHEN v_done THEN 'completed' ELSE 'uncompleted' END,
            CASE WHEN v_done THEN 'Concluiu "' ELSE 'Reabriu "' END || v_task.title || '"');

    IF v_done AND v_task.recurrence_rule <> 'none' THEN
        v_next := CASE v_task.recurrence_rule
            WHEN 'daily' THEN v_task.due_date + 1
            WHEN 'weekly' THEN v_task.due_date + 7
            WHEN 'biweekly' THEN v_task.due_date + 14
            WHEN 'monthly' THEN (v_task.due_date + INTERVAL '1 month')::date
        END;
        IF NOT EXISTS (
            SELECT 1 FROM tasks WHERE household_id = v_task.household_id
              AND title = v_task.title AND due_date = v_next AND status = 'pending'
        ) THEN
            INSERT INTO tasks(household_id, title, description, assigned_to, period_shift, due_date,
                              due_time, recurrence_rule, priority, requires_approval, created_by)
            VALUES (v_task.household_id, v_task.title, v_task.description, v_task.assigned_to,
                    v_task.period_shift, v_next, v_task.due_time, v_task.recurrence_rule,
                    v_task.priority, v_task.requires_approval, v_me);
        END IF;
    END IF;
    RETURN v_task;
END $$;

-- ---------- Excluir (direto ou via solicitação) ----------
CREATE OR REPLACE FUNCTION request_task_delete(p_task_id UUID, p_reason TEXT DEFAULT NULL) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_task tasks; v_me UUID := my_member_id();
    v_reason TEXT := NULLIF(trim(COALESCE(p_reason, '')), '');
BEGIN
    SELECT * INTO v_task FROM tasks
     WHERE id = p_task_id AND household_id = my_household_id() FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Tarefa não encontrada'; END IF;
    IF v_task.status = 'pending_approval' THEN RAISE EXCEPTION 'Já existe uma solicitação pendente'; END IF;

    IF v_task.requires_approval THEN
        UPDATE tasks SET status = 'pending_approval', pending_action = 'delete', pending_by = v_me,
                         version = version + 1
         WHERE id = p_task_id;
        INSERT INTO approval_requests(household_id, entity_type, entity_id, action_type,
                                      proposed_payload, requested_by, request_note)
        VALUES (v_task.household_id, 'task_delete', p_task_id, 'delete',
                jsonb_build_object('title', v_task.title, 'previous_status', v_task.status),
                v_me, v_reason);
        INSERT INTO activity_logs(household_id, member_id, entity_type, entity_id, action, summary, details)
        VALUES (v_task.household_id, v_me, 'task', p_task_id, 'deletion_requested',
                'Solicitou a exclusão de "' || v_task.title || '"',
                jsonb_build_object('request_note', v_reason));
        RETURN 'requested';
    ELSE
        DELETE FROM tasks WHERE id = p_task_id;
        INSERT INTO activity_logs(household_id, member_id, entity_type, entity_id, action, summary)
        VALUES (v_task.household_id, v_me, 'task', p_task_id, 'deleted',
                'Excluiu "' || v_task.title || '"');
        RETURN 'deleted';
    END IF;
END $$;

-- ---------- Decidir (aprovar / recusar com justificativa opcional) ----------
CREATE OR REPLACE FUNCTION decide_approval(
    p_request_id UUID, p_approve BOOLEAN, p_note TEXT DEFAULT NULL
) RETURNS approval_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_req approval_requests; v_me UUID := my_member_id();
    v_title TEXT; v_prev TEXT; v_old tasks; v_new tasks; v_changes JSONB;
    v_note TEXT := NULLIF(trim(COALESCE(p_note, '')), '');
    v_details JSONB;
BEGIN
    SELECT * INTO v_req FROM approval_requests
     WHERE id = p_request_id AND household_id = my_household_id() FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Solicitação não encontrada'; END IF;
    IF v_req.status <> 'pending' THEN
        RAISE EXCEPTION 'Esta solicitação já foi respondida ou cancelada pelo autor';
    END IF;
    IF v_req.requested_by = v_me THEN
        RAISE EXCEPTION 'Quem solicitou não pode decidir a própria solicitação';
    END IF;

    v_title := COALESCE(v_req.proposed_payload->>'title', 'tarefa');
    v_prev := COALESCE(v_req.proposed_payload->>'previous_status', 'pending');

    UPDATE approval_requests SET
        status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
        reviewed_at = now(), reviewed_by = v_me, decision_note = v_note
     WHERE id = p_request_id RETURNING * INTO v_req;

    -- devolve a tarefa ao estado normal
    UPDATE tasks SET status = v_prev, pending_action = NULL, pending_by = NULL, version = version + 1
     WHERE id = v_req.entity_id;

    IF v_req.entity_type = 'task_delete' THEN
        v_details := jsonb_build_object('request_note', v_req.request_note, 'decision_note', v_note);
        IF p_approve THEN
            DELETE FROM tasks WHERE id = v_req.entity_id;
            INSERT INTO activity_logs(household_id, member_id, entity_type, entity_id, action, summary, details)
            VALUES (v_req.household_id, v_me, 'task', v_req.entity_id, 'deleted',
                    'Aprovou e excluiu "' || v_title || '"', v_details);
        ELSE
            INSERT INTO activity_logs(household_id, member_id, entity_type, entity_id, action, summary, details)
            VALUES (v_req.household_id, v_me, 'task', v_req.entity_id, 'rejected',
                    'Recusou a exclusão de "' || v_title || '"', v_details);
        END IF;

    ELSIF v_req.entity_type = 'task_edit' THEN
        IF p_approve THEN
            SELECT * INTO v_old FROM tasks WHERE id = v_req.entity_id;
            v_new := apply_task_patch(v_req.entity_id, v_req.proposed_payload->'patch');
            v_changes := task_diff(v_old, v_new);
            INSERT INTO activity_logs(household_id, member_id, entity_type, entity_id, action, summary, details)
            VALUES (v_req.household_id, v_me, 'task', v_req.entity_id, 'updated',
                    'Aprovou e aplicou o ajuste em "' || v_new.title || '"',
                    jsonb_build_object('changes', v_changes, 'request_note', v_req.request_note,
                                       'decision_note', v_note));
        ELSE
            INSERT INTO activity_logs(household_id, member_id, entity_type, entity_id, action, summary, details)
            VALUES (v_req.household_id, v_me, 'task', v_req.entity_id, 'rejected',
                    'Recusou o ajuste de "' || v_title || '"',
                    jsonb_build_object('changes', v_req.proposed_payload->'changes',
                                       'request_note', v_req.request_note, 'decision_note', v_note));
        END IF;
    END IF;
    RETURN v_req;
END $$;

-- ---------- Cancelar (somente quem solicitou) ----------
CREATE OR REPLACE FUNCTION cancel_approval(p_request_id UUID) RETURNS approval_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_req approval_requests; v_me UUID := my_member_id(); v_title TEXT;
BEGIN
    SELECT * INTO v_req FROM approval_requests
     WHERE id = p_request_id AND household_id = my_household_id() FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Solicitação não encontrada'; END IF;
    IF v_req.requested_by <> v_me THEN
        RAISE EXCEPTION 'Somente quem fez a solicitação pode cancelá-la';
    END IF;
    IF v_req.status <> 'pending' THEN
        RAISE EXCEPTION 'A solicitação já foi respondida ou cancelada';
    END IF;

    v_title := COALESCE(v_req.proposed_payload->>'title', 'tarefa');

    UPDATE approval_requests SET status = 'cancelled', reviewed_at = now(), reviewed_by = v_me
     WHERE id = p_request_id RETURNING * INTO v_req;

    UPDATE tasks SET status = COALESCE(v_req.proposed_payload->>'previous_status', 'pending'),
                     pending_action = NULL, pending_by = NULL, version = version + 1
     WHERE id = v_req.entity_id;

    INSERT INTO activity_logs(household_id, member_id, entity_type, entity_id, action, summary)
    VALUES (v_req.household_id, v_me, 'task', v_req.entity_id, 'cancelled',
            'Cancelou a solicitação de ' ||
            CASE v_req.entity_type WHEN 'task_delete' THEN 'exclusão' ELSE 'ajuste' END ||
            ' de "' || v_title || '"');
    RETURN v_req;
END $$;
