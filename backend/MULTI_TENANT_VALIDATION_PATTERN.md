# Multi-Tenant Validation Pattern for Stored Procedures

This document describes the standard pattern for adding CompId/BranchId validation to all multi-tenant stored procedures in the CRM system.

## Purpose

Prevents NULL CompId/BranchId values from entering the database and provides proper error messages when UPDATE operations fail due to CompId/BranchId mismatches.

## When to Apply This Pattern

Apply this validation to **ALL multi-tenant entities** that have CompId and BranchId columns:

✅ **Multi-Tenant Entities** (Apply validation):
- `sp_SaveUser`
- `sp_SaveTeam`
- `sp_SaveProject`
- `sp_SaveTask`
- `sp_SaveKanbanColumn`
- `sp_SaveUserGroup`
- `sp_SaveLead` ✅ **COMPLETED**
- `sp_SaveFollowUp` ✅ **COMPLETED**

❌ **Global Lookup Tables** (Do NOT apply):
- `sp_SaveLeadSource` (global lookup table)
- `sp_SaveStatus` (global lookup table)

---

## Pattern Implementation

### Step 1: Add Parameter Validation (After DECLARE Statements)

Add this code immediately after the DECLARE statements at the beginning of the procedure:

```sql
----------------------------------------------------
-- Validation: CompId and BranchId Required
----------------------------------------------------
IF (@CompId IS NULL OR @CompId = 0 OR @BranchId IS NULL OR @BranchId = 0)
BEGIN
    SET @ResponseCode = 400;
    SET @ResponseMess = 'CompId and BranchId are required';
    SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
    RETURN;
END
```

**What it does:**
- ✅ Checks if CompId is NULL or 0 (invalid)
- ✅ Checks if BranchId is NULL or 0 (invalid)
- ✅ Returns HTTP 400 (Bad Request)
- ✅ Provides clear error message
- ✅ Exits immediately (RETURN)

---

### Step 2: Add @@ROWCOUNT Check (After UPDATE Statement)

Add this code immediately after the UPDATE statement in the UPDATE block:

```sql
-- Check if UPDATE affected any rows
DECLARE @RowsAffected INT = @@ROWCOUNT;

IF (@RowsAffected = 0)
BEGIN
    SET @ResponseCode = 404;
    SET @ResponseMess = '[Entity] not found or access denied (CompId/BranchId mismatch)';
    SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
    RETURN;
END
```

**Replace `[Entity]` with the appropriate entity name** (e.g., "User", "Task", "Project", etc.)

**What it does:**
- ✅ Captures number of rows affected by UPDATE
- ✅ Detects when WHERE clause finds 0 rows (CompId/BranchId mismatch)
- ✅ Returns HTTP 404 (Not Found)
- ✅ Provides clear error message explaining the cause
- ✅ Prevents false success responses

---

## Complete Example: sp_SaveFollowUp

Here's the complete pattern as implemented in `sp_SaveFollowUp`:

```sql
ALTER PROCEDURE [dbo].[sp_SaveFollowUp]
(
    @Id INT = 0,
    @LeadID INT,
    @NextFollowupDate DATETIME = NULL,
    @FollowupType VARCHAR(50) = NULL,
    @Remarks VARCHAR(500) = NULL,
    @Status VARCHAR(50) = NULL,
    @CompId INT,
    @BranchId INT,
    @CreatedBy INT = NULL,
    @EditBy INT = NULL
)
AS
BEGIN
    DECLARE @ResponseCode INT;
    DECLARE @ResponseMess VARCHAR(200);

    ----------------------------------------------------
    -- ✅ STEP 1: Validation - CompId and BranchId Required
    ----------------------------------------------------
    IF (@CompId IS NULL OR @CompId = 0 OR @BranchId IS NULL OR @BranchId = 0)
    BEGIN
        SET @ResponseCode = 400;
        SET @ResponseMess = 'CompId and BranchId are required';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
        RETURN;
    END

    -- Other validations (e.g., Remarks required)
    IF (@Remarks IS NULL OR LTRIM(RTRIM(@Remarks)) = '')
    BEGIN
        SET @ResponseCode = 403;
        SET @ResponseMess = 'Remarks is required';
        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
        RETURN;
    END

    ----------------------------------------------------
    -- INSERT MODE
    ----------------------------------------------------
    IF(@Id = 0)
    BEGIN
        INSERT INTO tblFollowUp
        (
            CompId, BranchId, LeadID, NextFollowupDate, FollowupType, Remarks,
            Status, CreatedBy, CreatedDate
        )
        VALUES
        (
            @CompId, @BranchId, @LeadID, @NextFollowupDate, @FollowupType, @Remarks,
            @Status, @CreatedBy, GETDATE()
        );

        SET @Id = SCOPE_IDENTITY();
        SET @ResponseCode = 201;
        SET @ResponseMess = 'Follow-up created successfully';

        SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess, @Id AS FollowUpID;
        RETURN;
    END

    ----------------------------------------------------
    -- UPDATE MODE
    ----------------------------------------------------
    ELSE
    BEGIN
        IF EXISTS (SELECT 1 FROM tblFollowUp WHERE Id = @Id)
        BEGIN
            UPDATE tblFollowUp
            SET
                CompId = @CompId,
                BranchId = @BranchId,
                LeadID = @LeadID,
                NextFollowupDate = @NextFollowupDate,
                FollowupType = @FollowupType,
                Remarks = @Remarks,
                Status = @Status,
                EditBy = @EditBy,
                EditDate = GETDATE()
            WHERE Id = @Id AND CompId = @CompId AND BranchId = @BranchId;

            -- ✅ STEP 2: Check if UPDATE affected any rows
            DECLARE @RowsAffected INT = @@ROWCOUNT;

            IF (@RowsAffected = 0)
            BEGIN
                SET @ResponseCode = 404;
                SET @ResponseMess = 'Follow-up not found or access denied (CompId/BranchId mismatch)';
                SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
                RETURN;
            END

            SET @ResponseCode = 200;
            SET @ResponseMess = 'Follow-up updated successfully';

            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
            RETURN;
        END
        ELSE
        BEGIN
            SET @ResponseCode = 404;
            SET @ResponseMess = 'Follow-up Id not found';
            SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
            RETURN;
        END
    END
END
```

---

## Testing the Changes

After applying this pattern to a stored procedure:

### Test 1: Verify NULL CompId Rejection
```sql
EXEC sp_SaveFollowUp
    @Id = 0,
    @LeadID = 1,
    @Remarks = 'Test',
    @CompId = NULL,  -- Should fail
    @BranchId = 1;
```

**Expected Result:**
```json
{
    "ResponseCode": 400,
    "ResponseMess": "CompId and BranchId are required"
}
```

### Test 2: Verify CompId/BranchId Mismatch Detection
```sql
-- First, create a record with CompId=1, BranchId=1
EXEC sp_SaveFollowUp
    @Id = 0,
    @LeadID = 1,
    @Remarks = 'Test',
    @CompId = 1,
    @BranchId = 1,
    @CreatedBy = 101;

-- Then try to update with different CompId/BranchId
EXEC sp_SaveFollowUp
    @Id = 1,  -- Existing record
    @LeadID = 1,
    @Remarks = 'Updated',
    @CompId = 2,  -- Different CompId
    @BranchId = 2,  -- Different BranchId
    @EditBy = 101;
```

**Expected Result:**
```json
{
    "ResponseCode": 404,
    "ResponseMess": "Follow-up not found or access denied (CompId/BranchId mismatch)"
}
```

### Test 3: Verify Successful Update
```sql
-- Update with matching CompId/BranchId
EXEC sp_SaveFollowUp
    @Id = 1,
    @LeadID = 1,
    @Remarks = 'Successfully updated',
    @CompId = 1,  -- Matches existing record
    @BranchId = 1,  -- Matches existing record
    @EditBy = 101;
```

**Expected Result:**
```json
{
    "ResponseCode": 200,
    "ResponseMess": "Follow-up updated successfully"
}
```

---

## Benefits of This Pattern

1. ✅ **Data Integrity**: Prevents NULL CompId/BranchId from entering database
2. ✅ **Security**: Enforces multi-tenant isolation at database level
3. ✅ **Error Detection**: Detects silent UPDATE failures immediately
4. ✅ **Clear Errors**: Provides descriptive error messages for debugging
5. ✅ **Consistency**: Same pattern across all multi-tenant entities
6. ✅ **Debugging**: Makes it easy to identify CompId/BranchId mismatch issues

---

## Procedures Still Requiring This Pattern

The following stored procedures are **NOT in local files** but should have this pattern applied:

1. `sp_SaveUser` - User records
2. `sp_SaveTeam` - Team records
3. `sp_SaveProject` - Project records
4. `sp_SaveTask` - Task records
5. `sp_SaveKanbanColumn` - Kanban column records
6. `sp_SaveUserGroup` - User group records

**Action Required:** Apply the pattern documented above to each of these procedures.

---

## Implementation Checklist

When applying this pattern to a stored procedure:

- [ ] Verify the table has CompId and BranchId columns
- [ ] Add CompId/BranchId validation after DECLARE statements
- [ ] Add @@ROWCOUNT check after UPDATE statement
- [ ] Update error message to include entity name
- [ ] Test with NULL CompId/BranchId
- [ ] Test with mismatched CompId/BranchId
- [ ] Test with correct CompId/BranchId
- [ ] Verify existing functionality still works

---

## Files Modified

- ✅ `/Users/ayushmishra/Developer/Nexus/CRM/backend/src/db/procedures_save.sql`
  - `sp_SaveFollowUp` (Lines 156-265)
  - `sp_SaveLead` (Lines 21-165)

---

## Quick Reference Card

```sql
-- ✅ PATTERN TEMPLATE

-- Step 1: Add after DECLARE statements
IF (@CompId IS NULL OR @CompId = 0 OR @BranchId IS NULL OR @BranchId = 0)
BEGIN
    SET @ResponseCode = 400;
    SET @ResponseMess = 'CompId and BranchId are required';
    SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
    RETURN;
END

-- Step 2: Add after UPDATE statement
DECLARE @RowsAffected INT = @@ROWCOUNT;

IF (@RowsAffected = 0)
BEGIN
    SET @ResponseCode = 404;
    SET @ResponseMess = '[Entity] not found or access denied (CompId/BranchId mismatch)';
    SELECT @ResponseCode AS ResponseCode, @ResponseMess AS ResponseMess;
    RETURN;
END
```

---

**Document Version:** 1.0
**Last Updated:** 2025-11-21
**Author:** CRM Development Team
