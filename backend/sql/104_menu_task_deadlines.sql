-- 104_menu_task_deadlines.sql — the "TAT" menu under Team Reports says what it
-- is: "Task deadlines". Label only; route and module unchanged.
-- Apply on BOTH databases (eCRM+ and SolarCRM):
--   sqlcmd -S prdinfotech.in,1433 -U sa -d "eCRM+"   -C -b -I -i sql/104_menu_task_deadlines.sql
--   sqlcmd -S prdinfotech.in,1433 -U sa -d "SolarCRM" -C -b -I -i sql/104_menu_task_deadlines.sql
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

UPDATE dbo.tblMenu SET Description = N'Task deadlines'
 WHERE Route = '/reports/tat' AND Description = N'TAT';
GO

-- VERIFY AFTER APPLY (expect one row, Description = 'Task deadlines'):
-- SELECT Id, Description, Route FROM tblMenu WHERE Route = '/reports/tat';
