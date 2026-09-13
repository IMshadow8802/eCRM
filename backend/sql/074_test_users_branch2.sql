-- ============================================================================
-- 074_test_users_branch2.sql  (TEST DATA — 2026-09-09)
--
-- Moves three of the freshly created test users to branch 2 (SOUTH EXTENSION)
-- so cross-branch transfers and branch-scope visibility can be exercised.
-- Needed because saveUser always stamps the CALLER's BranchId (controller +
-- sp_SaveUser insert) — an Owner cannot place a user in another branch via
-- the API/UI. That gap is reported separately; this script only unblocks the
-- live test. Idempotent. APPLY BY HAND.
-- ============================================================================
UPDATE dbo.tblUser SET BranchId = 2
 WHERE CompId = 1 AND Username IN ('bm_se_vikram', 'se_se_pooja', 'se_se_dev') AND BranchId <> 2;
GO
-- verify after apply (expect 3 rows, all BranchId 2)
SELECT Id, Username, BranchId, ReportsTo FROM dbo.tblUser
 WHERE Username IN ('bm_se_vikram', 'se_se_pooja', 'se_se_dev');
GO
