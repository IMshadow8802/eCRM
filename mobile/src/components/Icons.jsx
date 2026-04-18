import { MaterialIcons } from "@expo/vector-icons";
import { theme } from "../constants/theme";

// Navigation Icons
export const DashboardIcon = ({
  size = 20,
  color = theme.colors.gray[600],
}) => <MaterialIcons name="dashboard" size={size} color={color} />;

export const TasksIcon = ({ size = 20, color = theme.colors.gray[600] }) => (
  <MaterialIcons name="assignment" size={size} color={color} />
);

export const ProjectsIcon = ({ size = 20, color = theme.colors.gray[600] }) => (
  <MaterialIcons name="folder" size={size} color={color} />
);

export const TeamsIcon = ({ size = 20, color = theme.colors.gray[600] }) => (
  <MaterialIcons name="groups" size={size} color={color} />
);

export const UsersIcon = ({ size = 20, color = theme.colors.gray[600] }) => (
  <MaterialIcons name="people" size={size} color={color} />
);

export const SettingsIcon = ({ size = 20, color = theme.colors.gray[600] }) => (
  <MaterialIcons name="settings" size={size} color={color} />
);

export const LogoutIcon = ({ size = 20, color = theme.colors.gray[600] }) => (
  <MaterialIcons name="logout" size={size} color={color} />
);

// Form Field Icons
export const UserIcon = ({ size = 16, color = theme.colors.gray[500] }) => (
  <MaterialIcons name="person" size={size} color={color} />
);

export const EmailIcon = ({ size = 16, color = theme.colors.gray[500] }) => (
  <MaterialIcons name="email" size={size} color={color} />
);

export const PasswordIcon = ({ size = 16, color = theme.colors.gray[500] }) => (
  <MaterialIcons name="lock" size={size} color={color} />
);

export const PhoneIcon = ({ size = 16, color = theme.colors.gray[500] }) => (
  <MaterialIcons name="phone" size={size} color={color} />
);

export const LocationIcon = ({ size = 16, color = theme.colors.gray[500] }) => (
  <MaterialIcons name="location-on" size={size} color={color} />
);

export const WorkIcon = ({ size = 16, color = theme.colors.gray[500] }) => (
  <MaterialIcons name="work" size={size} color={color} />
);

export const BusinessIcon = ({ size = 16, color = theme.colors.gray[500] }) => (
  <MaterialIcons name="business" size={size} color={color} />
);

export const GroupIcon = ({ size = 16, color = theme.colors.gray[500] }) => (
  <MaterialIcons name="group" size={size} color={color} />
);

export const StatusIcon = ({ size = 16, color = theme.colors.gray[500] }) => (
  <MaterialIcons name="circle" size={size} color={color} />
);

// Action Icons
export const EditIcon = ({ size = 16, color = theme.colors.gray[600] }) => (
  <MaterialIcons name="edit" size={size} color={color} />
);

export const DeleteIcon = ({
  size = 16,
  color = theme.colors.status.error,
}) => <MaterialIcons name="delete" size={size} color={color} />;

export const AddIcon = ({ size = 20, color = theme.colors.white }) => (
  <MaterialIcons name="add" size={size} color={color} />
);

export const SearchIcon = ({ size = 16, color = theme.colors.gray[600] }) => (
  <MaterialIcons name="search" size={size} color={color} />
);

export const MenuIcon = ({ size = 20, color = theme.colors.gray[600] }) => (
  <MaterialIcons name="menu" size={size} color={color} />
);

export const CloseIcon = ({ size = 20, color = theme.colors.gray[600] }) => (
  <MaterialIcons name="close" size={size} color={color} />
);

export const MoreIcon = ({ size = 20, color = theme.colors.gray[600] }) => (
  <MaterialIcons name="more-vert" size={size} color={color} />
);

// Task/Project specific icons
export const PriorityIcon = ({ size = 16, color = theme.colors.gray[500] }) => (
  <MaterialIcons name="flag" size={size} color={color} />
);

export const CalendarIcon = ({ size = 16, color = theme.colors.gray[500] }) => (
  <MaterialIcons name="event" size={size} color={color} />
);

export const TimeIcon = ({ size = 16, color = theme.colors.gray[500] }) => (
  <MaterialIcons name="schedule" size={size} color={color} />
);

export const DescriptionIcon = ({
  size = 16,
  color = theme.colors.gray[500],
}) => <MaterialIcons name="description" size={size} color={color} />;

export const TagIcon = ({ size = 16, color = theme.colors.gray[500] }) => (
  <MaterialIcons name="label" size={size} color={color} />
);

// Status indicators
export const ActiveIcon = ({
  size = 12,
  color = theme.colors.status.success,
}) => <MaterialIcons name="circle" size={size} color={color} />;

export const InactiveIcon = ({ size = 12, color = theme.colors.gray[400] }) => (
  <MaterialIcons name="circle" size={size} color={color} />
);

// Arrow and navigation
export const ArrowDownIcon = ({
  size = 12,
  color = theme.colors.gray[500],
}) => <MaterialIcons name="keyboard-arrow-down" size={size} color={color} />;

export const ArrowRightIcon = ({
  size = 16,
  color = theme.colors.gray[500],
}) => <MaterialIcons name="keyboard-arrow-right" size={size} color={color} />;

export const BackIcon = ({ size = 20, color = theme.colors.gray[600] }) => (
  <MaterialIcons name="arrow-back" size={size} color={color} />
);

export default {
  // Navigation
  DashboardIcon,
  TasksIcon,
  ProjectsIcon,
  TeamsIcon,
  UsersIcon,
  SettingsIcon,
  LogoutIcon,

  // Form Fields
  UserIcon,
  EmailIcon,
  PasswordIcon,
  PhoneIcon,
  LocationIcon,
  WorkIcon,
  BusinessIcon,
  GroupIcon,
  StatusIcon,

  // Actions
  EditIcon,
  DeleteIcon,
  AddIcon,
  SearchIcon,
  MenuIcon,
  CloseIcon,
  MoreIcon,

  // Task/Project
  PriorityIcon,
  CalendarIcon,
  TimeIcon,
  DescriptionIcon,
  TagIcon,

  // Status
  ActiveIcon,
  InactiveIcon,

  // Navigation
  ArrowDownIcon,
  ArrowRightIcon,
  BackIcon,
};
