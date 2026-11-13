-- Every store keeps an Owner (see config/d1/tournaments.sql). Approvals
-- once made an organizer a Manager and a judge Staff, leaving their stores
-- with no Owner; each such store's earliest member becomes it. A store with
-- no members stays orphaned, open to apply for. Run once, after 0041.

UPDATE store_members SET role = 'owner'
WHERE user_id = (
  SELECT m.user_id FROM store_members m
  WHERE m.store_id = store_members.store_id
  ORDER BY m.added_at, m.user_id LIMIT 1
)
AND NOT EXISTS (
  SELECT 1 FROM store_members o WHERE o.store_id = store_members.store_id AND o.role = 'owner'
);
