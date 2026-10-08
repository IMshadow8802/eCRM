-- 103_qa_test_cleanup.sql — remove what the 2026-10-08 automated test runs left
-- behind for the inactive QA test users (Username 'qa[_]%' or FullName 'QA %'),
-- so it doesn't show in demo reports. The QA users themselves stay (inactive,
-- they have history). Demo data (Indian-named users, customers, tasks) is untouched.
-- eCRM+ only. Apply:
--   sqlcmd -S prdinfotech.in,1433 -U sa -d "eCRM+" -C -b -I -i sql/103_qa_test_cleanup.sql
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
GO

BEGIN TRAN;

DECLARE @Qa TABLE (Id INT PRIMARY KEY);
INSERT INTO @Qa SELECT Id FROM dbo.tblUser
 WHERE IsActive = 0 AND (Username LIKE 'qa[_]%' OR FullName LIKE 'QA %');

DECLARE @Tat TABLE (Id BIGINT PRIMARY KEY);
INSERT INTO @Tat SELECT Id FROM dbo.tblTaskTat WHERE UserId IN (SELECT Id FROM @Qa);

DELETE FROM dbo.tblTaskTatEvent WHERE TatId IN (SELECT Id FROM @Tat);
DELETE FROM dbo.tblTaskTatHold  WHERE TatId IN (SELECT Id FROM @Tat);
DELETE FROM dbo.tblTaskTat      WHERE Id    IN (SELECT Id FROM @Tat);

DELETE FROM dbo.tblPresenceDay WHERE UserId IN (SELECT Id FROM @Qa);
DELETE FROM dbo.tblUserDayMark WHERE UserId IN (SELECT Id FROM @Qa);
DELETE FROM dbo.tblUserSession WHERE UserId IN (SELECT Id FROM @Qa);
DELETE FROM dbo.tblNotifications
 WHERE UserId IN (SELECT Id FROM @Qa)
    OR (Type LIKE 'presence_%' AND EntityType = 'user' AND EntityId IN (SELECT Id FROM @Qa));

DELETE FROM dbo.tblCustomer
 WHERE Name LIKE 'QA %'
   AND NOT EXISTS (SELECT 1 FROM dbo.tblTicket t WHERE t.CustomerId = tblCustomer.Id);

COMMIT;
GO

-- VERIFY AFTER APPLY (expect 0 / 0 / 0 / 0):
-- SELECT (SELECT COUNT(*) FROM tblTaskTat t JOIN tblUser u ON u.Id=t.UserId WHERE u.Username LIKE 'qa[_]%' OR u.FullName LIKE 'QA %') AS QaClocks,
--        (SELECT COUNT(*) FROM tblPresenceDay p JOIN tblUser u ON u.Id=p.UserId WHERE u.Username LIKE 'qa[_]%' OR u.FullName LIKE 'QA %') AS QaPresence,
--        (SELECT COUNT(*) FROM tblUserSession s JOIN tblUser u ON u.Id=s.UserId WHERE u.Username LIKE 'qa[_]%' OR u.FullName LIKE 'QA %') AS QaSessions,
--        (SELECT COUNT(*) FROM tblCustomer WHERE Name LIKE 'QA %') AS QaCustomers;
