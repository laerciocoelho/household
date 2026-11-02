-- =====================================================================
-- 0006 - Colunas personalizáveis do quadro de Planos
-- Execute no SQL Editor DEPOIS da 0005.
-- =====================================================================

CREATE TABLE IF NOT EXISTS plan_columns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    name VARCHAR(30) NOT NULL CHECK (length(trim(name)) > 0),
    position INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS plan_columns_household ON plan_columns(household_id, position);

ALTER TABLE plan_columns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS plan_columns_select ON plan_columns;
CREATE POLICY plan_columns_select ON plan_columns FOR SELECT USING (household_id = my_household_id());
DROP POLICY IF EXISTS plan_columns_insert ON plan_columns;
CREATE POLICY plan_columns_insert ON plan_columns FOR INSERT WITH CHECK (household_id = my_household_id());
DROP POLICY IF EXISTS plan_columns_update ON plan_columns;
CREATE POLICY plan_columns_update ON plan_columns FOR UPDATE
    USING (household_id = my_household_id()) WITH CHECK (household_id = my_household_id());
-- sem policy de DELETE: a exclusão passa por delete_plan_column (move os planos antes)

-- Máximo de 10 colunas por lar
CREATE OR REPLACE FUNCTION plan_columns_limit() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    IF (SELECT count(*) FROM plan_columns WHERE household_id = NEW.household_id) >= 10 THEN
        RAISE EXCEPTION 'Limite de 10 colunas atingido';
    END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_plan_columns_limit ON plan_columns;
CREATE TRIGGER trg_plan_columns_limit BEFORE INSERT ON plan_columns
FOR EACH ROW EXECUTE FUNCTION plan_columns_limit();

-- Colunas padrão (só cria se o lar ainda não tem nenhuma)
CREATE OR REPLACE FUNCTION seed_plan_columns(p_household UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM plan_columns WHERE household_id = p_household) THEN RETURN; END IF;
    INSERT INTO plan_columns(household_id, name, position) VALUES
        (p_household, 'Ideia', 0), (p_household, 'Planejando', 1),
        (p_household, 'Em andamento', 2), (p_household, 'Concluído', 3);
END $$;
REVOKE ALL ON FUNCTION seed_plan_columns(UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION households_seed_plan_columns() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    PERFORM seed_plan_columns(NEW.id);
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_households_seed_plan_columns ON households;
CREATE TRIGGER trg_households_seed_plan_columns AFTER INSERT ON households
FOR EACH ROW EXECUTE FUNCTION households_seed_plan_columns();

-- Lares já existentes
DO $$
DECLARE h UUID;
BEGIN
    FOR h IN SELECT id FROM households LOOP PERFORM seed_plan_columns(h); END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- plans.status (enum fixo) -> plans.column_id
-- ---------------------------------------------------------------------
ALTER TABLE plans ADD COLUMN IF NOT EXISTS column_id UUID REFERENCES plan_columns(id);

-- Só converte se a coluna antiga "status" ainda existir (permite rodar o script mais de uma vez)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'plans' AND column_name = 'status') THEN
        EXECUTE $q$
            UPDATE plans p SET column_id = (
                SELECT c.id FROM plan_columns c
                 WHERE c.household_id = p.household_id
                   AND c.position = CASE p.status WHEN 'idea' THEN 0 WHEN 'planning' THEN 1
                                                  WHEN 'in_progress' THEN 2 ELSE 3 END
                 LIMIT 1)
             WHERE p.column_id IS NULL
        $q$;
    END IF;
END $$;

-- Segurança: qualquer plano ainda sem coluna vai para a primeira coluna do lar
UPDATE plans p SET column_id = (
    SELECT c.id FROM plan_columns c WHERE c.household_id = p.household_id
     ORDER BY c.position, c.created_at LIMIT 1)
 WHERE p.column_id IS NULL;

ALTER TABLE plans ALTER COLUMN column_id SET NOT NULL;
ALTER TABLE plans DROP COLUMN IF EXISTS status;   -- remove também o CHECK e o índice antigo
CREATE INDEX IF NOT EXISTS plans_household_column ON plans(household_id, column_id);

-- Guarda: coluna padrão na criação e coluna sempre do mesmo lar
CREATE OR REPLACE FUNCTION plans_guard() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        NEW.created_by := my_member_id();
        NEW.version := 1;
        IF NEW.column_id IS NULL THEN
            SELECT id INTO NEW.column_id FROM plan_columns
             WHERE household_id = NEW.household_id ORDER BY position, created_at LIMIT 1;
        END IF;
    ELSE
        NEW.household_id := OLD.household_id;
        NEW.created_by := OLD.created_by;
        NEW.is_personal := OLD.is_personal;
        NEW.version := OLD.version + 1;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM plan_columns WHERE id = NEW.column_id AND household_id = NEW.household_id) THEN
        RAISE EXCEPTION 'Coluna inválida';
    END IF;
    RETURN NEW;
END $$;

-- Log: passa a registrar a mudança de COLUNA (por nome)
CREATE OR REPLACE FUNCTION plans_log() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_me UUID := my_member_id(); v_changes JSONB; v_old TEXT; v_new TEXT;
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.is_personal THEN RETURN NEW; END IF;
        INSERT INTO activity_logs(household_id, member_id, entity_type, entity_id, action, summary)
        VALUES (NEW.household_id, v_me, 'plan', NEW.id, 'created', 'Criou o plano "' || NEW.title || '"');
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        IF NEW.is_personal THEN RETURN NEW; END IF;
        SELECT name INTO v_old FROM plan_columns WHERE id = OLD.column_id;
        SELECT name INTO v_new FROM plan_columns WHERE id = NEW.column_id;
        SELECT COALESCE(jsonb_agg(jsonb_build_object('field', d.f, 'from', d.fr, 'to', d.t)), '[]'::jsonb)
          INTO v_changes
          FROM (VALUES
            ('title',       to_jsonb(OLD.title),       to_jsonb(NEW.title)),
            ('description', to_jsonb(OLD.description), to_jsonb(NEW.description)),
            ('category',    to_jsonb(OLD.category),    to_jsonb(NEW.category)),
            ('column',      to_jsonb(v_old),           to_jsonb(v_new)),
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
        IF EXISTS (SELECT 1 FROM households WHERE id = OLD.household_id) THEN
            INSERT INTO activity_logs(household_id, member_id, entity_type, entity_id, action, summary)
            VALUES (OLD.household_id, v_me, 'plan', OLD.id, 'deleted', 'Excluiu o plano "' || OLD.title || '"');
        END IF;
        RETURN OLD;
    END IF;
END $$;

-- ---------------------------------------------------------------------
-- RPCs de colunas
-- ---------------------------------------------------------------------
-- Define a ordem das colunas (p_ids na ordem desejada)
CREATE OR REPLACE FUNCTION reorder_plan_columns(p_ids UUID[]) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF my_household_id() IS NULL THEN RAISE EXCEPTION 'Você não pertence a nenhum lar'; END IF;
    UPDATE plan_columns c SET position = o.ord - 1
      FROM unnest(p_ids) WITH ORDINALITY AS o(id, ord)
     WHERE c.id = o.id AND c.household_id = my_household_id();
END $$;

-- Exclui a coluna movendo antes os planos (inclusive pessoais de outra pessoa) para p_move_to
CREATE OR REPLACE FUNCTION delete_plan_column(p_column_id UUID, p_move_to UUID DEFAULT NULL) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_house UUID := my_household_id();
BEGIN
    IF v_house IS NULL THEN RAISE EXCEPTION 'Você não pertence a nenhum lar'; END IF;
    IF NOT EXISTS (SELECT 1 FROM plan_columns WHERE id = p_column_id AND household_id = v_house) THEN
        RAISE EXCEPTION 'Coluna não encontrada';
    END IF;
    IF (SELECT count(*) FROM plan_columns WHERE household_id = v_house) <= 1 THEN
        RAISE EXCEPTION 'Mantenha ao menos uma coluna';
    END IF;
    IF EXISTS (SELECT 1 FROM plans WHERE column_id = p_column_id) THEN
        IF p_move_to IS NULL OR p_move_to = p_column_id
           OR NOT EXISTS (SELECT 1 FROM plan_columns WHERE id = p_move_to AND household_id = v_house) THEN
            RAISE EXCEPTION 'Escolha a coluna de destino dos planos';
        END IF;
        UPDATE plans SET column_id = p_move_to WHERE column_id = p_column_id;
    END IF;
    DELETE FROM plan_columns WHERE id = p_column_id;
END $$;

-- Realtime
DO $$
BEGIN
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE plan_columns; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;
