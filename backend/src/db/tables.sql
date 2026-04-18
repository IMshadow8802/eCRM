-- =============================================
-- CRM Database Tables - Reference Schema
-- Database: eCRM+
-- Created: 2025-11-19
-- =============================================

USE [eCRM+]
GO

-- =============================================
-- Table: tblLeads
-- Description: Main leads/prospects table
-- =============================================
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE TABLE [dbo].[tblLeads](
    [Id] [int] IDENTITY(1,1) NOT NULL,
    [BranchId] [int] NOT NULL,
    [LeadDate] [datetime] NULL,
    [CustomerName] [varchar](150) NULL,
    [MobileNo] [varchar](15) NULL,
    [AlternateMobile] [varchar](15) NULL,
    [Email] [varchar](150) NULL,
    [Address] [varchar](250) NULL,
    [LeadSource] [varchar](100) NULL,
    [ProductCategory] [varchar](100) NULL,
    [ProductBrand] [varchar](100) NULL,
    [ProductModel] [varchar](100) NULL,
    [Budget] [decimal](10, 2) NULL,
    [LeadStatus] [varchar](50) NULL,
    [FollowupDate] [datetime] NULL,
    [Remarks] [varchar](500) NULL,
    [AssignTo] [int] NULL,
    [AssignedDate] [datetime] NULL,
    [InvoiceDate] [datetime] NULL,
    [InvoiceNo] [varchar](50) NULL,
    [CreatedBy] [int] NULL,
    [CreatedDate] [datetime] NULL,
    [EditBy] [int] NULL,
    [EditDate] [datetime] NULL,
PRIMARY KEY CLUSTERED
(
    [Id] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]
GO

ALTER TABLE [dbo].[tblLeads] ADD DEFAULT (getdate()) FOR [LeadDate]
GO

-- =============================================
-- Table: tblLeadSource
-- Description: Master table for lead sources
-- =============================================
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE TABLE [dbo].[tblLeadSource](
    [SourceId] [int] IDENTITY(1,1) NOT NULL,
    [SourceName] [varchar](100) NOT NULL,
PRIMARY KEY CLUSTERED
(
    [SourceId] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]
GO

-- =============================================
-- Table: tblFollowUp
-- Description: Lead follow-up tracking
-- =============================================
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE TABLE [dbo].[tblFollowUp](
    [Id] [int] IDENTITY(1,1) NOT NULL,
    [LeadID] [int] NOT NULL,
    [NextFollowupDate] [datetime] NULL,
    [FollowupType] [varchar](50) NULL,
    [Remarks] [varchar](500) NULL,
    [Status] [varchar](50) NULL,
    [CreatedBy] [int] NULL,
    [CreatedDate] [datetime] NULL,
    [EditBy] [int] NULL,
    [EditDate] [datetime] NULL,
PRIMARY KEY CLUSTERED
(
    [Id] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]
GO

ALTER TABLE [dbo].[tblFollowUp] ADD DEFAULT (getdate()) FOR [CreatedDate]
GO

ALTER TABLE [dbo].[tblFollowUp] ADD DEFAULT (getdate()) FOR [EditDate]
GO

-- =============================================
-- Table: tblStatus
-- Description: Master table for status values
-- =============================================
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE TABLE [dbo].[tblStatus](
    [StatusId] [int] IDENTITY(1,1) NOT NULL,
    [StatusName] [varchar](50) NULL,
PRIMARY KEY CLUSTERED
(
    [StatusId] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]
GO

-- =============================================
-- AUTHENTICATION & AUTHORIZATION TABLES
-- =============================================

-- =============================================
-- Table: tblUserGroups
-- Description: User groups/roles (Admin, Manager, Employee, etc.)
-- =============================================
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE TABLE [dbo].[tblUserGroups](
    [grp_id] [int] IDENTITY(1,1) NOT NULL,
    [grp_name] [varchar](100) NOT NULL,
    [grp_description] [varchar](500) NULL,
    [is_active] [bit] NULL,
    [CompId] [bigint] NULL,
    [BranchId] [bigint] NULL,
    [CreatedDate] [datetime] NULL,
PRIMARY KEY CLUSTERED
(
    [grp_id] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]
GO

ALTER TABLE [dbo].[tblUserGroups] ADD DEFAULT ((1)) FOR [is_active]
GO

ALTER TABLE [dbo].[tblUserGroups] ADD DEFAULT ((1)) FOR [CompId]
GO

ALTER TABLE [dbo].[tblUserGroups] ADD DEFAULT ((1)) FOR [BranchId]
GO

ALTER TABLE [dbo].[tblUserGroups] ADD DEFAULT (getdate()) FOR [CreatedDate]
GO

-- =============================================
-- Table: tblMenu
-- Description: Hierarchical menu structure for application navigation
-- Sample Data Reference:
-- 1. Dashboard (parentid=0, formname=frmDashboard, formclass=TaskManagement.Dashboard)
-- 2. Tasks (parentid=0, formname=frmTasks, formclass=TaskManagement.Tasks)
-- 3. Projects (parentid=0, formname=frmProjects, formclass=TaskManagement.Projects)
-- 4. Teams (parentid=0, formname=frmTeams, formclass=TaskManagement.Teams)
-- 5. Users (parentid=0, formname=frmUsers, formclass=TaskManagement.Users)
-- 6. Kanban Columns (parentid=0, formname=frmKanbanColumns, formclass=TaskManagement.KanbanColumns)
-- =============================================
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE TABLE [dbo].[tblMenu](
    [menuid] [int] IDENTITY(1,1) NOT NULL,
    [parentid] [int] NULL,
    [Description] [varchar](200) NOT NULL,
    [image] [varchar](100) NULL,
    [formid] [int] NULL,
    [mnutype] [int] NULL,
    [mnuActualID] [int] NULL,
    [isallowed] [bit] NULL,
    [formname] [varchar](100) NULL,
    [formclass] [varchar](200) NULL,
    [OpenStyle] [int] NULL,
PRIMARY KEY CLUSTERED
(
    [menuid] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]
GO

ALTER TABLE [dbo].[tblMenu] ADD DEFAULT ((0)) FOR [parentid]
GO

ALTER TABLE [dbo].[tblMenu] ADD DEFAULT ((0)) FOR [formid]
GO

ALTER TABLE [dbo].[tblMenu] ADD DEFAULT ((1)) FOR [mnutype]
GO

ALTER TABLE [dbo].[tblMenu] ADD DEFAULT ((0)) FOR [mnuActualID]
GO

ALTER TABLE [dbo].[tblMenu] ADD DEFAULT ((1)) FOR [isallowed]
GO

ALTER TABLE [dbo].[tblMenu] ADD DEFAULT ((1)) FOR [OpenStyle]
GO

-- =============================================
-- Table: tblUser
-- Description: User accounts with authentication and multi-tenant support
-- =============================================
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE TABLE [dbo].[tblUser](
    [userid] [int] IDENTITY(1,1) NOT NULL,
    [username] [varchar](100) NOT NULL,
    [password] [varchar](500) NOT NULL,
    [useractive] [bit] NULL,
    [isadmin] [bit] NULL,
    [User_IP] [varchar](50) NULL,
    [AllowDay] [int] NULL,
    [FullName] [varchar](200) NULL,
    [Email] [varchar](150) NULL,
    [JobTitle] [varchar](100) NULL,
    [HourlyRate] [decimal](10, 2) NULL,
    [CompId] [bigint] NULL,
    [BranchId] [bigint] NULL,
    [CreatedDate] [datetime] NULL,
    [GroupId] [int] NULL,
PRIMARY KEY CLUSTERED
(
    [userid] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY],
UNIQUE NONCLUSTERED
(
    [username] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]
GO

ALTER TABLE [dbo].[tblUser] ADD DEFAULT ((1)) FOR [useractive]
GO

ALTER TABLE [dbo].[tblUser] ADD DEFAULT ((0)) FOR [isadmin]
GO

ALTER TABLE [dbo].[tblUser] ADD DEFAULT ((0)) FOR [AllowDay]
GO

ALTER TABLE [dbo].[tblUser] ADD DEFAULT ((0)) FOR [HourlyRate]
GO

ALTER TABLE [dbo].[tblUser] ADD DEFAULT ((1)) FOR [CompId]
GO

ALTER TABLE [dbo].[tblUser] ADD DEFAULT ((1)) FOR [BranchId]
GO

ALTER TABLE [dbo].[tblUser] ADD DEFAULT (getdate()) FOR [CreatedDate]
GO

ALTER TABLE [dbo].[tblUser] WITH CHECK ADD CONSTRAINT [FK_tblUser_GroupId] FOREIGN KEY([GroupId])
REFERENCES [dbo].[tblUserGroups] ([grp_id])
GO

ALTER TABLE [dbo].[tblUser] CHECK CONSTRAINT [FK_tblUser_GroupId]
GO

-- =============================================
-- Table: tblUser_Groups
-- Description: Many-to-many mapping between users and groups
-- =============================================
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE TABLE [dbo].[tblUser_Groups](
    [ID] [int] IDENTITY(1,1) NOT NULL,
    [user_id] [int] NOT NULL,
    [grp_id] [int] NOT NULL,
PRIMARY KEY CLUSTERED
(
    [ID] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]
GO

ALTER TABLE [dbo].[tblUser_Groups] WITH NOCHECK ADD FOREIGN KEY([grp_id])
REFERENCES [dbo].[tblUserGroups] ([grp_id])
GO

ALTER TABLE [dbo].[tblUser_Groups] WITH NOCHECK ADD FOREIGN KEY([user_id])
REFERENCES [dbo].[tblUser] ([userid])
GO

-- =============================================
-- Table: tblGroupAccess
-- Description: Granular permissions (Add/Edit/Delete/View) per menu per group
-- =============================================
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO

CREATE TABLE [dbo].[tblGroupAccess](
    [accessid] [int] IDENTITY(1,1) NOT NULL,
    [groupid] [int] NOT NULL,
    [menuid] [int] NOT NULL,
    [isAdd] [bit] NULL,
    [isedit] [bit] NULL,
    [isDelete] [bit] NULL,
    [isView] [bit] NULL,
PRIMARY KEY CLUSTERED
(
    [accessid] ASC
)WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON, OPTIMIZE_FOR_SEQUENTIAL_KEY = OFF) ON [PRIMARY]
) ON [PRIMARY]
GO

ALTER TABLE [dbo].[tblGroupAccess] ADD DEFAULT ((0)) FOR [isAdd]
GO

ALTER TABLE [dbo].[tblGroupAccess] ADD DEFAULT ((0)) FOR [isedit]
GO

ALTER TABLE [dbo].[tblGroupAccess] ADD DEFAULT ((0)) FOR [isDelete]
GO

ALTER TABLE [dbo].[tblGroupAccess] ADD DEFAULT ((0)) FOR [isView]
GO

ALTER TABLE [dbo].[tblGroupAccess] WITH NOCHECK ADD FOREIGN KEY([groupid])
REFERENCES [dbo].[tblUserGroups] ([grp_id])
GO

ALTER TABLE [dbo].[tblGroupAccess] WITH NOCHECK ADD FOREIGN KEY([menuid])
REFERENCES [dbo].[tblMenu] ([menuid])
GO
