-- 044_prune_users_reset_passwords.sql
-- Purpose: keep only real users (Super=1, Ayush=2, Raaj=3, Aman=4), remove the
--          rest of the seed/demo users (Ids 5-10), and reset passwords.
-- Passwords are bcrypt (compared in Node via bcrypt.compare):
--   Super (1) + Ayush (2)  -> Big@Boss@
--   Raaj  (3) + Aman  (4)  -> BigBoss
-- Users 5-10 only reference tblUserGroupMap (verified: all other FK tables 0 rows),
-- so clear those maps first, then delete the users.
USE [eCRM+];
GO

BEGIN TRAN;

-- 1. drop group memberships for the users being removed (only FK blocker)
DELETE FROM tblUserGroupMap WHERE UserId BETWEEN 5 AND 10;

-- 2. remove seed/demo users
DELETE FROM tblUser WHERE Id BETWEEN 5 AND 10;

-- 3. reset passwords (bcrypt hashes, salt rounds 12)
UPDATE tblUser
  SET Password = '$2b$12$93TiTEreD/yAzCcV70jg4.Ytddo50DMQYVT9aOg1NEfShVYp2pdIq'  -- Big@Boss@
  WHERE Id IN (1, 2);

UPDATE tblUser
  SET Password = '$2b$12$1i9JWHditpktbOVxp.HPwOVP2nyFdCN/p4Ww4lQbLBe87ECvEU2pe'  -- BigBoss
  WHERE Id IN (3, 4);

COMMIT;
GO

-- verify after apply
SELECT Id, Username, FullName, JobTitle, IsAdmin, IsActive FROM tblUser ORDER BY Id;
-- expect exactly 4 rows: 1 Super, 2 Ayush, 3 Raaj, 4 Aman
