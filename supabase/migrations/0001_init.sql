-- =====================================================================
-- HOUSEHOLD APP - schema inicial
-- =====================================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Lar
CREATE TABLE households (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    invite_code VARCHAR(8) UNIQUE NOT NULL,
    require_mutual_approval_for_delete BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Membros (máx. 2 por lar, garantido por trigger)
CREATE TABLE household_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id UUID REFERENCES households(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    display_name VARCHAR(50) NOT NULL,
    color_hex VARCHAR(7) NOT NULL,
    icon_name VARCHAR(30) NOT NULL,
    is_owner BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(household_id, user_id)
);
-- um usuário pertence a apenas um lar
CREATE UNIQUE INDEX household_members_one_household_per_user ON household_members(user_id);

-- 3. Tarefas
CREATE TABLE tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id UUID REFERENCES households(id) ON DELETE CASCADE,
    title VARCHAR(150) NOT NULL,
    description TEXT,
    assigned_to UUID REFERENCES household_members(id) ON DELETE SET NULL,
    period_shift VARCHAR(20) DEFAULT 'anytime'
        CHECK (period_shift IN ('morning','afternoon','night','anytime')),
    due_date DATE NOT NULL,
    recurrence_rule VARCHAR(50) DEFAULT 'none'
        CHECK (recurrence_rule IN ('none','daily','weekly','biweekly','monthly')),
    priority VARCHAR(10) DEFAULT 'normal' CHECK (priority IN ('low','normal','high')),
    status VARCHAR(20) DEFAULT 'pending'
        CHECK (status IN ('pending','completed','pending_approval')),
    completed_at TIMESTAMPTZ,
    version INT DEFAULT 1,
    locked_by UUID REFERENCES household_members(id) ON DELETE SET NULL,
    locked_until TIMESTAMPTZ,
    created_by UUID REFERENCES household_members(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX tasks_household_due ON tasks(household_id, due_date);

-- 4. Aprovações
CREATE TABLE approval_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id UUID REFERENCES households(id) ON DELETE CASCADE,
    entity_type VARCHAR(30) NOT NULL,
    entity_id UUID NOT NULL,
    action_type VARCHAR(20) NOT NULL,
    proposed_payload JSONB,
    requested_by UUID REFERENCES household_members(id) ON DELETE CASCADE,
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT now(),
    reviewed_at TIMESTAMPTZ,
    reviewed_by UUID REFERENCES household_members(id) ON DELETE SET NULL
);

-- 5. Logs
CREATE TABLE activity_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id UUID REFERENCES households(id) ON DELETE CASCADE,
    member_id UUID REFERENCES household_members(id) ON DELETE SET NULL,
    entity_type VARCHAR(30) NOT NULL,
    entity_id UUID NOT NULL,
    action VARCHAR(20) NOT NULL,
    summary TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX activity_logs_household_created ON activity_logs(household_id, created_at DESC);

-- =====================================================================
-- Helpers
-- =====================================================================
CREATE OR REPLACE FUNCTION my_household_id() RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT household_id FROM household_members WHERE user_id = auth.uid() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION my_member_id() RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT id FROM household_members WHERE user_id = auth.uid() LIMIT 1;
$$;

-- Limite de 2 membros
CREATE OR REPLACE FUNCTION enforce_max_two_members() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    IF (SELECT count(*) FROM household_members WHERE household_id = NEW.household_id) >= 2 THEN
        RAISE EXCEPTION 'Este lar já possui 2 membros';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER trg_max_two_members BEFORE INSERT ON household_members
FOR EACH ROW EXECUTE FUNCTION enforce_max_two_members();

-- updated_at
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
CREATE TRIGGER trg_tasks_touch BEFORE UPDATE ON tasks
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- =====================================================================
-- RLS
-- =====================================================================
ALTER TABLE households ENABLE ROW LEVEL SECURITY;
ALTER TABLE household_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY households_select ON households FOR SELECT
    USING (id = my_household_id());
CREATE POLICY households_update ON households FOR UPDATE
    USING (id = my_household_id()) WITH CHECK (id = my_household_id());

CREATE POLICY members_select ON household_members FOR SELECT
    USING (household_id = my_household_id());
CREATE POLICY members_update_self ON household_members FOR UPDATE
    USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY tasks_select ON tasks FOR SELECT
    USING (household_id = my_household_id());
CREATE POLICY tasks_insert ON tasks FOR INSERT
    WITH CHECK (household_id = my_household_id());
-- UPDATE/DELETE diretos não são permitidos: somente via RPC (version + aprovação mútua)

CREATE POLICY approvals_select ON approval_requests FOR SELECT
    USING (household_id = my_household_id());
-- INSERT/UPDATE em approval_requests somente via RPC

CREATE POLICY logs_select ON activity_logs FOR SELECT
    USING (household_id = my_household_id());
-- INSERT em activity_logs somente via RPC/triggers (trilha de auditoria imutável)

-- =====================================================================
-- RPCs
-- =====================================================================

-- Criar lar + primeiro membro
CREATE OR REPLACE FUNCTION create_household(
    p_name TEXT, p_display_name TEXT, p_color TEXT, p_icon TEXT
) RETURNS households
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
    v_code TEXT; v_house households; v_member UUID;
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
    IF my_household_id() IS NOT NULL THEN RAISE EXCEPTION 'Você já pertence a um lar'; END IF;
    LOOP
        v_code := upper(substr(translate(encode(gen_random_bytes(6), 'base64'), '+/=lIO01', 'XYZABCDE'), 1, 6));
        EXIT WHEN NOT EXISTS (SELECT 1 FROM households WHERE invite_code = v_code);
    END LOOP;
    INSERT INTO households(name, invite_code) VALUES (p_name, v_code) RETURNING * INTO v_house;
    INSERT INTO household_members(household_id, user_id, display_name, color_hex, icon_name, is_owner)
    VALUES (v_house.id, auth.uid(), p_display_name, p_color, p_icon, true) RETURNING id INTO v_member;
    INSERT INTO activity_logs(household_id, member_id, entity_type, entity_id, action, summary)
    VALUES (v_house.id, v_member, 'household', v_house.id, 'created',
            p_display_name || ' criou o lar "' || p_name || '"');
    RETURN v_house;
END $$;

-- Entrar no lar por código
CREATE OR REPLACE FUNCTION join_household(
    p_code TEXT, p_display_name TEXT, p_color TEXT, p_icon TEXT
) RETURNS households
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_house households; v_member UUID;
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
    IF my_household_id() IS NOT NULL THEN RAISE EXCEPTION 'Você já pertence a um lar'; END IF;
    SELECT * INTO v_house FROM households WHERE invite_code = upper(trim(p_code));
    IF NOT FOUND THEN RAISE EXCEPTION 'Código de convite inválido'; END IF;
    INSERT INTO household_members(household_id, user_id, display_name, color_hex, icon_name)
    VALUES (v_house.id, auth.uid(), p_display_name, p_color, p_icon) RETURNING id INTO v_member;
    INSERT INTO activity_logs(household_id, member_id, entity_type, entity_id, action, summary)
    VALUES (v_house.id, v_member, 'household', v_house.id, 'updated',
            p_display_name || ' entrou no lar');
    RETURN v_house;
END $$;

-- Atualizar tarefa com concorrência otimista (version)
-- Retorna a tarefa atualizada; lança 'CONFLICT' se a versão não bater.
CREATE OR REPLACE FUNCTION update_task(
    p_task_id UUID, p_expected_version INT, p_patch JSONB
) RETURNS tasks
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_task tasks; v_me UUID := my_member_id();
BEGIN
    SELECT * INTO v_task FROM tasks
     WHERE id = p_task_id AND household_id = my_household_id() FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Tarefa não encontrada'; END IF;
    IF v_task.version <> p_expected_version THEN RAISE EXCEPTION 'CONFLICT'; END IF;
    IF v_task.status = 'pending_approval' THEN
        RAISE EXCEPTION 'Tarefa aguardando aprovação de exclusão';
    END IF;

    UPDATE tasks SET
        title = COALESCE(p_patch->>'title', title),
        description = CASE WHEN p_patch ? 'description' THEN p_patch->>'description' ELSE description END,
        assigned_to = CASE WHEN p_patch ? 'assigned_to' THEN NULLIF(p_patch->>'assigned_to','')::uuid ELSE assigned_to END,
        period_shift = COALESCE(p_patch->>'period_shift', period_shift),
        due_date = COALESCE((p_patch->>'due_date')::date, due_date),
        recurrence_rule = COALESCE(p_patch->>'recurrence_rule', recurrence_rule),
        priority = COALESCE(p_patch->>'priority', priority),
        version = version + 1
     WHERE id = p_task_id RETURNING * INTO v_task;

    INSERT INTO activity_logs(household_id, member_id, entity_type, entity_id, action, summary)
    VALUES (v_task.household_id, v_me, 'task', v_task.id, 'updated',
            'Editou a tarefa "' || v_task.title || '"');
    RETURN v_task;
END $$;

-- Concluir / reabrir (gera próxima ocorrência se recorrente)
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
        RAISE EXCEPTION 'Tarefa aguardando aprovação de exclusão';
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
        -- evita duplicar se já existir a próxima ocorrência pendente
        IF NOT EXISTS (
            SELECT 1 FROM tasks WHERE household_id = v_task.household_id
              AND title = v_task.title AND due_date = v_next AND status = 'pending'
        ) THEN
            INSERT INTO tasks(household_id, title, description, assigned_to, period_shift,
                              due_date, recurrence_rule, priority, created_by)
            VALUES (v_task.household_id, v_task.title, v_task.description, v_task.assigned_to,
                    v_task.period_shift, v_next, v_task.recurrence_rule, v_task.priority, v_me);
        END IF;
    END IF;
    RETURN v_task;
END $$;

-- Solicitar exclusão (ou excluir direto se aprovação mútua estiver desligada)
CREATE OR REPLACE FUNCTION request_task_delete(p_task_id UUID) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_task tasks; v_me UUID := my_member_id(); v_req BOOLEAN;
BEGIN
    SELECT * INTO v_task FROM tasks
     WHERE id = p_task_id AND household_id = my_household_id() FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Tarefa não encontrada'; END IF;
    IF v_task.status = 'pending_approval' THEN RAISE EXCEPTION 'Já existe uma solicitação pendente'; END IF;

    SELECT require_mutual_approval_for_delete INTO v_req FROM households WHERE id = v_task.household_id;

    IF v_req THEN
        UPDATE tasks SET status = 'pending_approval', version = version + 1 WHERE id = p_task_id;
        INSERT INTO approval_requests(household_id, entity_type, entity_id, action_type, proposed_payload, requested_by)
        VALUES (v_task.household_id, 'task_delete', p_task_id, 'delete',
                jsonb_build_object('title', v_task.title, 'previous_status', v_task.status), v_me);
        INSERT INTO activity_logs(household_id, member_id, entity_type, entity_id, action, summary)
        VALUES (v_task.household_id, v_me, 'task', p_task_id, 'deletion_requested',
                'Solicitou a exclusão de "' || v_task.title || '"');
        RETURN 'requested';
    ELSE
        DELETE FROM tasks WHERE id = p_task_id;
        INSERT INTO activity_logs(household_id, member_id, entity_type, entity_id, action, summary)
        VALUES (v_task.household_id, v_me, 'task', p_task_id, 'deleted',
                'Excluiu "' || v_task.title || '"');
        RETURN 'deleted';
    END IF;
END $$;

-- Decidir solicitação (somente o parceiro de quem solicitou)
CREATE OR REPLACE FUNCTION decide_approval(p_request_id UUID, p_approve BOOLEAN) RETURNS approval_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_req approval_requests; v_me UUID := my_member_id(); v_title TEXT;
BEGIN
    SELECT * INTO v_req FROM approval_requests
     WHERE id = p_request_id AND household_id = my_household_id() FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Solicitação não encontrada'; END IF;
    IF v_req.status <> 'pending' THEN RAISE EXCEPTION 'Solicitação já decidida'; END IF;
    IF v_req.requested_by = v_me THEN
        RAISE EXCEPTION 'Quem solicitou não pode decidir a própria solicitação';
    END IF;

    v_title := COALESCE(v_req.proposed_payload->>'title', 'tarefa');

    UPDATE approval_requests SET
        status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
        reviewed_at = now(), reviewed_by = v_me
     WHERE id = p_request_id RETURNING * INTO v_req;

    IF v_req.entity_type = 'task_delete' THEN
        IF p_approve THEN
            DELETE FROM tasks WHERE id = v_req.entity_id;
            INSERT INTO activity_logs(household_id, member_id, entity_type, entity_id, action, summary)
            VALUES (v_req.household_id, v_me, 'task', v_req.entity_id, 'deleted',
                    'Aprovou e excluiu "' || v_title || '"');
        ELSE
            UPDATE tasks SET status = COALESCE(v_req.proposed_payload->>'previous_status', 'pending'),
                             version = version + 1
             WHERE id = v_req.entity_id;
            INSERT INTO activity_logs(household_id, member_id, entity_type, entity_id, action, summary)
            VALUES (v_req.household_id, v_me, 'task', v_req.entity_id, 'rejected',
                    'Recusou a exclusão de "' || v_title || '"');
        END IF;
    END IF;
    RETURN v_req;
END $$;

-- Log de criação via trigger (garante auditoria mesmo em inserts diretos)
CREATE OR REPLACE FUNCTION log_task_created() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    INSERT INTO activity_logs(household_id, member_id, entity_type, entity_id, action, summary)
    VALUES (NEW.household_id, NEW.created_by, 'task', NEW.id, 'created',
            'Criou a tarefa "' || NEW.title || '"');
    RETURN NEW;
END $$;
CREATE TRIGGER trg_log_task_created AFTER INSERT ON tasks
FOR EACH ROW EXECUTE FUNCTION log_task_created();

-- =====================================================================
-- Realtime
-- =====================================================================
ALTER PUBLICATION supabase_realtime ADD TABLE tasks, approval_requests, activity_logs, household_members;
ALTER TABLE tasks REPLICA IDENTITY FULL;
ALTER TABLE approval_requests REPLICA IDENTITY FULL;
