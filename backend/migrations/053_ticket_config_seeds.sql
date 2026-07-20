-- ============================================================================
-- 053_ticket_config_seeds.sql
--
-- Per-company config seeds so a fresh company works out of the box:
--   1. Default TICKET pipeline "Support" for every company that has no active
--      ticket pipeline, with stages New / In Progress / Resolved / Closed /
--      Rejected. Resolved + Closed are StageType='won' — Closed carries the
--      highest SortOrder, so sp_MoveTicketStage treats it as the final
--      (customer-confirmed) won stage; Rejected is 'lost'.
--   2. Default LEAD pipeline "Sales" for every company that has no active
--      lead pipeline (verified missing for fresh companies — only CompId=1
--      is seeded today).
--   3. Default lookups: Kind='resolution' (required by sp_ResolveTicket /
--      sp_MoveTicketStage on entry into any won stage), plus 'priority' and
--      'ticket_category' which the ticket forms/filters rely on.
--
-- Company universe: this DB has NO company master table — companies are the
-- DISTINCT CompId values on dbo.tblUser.
--
-- Idempotent: pipelines are guarded by "no active pipeline for that entity",
-- stages by "pipeline has no stages yet", lookups by (CompId, Kind, Value)
-- NOT EXISTS (case-insensitive collation, so "Won't Fix" blocks "Won't fix").
-- Safe to re-run. Existing custom pipelines/stages are never touched.
-- ============================================================================
SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRAN;

-- ---------------------------------------------------------------------------
-- 1a. Ticket pipeline per company
-- ---------------------------------------------------------------------------
INSERT INTO dbo.tblPipeline (CompId, Entity, Name, IsDefault, IsActive)
SELECT c.CompId, 'ticket', N'Support', 1, 1
FROM (SELECT DISTINCT CompId FROM dbo.tblUser WHERE CompId IS NOT NULL) c
WHERE NOT EXISTS (
    SELECT 1 FROM dbo.tblPipeline p
    WHERE p.CompId = c.CompId AND p.Entity = 'ticket' AND p.IsActive = 1
);

-- 1b. Stages for any active ticket pipeline that has none yet
INSERT INTO dbo.tblPipelineStage (CompId, PipelineId, Name, SortOrder, StageType, Color, IsActive)
SELECT p.CompId, p.Id, s.Name, s.SortOrder, s.StageType, s.Color, 1
FROM dbo.tblPipeline p
CROSS APPLY (VALUES
    (N'New',         1, 'open', N'#3B82F6'),
    (N'In Progress', 2, 'open', N'#F59E0B'),
    (N'Resolved',    3, 'won',  N'#10B981'),
    (N'Closed',      4, 'won',  N'#059669'),  -- highest won SortOrder = final/closed
    (N'Rejected',    5, 'lost', N'#EF4444')
) s (Name, SortOrder, StageType, Color)
WHERE p.Entity = 'ticket' AND p.IsActive = 1
  AND NOT EXISTS (SELECT 1 FROM dbo.tblPipelineStage st WHERE st.PipelineId = p.Id);

-- ---------------------------------------------------------------------------
-- 2a. Lead pipeline per company
-- ---------------------------------------------------------------------------
INSERT INTO dbo.tblPipeline (CompId, Entity, Name, IsDefault, IsActive)
SELECT c.CompId, 'lead', N'Sales', 1, 1
FROM (SELECT DISTINCT CompId FROM dbo.tblUser WHERE CompId IS NOT NULL) c
WHERE NOT EXISTS (
    SELECT 1 FROM dbo.tblPipeline p
    WHERE p.CompId = c.CompId AND p.Entity = 'lead' AND p.IsActive = 1
);

-- 2b. Stages for any active lead pipeline that has none yet
INSERT INTO dbo.tblPipelineStage (CompId, PipelineId, Name, SortOrder, StageType, Color, IsActive)
SELECT p.CompId, p.Id, s.Name, s.SortOrder, s.StageType, s.Color, 1
FROM dbo.tblPipeline p
CROSS APPLY (VALUES
    (N'New',         1, 'open', N'#3B82F6'),
    (N'Contacted',   2, 'open', N'#6366F1'),
    (N'Qualified',   3, 'open', N'#8B5CF6'),
    (N'Proposal',    4, 'open', N'#F59E0B'),
    (N'Won',         5, 'won',  N'#10B981'),
    (N'Lost',        6, 'lost', N'#EF4444')
) s (Name, SortOrder, StageType, Color)
WHERE p.Entity = 'lead' AND p.IsActive = 1
  AND NOT EXISTS (SELECT 1 FROM dbo.tblPipelineStage st WHERE st.PipelineId = p.Id);

-- ---------------------------------------------------------------------------
-- 3. Ticket lookups per company (resolution / priority / ticket_category)
-- ---------------------------------------------------------------------------
INSERT INTO dbo.tblLookup (CompId, Kind, Value, SortOrder, IsActive)
SELECT c.CompId, v.Kind, v.Value, v.SortOrder, 1
FROM (SELECT DISTINCT CompId FROM dbo.tblUser WHERE CompId IS NOT NULL) c
CROSS APPLY (VALUES
    ('resolution',      N'Fixed',               1),
    ('resolution',      N'Workaround provided', 2),
    ('resolution',      N'Not reproducible',    3),
    ('resolution',      N'Duplicate',           4),
    ('resolution',      N'Won''t fix',          5),
    ('priority',        N'Low',                 1),
    ('priority',        N'Medium',              2),
    ('priority',        N'High',                3),
    ('priority',        N'Urgent',              4),
    ('ticket_category', N'General',             1),
    ('ticket_category', N'Billing',             2),
    ('ticket_category', N'Technical',           3)
) v (Kind, Value, SortOrder)
WHERE NOT EXISTS (
    SELECT 1 FROM dbo.tblLookup l
    WHERE l.CompId = c.CompId AND l.Kind = v.Kind AND l.Value = v.Value
);

COMMIT TRAN;

-- ============================================================================
-- VERIFY AFTER APPLY
-- ============================================================================
-- 1. One active pipeline per company per entity, each with stages; ticket
--    pipelines must have a final won stage (HasWon=1) or sp_ResolveTicket
--    fails with "Pipeline has no resolved stage". Expect no zero counts.
SELECT p.CompId, p.Entity, p.Name,
       COUNT(st.Id)                                            AS StageCount,
       MAX(CASE WHEN st.StageType = 'won'  THEN 1 ELSE 0 END)  AS HasWon,
       MAX(CASE WHEN st.StageType = 'lost' THEN 1 ELSE 0 END)  AS HasLost
FROM dbo.tblPipeline p
LEFT JOIN dbo.tblPipelineStage st ON st.PipelineId = p.Id AND st.IsActive = 1
WHERE p.IsActive = 1
GROUP BY p.CompId, p.Entity, p.Name
ORDER BY p.CompId, p.Entity;

-- 2. Lookup coverage per company — expect resolution >= 5, priority >= 4,
--    ticket_category >= 3 for every CompId in tblUser.
SELECT CompId, Kind, COUNT(*) AS N
FROM dbo.tblLookup
WHERE Kind IN ('resolution', 'priority', 'ticket_category') AND IsActive = 1
GROUP BY CompId, Kind
ORDER BY CompId, Kind;

-- 3. Smoke-test the resolve path (rolled back — leaves no trace). Picks any
--    existing ticket; expect the SP result row to show ResponseCode = 200.
--    (If no tickets exist yet it just prints a notice.)
BEGIN TRAN;
DECLARE @t INT, @c INT, @u INT, @r INT;
SELECT TOP 1 @t = Id, @c = CompId FROM dbo.tblTicket;
IF @t IS NULL
    PRINT 'No tickets yet — resolve smoke test skipped.';
ELSE
BEGIN
    SELECT TOP 1 @u = Id FROM dbo.tblUser  WHERE CompId = @c;
    SELECT TOP 1 @r = Id FROM dbo.tblLookup
     WHERE CompId = @c AND Kind = 'resolution' AND IsActive = 1 ORDER BY SortOrder;
    EXEC dbo.sp_ResolveTicket @CompId = @c, @TicketId = @t, @ResolutionId = @r, @UserId = @u;
END
ROLLBACK TRAN;
