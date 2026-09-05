-- Bounded, idempotent legacy-stage normalization. No customer imports or synthetic metrics.
UPDATE opportunities SET
  stage = CASE
    WHEN EXISTS (SELECT 1 FROM appointments a WHERE a.conversation_id=opportunities.conversation_id AND a.status='CONFIRMED') THEN 'BOOKED'
    WHEN stage IN ('ATTENDED','WON','BOOKED') AND EXISTS (SELECT 1 FROM appointments a WHERE a.conversation_id=opportunities.conversation_id AND a.status='COMPLETED') THEN 'ATTENDED'
    WHEN stage IN ('WON','BOOKED','TIME_OFFERED','SCHEDULING') THEN 'WANTS_TO_BOOK'
    WHEN stage IN ('QUALIFICATION','OBJECTION') THEN 'QUALIFIED'
    WHEN stage IN ('PROFESSIONAL_REVIEW','HUMAN_CONFIRMATION','FOLLOW_UP') THEN 'IN_CONVERSATION'
    WHEN stage='NEW' THEN 'NEW_LEAD'
    ELSE stage END,
  last_interaction_at = COALESCE(last_interaction_at,(SELECT MAX(created_at) FROM messages m WHERE m.conversation_id=opportunities.conversation_id))
WHERE NOT EXISTS (SELECT 1 FROM audit_events WHERE dedup_key='commercial_normalized_v1');

UPDATE opportunities SET next_best_action = CASE
  WHEN EXISTS (SELECT 1 FROM conversations c WHERE c.id=opportunities.conversation_id AND c.control_state='PROFESSIONAL_HANDOFF') THEN 'PROFESSIONAL_REVIEW'
  WHEN EXISTS (SELECT 1 FROM conversations c WHERE c.id=opportunities.conversation_id AND c.control_state='HUMAN_CONTROL') THEN 'HUMAN_REPLY'
  WHEN stage IN ('BOOKED','ATTENDED','LOST') THEN 'CLOSE'
  WHEN stage='WANTS_TO_BOOK' THEN 'REQUEST_HUMAN_CONFIRMATION'
  ELSE next_best_action END
WHERE NOT EXISTS (SELECT 1 FROM audit_events WHERE dedup_key='commercial_normalized_v1');

INSERT OR IGNORE INTO audit_events(id,event_type,actor_type,metadata_json,dedup_key,created_at)
VALUES('commercial-normalization-v1','commercial_normalized','SYSTEM','{}','commercial_normalized_v1',strftime('%Y-%m-%dT%H:%M:%fZ','now'));

UPDATE opportunities SET stage = CASE
  WHEN stage IN ('AGENDAMENTO_EM_ANDAMENTO','AGENDAMENTO_SOLICITADO') THEN 'WANTS_TO_BOOK'
  WHEN stage IN ('CONSIDERATION','consideração') THEN 'IN_CONVERSATION'
  WHEN stage='INTEREST' THEN 'QUALIFIED'
  ELSE stage END,
  next_best_action = CASE
    WHEN stage IN ('AGENDAMENTO_EM_ANDAMENTO','AGENDAMENTO_SOLICITADO') THEN 'REQUEST_HUMAN_CONFIRMATION'
    ELSE next_best_action END
WHERE NOT EXISTS (SELECT 1 FROM audit_events WHERE dedup_key='commercial_normalized_v2');

INSERT OR IGNORE INTO audit_events(id,event_type,actor_type,metadata_json,dedup_key,created_at)
VALUES('commercial-normalization-v2','commercial_normalized','SYSTEM','{}','commercial_normalized_v2',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
