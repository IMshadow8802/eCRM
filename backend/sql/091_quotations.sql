-- =============================================================================
-- 091_quotations.sql
--
-- Purpose : Spec 3 — quotations and the lead convert engine.
--           docs/superpowers/specs/2026-09-18-quotations-design.md
--
--             * A mobile number becomes exactly 10 digits, everywhere:
--               existing rows are repaired (or parked in Remarks when they
--               cannot be), then CHECK constraints hold the line.
--             * tblQuotation / tblQuotationLine / tblQuotationCounter /
--               tblQuoteProfile; WonValue + CustomerId on leads; HSN / GST % /
--               unit / description on products; GSTIN on customers.
--             * A "Won" lead status under the `converted` code the engine has
--               whitelisted since 071 and never had a row for.
--             * sp_ConvertLead — the proc sp_SetLeadStatus has been telling
--               callers to use ("Use convert to move a lead to Converted")
--               and which did not exist.
--             * Seven quotation procs, three profile procs.
--             * Five report procs learn that success has two codes.
--
-- Target  : EVERY client database, one at a time — today [eCRM+] and
--           [SolarCRM]. There is deliberately NO `USE` here: select the
--           database in your client, run, then repeat for the next one.
--           Menu and lookup rows are found by Route / Kind + Code, never by
--           Id, because Ids differ between the two.
--
-- Safe to re-run: every ALTER is guarded, every proc is CREATE OR ALTER, every
--           seed is IF NOT EXISTS, and the mobile repair only touches rows
--           that still need it.
--
-- If interrupted: a cancelled run can leave the session in NOEXEC mode from
--           an aborted TRY/CATCH, which silently no-ops every batch after it.
--           Before resuming, run `SET NOEXEC OFF;` by itself, or just open a
--           fresh connection.
--
-- After   : deploy the backend (both services), then the web build. Users must
--           log in again to see the Quotations menu row — menu rights load at
--           login.
-- =============================================================================
SET NOCOUNT ON;
SET XACT_ABORT ON;
SET QUOTED_IDENTIFIER ON;
GO


-- ===== 1. Mobile numbers: data fix + CHECK constraints
-- ---------------------------------------------------------------------------
-- Nothing has ever enforced a shape. sp_SaveLead stores what it is given;
-- sp_SaveCustomer strips spaces and dashes but accepts '+' and any length. The
-- convert engine (§7) is about to de-duplicate customers on this column, so it
-- has to mean one thing: ten digits.
--
--   normalise = strip + space - ( ) .   →   drop a leading 91 from 12 digits,
--               or a leading 0 from 11   →   must now be exactly 10 digits
--
-- A row that normalises is rewritten. A row that cannot be (or that would
-- collide with another live customer) keeps its record: the old value moves
-- into Remarks and the column becomes NULL, which both tables already allow.
-- Nothing is deleted and nothing is guessed.
-- ---------------------------------------------------------------------------
BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @Ten VARCHAR(60) = REPLICATE('[0-9]', 10);

    -- Blank strings are not mobiles.
    UPDATE dbo.tblCustomer SET Mobile    = NULL WHERE Mobile    IS NOT NULL AND LTRIM(RTRIM(Mobile))    = '';
    UPDATE dbo.tblCustomer SET AltMobile = NULL WHERE AltMobile IS NOT NULL AND LTRIM(RTRIM(AltMobile)) = '';
    UPDATE dbo.tblLeads    SET MobileNo  = NULL WHERE MobileNo  IS NOT NULL AND LTRIM(RTRIM(MobileNo))  = '';
    UPDATE dbo.tblLeads    SET AltMobile = NULL WHERE AltMobile IS NOT NULL AND LTRIM(RTRIM(AltMobile)) = '';

    -- 1.1 tblCustomer.Mobile — the only one of the four with a uniqueness rule.
    IF OBJECT_ID('tempdb..#cm') IS NOT NULL DROP TABLE #cm;
    SELECT c.Id, c.CompId, c.IsActive, c.Mobile AS OldVal, n.d AS NewVal,
           CAST(CASE WHEN n.d LIKE @Ten THEN 1 ELSE 0 END AS BIT) AS Fixable,
           CAST(CASE WHEN c.Mobile LIKE @Ten THEN 0 ELSE 1 END AS BIT) AS Changed
    INTO #cm
    FROM dbo.tblCustomer c
    CROSS APPLY (SELECT REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                        LTRIM(RTRIM(c.Mobile)), '+',''), ' ',''), '-',''), '(',''), ')',''), '.','') AS d0) s
    CROSS APPLY (SELECT CASE WHEN LEN(s.d0) = 12 AND LEFT(s.d0, 2) = '91' THEN RIGHT(s.d0, 10)
                             WHEN LEN(s.d0) = 11 AND LEFT(s.d0, 1) = '0'  THEN RIGHT(s.d0, 10)
                             ELSE s.d0 END AS d) n
    WHERE c.Mobile IS NOT NULL;

    -- A rewrite collides when another LIVE customer of the same company already
    -- holds (or, with a lower Id, is about to hold) the normalised number.
    IF OBJECT_ID('tempdb..#cmCollide') IS NOT NULL DROP TABLE #cmCollide;
    SELECT x.Id,
           (SELECT MIN(y.Id) FROM #cm y
             WHERE y.CompId = x.CompId AND y.IsActive = 1 AND y.Id <> x.Id AND y.Fixable = 1
               AND y.NewVal = x.NewVal AND (y.OldVal = y.NewVal OR y.Id < x.Id)) AS KeeperId
    INTO #cmCollide
    FROM #cm x
    WHERE x.IsActive = 1 AND x.Fixable = 1 AND x.Changed = 1;
    DELETE FROM #cmCollide WHERE KeeperId IS NULL;

    -- Rewrite the clean ones.
    UPDATE c SET c.Mobile = m.NewVal
    FROM dbo.tblCustomer c
    JOIN #cm m ON m.Id = c.Id
    WHERE m.Fixable = 1 AND m.Changed = 1
      AND NOT EXISTS (SELECT 1 FROM #cmCollide k WHERE k.Id = c.Id);

    -- Park the rest: unfixable, or a duplicate of another customer.
    UPDATE c
    SET c.Remarks = LTRIM(ISNULL(c.Remarks + CHAR(13) + CHAR(10), N'')
                  + CASE WHEN k.Id IS NOT NULL
                         THEN N'Mobile on record was ' + m.OldVal + N' - the same number as customer #' + CAST(k.KeeperId AS NVARCHAR(12)) + N'; please merge.'
                         ELSE N'Mobile on record was ' + m.OldVal + N' - invalid, please correct.' END),
        c.Mobile = NULL
    FROM dbo.tblCustomer c
    JOIN #cm m ON m.Id = c.Id
    LEFT JOIN #cmCollide k ON k.Id = c.Id
    WHERE m.Fixable = 0 OR k.Id IS NOT NULL;

    -- 1.2 The three columns with no uniqueness rule: rewrite or park, one pass each.
    UPDATE c SET
        c.Remarks   = CASE WHEN n.d LIKE @Ten THEN c.Remarks
                           ELSE LTRIM(ISNULL(c.Remarks + CHAR(13) + CHAR(10), N'') + N'Alternate mobile on record was ' + c.AltMobile + N' - invalid, please correct.') END,
        c.AltMobile = CASE WHEN n.d LIKE @Ten THEN n.d ELSE NULL END
    FROM dbo.tblCustomer c
    CROSS APPLY (SELECT REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                        LTRIM(RTRIM(c.AltMobile)), '+',''), ' ',''), '-',''), '(',''), ')',''), '.','') AS d0) s
    CROSS APPLY (SELECT CASE WHEN LEN(s.d0) = 12 AND LEFT(s.d0, 2) = '91' THEN RIGHT(s.d0, 10)
                             WHEN LEN(s.d0) = 11 AND LEFT(s.d0, 1) = '0'  THEN RIGHT(s.d0, 10)
                             ELSE s.d0 END AS d) n
    WHERE c.AltMobile IS NOT NULL AND c.AltMobile NOT LIKE @Ten;

    UPDATE l SET
        l.Remarks  = CASE WHEN n.d LIKE @Ten THEN l.Remarks
                          ELSE LTRIM(ISNULL(l.Remarks + CHAR(13) + CHAR(10), N'') + N'Mobile on record was ' + l.MobileNo + N' - invalid, please correct.') END,
        l.MobileNo = CASE WHEN n.d LIKE @Ten THEN n.d ELSE NULL END
    FROM dbo.tblLeads l
    CROSS APPLY (SELECT REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                        LTRIM(RTRIM(l.MobileNo)), '+',''), ' ',''), '-',''), '(',''), ')',''), '.','') AS d0) s
    CROSS APPLY (SELECT CASE WHEN LEN(s.d0) = 12 AND LEFT(s.d0, 2) = '91' THEN RIGHT(s.d0, 10)
                             WHEN LEN(s.d0) = 11 AND LEFT(s.d0, 1) = '0'  THEN RIGHT(s.d0, 10)
                             ELSE s.d0 END AS d) n
    WHERE l.MobileNo IS NOT NULL AND l.MobileNo NOT LIKE @Ten;

    UPDATE l SET
        l.Remarks   = CASE WHEN n.d LIKE @Ten THEN l.Remarks
                           ELSE LTRIM(ISNULL(l.Remarks + CHAR(13) + CHAR(10), N'') + N'Alternate mobile on record was ' + l.AltMobile + N' - invalid, please correct.') END,
        l.AltMobile = CASE WHEN n.d LIKE @Ten THEN n.d ELSE NULL END
    FROM dbo.tblLeads l
    CROSS APPLY (SELECT REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(
                        LTRIM(RTRIM(l.AltMobile)), '+',''), ' ',''), '-',''), '(',''), ')',''), '.','') AS d0) s
    CROSS APPLY (SELECT CASE WHEN LEN(s.d0) = 12 AND LEFT(s.d0, 2) = '91' THEN RIGHT(s.d0, 10)
                             WHEN LEN(s.d0) = 11 AND LEFT(s.d0, 1) = '0'  THEN RIGHT(s.d0, 10)
                             ELSE s.d0 END AS d) n
    WHERE l.AltMobile IS NOT NULL AND l.AltMobile NOT LIKE @Ten;

    -- What was parked, for whoever runs this: fix these by hand in the app.
    SELECT 'customer mobile parked' AS what, m.Id, m.OldVal, k.KeeperId AS DuplicateOfCustomer
    FROM #cm m LEFT JOIN #cmCollide k ON k.Id = m.Id
    WHERE m.Fixable = 0 OR k.Id IS NOT NULL;

    -- 1.3 Hold the line.
    IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_tblCustomer_Mobile')
        ALTER TABLE dbo.tblCustomer WITH CHECK ADD CONSTRAINT CK_tblCustomer_Mobile
            CHECK (Mobile IS NULL OR Mobile LIKE '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]');
    IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_tblCustomer_AltMobile')
        ALTER TABLE dbo.tblCustomer WITH CHECK ADD CONSTRAINT CK_tblCustomer_AltMobile
            CHECK (AltMobile IS NULL OR AltMobile LIKE '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]');
    IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_tblLeads_MobileNo')
        ALTER TABLE dbo.tblLeads WITH CHECK ADD CONSTRAINT CK_tblLeads_MobileNo
            CHECK (MobileNo IS NULL OR MobileNo LIKE '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]');
    IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_tblLeads_AltMobile')
        ALTER TABLE dbo.tblLeads WITH CHECK ADD CONSTRAINT CK_tblLeads_AltMobile
            CHECK (AltMobile IS NULL OR AltMobile LIKE '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]');

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    DECLARE @m1 NVARCHAR(2048) = ERROR_MESSAGE();
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    RAISERROR('091 §1 mobile repair ABORTED — %s', 16, 1, @m1);
    SET NOEXEC ON;
END CATCH
GO


-- ===== 2. New columns (tblLeads, tblProduct, tblCustomer) + 'Won' lookup seed
-- ---------------------------------------------------------------------------
-- WonValue is what reports read for revenue. An accepted quotation fills it
-- with its before-tax total; a lead won without a quotation gets what the
-- agent typed. Reports never need to know which.
-- ---------------------------------------------------------------------------
IF COL_LENGTH('dbo.tblLeads', 'WonValue')   IS NULL ALTER TABLE dbo.tblLeads ADD WonValue   DECIMAL(18,2) NULL;
IF COL_LENGTH('dbo.tblLeads', 'CustomerId') IS NULL ALTER TABLE dbo.tblLeads ADD CustomerId INT           NULL;

IF COL_LENGTH('dbo.tblProduct', 'HSNCode')     IS NULL ALTER TABLE dbo.tblProduct ADD HSNCode     VARCHAR(10)   NULL;
IF COL_LENGTH('dbo.tblProduct', 'TaxPct')      IS NULL ALTER TABLE dbo.tblProduct ADD TaxPct      DECIMAL(5,2)  NULL;
IF COL_LENGTH('dbo.tblProduct', 'Unit')        IS NULL ALTER TABLE dbo.tblProduct ADD Unit        VARCHAR(20)   NULL;
IF COL_LENGTH('dbo.tblProduct', 'Description') IS NULL ALTER TABLE dbo.tblProduct ADD Description NVARCHAR(500) NULL;

IF COL_LENGTH('dbo.tblCustomer', 'GSTIN') IS NULL ALTER TABLE dbo.tblCustomer ADD GSTIN VARCHAR(15) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_tblLeads_CompId_CustomerId' AND object_id = OBJECT_ID('dbo.tblLeads'))
    CREATE INDEX IX_tblLeads_CompId_CustomerId ON dbo.tblLeads (CompId, CustomerId) WHERE CustomerId IS NOT NULL;
GO

-- 2.1 "Won", under the code sp_SaveLookup has whitelisted since 071. It sorts
--     directly after the company's Qualified row; everything after it moves
--     down one. Companies that already have a live `converted` row are skipped.
BEGIN TRY
    BEGIN TRANSACTION;

    IF OBJECT_ID('tempdb..#won') IS NOT NULL DROP TABLE #won;
    SELECT lk.CompId,
           ISNULL(MAX(CASE WHEN lk.Code = 'qualified' THEN lk.SortOrder END), MAX(lk.SortOrder)) AS AfterSort
    INTO #won
    FROM dbo.tblLookup lk
    WHERE lk.Kind = 'lead_status' AND lk.IsActive = 1
      -- Existence check ignores IsActive: a soft-deleted Won/converted row
      -- (Task 3's sp_DeleteLookup) must still block a re-run from inserting
      -- a second one. Guard on Value too: UQ_tblLookup_CompId_Kind_Value
      -- keys on Value, so a company with an existing plain 'Won' row (no
      -- Code) would otherwise hit a duplicate-key error on the INSERT below.
      AND NOT EXISTS (
            SELECT 1 FROM dbo.tblLookup w2
            WHERE w2.CompId = lk.CompId AND w2.Kind = 'lead_status'
              AND (w2.Code = 'converted' OR w2.Value = N'Won')
          )
    GROUP BY lk.CompId;

    UPDATE lk SET lk.SortOrder = lk.SortOrder + 1
    FROM dbo.tblLookup lk JOIN #won w ON w.CompId = lk.CompId
    WHERE lk.Kind = 'lead_status' AND lk.SortOrder > w.AfterSort;

    INSERT INTO dbo.tblLookup (CompId, Kind, Value, SortOrder, IsActive, Code, TatHours)
    SELECT w.CompId, 'lead_status', N'Won', w.AfterSort + 1, 1, 'converted', NULL FROM #won w;

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    DECLARE @m2 NVARCHAR(2048) = ERROR_MESSAGE();
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    RAISERROR('091 §2 Won seed ABORTED — %s', 16, 1, @m2);
    SET NOEXEC ON;
END CATCH
GO


-- ===== 3. New tables (tblQuotation, tblQuotationLine, tblQuotationCounter, tblQuoteProfile)
-- ---------------------------------------------------------------------------
-- tblQuotation has NO BranchId and NO OwnerId on purpose. A quotation is part
-- of its lead: visibility is read through the join, so a transferred lead
-- carries its quotations with it and there is no second copy to go stale.
--
-- No FK to tblLeads either — leads carry no DB-level FKs (integrity lives in
-- the SPs; see sp_DeleteLead, which §8 teaches to refuse a lead that has
-- quotations). Lines DO cascade from their quotation: they have no life
-- outside it.
-- ---------------------------------------------------------------------------
IF OBJECT_ID('dbo.tblQuotation') IS NULL
BEGIN
    CREATE TABLE dbo.tblQuotation (
        Id              INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_tblQuotation PRIMARY KEY,
        CompId          INT            NOT NULL,
        LeadId          INT            NOT NULL,
        CustomerId      INT            NULL,           -- stamped when accepted
        RootId          INT            NOT NULL,       -- Id of revision 1 (its own Id for R1)
        Revision        INT            NOT NULL CONSTRAINT DF_tblQuotation_Revision DEFAULT (1),
        FinYear         CHAR(4)        NULL,           -- NULL while draft
        SeqNo           INT            NULL,
        QuoteNo         VARCHAR(30)    NULL,
        TemplateCode    VARCHAR(30)    NOT NULL,
        Status          VARCHAR(20)    NOT NULL CONSTRAINT DF_tblQuotation_Status DEFAULT ('draft'),
        QuoteDate       DATE           NOT NULL,
        ValidTill       DATE           NULL,
        Subject         NVARCHAR(300)  NULL,
        ToName          NVARCHAR(200)  NOT NULL,
        ToCompany       NVARCHAR(200)  NULL,
        ToMobile        VARCHAR(20)    NULL,
        ToEmail         NVARCHAR(200)  NULL,
        ToAddress       NVARCHAR(500)  NULL,
        ToCity          NVARCHAR(100)  NULL,
        ToStateCode     CHAR(2)        NULL,           -- place of supply
        ToPincode       VARCHAR(10)    NULL,
        ToGSTIN         VARCHAR(15)    NULL,
        SellerGSTIN     VARCHAR(15)    NULL,           -- NULL = unregistered = no tax
        SellerStateCode CHAR(2)        NULL,
        CompanyJSON     NVARCHAR(MAX)  NULL,
        ContentJSON     NVARCHAR(MAX)  NULL,
        SubTotal        DECIMAL(18,2)  NOT NULL CONSTRAINT DF_tblQuotation_SubTotal      DEFAULT (0),
        DiscountTotal   DECIMAL(18,2)  NOT NULL CONSTRAINT DF_tblQuotation_DiscountTotal DEFAULT (0),
        TaxableTotal    DECIMAL(18,2)  NOT NULL CONSTRAINT DF_tblQuotation_TaxableTotal  DEFAULT (0),
        CgstTotal       DECIMAL(18,2)  NOT NULL CONSTRAINT DF_tblQuotation_CgstTotal     DEFAULT (0),
        SgstTotal       DECIMAL(18,2)  NOT NULL CONSTRAINT DF_tblQuotation_SgstTotal     DEFAULT (0),
        IgstTotal       DECIMAL(18,2)  NOT NULL CONSTRAINT DF_tblQuotation_IgstTotal     DEFAULT (0),
        RoundOff        DECIMAL(18,2)  NOT NULL CONSTRAINT DF_tblQuotation_RoundOff      DEFAULT (0),
        GrandTotal      DECIMAL(18,2)  NOT NULL CONSTRAINT DF_tblQuotation_GrandTotal    DEFAULT (0),
        FinalisedAt     DATETIME       NULL,
        FinalisedBy     INT            NULL,
        ClosedAt        DATETIME       NULL,           -- accepted / rejected / unused / superseded
        ClosedBy        INT            NULL,
        CloseRemarks    NVARCHAR(500)  NULL,
        CreatedBy       INT            NULL,
        CreatedAt       DATETIME       NOT NULL CONSTRAINT DF_tblQuotation_CreatedAt DEFAULT (GETDATE()),
        EditBy          INT            NULL,
        UpdatedAt       DATETIME       NULL,
        CONSTRAINT CK_tblQuotation_Status CHECK (Status IN ('draft','final','accepted','rejected','superseded','unused'))
    );
    CREATE INDEX IX_tblQuotation_CompId_LeadId ON dbo.tblQuotation (CompId, LeadId);
    CREATE UNIQUE INDEX UX_tblQuotation_Root_Revision ON dbo.tblQuotation (CompId, RootId, Revision) WHERE RootId <> 0;
    CREATE UNIQUE INDEX UX_tblQuotation_Number ON dbo.tblQuotation (CompId, FinYear, SeqNo, Revision) WHERE SeqNo IS NOT NULL;
END
GO

-- Unfiltered twin of UX_tblQuotation_Root_Revision: the optimiser cannot prove
-- a variable predicate (RootId = @RootId) implies a filtered index's WHERE
-- clause, so every RootId-keyed lookup/lock (finalise's number carry-over,
-- revise's UPDLOCK/HOLDLOCK revision scan, the detail page's sibling-revision
-- list) fell back to a full scan/lock of tblQuotation without this.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_tblQuotation_Comp_Root' AND object_id = OBJECT_ID('dbo.tblQuotation'))
    CREATE INDEX IX_tblQuotation_Comp_Root ON dbo.tblQuotation (CompId, RootId, Revision);
GO

IF OBJECT_ID('dbo.tblQuotationLine') IS NULL
BEGIN
    CREATE TABLE dbo.tblQuotationLine (
        Id            INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_tblQuotationLine PRIMARY KEY,
        CompId        INT             NOT NULL,
        QuotationId   INT             NOT NULL
            CONSTRAINT FK_tblQuotationLine_Quotation REFERENCES dbo.tblQuotation (Id) ON DELETE CASCADE,
        SortOrder     INT             NOT NULL,
        ProductId     INT             NULL,            -- where the line was seeded from; the line itself is free text
        Description   NVARCHAR(1000)  NOT NULL,
        HSNCode       VARCHAR(10)     NULL,
        Qty           DECIMAL(18,3)   NOT NULL,
        Unit          VARCHAR(20)     NULL,
        Rate          DECIMAL(18,2)   NOT NULL,
        DiscountType  VARCHAR(3)      NOT NULL CONSTRAINT DF_tblQuotationLine_DiscountType DEFAULT ('pct'),
        DiscountValue DECIMAL(18,2)   NOT NULL CONSTRAINT DF_tblQuotationLine_DiscountValue DEFAULT (0),
        TaxPct        DECIMAL(5,2)    NOT NULL CONSTRAINT DF_tblQuotationLine_TaxPct DEFAULT (0),
        GrossAmt      DECIMAL(18,2)   NOT NULL,
        DiscountAmt   DECIMAL(18,2)   NOT NULL,
        TaxableAmt    DECIMAL(18,2)   NOT NULL,
        CgstAmt       DECIMAL(18,2)   NOT NULL,
        SgstAmt       DECIMAL(18,2)   NOT NULL,
        IgstAmt       DECIMAL(18,2)   NOT NULL,
        LineTotal     DECIMAL(18,2)   NOT NULL,
        CONSTRAINT CK_tblQuotationLine_DiscountType CHECK (DiscountType IN ('pct','amt'))
    );
    CREATE INDEX IX_tblQuotationLine_QuotationId ON dbo.tblQuotationLine (QuotationId, SortOrder);
END
GO

-- One counter per company per Indian financial year. Read WITH (UPDLOCK,
-- HOLDLOCK) inside sp_FinaliseQuotation's transaction.
IF OBJECT_ID('dbo.tblQuotationCounter') IS NULL
    CREATE TABLE dbo.tblQuotationCounter (
        CompId  INT     NOT NULL,
        FinYear CHAR(4) NOT NULL,
        LastNo  INT     NOT NULL CONSTRAINT DF_tblQuotationCounter_LastNo DEFAULT (0),
        CONSTRAINT PK_tblQuotationCounter PRIMARY KEY (CompId, FinYear)
    );
GO

-- "The template remembers." Per BRANCH, not per company: a Gujarat branch and a
-- Mumbai branch have different GSTINs, and one shared row would flip-flop with
-- every quotation. IsSet = 0 means nobody has filled it in yet — the first
-- person may; after that only an admin can change the default (spec §3).
IF OBJECT_ID('dbo.tblQuoteProfile') IS NULL
    CREATE TABLE dbo.tblQuoteProfile (
        Id                 INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_tblQuoteProfile PRIMARY KEY,
        CompId             INT             NOT NULL,
        BranchId           INT             NOT NULL,
        CompanyName        NVARCHAR(200)   NULL,
        Address            NVARCHAR(500)   NULL,
        City               NVARCHAR(100)   NULL,
        StateCode          CHAR(2)         NULL,
        Pincode            VARCHAR(10)     NULL,
        GSTIN              VARCHAR(15)     NULL,
        Phone              VARCHAR(30)     NULL,
        Email              NVARCHAR(200)   NULL,
        Website            NVARCHAR(200)   NULL,
        BankDetails        NVARCHAR(1000)  NULL,
        DefaultIntro       NVARCHAR(MAX)   NULL,
        DefaultTerms       NVARCHAR(MAX)   NULL,
        SignatoryName      NVARCHAR(200)   NULL,
        LogoAttachmentId   BIGINT          NULL,
        HeaderAttachmentId BIGINT          NULL,
        AccentColor        VARCHAR(7)      NULL,
        DefaultTemplate    VARCHAR(30)     NULL,
        IsSet              BIT             NOT NULL CONSTRAINT DF_tblQuoteProfile_IsSet DEFAULT (0),
        CreatedBy          INT             NULL,
        CreatedAt          DATETIME        NOT NULL CONSTRAINT DF_tblQuoteProfile_CreatedAt DEFAULT (GETDATE()),
        EditBy             INT             NULL,
        UpdatedAt          DATETIME        NULL,
        CONSTRAINT UX_tblQuoteProfile_Comp_Branch UNIQUE (CompId, BranchId)
    );
GO


-- ===== 4. Attachments: sp_SaveAttachment entity whitelist
-- ---------------------------------------------------------------------------
-- The SP hard-coded ('task','ticket','lead') and would refuse every quotation
-- image with 'Invalid entity'. Two more: a quotation's own pictures, and the
-- branch letterhead (logo + header) the profile points at.
-- Keep in step with ENTITIES in backend/src/middleware/upload.js.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROCEDURE dbo.sp_SaveAttachment
    @Id         BIGINT = 0,
    @CompId     BIGINT,
    @Entity     VARCHAR(20),
    @EntityId   BIGINT,
    @FileName   NVARCHAR(400),
    @StoredName VARCHAR(200),
    @FileSize   BIGINT,
    @MimeType   VARCHAR(150) = NULL,
    @UploadedBy INT = NULL
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @ResponseCode INT, @ResponseMess VARCHAR(400);

    IF (@Entity NOT IN ('task','ticket','lead','quotation','quoteprofile'))
    BEGIN SET @ResponseCode = 400; SET @ResponseMess = 'Invalid entity';
          SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess; RETURN; END

    INSERT INTO dbo.tblAttachment (CompId, Entity, EntityId, FileName, StoredName, FileSize, MimeType, UploadedBy)
    VALUES (@CompId, @Entity, @EntityId, @FileName, @StoredName, @FileSize, @MimeType, @UploadedBy);

    SET @ResponseCode = 201; SET @ResponseMess = 'Attachment saved';
    SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess,
           SCOPE_IDENTITY() AS AttachmentId;
END
GO


-- ===== 5. Procedures — quote profile (sp_EnsureQuoteProfile, sp_FetchQuoteProfileById, sp_SaveQuoteProfile)

-- ---------------------------------------------------------------------------
-- 5.1 sp_EnsureQuoteProfile — a fetch that creates, on purpose.
--     The builder needs the branch's profile row to EXIST before anyone has
--     saved anything, because a logo upload needs an EntityId to hang off.
--     A new branch is seeded from the company's most recently saved profile:
--     name, contact, bank, terms, logo, colours carry over; the address, state
--     and GSTIN do not — those are the reason a profile is per branch at all.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_EnsureQuoteProfile
    @CompId   INT,
    @BranchId INT,
    @UserId   INT
AS
BEGIN
    SET NOCOUNT ON;

    IF @CompId IS NULL OR @CompId <= 0 OR @BranchId IS NULL OR @BranchId <= 0
    BEGIN SELECT 0 AS Id, 400 AS ResponseCode, 'CompId and BranchId are required' AS ResponseMess; RETURN; END

    IF NOT EXISTS (SELECT 1 FROM dbo.tblQuoteProfile WHERE CompId = @CompId AND BranchId = @BranchId)
    BEGIN
        BEGIN TRY
            INSERT INTO dbo.tblQuoteProfile
                (CompId, BranchId, CompanyName, Phone, Email, Website, BankDetails, DefaultIntro, DefaultTerms,
                 SignatoryName, LogoAttachmentId, HeaderAttachmentId, AccentColor, DefaultTemplate, IsSet, CreatedBy)
            SELECT @CompId, @BranchId, src.CompanyName, src.Phone, src.Email, src.Website, src.BankDetails,
                   src.DefaultIntro, src.DefaultTerms, src.SignatoryName, src.LogoAttachmentId,
                   src.HeaderAttachmentId, src.AccentColor, src.DefaultTemplate, 0, @UserId
            FROM (SELECT 1 AS one) d
            LEFT JOIN (SELECT TOP 1 * FROM dbo.tblQuoteProfile
                       WHERE CompId = @CompId AND IsSet = 1
                       ORDER BY ISNULL(UpdatedAt, CreatedAt) DESC, Id DESC) src ON 1 = 1;
        END TRY
        BEGIN CATCH
            -- 2601 / 2627: a concurrent call won the race. The row exists; carry on.
            IF ERROR_NUMBER() NOT IN (2601, 2627) THROW;
        END CATCH
    END

    SELECT p.Id, p.CompId, p.BranchId, b.BranchName,
           p.CompanyName, p.Address, p.City, p.StateCode, p.Pincode, p.GSTIN, p.Phone, p.Email, p.Website,
           p.BankDetails, p.DefaultIntro, p.DefaultTerms, p.SignatoryName,
           p.LogoAttachmentId, p.HeaderAttachmentId, p.AccentColor, p.DefaultTemplate, p.IsSet,
           p.CreatedBy, p.CreatedAt, p.EditBy, p.UpdatedAt,
           200 AS ResponseCode, 'Quote profile retrieved successfully' AS ResponseMess
    FROM dbo.tblQuoteProfile p
    LEFT JOIN dbo.tblBranch b ON b.Id = p.BranchId
    WHERE p.CompId = @CompId AND p.BranchId = @BranchId;
END
GO

-- ---------------------------------------------------------------------------
-- 5.2 sp_FetchQuoteProfileById — the attachment access gate's lookup
--     (permission.ENTITY_LOOKUP.quoteprofile). Company-wide by design: every
--     agent who can write a quotation must be able to draw the letterhead.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_FetchQuoteProfileById
    @CompId    INT,
    @ProfileId INT
AS
BEGIN
    SET NOCOUNT ON;
    SELECT p.Id, p.CompId, p.BranchId, p.IsSet, p.LogoAttachmentId, p.HeaderAttachmentId
    FROM dbo.tblQuoteProfile p
    WHERE p.Id = @ProfileId AND p.CompId = @CompId;
END
GO

-- ---------------------------------------------------------------------------
-- 5.3 sp_SaveQuoteProfile — the remembered default.
--     First fill (IsSet = 0) is open to anyone: there is nothing to lose.
--     After that only an admin may change it — one agent's GSTIN typo must not
--     become everybody's letterhead. Editing the company block ON a quotation
--     is always allowed and never reaches this proc.
--     With a GSTIN, the state IS its first two digits; what the caller sent is
--     ignored.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_SaveQuoteProfile
    @CompId             INT,
    @BranchId           INT,
    @UserId             INT,
    @IsAdmin            BIT            = 0,
    @CompanyName        NVARCHAR(200)  = NULL,
    @Address            NVARCHAR(500)  = NULL,
    @City               NVARCHAR(100)  = NULL,
    @StateCode          CHAR(2)        = NULL,
    @Pincode            VARCHAR(10)    = NULL,
    @GSTIN              VARCHAR(15)    = NULL,
    @Phone              VARCHAR(30)    = NULL,
    @Email              NVARCHAR(200)  = NULL,
    @Website            NVARCHAR(200)  = NULL,
    @BankDetails        NVARCHAR(1000) = NULL,
    @DefaultIntro       NVARCHAR(MAX)  = NULL,
    @DefaultTerms       NVARCHAR(MAX)  = NULL,
    @SignatoryName      NVARCHAR(200)  = NULL,
    @LogoAttachmentId   BIGINT         = NULL,
    @HeaderAttachmentId BIGINT         = NULL,
    @AccentColor        VARCHAR(7)     = NULL,
    @DefaultTemplate    VARCHAR(30)    = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF @CompId IS NULL OR @CompId <= 0 OR @BranchId IS NULL OR @BranchId <= 0
    BEGIN SELECT 0 AS Id, 400 AS ResponseCode, 'CompId and BranchId are required' AS ResponseMess; RETURN; END
    IF @UserId IS NULL OR @UserId <= 0
    BEGIN SELECT 0 AS Id, 400 AS ResponseCode, 'UserId is required' AS ResponseMess; RETURN; END

    SET @CompanyName = NULLIF(LTRIM(RTRIM(@CompanyName)), N'');
    SET @GSTIN       = NULLIF(UPPER(REPLACE(LTRIM(RTRIM(@GSTIN)), ' ', '')), '');
    IF @CompanyName IS NULL
    BEGIN SELECT 0 AS Id, 400 AS ResponseCode, 'Company name is required' AS ResponseMess; RETURN; END
    IF @GSTIN IS NOT NULL AND (LEN(@GSTIN) <> 15 OR @GSTIN NOT LIKE '[0-9][0-9]%' OR @GSTIN LIKE '%[^0-9A-Z]%')
    BEGIN SELECT 0 AS Id, 400 AS ResponseCode, 'GSTIN must be 15 characters' AS ResponseMess; RETURN; END
    IF @GSTIN IS NOT NULL SET @StateCode = LEFT(@GSTIN, 2);
    IF @StateCode IS NOT NULL AND @StateCode NOT LIKE '[0-9][0-9]'
    BEGIN SELECT 0 AS Id, 400 AS ResponseCode, 'Invalid state code' AS ResponseMess; RETURN; END
    IF @DefaultTemplate IS NOT NULL AND @DefaultTemplate NOT IN ('classic','modern','minimal')
    BEGIN SELECT 0 AS Id, 400 AS ResponseCode, 'Unknown template' AS ResponseMess; RETURN; END
    IF @AccentColor IS NOT NULL AND @AccentColor NOT LIKE '#[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]'
    BEGIN SELECT 0 AS Id, 400 AS ResponseCode, 'Accent colour must be #RRGGBB' AS ResponseMess; RETURN; END

    -- A letterhead image must be this company's, and must be a letterhead image.
    IF @LogoAttachmentId IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM dbo.tblAttachment WHERE Id = @LogoAttachmentId AND CompId = @CompId AND Entity = 'quoteprofile')
    BEGIN SELECT 0 AS Id, 400 AS ResponseCode, 'Invalid logo' AS ResponseMess; RETURN; END
    IF @HeaderAttachmentId IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM dbo.tblAttachment WHERE Id = @HeaderAttachmentId AND CompId = @CompId AND Entity = 'quoteprofile')
    BEGIN SELECT 0 AS Id, 400 AS ResponseCode, 'Invalid header image' AS ResponseMess; RETURN; END

    DECLARE @Id INT, @IsSet BIT;
    SELECT @Id = Id, @IsSet = IsSet FROM dbo.tblQuoteProfile WHERE CompId = @CompId AND BranchId = @BranchId;

    IF @Id IS NOT NULL AND @IsSet = 1 AND ISNULL(@IsAdmin, 0) = 0
    BEGIN SELECT @Id AS Id, 403 AS ResponseCode, 'Only an administrator can change the saved company details' AS ResponseMess; RETURN; END

    BEGIN TRY
        IF @Id IS NULL
        BEGIN
            INSERT INTO dbo.tblQuoteProfile
                (CompId, BranchId, CompanyName, Address, City, StateCode, Pincode, GSTIN, Phone, Email, Website,
                 BankDetails, DefaultIntro, DefaultTerms, SignatoryName, LogoAttachmentId, HeaderAttachmentId,
                 AccentColor, DefaultTemplate, IsSet, CreatedBy, EditBy)
            VALUES
                (@CompId, @BranchId, @CompanyName, @Address, @City, @StateCode, @Pincode, @GSTIN, @Phone, @Email, @Website,
                 @BankDetails, @DefaultIntro, @DefaultTerms, @SignatoryName, @LogoAttachmentId, @HeaderAttachmentId,
                 @AccentColor, @DefaultTemplate, 1, @UserId, @UserId);
            SET @Id = CAST(SCOPE_IDENTITY() AS INT);
        END
        ELSE
            UPDATE dbo.tblQuoteProfile
            SET CompanyName = @CompanyName, Address = @Address, City = @City, StateCode = @StateCode,
                Pincode = @Pincode, GSTIN = @GSTIN, Phone = @Phone, Email = @Email, Website = @Website,
                BankDetails = @BankDetails, DefaultIntro = @DefaultIntro, DefaultTerms = @DefaultTerms,
                SignatoryName = @SignatoryName, LogoAttachmentId = @LogoAttachmentId,
                HeaderAttachmentId = @HeaderAttachmentId, AccentColor = @AccentColor,
                DefaultTemplate = @DefaultTemplate, IsSet = 1, EditBy = @UserId, UpdatedAt = GETDATE()
            WHERE Id = @Id AND CompId = @CompId;

        SELECT @Id AS Id, 200 AS ResponseCode, 'Company details saved for future quotations' AS ResponseMess;
    END TRY
    BEGIN CATCH
        SELECT ISNULL(@Id, 0) AS Id, 500 AS ResponseCode, ERROR_MESSAGE() AS ResponseMess;
    END CATCH
END
GO

-- ===== 6. Procedures — quotations (sp_SaveQuotation, sp_FinaliseQuotation, sp_ReviseQuotation, sp_RejectQuotation, sp_DeleteQuotation, sp_FetchQuotations, sp_FetchQuotationDetail)

-- ---------------------------------------------------------------------------
-- 6.1 sp_SaveQuotation — drafts only. Lines arrive as JSON and are replaced
--     wholesale; every amount is computed HERE and nowhere else.
--
--     Arithmetic (spec §2, fixture table in §11 and in the web's
--     quoteMath.test.js — change one, change both). Exact DECIMAL, ROUND half
--     away from zero at every step:
--        Gross    = ROUND(Qty × Rate, 2)
--        Discount = pct ? ROUND(Gross × v / 100, 2) : MIN(v, Gross)
--        Taxable  = Gross − Discount
--        Tax      = seller has a GSTIN ? ROUND(Taxable × TaxPct / 100, 2) : 0
--        intra    → CGST = ROUND(Tax / 2, 2), SGST = Tax − CGST   (odd paisa → CGST)
--        inter    → IGST = Tax
--        Grand    = ROUND(Σ LineTotal, 0); RoundOff = Grand − Σ
--
--     The seller's state is LEFT(SellerGSTIN, 2) — derived, never trusted.
--     A draft with no place of supply totals as intra-state; finalise is what
--     insists on one.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_SaveQuotation
    @Id              INT            = 0,
    @CompId          INT,
    @UserId          INT,
    @LeadId          INT            = NULL,
    @TemplateCode    VARCHAR(30)    = 'classic',
    @QuoteDate       DATE           = NULL,
    @ValidTill       DATE           = NULL,
    @Subject         NVARCHAR(300)  = NULL,
    @ToName          NVARCHAR(200)  = NULL,
    @ToCompany       NVARCHAR(200)  = NULL,
    @ToMobile        VARCHAR(20)    = NULL,
    @ToEmail         NVARCHAR(200)  = NULL,
    @ToAddress       NVARCHAR(500)  = NULL,
    @ToCity          NVARCHAR(100)  = NULL,
    @ToStateCode     CHAR(2)        = NULL,
    @ToPincode       VARCHAR(10)    = NULL,
    @ToGSTIN         VARCHAR(15)    = NULL,
    @SellerGSTIN     VARCHAR(15)    = NULL,
    @SellerStateCode CHAR(2)        = NULL,
    @CompanyJSON     NVARCHAR(MAX)  = NULL,
    @ContentJSON     NVARCHAR(MAX)  = NULL,
    @LinesJSON       NVARCHAR(MAX)  = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET @Id = ISNULL(@Id, 0);

    IF @CompId IS NULL OR @CompId <= 0
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'CompId is required' AS ResponseMess; RETURN; END
    IF @UserId IS NULL OR @UserId <= 0
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'UserId is required' AS ResponseMess; RETURN; END

    -- An update keeps the quotation on its own lead; the client cannot move it.
    IF @Id > 0
    BEGIN
        DECLARE @CurStatus VARCHAR(20);
        SELECT @LeadId = LeadId, @CurStatus = Status FROM dbo.tblQuotation WHERE Id = @Id AND CompId = @CompId;
        IF @CurStatus IS NULL
        BEGIN SELECT @Id AS Id, 404 AS ResponseCode, 'Quotation not found' AS ResponseMess; RETURN; END
        IF @CurStatus <> 'draft'
        BEGIN SELECT @Id AS Id, 409 AS ResponseCode, 'Only a draft can be edited — revise this quotation instead' AS ResponseMess; RETURN; END
    END

    IF @LeadId IS NULL OR @LeadId <= 0
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'LeadId is required' AS ResponseMess; RETURN; END

    DECLARE @LeadCode VARCHAR(30);
    SELECT @LeadCode = st.Code
    FROM dbo.tblLeads l JOIN dbo.tblLookup st ON st.Id = l.StatusId
    WHERE l.Id = @LeadId AND l.CompId = @CompId;
    IF @LeadCode IS NULL
    BEGIN SELECT @Id AS Id, 404 AS ResponseCode, 'Lead not found' AS ResponseMess; RETURN; END
    IF @LeadCode NOT IN ('open','qualified')
    BEGIN SELECT @Id AS Id, 409 AS ResponseCode, 'This lead is closed — its quotations can no longer be edited' AS ResponseMess; RETURN; END

    SET @ToName   = NULLIF(LTRIM(RTRIM(@ToName)), N'');
    SET @ToGSTIN  = NULLIF(UPPER(REPLACE(LTRIM(RTRIM(@ToGSTIN)), ' ', '')), '');
    SET @SellerGSTIN = NULLIF(UPPER(REPLACE(LTRIM(RTRIM(@SellerGSTIN)), ' ', '')), '');
    SET @ToMobile = NULLIF(LTRIM(RTRIM(@ToMobile)), '');
    SET @TemplateCode = ISNULL(@TemplateCode, 'classic');   -- an explicit NULL is not "omitted"; the column default never applies
    IF @QuoteDate IS NULL SET @QuoteDate = CAST(GETDATE() AS DATE);

    IF @ToName IS NULL
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'Customer name is required' AS ResponseMess; RETURN; END
    IF @TemplateCode NOT IN ('classic','modern','minimal')
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'Unknown template' AS ResponseMess; RETURN; END
    IF @ToMobile IS NOT NULL AND @ToMobile NOT LIKE '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'Mobile number must be 10 digits' AS ResponseMess; RETURN; END
    IF @ToStateCode IS NOT NULL AND @ToStateCode NOT LIKE '[0-9][0-9]'
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'Invalid place of supply' AS ResponseMess; RETURN; END
    IF @SellerGSTIN IS NOT NULL AND (LEN(@SellerGSTIN) <> 15 OR @SellerGSTIN NOT LIKE '[0-9][0-9]%')
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'Your GSTIN must be 15 characters' AS ResponseMess; RETURN; END
    IF @ToGSTIN IS NOT NULL AND (LEN(@ToGSTIN) <> 15 OR @ToGSTIN NOT LIKE '[0-9][0-9]%')
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'The customer''s GSTIN must be 15 characters' AS ResponseMess; RETURN; END
    IF @ValidTill IS NOT NULL AND @ValidTill < @QuoteDate
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'Valid-till cannot be before the quotation date' AS ResponseMess; RETURN; END
    IF @CompanyJSON IS NOT NULL AND ISJSON(@CompanyJSON) = 0
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'CompanyJSON is not valid JSON' AS ResponseMess; RETURN; END
    IF @ContentJSON IS NOT NULL AND ISJSON(@ContentJSON) = 0
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'ContentJSON is not valid JSON' AS ResponseMess; RETURN; END
    IF @LinesJSON IS NOT NULL AND LTRIM(RTRIM(@LinesJSON)) <> '' AND ISJSON(@LinesJSON) = 0
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'LinesJSON is not valid JSON' AS ResponseMess; RETURN; END

    IF @SellerGSTIN IS NOT NULL SET @SellerStateCode = LEFT(@SellerGSTIN, 2);
    IF @SellerStateCode IS NOT NULL AND @SellerStateCode NOT LIKE '[0-9][0-9]'
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'Invalid seller state' AS ResponseMess; RETURN; END
    DECLARE @Taxed BIT = CASE WHEN @SellerGSTIN IS NOT NULL THEN 1 ELSE 0 END;
    DECLARE @Inter BIT = CASE WHEN @SellerGSTIN IS NOT NULL AND @ToStateCode IS NOT NULL
                                   AND @ToStateCode <> @SellerStateCode THEN 1 ELSE 0 END;

    BEGIN TRY
        -- Parse. Negatives are clamped rather than refused: a draft is allowed to be
        -- half-typed, and finalise is where a line has to make sense. A line's
        -- ProductId is resolved through THIS company's own catalogue: a foreign
        -- company's id, or a stale one, becomes NULL rather than being stored.
        -- Parsing lives inside TRY too — valid-JSON-but-wrong-shape (e.g. `[1,2]`)
        -- passes ISJSON and then throws out of OPENJSON's WITH clause.
        DECLARE @L TABLE (
            SortOrder INT, ProductId INT, Description NVARCHAR(1000), HSNCode VARCHAR(10),
            Qty DECIMAL(18,3), Unit VARCHAR(20), Rate DECIMAL(18,2),
            DiscountType VARCHAR(3), DiscountValue DECIMAL(18,2), TaxPct DECIMAL(5,2));

        IF @LinesJSON IS NOT NULL AND LTRIM(RTRIM(@LinesJSON)) <> ''
            INSERT INTO @L (SortOrder, ProductId, Description, HSNCode, Qty, Unit, Rate, DiscountType, DiscountValue, TaxPct)
            SELECT CAST(a.[key] AS INT) + 1,
                   p.Id,
                   ISNULL(LTRIM(RTRIM(j.description)), N''),
                   NULLIF(LTRIM(RTRIM(j.hsn)), ''),
                   CASE WHEN ISNULL(j.qty, 0)  < 0 THEN 0 ELSE ISNULL(j.qty, 0)  END,
                   NULLIF(LTRIM(RTRIM(j.unit)), ''),
                   CASE WHEN ISNULL(j.rate, 0) < 0 THEN 0 ELSE ISNULL(j.rate, 0) END,
                   CASE WHEN j.discountType = 'amt' THEN 'amt' ELSE 'pct' END,
                   CASE WHEN ISNULL(j.discountValue, 0) < 0 THEN 0
                        WHEN ISNULL(j.discountType, 'pct') <> 'amt' AND j.discountValue > 100 THEN 100
                        ELSE ISNULL(j.discountValue, 0) END,
                   CASE WHEN ISNULL(j.taxPct, 0) < 0 THEN 0 WHEN j.taxPct > 100 THEN 100 ELSE ISNULL(j.taxPct, 0) END
            FROM OPENJSON(@LinesJSON) a
            CROSS APPLY OPENJSON(a.value) WITH (
                productId     INT             '$.productId',
                description   NVARCHAR(1000)  '$.description',
                hsn           VARCHAR(10)     '$.hsn',
                qty           DECIMAL(18,3)   '$.qty',
                unit          VARCHAR(20)     '$.unit',
                rate          DECIMAL(18,2)   '$.rate',
                discountType  VARCHAR(3)      '$.discountType',
                discountValue DECIMAL(18,2)   '$.discountValue',
                taxPct        DECIMAL(5,2)    '$.taxPct') j
            LEFT JOIN dbo.tblProduct p ON p.Id = j.productId AND p.CompId = @CompId;

        IF (SELECT COUNT(*) FROM @L) > 200
        BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'A quotation can hold at most 200 lines' AS ResponseMess; RETURN; END

        BEGIN TRANSACTION;

        DECLARE @IsNew BIT = CASE WHEN @Id = 0 THEN 1 ELSE 0 END;

        -- A save already in flight when a finalise commits must not silently
        -- rewrite an issued quotation (new header, replaced lines, recomputed
        -- totals) after the customer has been handed the number. Same shape as
        -- finalise's race guard: re-read under lock and re-assert draft before
        -- touching anything, then guard the UPDATE itself as belt and braces.
        -- Insert has no prior status and is untouched by this.
        IF @Id > 0
        BEGIN
            DECLARE @LockStatus VARCHAR(20);
            SELECT @LockStatus = Status FROM dbo.tblQuotation WITH (UPDLOCK) WHERE Id = @Id AND CompId = @CompId;
            IF @LockStatus IS NULL OR @LockStatus <> 'draft'
            BEGIN
                ROLLBACK TRANSACTION;
                SELECT @Id AS Id, 409 AS ResponseCode, 'This quotation is no longer a draft' AS ResponseMess; RETURN;
            END
        END

        IF @Id = 0
        BEGIN
            INSERT INTO dbo.tblQuotation
                (CompId, LeadId, RootId, Revision, TemplateCode, Status, QuoteDate, ValidTill, Subject,
                 ToName, ToCompany, ToMobile, ToEmail, ToAddress, ToCity, ToStateCode, ToPincode, ToGSTIN,
                 SellerGSTIN, SellerStateCode, CompanyJSON, ContentJSON, CreatedBy, EditBy)
            VALUES
                (@CompId, @LeadId, 0, 1, @TemplateCode, 'draft', @QuoteDate, @ValidTill, @Subject,
                 @ToName, @ToCompany, @ToMobile, @ToEmail, @ToAddress, @ToCity, @ToStateCode, @ToPincode, @ToGSTIN,
                 @SellerGSTIN, @SellerStateCode, @CompanyJSON, @ContentJSON, @UserId, @UserId);
            SET @Id = CAST(SCOPE_IDENTITY() AS INT);
            UPDATE dbo.tblQuotation SET RootId = @Id WHERE Id = @Id;   -- revision 1 is its own root
        END
        ELSE
        BEGIN
            UPDATE dbo.tblQuotation
            SET TemplateCode = @TemplateCode, QuoteDate = @QuoteDate, ValidTill = @ValidTill, Subject = @Subject,
                ToName = @ToName, ToCompany = @ToCompany, ToMobile = @ToMobile, ToEmail = @ToEmail,
                ToAddress = @ToAddress, ToCity = @ToCity, ToStateCode = @ToStateCode, ToPincode = @ToPincode,
                ToGSTIN = @ToGSTIN, SellerGSTIN = @SellerGSTIN, SellerStateCode = @SellerStateCode,
                CompanyJSON = @CompanyJSON, ContentJSON = @ContentJSON, EditBy = @UserId, UpdatedAt = GETDATE()
            WHERE Id = @Id AND CompId = @CompId AND Status = 'draft';

            IF @@ROWCOUNT = 0
            BEGIN
                ROLLBACK TRANSACTION;
                SELECT @Id AS Id, 409 AS ResponseCode, 'This quotation is no longer a draft' AS ResponseMess; RETURN;
            END
        END

        DELETE FROM dbo.tblQuotationLine WHERE QuotationId = @Id;

        ;WITH g AS (
            SELECT *, ROUND(CAST(Qty AS DECIMAL(18,3)) * CAST(Rate AS DECIMAL(18,2)), 2) AS Gross FROM @L
        ), d AS (
            SELECT *, CASE WHEN DiscountType = 'amt' THEN CAST(DiscountValue AS DECIMAL(38,6))
                           ELSE ROUND(CAST(Gross AS DECIMAL(20,2)) * CAST(DiscountValue AS DECIMAL(9,2)) / 100, 2) END AS Disc0
            FROM g
        ), t AS (
            SELECT *, CASE WHEN Disc0 > Gross THEN Gross ELSE Disc0 END AS Disc FROM d
        ), x AS (
            SELECT *, CAST(Gross - Disc AS DECIMAL(20,2)) AS Taxable FROM t
        ), y AS (
            SELECT *, CASE WHEN @Taxed = 1 THEN CAST(ROUND(Taxable * CAST(TaxPct AS DECIMAL(7,2)) / 100, 2) AS DECIMAL(20,2))
                           ELSE CAST(0 AS DECIMAL(20,2)) END AS Tax
            FROM x
        )
        INSERT INTO dbo.tblQuotationLine
            (CompId, QuotationId, SortOrder, ProductId, Description, HSNCode, Qty, Unit, Rate,
             DiscountType, DiscountValue, TaxPct, GrossAmt, DiscountAmt, TaxableAmt, CgstAmt, SgstAmt, IgstAmt, LineTotal)
        SELECT @CompId, @Id, SortOrder, ProductId, Description, HSNCode, Qty, Unit, Rate,
               DiscountType, DiscountValue, TaxPct, Gross, Disc, Taxable,
               CASE WHEN @Inter = 1 THEN 0 ELSE ROUND(Tax / 2, 2) END,
               CASE WHEN @Inter = 1 THEN 0 ELSE Tax - ROUND(Tax / 2, 2) END,
               CASE WHEN @Inter = 1 THEN Tax ELSE 0 END,
               Taxable + Tax
        FROM y;

        UPDATE q SET
            SubTotal      = ISNULL(s.SubTotal, 0),      DiscountTotal = ISNULL(s.DiscountTotal, 0),
            TaxableTotal  = ISNULL(s.TaxableTotal, 0),  CgstTotal     = ISNULL(s.CgstTotal, 0),
            SgstTotal     = ISNULL(s.SgstTotal, 0),     IgstTotal     = ISNULL(s.IgstTotal, 0),
            GrandTotal    = ROUND(ISNULL(s.Total, 0), 0),
            RoundOff      = ROUND(ISNULL(s.Total, 0), 0) - ISNULL(s.Total, 0)
        FROM dbo.tblQuotation q
        OUTER APPLY (SELECT SUM(GrossAmt) AS SubTotal, SUM(DiscountAmt) AS DiscountTotal, SUM(TaxableAmt) AS TaxableTotal,
                            SUM(CgstAmt) AS CgstTotal, SUM(SgstAmt) AS SgstTotal, SUM(IgstAmt) AS IgstTotal,
                            SUM(LineTotal) AS Total
                     FROM dbo.tblQuotationLine WHERE QuotationId = @Id) s
        WHERE q.Id = @Id;

        IF @IsNew = 1
        BEGIN
            DECLARE @actLog TABLE (Id INT, ResponseCode INT, ResponseMess NVARCHAR(200));
            DECLARE @Meta NVARCHAR(MAX) = (SELECT @Id AS quotationId, 'drafted' AS event FOR JSON PATH, WITHOUT_ARRAY_WRAPPER);
            INSERT INTO @actLog
            EXEC dbo.sp_LogLeadActivity @CompId = @CompId, @LeadId = @LeadId, @UserId = @UserId,
                 @Type = 'quotation', @Summary = N'Quotation drafted', @MetaJSON = @Meta;
        END

        COMMIT TRANSACTION;
        SELECT @Id AS Id, 200 AS ResponseCode, 'Quotation saved' AS ResponseMess;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SELECT @Id AS Id, 500 AS ResponseCode, ERROR_MESSAGE() AS ResponseMess;
    END CATCH
END
GO

-- ---------------------------------------------------------------------------
-- 6.2 sp_FinaliseQuotation — locks the draft and gives it its number.
--     Numbered HERE, not at create, so abandoned drafts burn nothing.
--     QT-<FinYear>-<4-digit seq>[-R<n>]; the counter is per company per Indian
--     financial year (Apr–Mar). A revision reuses its root's number.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_FinaliseQuotation
    @CompId      INT,
    @QuotationId INT,
    @UserId      INT
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @Status VARCHAR(20), @LeadId INT, @RootId INT, @Revision INT,
            @ToState CHAR(2), @SellerGstin VARCHAR(15), @CompanyJSON NVARCHAR(MAX);
    SELECT @Status = Status, @LeadId = LeadId, @RootId = RootId, @Revision = Revision,
           @ToState = ToStateCode, @SellerGstin = SellerGSTIN, @CompanyJSON = CompanyJSON
    FROM dbo.tblQuotation WHERE Id = @QuotationId AND CompId = @CompId;

    IF @Status IS NULL
    BEGIN SELECT @QuotationId AS Id, 404 AS ResponseCode, 'Quotation not found' AS ResponseMess, CAST(NULL AS VARCHAR(30)) AS QuoteNo; RETURN; END
    IF @Status <> 'draft'
    BEGIN SELECT @QuotationId AS Id, 409 AS ResponseCode, 'This quotation is no longer a draft' AS ResponseMess, CAST(NULL AS VARCHAR(30)) AS QuoteNo; RETURN; END
    IF @UserId IS NULL OR @UserId <= 0
    BEGIN SELECT @QuotationId AS Id, 400 AS ResponseCode, 'UserId is required' AS ResponseMess, CAST(NULL AS VARCHAR(30)) AS QuoteNo; RETURN; END

    IF NOT EXISTS (SELECT 1 FROM dbo.tblLeads l JOIN dbo.tblLookup st ON st.Id = l.StatusId
                   WHERE l.Id = @LeadId AND l.CompId = @CompId AND st.Code IN ('open','qualified'))
    BEGIN SELECT @QuotationId AS Id, 409 AS ResponseCode, 'This lead is closed — the quotation cannot be finalised' AS ResponseMess, CAST(NULL AS VARCHAR(30)) AS QuoteNo; RETURN; END

    IF NOT EXISTS (SELECT 1 FROM dbo.tblQuotationLine WHERE QuotationId = @QuotationId)
    BEGIN SELECT @QuotationId AS Id, 400 AS ResponseCode, 'Add at least one line before finalising' AS ResponseMess, CAST(NULL AS VARCHAR(30)) AS QuoteNo; RETURN; END
    IF EXISTS (SELECT 1 FROM dbo.tblQuotationLine WHERE QuotationId = @QuotationId AND (LTRIM(RTRIM(Description)) = N'' OR Qty <= 0))
    BEGIN SELECT @QuotationId AS Id, 400 AS ResponseCode, 'Every line needs a description and a quantity' AS ResponseMess, CAST(NULL AS VARCHAR(30)) AS QuoteNo; RETURN; END
    -- Spec §2: a rate of zero is legitimate (a free item in a package); a
    -- negative one is not — it would silently discount the whole quotation.
    IF EXISTS (SELECT 1 FROM dbo.tblQuotationLine WHERE QuotationId = @QuotationId AND Rate < 0)
    BEGIN SELECT @QuotationId AS Id, 400 AS ResponseCode, 'A line cannot have a negative rate' AS ResponseMess, CAST(NULL AS VARCHAR(30)) AS QuoteNo; RETURN; END
    IF NULLIF(LTRIM(RTRIM(ISNULL(JSON_VALUE(@CompanyJSON, '$.name'), N''))), N'') IS NULL
    BEGIN SELECT @QuotationId AS Id, 400 AS ResponseCode, 'Your company name is missing' AS ResponseMess, CAST(NULL AS VARCHAR(30)) AS QuoteNo; RETURN; END
    IF @SellerGstin IS NOT NULL AND @ToState IS NULL
    BEGIN SELECT @QuotationId AS Id, 400 AS ResponseCode, 'Choose the customer''s state — GST depends on it' AS ResponseMess, CAST(NULL AS VARCHAR(30)) AS QuoteNo; RETURN; END

    DECLARE @Today DATE = CAST(GETDATE() AS DATE);
    DECLARE @StartYear INT = CASE WHEN MONTH(@Today) >= 4 THEN YEAR(@Today) ELSE YEAR(@Today) - 1 END;
    DECLARE @FinYear CHAR(4) = RIGHT('0' + CAST(@StartYear % 100 AS VARCHAR(2)), 2)
                             + RIGHT('0' + CAST((@StartYear + 1) % 100 AS VARCHAR(2)), 2);
    DECLARE @Seq INT, @QuoteNo VARCHAR(30);

    BEGIN TRY
        BEGIN TRANSACTION;

        -- Two in-flight finalises of the same draft (a double-click on the one
        -- irreversible button, or an Axios retry) must not both draw a number.
        -- Re-read under lock and re-assert draft status before the counter is
        -- touched; the UPDATE below is guarded a second time as belt and braces —
        -- a wrong QuoteNo is not recoverable once the caller has seen it.
        DECLARE @LockStatus VARCHAR(20);
        SELECT @LockStatus = Status FROM dbo.tblQuotation WITH (UPDLOCK) WHERE Id = @QuotationId AND CompId = @CompId;
        IF @LockStatus IS NULL OR @LockStatus <> 'draft'
        BEGIN
            ROLLBACK TRANSACTION;
            SELECT @QuotationId AS Id, 409 AS ResponseCode, 'This quotation is no longer a draft' AS ResponseMess, CAST(NULL AS VARCHAR(30)) AS QuoteNo; RETURN;
        END

        -- A revision carries its root's number; only a first issue draws a new one.
        IF @Revision > 1
            SELECT @Seq = SeqNo, @FinYear = ISNULL(FinYear, @FinYear)
            FROM dbo.tblQuotation WHERE CompId = @CompId AND RootId = @RootId AND SeqNo IS NOT NULL AND Revision = (
                SELECT MIN(Revision) FROM dbo.tblQuotation WHERE CompId = @CompId AND RootId = @RootId AND SeqNo IS NOT NULL);

        IF @Seq IS NULL
        BEGIN
            UPDATE dbo.tblQuotationCounter WITH (UPDLOCK, HOLDLOCK)
            SET LastNo = LastNo + 1, @Seq = LastNo + 1
            WHERE CompId = @CompId AND FinYear = @FinYear;
            IF @@ROWCOUNT = 0
            BEGIN
                INSERT INTO dbo.tblQuotationCounter (CompId, FinYear, LastNo) VALUES (@CompId, @FinYear, 1);
                SET @Seq = 1;
            END
        END

        SET @QuoteNo = 'QT-' + @FinYear + '-'
                     + CASE WHEN @Seq < 10000 THEN RIGHT('0000' + CAST(@Seq AS VARCHAR(10)), 4) ELSE CAST(@Seq AS VARCHAR(10)) END
                     + CASE WHEN @Revision > 1 THEN '-R' + CAST(@Revision AS VARCHAR(5)) ELSE '' END;

        UPDATE dbo.tblQuotation
        SET Status = 'final', FinYear = @FinYear, SeqNo = @Seq, QuoteNo = @QuoteNo,
            FinalisedAt = GETDATE(), FinalisedBy = @UserId, EditBy = @UserId, UpdatedAt = GETDATE()
        WHERE Id = @QuotationId AND CompId = @CompId AND Status = 'draft';

        IF @@ROWCOUNT = 0
        BEGIN
            ROLLBACK TRANSACTION;
            SELECT @QuotationId AS Id, 409 AS ResponseCode, 'This quotation is no longer a draft' AS ResponseMess, CAST(NULL AS VARCHAR(30)) AS QuoteNo; RETURN;
        END

        -- The revision it replaces. A quotation the customer is holding never
        -- changes silently — it is superseded, and says by what.
        UPDATE dbo.tblQuotation
        SET Status = 'superseded', ClosedAt = GETDATE(), ClosedBy = @UserId,
            CloseRemarks = N'Replaced by ' + @QuoteNo
        WHERE CompId = @CompId AND RootId = @RootId AND Id <> @QuotationId AND Status = 'final';

        DECLARE @actLog TABLE (Id INT, ResponseCode INT, ResponseMess NVARCHAR(200));
        DECLARE @Summary NVARCHAR(500) = N'Quotation ' + @QuoteNo + N' finalised';
        DECLARE @Meta NVARCHAR(MAX) = (SELECT @QuotationId AS quotationId, @QuoteNo AS quoteNo, 'finalised' AS event
                                       FOR JSON PATH, WITHOUT_ARRAY_WRAPPER);
        INSERT INTO @actLog
        EXEC dbo.sp_LogLeadActivity @CompId = @CompId, @LeadId = @LeadId, @UserId = @UserId,
             @Type = 'quotation', @Summary = @Summary, @MetaJSON = @Meta;

        COMMIT TRANSACTION;
        SELECT @QuotationId AS Id, 200 AS ResponseCode, 'Quotation finalised' AS ResponseMess, @QuoteNo AS QuoteNo;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SELECT @QuotationId AS Id, 500 AS ResponseCode, ERROR_MESSAGE() AS ResponseMess, CAST(NULL AS VARCHAR(30)) AS QuoteNo;
    END CATCH
END
GO

-- ---------------------------------------------------------------------------
-- 6.3 sp_ReviseQuotation — a copy, one revision up, as a new draft.
--     One draft revision per root: asking twice hands back the first.
--     Validity is carried over as a LENGTH (15 days stays 15 days), not a date.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_ReviseQuotation
    @CompId      INT,
    @QuotationId INT,
    @UserId      INT
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @Status VARCHAR(20), @LeadId INT, @RootId INT, @SrcNo VARCHAR(30);
    SELECT @Status = Status, @LeadId = LeadId, @RootId = RootId, @SrcNo = QuoteNo
    FROM dbo.tblQuotation WHERE Id = @QuotationId AND CompId = @CompId;

    IF @Status IS NULL
    BEGIN SELECT @QuotationId AS Id, 404 AS ResponseCode, 'Quotation not found' AS ResponseMess; RETURN; END
    IF @UserId IS NULL OR @UserId <= 0
    BEGIN SELECT @QuotationId AS Id, 400 AS ResponseCode, 'UserId is required' AS ResponseMess; RETURN; END
    IF @Status NOT IN ('final','rejected','unused')
    BEGIN SELECT @QuotationId AS Id, 409 AS ResponseCode, 'Only a finalised, rejected or unused quotation can be revised' AS ResponseMess; RETURN; END
    IF NOT EXISTS (SELECT 1 FROM dbo.tblLeads l JOIN dbo.tblLookup st ON st.Id = l.StatusId
                   WHERE l.Id = @LeadId AND l.CompId = @CompId AND st.Code IN ('open','qualified'))
    BEGIN SELECT @QuotationId AS Id, 409 AS ResponseCode, 'This lead is closed — its quotations are history now' AS ResponseMess; RETURN; END

    -- Fast path only — cheap enough to skip opening a transaction in the common
    -- case, but not the authority: two concurrent revises could both pass this
    -- and each start their own draft, so the check is repeated under lock below.
    DECLARE @Existing INT = (SELECT TOP 1 Id FROM dbo.tblQuotation
                             WHERE CompId = @CompId AND RootId = @RootId AND Status = 'draft' ORDER BY Id DESC);
    IF @Existing IS NOT NULL
    BEGIN SELECT @Existing AS Id, 200 AS ResponseCode, 'A draft revision already exists' AS ResponseMess; RETURN; END

    DECLARE @NewId INT, @NewRev INT;

    BEGIN TRY
        BEGIN TRANSACTION;

        SELECT @NewRev = MAX(Revision) + 1,
               @Existing = MAX(CASE WHEN Status = 'draft' THEN Id END)
        FROM dbo.tblQuotation WITH (UPDLOCK, HOLDLOCK)
        WHERE CompId = @CompId AND RootId = @RootId;

        IF @Existing IS NOT NULL
        BEGIN
            ROLLBACK TRANSACTION;
            SELECT @Existing AS Id, 200 AS ResponseCode, 'A draft revision already exists' AS ResponseMess; RETURN;
        END

        INSERT INTO dbo.tblQuotation
            (CompId, LeadId, RootId, Revision, TemplateCode, Status, QuoteDate, ValidTill, Subject,
             ToName, ToCompany, ToMobile, ToEmail, ToAddress, ToCity, ToStateCode, ToPincode, ToGSTIN,
             SellerGSTIN, SellerStateCode, CompanyJSON, ContentJSON,
             SubTotal, DiscountTotal, TaxableTotal, CgstTotal, SgstTotal, IgstTotal, RoundOff, GrandTotal,
             CreatedBy, EditBy)
        SELECT CompId, LeadId, RootId, @NewRev, TemplateCode, 'draft', CAST(GETDATE() AS DATE),
               DATEADD(DAY, DATEDIFF(DAY, QuoteDate, ValidTill), CAST(GETDATE() AS DATE)), Subject,
               ToName, ToCompany, ToMobile, ToEmail, ToAddress, ToCity, ToStateCode, ToPincode, ToGSTIN,
               SellerGSTIN, SellerStateCode, CompanyJSON, ContentJSON,
               SubTotal, DiscountTotal, TaxableTotal, CgstTotal, SgstTotal, IgstTotal, RoundOff, GrandTotal,
               @UserId, @UserId
        FROM dbo.tblQuotation WHERE Id = @QuotationId AND CompId = @CompId;
        SET @NewId = CAST(SCOPE_IDENTITY() AS INT);

        INSERT INTO dbo.tblQuotationLine
            (CompId, QuotationId, SortOrder, ProductId, Description, HSNCode, Qty, Unit, Rate,
             DiscountType, DiscountValue, TaxPct, GrossAmt, DiscountAmt, TaxableAmt, CgstAmt, SgstAmt, IgstAmt, LineTotal)
        SELECT CompId, @NewId, SortOrder, ProductId, Description, HSNCode, Qty, Unit, Rate,
               DiscountType, DiscountValue, TaxPct, GrossAmt, DiscountAmt, TaxableAmt, CgstAmt, SgstAmt, IgstAmt, LineTotal
        FROM dbo.tblQuotationLine WHERE QuotationId = @QuotationId;

        DECLARE @actLog TABLE (Id INT, ResponseCode INT, ResponseMess NVARCHAR(200));
        DECLARE @Summary NVARCHAR(500) = N'Revision ' + CAST(@NewRev AS NVARCHAR(5)) + N' of ' + ISNULL(@SrcNo, N'the quotation') + N' started';
        DECLARE @Meta NVARCHAR(MAX) = (SELECT @NewId AS quotationId, @QuotationId AS fromQuotationId, 'revised' AS event
                                       FOR JSON PATH, WITHOUT_ARRAY_WRAPPER);
        INSERT INTO @actLog
        EXEC dbo.sp_LogLeadActivity @CompId = @CompId, @LeadId = @LeadId, @UserId = @UserId,
             @Type = 'quotation', @Summary = @Summary, @MetaJSON = @Meta;

        COMMIT TRANSACTION;
        SELECT @NewId AS Id, 200 AS ResponseCode, 'Revision started' AS ResponseMess;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SELECT @QuotationId AS Id, 500 AS ResponseCode, ERROR_MESSAGE() AS ResponseMess;
    END CATCH
END
GO

-- ---------------------------------------------------------------------------
-- 6.4 sp_RejectQuotation — the customer said no. final → rejected.
--     Remarks are optional: "too expensive" is worth having, but a required
--     field here would just collect "." . The lead is NOT touched — it stays
--     active; the agent revises, or marks the lead Lost with a reason.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_RejectQuotation
    @CompId      INT,
    @QuotationId INT,
    @UserId      INT,
    @Remarks     NVARCHAR(500) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @Status VARCHAR(20), @LeadId INT, @QuoteNo VARCHAR(30);
    SELECT @Status = Status, @LeadId = LeadId, @QuoteNo = QuoteNo
    FROM dbo.tblQuotation WHERE Id = @QuotationId AND CompId = @CompId;

    IF @Status IS NULL
    BEGIN SELECT @QuotationId AS Id, 404 AS ResponseCode, 'Quotation not found' AS ResponseMess; RETURN; END
    IF @UserId IS NULL OR @UserId <= 0
    BEGIN SELECT @QuotationId AS Id, 400 AS ResponseCode, 'UserId is required' AS ResponseMess; RETURN; END
    IF @Status <> 'final'
    BEGIN SELECT @QuotationId AS Id, 409 AS ResponseCode, 'Only a finalised quotation can be marked rejected' AS ResponseMess; RETURN; END

    SET @Remarks = NULLIF(LTRIM(RTRIM(@Remarks)), N'');

    BEGIN TRY
        BEGIN TRANSACTION;

        UPDATE dbo.tblQuotation
        SET Status = 'rejected', ClosedAt = GETDATE(), ClosedBy = @UserId, CloseRemarks = @Remarks,
            EditBy = @UserId, UpdatedAt = GETDATE()
        WHERE Id = @QuotationId AND CompId = @CompId AND Status = 'final';

        IF @@ROWCOUNT = 0
        BEGIN
            ROLLBACK TRANSACTION;
            SELECT @QuotationId AS Id, 409 AS ResponseCode, 'This quotation is no longer finalised' AS ResponseMess; RETURN;
        END

        DECLARE @actLog TABLE (Id INT, ResponseCode INT, ResponseMess NVARCHAR(200));
        DECLARE @Summary NVARCHAR(500) = N'Quotation ' + @QuoteNo + N' rejected' + ISNULL(N' — ' + @Remarks, N'');
        DECLARE @Meta NVARCHAR(MAX) = (SELECT @QuotationId AS quotationId, @QuoteNo AS quoteNo, 'rejected' AS event
                                       FOR JSON PATH, WITHOUT_ARRAY_WRAPPER);
        INSERT INTO @actLog
        EXEC dbo.sp_LogLeadActivity @CompId = @CompId, @LeadId = @LeadId, @UserId = @UserId,
             @Type = 'quotation', @Summary = @Summary, @MetaJSON = @Meta;

        COMMIT TRANSACTION;
        SELECT @QuotationId AS Id, 200 AS ResponseCode, 'Quotation marked rejected' AS ResponseMess;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SELECT @QuotationId AS Id, 500 AS ResponseCode, ERROR_MESSAGE() AS ResponseMess;
    END CATCH
END
GO

-- ---------------------------------------------------------------------------
-- 6.5 sp_DeleteQuotation — drafts only. An issued quotation is a record.
--     Lines go with it (FK cascade). The controller removes the draft's own
--     uploaded images afterwards.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_DeleteQuotation
    @CompId      INT,
    @QuotationId INT
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @Status VARCHAR(20) = (SELECT Status FROM dbo.tblQuotation WHERE Id = @QuotationId AND CompId = @CompId);
    IF @Status IS NULL
    BEGIN SELECT @QuotationId AS Id, 404 AS ResponseCode, 'Quotation not found' AS ResponseMess; RETURN; END
    IF @Status <> 'draft'
    BEGIN SELECT @QuotationId AS Id, 409 AS ResponseCode, 'Only a draft can be deleted' AS ResponseMess; RETURN; END

    BEGIN TRY
        DELETE FROM dbo.tblQuotation WHERE Id = @QuotationId AND CompId = @CompId AND Status = 'draft';
        SELECT @QuotationId AS Id, 200 AS ResponseCode, 'Draft deleted' AS ResponseMess;
    END TRY
    BEGIN CATCH
        SELECT @QuotationId AS Id, 500 AS ResponseCode, ERROR_MESSAGE() AS ResponseMess;
    END CATCH
END
GO

-- ---------------------------------------------------------------------------
-- 6.6 sp_FetchQuotations — the list, and (with @LeadId) a lead's own tab.
--     Visibility is the LEAD's: sp_FetchLeads' scope predicate, verbatim, on
--     the joined lead. Filters narrow inside it and never widen.
--     Superseded revisions are hidden unless asked for by name, so the list is
--     one row per live quotation rather than every version ever issued.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_FetchQuotations
    @CompId                  INT,
    @PageNumber              INT           = 1,
    @PageSize                INT           = 25,
    @SearchTerm              NVARCHAR(200) = NULL,
    @Status                  VARCHAR(20)   = NULL,
    @OwnerId                 INT           = NULL,
    @BranchId                INT           = NULL,
    @LeadId                  INT           = NULL,
    @FromDate                DATE          = NULL,
    @ToDate                  DATE          = NULL,
    @UserId                  INT           = NULL,
    @AccessibleBranchIdsJson NVARCHAR(MAX) = NULL,
    @OwnerIdsJson            NVARCHAR(MAX) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    SET @PageNumber = CASE WHEN ISNULL(@PageNumber, 1) < 1 THEN 1 ELSE @PageNumber END;
    SET @PageSize   = CASE WHEN ISNULL(@PageSize, 25) < 1 THEN 25 ELSE @PageSize END;
    IF @SearchTerm IS NOT NULL AND LTRIM(RTRIM(@SearchTerm)) = '' SET @SearchTerm = NULL;
    IF @Status     IS NOT NULL AND LTRIM(RTRIM(@Status))     = '' SET @Status = NULL;

    DECLARE @BranchIds TABLE (BranchId INT PRIMARY KEY);
    DECLARE @OwnerIds  TABLE (OwnerId  INT PRIMARY KEY);
    DECLARE @UseBranchScope BIT = 0, @UseOwnerScope BIT = 0;

    IF (@AccessibleBranchIdsJson IS NOT NULL AND @AccessibleBranchIdsJson <> '')
    BEGIN
        INSERT INTO @BranchIds (BranchId) SELECT DISTINCT CAST(value AS INT) FROM OPENJSON(@AccessibleBranchIdsJson);
        SET @UseBranchScope = 1;
    END
    IF (@OwnerIdsJson IS NOT NULL AND @OwnerIdsJson <> '')
    BEGIN
        INSERT INTO @OwnerIds (OwnerId) SELECT DISTINCT CAST(value AS INT) FROM OPENJSON(@OwnerIdsJson);
        SET @UseOwnerScope = 1;
    END

    DECLARE @Today DATE = CAST(GETDATE() AS DATE);

    DECLARE @Page TABLE (Id INT, rn INT);
    DECLARE @Total INT;

    ;WITH f AS (
        SELECT q.Id, q.CreatedAt
        FROM dbo.tblQuotation q
        JOIN dbo.tblLeads l ON l.Id = q.LeadId AND l.CompId = q.CompId
        WHERE q.CompId = @CompId
          AND (@LeadId   IS NULL OR q.LeadId   = @LeadId)
          AND (@BranchId IS NULL OR l.BranchId = @BranchId)
          AND (@OwnerId  IS NULL OR l.OwnerId  = @OwnerId)
          AND (@FromDate IS NULL OR q.QuoteDate >= @FromDate)
          AND (@ToDate   IS NULL OR q.QuoteDate <= @ToDate)
          AND ( (@Status IS NULL AND q.Status <> 'superseded') OR q.Status = @Status )
          AND (@SearchTerm IS NULL OR q.QuoteNo   LIKE '%' + @SearchTerm + '%'
                                  OR q.ToName    LIKE '%' + @SearchTerm + '%'
                                  OR q.ToCompany LIKE '%' + @SearchTerm + '%'
                                  OR l.Name      LIKE '%' + @SearchTerm + '%')
          AND (
                (    (@UseBranchScope = 0 OR l.BranchId IN (SELECT BranchId FROM @BranchIds))
                 AND (@UseOwnerScope  = 0 OR l.OwnerId  IN (SELECT OwnerId  FROM @OwnerIds)) )
             OR (@UserId IS NOT NULL AND (l.OwnerId = @UserId OR l.CreatedBy = @UserId))
              )
    )
    SELECT * INTO #f FROM f;

    SET @Total = (SELECT COUNT(*) FROM #f);

    INSERT INTO @Page (Id, rn)
    SELECT Id, ROW_NUMBER() OVER (ORDER BY CreatedAt DESC, Id DESC)
    FROM #f
    ORDER BY CreatedAt DESC, Id DESC
    OFFSET (@PageNumber - 1) * @PageSize ROWS FETCH NEXT @PageSize ROWS ONLY;

    -- Result set 1: the page
    SELECT q.Id, q.CompId, q.LeadId, l.Name AS LeadName, l.Company AS LeadCompany,
           q.RootId, q.Revision, q.QuoteNo, q.Status, q.TemplateCode, q.QuoteDate, q.ValidTill, q.Subject,
           q.ToName, q.ToCompany, q.TaxableTotal, q.GrandTotal,
           CAST(CASE WHEN q.Status = 'final' AND q.ValidTill IS NOT NULL AND q.ValidTill < @Today THEN 1 ELSE 0 END AS BIT) AS IsExpired,
           l.OwnerId, o.FullName AS OwnerName, l.BranchId, b.BranchName,
           q.CreatedBy, cu.FullName AS CreatedByName, q.CreatedAt, q.FinalisedAt, q.ClosedAt, q.CloseRemarks,
           200 AS ResponseCode, 'Quotations retrieved successfully' AS ResponseMess
    FROM @Page x
    JOIN dbo.tblQuotation q ON q.Id = x.Id
    JOIN dbo.tblLeads l     ON l.Id = q.LeadId
    LEFT JOIN dbo.tblUser o   ON o.Id  = l.OwnerId
    LEFT JOIN dbo.tblUser cu  ON cu.Id = q.CreatedBy
    LEFT JOIN dbo.tblBranch b ON b.Id  = l.BranchId
    ORDER BY x.rn;

    -- Result set 2: pagination
    SELECT @Total AS TotalRecords,
           CASE WHEN @Total = 0 THEN 0 ELSE CEILING(CAST(@Total AS FLOAT) / @PageSize) END AS TotalPages,
           @PageNumber AS CurrentPage,
           @PageSize   AS PageSize;

    DROP TABLE #f;
END
GO

-- ---------------------------------------------------------------------------
-- 6.7 sp_FetchQuotationDetail — 3 result sets
--       1 header   2 lines   3 every revision of the same root
--     RS1 carries the LEAD's OwnerId / BranchId / CreatedBy under exactly those
--     names: permission.canSeeRecord reads them, so a quotation is visible to
--     precisely the people its lead is visible to. The quotation's own creator
--     is QuoteCreatedBy.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_FetchQuotationDetail
    @CompId      INT,
    @QuotationId INT
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Today DATE = CAST(GETDATE() AS DATE);

    -- 1) header
    SELECT q.Id, q.CompId, q.LeadId, q.CustomerId, q.RootId, q.Revision, q.FinYear, q.SeqNo, q.QuoteNo,
           q.TemplateCode, q.Status, q.QuoteDate, q.ValidTill, q.Subject,
           q.ToName, q.ToCompany, q.ToMobile, q.ToEmail, q.ToAddress, q.ToCity, q.ToStateCode, q.ToPincode, q.ToGSTIN,
           q.SellerGSTIN, q.SellerStateCode, q.CompanyJSON, q.ContentJSON,
           q.SubTotal, q.DiscountTotal, q.TaxableTotal, q.CgstTotal, q.SgstTotal, q.IgstTotal, q.RoundOff, q.GrandTotal,
           q.FinalisedAt, q.FinalisedBy, q.ClosedAt, q.ClosedBy, q.CloseRemarks,
           CAST(CASE WHEN q.Status = 'final' AND q.ValidTill IS NOT NULL AND q.ValidTill < @Today THEN 1 ELSE 0 END AS BIT) AS IsExpired,
           l.Name AS LeadName, l.Company AS LeadCompany, st.Code AS LeadStatusCode, l.EstValue AS LeadEstValue,
           l.ProductId AS LeadProductId,
           l.OwnerId, o.FullName AS OwnerName, l.BranchId, b.BranchName, l.CreatedBy,
           q.CreatedBy AS QuoteCreatedBy, cu.FullName AS QuoteCreatedByName, q.CreatedAt, q.UpdatedAt,
           200 AS ResponseCode, 'Quotation retrieved successfully' AS ResponseMess
    FROM dbo.tblQuotation q
    JOIN dbo.tblLeads l        ON l.Id = q.LeadId AND l.CompId = q.CompId
    JOIN dbo.tblLookup st      ON st.Id = l.StatusId
    LEFT JOIN dbo.tblUser o    ON o.Id  = l.OwnerId
    LEFT JOIN dbo.tblUser cu   ON cu.Id = q.CreatedBy
    LEFT JOIN dbo.tblBranch b  ON b.Id  = l.BranchId
    WHERE q.Id = @QuotationId AND q.CompId = @CompId;

    -- 2) lines
    SELECT ln.Id, ln.SortOrder, ln.ProductId, ln.Description, ln.HSNCode, ln.Qty, ln.Unit, ln.Rate,
           ln.DiscountType, ln.DiscountValue, ln.TaxPct,
           ln.GrossAmt, ln.DiscountAmt, ln.TaxableAmt, ln.CgstAmt, ln.SgstAmt, ln.IgstAmt, ln.LineTotal
    FROM dbo.tblQuotationLine ln
    WHERE ln.QuotationId = @QuotationId AND ln.CompId = @CompId
    ORDER BY ln.SortOrder, ln.Id;

    -- 3) revisions of the same root, newest first
    SELECT r.Id, r.Revision, r.QuoteNo, r.Status, r.GrandTotal, r.QuoteDate, r.FinalisedAt, r.ClosedAt, r.CloseRemarks
    FROM dbo.tblQuotation r
    WHERE r.CompId = @CompId
      AND r.RootId = (SELECT RootId FROM dbo.tblQuotation WHERE Id = @QuotationId AND CompId = @CompId)
    ORDER BY r.Revision DESC;
END
GO

-- ===== 7. Procedures — convert engine (sp_ConvertLead, sp_SetLeadStatus)

-- ---------------------------------------------------------------------------
-- 7.1 sp_ConvertLead — the proc sp_SetLeadStatus has been pointing at since
--     071 ("Use convert to move a lead to Converted") and which never existed.
--
--     ONE engine writes a win. "Accepted" on a quotation and "Won" in the
--     lead's status dropdown both land here; the only difference is where the
--     value comes from:
--        with @QuotationId → the quotation's BEFORE-TAX total (GST is not
--                            revenue); any @WonValue passed is ignored
--        without           → @WonValue, typed by the agent (small leads are
--                            won without a quotation — spec decision 6)
--
--     It also does what "convert" has always meant in this product: the
--     prospect becomes a customer. An active tblCustomer with the lead's mobile
--     is LINKED (a repeat buyer must not become a duplicate); otherwise one is
--     created from the lead. Mobiles are 10 digits on both sides (§1), so the
--     match is reliable.
--
--     Idempotent: a lead that is already won answers 200 and changes nothing.
--     tblLeadStatusHistory now has three writers — sp_SaveLead (insert),
--     sp_SetLeadStatus, and this.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_ConvertLead
    @CompId      INT,
    @LeadId      INT,
    @UserId      INT,
    @WonValue    DECIMAL(18,2) = NULL,
    @Remarks     NVARCHAR(500) = NULL,
    @QuotationId INT           = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF @CompId IS NULL OR @CompId <= 0
    BEGIN SELECT @LeadId AS Id, 400 AS ResponseCode, 'CompId is required' AS ResponseMess, CAST(NULL AS INT) AS CustomerId, CAST(NULL AS DECIMAL(18,2)) AS WonValue; RETURN; END
    IF @LeadId IS NULL OR @LeadId <= 0
    BEGIN SELECT @LeadId AS Id, 400 AS ResponseCode, 'LeadId is required' AS ResponseMess, CAST(NULL AS INT) AS CustomerId, CAST(NULL AS DECIMAL(18,2)) AS WonValue; RETURN; END
    IF @UserId IS NULL OR @UserId <= 0
    BEGIN SELECT @LeadId AS Id, 400 AS ResponseCode, 'UserId is required' AS ResponseMess, CAST(NULL AS INT) AS CustomerId, CAST(NULL AS DECIMAL(18,2)) AS WonValue; RETURN; END
    IF @QuotationId IS NOT NULL AND @QuotationId <= 0 SET @QuotationId = NULL;
    SET @Remarks = NULLIF(LTRIM(RTRIM(@Remarks)), N'');

    DECLARE @FromStatusId INT, @FromCode VARCHAR(30), @FromName NVARCHAR(200),
            @BranchId INT, @CustomerId INT, @CurWon DECIMAL(18,2),
            @LName NVARCHAR(200), @LCompany NVARCHAR(200), @LMobile VARCHAR(20), @LAlt VARCHAR(20),
            @LEmail NVARCHAR(200), @LAddress NVARCHAR(500), @LCity NVARCHAR(100), @LState NVARCHAR(100), @LPin VARCHAR(10);

    SELECT @FromStatusId = l.StatusId, @FromCode = st.Code, @FromName = st.Value,
           @BranchId = l.BranchId, @CustomerId = l.CustomerId, @CurWon = l.WonValue,
           @LName = l.Name, @LCompany = NULLIF(LTRIM(RTRIM(l.Company)), N''), @LMobile = l.MobileNo, @LAlt = l.AltMobile,
           @LEmail = l.Email, @LAddress = l.Address, @LCity = l.City, @LState = l.State, @LPin = l.Pincode
    FROM dbo.tblLeads l JOIN dbo.tblLookup st ON st.Id = l.StatusId
    WHERE l.Id = @LeadId AND l.CompId = @CompId;

    IF @FromStatusId IS NULL
    BEGIN SELECT @LeadId AS Id, 404 AS ResponseCode, 'Lead not found' AS ResponseMess, CAST(NULL AS INT) AS CustomerId, CAST(NULL AS DECIMAL(18,2)) AS WonValue; RETURN; END
    IF @FromCode = 'converted'
    BEGIN SELECT @LeadId AS Id, 200 AS ResponseCode, 'Lead is already won' AS ResponseMess, @CustomerId AS CustomerId, @CurWon AS WonValue; RETURN; END
    IF @FromCode NOT IN ('open','qualified')
    BEGIN SELECT @LeadId AS Id, 409 AS ResponseCode, 'Only an active lead can be marked won — reopen it first' AS ResponseMess, CAST(NULL AS INT) AS CustomerId, CAST(NULL AS DECIMAL(18,2)) AS WonValue; RETURN; END

    DECLARE @WonStatusId INT, @ToName NVARCHAR(200);
    SELECT TOP 1 @WonStatusId = Id, @ToName = Value FROM dbo.tblLookup
    WHERE CompId = @CompId AND Kind = 'lead_status' AND Code = 'converted' AND IsActive = 1
    ORDER BY SortOrder, Id;
    IF @WonStatusId IS NULL
    BEGIN SELECT @LeadId AS Id, 400 AS ResponseCode, 'No Won status is configured for this company' AS ResponseMess, CAST(NULL AS INT) AS CustomerId, CAST(NULL AS DECIMAL(18,2)) AS WonValue; RETURN; END

    DECLARE @QuoteNo VARCHAR(30), @QuoteGstin VARCHAR(15);
    IF @QuotationId IS NOT NULL
    BEGIN
        DECLARE @QStatus VARCHAR(20);
        SELECT @QStatus = Status, @QuoteNo = QuoteNo, @WonValue = TaxableTotal, @QuoteGstin = ToGSTIN
        FROM dbo.tblQuotation WHERE Id = @QuotationId AND CompId = @CompId AND LeadId = @LeadId;
        IF @QStatus IS NULL
        BEGIN SELECT @LeadId AS Id, 404 AS ResponseCode, 'That quotation does not belong to this lead' AS ResponseMess, CAST(NULL AS INT) AS CustomerId, CAST(NULL AS DECIMAL(18,2)) AS WonValue; RETURN; END
        IF @QStatus <> 'final'
        BEGIN SELECT @LeadId AS Id, 409 AS ResponseCode, 'Only a finalised quotation can be accepted' AS ResponseMess, CAST(NULL AS INT) AS CustomerId, CAST(NULL AS DECIMAL(18,2)) AS WonValue; RETURN; END
    END
    ELSE IF @WonValue IS NULL OR @WonValue < 0
    BEGIN SELECT @LeadId AS Id, 400 AS ResponseCode, 'Enter the value this lead was won for' AS ResponseMess, CAST(NULL AS INT) AS CustomerId, CAST(NULL AS DECIMAL(18,2)) AS WonValue; RETURN; END

    BEGIN TRY
        BEGIN TRANSACTION;

        -- LOCK ORDER, and why this proc takes it in exactly this direction:
        --   tblCustomer → tblLeads → tblQuotation → tblLeadActivity
        -- sp_SetLeadStatus (7.2) writes tblLeads then tblQuotation, so this
        -- proc must too — taking the quotation first would close a deadlock
        -- cycle with an agent moving the same lead to lost at the same moment.
        -- The other four writers of tblQuotation.Status (save, finalise,
        -- revise, reject) read tblLeads BEFORE their transaction opens and so
        -- never hold a quotation lock while asking for a lead row; their own
        -- order, tblQuotation → tblQuotationLine → tblLeadActivity, is a
        -- suffix of this one and stays intact.

        -- The customer: keep the link the lead already has, else match on the
        -- mobile, else create.
        IF @CustomerId IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM dbo.tblCustomer WHERE Id = @CustomerId AND CompId = @CompId AND IsActive = 1)
            SET @CustomerId = NULL;

        IF @CustomerId IS NULL AND @LMobile IS NOT NULL
            SELECT TOP 1 @CustomerId = Id FROM dbo.tblCustomer WITH (UPDLOCK, HOLDLOCK)
            WHERE CompId = @CompId AND Mobile = @LMobile AND IsActive = 1 ORDER BY Id;

        IF @CustomerId IS NULL
        BEGIN
            INSERT INTO dbo.tblCustomer
                (CompId, BranchId, Name, ContactPerson, Mobile, AltMobile, Email,
                 Address, City, State, Pincode, GSTIN, Remarks, IsActive, CreatedBy, EditBy, CreatedAt)
            VALUES
                (@CompId, @BranchId, ISNULL(@LCompany, @LName), CASE WHEN @LCompany IS NOT NULL THEN @LName END,
                 @LMobile, @LAlt, @LEmail, @LAddress, @LCity, @LState, @LPin, @QuoteGstin,
                 NULL, 1, @UserId, @UserId, GETDATE());
            SET @CustomerId = CAST(SCOPE_IDENTITY() AS INT);
        END
        ELSE IF @QuoteGstin IS NOT NULL
            UPDATE dbo.tblCustomer SET GSTIN = @QuoteGstin, EditBy = @UserId, UpdatedAt = GETDATE()
            WHERE Id = @CustomerId AND CompId = @CompId AND GSTIN IS NULL;

        -- The win.
        DECLARE @hist TABLE (FromStatusId INT);
        UPDATE dbo.tblLeads
        SET StatusId = @WonStatusId, WonAt = GETDATE(), WonValue = @WonValue, CustomerId = @CustomerId,
            LostAt = NULL, LostReasonId = NULL, EditBy = @UserId, UpdatedAt = GETDATE()
        OUTPUT deleted.StatusId INTO @hist (FromStatusId)
        WHERE Id = @LeadId AND CompId = @CompId;

        INSERT INTO dbo.tblLeadStatusHistory (CompId, LeadId, FromStatusId, ToStatusId, ChangedBy, ChangedAt)
        SELECT @CompId, @LeadId, h.FromStatusId, @WonStatusId, @UserId, GETDATE() FROM @hist h;

        -- Its quotations: the accepted one, and everything else on the lead.
        --
        -- This is the FIFTH writer of tblQuotation.Status, and it wears the
        -- same race guard as finalise: re-read the row under UPDLOCK, re-assert
        -- the status the decision above was made on, guard the UPDATE itself
        -- with that status and check @@ROWCOUNT. The `IS NULL` arm is not
        -- decoration — `SELECT @v = col` leaves @v untouched when no row
        -- matches, and NULL <> 'final' is UNKNOWN, not TRUE, so a row deleted
        -- in the gap would otherwise fall straight through.
        -- @WonValue was read from this row before the transaction and is
        -- already on the lead by now; re-reading TaxableTotal here would buy
        -- nothing, because only sp_SaveQuotation writes the totals and it
        -- refuses anything that is not a draft — a row still 'final' under the
        -- lock has the same total it had a moment ago.
        IF @QuotationId IS NOT NULL
        BEGIN
            DECLARE @LockStatus VARCHAR(20);
            SELECT @LockStatus = Status FROM dbo.tblQuotation WITH (UPDLOCK)
            WHERE Id = @QuotationId AND CompId = @CompId AND LeadId = @LeadId;

            IF @LockStatus IS NULL OR @LockStatus <> 'final'
            BEGIN
                ROLLBACK TRANSACTION;
                SELECT @LeadId AS Id, 409 AS ResponseCode, 'Only a finalised quotation can be accepted' AS ResponseMess, CAST(NULL AS INT) AS CustomerId, CAST(NULL AS DECIMAL(18,2)) AS WonValue; RETURN;
            END

            UPDATE dbo.tblQuotation
            SET Status = 'accepted', CustomerId = @CustomerId, ClosedAt = GETDATE(), ClosedBy = @UserId,
                CloseRemarks = @Remarks, EditBy = @UserId, UpdatedAt = GETDATE()
            WHERE Id = @QuotationId AND CompId = @CompId AND Status = 'final';

            IF @@ROWCOUNT = 0
            BEGIN
                ROLLBACK TRANSACTION;
                SELECT @LeadId AS Id, 409 AS ResponseCode, 'Only a finalised quotation can be accepted' AS ResponseMess, CAST(NULL AS INT) AS CustomerId, CAST(NULL AS DECIMAL(18,2)) AS WonValue; RETURN;
            END
        END

        -- The sweep needs no re-read: the status it requires is in its own
        -- WHERE, so the test and the write are one atomic statement. Zero rows
        -- is a legitimate answer here (a lead won without a quotation), which
        -- is why this one is not @@ROWCOUNT-checked.
        UPDATE dbo.tblQuotation
        SET Status = 'unused', ClosedAt = GETDATE(), ClosedBy = @UserId,
            CloseRemarks = CASE WHEN @QuoteNo IS NOT NULL THEN N'Lead won on ' + @QuoteNo ELSE N'Lead won without a quotation' END
        WHERE CompId = @CompId AND LeadId = @LeadId AND Status IN ('draft','final')
          AND (@QuotationId IS NULL OR Id <> @QuotationId);

        DECLARE @actLog TABLE (Id INT, ResponseCode INT, ResponseMess NVARCHAR(200));
        -- 500, matching sp_LogLeadActivity's own @Summary: a wider variable only
        -- moves the truncation to the EXEC, where it is invisible.
        DECLARE @Summary NVARCHAR(500) = N'Status: ' + @FromName + N' → ' + @ToName
                                        + N' · value ' + CAST(@WonValue AS NVARCHAR(30))
                                        + ISNULL(N' · ' + @QuoteNo, N'')
                                        + ISNULL(N' — ' + @Remarks, N'');
        DECLARE @Meta NVARCHAR(MAX) = (SELECT @FromStatusId AS fromStatusId, @WonStatusId AS toStatusId,
                                              @FromCode AS fromCode, 'converted' AS toCode,
                                              @WonValue AS wonValue, @QuotationId AS quotationId,
                                              @CustomerId AS customerId, @Remarks AS remarks
                                       FOR JSON PATH, WITHOUT_ARRAY_WRAPPER);
        INSERT INTO @actLog
        EXEC dbo.sp_LogLeadActivity @CompId = @CompId, @LeadId = @LeadId, @UserId = @UserId,
             @Type = 'status', @Summary = @Summary, @MetaJSON = @Meta;

        COMMIT TRANSACTION;
        SELECT @LeadId AS Id, 200 AS ResponseCode, 'Lead marked won' AS ResponseMess, @CustomerId AS CustomerId, @WonValue AS WonValue;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        -- 2601 / 2627: someone created a customer with this mobile a moment ago.
        IF ERROR_NUMBER() IN (2601, 2627)
            SELECT @LeadId AS Id, 409 AS ResponseCode, 'A customer with this mobile was just created — please try again' AS ResponseMess, CAST(NULL AS INT) AS CustomerId, CAST(NULL AS DECIMAL(18,2)) AS WonValue;
        ELSE
            SELECT @LeadId AS Id, 500 AS ResponseCode, ERROR_MESSAGE() AS ResponseMess, CAST(NULL AS INT) AS CustomerId, CAST(NULL AS DECIMAL(18,2)) AS WonValue;
    END CATCH
END
GO

-- ---------------------------------------------------------------------------
-- 7.2 sp_SetLeadStatus — unchanged from 075 except three things. The refusal
--     of 'converted' STAYS: a win is written by sp_ConvertLead and nowhere else.
--       a. any move made here clears WonAt / WonValue. This proc can never set
--          them, so the only lead that has them is one LEAVING 'converted' —
--          an agent undoing a mistaken win.
--       b. …and that lead's accepted quotation goes back to 'final'. The
--          customer record and tblLeads.CustomerId stay: a complaint may
--          already hang off that customer.
--       c. → lost / junk closes the lead's open quotations as 'unused'.
--
--     Both quotation writes carry the status they require in their own WHERE,
--     so the test and the write are one atomic statement — no read-then-write
--     gap to lock against. Lock order is tblLeads → tblQuotation →
--     tblLeadActivity, the same direction sp_ConvertLead takes.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_SetLeadStatus
    @CompId       INT,
    @LeadId       INT,
    @StatusId     INT,
    @LostReasonId INT = NULL,
    @UserId       INT
AS
BEGIN
    SET NOCOUNT ON;

    IF @CompId IS NULL OR @CompId <= 0
    BEGIN SELECT @LeadId AS Id, 400 AS ResponseCode, 'CompId is required' AS ResponseMess; RETURN; END
    IF @LeadId IS NULL OR @LeadId <= 0
    BEGIN SELECT @LeadId AS Id, 400 AS ResponseCode, 'LeadId is required' AS ResponseMess; RETURN; END
    IF @StatusId IS NULL OR @StatusId <= 0
    BEGIN SELECT @LeadId AS Id, 400 AS ResponseCode, 'StatusId is required' AS ResponseMess; RETURN; END
    IF @UserId IS NULL OR @UserId <= 0
    BEGIN SELECT @LeadId AS Id, 400 AS ResponseCode, 'UserId is required' AS ResponseMess; RETURN; END

    DECLARE @FromStatusId INT, @FromCode VARCHAR(30), @FromName NVARCHAR(200);
    SELECT @FromStatusId = l.StatusId, @FromCode = st.Code, @FromName = st.Value
    FROM dbo.tblLeads l JOIN dbo.tblLookup st ON st.Id = l.StatusId
    WHERE l.Id = @LeadId AND l.CompId = @CompId;
    IF @FromStatusId IS NULL
    BEGIN SELECT @LeadId AS Id, 404 AS ResponseCode, 'Lead not found' AS ResponseMess; RETURN; END

    DECLARE @ToCode VARCHAR(30), @ToName NVARCHAR(200);
    SELECT @ToCode = Code, @ToName = Value FROM dbo.tblLookup
    WHERE Id = @StatusId AND CompId = @CompId AND Kind = 'lead_status' AND IsActive = 1;
    IF @ToCode IS NULL
    BEGIN SELECT @LeadId AS Id, 404 AS ResponseCode, 'Status not found' AS ResponseMess; RETURN; END

    IF @ToCode = 'converted'
    BEGIN SELECT @LeadId AS Id, 400 AS ResponseCode, 'Use convert to move a lead to Converted' AS ResponseMess; RETURN; END

    IF @ToCode = 'lost' AND (@LostReasonId IS NULL OR @LostReasonId <= 0)
    BEGIN SELECT @LeadId AS Id, 400 AS ResponseCode, 'Lost reason required' AS ResponseMess; RETURN; END
    IF @ToCode = 'lost'
       AND NOT EXISTS (SELECT 1 FROM dbo.tblLookup WHERE Id=@LostReasonId AND CompId=@CompId AND Kind='lost_reason')
    BEGIN SELECT @LeadId AS Id, 400 AS ResponseCode, 'Invalid lost reason' AS ResponseMess; RETURN; END

    IF @FromStatusId = @StatusId
    BEGIN SELECT @LeadId AS Id, 200 AS ResponseCode, 'Lead already in this status' AS ResponseMess; RETURN; END

    BEGIN TRY
        BEGIN TRANSACTION;

        DECLARE @actLog TABLE (Id INT, ResponseCode INT, ResponseMess NVARCHAR(200));
        DECLARE @hist   TABLE (FromStatusId INT);

        UPDATE dbo.tblLeads
        SET StatusId = @StatusId,
            LostAt       = CASE WHEN @ToCode = 'lost' THEN GETDATE() ELSE NULL END,
            LostReasonId = CASE WHEN @ToCode = 'lost' THEN @LostReasonId ELSE NULL END,
            WonAt = NULL, WonValue = NULL,                       -- (a)
            EditBy = @UserId, UpdatedAt = GETDATE()
        OUTPUT deleted.StatusId INTO @hist (FromStatusId)
        WHERE Id = @LeadId AND CompId = @CompId;

        -- 075: the transition, in the same transaction as the update. The source
        -- status comes from the UPDATE's own OUTPUT, not the @FromStatusId read
        -- before the transaction — two concurrent changes would otherwise both
        -- record the same source.
        INSERT INTO dbo.tblLeadStatusHistory (CompId, LeadId, FromStatusId, ToStatusId, ChangedBy, ChangedAt)
        SELECT @CompId, @LeadId, h.FromStatusId, @StatusId, @UserId, GETDATE() FROM @hist h;

        -- (b) a win undone: its quotation is a live offer again.
        IF @FromCode = 'converted'
            UPDATE dbo.tblQuotation
            SET Status = 'final', CustomerId = NULL, ClosedAt = NULL, ClosedBy = NULL, CloseRemarks = NULL,
                EditBy = @UserId, UpdatedAt = GETDATE()
            WHERE CompId = @CompId AND LeadId = @LeadId AND Status = 'accepted';

        -- (c) a dead lead has no open offers.
        IF @ToCode IN ('lost','junk')
            UPDATE dbo.tblQuotation
            SET Status = 'unused', ClosedAt = GETDATE(), ClosedBy = @UserId,
                CloseRemarks = N'Lead marked ' + @ToName
            WHERE CompId = @CompId AND LeadId = @LeadId AND Status IN ('draft','final');

        DECLARE @Summary NVARCHAR(500) = N'Status: ' + @FromName + N' → ' + @ToName;
        DECLARE @Meta NVARCHAR(MAX) = (SELECT @FromStatusId AS fromStatusId, @StatusId AS toStatusId,
                                              @FromCode AS fromCode, @ToCode AS toCode,
                                              @LostReasonId AS lostReasonId
                                       FOR JSON PATH, WITHOUT_ARRAY_WRAPPER);
        INSERT INTO @actLog
        EXEC dbo.sp_LogLeadActivity
            @CompId = @CompId, @LeadId = @LeadId, @UserId = @UserId,
            @Type = 'status', @Summary = @Summary, @MetaJSON = @Meta;

        COMMIT TRANSACTION;

        SELECT @LeadId AS Id, 200 AS ResponseCode, 'Lead status updated successfully' AS ResponseMess;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SELECT @LeadId AS Id, 500 AS ResponseCode, ERROR_MESSAGE() AS ResponseMess;
    END CATCH
END
GO

-- ===== 8. Procedures — altered reads/writes (sp_FetchLeads, sp_FetchLeadDetail, sp_DeleteLead, sp_SaveCustomer, sp_FetchCustomers, sp_FetchCustomerDetail, sp_SaveProduct, sp_FetchProducts, sp_SaveLookup, sp_DeleteLookup)

-- ---------------------------------------------------------------------------
-- 8.0 #Patch091 — swap ONE exact single-line fragment inside a live proc.
--     Used for long read procs whose change is one line: re-typing an 8 KB
--     report by hand is how a second, unrelated bug gets in.
--       @Marker  present  → already patched, do nothing (idempotent)
--       @Old     absent   → the definition has drifted: THROW, do not guess
--     The first CREATE that is followed by PROC becomes ALTER; any other
--     "CREATE" in a comment is left alone.
-- ---------------------------------------------------------------------------
IF OBJECT_ID('tempdb..#Patch091') IS NOT NULL DROP PROC #Patch091;
GO
CREATE PROC #Patch091
    @Proc   SYSNAME,
    @Marker NVARCHAR(400),
    @Old    NVARCHAR(MAX),
    @New    NVARCHAR(MAX)
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @def NVARCHAR(MAX) = (SELECT definition FROM sys.sql_modules WHERE object_id = OBJECT_ID(@Proc));
    DECLARE @msg NVARCHAR(400);

    IF @def IS NULL
    BEGIN SET @msg = N'091: ' + @Proc + N' not found'; THROW 51091, @msg, 1; END
    IF CHARINDEX(@Marker, @def) > 0 RETURN;
    IF CHARINDEX(@Old, @def) = 0
    BEGIN SET @msg = N'091: expected text not found in ' + @Proc + N' — definition has drifted, patch by hand'; THROW 51092, @msg, 1; END

    SET @def = REPLACE(@def, @Old, @New);

    -- sys.sql_modules holds the text of the LAST create-or-alter, and SQL Server
    -- stores the verb as submitted rather than normalising it (which is why the
    -- untouched procs read 'CREATE   PROC' — the triple space is where
    -- 'OR ALTER' was blanked). So the FIRST patch of a proc reads CREATE and
    -- rewrites it to ALTER, and every patch after that reads back ALTER.
    -- Scanning for CREATE alone therefore works exactly once per proc, and the
    -- second patch of sp_FetchLeadDetail or sp_RptFunnel would THROW 51093 and
    -- take §§9-11 down with it. Accept either verb; rewrite only CREATE.
    DECLARE @i INT = 0, @vlen INT = 0;

    DECLARE @c INT = CHARINDEX('CREATE', @def);
    WHILE @c > 0 AND LTRIM(SUBSTRING(@def, @c + 6, 30)) NOT LIKE 'PROC%'
        SET @c = CHARINDEX('CREATE', @def, @c + 6);

    -- 'ALTER TABLE', 'altered' and the like fail the same PROC test that skips
    -- 'CreatedAt' on the CREATE pass.
    DECLARE @a INT = CHARINDEX('ALTER', @def);
    WHILE @a > 0 AND LTRIM(SUBSTRING(@def, @a + 5, 30)) NOT LIKE 'PROC%'
        SET @a = CHARINDEX('ALTER', @def, @a + 5);

    -- The header is whichever comes first; anything later is inside the body.
    IF @c > 0 AND (@a = 0 OR @c < @a) SELECT @i = @c, @vlen = 6;
    ELSE IF @a > 0                    SELECT @i = @a, @vlen = 5;

    IF @i = 0
    BEGIN SET @msg = N'091: no CREATE/ALTER PROC header found in ' + @Proc; THROW 51093, @msg, 1; END
    IF @vlen = 6 SET @def = STUFF(@def, @i, 6, 'ALTER');   -- already ALTER: leave it alone

    EXEC sys.sp_executesql @def;
END
GO

-- 8.1 / 8.2  Lead reads return the win. Detail also names the customer.
BEGIN TRY
    EXEC #Patch091 'dbo.sp_FetchLeads', 'l.WonValue',
        'l.LostReasonId, l.WonAt, l.LostAt, l.AssignedAt,',
        'l.LostReasonId, l.WonAt, l.WonValue, l.CustomerId, l.LostAt, l.AssignedAt,';

    -- ORDER MATTERS between these two. Each patch re-executes the whole proc as
    -- ALTER, and ALTER binds every column reference at compile time — deferred
    -- name resolution covers a missing TABLE, not an alias that is not in scope.
    -- Adding `cust.Name` before the join that introduces `cust` therefore fails
    -- with 4104. The join goes on first; an unused LEFT JOIN compiles fine.
    DECLARE @join NVARCHAR(400) = 'LEFT JOIN dbo.tblBranch b   ON b.Id   = l.BranchId' + CHAR(13) + CHAR(10)
                                + '    LEFT JOIN dbo.tblCustomer cust ON cust.Id = l.CustomerId AND cust.CompId = l.CompId';
    EXEC #Patch091 'dbo.sp_FetchLeadDetail', 'tblCustomer cust',
        'LEFT JOIN dbo.tblBranch b   ON b.Id   = l.BranchId', @join;

    EXEC #Patch091 'dbo.sp_FetchLeadDetail', 'l.WonValue',
        'l.LostReasonId, lr.Value AS LostReason, l.WonAt, l.LostAt, l.AssignedAt,',
        'l.LostReasonId, lr.Value AS LostReason, l.WonAt, l.WonValue, l.CustomerId, cust.Name AS CustomerName, l.LostAt, l.AssignedAt,';

    -- 8.5 / 8.6  Customer reads return the GSTIN.
    EXEC #Patch091 'dbo.sp_FetchCustomers', 'c.GSTIN',
        'c.Address, c.City, c.State, c.Pincode, c.Remarks, c.IsActive,',
        'c.Address, c.City, c.State, c.Pincode, c.GSTIN, c.Remarks, c.IsActive,';
    EXEC #Patch091 'dbo.sp_FetchCustomerDetail', 'c.GSTIN',
        'c.Address, c.City, c.State, c.Pincode, c.Remarks, c.IsActive,',
        'c.Address, c.City, c.State, c.Pincode, c.GSTIN, c.Remarks, c.IsActive,';
END TRY
BEGIN CATCH
    DECLARE @m8 NVARCHAR(2048) = ERROR_MESSAGE();
    RAISERROR('091 §8 read-proc patches ABORTED — %s', 16, 1, @m8);
    SET NOEXEC ON;
END CATCH
GO

-- ---------------------------------------------------------------------------
-- 8.3 sp_DeleteLead — + a lead that has ANY quotation cannot be deleted.
--     Leads carry no DB-level FKs; this proc clears children by hand. An issued
--     quotation is a business record, and silently deleting drafts would orphan
--     the images uploaded to them. The user deletes the drafts first.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_DeleteLead
    @Id     INT,
    @CompId INT
AS
BEGIN
    SET NOCOUNT ON;

    IF @Id IS NULL OR @Id <= 0
    BEGIN SELECT 400 AS ResponseCode, 'Id is required' AS ResponseMess; RETURN; END
    IF @CompId IS NULL OR @CompId <= 0
    BEGIN SELECT 400 AS ResponseCode, 'CompId is required' AS ResponseMess; RETURN; END
    IF NOT EXISTS (SELECT 1 FROM dbo.tblLeads WHERE Id=@Id AND CompId=@CompId)
    BEGIN SELECT 404 AS ResponseCode, 'Lead not found' AS ResponseMess; RETURN; END
    IF EXISTS (SELECT 1 FROM dbo.tblQuotation WHERE LeadId=@Id AND CompId=@CompId)
    BEGIN SELECT 409 AS ResponseCode, 'This lead has quotations and cannot be deleted' AS ResponseMess; RETURN; END

    BEGIN TRY
        BEGIN TRANSACTION;

        -- No DB-level FKs (integrity lives in SPs): clear children explicitly.
        DELETE FROM dbo.tblCustomFieldValue WHERE Entity='lead' AND EntityId=@Id AND CompId=@CompId;
        DELETE FROM dbo.tblCall             WHERE LeadId=@Id AND CompId=@CompId;
        DELETE FROM dbo.tblLeadActivity     WHERE LeadId=@Id AND CompId=@CompId;
        DELETE FROM dbo.tblFollowUp         WHERE LeadId=@Id AND CompId=@CompId;
        DELETE FROM dbo.tblLeadAssignment   WHERE LeadId=@Id AND CompId=@CompId;
        DELETE FROM dbo.tblLeads            WHERE Id=@Id AND CompId=@CompId;

        COMMIT TRANSACTION;

        SELECT 200 AS ResponseCode, 'Lead deleted successfully' AS ResponseMess;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
        SELECT 500 AS ResponseCode, ERROR_MESSAGE() AS ResponseMess;
    END CATCH
END
GO

-- ---------------------------------------------------------------------------
-- 8.4 sp_SaveCustomer — + @GSTIN; and the mobile rule becomes TEN DIGITS.
--     The old checks allowed '+' and any length, which is how '+919310500657'
--     and '111' got in. The backend normalises before calling; this makes the
--     SP say the same thing in words instead of tripping the CHECK constraint.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_SaveCustomer
    @Id            INT            = 0,
    @CompId        INT,
    @BranchId      INT,
    @UserId        INT,
    @Name          NVARCHAR(200),
    @ContactPerson NVARCHAR(200)  = NULL,
    @Mobile        VARCHAR(20)    = NULL,
    @AltMobile     VARCHAR(20)    = NULL,
    @Email         NVARCHAR(200)  = NULL,
    @Address       NVARCHAR(500)  = NULL,
    @City          NVARCHAR(100)  = NULL,
    @State         NVARCHAR(100)  = NULL,
    @Pincode       VARCHAR(10)    = NULL,
    @Remarks       NVARCHAR(MAX)  = NULL,
    @GSTIN         VARCHAR(15)    = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET @Id = ISNULL(@Id, 0);

    IF @CompId IS NULL OR @CompId <= 0
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'CompId is required' AS ResponseMess; RETURN; END
    IF @UserId IS NULL OR @UserId <= 0
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'UserId is required' AS ResponseMess; RETURN; END
    IF @Id = 0 AND (@BranchId IS NULL OR @BranchId <= 0)
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'BranchId is required' AS ResponseMess; RETURN; END

    SET @Name          = NULLIF(LTRIM(RTRIM(@Name)), N'');
    SET @ContactPerson = NULLIF(LTRIM(RTRIM(@ContactPerson)), N'');
    SET @Email         = NULLIF(LTRIM(RTRIM(@Email)), N'');
    SET @Mobile        = NULLIF(REPLACE(REPLACE(LTRIM(RTRIM(@Mobile)),    ' ', ''), '-', ''), '');
    SET @AltMobile     = NULLIF(REPLACE(REPLACE(LTRIM(RTRIM(@AltMobile)), ' ', ''), '-', ''), '');
    SET @GSTIN         = NULLIF(UPPER(REPLACE(LTRIM(RTRIM(@GSTIN)), ' ', '')), '');

    IF @Name IS NULL
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'Name is required' AS ResponseMess; RETURN; END
    IF @Mobile IS NULL AND @Email IS NULL
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'A mobile number or an email is required' AS ResponseMess; RETURN; END
    IF @Mobile IS NOT NULL AND @Mobile NOT LIKE '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'Mobile number must be 10 digits' AS ResponseMess; RETURN; END
    IF @AltMobile IS NOT NULL AND @AltMobile NOT LIKE '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'Alternate mobile must be 10 digits' AS ResponseMess; RETURN; END
    IF @Email IS NOT NULL AND @Email NOT LIKE '%_@_%'
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'Invalid email' AS ResponseMess; RETURN; END
    IF @GSTIN IS NOT NULL AND (LEN(@GSTIN) <> 15 OR @GSTIN NOT LIKE '[0-9][0-9]%' OR @GSTIN LIKE '%[^0-9A-Z]%')
    BEGIN SELECT @Id AS Id, 400 AS ResponseCode, 'GSTIN must be 15 characters' AS ResponseMess; RETURN; END

    IF @Id > 0 AND NOT EXISTS (SELECT 1 FROM dbo.tblCustomer WHERE Id = @Id AND CompId = @CompId)
    BEGIN SELECT @Id AS Id, 404 AS ResponseCode, 'Customer not found' AS ResponseMess; RETURN; END

    -- One live customer per mobile per company; UX_tblCustomer_CompId_Mobile
    -- is the backstop for the race this check cannot see.
    IF @Mobile IS NOT NULL
       AND EXISTS (SELECT 1 FROM dbo.tblCustomer
                   WHERE CompId = @CompId AND Mobile = @Mobile AND IsActive = 1 AND Id <> @Id)
    BEGIN SELECT @Id AS Id, 409 AS ResponseCode, 'Another customer already has this mobile number' AS ResponseMess; RETURN; END

    BEGIN TRY
        IF @Id > 0
        BEGIN
            UPDATE dbo.tblCustomer
            SET Name = @Name, ContactPerson = @ContactPerson,
                Mobile = @Mobile, AltMobile = @AltMobile, Email = @Email,
                Address = @Address, City = @City, State = @State, Pincode = @Pincode,
                GSTIN = @GSTIN, Remarks = @Remarks,
                EditBy = @UserId, UpdatedAt = GETDATE()
            WHERE Id = @Id AND CompId = @CompId;

            SELECT @Id AS Id, 200 AS ResponseCode, 'Customer updated successfully' AS ResponseMess;
        END
        ELSE
        BEGIN
            INSERT INTO dbo.tblCustomer
                (CompId, BranchId, Name, ContactPerson, Mobile, AltMobile, Email,
                 Address, City, State, Pincode, GSTIN, Remarks, IsActive, CreatedBy, EditBy, CreatedAt)
            VALUES
                (@CompId, @BranchId, @Name, @ContactPerson, @Mobile, @AltMobile, @Email,
                 @Address, @City, @State, @Pincode, @GSTIN, @Remarks, 1, @UserId, @UserId, GETDATE());

            SELECT CAST(SCOPE_IDENTITY() AS INT) AS Id, 200 AS ResponseCode, 'Customer created successfully' AS ResponseMess;
        END
    END TRY
    BEGIN CATCH
        -- 2601 / 2627: the unique index caught a concurrent insert of the same mobile.
        IF ERROR_NUMBER() IN (2601, 2627)
            SELECT @Id AS Id, 409 AS ResponseCode, 'Another customer already has this mobile number' AS ResponseMess;
        ELSE
            SELECT @Id AS Id, 500 AS ResponseCode, ERROR_MESSAGE() AS ResponseMess;
    END CATCH
END
GO

-- ---------------------------------------------------------------------------
-- 8.7 / 8.8 Products — what a quotation line needs to seed itself:
--     HSN/SAC, GST %, unit, and a customer-facing description.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_SaveProduct
    @Id          INT = 0,
    @CompId      INT,
    @UserId      INT,
    @Name        NVARCHAR(200),
    @Code        VARCHAR(50)   = NULL,
    @CategoryId  INT           = NULL,
    @UnitPrice   DECIMAL(18,2) = NULL,
    @MarginPct   DECIMAL(5,2)  = NULL,
    @IsActive    BIT           = 1,
    @HSNCode     VARCHAR(10)   = NULL,
    @TaxPct      DECIMAL(5,2)  = NULL,
    @Unit        VARCHAR(20)   = NULL,
    @Description NVARCHAR(500) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF @CompId IS NULL OR @CompId <= 0
    BEGIN SELECT 0 AS Id, 400 AS ResponseCode, 'CompId is required' AS ResponseMess; RETURN; END
    IF @Name IS NULL OR LTRIM(RTRIM(@Name)) = ''
    BEGIN SELECT ISNULL(@Id,0) AS Id, 400 AS ResponseCode, 'Name is required' AS ResponseMess; RETURN; END
    IF @MarginPct IS NOT NULL AND (@MarginPct < 0 OR @MarginPct > 100)
    BEGIN SELECT ISNULL(@Id,0) AS Id, 400 AS ResponseCode, 'Margin must be between 0 and 100' AS ResponseMess; RETURN; END
    IF @TaxPct IS NOT NULL AND (@TaxPct < 0 OR @TaxPct > 100)
    BEGIN SELECT ISNULL(@Id,0) AS Id, 400 AS ResponseCode, 'GST % must be between 0 and 100' AS ResponseMess; RETURN; END
    IF @UnitPrice IS NOT NULL AND @UnitPrice < 0
    BEGIN SELECT ISNULL(@Id,0) AS Id, 400 AS ResponseCode, 'Price cannot be negative' AS ResponseMess; RETURN; END
    IF (@Code IS NOT NULL AND LTRIM(RTRIM(@Code)) = '') SET @Code = NULL;
    SET @HSNCode     = NULLIF(LTRIM(RTRIM(@HSNCode)), '');
    SET @Unit        = NULLIF(LTRIM(RTRIM(@Unit)), '');
    SET @Description = NULLIF(LTRIM(RTRIM(@Description)), N'');
    IF @CategoryId IS NOT NULL AND @CategoryId > 0
       AND NOT EXISTS (SELECT 1 FROM dbo.tblLookup WHERE Id=@CategoryId AND CompId=@CompId AND Kind='product_category')
    BEGIN SELECT ISNULL(@Id,0) AS Id, 400 AS ResponseCode, 'Invalid category' AS ResponseMess; RETURN; END

    IF EXISTS (SELECT 1 FROM dbo.tblProduct WHERE CompId=@CompId AND Name=@Name AND IsActive=1 AND Id<>ISNULL(@Id,0))
    BEGIN SELECT ISNULL(@Id,0) AS Id, 409 AS ResponseCode, 'A product with this name already exists' AS ResponseMess; RETURN; END

    IF ISNULL(@Id,0) = 0
    BEGIN
        INSERT INTO dbo.tblProduct (CompId, Name, Code, CategoryId, UnitPrice, MarginPct, IsActive,
                                    HSNCode, TaxPct, Unit, Description, CreatedBy, EditBy)
        VALUES (@CompId, @Name, @Code, @CategoryId, @UnitPrice, @MarginPct, ISNULL(@IsActive,1),
                @HSNCode, @TaxPct, @Unit, @Description, @UserId, @UserId);
        SET @Id = CAST(SCOPE_IDENTITY() AS INT);
        SELECT @Id AS Id, 200 AS ResponseCode, 'Product created successfully' AS ResponseMess;
    END
    ELSE
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM dbo.tblProduct WHERE Id=@Id AND CompId=@CompId)
        BEGIN SELECT @Id AS Id, 404 AS ResponseCode, 'Product not found' AS ResponseMess; RETURN; END

        UPDATE dbo.tblProduct
        SET Name=@Name, Code=@Code, CategoryId=@CategoryId, UnitPrice=@UnitPrice,
            MarginPct=@MarginPct, IsActive=ISNULL(@IsActive,1),
            HSNCode=@HSNCode, TaxPct=@TaxPct, Unit=@Unit, Description=@Description,
            EditBy=@UserId, UpdatedAt=GETDATE()
        WHERE Id=@Id AND CompId=@CompId;
        SELECT @Id AS Id, 200 AS ResponseCode, 'Product updated successfully' AS ResponseMess;
    END
END
GO

CREATE OR ALTER PROC dbo.sp_FetchProducts
    @CompId     INT,
    @PageNumber INT = 1,
    @PageSize   INT = 25,
    @SearchTerm NVARCHAR(200) = NULL,
    @CategoryId INT = NULL,
    @IsActive   BIT = 1          -- NULL = all
AS
BEGIN
    SET NOCOUNT ON;
    SET @PageNumber = CASE WHEN ISNULL(@PageNumber,1) < 1 THEN 1 ELSE @PageNumber END;
    SET @PageSize   = CASE WHEN ISNULL(@PageSize,25) < 1 THEN 25 ELSE @PageSize END;
    IF @SearchTerm IS NOT NULL AND LTRIM(RTRIM(@SearchTerm)) = '' SET @SearchTerm = NULL;

    DECLARE @Page TABLE (Id INT, Total INT);
    INSERT INTO @Page (Id, Total)
    SELECT p.Id, COUNT(*) OVER ()
    FROM dbo.tblProduct p
    WHERE p.CompId = @CompId
      AND (@IsActive IS NULL OR p.IsActive = @IsActive)
      AND (@CategoryId IS NULL OR p.CategoryId = @CategoryId)
      AND (@SearchTerm IS NULL OR p.Name LIKE '%' + @SearchTerm + '%' OR p.Code LIKE '%' + @SearchTerm + '%')
    ORDER BY p.Name
    OFFSET (@PageNumber - 1) * @PageSize ROWS FETCH NEXT @PageSize ROWS ONLY;

    SELECT p.Id, p.CompId, p.Name, p.Code, p.CategoryId, c.Value AS CategoryName,
           p.UnitPrice, p.MarginPct, p.IsActive,
           p.HSNCode, p.TaxPct, p.Unit, p.Description,
           p.CreatedBy, p.CreatedAt, p.EditBy, p.UpdatedAt,
           200 AS ResponseCode, 'Products retrieved successfully' AS ResponseMess
    FROM @Page x
    JOIN dbo.tblProduct p ON p.Id = x.Id
    LEFT JOIN dbo.tblLookup c ON c.Id = p.CategoryId
    ORDER BY p.Name;

    DECLARE @Total INT = ISNULL((SELECT MAX(Total) FROM @Page), 0);
    IF @Total = 0
        SELECT @Total = COUNT(*) FROM dbo.tblProduct p
        WHERE p.CompId = @CompId
          AND (@IsActive IS NULL OR p.IsActive = @IsActive)
          AND (@CategoryId IS NULL OR p.CategoryId = @CategoryId)
          AND (@SearchTerm IS NULL OR p.Name LIKE '%' + @SearchTerm + '%' OR p.Code LIKE '%' + @SearchTerm + '%');

    SELECT @Total AS TotalRecords,
           CASE WHEN @Total = 0 THEN 0 ELSE CEILING(CAST(@Total AS FLOAT) / @PageSize) END AS TotalPages,
           @PageNumber AS CurrentPage, @PageSize AS PageSize;
END
GO

-- ---------------------------------------------------------------------------
-- 8.9 sp_SaveLookup — the Won row is ours to guard.
--     Its label and sort order are the company's; its CODE is not. Without
--     this, editing "Won" in Settings would quietly re-code it to 'open' (the
--     form's default) and sp_ConvertLead would stop finding it. And a company
--     gets exactly one converted status — a second would make "which Won?"
--     ambiguous.
-- ---------------------------------------------------------------------------
CREATE OR ALTER PROC dbo.sp_SaveLookup
    @Id        INT,
    @CompId    INT,
    @Kind      VARCHAR(30),
    @Value     NVARCHAR(200),
    @SortOrder INT         = 0,
    @Code      VARCHAR(30) = NULL,
    @TatHours  INT         = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF @CompId IS NULL OR @CompId <= 0
    BEGIN SELECT 0 AS Id, 400 AS ResponseCode, 'CompId is required' AS ResponseMess; RETURN; END
    IF @Kind IS NULL OR LTRIM(RTRIM(@Kind)) = ''
    BEGIN SELECT 0 AS Id, 400 AS ResponseCode, 'Kind is required' AS ResponseMess; RETURN; END
    IF @Value IS NULL OR LTRIM(RTRIM(@Value)) = ''
    BEGIN SELECT 0 AS Id, 400 AS ResponseCode, 'Value is required' AS ResponseMess; RETURN; END

    IF (@Code IS NOT NULL AND LTRIM(RTRIM(@Code)) = '') SET @Code = NULL;
    IF @TatHours IS NOT NULL AND @TatHours <= 0 SET @TatHours = NULL;   -- no TAT = never overdue

    -- Whatever the form sent, an existing Won row stays Won.
    IF ISNULL(@Id, 0) > 0
       AND EXISTS (SELECT 1 FROM dbo.tblLookup WHERE Id=@Id AND CompId=@CompId AND Kind='lead_status' AND Code='converted')
    BEGIN
        SET @Kind = 'lead_status';
        SET @Code = 'converted';
    END

    -- A lead status always carries a state. Labels are the company's; codes
    -- are ours, and the app branches on them.
    IF @Kind = 'lead_status'
    BEGIN
        IF @Code IS NULL SET @Code = 'open';
        IF @Code NOT IN ('open','qualified','lost','junk','converted')
        BEGIN SELECT 0 AS Id, 400 AS ResponseCode, 'Code must be one of open, qualified, lost, junk, converted' AS ResponseMess; RETURN; END
        IF @Code = 'converted'
           AND EXISTS (SELECT 1 FROM dbo.tblLookup WHERE CompId=@CompId AND Kind='lead_status' AND Code='converted' AND IsActive=1 AND Id<>ISNULL(@Id,0))
        BEGIN SELECT ISNULL(@Id,0) AS Id, 409 AS ResponseCode, 'This company already has a Won status' AS ResponseMess; RETURN; END
    END

    -- Same for a complaint status. active = open + onhold; terminal = the rest.
    IF @Kind = 'ticket_status'
    BEGIN
        IF @Code IS NULL SET @Code = 'open';
        IF @Code NOT IN ('open','onhold','resolved','closed','rejected')
        BEGIN SELECT 0 AS Id, 400 AS ResponseCode, 'Code must be one of open, onhold, resolved, closed, rejected' AS ResponseMess; RETURN; END
    END

    IF @Id = 0
    BEGIN
        IF EXISTS (SELECT 1 FROM dbo.tblLookup WHERE CompId=@CompId AND Kind=@Kind AND Value=@Value AND IsActive=1)
        BEGIN SELECT 0 AS Id, 409 AS ResponseCode, 'A lookup with this value already exists' AS ResponseMess; RETURN; END

        INSERT INTO dbo.tblLookup (CompId, Kind, Value, SortOrder, Code, TatHours)
        VALUES (@CompId, @Kind, @Value, ISNULL(@SortOrder,0), @Code, @TatHours);

        SET @Id = CAST(SCOPE_IDENTITY() AS INT);
        SELECT @Id AS Id, 200 AS ResponseCode, 'Lookup created successfully' AS ResponseMess;
    END
    ELSE
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM dbo.tblLookup WHERE Id=@Id AND CompId=@CompId)
        BEGIN SELECT @Id AS Id, 404 AS ResponseCode, 'Lookup not found' AS ResponseMess; RETURN; END

        UPDATE dbo.tblLookup
        SET Kind = @Kind, Value = @Value, SortOrder = ISNULL(@SortOrder,0), Code = @Code, TatHours = @TatHours
        WHERE Id=@Id AND CompId=@CompId;

        SELECT @Id AS Id, 200 AS ResponseCode, 'Lookup updated successfully' AS ResponseMess;
    END
END
GO

-- 8.10 sp_DeleteLookup — the Won status cannot be deactivated: sp_ConvertLead
--      would have nowhere to move a lead to, and every won lead would point at
--      a dead row.
CREATE OR ALTER PROC dbo.sp_DeleteLookup
    @Id     INT,
    @CompId INT
AS
BEGIN
    SET NOCOUNT ON;

    IF @Id IS NULL OR @Id <= 0
    BEGIN
        SELECT 400 AS ResponseCode, 'Id is required' AS ResponseMess;
        RETURN;
    END

    IF NOT EXISTS (SELECT 1 FROM dbo.tblLookup WHERE Id=@Id AND CompId=@CompId)
    BEGIN
        SELECT 404 AS ResponseCode, 'Lookup not found' AS ResponseMess;
        RETURN;
    END

    IF EXISTS (SELECT 1 FROM dbo.tblLookup WHERE Id=@Id AND CompId=@CompId AND Kind='lead_status' AND Code='converted')
    BEGIN
        SELECT 409 AS ResponseCode, 'The Won status cannot be deleted — rename it instead' AS ResponseMess;
        RETURN;
    END

    UPDATE dbo.tblLookup SET IsActive = 0 WHERE Id=@Id AND CompId=@CompId;

    SELECT 200 AS ResponseCode, 'Lookup deleted successfully' AS ResponseMess;
END
GO

-- ===== 9. Reports + dashboard (sp_RptFunnel, sp_RptLeaderboard, sp_RptPipelineValue, sp_RptLost, sp_RptAging, sp_Dashboard)
-- ---------------------------------------------------------------------------
-- 9. Success now has two codes.
--    Until today 'qualified' was the end of the road, so five reports treat it
--    as the success state / a terminal. A small lead goes open → converted
--    without ever being qualified (spec decision 6); unpatched, those wins
--    would vanish from the funnel and never get a closed date.
--      QualifiedAt   = first move into qualified OR converted
--      terminal set  = … + 'converted'
--      ClosedAt      = … + 'converted'
--    The ACTIVE set ('open','qualified') is already right everywhere and is not
--    touched — which is why sp_RptFollowUpCompliance and sp_FetchFollowUps are
--    not in this list. No report changes shape.
-- ---------------------------------------------------------------------------
BEGIN TRY
    EXEC #Patch091 'dbo.sp_RptFunnel', 'IN (''qualified'',''converted'')) AS QualifiedAt',
        'AND s.Code = ''qualified'') AS QualifiedAt,',
        'AND s.Code IN (''qualified'',''converted'')) AS QualifiedAt,';
    EXEC #Patch091 'dbo.sp_RptFunnel', '''qualified'',''converted'',''lost'',''junk''',
        's.Code IN (''qualified'',''lost'',''junk''))',
        's.Code IN (''qualified'',''converted'',''lost'',''junk''))';

    EXEC #Patch091 'dbo.sp_RptLeaderboard', 'IN (''qualified'',''converted'')) AS QualifiedAt',
        'AND s.Code = ''qualified'') AS QualifiedAt,',
        'AND s.Code IN (''qualified'',''converted'')) AS QualifiedAt,';

    EXEC #Patch091 'dbo.sp_RptPipelineValue', '''qualified'',''converted'',''lost'',''junk''',
        's.Code IN (''qualified'',''lost'',''junk''))',
        's.Code IN (''qualified'',''converted'',''lost'',''junk''))';

    EXEC #Patch091 'dbo.sp_RptLost', '''qualified'',''converted'',''lost'',''junk''',
        's.Code IN (''qualified'',''lost'',''junk''))',
        's.Code IN (''qualified'',''converted'',''lost'',''junk''))';

    EXEC #Patch091 'dbo.sp_RptAging', '''converted'',''lost'',''junk''',
        's.Code IN (''lost'',''junk'')) END AS ClosedAt,',
        's.Code IN (''converted'',''lost'',''junk'')) END AS ClosedAt,';

    -- 9.6 sp_Dashboard — two more KPI rows in RS0: leads won this calendar month
    --     and what they were won for. Prepended to the UNION so the first SELECT
    --     still names the columns (Type, Number). The web reads RS0 by Type, not
    --     by position. The leads-trend "Converted" series needs nothing: it has
    --     keyed on WonAt since it was written and starts drawing on its own.
    --     Number becomes DECIMAL(18,2) for every row: WonValueMonth is money and
    --     UNION resolves one type for the column, so an INT column was never an
    --     option once a money row joined it.
    DECLARE @won NVARCHAR(MAX) =
          N'SELECT ''WonMonth'' AS Type, CAST(COUNT(*) AS DECIMAL(18,2)) AS Number' + CHAR(13) + CHAR(10)
        + N'    FROM tblLeads l' + CHAR(13) + CHAR(10)
        + N'    WHERE l.CompId = @CompId' + CHAR(13) + CHAR(10)
        + N'      AND l.WonAt >= DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1)' + CHAR(13) + CHAR(10)
        + N'      AND (' + CHAR(13) + CHAR(10)
        + N'            (    (@UseBranchScope = 0 OR l.BranchId IN (SELECT BranchId FROM @BranchIds))' + CHAR(13) + CHAR(10)
        + N'             AND (@UseOwnerScope  = 0 OR l.OwnerId  IN (SELECT OwnerId  FROM @OwnerIds)) )' + CHAR(13) + CHAR(10)
        + N'         OR (@UserId IS NOT NULL AND (l.OwnerId = @UserId OR l.CreatedBy = @UserId))' + CHAR(13) + CHAR(10)
        + N'          )' + CHAR(13) + CHAR(10)
        + N'    UNION ALL' + CHAR(13) + CHAR(10)
        + N'    SELECT ''WonValueMonth'', CAST(ISNULL(SUM(l.WonValue), 0) AS DECIMAL(18,2))' + CHAR(13) + CHAR(10)
        + N'    FROM tblLeads l' + CHAR(13) + CHAR(10)
        + N'    WHERE l.CompId = @CompId' + CHAR(13) + CHAR(10)
        + N'      AND l.WonAt >= DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1)' + CHAR(13) + CHAR(10)
        + N'      AND (' + CHAR(13) + CHAR(10)
        + N'            (    (@UseBranchScope = 0 OR l.BranchId IN (SELECT BranchId FROM @BranchIds))' + CHAR(13) + CHAR(10)
        + N'             AND (@UseOwnerScope  = 0 OR l.OwnerId  IN (SELECT OwnerId  FROM @OwnerIds)) )' + CHAR(13) + CHAR(10)
        + N'         OR (@UserId IS NOT NULL AND (l.OwnerId = @UserId OR l.CreatedBy = @UserId))' + CHAR(13) + CHAR(10)
        + N'          )' + CHAR(13) + CHAR(10)
        + N'    UNION ALL' + CHAR(13) + CHAR(10)
        + N'    SELECT ''TotalLeads'', COUNT(*)';
    EXEC #Patch091 'dbo.sp_Dashboard', '''WonValueMonth''',
        'SELECT ''TotalLeads'' AS Type, COUNT(*) AS Number', @won;
END TRY
BEGIN CATCH
    DECLARE @m9 NVARCHAR(2048) = ERROR_MESSAGE();
    RAISERROR('091 §9 report patches ABORTED — %s', 16, 1, @m9);
    SET NOEXEC ON;
END CATCH
GO

IF OBJECT_ID('tempdb..#Patch091') IS NOT NULL DROP PROC #Patch091;
GO


-- ===== 10. Menu: Quotations under Sales, grants cloned from Leads
-- ---------------------------------------------------------------------------
-- GROUP BY + MAX because tblGroupAccess carries duplicate (GroupId, MenuId)
-- rows, sometimes with different flags on each duplicate; MAX per flag
-- reproduces "granted if any Leads row grants it", same as a join-based
-- menu-rights read. A plain SELECT DISTINCT would instead emit one row per
-- distinct flag combination — two conflicting grants for one group.
-- Menu rights load at LOGIN — users re-login to see the row.
-- ---------------------------------------------------------------------------
BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @Sales INT = (SELECT TOP 1 Id FROM dbo.tblMenu WHERE Route = N'/sales'       ORDER BY Id);
    DECLARE @Leads INT = (SELECT TOP 1 Id FROM dbo.tblMenu WHERE Route = N'/sales/leads' ORDER BY Id);
    IF @Sales IS NULL OR @Leads IS NULL
        RAISERROR('menu rows /sales or /sales/leads not found', 16, 1);

    IF NOT EXISTS (SELECT 1 FROM dbo.tblMenu WHERE Route = N'/sales/quotations')
        INSERT INTO dbo.tblMenu (ParentId, Description, Image, FormId, MenuType, ActualId, IsAllowed, FormName, FormClass, OpenStyle, Route)
        VALUES (@Sales, 'Quotations', NULL, 0, 1, 0, 1, NULL, NULL, 1, N'/sales/quotations');

    DECLARE @Quotes INT = (SELECT TOP 1 Id FROM dbo.tblMenu WHERE Route = N'/sales/quotations' ORDER BY Id);

    INSERT INTO dbo.tblGroupAccess (GroupId, MenuId, CanView, CanAdd, CanEdit, CanDelete)
    SELECT src.GroupId, @Quotes,
           CONVERT(BIT, MAX(CONVERT(TINYINT, src.CanView))),
           CONVERT(BIT, MAX(CONVERT(TINYINT, src.CanAdd))),
           CONVERT(BIT, MAX(CONVERT(TINYINT, src.CanEdit))),
           CONVERT(BIT, MAX(CONVERT(TINYINT, src.CanDelete)))
    FROM dbo.tblGroupAccess src
    WHERE src.MenuId = @Leads
      AND NOT EXISTS (SELECT 1 FROM dbo.tblGroupAccess ga WHERE ga.GroupId = src.GroupId AND ga.MenuId = @Quotes)
    GROUP BY src.GroupId;

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    DECLARE @m10 NVARCHAR(2048) = ERROR_MESSAGE();
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    RAISERROR('091 §10 menu ABORTED — %s', 16, 1, @m10);
    SET NOEXEC ON;
END CATCH
GO


-- ===== 11. Verify
SET NOCOUNT ON;

-- 11.1 shape — every row 'ok'
SELECT 'tblQuotation'            AS what, CASE WHEN OBJECT_ID('dbo.tblQuotation')        IS NOT NULL THEN 'ok' ELSE 'MISSING' END AS state
UNION ALL SELECT 'tblQuotationLine',      CASE WHEN OBJECT_ID('dbo.tblQuotationLine')    IS NOT NULL THEN 'ok' ELSE 'MISSING' END
UNION ALL SELECT 'tblQuotationCounter',   CASE WHEN OBJECT_ID('dbo.tblQuotationCounter') IS NOT NULL THEN 'ok' ELSE 'MISSING' END
UNION ALL SELECT 'tblQuoteProfile',       CASE WHEN OBJECT_ID('dbo.tblQuoteProfile')     IS NOT NULL THEN 'ok' ELSE 'MISSING' END
UNION ALL SELECT 'tblLeads.WonValue',     CASE WHEN COL_LENGTH('dbo.tblLeads','WonValue')    IS NOT NULL THEN 'ok' ELSE 'MISSING' END
UNION ALL SELECT 'tblLeads.CustomerId',   CASE WHEN COL_LENGTH('dbo.tblLeads','CustomerId')  IS NOT NULL THEN 'ok' ELSE 'MISSING' END
UNION ALL SELECT 'tblProduct.TaxPct',     CASE WHEN COL_LENGTH('dbo.tblProduct','TaxPct')    IS NOT NULL THEN 'ok' ELSE 'MISSING' END
UNION ALL SELECT 'tblProduct.HSNCode',    CASE WHEN COL_LENGTH('dbo.tblProduct','HSNCode')   IS NOT NULL THEN 'ok' ELSE 'MISSING' END
UNION ALL SELECT 'tblCustomer.GSTIN',     CASE WHEN COL_LENGTH('dbo.tblCustomer','GSTIN')    IS NOT NULL THEN 'ok' ELSE 'MISSING' END
UNION ALL SELECT 'menu /sales/quotations',CASE WHEN EXISTS (SELECT 1 FROM dbo.tblMenu WHERE Route = N'/sales/quotations') THEN 'ok' ELSE 'MISSING' END
UNION ALL SELECT 'mobile constraints (4)',CASE WHEN (SELECT COUNT(*) FROM sys.check_constraints WHERE name IN
                    ('CK_tblCustomer_Mobile','CK_tblCustomer_AltMobile','CK_tblLeads_MobileNo','CK_tblLeads_AltMobile')) = 4 THEN 'ok' ELSE 'MISSING' END
UNION ALL SELECT 'sp_SaveAttachment whitelist',CASE WHEN EXISTS (SELECT 1 FROM sys.sql_modules
                    WHERE object_id = OBJECT_ID('dbo.sp_SaveAttachment') AND definition LIKE '%quoteprofile%') THEN 'ok' ELSE 'MISSING' END
UNION ALL SELECT 'quotation indexes (6)',  CASE WHEN (SELECT COUNT(*) FROM sys.indexes WHERE name IN
                    ('IX_tblLeads_CompId_CustomerId','IX_tblQuotation_CompId_LeadId','UX_tblQuotation_Root_Revision','UX_tblQuotation_Number','IX_tblQuotationLine_QuotationId','IX_tblQuotation_Comp_Root')) = 6 THEN 'ok' ELSE 'MISSING' END;

-- 11.2 every company with lead statuses has exactly one live Won — expect 0 rows
SELECT CompId, SUM(CASE WHEN Code = 'converted' THEN 1 ELSE 0 END) AS WonRows
FROM dbo.tblLookup WHERE Kind = 'lead_status' AND IsActive = 1
GROUP BY CompId HAVING SUM(CASE WHEN Code = 'converted' THEN 1 ELSE 0 END) <> 1;

-- 11.3 no mobile anywhere that is not ten digits — expect 0 rows
SELECT 'tblCustomer.Mobile' AS col, Id FROM dbo.tblCustomer WHERE Mobile    IS NOT NULL AND Mobile    NOT LIKE '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'
UNION ALL SELECT 'tblCustomer.AltMobile', Id FROM dbo.tblCustomer WHERE AltMobile IS NOT NULL AND AltMobile NOT LIKE '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'
UNION ALL SELECT 'tblLeads.MobileNo',     Id FROM dbo.tblLeads    WHERE MobileNo  IS NOT NULL AND MobileNo  NOT LIKE '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'
UNION ALL SELECT 'tblLeads.AltMobile',    Id FROM dbo.tblLeads    WHERE AltMobile IS NOT NULL AND AltMobile NOT LIKE '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]';

-- 11.4 procs — every row 'ok'
SELECT v.name AS what, CASE WHEN OBJECT_ID('dbo.' + v.name) IS NOT NULL THEN 'ok' ELSE 'MISSING' END AS state
FROM (VALUES ('sp_EnsureQuoteProfile'),('sp_FetchQuoteProfileById'),('sp_SaveQuoteProfile'),
             ('sp_SaveQuotation'),('sp_FinaliseQuotation'),('sp_ReviseQuotation'),('sp_RejectQuotation'),
             ('sp_DeleteQuotation'),('sp_FetchQuotations'),('sp_FetchQuotationDetail'),('sp_ConvertLead')) v(name);

-- 11.5 patches landed — every row 'ok'
--      LEFT JOIN, not JOIN: an inner join drops the row for a procedure that is
--      not there, so the one failure this block exists to reveal — a proc that
--      never got created — would show as silence. The report procs have no
--      presence row in 11.4 either, so this is where they are checked.
SELECT v.sp AS what,
       CASE WHEN m.object_id IS NULL                      THEN 'MISSING PROC'
            WHEN m.definition LIKE '%' + v.marker + '%'   THEN 'ok'
            ELSE 'NOT PATCHED' END AS state
FROM (VALUES
  ('sp_FetchLeads',          'l.WonValue'),
  ('sp_FetchLeadDetail',     'tblCustomer cust'),
  ('sp_FetchCustomers',      'c.GSTIN'),
  ('sp_FetchCustomerDetail', 'c.GSTIN'),
  ('sp_RptFunnel',           '''qualified'',''converted'',''lost'',''junk'''),
  ('sp_RptLeaderboard',      'IN (''qualified'',''converted'')) AS QualifiedAt'),
  ('sp_RptPipelineValue',    '''qualified'',''converted'',''lost'',''junk'''),
  ('sp_RptLost',             '''qualified'',''converted'',''lost'',''junk'''),
  ('sp_RptAging',            '''converted'',''lost'',''junk'''),
  ('sp_Dashboard',           '''WonValueMonth'''),
  ('sp_SetLeadStatus',       'WonAt = NULL, WonValue = NULL'),
  ('sp_DeleteLead',          'tblQuotation'),
  ('sp_SaveAttachment',      '''quoteprofile''')
) v(sp, marker)
LEFT JOIN sys.sql_modules m ON m.object_id = OBJECT_ID('dbo.' + v.sp);

-- 11.6 THE FIXTURE TABLE — the same five cases as web/src/pages/Sales/Quotations/
--      quoteMath.test.js. Runs sp_SaveQuotation for real, inside a transaction
--      that is ROLLED BACK: nothing is left behind but identity gaps. Every row
--      must say 'ok'. (The status rows the proc prints on the way are expected.)
BEGIN TRANSACTION;
    DECLARE @fxLead INT, @fxComp INT, @fxUser INT;
    SELECT TOP 1 @fxLead = l.Id, @fxComp = l.CompId, @fxUser = ISNULL(l.CreatedBy, 1)
    FROM dbo.tblLeads l
    JOIN dbo.tblLookup st ON st.Id = l.StatusId AND st.CompId = l.CompId
    WHERE st.Kind = 'lead_status' AND st.Code IN ('open','qualified')
    ORDER BY l.Id;

    IF @fxLead IS NULL
        SELECT 'fixtures' AS what, 'SKIPPED — no active lead in this database to hang a test quotation on' AS state;
    ELSE
    BEGIN
        DECLARE @fx TABLE (F VARCHAR(2), Gstin VARCHAR(15), Buyer CHAR(2), Lines NVARCHAR(MAX),
                           Taxable DECIMAL(18,2), Cgst DECIMAL(18,2), Sgst DECIMAL(18,2), Igst DECIMAL(18,2),
                           RoundOff DECIMAL(18,2), Grand DECIMAL(18,2));
        INSERT INTO @fx VALUES
        ('F1','24ABCDE1234F1Z5','24', N'[{"description":"x","qty":1,"rate":280000,"discountType":"amt","discountValue":10000,"taxPct":12}]', 270000.00, 16200.00, 16200.00, 0, 0.00, 302400),
        ('F2','24ABCDE1234F1Z5','27', N'[{"description":"x","qty":1,"rate":280000,"discountType":"amt","discountValue":10000,"taxPct":12}]', 270000.00, 0, 0, 32400.00, 0.00, 302400),
        ('F3',NULL,             '24', N'[{"description":"x","qty":2,"rate":1500,"discountType":"pct","discountValue":0,"taxPct":18}]',        3000.00, 0, 0, 0, 0.00, 3000),
        ('F4','24ABCDE1234F1Z5','24', N'[{"description":"x","qty":1,"rate":100.10,"discountType":"pct","discountValue":0,"taxPct":5}]',        100.10, 2.51, 2.50, 0, -0.11, 105),
        ('F5','24ABCDE1234F1Z5','24', N'[{"description":"a","qty":2.5,"rate":1234.56,"discountType":"pct","discountValue":7.5,"taxPct":18},{"description":"b","qty":3,"rate":99.99,"discountType":"amt","discountValue":0,"taxPct":28}]', 3154.89, 298.95, 298.93, 0, 0.23, 3753);

        DECLARE @got TABLE (F VARCHAR(2), Taxable DECIMAL(18,2), Cgst DECIMAL(18,2), Sgst DECIMAL(18,2), Igst DECIMAL(18,2), RoundOff DECIMAL(18,2), Grand DECIMAL(18,2));
        DECLARE @F VARCHAR(2), @G VARCHAR(15), @B CHAR(2), @Ls NVARCHAR(MAX);
        DECLARE fx CURSOR LOCAL FAST_FORWARD FOR SELECT F, Gstin, Buyer, Lines FROM @fx ORDER BY F;
        OPEN fx; FETCH NEXT FROM fx INTO @F, @G, @B, @Ls;
        WHILE @@FETCH_STATUS = 0
        BEGIN
            EXEC dbo.sp_SaveQuotation @Id = 0, @CompId = @fxComp, @UserId = @fxUser, @LeadId = @fxLead,
                 @TemplateCode = 'classic', @ToName = N'091 fixture', @ToStateCode = @B,
                 @SellerGSTIN = @G, @CompanyJSON = N'{"name":"fixture"}', @LinesJSON = @Ls;

            -- sp_SaveQuotation's own CATCH rolls back to @@TRANCOUNT 0 — which
            -- takes THIS transaction with it. Stop the moment that happens:
            -- carrying on would commit the remaining fixture quotations for
            -- real. The rows already collected stay (a table variable survives
            -- a rollback) and the unrun fixtures report MISMATCH, which is the
            -- right answer — something went wrong.
            IF @@TRANCOUNT = 0 BREAK;

            INSERT INTO @got
            SELECT TOP 1 @F, TaxableTotal, CgstTotal, SgstTotal, IgstTotal, RoundOff, GrandTotal
            FROM dbo.tblQuotation WHERE CompId = @fxComp AND LeadId = @fxLead AND ToName = N'091 fixture' ORDER BY Id DESC;
            FETCH NEXT FROM fx INTO @F, @G, @B, @Ls;
        END
        CLOSE fx; DEALLOCATE fx;

        SELECT 'fixture ' + e.F AS what,
               CASE WHEN g.F IS NOT NULL AND g.Taxable = e.Taxable AND g.Cgst = e.Cgst AND g.Sgst = e.Sgst
                         AND g.Igst = e.Igst AND g.RoundOff = e.RoundOff AND g.Grand = e.Grand
                    THEN 'ok' ELSE 'MISMATCH' END AS state,
               g.Taxable, g.Cgst, g.Sgst, g.Igst, g.RoundOff, g.Grand
        FROM @fx e LEFT JOIN @got g ON g.F = e.F ORDER BY e.F;
    END
-- Guarded: if sp_SaveQuotation itself failed, its CATCH already rolled everything back.
IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;

SET NOEXEC OFF;
GO
