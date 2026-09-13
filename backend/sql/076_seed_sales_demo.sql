-- ============================================================================
-- 076_seed_sales_demo.sql   (DEMO DATA — deterministic, backdated, removable)
--
-- The API stamps GETDATE() on everything, so a trend needs history it cannot
-- create. This seeds 180 days of it: 600 leads, their status history, 2-6
-- follow-ups each, transfers — every value an integer function of a row
-- number (spec §6), so re-running produces identical rows. No random functions.
--
-- Idempotent: deletes Name LIKE 'DEMO %' (and children) and Name LIKE 'DEMO %'
-- products first; demo users are inserted IF NOT EXISTS (their Ids stay put,
-- so the logins keep working). 077 removes it all, users included.
--
-- Nothing it writes lands in the future: lead Age is 1..180 days and every
-- derived offset is clamped to Age-1, so the batch is safe to apply at any
-- hour of the day.
--
-- Requires 075 applied and the 2026-09-09 test users (sh_priya … se_se_dev).
-- APPLY BY HAND. One batch: a RAISERROR/RETURN aborts the whole seed.
-- Author: Claude  Date: 2026-09-10
-- ============================================================================
IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
GO
SET NOCOUNT ON;

DECLARE @CompId INT = 1;
DECLARE @Now    DATETIME = GETDATE();
DECLARE @Today  DATETIME = CAST(CAST(@Now AS DATE) AS DATETIME);

-- ---------------------------------------------------------------------------
-- 0. Guards + lookups resolved by name (ids differ per company)
-- ---------------------------------------------------------------------------
IF OBJECT_ID('dbo.tblLeadStatusHistory') IS NULL
BEGIN RAISERROR('076: apply 075_sales_reports.sql first', 16, 1); RETURN; END

DECLARE @Pwd VARCHAR(500) = (SELECT Password FROM dbo.tblUser WHERE Username = 'se_ho_amit' AND CompId = @CompId);
DECLARE @Priya INT = (SELECT Id FROM dbo.tblUser WHERE Username = 'sh_priya' AND CompId = @CompId);
IF @Pwd IS NULL OR @Priya IS NULL
BEGIN RAISERROR('076: test users from the 2026-09-09 live test are missing (se_ho_amit / sh_priya)', 16, 1); RETURN; END

DECLARE @stNew INT, @stContacted INT, @stFollowUp INT, @stQualified INT, @stLost INT, @stJunk INT;
SELECT @stNew       = MAX(CASE WHEN Value = N'New'       THEN Id END),
       @stContacted = MAX(CASE WHEN Value = N'Contacted' THEN Id END),
       @stFollowUp  = MAX(CASE WHEN Value = N'Follow-up' THEN Id END),
       @stQualified = MAX(CASE WHEN Value = N'Qualified' THEN Id END),
       @stLost      = MAX(CASE WHEN Value = N'Lost'      THEN Id END),
       @stJunk      = MAX(CASE WHEN Value = N'Junk'      THEN Id END)
FROM dbo.tblLookup WHERE CompId = @CompId AND Kind = 'lead_status';
IF @stNew IS NULL OR @stContacted IS NULL OR @stFollowUp IS NULL OR @stQualified IS NULL OR @stLost IS NULL OR @stJunk IS NULL
BEGIN RAISERROR('076: lead_status lookups New/Contacted/Follow-up/Qualified/Lost/Junk are required', 16, 1); RETURN; END

DECLARE @srcWebsite INT, @srcReferral INT, @srcWalkIn INT, @srcPhone INT, @srcSocial INT, @srcAd INT;
SELECT @srcWebsite  = MAX(CASE WHEN Value = N'Website'       THEN Id END),
       @srcReferral = MAX(CASE WHEN Value = N'Referral'      THEN Id END),
       @srcWalkIn   = MAX(CASE WHEN Value = N'Walk-in'       THEN Id END),
       @srcPhone    = MAX(CASE WHEN Value = N'Phone'         THEN Id END),
       @srcSocial   = MAX(CASE WHEN Value = N'Social Media'  THEN Id END),
       @srcAd       = MAX(CASE WHEN Value = N'Advertisement' THEN Id END)
FROM dbo.tblLookup WHERE CompId = @CompId AND Kind = 'lead_source';
IF @srcWebsite IS NULL OR @srcReferral IS NULL OR @srcWalkIn IS NULL OR @srcPhone IS NULL OR @srcSocial IS NULL OR @srcAd IS NULL
BEGIN RAISERROR('076: the six lead_source lookups are required', 16, 1); RETURN; END

DECLARE @lrPrice INT, @lrCompetitor INT, @lrBudget INT, @lrNotInterested INT, @lrNoResponse INT;
SELECT @lrPrice         = MAX(CASE WHEN Value = N'Price'            THEN Id END),
       @lrCompetitor    = MAX(CASE WHEN Value = N'Chose Competitor' THEN Id END),
       @lrBudget        = MAX(CASE WHEN Value = N'No Budget'        THEN Id END),
       @lrNotInterested = MAX(CASE WHEN Value = N'Not Interested'   THEN Id END),
       @lrNoResponse    = MAX(CASE WHEN Value = N'No Response'      THEN Id END)
FROM dbo.tblLookup WHERE CompId = @CompId AND Kind = 'lost_reason';
IF @lrPrice IS NULL OR @lrCompetitor IS NULL OR @lrBudget IS NULL OR @lrNotInterested IS NULL OR @lrNoResponse IS NULL
BEGIN RAISERROR('076: the five lost_reason lookups are required', 16, 1); RETURN; END

DECLARE @ocConnected INT, @ocNoAnswer INT, @ocBusy INT, @ocWrong INT, @ocCallback INT;
SELECT @ocConnected = MAX(CASE WHEN Value = N'Connected'          THEN Id END),
       @ocNoAnswer  = MAX(CASE WHEN Value = N'No Answer'          THEN Id END),
       @ocBusy      = MAX(CASE WHEN Value = N'Busy'               THEN Id END),
       @ocWrong     = MAX(CASE WHEN Value = N'Wrong Number'       THEN Id END),
       @ocCallback  = MAX(CASE WHEN Value = N'Callback Requested' THEN Id END)
FROM dbo.tblLookup WHERE CompId = @CompId AND Kind = 'call_outcome';
IF @ocConnected IS NULL OR @ocNoAnswer IS NULL OR @ocBusy IS NULL OR @ocWrong IS NULL OR @ocCallback IS NULL
BEGIN RAISERROR('076: the five call_outcome lookups are required', 16, 1); RETURN; END

DECLARE @trAbsent INT, @trOverloaded INT, @trWrongBranch INT, @trSentBack INT, @trReassigned INT, @trOther INT;
SELECT @trAbsent      = MAX(CASE WHEN Value = N'Absent'                THEN Id END),
       @trOverloaded  = MAX(CASE WHEN Value = N'Overloaded'            THEN Id END),
       @trWrongBranch = MAX(CASE WHEN Value = N'Wrong branch'          THEN Id END),
       @trSentBack    = MAX(CASE WHEN Value = N'Sent back to manager'  THEN Id END),
       @trReassigned  = MAX(CASE WHEN Value = N'Reassigned by manager' THEN Id END),
       @trOther       = MAX(CASE WHEN Value = N'Other'                 THEN Id END)
FROM dbo.tblLookup WHERE CompId = @CompId AND Kind = 'transfer_reason';
IF @trAbsent IS NULL OR @trOverloaded IS NULL OR @trWrongBranch IS NULL OR @trSentBack IS NULL OR @trReassigned IS NULL OR @trOther IS NULL
BEGIN RAISERROR('076: the six transfer_reason lookups are required', 16, 1); RETURN; END

DECLARE @catGeneral INT = (SELECT TOP 1 Id FROM dbo.tblLookup WHERE CompId = @CompId AND Kind = 'product_category' ORDER BY SortOrder, Id);
IF @catGeneral IS NULL
BEGIN RAISERROR('076: a product_category lookup is required', 16, 1); RETURN; END

-- ---------------------------------------------------------------------------
-- 1. Wipe a previous run
-- ---------------------------------------------------------------------------
DECLARE @Old TABLE (Id INT PRIMARY KEY);
INSERT INTO @Old SELECT Id FROM dbo.tblLeads WHERE CompId = @CompId AND Name COLLATE Latin1_General_CS_AS LIKE 'DEMO %';
DELETE FROM dbo.tblFollowUp          WHERE LeadId IN (SELECT Id FROM @Old);
DELETE FROM dbo.tblLeadAssignment    WHERE LeadId IN (SELECT Id FROM @Old);
DELETE FROM dbo.tblLeadStatusHistory WHERE LeadId IN (SELECT Id FROM @Old);
DELETE FROM dbo.tblLeadActivity      WHERE LeadId IN (SELECT Id FROM @Old);
DELETE FROM dbo.tblCustomFieldValue  WHERE CompId = @CompId AND Entity = 'lead' AND EntityId IN (SELECT Id FROM @Old);
DELETE FROM dbo.tblLeads             WHERE Id IN (SELECT Id FROM @Old);
DELETE FROM dbo.tblProduct WHERE CompId = @CompId AND Name COLLATE Latin1_General_CS_AS LIKE 'DEMO %';

-- ---------------------------------------------------------------------------
-- 2. Users — branch 3 (INDIRAPURAM): 1 BM + 3 execs. Password = Amit's hash.
--    Mobile/Avatar left NULL, as the 2026-09-09 test users are.
-- ---------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM dbo.tblUser WHERE Username = 'demo_bm_ip_meera')
    INSERT INTO dbo.tblUser (Username, Password, IsActive, IsAdmin, UserIp, AllowDay, FullName, Email, JobTitle, HourlyRate, CompId, BranchId, ReportsTo)
    VALUES ('demo_bm_ip_meera', @Pwd, 1, 0, '', 0, 'Meera Iyer (BM Indirapuram)', 'demo_bm_ip_meera@nexus.test', 'Branch Manager', 0, @CompId, 3, @Priya);
DECLARE @Meera INT = (SELECT Id FROM dbo.tblUser WHERE Username = 'demo_bm_ip_meera');

IF NOT EXISTS (SELECT 1 FROM dbo.tblUser WHERE Username = 'demo_se_ip_rohan')
    INSERT INTO dbo.tblUser (Username, Password, IsActive, IsAdmin, UserIp, AllowDay, FullName, Email, JobTitle, HourlyRate, CompId, BranchId, ReportsTo)
    VALUES ('demo_se_ip_rohan', @Pwd, 1, 0, '', 0, 'Rohan Das (Exec Indirapuram)', 'demo_se_ip_rohan@nexus.test', 'Sales Executive', 0, @CompId, 3, @Meera);
IF NOT EXISTS (SELECT 1 FROM dbo.tblUser WHERE Username = 'demo_se_ip_isha')
    INSERT INTO dbo.tblUser (Username, Password, IsActive, IsAdmin, UserIp, AllowDay, FullName, Email, JobTitle, HourlyRate, CompId, BranchId, ReportsTo)
    VALUES ('demo_se_ip_isha', @Pwd, 1, 0, '', 0, 'Isha Bose (Exec Indirapuram)', 'demo_se_ip_isha@nexus.test', 'Sales Executive', 0, @CompId, 3, @Meera);
IF NOT EXISTS (SELECT 1 FROM dbo.tblUser WHERE Username = 'demo_se_ip_kabir')
    INSERT INTO dbo.tblUser (Username, Password, IsActive, IsAdmin, UserIp, AllowDay, FullName, Email, JobTitle, HourlyRate, CompId, BranchId, ReportsTo)
    VALUES ('demo_se_ip_kabir', @Pwd, 1, 0, '', 0, 'Kabir Malhotra (Exec Indirapuram)', 'demo_se_ip_kabir@nexus.test', 'Sales Executive', 0, @CompId, 3, @Meera);

-- Group membership: 13 = Branch Manager, 16 = Sales Executive (tblUser has no GroupId)
INSERT INTO dbo.tblUserGroupMap (UserId, GroupId)
SELECT u.Id, CASE WHEN u.Username = 'demo_bm_ip_meera' THEN 13 ELSE 16 END
FROM dbo.tblUser u
WHERE u.Username IN ('demo_bm_ip_meera','demo_se_ip_rohan','demo_se_ip_isha','demo_se_ip_kabir')
  AND NOT EXISTS (SELECT 1 FROM dbo.tblUserGroupMap m WHERE m.UserId = u.Id);

-- ---------------------------------------------------------------------------
-- 3. Products — the 4 live ones + 2 demo, ordinal 0..5 by Id
-- ---------------------------------------------------------------------------
INSERT INTO dbo.tblProduct (CompId, Name, Code, CategoryId, UnitPrice, MarginPct, IsActive, CreatedBy)
VALUES (@CompId, N'DEMO Gold Bangle Set', 'DGB1', @catGeneral, 120000, 15, 1, @Priya),
       (@CompId, N'DEMO Silver Coin 10g', 'DSC1', @catGeneral, 900, 20, 1, @Priya);

SELECT Ord = ROW_NUMBER() OVER (ORDER BY Id) - 1, Id, ISNULL(UnitPrice, 10000) AS UnitPrice
INTO #Prod
FROM dbo.tblProduct
WHERE CompId = @CompId AND IsActive = 1 AND (Code IN ('GC22','DR01','SA01','PB01') OR Name COLLATE Latin1_General_CS_AS LIKE 'DEMO %');
IF (SELECT COUNT(*) FROM #Prod) <> 6
BEGIN RAISERROR('076: expected the 4 live products (GC22/DR01/SA01/PB01) + 2 demo products', 16, 1); RETURN; END

-- ---------------------------------------------------------------------------
-- 4. Rosters — execs per branch with cumulative weights (two stars, one
--    laggard), and the branch manager who "assigns"
-- ---------------------------------------------------------------------------
CREATE TABLE #Owner (BranchId INT, Ord INT, UserId INT, W INT);
INSERT INTO #Owner (BranchId, Ord, UserId, W)
SELECT 1, 0, Id, 450  FROM dbo.tblUser WHERE Username = 'se_ho_amit'       UNION ALL   -- star
SELECT 1, 1, Id, 800  FROM dbo.tblUser WHERE Username = 'se_ho_sara'       UNION ALL
SELECT 1, 2, Id, 1000 FROM dbo.tblUser WHERE Username = 'se_ho_karan'      UNION ALL   -- laggard
SELECT 2, 0, Id, 550  FROM dbo.tblUser WHERE Username = 'se_se_pooja'      UNION ALL   -- star
SELECT 2, 1, Id, 1000 FROM dbo.tblUser WHERE Username = 'se_se_dev'        UNION ALL
SELECT 3, 0, Id, 400  FROM dbo.tblUser WHERE Username = 'demo_se_ip_rohan' UNION ALL
SELECT 3, 1, Id, 750  FROM dbo.tblUser WHERE Username = 'demo_se_ip_isha'  UNION ALL
SELECT 3, 2, Id, 1000 FROM dbo.tblUser WHERE Username = 'demo_se_ip_kabir';
IF (SELECT COUNT(*) FROM #Owner) <> 8
BEGIN RAISERROR('076: expected 8 executives across branches 1/2/3', 16, 1); RETURN; END

CREATE TABLE #BM (BranchId INT PRIMARY KEY, UserId INT);
INSERT INTO #BM SELECT 1, Id FROM dbo.tblUser WHERE Username = 'bm_ho_rahul';
INSERT INTO #BM SELECT 2, Id FROM dbo.tblUser WHERE Username = 'bm_se_vikram';
INSERT INTO #BM VALUES (3, @Meera);
IF (SELECT COUNT(*) FROM #BM) <> 3
BEGIN RAISERROR('076: expected a branch manager for each of branches 1/2/3', 16, 1); RETURN; END

-- ---------------------------------------------------------------------------
-- 5. Name / place lists
-- ---------------------------------------------------------------------------
CREATE TABLE #First (Ord INT PRIMARY KEY, Name NVARCHAR(40));
INSERT INTO #First VALUES (0,N'Aarav'),(1,N'Diya'),(2,N'Kabir'),(3,N'Ananya'),(4,N'Vihaan'),(5,N'Ira'),
                          (6,N'Arjun'),(7,N'Myra'),(8,N'Reyansh'),(9,N'Saanvi'),(10,N'Advait'),(11,N'Kiara');
CREATE TABLE #Last (Ord INT PRIMARY KEY, Name NVARCHAR(40));
INSERT INTO #Last VALUES (0,N'Sharma'),(1,N'Verma'),(2,N'Gupta'),(3,N'Singh'),(4,N'Khan'),
                         (5,N'Joshi'),(6,N'Nair'),(7,N'Patel'),(8,N'Mehta'),(9,N'Rao');
CREATE TABLE #City (Ord INT PRIMARY KEY, City NVARCHAR(60), State NVARCHAR(60), Pincode VARCHAR(10));
INSERT INTO #City VALUES
 (0,N'New Delhi',N'Delhi','110001'),(1,N'Noida',N'Uttar Pradesh','201301'),(2,N'Ghaziabad',N'Uttar Pradesh','201010'),
 (3,N'Gurugram',N'Haryana','122001'),(4,N'Faridabad',N'Haryana','121001'),(5,N'Indirapuram',N'Uttar Pradesh','201014'),
 (6,N'Dwarka',N'Delhi','110075'),(7,N'Rohini',N'Delhi','110085'),(8,N'Greater Noida',N'Uttar Pradesh','201310'),
 (9,N'Vaishali',N'Uttar Pradesh','201012'),(10,N'Saket',N'Delhi','110017'),(11,N'Lajpat Nagar',N'Delhi','110024');
CREATE TABLE #Remark (Ord INT PRIMARY KEY, Txt NVARCHAR(200));
INSERT INTO #Remark VALUES
 (0,N'Spoke, wants a quote'),(1,N'Asked to call back next week'),(2,N'Visited store, liked the design'),
 (3,N'Comparing with another jeweller'),(4,N'Budget is tight this month'),(5,N'Wants a custom engraving'),
 (6,N'No answer, left a message'),(7,N'Confirmed interest, sending catalogue'),(8,N'Meeting at the showroom went well'),
 (9,N'Needs approval from family'),(10,N'Asked about exchange offer'),(11,N'Wrong number, verified alternate'),
 (12,N'Interested in festive collection'),(13,N'Requested EMI details'),(14,N'Will decide after the wedding date'),
 (15,N'Discussed hallmark and purity'),(16,N'Wants delivery to another city'),(17,N'Busy, call after 6 pm'),
 (18,N'Sent price list on WhatsApp'),(19,N'Follow up after their trip');

-- ---------------------------------------------------------------------------
-- 6. Numbers + hash streams. Every random-looking choice is an integer
--    expression of n reduced % 1000 and bucketed by thresholds; a different
--    prime per purpose keeps the streams looking independent. Worked example,
--    n = 1: hA = 919 -> Age 152 d; hB = 8 -> branch 1; hS = 282 -> Contacted.
-- ---------------------------------------------------------------------------
SELECT TOP (600) n = ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) - 1
INTO #N FROM sys.all_objects a CROSS JOIN sys.all_objects b;

SELECT n,
       hA = (n * 7919) % 1000,        hB = (n * 7907 + 101) % 1000, hC = (n * 7877 + 211) % 1000, hD = (n * 7873 + 307) % 1000,
       hE = (n * 7867 + 401) % 1000,  hF = (n * 7853 + 503) % 1000, hG = (n * 7841 + 601) % 1000, hH = (n * 7829 + 701) % 1000,
       hI = (n * 7823 + 809) % 1000,  hJ = (n * 7817 + 907) % 1000, hK = (n * 7789 + 113) % 1000, hL = (n * 7759 + 223) % 1000,
       hM = (n * 7757 + 331) % 1000,  hN = (n * 7753 + 433) % 1000, hS = (n * 7741 + 541) % 1000, hR = (n * 7727 + 641) % 1000,
       hY = (n * 7723 + 743) % 1000,  hZ = (n * 7717 + 853) % 1000
INTO #H FROM #N;

-- ---------------------------------------------------------------------------
-- 7. One row per lead, every attribute decided. Chained CROSS APPLYs so a
--    value can build on the one before it (Age -> CreatedAt -> offsets ->
--    close date); no ALTER TABLE on a temp table mid-batch.
--    Age is 1..180 and every offset is clamped to Age-1, which is what keeps
--    the whole timeline strictly in the past whatever the hour of apply.
-- ---------------------------------------------------------------------------
SELECT h.n,
       a.Age,
       b.BranchId, b.SourceId, b.ProdOrd, b.StatusId, b.LostReasonId, b.FuCount, b.Mult, b.Noise,
       b.FirstOrd, b.LastOrd, b.CityOrd, b.CreatedAt,
       c.dC, c.dF, c.dQ, c.dL, c.dJ,
       d.CloseAt,
       OwnerId = (SELECT TOP 1 o.UserId FROM #Owner o WHERE o.BranchId = b.BranchId AND h.hC < o.W ORDER BY o.W),
       hY = h.hY, hZ = h.hZ,
       CAST(NULL AS INT) AS LeadId
INTO #Seed
FROM #H h
CROSS APPLY (SELECT 1 + (h.hA * h.hA) / 5556 AS Age) a                                -- 1..180, denser near today
CROSS APPLY (SELECT
       BranchId = CASE WHEN h.hB < 450 THEN 1 WHEN h.hB < 800 THEN 2 ELSE 3 END,
       SourceId = CASE WHEN h.hD < 300 THEN @srcWebsite WHEN h.hD < 500 THEN @srcReferral WHEN h.hD < 650 THEN @srcWalkIn
                       WHEN h.hD < 800 THEN @srcPhone   WHEN h.hD < 920 THEN @srcSocial   ELSE @srcAd END,
       ProdOrd  = h.hE % 6,
       StatusId = CASE WHEN h.hS < 200 THEN @stNew WHEN h.hS < 400 THEN @stContacted WHEN h.hS < 550 THEN @stFollowUp
                       WHEN h.hS < 750 THEN @stQualified WHEN h.hS < 930 THEN @stLost ELSE @stJunk END,
       LostReasonId = CASE WHEN h.hR < 350 THEN @lrPrice WHEN h.hR < 600 THEN @lrCompetitor WHEN h.hR < 750 THEN @lrBudget
                           WHEN h.hR < 900 THEN @lrNotInterested ELSE @lrNoResponse END,
       FuCount  = 2 + (h.hN % 5),
       Mult     = 1 + (h.hF % 3),
       Noise    = 90 + (h.hG % 21),
       FirstOrd = h.hM % 12, LastOrd = h.hG % 10, CityOrd = h.hH % 12,
       CreatedAt = DATEADD(MINUTE, 540 + (h.hL % 600), DATEADD(DAY, -a.Age, @Today))     -- 09:00-19:00, Age days ago
) b
CROSS APPLY (SELECT   -- timeline offsets (contact 0-3 d, qualify 5-25 d, lost 3-40 d), clamped to Age-1
       dC = CASE WHEN h.hI % 4 < a.Age - 1 THEN h.hI % 4 ELSE a.Age - 1 END,
       dF = CASE WHEN (h.hI % 4) + 1 < a.Age - 1 THEN (h.hI % 4) + 1 ELSE a.Age - 1 END,
       dQ = CASE WHEN 5 + (h.hJ % 21) < a.Age - 1 THEN 5 + (h.hJ % 21) ELSE a.Age - 1 END,
       dL = CASE WHEN 3 + (h.hK % 38) < a.Age - 1 THEN 3 + (h.hK % 38) ELSE a.Age - 1 END,
       dJ = CASE WHEN a.Age >= 2 THEN 1 ELSE 0 END
) c
CROSS APPLY (SELECT
       CloseAt = CASE WHEN b.StatusId = @stLost THEN DATEADD(HOUR, 3, DATEADD(DAY, c.dL, b.CreatedAt))
                      WHEN b.StatusId = @stJunk THEN DATEADD(HOUR, 2, DATEADD(DAY, c.dJ, b.CreatedAt)) END
) d;

-- ---------------------------------------------------------------------------
-- 8. Leads
-- ---------------------------------------------------------------------------
INSERT INTO dbo.tblLeads
    (CompId, BranchId, Name, Company, MobileNo, Email, Address, City, State, Pincode,
     SourceId, ProductId, StatusId, OwnerId, EstValue, Remarks, AssignedAt,
     LostAt, LostReasonId, CreatedBy, EditBy, CreatedAt, UpdatedAt)
SELECT @CompId, s.BranchId,
       N'DEMO ' + f.Name + N' ' + l.Name,
       NULL,
       '98' + RIGHT('00000000' + CAST(s.n AS VARCHAR(8)), 8),
       LOWER(f.Name + '.' + l.Name) + CAST(s.n AS VARCHAR(8)) + '@example.com',
       CAST(10 + s.n % 90 AS NVARCHAR(4)) + N', ' + c.City,
       c.City, c.State, c.Pincode,
       s.SourceId, p.Id, s.StatusId, s.OwnerId,
       CAST(p.UnitPrice * s.Mult * s.Noise / 100.0 AS DECIMAL(18,2)),
       N'Demo lead - seeded by 076',
       s.CreatedAt,
       CASE WHEN s.StatusId = @stLost THEN s.CloseAt END,
       CASE WHEN s.StatusId = @stLost THEN s.LostReasonId END,
       s.OwnerId, s.OwnerId, s.CreatedAt, s.CreatedAt
FROM #Seed s
JOIN #Prod p  ON p.Ord = s.ProdOrd
JOIN #First f ON f.Ord = s.FirstOrd
JOIN #Last l  ON l.Ord = s.LastOrd
JOIN #City c  ON c.Ord = s.CityOrd;

UPDATE s SET LeadId = ld.Id
FROM #Seed s
JOIN dbo.tblLeads ld ON ld.CompId = @CompId AND ld.Name COLLATE Latin1_General_CS_AS LIKE 'DEMO %'
                     AND ld.MobileNo = '98' + RIGHT('00000000' + CAST(s.n AS VARCHAR(8)), 8);

-- ---------------------------------------------------------------------------
-- 9. Status history — the timeline each lead walked. Written as rows, not
--    through the procs: the procs would stamp GETDATE().
-- ---------------------------------------------------------------------------
-- (a) opening row for every lead
INSERT INTO dbo.tblLeadStatusHistory (CompId, LeadId, FromStatusId, ToStatusId, ChangedBy, ChangedAt)
SELECT @CompId, LeadId, NULL, @stNew, OwnerId, CreatedAt FROM #Seed;

-- (b) New -> Contacted: everything past New, plus Lost leads that were spoken to first
INSERT INTO dbo.tblLeadStatusHistory (CompId, LeadId, FromStatusId, ToStatusId, ChangedBy, ChangedAt)
SELECT @CompId, LeadId, @stNew, @stContacted, OwnerId, DATEADD(HOUR, 1, DATEADD(DAY, dC, CreatedAt))
FROM #Seed
WHERE StatusId IN (@stContacted, @stFollowUp, @stQualified) OR (StatusId = @stLost AND dL > dC);

-- (c) Contacted -> Follow-up
INSERT INTO dbo.tblLeadStatusHistory (CompId, LeadId, FromStatusId, ToStatusId, ChangedBy, ChangedAt)
SELECT @CompId, LeadId, @stContacted, @stFollowUp, OwnerId, DATEADD(HOUR, 2, DATEADD(DAY, dF, CreatedAt))
FROM #Seed WHERE StatusId = @stFollowUp;

-- (d) Contacted -> Qualified
INSERT INTO dbo.tblLeadStatusHistory (CompId, LeadId, FromStatusId, ToStatusId, ChangedBy, ChangedAt)
SELECT @CompId, LeadId, @stContacted, @stQualified, OwnerId, DATEADD(HOUR, 2, DATEADD(DAY, CASE WHEN dQ > dC THEN dQ ELSE dC END, CreatedAt))
FROM #Seed WHERE StatusId = @stQualified;

-- (e) -> Lost (from Contacted when there was a conversation, else straight from New)
INSERT INTO dbo.tblLeadStatusHistory (CompId, LeadId, FromStatusId, ToStatusId, ChangedBy, ChangedAt)
SELECT @CompId, LeadId, CASE WHEN dL > dC THEN @stContacted ELSE @stNew END, @stLost, OwnerId, CloseAt
FROM #Seed WHERE StatusId = @stLost;

-- (f) New -> Junk
INSERT INTO dbo.tblLeadStatusHistory (CompId, LeadId, FromStatusId, ToStatusId, ChangedBy, ChangedAt)
SELECT @CompId, LeadId, @stNew, @stJunk, OwnerId, CloseAt
FROM #Seed WHERE StatusId = @stJunk;

-- ---------------------------------------------------------------------------
-- 10. Follow-ups — 2-6 per lead; past ones 70 % on time / 20 % late / 10 % missed
-- ---------------------------------------------------------------------------
SELECT TOP (6) m = ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) - 1 INTO #M FROM sys.all_objects;

SELECT s.n, s.LeadId, s.BranchId, s.OwnerId, s.StatusId, s.CloseAt, x.m,
       a.DueAt, a.hT, a.hP, a.hO, a.hDir, a.hRem,
       b.Type, b.Status, b.DoneAt,
       OutcomeId = CASE WHEN b.Status = 'done' AND b.Type = 'call'
                        THEN CASE WHEN a.hO < 550 THEN @ocConnected WHEN a.hO < 750 THEN @ocNoAnswer WHEN a.hO < 850 THEN @ocBusy
                                  WHEN a.hO < 900 THEN @ocWrong ELSE @ocCallback END END,
       Duration  = CASE WHEN b.Status = 'done' AND b.Type = 'call' THEN 2 + (a.hO % 24) END,
       Direction = CASE WHEN b.Status = 'done' AND b.Type = 'call' THEN CASE WHEN a.hDir < 800 THEN 'out' ELSE 'in' END END,
       Remarks   = CASE WHEN b.Status IN ('done','skipped') THEN (SELECT r.Txt FROM #Remark r WHERE r.Ord = a.hRem) END
INTO #FU
FROM #Seed s
JOIN #M x ON x.m < s.FuCount
CROSS APPLY (SELECT RawDue = DATEADD(HOUR, 10 + ((s.n + x.m * 3) % 9),
                       DATEADD(DAY, x.m * (2 + ((s.n * 13 + x.m * 7) % 5)), CAST(CAST(s.CreatedAt AS DATE) AS DATETIME)))) r
CROSS APPLY (SELECT
       -- the first one can fall on the creation day before the lead existed; push it past creation
       DueAt = CASE WHEN r.RawDue <= s.CreatedAt THEN DATEADD(HOUR, 2, s.CreatedAt) ELSE r.RawDue END,
       hT   = (s.n * 31 + x.m * 17) % 1000,
       hP   = (s.n * 37 + x.m * 19 + 5) % 1000,
       hO   = (s.n * 41 + x.m * 23) % 1000,
       hDir = (s.n * 43 + x.m * 29) % 1000,
       hRem = (s.n * 47 + x.m * 31) % 20
) a
CROSS APPLY (SELECT
       Type   = CASE WHEN a.hT < 650 THEN 'call' WHEN a.hT < 850 THEN 'visit' WHEN a.hT < 950 THEN 'meeting' ELSE 'other' END,
       Status = CASE WHEN a.DueAt >= @Now THEN 'open'
                     WHEN a.hP < 900 THEN 'done'                          -- 70 % on time + 20 % late
                     WHEN s.CloseAt IS NOT NULL THEN 'skipped'            -- a closed lead's stragglers were skipped, not missed
                     ELSE 'open' END,                                     -- 10 % left open past due = missed
       DoneAt = CASE WHEN a.DueAt >= @Now THEN NULL
                     WHEN a.hP < 700 THEN DATEADD(MINUTE, a.hP % 120, a.DueAt)        -- on time (<= +2 h)
                     WHEN a.hP < 900 THEN DATEADD(DAY, 1 + (a.hP % 5), a.DueAt)       -- 1-5 days late
                     ELSE NULL END
) b
-- A closed lead has no follow-ups after it closed and none in the future.
WHERE NOT (s.CloseAt IS NOT NULL AND (a.DueAt > s.CloseAt OR a.DueAt >= @Now));

-- A "done" stamp cannot sit in the future.
UPDATE #FU SET DoneAt = DATEADD(MINUTE, -30, @Now) WHERE DoneAt > @Now;

INSERT INTO dbo.tblFollowUp
    (CompId, BranchId, LeadId, Type, DueAt, AssignedTo, Status, DoneAt, DoneBy, OutcomeId, Remarks, Direction, Duration, CreatedBy, CreatedAt, EditBy, UpdatedAt)
SELECT @CompId, f.BranchId, f.LeadId, f.Type, f.DueAt, f.OwnerId, f.Status, f.DoneAt,
       CASE WHEN f.Status = 'done' THEN f.OwnerId END,
       f.OutcomeId, f.Remarks, f.Direction, f.Duration,
       f.OwnerId,
       CASE WHEN f.m = 0 OR DATEADD(DAY, -1, f.DueAt) > @Now THEN s.CreatedAt ELSE DATEADD(DAY, -1, f.DueAt) END,
       CASE WHEN f.Status <> 'open' THEN f.OwnerId END, COALESCE(f.DoneAt, CASE WHEN f.Status = 'skipped' THEN f.DueAt END)
FROM #FU f
JOIN #Seed s ON s.n = f.n;

-- NextFollowupDate = earliest open follow-up (what sp_RefreshLeadNextFollowup keeps)
UPDATE ld SET NextFollowupDate = nf.NextDue
FROM dbo.tblLeads ld
JOIN #Seed s ON s.LeadId = ld.Id
LEFT JOIN (SELECT LeadId, MIN(DueAt) AS NextDue FROM dbo.tblFollowUp
           WHERE Status = 'open' AND LeadId IN (SELECT LeadId FROM #Seed) GROUP BY LeadId) nf ON nf.LeadId = ld.Id;

-- ---------------------------------------------------------------------------
-- 11. Assignments — creation row for all; transfers for 12 %, 3 % cross-branch
-- ---------------------------------------------------------------------------
INSERT INTO dbo.tblLeadAssignment (CompId, LeadId, FromUserId, ToUserId, FromBranchId, ToBranchId, ReasonId, Remarks, AssignedBy, AssignedAt)
SELECT @CompId, s.LeadId, NULL, s.OwnerId, NULL, s.BranchId, NULL, N'Assigned on creation', bm.UserId, s.CreatedAt
FROM #Seed s JOIN #BM bm ON bm.BranchId = s.BranchId;

-- (a) cross-branch (hY < 30): to the next branch's first exec, reason Wrong branch
SELECT s.n, s.LeadId, s.OwnerId AS FromUserId, s.BranchId AS FromBranchId,
       ToBranchId = (s.BranchId % 3) + 1,
       ToUserId   = (SELECT o.UserId FROM #Owner o WHERE o.BranchId = (s.BranchId % 3) + 1 AND o.Ord = 0),
       ReasonId   = @trWrongBranch,
       AssignedAt = DATEADD(HOUR, 4, DATEADD(DAY, CASE WHEN 1 + (s.hY % 10) < s.Age - 1 THEN 1 + (s.hY % 10) ELSE s.Age - 1 END, s.CreatedAt))
INTO #X
FROM #Seed s WHERE s.hY < 30;

-- (b) in-branch (30 <= hY < 120): to another exec of the same branch, weighted reason
INSERT INTO #X (n, LeadId, FromUserId, FromBranchId, ToBranchId, ToUserId, ReasonId, AssignedAt)
SELECT s.n, s.LeadId, s.OwnerId, s.BranchId, s.BranchId,
       (SELECT o2.UserId FROM #Owner o2 WHERE o2.BranchId = s.BranchId
         AND o2.Ord = ((SELECT o1.Ord FROM #Owner o1 WHERE o1.UserId = s.OwnerId) + 1) % (SELECT COUNT(*) FROM #Owner o3 WHERE o3.BranchId = s.BranchId)),
       CASE WHEN s.hZ < 300 THEN @trAbsent WHEN s.hZ < 550 THEN @trOverloaded WHEN s.hZ < 750 THEN @trReassigned
            WHEN s.hZ < 900 THEN @trSentBack ELSE @trOther END,
       DATEADD(HOUR, 4, DATEADD(DAY, CASE WHEN 1 + (s.hY % 10) < s.Age - 1 THEN 1 + (s.hY % 10) ELSE s.Age - 1 END, s.CreatedAt))
FROM #Seed s WHERE s.hY >= 30 AND s.hY < 120;

INSERT INTO dbo.tblLeadAssignment (CompId, LeadId, FromUserId, ToUserId, FromBranchId, ToBranchId, ReasonId, Remarks, AssignedBy, AssignedAt)
SELECT @CompId, x.LeadId, x.FromUserId, x.ToUserId, x.FromBranchId, x.ToBranchId, x.ReasonId,
       N'Demo transfer - seeded by 076', bm.UserId, x.AssignedAt
FROM #X x JOIN #BM bm ON bm.BranchId = x.FromBranchId;

-- (c) second row for 60 <= hY < 120: sent back to the (new) branch manager 3 days later
INSERT INTO dbo.tblLeadAssignment (CompId, LeadId, FromUserId, ToUserId, FromBranchId, ToBranchId, ReasonId, Remarks, AssignedBy, AssignedAt)
SELECT @CompId, x.LeadId, x.ToUserId, bm.UserId, x.ToBranchId, x.ToBranchId, @trSentBack,
       N'Demo send-back - seeded by 076', x.ToUserId,
       CASE WHEN DATEADD(DAY, 3, x.AssignedAt) < @Now THEN DATEADD(DAY, 3, x.AssignedAt) ELSE DATEADD(HOUR, -1, @Now) END
FROM #X x JOIN #Seed s ON s.n = x.n JOIN #BM bm ON bm.BranchId = x.ToBranchId
WHERE s.hY >= 60;

-- The lead reflects its LAST assignment (owner, branch, AssignedAt); open follow-ups travel with it.
UPDATE ld SET OwnerId = la.ToUserId, BranchId = la.ToBranchId, AssignedAt = la.AssignedAt, UpdatedAt = la.AssignedAt
FROM dbo.tblLeads ld
JOIN (SELECT a.LeadId, a.ToUserId, a.ToBranchId, a.AssignedAt,
             ROW_NUMBER() OVER (PARTITION BY a.LeadId ORDER BY a.AssignedAt DESC, a.Id DESC) AS rn
      FROM dbo.tblLeadAssignment a WHERE a.ReasonId IS NOT NULL AND a.LeadId IN (SELECT LeadId FROM #Seed)) la
  ON la.LeadId = ld.Id AND la.rn = 1;
UPDATE f SET AssignedTo = ld.OwnerId, BranchId = ld.BranchId
FROM dbo.tblFollowUp f JOIN dbo.tblLeads ld ON ld.Id = f.LeadId
WHERE f.Status = 'open' AND ld.Id IN (SELECT LeadId FROM #Seed);

DROP TABLE #Prod, #Owner, #BM, #First, #Last, #City, #Remark, #N, #H, #Seed, #M, #FU, #X;
GO

-- ===========================================================================
-- VERIFY AFTER APPLY
-- ===========================================================================
SET NOCOUNT ON;
SELECT 'demo users' AS what, COUNT(*) AS N, 4 AS expect FROM dbo.tblUser WHERE Username COLLATE Latin1_General_CS_AS LIKE 'demo\_%' ESCAPE '\';
SELECT 'demo products' AS what, COUNT(*) AS N, 2 AS expect FROM dbo.tblProduct WHERE Name COLLATE Latin1_General_CS_AS LIKE 'DEMO %';
SELECT 'demo leads' AS what, COUNT(*) AS N, 600 AS expect FROM dbo.tblLeads WHERE Name COLLATE Latin1_General_CS_AS LIKE 'DEMO %';

-- Oldest / newest lead: expect a 180-day span, nothing at or after now
SELECT 'created span' AS what, MIN(CreatedAt) AS MinCreatedAt, MAX(CreatedAt) AS MaxCreatedAt,
       DATEDIFF(DAY, MIN(CreatedAt), MAX(CreatedAt)) AS SpanDays,
       SUM(CASE WHEN CreatedAt > GETDATE() THEN 1 ELSE 0 END) AS InTheFuture_expect0
FROM dbo.tblLeads WHERE Name COLLATE Latin1_General_CS_AS LIKE 'DEMO %';

-- Distribution: branch x status (expect roughly 45/35/20 by branch, 55/20/18/7 by status class)
SELECT l.BranchId, st.Value AS Status, COUNT(*) AS N
FROM dbo.tblLeads l JOIN dbo.tblLookup st ON st.Id = l.StatusId
WHERE l.Name COLLATE Latin1_General_CS_AS LIKE 'DEMO %' GROUP BY l.BranchId, st.Value ORDER BY l.BranchId, st.Value;

-- Source mix (expect Website 30 / Referral 20 / Walk-in 15 / Phone 15 / Social 12 / Advertisement 8 %)
SELECT sr.Value AS Source, COUNT(*) AS N, CAST(100.0 * COUNT(*) / 600 AS DECIMAL(5,1)) AS Pct
FROM dbo.tblLeads l JOIN dbo.tblLookup sr ON sr.Id = l.SourceId
WHERE l.Name COLLATE Latin1_General_CS_AS LIKE 'DEMO %' GROUP BY sr.Value ORDER BY N DESC;

-- Follow-ups by status, then the on-time mix (expect roughly 70 / 20 / 10 of the past-due ones)
SELECT 'follow-ups' AS what, Status, COUNT(*) AS N FROM dbo.tblFollowUp
WHERE LeadId IN (SELECT Id FROM dbo.tblLeads WHERE Name COLLATE Latin1_General_CS_AS LIKE 'DEMO %') GROUP BY Status;

SELECT 'compliance mix' AS what,
       DoneOnTime = SUM(CASE WHEN Status = 'done' AND DoneAt <= DATEADD(HOUR, 2, DueAt) THEN 1 ELSE 0 END),
       DoneLate   = SUM(CASE WHEN Status = 'done' AND DoneAt >  DATEADD(HOUR, 2, DueAt) THEN 1 ELSE 0 END),
       Missed     = SUM(CASE WHEN Status = 'open' AND DueAt < GETDATE() THEN 1 ELSE 0 END),
       Skipped    = SUM(CASE WHEN Status = 'skipped' THEN 1 ELSE 0 END),
       OpenFuture = SUM(CASE WHEN Status = 'open' AND DueAt >= GETDATE() THEN 1 ELSE 0 END)
FROM dbo.tblFollowUp WHERE LeadId IN (SELECT Id FROM dbo.tblLeads WHERE Name COLLATE Latin1_General_CS_AS LIKE 'DEMO %');

-- History: at least one row per lead (expect HistoryRows >= Leads, i.e. 1)
SELECT 'history vs leads' AS what,
       (SELECT COUNT(*) FROM dbo.tblLeadStatusHistory WHERE LeadId IN (SELECT Id FROM dbo.tblLeads WHERE Name COLLATE Latin1_General_CS_AS LIKE 'DEMO %')) AS HistoryRows,
       (SELECT COUNT(*) FROM dbo.tblLeads WHERE Name COLLATE Latin1_General_CS_AS LIKE 'DEMO %') AS Leads,
       CASE WHEN (SELECT COUNT(*) FROM dbo.tblLeadStatusHistory WHERE LeadId IN (SELECT Id FROM dbo.tblLeads WHERE Name COLLATE Latin1_General_CS_AS LIKE 'DEMO %'))
               >= (SELECT COUNT(*) FROM dbo.tblLeads WHERE Name COLLATE Latin1_General_CS_AS LIKE 'DEMO %') THEN 1 ELSE 0 END AS Ok_expect1;

-- Transfers: expect ~72 rows over ~72 leads (12 %), ~18 of them cross-branch (3 %)
SELECT 'transfer rows (ReasonId set)' AS what, COUNT(*) AS N,
       SUM(CASE WHEN FromBranchId <> ToBranchId THEN 1 ELSE 0 END) AS CrossBranch,
       COUNT(DISTINCT LeadId) AS LeadsTransferred
FROM dbo.tblLeadAssignment WHERE ReasonId IS NOT NULL AND LeadId IN (SELECT Id FROM dbo.tblLeads WHERE Name COLLATE Latin1_General_CS_AS LIKE 'DEMO %');

-- KPI row of every report for the last 90 days, Sales-Head scope
DECLARE @from DATE = DATEADD(DAY, -90, CAST(GETDATE() AS DATE)), @to DATE = CAST(GETDATE() AS DATE);
DECLARE @all NVARCHAR(MAX) = '[1,2,3,4,5]';
SELECT 'KPIs, last 90 days, as sh_priya - read the FIRST grid under each label' AS step;
SELECT 'sp_RptFunnel' AS step;             EXEC dbo.sp_RptFunnel             @CompId=1, @FromDate=@from, @ToDate=@to, @GroupBy='source', @UserId=13, @AccessibleBranchIdsJson=@all;
SELECT 'sp_RptFollowUpCompliance' AS step; EXEC dbo.sp_RptFollowUpCompliance @CompId=1, @FromDate=@from, @ToDate=@to, @GroupBy='owner',  @UserId=13, @AccessibleBranchIdsJson=@all;
SELECT 'sp_RptActivity' AS step;           EXEC dbo.sp_RptActivity           @CompId=1, @FromDate=@from, @ToDate=@to, @GroupBy='owner',  @UserId=13, @AccessibleBranchIdsJson=@all;
SELECT 'sp_RptLost' AS step;               EXEC dbo.sp_RptLost               @CompId=1, @FromDate=@from, @ToDate=@to, @GroupBy='reason', @UserId=13, @AccessibleBranchIdsJson=@all;
SELECT 'sp_RptAging' AS step;              EXEC dbo.sp_RptAging              @CompId=1, @FromDate=@from, @ToDate=@to, @GroupBy='owner',  @UserId=13, @AccessibleBranchIdsJson=@all;
SELECT 'sp_RptTransfers' AS step;          EXEC dbo.sp_RptTransfers          @CompId=1, @FromDate=@from, @ToDate=@to, @GroupBy='reason', @UserId=13, @AccessibleBranchIdsJson=@all;
SELECT 'sp_RptPipelineValue' AS step;      EXEC dbo.sp_RptPipelineValue      @CompId=1, @FromDate=@from, @ToDate=@to, @GroupBy='status', @UserId=13, @AccessibleBranchIdsJson=@all;
SELECT 'sp_RptLeaderboard' AS step;        EXEC dbo.sp_RptLeaderboard        @CompId=1, @FromDate=@from, @ToDate=@to, @GroupBy='owner',  @UserId=13, @AccessibleBranchIdsJson=@all;
GO
