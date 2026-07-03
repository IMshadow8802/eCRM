-- 033_report_sp_fixes.sql
-- Fix: sp_CallsPerUser returned only UserId/CallCount, so the Calls-per-user
-- report had no display name to chart/table. Join tblUser for FullName.
-- Apply by hand (see feedback: never auto-apply SQL).
USE [eCRM+]
GO
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE OR ALTER PROC dbo.sp_CallsPerUser
    @CompId   INT,
    @BranchId INT      = NULL,
    @FromDate DATETIME = NULL,
    @ToDate   DATETIME = NULL
AS
BEGIN
    SET NOCOUNT ON;

    SELECT c.UserId,
           u.FullName,
           COUNT(*) AS CallCount,
           200 AS ResponseCode, 'Calls per user retrieved successfully' AS ResponseMess
    FROM dbo.tblCall c
    LEFT JOIN dbo.tblUser u ON u.Id = c.UserId
    WHERE c.CompId = @CompId
      AND (@FromDate IS NULL OR c.CalledAt >= @FromDate)
      AND (@ToDate   IS NULL OR c.CalledAt <  DATEADD(DAY, 1, @ToDate))
      AND (@BranchId IS NULL OR EXISTS (
              SELECT 1 FROM dbo.tblLeads l
              WHERE l.Id = c.LeadId AND l.CompId = @CompId AND l.BranchId = @BranchId))
    GROUP BY c.UserId, u.FullName
    ORDER BY CallCount DESC;
END
GO
