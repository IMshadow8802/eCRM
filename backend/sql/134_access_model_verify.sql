-- ===========================================================================
-- 134 - access model: cleanup, the check query, the old-vs-new comparison.
--       (spec docs/superpowers/specs/2026-11-21-access-model/design.md
--        sections 10 and 13.1; plan 2026-11-22-access-model Task 6;
--        pre-flight S3, S13, S18)
--
-- Apply by hand:  sqlcmd -I -b ... -i 134_access_model_verify.sql
--   -I = QUOTED_IDENTIFIER ON (093 lesson), -b = stop at the first error.
-- Needs 130-133 on the same database, in the same sitting (plan Ruling 1);
-- 134 refuses otherwise (and SETs NOEXEC ON). Undone by
-- 135_access_model_rollback.sql -v From=134 (the two dropped procs come back
-- from tblAccessModelBackup).
--
-- Steps:
--   1. Refuse unless 133 is applied (fn_ReassignGate,
--      sp_FetchTicketEscalationTargets, CK_tblTicket_LoggerHolds) and 130's
--      snapshot holds rows.
--   2. Save, then drop sp_LeadsUserWise and sp_ConvertedSummary (no caller in
--      backend / web / mobile; both read tblLeads outside the definitions and
--      sp_ConvertedSummary still takes a list parameter). A re-run skips them.
--   3. The check query (spec 10; pasted into backend/ROLES.md in Task 34).
--      Must return no rows. "Reads through the definitions" = the text names
--      fn_Visible*, fn_AssignableUsers, or one of the three functions built
--      on them: fn_RecordActions (detail procs, sp_SetTicketStatus),
--      fn_ReassignGate (the four reassign procs), fn_SalesReportRows
--      (sp_RptSalesRows). Naming them, rather than allow-listing their
--      callers, keeps a rolled-back caller visible to the check.
--      Allow-list = plan "Recorded facts" + fn_RecordGiver, fn_StrandedWork,
--      sp_NotifyStranded, sp_AccessModelBackup + (pre-flight S3)
--      sp_SetTicketStatus, sp_EscalateTicket: id-addressed writes, the record
--      gated by Node and the scope functions.
--   4. The comparison run (spec 13.1). For every active user and kind:
--        new  ticket     fn_VisibleTickets (joined to status + customer, as
--                        sp_FetchTickets)
--             lead       fn_VisibleLeads (joined to status, as sp_FetchLeads)
--             followup   fn_VisibleFollowUps WHERE Via IN (1, 2)
--             custticket fn_VisibleTickets per customer
--        old  tblAccessModelSnapshot (130).
--      custticket, both sides: only customers the user can open by the
--      customers rule, which this batch does not change (pre-flight S13).
--      Every difference falls into exactly one bucket, first match wins:
--        +logged_by_my_people            gained; LoggerHolds = 1 and
--                                        CreatedBy in fn_AccessPeople
--        +held_by_my_people_other_office gained; holder in fn_AccessPeople
--        +escalated_to_me                gained; EscalatedTo = user, in progress
--        +wider_includes_narrower        gained; office covered by the reach
--        -unassigned_was_assigned        lost; unassigned, LoggerHolds = 0,
--                                        CreatedBy = user
--        -no_module                      lost; user has no View on the module
--        other                           anything else - MUST BE 0
--      A follow-up is classified by its lead. Prints bucket, kind, people,
--      records (every bucket, zero rows included), then up to 500 detail rows
--      for the owner to read at G1.
--   5. Raises an error when the check query returns a row or bucket `other`
--      is not 0.
--
-- Expected (bucket: kind people / records):
--   TestCRM (dry run 2026-11-22, 130-133 simulated read-only):
--     +logged_by_my_people             lead 1 / 5 (tl_ho_neha: leads 623-627,
--                                      logged by se_ho_amit);
--                                      followup 1 / 5 (one on each)
--     +held_by_my_people_other_office  lead 2 / 2 (bm_se_vikram: lead 649,
--                                      se_se_pooja's, office 1; demo_bm_ip_meera:
--                                      lead 1685, demo_se_ip_isha's, office 1);
--                                      followup 2 / 2
--     +escalated_to_me                 0 (the 17 escalations to tl_ho_neha
--                                      are cleared by 130 N3; vikram.rao's
--                                      one is already visible at Company)
--     +wider_includes_narrower         0
--     -unassigned_was_assigned         lead 1 / 1 (se_ho_karan: lead 10);
--                                      followup 1 / 1
--     -no_module                       custticket 1 / 22 (se_ho_amit: the 21
--                                      complaints he holds + 1 he logged,
--                                      no complaints module)
--     other                            0
--   eCRM+: +logged_by_my_people 5 leads / 1 person, -unassigned_was_assigned
--     1 lead / 1 person, -no_module 3 complaints / 1 person, rest 0
--     (follow-up and customer-page rows on top, as for TestCRM).
--   SolarCRM, OSG: every bucket 0.
--
-- sqlcmd splits on GO even inside comments: every note is a `--` line comment.
-- ===========================================================================
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

-- ---------------------------------------------------------------------------
-- 1. Refuse unless 133 is applied and the snapshot exists (S18).
-- ---------------------------------------------------------------------------
IF OBJECT_ID('dbo.sp_AccessModelBackup', 'P') IS NULL
   OR OBJECT_ID('dbo.tblAccessModelSnapshot', 'U') IS NULL
   OR OBJECT_ID('dbo.fn_VisibleTickets') IS NULL
   OR OBJECT_ID('dbo.sp_FetchLoggedByMe', 'P') IS NULL
   OR OBJECT_ID('dbo.fn_ReassignGate') IS NULL
   OR OBJECT_ID('dbo.sp_FetchTicketEscalationTargets', 'P') IS NULL
   OR NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_tblTicket_LoggerHolds')
BEGIN
    RAISERROR('134: script 133 is not applied to this database. Apply 130-133 first. Nothing was changed.', 16, 1);
    SET NOEXEC ON;
END
GO

-- An empty snapshot is fine when the company has no records at all (OSG, 2026-11-24).
IF NOT EXISTS (SELECT 1 FROM dbo.tblAccessModelSnapshot)
   AND (EXISTS (SELECT 1 FROM dbo.tblLeads) OR EXISTS (SELECT 1 FROM dbo.tblTicket) OR EXISTS (SELECT 1 FROM dbo.tblFollowUp))
BEGIN
    RAISERROR('134: tblAccessModelSnapshot is empty (130 step 10 did not run). Nothing was changed.', 16, 1);
    SET NOEXEC ON;
END
GO

-- ---------------------------------------------------------------------------
-- 2. Cleanup: save, then drop. A re-run finds them gone and skips.
-- ---------------------------------------------------------------------------
IF OBJECT_ID('dbo.sp_LeadsUserWise', 'P') IS NOT NULL
BEGIN
    EXEC dbo.sp_AccessModelBackup 134, 'sp_LeadsUserWise';
    DROP PROCEDURE dbo.sp_LeadsUserWise;
    PRINT '134: sp_LeadsUserWise dropped (saved for 135)';
END
IF OBJECT_ID('dbo.sp_ConvertedSummary', 'P') IS NOT NULL
BEGIN
    EXEC dbo.sp_AccessModelBackup 134, 'sp_ConvertedSummary';
    DROP PROCEDURE dbo.sp_ConvertedSummary;
    PRINT '134: sp_ConvertedSummary dropped (saved for 135)';
END
GO

-- ---------------------------------------------------------------------------
-- 3 + 4 + 5. Check query, comparison run, verdict (one batch: temp tables).
-- ---------------------------------------------------------------------------
SET NOCOUNT ON;

-- 3. Check query. Must return no rows.
CREATE TABLE #Chk (ObjName SYSNAME NOT NULL, Problem VARCHAR(80) NOT NULL);
INSERT INTO #Chk (ObjName, Problem)
SELECT o.name, 'reads leads/complaints/follow-ups outside the definitions' AS problem
FROM sys.sql_modules m JOIN sys.objects o ON o.object_id = m.object_id
WHERE (m.definition LIKE '%tblTicket%' OR m.definition LIKE '%tblLeads%' OR m.definition LIKE '%tblFollowUp%')
  AND m.definition NOT LIKE '%fn_Visible%' AND m.definition NOT LIKE '%fn_AssignableUsers%'
  AND m.definition NOT LIKE '%fn_RecordActions%' AND m.definition NOT LIKE '%fn_ReassignGate%'
  AND m.definition NOT LIKE '%fn_SalesReportRows%'
  AND o.name NOT LIKE 'fn_Visible%' AND o.name NOT LIKE 'fn_Access%'
  AND o.name NOT IN ('sp_FetchTicketDue', 'sp_FetchCommissions', 'sp_FetchPartners', 'sp_SyncPartnerCommission',
                     'sp_FetchUserHandover', 'sp_DeleteUser', 'sp_DeleteCustomer', 'sp_DeleteLead',
                     'sp_DeleteTicket', 'sp_DeleteFollowUp', 'sp_SetLeadStatus', 'sp_ConvertLead', 'sp_LogCall',
                     'sp_LogTicketActivity', 'sp_CompleteFollowUp', 'sp_SkipFollowUp',
                     'sp_RefreshLeadNextFollowup', 'sp_SaveQuotation', 'sp_FinaliseQuotation',
                     'sp_ReviseQuotation', 'sp_SaveLeadSource', 'sp_FetchLeadSource', 'sp_DeleteLeadSource',
                     'fn_RecordGiver', 'fn_StrandedWork', 'sp_NotifyStranded', 'sp_AccessModelBackup',
                     'sp_SetTicketStatus', 'sp_EscalateTicket',
                     'sp_LoggerMayAttach')   -- 139: logger upload window, never a read
UNION ALL
SELECT o.name, 'still takes a list parameter'
FROM sys.parameters p JOIN sys.objects o ON o.object_id = p.object_id
WHERE p.name IN ('@AccessibleBranchIdsJson','@OwnerIdsJson','@BranchIdsJson','@TicketBranchIdsJson','@TicketOwnerIdsJson','@EscalatedSubtreeJson')
  AND o.name NOT IN ('sp_FetchCustomers', 'sp_FetchVisitingCards', 'sp_SaveVisitingCard', 'sp_DeleteVisitingCard',
                     'sp_FetchActivityLog', 'sp_FetchKanbanColumn', 'sp_FetchProject', 'sp_FetchTask',
                     'sp_FetchTeam', 'sp_FetchTimeEntry', 'sp_FetchUser', 'sp_FetchWorkspaces');

SELECT DISTINCT 'check query' AS List, ObjName, Problem FROM #Chk ORDER BY ObjName, Problem;

-- 4. Comparison run.
CREATE TABLE #U (UserId INT PRIMARY KEY, CompId BIGINT NOT NULL, Username NVARCHAR(100) NULL);
INSERT INTO #U (UserId, CompId, Username)
SELECT Id, CompId, Username FROM dbo.tblUser WHERE IsActive = 1;

-- View + reach per (user, module); no row = no View.
CREATE TABLE #G (UserId INT NOT NULL, Module VARCHAR(20) NOT NULL, RL TINYINT NOT NULL, Home BIGINT NULL,
                 PRIMARY KEY (UserId, Module));
INSERT INTO #G (UserId, Module, RL, Home)
SELECT u.UserId, s.Module, ISNULL(s.ReachLevel, 1), s.HomeBranchId
FROM #U u
CROSS JOIN (VALUES ('leads'), ('complaints'), ('customers')) mo (Module)
CROSS APPLY dbo.fn_AccessScope(u.CompId, u.UserId, mo.Module) s;

CREATE TABLE #P (UserId INT NOT NULL, PersonId INT NOT NULL, PRIMARY KEY (UserId, PersonId));
INSERT INTO #P (UserId, PersonId)
SELECT u.UserId, p.UserId FROM #U u CROSS APPLY dbo.fn_AccessPeople(u.CompId, u.UserId) p;

CREATE TABLE #O (UserId INT NOT NULL, BranchId BIGINT NOT NULL, Level TINYINT NOT NULL, PRIMARY KEY (UserId, BranchId));
INSERT INTO #O (UserId, BranchId, Level)
SELECT u.UserId, o.BranchId, o.Level FROM #U u CROSS APPLY dbo.fn_AccessOffices(u.CompId, u.UserId) o;

-- Customers the user can open, by the unchanged customers rule (S13):
-- creator, or office in the reach's list and (Own / Team) creator in the
-- owner list. Own = [home] / [me]; Team = home + people's homes / me + people;
-- Office = Level 3; OfficeTree = Level 3 + 4; Company = every customer.
CREATE TABLE #Cust (UserId INT NOT NULL, CustomerId INT NOT NULL, PRIMARY KEY (UserId, CustomerId));
INSERT INTO #Cust (UserId, CustomerId)
SELECT g.UserId, c.Id
FROM #G g
JOIN #U u              ON u.UserId = g.UserId
JOIN dbo.tblCustomer c ON c.CompId = u.CompId
WHERE g.Module = 'customers'
  AND (   g.RL = 5
       OR c.CreatedBy = g.UserId
       OR (g.RL IN (3, 4) AND EXISTS (SELECT 1 FROM #O o WHERE o.UserId = g.UserId AND o.BranchId = c.BranchId
                                                         AND (o.Level = 3 OR g.RL = 4)))
       OR (g.RL = 2 AND EXISTS (SELECT 1 FROM #P p WHERE p.UserId = g.UserId AND p.PersonId = c.CreatedBy)
                    AND (c.BranchId = g.Home
                         OR EXISTS (SELECT 1 FROM #P p JOIN dbo.tblUser x ON x.Id = p.PersonId
                                    WHERE p.UserId = g.UserId AND x.BranchId = c.BranchId))));

CREATE TABLE #New (Kind VARCHAR(12) NOT NULL, UserId INT NOT NULL, RecordId INT NOT NULL, PRIMARY KEY (Kind, UserId, RecordId));
INSERT INTO #New (Kind, UserId, RecordId)
SELECT 'ticket', u.UserId, t.Id
FROM #U u
CROSS APPLY dbo.fn_VisibleTickets(u.CompId, u.UserId) v
JOIN dbo.tblTicket t   ON t.Id = v.TicketId
JOIN dbo.tblLookup st  ON st.Id = t.StatusId
JOIN dbo.tblCustomer c ON c.Id = t.CustomerId;

INSERT INTO #New (Kind, UserId, RecordId)
SELECT 'custticket', n.UserId, n.RecordId
FROM #New n
JOIN dbo.tblTicket t ON t.Id = n.RecordId
JOIN #Cust cu        ON cu.UserId = n.UserId AND cu.CustomerId = t.CustomerId
WHERE n.Kind = 'ticket';

INSERT INTO #New (Kind, UserId, RecordId)
SELECT 'lead', u.UserId, l.Id
FROM #U u
CROSS APPLY dbo.fn_VisibleLeads(u.CompId, u.UserId) v
JOIN dbo.tblLeads l   ON l.Id = v.LeadId
JOIN dbo.tblLookup st ON st.Id = l.StatusId;

INSERT INTO #New (Kind, UserId, RecordId)
SELECT 'followup', u.UserId, f.Id
FROM #U u
CROSS APPLY dbo.fn_VisibleFollowUps(u.CompId, u.UserId) v
JOIN dbo.tblFollowUp f ON f.Id = v.FollowUpId
JOIN dbo.tblLeads l    ON l.Id = f.LeadId AND l.CompId = f.CompId
JOIN dbo.tblLookup st  ON st.Id = l.StatusId
WHERE v.Via IN (1, 2);

CREATE TABLE #Old (Kind VARCHAR(12) NOT NULL, UserId INT NOT NULL, RecordId INT NOT NULL, PRIMARY KEY (Kind, UserId, RecordId));
INSERT INTO #Old (Kind, UserId, RecordId)
SELECT s.Kind, s.UserId, s.RecordId
FROM dbo.tblAccessModelSnapshot s
JOIN #U u ON u.UserId = s.UserId
WHERE s.Kind <> 'custticket'
   OR EXISTS (SELECT 1 FROM dbo.tblTicket t JOIN #Cust cu ON cu.UserId = s.UserId AND cu.CustomerId = t.CustomerId
              WHERE t.Id = s.RecordId);

-- Differences with the record's facts (a follow-up carries its lead's).
CREATE TABLE #D (Dir CHAR(1) NOT NULL, Kind VARCHAR(12) NOT NULL, UserId INT NOT NULL, RecordId INT NOT NULL,
                 Module VARCHAR(20) NOT NULL, Assigned INT NULL, LoggerHolds BIT NULL, CreatedBy INT NULL,
                 BranchId BIGINT NULL, EscalatedTo INT NULL, InProgress BIT NOT NULL, Bucket VARCHAR(40) NULL);
INSERT INTO #D (Dir, Kind, UserId, RecordId, Module, InProgress)
SELECT '+', n.Kind, n.UserId, n.RecordId, CASE WHEN n.Kind IN ('ticket', 'custticket') THEN 'complaints' ELSE 'leads' END, 0
FROM #New n WHERE NOT EXISTS (SELECT 1 FROM #Old o WHERE o.Kind = n.Kind AND o.UserId = n.UserId AND o.RecordId = n.RecordId)
UNION ALL
SELECT '-', o.Kind, o.UserId, o.RecordId, CASE WHEN o.Kind IN ('ticket', 'custticket') THEN 'complaints' ELSE 'leads' END, 0
FROM #Old o WHERE NOT EXISTS (SELECT 1 FROM #New n WHERE n.Kind = o.Kind AND n.UserId = o.UserId AND n.RecordId = o.RecordId);

UPDATE d SET Assigned = t.AssignedTo, LoggerHolds = t.LoggerHolds, CreatedBy = t.CreatedBy, BranchId = t.BranchId,
             EscalatedTo = t.EscalatedTo, InProgress = CASE WHEN st.Code IN ('open', 'onhold') THEN 1 ELSE 0 END
FROM #D d JOIN dbo.tblTicket t ON t.Id = d.RecordId LEFT JOIN dbo.tblLookup st ON st.Id = t.StatusId
WHERE d.Module = 'complaints';

UPDATE d SET Assigned = l.OwnerId, LoggerHolds = l.LoggerHolds, CreatedBy = l.CreatedBy, BranchId = l.BranchId
FROM #D d JOIN dbo.tblLeads l ON l.Id = d.RecordId
WHERE d.Kind = 'lead';

UPDATE d SET Assigned = l.OwnerId, LoggerHolds = l.LoggerHolds, CreatedBy = l.CreatedBy, BranchId = l.BranchId
FROM #D d JOIN dbo.tblFollowUp f ON f.Id = d.RecordId JOIN dbo.tblLeads l ON l.Id = f.LeadId AND l.CompId = f.CompId
WHERE d.Kind = 'followup';

UPDATE d SET Bucket =
    CASE
      WHEN d.Dir = '+' AND d.LoggerHolds = 1
           AND EXISTS (SELECT 1 FROM #P p WHERE p.UserId = d.UserId AND p.PersonId = d.CreatedBy)
        THEN '+logged_by_my_people'
      WHEN d.Dir = '+'
           AND EXISTS (SELECT 1 FROM #P p WHERE p.UserId = d.UserId
                       AND p.PersonId = COALESCE(d.Assigned, CASE WHEN d.LoggerHolds = 1 THEN d.CreatedBy END))
        THEN '+held_by_my_people_other_office'
      WHEN d.Dir = '+' AND d.Module = 'complaints' AND d.EscalatedTo = d.UserId AND d.InProgress = 1
        THEN '+escalated_to_me'
      WHEN d.Dir = '+'
           AND EXISTS (SELECT 1 FROM #G g WHERE g.UserId = d.UserId AND g.Module = d.Module
                       AND (g.RL = 5
                            OR (g.RL IN (3, 4) AND EXISTS (SELECT 1 FROM #O o WHERE o.UserId = d.UserId
                                                           AND o.BranchId = d.BranchId AND (o.Level = 3 OR g.RL = 4)))))
        THEN '+wider_includes_narrower'
      WHEN d.Dir = '-' AND d.Assigned IS NULL AND d.LoggerHolds = 0 AND d.CreatedBy = d.UserId
        THEN '-unassigned_was_assigned'
      WHEN d.Dir = '-' AND NOT EXISTS (SELECT 1 FROM #G g WHERE g.UserId = d.UserId AND g.Module = d.Module)
        THEN '-no_module'
      ELSE 'other'
    END
FROM #D d;

SELECT b.Bucket AS bucket, ISNULL(d.Kind, '-') AS kind,
       COUNT(DISTINCT d.UserId) AS people, COUNT(d.RecordId) AS records
FROM (VALUES (1, '+logged_by_my_people'), (2, '+held_by_my_people_other_office'), (3, '+escalated_to_me'),
             (4, '+wider_includes_narrower'), (5, '-unassigned_was_assigned'), (6, '-no_module'), (7, 'other')) b (Ord, Bucket)
LEFT JOIN #D d ON d.Bucket = b.Bucket
GROUP BY b.Ord, b.Bucket, d.Kind
ORDER BY b.Ord, kind;

SELECT TOP (500) d.Bucket, d.Kind, d.UserId, u.Username, d.RecordId, d.Assigned, d.CreatedBy, d.BranchId, d.LoggerHolds
FROM #D d JOIN #U u ON u.UserId = d.UserId
ORDER BY CASE WHEN d.Bucket = 'other' THEN 0 ELSE 1 END, d.Bucket, d.Kind, d.UserId, d.RecordId;

-- 5. Verdict.
DECLARE @chk INT = (SELECT COUNT(*) FROM #Chk), @other INT = (SELECT COUNT(*) FROM #D WHERE Bucket = 'other');

DROP TABLE #D; DROP TABLE #Old; DROP TABLE #New; DROP TABLE #Cust; DROP TABLE #O; DROP TABLE #P; DROP TABLE #G;
DROP TABLE #U; DROP TABLE #Chk;

IF @chk > 0
    RAISERROR('134: the check query returned %d row(s) - do not build the server', 16, 1, @chk);
IF @other > 0
    RAISERROR('134: unexplained visibility difference - do not build the server', 16, 1);
IF @chk = 0 AND @other = 0
    PRINT '134: check query empty, bucket other = 0';
GO

SET NOEXEC OFF;
GO

-- ===========================================================================
-- Verify after apply.
--
-- 1. The run itself: no error, the "check query" set is empty, the bucket
--    table matches the header's expected counts (TestCRM column filled from
--    this run at G1; the owner reads every non-zero row in the detail set).
--
-- 2. Both procedures gone and saved for 135  -> 0, then 2
-- SELECT COUNT(*) FROM sys.objects WHERE name IN ('sp_LeadsUserWise', 'sp_ConvertedSummary');
-- SELECT COUNT(*) FROM dbo.tblAccessModelBackup
-- WHERE ScriptNo = 134 AND ObjName IN ('sp_LeadsUserWise', 'sp_ConvertedSummary') AND Definition IS NOT NULL;
--
-- 3. Re-run is safe: applying 134 again prints no "dropped" line, returns the
--    same bucket table (the comparison reads, it never writes).
-- ===========================================================================
