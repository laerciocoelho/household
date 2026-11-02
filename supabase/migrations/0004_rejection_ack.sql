-- =====================================================================
-- 0004 - Notificação de recusa para quem solicitou o ajuste/exclusão
-- Execute no SQL Editor DEPOIS da 0003.
-- =====================================================================
ALTER TABLE approval_requests ADD COLUMN IF NOT EXISTS requester_ack_at TIMESTAMPTZ;

-- Recusas antigas já são consideradas vistas (não gera pop-up retroativo)
UPDATE approval_requests
   SET requester_ack_at = COALESCE(reviewed_at, now())
 WHERE status = 'rejected' AND requester_ack_at IS NULL;

-- Índices para as buscas sob demanda (histórico paginado)
CREATE INDEX IF NOT EXISTS approval_requests_household_created
    ON approval_requests(household_id, created_at DESC);

-- O autor da solicitação marca a recusa como vista
CREATE OR REPLACE FUNCTION ack_rejection(p_request_id UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    UPDATE approval_requests
       SET requester_ack_at = now()
     WHERE id = p_request_id
       AND requested_by = my_member_id()
       AND status = 'rejected'
       AND requester_ack_at IS NULL;
END $$;
