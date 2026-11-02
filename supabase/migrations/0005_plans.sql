-- =====================================================================
-- 0005 - Planos futuros do casal (viagem, decoração, manutenção...)
-- Execute no SQL Editor DEPOIS da 0004.
-- =====================================================================

CREATE TABLE IF NOT EXISTS plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    title VARCHAR(150) NOT NULL,
    description TEXT,
    category VARCHAR(20) NOT NULL DEFAULT 'other'
        CHECK (category IN ('trip', 'home', 'maintenance', 'shopping', 'other')),
    status VARCHAR(20) NOT NULL DEFAULT 'idea'
        CHECK (status IN ('idea', 'planning', 'in_progress', 'done')),
    target_date DATE,
    is_personal BOOLEAN NOT NULL DEFAULT false,
    created_by UUID REFERENCES household_members(id) ON DELETE SET NULL,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS plans_household ON plans(household_id, status);

CREATE TABLE IF NOT EXISTS plan_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id UUID NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    title VARCHAR(150) NOT NULL,
    assigned_to UUID REFERENCES household_members(id) ON DELETE SET NULL, -- NULL = ambos
    due_date DATE,
    done BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS plan_items_plan ON plan_items(plan_id, created_at);

-- updated_at
DROP TRIGGER IF EXISTS trg_plans_touch ON plans;
CREATE TRIGGER trg_plans_touch BEFORE UPDATE ON plans
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Campos imutáveis + controle de concorrência (version) + plano pessoal
CREATE OR REPLACE FUNCTION plans_guard() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        NEW.created_by := my_member_id();
        NEW.version := 1;
    ELSE
        NEW.household_id := OLD.household_id;
        NEW.created_by := OLD.created_by;
        NEW.is_personal := OLD.is_personal;      -- não muda a visibilidade depois de criado
        NEW.version := OLD.version + 1;
    END IF;
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_plans_guard ON plans;
CREATE TRIGGER trg_plans_guard BEFORE INSERT OR UPDATE ON plans
FOR EACH ROW EXECUTE FUNCTION plans_guard();

-- ---------------------------------------------------------------------
-- RLS: plano pessoal só é visível/editável pelo criador
-- ---------------------------------------------------------------------
ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS plans_select ON plans;
CREATE POLICY plans_select ON plans FOR SELECT
    USING (household_id = my_household_id() AND (NOT is_personal OR created_by = my_member_id()));

DROP POLICY IF EXISTS plans_insert ON plans;
CREATE POLICY plans_insert ON plans FOR INSERT
    WITH CHECK (household_id = my_household_id());

DROP POLICY IF EXISTS plans_update ON plans;
CREATE POLICY plans_update ON plans FOR UPDATE
    USING (household_id = my_household_id() AND (NOT is_personal OR created_by = my_member_id()))
    WITH CHECK (household_id = my_household_id());

DROP POLICY IF EXISTS plans_delete ON plans;
CREATE POLICY plans_delete ON plans FOR DELETE
    USING (household_id = my_household_id() AND (NOT is_personal OR created_by = my_member_id()));

-- Etapas herdam a visibilidade do plano (a subconsulta já respeita a RLS de plans)
DROP POLICY IF EXISTS plan_items_all ON plan_items;
CREATE POLICY plan_items_all ON plan_items FOR ALL
    USING (household_id = my_household_id() AND EXISTS (SELECT 1 FROM plans p WHERE p.id = plan_id))
    WITH CHECK (household_id = my_household_id() AND EXISTS (SELECT 1 FROM plans p WHERE p.id = plan_id));

-- ---------------------------------------------------------------------
-- Log de atividades (planos pessoais não deixam rastro para o parceiro)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION plans_log() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_me UUID := my_member_id(); v_changes JSONB;
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.is_personal THEN RETURN NEW; END IF;
        INSERT INTO activity_logs(household_id, member_id, entity_type, entity_id, action, summary)
        VALUES (NEW.household_id, v_me, 'plan', NEW.id, 'created', 'Criou o plano "' || NEW.title || '"');
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        IF NEW.is_personal THEN RETURN NEW; END IF;
        SELECT COALESCE(jsonb_agg(jsonb_build_object('field', d.f, 'from', d.fr, 'to', d.t)), '[]'::jsonb)
          INTO v_changes
          FROM (VALUES
            ('title',       to_jsonb(OLD.title),       to_jsonb(NEW.title)),
            ('description', to_jsonb(OLD.description), to_jsonb(NEW.description)),
            ('category',    to_jsonb(OLD.category),    to_jsonb(NEW.category)),
            ('status',      to_jsonb(OLD.status),      to_jsonb(NEW.status)),
            ('target_date', to_jsonb(OLD.target_date), to_jsonb(NEW.target_date))
          ) AS d(f, fr, t)
         WHERE d.fr IS DISTINCT FROM d.t;
        IF jsonb_array_length(v_changes) > 0 THEN
            INSERT INTO activity_logs(household_id, member_id, entity_type, entity_id, action, summary, details)
            VALUES (NEW.household_id, v_me, 'plan', NEW.id, 'updated',
                    'Editou o plano "' || NEW.title || '"', jsonb_build_object('changes', v_changes));
        END IF;
        RETURN NEW;
    ELSE
        IF OLD.is_personal THEN RETURN OLD; END IF;
        -- exclusão em cascata do lar: não há mais lar para registrar
        IF EXISTS (SELECT 1 FROM households WHERE id = OLD.household_id) THEN
            INSERT INTO activity_logs(household_id, member_id, entity_type, entity_id, action, summary)
            VALUES (OLD.household_id, v_me, 'plan', OLD.id, 'deleted', 'Excluiu o plano "' || OLD.title || '"');
        END IF;
        RETURN OLD;
    END IF;
END $$;

DROP TRIGGER IF EXISTS trg_plans_log ON plans;
CREATE TRIGGER trg_plans_log AFTER INSERT OR UPDATE OR DELETE ON plans
FOR EACH ROW EXECUTE FUNCTION plans_log();

-- ---------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------
DO $$
BEGIN
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE plans; EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE plan_items; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

-- ---------------------------------------------------------------------
-- Sair do lar: remove também os planos pessoais de quem sai
-- ---------------------------------------------------------------------
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
    DELETE FROM plans WHERE household_id = v_house AND is_personal AND created_by = v_me;

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
