-- =====================================================================
-- 0003 - Tarefas pessoais, perfil/saída do lar e data da tarefa nos logs
-- Execute no SQL Editor DEPOIS da 0001_init.sql e da 0002_adjustments.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Tarefa pessoal: somente o criador cria / vê / edita
-- ---------------------------------------------------------------------
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS is_personal BOOLEAN NOT NULL DEFAULT false;

DROP POLICY IF EXISTS tasks_select ON tasks;
CREATE POLICY tasks_select ON tasks FOR SELECT
    USING (household_id = my_household_id() AND (NOT is_personal OR created_by = my_member_id()));

DROP POLICY IF EXISTS tasks_insert ON tasks;
CREATE POLICY tasks_insert ON tasks FOR INSERT
    WITH CHECK (household_id = my_household_id() AND (NOT is_personal OR created_by = my_member_id()));

-- Tarefa pessoal: criador = quem insere, responsável = criador, nunca exige aprovação
CREATE OR REPLACE FUNCTION enforce_personal_task() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.is_personal THEN
        IF TG_OP = 'INSERT' THEN NEW.created_by := my_member_id(); END IF;
        NEW.assigned_to := NEW.created_by;
        NEW.requires_approval := false;
    END IF;
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_enforce_personal_task ON tasks;
CREATE TRIGGER trg_enforce_personal_task BEFORE INSERT OR UPDATE ON tasks
FOR EACH ROW EXECUTE FUNCTION enforce_personal_task();

-- ---------------------------------------------------------------------
-- 2) Logs: sem registro de tarefa pessoal + data de atribuição da tarefa
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION activity_logs_prepare() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_task tasks; v_prev JSONB;
BEGIN
    IF NEW.entity_type <> 'task' THEN RETURN NEW; END IF;

    SELECT * INTO v_task FROM tasks WHERE id = NEW.entity_id;
    IF FOUND THEN
        -- tarefa pessoal não deixa rastro visível para o parceiro(a)
        IF v_task.is_personal THEN RETURN NULL; END IF;
        NEW.details := COALESCE(NEW.details, '{}'::jsonb)
                       || jsonb_build_object('task_date', v_task.due_date, 'task_time', v_task.due_time);
    ELSE
        -- tarefa já excluída: reaproveita a data do último registro dela
        SELECT details INTO v_prev FROM activity_logs
         WHERE entity_id = NEW.entity_id AND details ? 'task_date'
         ORDER BY created_at DESC LIMIT 1;
        IF v_prev IS NOT NULL THEN
            NEW.details := COALESCE(NEW.details, '{}'::jsonb)
                           || jsonb_build_object('task_date', v_prev->'task_date', 'task_time', v_prev->'task_time');
        END IF;
    END IF;
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_activity_logs_prepare ON activity_logs;
CREATE TRIGGER trg_activity_logs_prepare BEFORE INSERT ON activity_logs
FOR EACH ROW EXECUTE FUNCTION activity_logs_prepare();

-- Registros antigos: usa a data ATUAL da tarefa (quando ela ainda existe)
UPDATE activity_logs l
   SET details = COALESCE(l.details, '{}'::jsonb)
                 || jsonb_build_object('task_date', t.due_date, 'task_time', t.due_time)
  FROM tasks t
 WHERE l.entity_type = 'task' AND l.entity_id = t.id
   AND (l.details IS NULL OR NOT l.details ? 'task_date');

-- ---------------------------------------------------------------------
-- 3) Funções de tarefa atualizadas (visibilidade + is_personal)
-- ---------------------------------------------------------------------
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
        ('requires_approval', to_jsonb(o.requires_approval), to_jsonb(n.requires_approval)),
        ('is_personal',       to_jsonb(o.is_personal),       to_jsonb(n.is_personal))
      ) AS d(f, fr, t)
     WHERE d.fr IS DISTINCT FROM d.t;
$$;

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
        is_personal = v_prop.is_personal,
        version = version + 1
     WHERE id = p_task_id RETURNING * INTO v_out;
    RETURN v_out;
END $$;
REVOKE ALL ON FUNCTION apply_task_patch(UUID, JSONB) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION update_task(
    p_task_id UUID, p_expected_version INT, p_patch JSONB, p_reason TEXT DEFAULT NULL
) RETURNS tasks
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_me UUID := my_member_id();
    v_task tasks; v_prop tasks; v_new tasks;
    v_changes JSONB; v_reason TEXT := NULLIF(trim(COALESCE(p_reason, '')), '');
BEGIN
    SELECT * INTO v_task FROM tasks
     WHERE id = p_task_id AND household_id = my_household_id()
       AND (NOT is_personal OR created_by = v_me) FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Tarefa não encontrada'; END IF;
    IF v_task.version <> p_expected_version THEN RAISE EXCEPTION 'CONFLICT'; END IF;
    IF v_task.status = 'pending_approval' THEN
        RAISE EXCEPTION 'Tarefa aguardando aprovação do parceiro(a)';
    END IF;

    v_prop := jsonb_populate_record(v_task, p_patch);
    IF v_prop.is_personal AND NOT v_task.is_personal THEN
        RAISE EXCEPTION 'Uma tarefa compartilhada não pode virar pessoal';
    END IF;
    IF v_prop.is_personal THEN
        v_prop.assigned_to := v_task.created_by;
        v_prop.requires_approval := false;
    END IF;

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

CREATE OR REPLACE FUNCTION toggle_task_complete(
    p_task_id UUID, p_expected_version INT
) RETURNS tasks
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_task tasks; v_me UUID := my_member_id(); v_next DATE; v_done BOOLEAN;
BEGIN
    SELECT * INTO v_task FROM tasks
     WHERE id = p_task_id AND household_id = my_household_id()
       AND (NOT is_personal OR created_by = v_me) FOR UPDATE;
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
              AND is_personal = v_task.is_personal
        ) THEN
            INSERT INTO tasks(household_id, title, description, assigned_to, period_shift, due_date,
                              due_time, recurrence_rule, priority, requires_approval, is_personal, created_by)
            VALUES (v_task.household_id, v_task.title, v_task.description, v_task.assigned_to,
                    v_task.period_shift, v_next, v_task.due_time, v_task.recurrence_rule,
                    v_task.priority, v_task.requires_approval, v_task.is_personal, v_me);
        END IF;
    END IF;
    RETURN v_task;
END $$;

CREATE OR REPLACE FUNCTION request_task_delete(p_task_id UUID, p_reason TEXT DEFAULT NULL) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_task tasks; v_me UUID := my_member_id();
    v_reason TEXT := NULLIF(trim(COALESCE(p_reason, '')), '');
BEGIN
    SELECT * INTO v_task FROM tasks
     WHERE id = p_task_id AND household_id = my_household_id()
       AND (NOT is_personal OR created_by = v_me) FOR UPDATE;
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
    END IF;

    DELETE FROM tasks WHERE id = p_task_id;
    -- tarefa pessoal não gera log (o título não pode vazar para o parceiro)
    IF NOT v_task.is_personal THEN
        INSERT INTO activity_logs(household_id, member_id, entity_type, entity_id, action, summary)
        VALUES (v_task.household_id, v_me, 'task', p_task_id, 'deleted',
                'Excluiu "' || v_task.title || '"');
    END IF;
    RETURN 'deleted';
END $$;

-- ---------------------------------------------------------------------
-- 4) Perfil e troca de casa
-- ---------------------------------------------------------------------
ALTER TABLE household_members
    ADD COLUMN IF NOT EXISTS preferred_view VARCHAR(10) NOT NULL DEFAULT 'today';
ALTER TABLE household_members DROP CONSTRAINT IF EXISTS household_members_preferred_view_check;
ALTER TABLE household_members ADD CONSTRAINT household_members_preferred_view_check
    CHECK (preferred_view IN ('today', 'week', 'month'));

-- Atualização direta da própria linha deixava o usuário trocar household_id/is_owner.
-- Passa a existir somente via RPC (nome, cor e ícone).
DROP POLICY IF EXISTS members_update_self ON household_members;

DROP FUNCTION IF EXISTS update_my_profile(TEXT, TEXT, TEXT);
CREATE OR REPLACE FUNCTION update_my_profile(
    p_display_name TEXT, p_color TEXT, p_icon TEXT, p_preferred_view TEXT DEFAULT NULL
)
RETURNS household_members
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_me UUID := my_member_id(); v_name TEXT := trim(COALESCE(p_display_name, '')); v_row household_members;
BEGIN
    IF v_me IS NULL THEN RAISE EXCEPTION 'Você não pertence a nenhum lar'; END IF;
    IF length(v_name) = 0 OR length(v_name) > 50 THEN
        RAISE EXCEPTION 'Informe um nome de 1 a 50 caracteres';
    END IF;
    IF p_color IS NULL OR p_color !~ '^#[0-9A-Fa-f]{6}$' THEN RAISE EXCEPTION 'Cor inválida'; END IF;
    IF p_icon IS NULL OR length(p_icon) = 0 OR length(p_icon) > 30 THEN RAISE EXCEPTION 'Ícone inválido'; END IF;

    IF p_preferred_view IS NOT NULL AND p_preferred_view NOT IN ('today', 'week', 'month') THEN
        RAISE EXCEPTION 'Visão inválida';
    END IF;

    UPDATE household_members SET display_name = v_name, color_hex = p_color, icon_name = p_icon,
                                 preferred_view = COALESCE(p_preferred_view, preferred_view)
     WHERE id = v_me RETURNING * INTO v_row;
    RETURN v_row;
END $$;

-- Sair do lar atual (para entrar em outro ou criar um novo)
CREATE OR REPLACE FUNCTION leave_household() RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_me UUID := my_member_id(); v_house UUID := my_household_id();
    v_name TEXT; v_house_name TEXT; v_was_owner BOOLEAN; v_others INT;
BEGIN
    IF v_me IS NULL THEN RAISE EXCEPTION 'Você não pertence a nenhum lar'; END IF;

    SELECT display_name, is_owner INTO v_name, v_was_owner FROM household_members WHERE id = v_me;
    SELECT name INTO v_house_name FROM households WHERE id = v_house;
    SELECT count(*) INTO v_others FROM household_members WHERE household_id = v_house AND id <> v_me;

    -- tarefas pessoais ficariam órfãs (ninguém mais as enxerga)
    DELETE FROM tasks WHERE household_id = v_house AND is_personal AND created_by = v_me;

    IF v_others = 0 THEN
        DELETE FROM households WHERE id = v_house; -- remove membros, tarefas e histórico em cascata
        RETURN;
    END IF;

    -- solicitações pendentes feitas por mim: devolve as tarefas ao estado normal
    UPDATE tasks t
       SET status = COALESCE(a.proposed_payload->>'previous_status', 'pending'),
           pending_action = NULL, pending_by = NULL, version = t.version + 1
      FROM approval_requests a
     WHERE a.entity_id = t.id AND a.status = 'pending' AND a.requested_by = v_me;

    IF v_was_owner THEN
        UPDATE household_members SET is_owner = true WHERE household_id = v_house AND id <> v_me;
    END IF;

    INSERT INTO activity_logs(household_id, member_id, entity_type, entity_id, action, summary)
    VALUES (v_house, v_me, 'household', v_house, 'updated',
            v_name || ' saiu do lar "' || v_house_name || '"');

    DELETE FROM household_members WHERE id = v_me; -- solicitações pendentes dele são removidas em cascata
END $$;
